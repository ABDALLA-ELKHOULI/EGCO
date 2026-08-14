/** تهيئة جهاز جديد بأمر واحد — works on Windows and macOS. */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const run = (cmd, opts = {}) => { console.log('›', cmd); execSync(cmd, { stdio: 'inherit', ...opts }); };
const win = process.platform === 'win32';

// BUILD-WINDOWS.bat exports EGCO_PYTHON after locating the interpreter — Python is
// frequently installed without being added to PATH, and failing there stopped a build
// on a machine that already had it.
const py = process.env.EGCO_PYTHON || (win ? 'python' : 'python3');
const venvPy = win ? 'services\\api\\.venv\\Scripts\\python.exe' : 'services/api/.venv/bin/python';

if (!existsSync('services/api/.venv')) run(`"${py}" -m venv services/api/.venv`);
run(`"${venvPy}" -m pip install --upgrade pip -q`);
run(`"${venvPy}" -m pip install -r services/api/requirements.txt -q`);
console.log('\nتمت التهيئة. شغّل: npm run dev');
