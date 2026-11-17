# -*- coding: utf-8 -*-
"""كشوف مجمّعة — ملف PDF واحد يحمل كشوف مئات الحسابات متتالية.

النظام المحاسبي يُصدِّر «كشوفات الموردين» و«كشف المقاولين» و«كشف ضمان المقاولين»
ملفاً واحداً لكلٍّ منها: ٣٩٣ مورداً في ٥٠٥ صفحات، ٥٩٤ مقاولاً في ٦٨١ صفحة. المحلّلان
الموجودان (pdf_statement · contractor_statement) يفترضان حساباً واحداً في الملف،
فكانا يُلصقان آلاف الحركات من مئات الحسابات على الحساب الأول. هذا الملف لا يقرأ
الحركات بنفسه: يقطع الملف إلى كشف لكل حساب ثم يُسلِّم كل قطعة للمحلّل الذي يعرف
تخطيطها أصلاً. محلّلٌ واحد لكل تخطيط، لا نسخة ثانية تتباعد عنه.

بنية الملف كما قيست على الملفات الثلاثة الحقيقية:
  * كل صفحة تبدأ بترويسة كاملة: «تقرير كشف حساب» … رقم الحساب في السطر الذي يسبق
    «: الحساب» مباشرة … ثم عناوين الأعمدة وآخرها «الفرع».
  * حسابٌ يتجاوز صفحة تتكرر ترويسته في كل صفحة. صفحات الحساب الواحد متتالية دائماً
    (لم يظهر حساب في مقطعين منفصلين في أي ملف).
  * رقم الحساب متغيّر الطول: ٥ أرقام (21611) حتى ١٢ رقماً (212122121301). العدد الذي
    يسبقه في الترويسة رقم صفحة التقرير لا رقم حساب.

الترويسة المكرَّرة تُحذف من صفحات الاستمرار: لو بقيت لالتصقت بآخر حركة في الصفحة
السابقة، فيلتقط محلّل التخطيط المفكوك سطراً منها («تقرير كشف حساب») وصفاً للحركة.
"""
import re
import unicodedata
from dataclasses import dataclass, field
from typing import List, Optional

#: رقم الحساب: السطر الذي يسبق «: الحساب» مباشرة. الرموز هرمية — رمز الأب ثم لاحقة
#: الابن ملتصقين: 216121621 = 21612 + 1621، و216217121621722 = 21621712 + 1621722
#: (١٥ رقماً، «ضمان شركة رتبة البناء»). سقف ١٤ رقماً كان يُسقط هذه الصفحات فتُلحَق
#: بالحساب السابق — سبعة ضمانات لشركات مختلفة طُويت في حساب «رواسي نجران». الرمز
#: يُؤخذ كاملاً كما طُبع: قصّه إلى «آخر ٨ أرقام» يخترع رقم حساب غير موجود في الدفاتر.
PAGE_ACCOUNT_RE = re.compile(r'(?:^|\n)\s*(\d{4,20})\s*\n\s*:\s*الحساب')


def _norm(s: str) -> str:
    return unicodedata.normalize('NFKC', s)


@dataclass
class Section:
    """كشف حساب واحد مقطوع من الملف المجمّع."""
    account: str
    text: str                      # النص الخام (أشكال العرض كما هي) — المحلّلان يطبّعانه بأنفسهما
    first_page: int                # ترقيم يبدأ من ١ كما يراه المستخدم
    last_page: int
    pages: List[int] = field(default_factory=list)


def page_account(page_text: str) -> Optional[str]:
    m = PAGE_ACCOUNT_RE.search(_norm(page_text))
    return m.group(1) if m else None


def _strip_repeated_header(page_text: str) -> str:
    """يحذف ترويسة صفحة استمرار حتى عنوان العمود «الفرع» شاملاً.

    يُطابَق السطر بعد التطبيع لأن النص الخام بأشكال العرض. «الفرع الرئيسي» في أعلى
    الصفحة لا يطابق — المطابقة على السطر كاملاً «الفرع» وحده.
    """
    lines = page_text.split('\n')
    for i, ln in enumerate(lines):
        if _norm(ln).strip() == 'الفرع':
            return '\n'.join(lines[i + 1:])
    return page_text            # بلا عنوان أعمدة — يُترك كما هو بدل حذف ما لا نعرفه


def split_pages(pages: List[str]) -> List[Section]:
    """يجمع الصفحات المتتالية لنفس الحساب في كشف واحد.

    صفحة بلا رقم حساب تُلحَق بالحساب السابق (استمرار بلا ترويسة)؛ وإن جاءت قبل أي
    حساب تُهمل — لا نخترع لها صاحباً.
    """
    sections: List[Section] = []
    for idx, text in enumerate(pages, start=1):
        acct = page_account(text)
        if acct is not None and (not sections or sections[-1].account != acct):
            sections.append(Section(account=acct, text=text, first_page=idx,
                                    last_page=idx, pages=[idx]))
            continue
        if not sections:
            continue
        cur = sections[-1]
        cur.text += '\n' + _strip_repeated_header(text)
        cur.last_page = idx
        cur.pages.append(idx)
    return sections


def read_pages(path: str) -> List[str]:
    import fitz  # PyMuPDF
    doc = fitz.open(path)
    try:
        return [p.get_text() for p in doc]
    finally:
        doc.close()


def split(path: str) -> List[Section]:
    return split_pages(read_pages(path))


def is_bundle(path: str, sample_pages: int = 40) -> bool:
    """هل في الملف أكثر من حساب؟ يُفحص أوله فقط — كافٍ لأن الكشوف مرتّبة بالحساب،
    وملف الحساب الواحد مهما طال يحمل رقماً واحداً في كل صفحاته."""
    import fitz
    doc = fitz.open(path)
    try:
        seen = set()
        for i, p in enumerate(doc):
            if i >= sample_pages:
                break
            a = page_account(p.get_text())
            if a:
                seen.add(a)
                if len(seen) > 1:
                    return True
        return False
    finally:
        doc.close()


# ---------------------------------------------------------------- مسار افتراضي لكل حساب
#
# مسار الحفظ الموجود (import_service.commit_statement) يقرأ النص من مسار ملف. بدل نسخ
# ذلك المسار كله — بوابة المطابقة، كشف التكرار، الإنشاء التلقائي، التوجيه ٢١١/٢١٢/٢١٦ —
# يُحفظ كل حساب تحت مسار افتراضي «ملف.pdf#رقم_الحساب» يُرجع extract_text له نصَّ قطعته.
# فيمرّ كل حساب بكل ضمانة قائمة حرفياً، ويحمل سجلّ الاستيراد اسمه فيُحذف ويُستعاد
# حساباً حساباً. السياق محصور في `serving()`: خارجه لا يوجد مسار افتراضي إطلاقاً.
import contextvars
from contextlib import contextmanager
from typing import Dict, Iterator

_VIRTUAL: 'contextvars.ContextVar[Optional[Dict[str, str]]]' = contextvars.ContextVar(
    'egco_bundle_virtual_paths', default=None)

VIRTUAL_SEP = '#'


def section_path(bundle_path: str, account: str) -> str:
    return '%s%s%s' % (bundle_path, VIRTUAL_SEP, account)


@contextmanager
def serving(texts_by_path: Dict[str, str]) -> Iterator[None]:
    token = _VIRTUAL.set(dict(texts_by_path))
    try:
        yield
    finally:
        _VIRTUAL.reset(token)


def virtual_text(path: str) -> Optional[str]:
    m = _VIRTUAL.get()
    return None if m is None else m.get(path)
