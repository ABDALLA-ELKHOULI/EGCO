# -*- coding: utf-8 -*-
"""قارئ report4.html — التحصيلات القديمة.

The legacy EGCO collections report is a plain HTML file with six <table> elements.
Tables at index 3 and 4 are the per-unit collection tables we care about, with columns:
    وحدة | العميل | الدفعة الثانية | الدفعة الثالثة | المحصّل | المتبقي | ٪

No BeautifulSoup/lxml is available in this environment, so tables are extracted with the
stdlib html.parser. Unit numbers are written in Arabic-Indic digits (١٢٣...) and amounts
use Western digits with thousands separators; a dash '—' means zero/blank.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from typing import List, Optional

EXPECTED_HEADER = ['وحدة', 'العميل', 'الدفعة الثانية', 'الدفعة الثالثة', 'المحصّل', 'المتبقي', '٪']

_ARABIC_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')


class ReceivablesParseError(Exception):
    pass


class _TableExtractor(HTMLParser):
    """Extracts every <table> as a list of rows of cell text."""

    def __init__(self):
        super().__init__()
        self.tables: List[List[List[str]]] = []
        self._table: Optional[list] = None
        self._row: Optional[list] = None
        self._cell: Optional[list] = None

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self._table = []
        elif tag == 'tr' and self._table is not None:
            self._row = []
        elif tag in ('td', 'th') and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag == 'table' and self._table is not None:
            self.tables.append(self._table)
            self._table = None
        elif tag == 'tr' and self._row is not None:
            self._table.append(self._row)
            self._row = None
        elif tag in ('td', 'th') and self._cell is not None:
            self._row.append(''.join(self._cell).strip())
            self._cell = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def _translate_digits(text: str) -> str:
    return (text or '').translate(_ARABIC_DIGITS)


def _parse_amount(text: str) -> Decimal:
    text = (text or '').strip()
    if not text or text in ('—', '-', '–'):
        return Decimal('0')
    cleaned = text.translate(_ARABIC_DIGITS).replace(',', '').replace('٬', '')
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return Decimal('0')


@dataclass
class ReceivableRow:
    unit: str
    client: str
    amount: Decimal
    status: str          # 'collected' | 'open'
    project: str = ''


def parse(path: str) -> dict:
    """Return {receivables: [ReceivableRow], issues: [dict]}."""
    from app.ingest.friendly_errors import check_basic_file, describe_text_open_error
    check_basic_file(path, 'ملف report4.html', ReceivablesParseError)
    try:
        with open(path, encoding='utf-8', errors='ignore') as f:
            html = f.read()
    except OSError as e:
        raise ReceivablesParseError(
            str(describe_text_open_error(e, path, 'ملف report4.html'))) from e

    extractor = _TableExtractor()
    extractor.feed(html)
    tables = extractor.tables

    if len(tables) < 5:
        raise ReceivablesParseError(
            f'ملف report4.html غير متوقع الشكل — عدد الجداول {len(tables)} وليس 6')

    rows: List[ReceivableRow] = []
    issues: List[dict] = []

    for t_idx in (3, 4):
        table = tables[t_idx]
        if not table:
            continue
        body = table[1:] if [c.strip() for c in table[0]] == EXPECTED_HEADER else table
        for r_idx, cells in enumerate(body):
            if len(cells) < 6:
                continue
            unit_raw, client, _p2, _p3, collected_raw, remaining_raw = cells[:6]
            unit = _translate_digits(unit_raw).strip()
            client = (client or '').strip()
            if not client:
                continue

            collected = _parse_amount(collected_raw)
            remaining = _parse_amount(remaining_raw)

            if collected > 0:
                rows.append(ReceivableRow(unit=unit, client=client, amount=collected,
                                          status='collected'))
            if remaining > 0:
                rows.append(ReceivableRow(unit=unit, client=client, amount=remaining,
                                          status='open'))
            if collected <= 0 and remaining <= 0:
                issues.append(dict(severity='info', row=r_idx,
                                   message=f'الوحدة {unit} ({client}): لا يوجد مبلغ محصّل أو متبقٍ'))

    if not rows:
        raise ReceivablesParseError('لم تُقرأ أي بيانات تحصيل من report4.html')

    return dict(receivables=rows, issues=issues)
