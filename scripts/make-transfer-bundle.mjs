/**
 * يجهّز حزمة النقل إلى جهاز آخر بأمر واحد:  npm run bundle
 *
 * Produces release/EGCO-Transfer.zip containing exactly what the target machine needs
 * to build — and nothing that would break it. node_modules, the Python venv and any
 * previous build output are platform-specific binaries; copying them from macOS to
 * Windows is the most common way this transfer fails, so they are excluded here rather
 * than left to the person doing the copying.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const OUT_DIR = path.join(root, 'release');
const OUT = path.join(OUT_DIR, 'EGCO-Transfer.zip');

const EXCLUDES = [
  'node_modules/*', '*/node_modules/*',
  'services/api/.venv/*',
  'services/api/dist/*', 'services/api/build/*',
  'apps/desktop/dist/*',
  'release/*',
  '*/__pycache__/*', '*.pyc',
  '.pytest_cache/*', '*/.pytest_cache/*',
  '.DS_Store', '*/.DS_Store',
  '*.db', '*.db-journal',          // بيانات المستخدم لا تُنقل هنا — تُصدَّر من الإعدادات
  // كشوفات الشركة الحقيقية — بيانات مالية، تُرفع داخل التطبيق ولا تُوزَّع مع الكود.
  // The parser tests that need them are skipped automatically when the folder is absent.
  'design/samples/statements-batch/*',
];

mkdirSync(OUT_DIR, { recursive: true });
if (existsSync(OUT)) rmSync(OUT);

const args = EXCLUDES.map((e) => `-x '${e}'`).join(' ');
console.log('… يجهّز حزمة النقل');
execSync(`zip -r -q "${OUT}" . ${args}`, { stdio: 'inherit' });

const mb = (statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(`
تمّت التهيئة.

  الملف:  release/EGCO-Transfer.zip   (${mb} م.ب)

الخطوات على الجهاز الآخر:
  1. فُكّ ضغط الملف.
  2. انقر نقراً مزدوجاً على  BUILD-WINDOWS.bat   (ويندوز)
     أو شغّل  bash build-mac.sh                  (ماك)
  3. اتبع ما يظهر على الشاشة.

بياناتك لا تُنقل داخل هذه الحزمة — صدّرها من:
  التطبيق ← الإعدادات ← «تصدير نسخة من البيانات»
`);
