# -*- coding: utf-8 -*-
"""حسابات المقاولين — Contractor ledger domain.

Pure functions over plain data: no FastAPI, no database, no file I/O — the same layering
rule as domain/payables.py. All arithmetic is Decimal via D()/money() from payables.

Sign convention (matches the accounting statement itself):
    balance = Σ debit − Σ credit
    positive  = the contractor owes us
    negative  = we owe the contractor
debit (مدين) = payments to him / back-charges; credit (دائن) = مستخلصات وأعماله.
"""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Iterable, List, Optional

from app.domain.payables import D

# ---------------------------------------------------------------- text normalisation

_TATWEEL = 'ـ'


def _norm_ar(s: str) -> str:
    """Normalise Arabic for keyword matching.

    The statements mix orthographies freely (تأمين/تامين, دفعة/دفعه, الوادي/الوادى, and
    the PDF's NFKC output uses Farsi yeh ی) — collapse them all before any comparison.
    """
    s = (s or '').replace(_TATWEEL, '')
    s = re.sub('[يیى]', 'ي', s)
    s = s.replace('ة', 'ه')
    s = re.sub('[أإآ]', 'ا', s)
    return s


# ---------------------------------------------------------------- classification

def classify_entry(description: str) -> str:
    """تصنيف حركة من وصفها.

    Returns one of: 'opening' | 'claim' | 'retention' | 'deduction' | 'payment'
    | 'invoice' | 'other'.

    Order matters and is deliberate:
      * 'مستخلص' wins over anything embedded in the same line (a claim description can
        mention deductions).
      * retention ('تامين'/'ضمان') wins over 'خصم' — e.g. 'زياره تأمين تخصم على...'
        is a retention line even though it contains تخصم.
      * retention also wins over 'فاتوره' — 'فاتورة تامين' is retention, not a
        re-charged invoice.
    """
    t = _norm_ar(description)
    if 'رصيد افتتاح' in t:
        return 'opening'
    if 'مستخلص' in t:
        return 'claim'
    if 'تامين' in t or 'ضمان' in t:
        return 'retention'
    if 'خصم' in t:
        return 'deduction'
    if 'دفعه' in t or 'دفعات' in t or 'سداد' in t:
        return 'payment'
    # 'فتوره' is a real typo variant in the statements ('فتوره رقم641').
    if 'فاتوره' in t or 'فتوره' in t or 'فواتير' in t:
        return 'invoice'
    return 'other'


_CLAIM_NO_RE = re.compile(r'مستخلص\s*رقم\s*(\d+)')


def extract_claim_no(description: str) -> Optional[str]:
    """رقم المستخلص من الوصف — 'مستخلص رقم6' و'مستخلص رقم 14' كلاهما مقبول."""
    m = _CLAIM_NO_RE.search(_norm_ar(description))
    return m.group(1) if m else None


def detect_project(description: str, known_projects: List[str]) -> str:
    """أقرب مشروع معروف يظهر اسمه داخل الوصف — '' إن لم يوجد أو تعدّدت المطابقات.

    Both sides are normalised (_norm_ar) before substring matching, so روشن matches
    regardless of spelling variants. Ambiguity returns '' rather than guessing.
    """
    t = _norm_ar(description)
    hits = []
    for p in known_projects:
        pn = _norm_ar(p).strip()
        if pn and pn in t:
            hits.append(p)
    return hits[0] if len(hits) == 1 else ''


# ---------------------------------------------------------------- aggregation

def position(entries: Iterable[dict]) -> dict:
    """الموقف المالي من دفتر الحركات — Decimal sums, no floats.

    `entries` are dicts with keys debit / credit / kind. Per-kind sums use the side
    that kind naturally lives on: claims are credits (his work), payments are debits
    (money to him); retention/deductions are netted debit−credit.
    """
    zero = Decimal('0')
    debit_total = credit_total = zero
    claims_total = payments_total = retention_total = deductions_total = zero
    for e in entries:
        debit, credit = D(e.get('debit') or 0), D(e.get('credit') or 0)
        debit_total += debit
        credit_total += credit
        kind = e.get('kind') or 'other'
        if kind == 'claim':
            claims_total += credit
        elif kind == 'payment':
            payments_total += debit
        elif kind == 'retention':
            retention_total += debit - credit
        elif kind == 'deduction':
            deductions_total += debit - credit
    return dict(debit_total=debit_total, credit_total=credit_total,
                balance=debit_total - credit_total,
                claims_total=claims_total, payments_total=payments_total,
                retention_total=retention_total, deductions_total=deductions_total)
