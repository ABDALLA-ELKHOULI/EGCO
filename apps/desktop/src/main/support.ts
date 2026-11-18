/**
 * بلاغات الدعم — يكتب المستخدم المشكلة (مع لقطة اختيارية مموَّهة) فتصل كبلاغ مرقَّم
 * على GitHub، ثم يُشحن الإصلاح في تحديث يذكر رقم البلاغ.
 *
 * لماذا مستودع منفصل للبلاغات لا مستودع الكود: رفع اللقطة عبر GitHub يحتاج مفتاحاً
 * يكتب ملفات. على مستودع الكود مفتاحٌ كهذا يستطيع أيضاً نشر تحديث، والمفتاح داخل
 * تطبيق يُنزَّل علناً، فيُستخرَج ويُدفع به تحديث مزوَّر إلى جهاز الشركة. المفتاح هنا
 * صلاحيته على مستودع البلاغات وحده: أسوأ ما يُفعل به بلاغات عابثة.
 *
 * المفتاح لا يُكتب في الكود أبداً — المستودع عام. يحقنه البناء في
 * apps/desktop/dist/support.json من سرّ EGCO_REPORT_TOKEN (release.yml). بدونه
 * تُحفظ البلاغات محلياً ويُقال ذلك صراحة، ولا يدّعي التطبيق إرسالاً لم يحدث.
 *
 * البلاغ يُحفظ في طابور على القرص أولاً ثم يُرسل؛ انقطاع الاتصال لا يُضيّعه، ويُعاد
 * إرسال المعلّق عند كل إقلاع.
 */
import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

interface SupportConfig { token: string; repo: string }

export interface SupportReport {
  description: string;            // مموَّه سلفاً في الواجهة، ويراه المستخدم قبل الإرسال
  screen: string;                 // المسار الحالي، مثل #/suppliers/2110•••
  diagnostics: Record<string, unknown>;
  screenshotJpegBase64?: string;  // لقطة مموَّهة — اختيارية
}

export interface SupportResult {
  state: 'sent' | 'queued' | 'local-only';
  issueNumber?: number;
  issueUrl?: string;
  message?: string;
}

const DEFAULT_REPO = 'ABDALLA-ELKHOULI/EGCO-reports';

function loadConfig(): SupportConfig | null {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'support.json'), 'utf-8');
    const c = JSON.parse(raw);
    if (typeof c.token === 'string' && c.token.length > 10) {
      return { token: c.token, repo: typeof c.repo === 'string' && c.repo ? c.repo : DEFAULT_REPO };
    }
  } catch { /* لا مفتاح في هذا البناء — البلاغات محلية فقط */ }
  return null;
}

const queueDir = () => path.join(app.getPath('userData'), 'support-queue');

/** لقطة نافذة التطبيق وحدها — لا سطح المكتب — مصغّرة ومضغوطة. */
export async function captureWindow(win: BrowserWindow): Promise<string> {
  const img = await win.webContents.capturePage();
  const size = img.getSize();
  const scaled = size.width > 1400 ? img.resize({ width: 1400 }) : img;
  return scaled.toJPEG(72).toString('base64');
}

function writeQueued(id: string, r: SupportReport): string {
  fs.mkdirSync(queueDir(), { recursive: true });
  const file = path.join(queueDir(), id + '.json');
  fs.writeFileSync(file, JSON.stringify({ id, createdAt: new Date().toISOString(), report: r }));
  return file;
}

async function gh(cfg: SupportConfig, method: string, url: string, body: unknown): Promise<any> {
  const res = await fetch('https://api.github.com/repos/' + cfg.repo + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'EGCO-Dashboard',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // نصّ GitHub كما هو — لكن بلا أي أثر للمفتاح (لا يظهر فيه أصلاً، والحذر لا يضر)
    const t = (await res.text()).slice(0, 300);
    throw new Error(`GitHub ${res.status}: ${t}`);
  }
  return res.json();
}

function issueBody(id: string, r: SupportReport, imageUrl?: string): string {
  const diag = Object.entries(r.diagnostics)
    .map(([k, v]) => `| ${k} | ${String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/\|/g, '/')} |`)
    .join('\n');
  return [
    '## وصف المشكلة',
    r.description || '_(بلا وصف)_',
    '',
    `**الشاشة:** \`${r.screen}\``,
    '',
    imageUrl ? `## لقطة الشاشة (المبالغ والأسماء مموَّهة)\n\n![لقطة](${imageUrl})\n` : '',
    '## معلومات تقنية',
    '| | |',
    '|---|---|',
    diag,
    '',
    `<sub>معرّف البلاغ: ${id}</sub>`,
  ].join('\n');
}

async function sendOne(cfg: SupportConfig, id: string, r: SupportReport): Promise<SupportResult> {
  let imageUrl: string | undefined;
  if (r.screenshotJpegBase64) {
    const put = await gh(cfg, 'PUT', `/contents/screenshots/${id}.jpg`, {
      message: `لقطة البلاغ ${id}`,
      content: r.screenshotJpegBase64,
    });
    imageUrl = put?.content?.download_url;
  }
  const firstLine = (r.description || 'بلاغ بلا وصف').split('\n')[0].slice(0, 70);
  const issue = await gh(cfg, 'POST', '/issues', {
    title: `[${app.getVersion()}] ${firstLine}`,
    body: issueBody(id, r, imageUrl),
    labels: ['بلاغ من التطبيق'],
  }).catch(async (e) => {
    // الوسم غير موجود في المستودع بعد — يُعاد بلا وسم بدل فقدان البلاغ
    if (String(e).includes('422')) {
      return gh(cfg, 'POST', '/issues', { title: `[${app.getVersion()}] ${firstLine}`,
                                           body: issueBody(id, r, imageUrl) });
    }
    throw e;
  });
  return { state: 'sent', issueNumber: issue.number, issueUrl: issue.html_url };
}

/** يحفظ البلاغ أولاً ثم يحاول إرساله. لا يضيع بلاغ بسبب انقطاع الاتصال. */
export async function submitReport(r: SupportReport): Promise<SupportResult> {
  const id = new Date().toISOString().slice(0, 10) + '-' + randomUUID().slice(0, 8);
  const file = writeQueued(id, r);
  const cfg = loadConfig();
  if (!cfg) {
    return { state: 'local-only',
             message: 'الإرسال غير مفعّل في هذه النسخة — حُفظ البلاغ على الجهاز: ' + file };
  }
  try {
    const res = await sendOne(cfg, id, r);
    fs.rmSync(file, { force: true });
    return res;
  } catch (e) {
    return { state: 'queued',
             message: 'تعذّر الإرسال الآن، وحُفظ البلاغ ليُرسل تلقائياً لاحقاً: ' + String(e).slice(0, 200) };
  }
}

/** يرسل ما بقي في الطابور — يُستدعى عند الإقلاع. صامت: لا نافذة ولا إزعاج. */
export async function flushQueue(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) return;
  let files: string[] = [];
  try { files = fs.readdirSync(queueDir()).filter((f) => f.endsWith('.json')); } catch { return; }
  for (const f of files) {
    const full = path.join(queueDir(), f);
    try {
      const { id, report } = JSON.parse(fs.readFileSync(full, 'utf-8'));
      await sendOne(cfg, id, report);
      fs.rmSync(full, { force: true });
    } catch { /* يبقى للمرة القادمة */ }
  }
}

export function systemDiagnostics(): Record<string, unknown> {
  return {
    'الإصدار': app.getVersion(),
    'النظام': `${os.platform()} ${os.release()} (${os.arch()})`,
    'الذاكرة المتاحة': `${Math.round(os.freemem() / 1e6)} / ${Math.round(os.totalmem() / 1e6)} MB`,
    'الوقت': new Date().toISOString(),
    'الإرسال مفعّل': loadConfig() ? 'نعم' : 'لا',
  };
}
