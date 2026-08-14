# -*- coding: utf-8 -*-
"""مساعد قراءة الملفات — مزود ذكاء اصطناعي اختياري متوافق مع OpenAI.

الافتراضي Ollama محلياً بنموذج صغير، وكل شيء قابل للتعديل من الإعدادات.
الإعدادات تُحفظ كملف JSON في DATA_DIR (وليس قاعدة البيانات) حتى تنجو من
استعادة النسخ ولا تُشحن ضمن تصدير البيانات. التطبيق يعمل كاملاً بدون أي
مزود مفعّل — كل شيء هنا اختياري.
"""
import json
import re
from pathlib import Path
from typing import Dict, List, Optional

import httpx

MAX_CHARS = 6000       # سقف النص المرسل في الطلب الواحد — استهلاك رموز خفيف
TIMEOUT_S = 60.0

# Neutral defaults — the user supplies their CLOUD provider's details from Settings
# (any OpenAI-compatible service). Nothing is prefilled: a wrong default endpoint
# is worse than an empty one, and the app must never assume a specific operator.
DEFAULTS = {
    'enabled': False,
    'provider': '',
    'baseUrl': '',
    'apiKey': '',
    'model': '',
    'maxTokens': 2000,
}

SYSTEM_PROMPT = (
    'أنت أداة استخراج بيانات محاسبية. يصلك نص خام من كشف حساب أو ملف مالي. '
    'استخرج سطور القيود وأعد JSON صارماً فقط بلا أي تعليق أو شرح، بالشكل: '
    '{"account": "رقم الحساب إن وجد", "name": "اسم الطرف إن وجد", '
    '"rows": [{"date": "YYYY-MM-DD", "debit": 0, "credit": 0, "description": ""}]}. '
    'التواريخ بصيغة YYYY-MM-DD حصراً، والمبالغ أرقام لا نصوص، '
    'واترك account/name غائبين إن لم تجدهما. لا تكتب أي شيء خارج الـJSON.'
)


class AiError(Exception):
    """خطأ من مزود الذكاء الاصطناعي — الرسالة عربية وصالحة للعرض مباشرة."""


# ---------------------------------------------------------------- settings

def _settings_path() -> Path:
    # import at call time so test reloads of app.core.config are honoured
    from app.core.config import settings
    return settings.DATA_DIR / 'ai-settings.json'


def load_settings() -> Dict:
    """الإعدادات المحفوظة مدموجة فوق الافتراضات — دائماً بشكل كامل."""
    out = dict(DEFAULTS)
    p = _settings_path()
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding='utf-8'))
            for k in DEFAULTS:
                if k in data and data[k] is not None:
                    out[k] = data[k]
        except (ValueError, OSError):
            pass  # ملف تالف — نعود للافتراضات بدل الانهيار
    return out


def save_settings(partial: Dict) -> Dict:
    """حفظ جزئي — المفاتيح غير المذكورة تبقى كما هي."""
    cur = load_settings()
    for k in DEFAULTS:
        if k in partial and partial[k] is not None:
            cur[k] = partial[k]
    cur['maxTokens'] = int(cur['maxTokens'])
    cur['enabled'] = bool(cur['enabled'])
    p = _settings_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cur, ensure_ascii=False, indent=2), encoding='utf-8')
    return cur


# ---------------------------------------------------------------- chat

def chat(messages: List[Dict], json_mode: bool = True) -> str:
    """POST {baseUrl}/chat/completions — درجة حرارة صفر، مهلة 60 ثانية.

    response_format=json_object عند json_mode (يدعمه Ollama)؛ إن رفضه المزود
    بـ400 نعيد المحاولة مرة واحدة بدونه.
    """
    s = load_settings()
    url = s['baseUrl'].rstrip('/') + '/chat/completions'
    headers = {'Content-Type': 'application/json'}
    if s['apiKey']:
        headers['Authorization'] = 'Bearer ' + s['apiKey']
    body = {
        'model': s['model'],
        'messages': messages,
        'temperature': 0,
        'max_tokens': int(s['maxTokens']),
    }
    if json_mode:
        body['response_format'] = {'type': 'json_object'}

    try:
        r = httpx.post(url, json=body, headers=headers, timeout=TIMEOUT_S)
        if r.status_code == 400 and json_mode:
            # مزودات ترفض response_format — محاولة ثانية بدونها
            body.pop('response_format', None)
            r = httpx.post(url, json=body, headers=headers, timeout=TIMEOUT_S)
        if r.status_code >= 400:
            # المزود عادة يشرح السبب (رصيد منتهٍ، نموذج خاطئ…) — إخفاؤه خلف رقم HTTP
            # ترك المستخدم يخمّن؛ نمرر رسالته كما هي.
            detail = ''
            try:
                body = r.json()
                detail = (body.get('error') or {}).get('message') or body.get('message') or ''
            except Exception:
                pass
            raise AiError('رفض المزود الطلب (HTTP {}){} — تأكد من العنوان والنموذج '
                          'والرصيد لدى المزود'.format(
                              r.status_code, ': ' + detail[:200] if detail else ''))
        data = r.json()
        return data['choices'][0]['message']['content']
    except AiError:
        raise
    except httpx.TimeoutException:
        raise AiError('انتهت مهلة الاتصال بالمزود — تأكد أن الخدمة تعمل')
    except httpx.HTTPError:
        raise AiError('تعذّر الاتصال بمزود الذكاء الاصطناعي على {} — '
                      'تأكد أن الخدمة تعمل وأن العنوان صحيح'.format(s['baseUrl']))
    except (KeyError, IndexError, ValueError):
        raise AiError('ردّ المزود بصيغة غير متوقعة — تأكد أنه متوافق مع OpenAI')


def test_connection() -> Dict:
    """اختبار سريع بأصغر طلب ممكن — لا يرفع استثناءً أبداً."""
    s = load_settings()
    try:
        chat([{'role': 'user', 'content': 'أجب بكلمة واحدة: جاهز'}], json_mode=False)
        return {'ok': True,
                'message': 'الاتصال ناجح — {} ({})'.format(s['provider'], s['model']),
                'model': s['model']}
    except AiError as e:
        return {'ok': False, 'message': str(e), 'model': s['model']}


# ---------------------------------------------------------------- extraction

def _read_pdf_pages(path: Path) -> List[str]:
    import fitz  # PyMuPDF
    doc = fitz.open(str(path))
    try:
        return [page.get_text() for page in doc]
    finally:
        doc.close()


def _read_xlsx(path: Path) -> str:
    import openpyxl
    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    lines = []
    try:
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                cells = [str(c) for c in row if c is not None and str(c).strip()]
                if cells:
                    lines.append(' | '.join(cells))
    finally:
        wb.close()
    return '\n'.join(lines)


def extract_text_segments(path: Path) -> List[str]:
    """نص خام كقطع (صفحات للـPDF، نص واحد لغيره)."""
    suffix = path.suffix.lower()
    if suffix == '.pdf':
        return [p for p in _read_pdf_pages(path) if p.strip()]
    if suffix in ('.xlsx', '.xlsm'):
        return [_read_xlsx(path)]
    return [path.read_text(encoding='utf-8', errors='replace')]


def chunk_segments(segments: List[str], limit: int = MAX_CHARS) -> List[str]:
    """تجميع القطع في دفعات لا تتجاوز الحد — قطعة أطول من الحد تُشطر."""
    pieces: List[str] = []
    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        while len(seg) > limit:
            pieces.append(seg[:limit])
            seg = seg[limit:]
        if seg:
            pieces.append(seg)
    chunks: List[str] = []
    cur = ''
    for piece in pieces:
        if cur and len(cur) + 1 + len(piece) > limit:
            chunks.append(cur)
            cur = piece
        else:
            cur = (cur + '\n' + piece) if cur else piece
    if cur:
        chunks.append(cur)
    return chunks


def _parse_json_reply(raw: str) -> Dict:
    """تحليل ردّ النموذج — نتسامح مع كتلة كود مسوّرة أو نص زائد حول الـJSON."""
    text = raw.strip()
    fenced = re.search(r'```(?:json)?\s*(.*?)```', text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    try:
        return json.loads(text)
    except ValueError:
        m = re.search(r'\{.*\}', text, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except ValueError:
                pass
    raise AiError('لم يُرجع النموذج JSON صالحاً — جرّب نموذجاً آخر أو أعد المحاولة')


def _valid_rows(data: Dict) -> List[Dict]:
    rows = []
    for r in data.get('rows') or []:
        if not isinstance(r, dict):
            continue
        try:
            rows.append({
                'date': str(r.get('date') or ''),
                'debit': float(r.get('debit') or 0),
                'credit': float(r.get('credit') or 0),
                'description': str(r.get('description') or ''),
            })
        except (TypeError, ValueError):
            continue
    return rows


def extract_rows(path: Path) -> Dict:
    """استخراج سطور القيود من ملف بأي صيغة عبر النموذج — تحليل فقط، لا كتابة.

    النص يُقصّ إلى دفعات ≤ 6000 حرف، وكل دفعة تُرسل بنفس التعليمات
    وتُدمج النتائج. لا يلمس قاعدة البيانات إطلاقاً.
    """
    segments = extract_text_segments(path)
    chunks = chunk_segments(segments)
    if not chunks:
        raise AiError('الملف فارغ أو لا يحتوي نصاً يمكن قراءته')

    all_rows: List[Dict] = []
    account: Optional[str] = None
    name: Optional[str] = None
    for chunk in chunks:
        reply = chat([
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': chunk},
        ], json_mode=True)
        data = _parse_json_reply(reply)
        all_rows.extend(_valid_rows(data))
        if account is None and data.get('account'):
            account = str(data['account'])
        if name is None and data.get('name'):
            name = str(data['name'])

    return {
        'rows': all_rows,
        'account': account,
        'name': name,
        'chunks': len(chunks),
        'tokensNote': 'أُرسل {} دفعة بحد {} حرف لكل دفعة للحفاظ على استهلاك '
                      'خفيف للرموز'.format(len(chunks), MAX_CHARS),
    }
