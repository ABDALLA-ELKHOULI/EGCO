#!/usr/bin/env node
// فحص آلي (م-٣٣): يمنع تكرار نسيان `whatsNew.ts` — حدث فعلاً مع v0.11.0 وv0.11.1
// حيث وصل التطبيق لمستخدمين على نسخة فيها ميزات لم يُعلَن عنهم عنها قط، لأن
// القاعدة الورقية في CLAUDE.md §٨ لم تُطبَّق. هذا السكربت يُفشل الشحن بدل
// الاعتماد على أن يتذكّر أحد.
//
// المنطق: إن كان إصدار package.json أعلى من أعلى إصدار مسجَّل في WHATS_NEW،
// *و* تغيّر أي ملف تحت apps/renderer/src/pages/ منذ آخر وسم (tag) — فالأرجح
// أن ميزة وصلت المستخدم بلا إعلان، فيُفشل الفحص.
//
// عمداً لا يستورد whatsNew.ts كوحدة TS (السكربت يعمل بـ Node عادي في CI بلا
// بناء) — يُحلَّل نصياً بتعبير نمطي بسيط عن رقم كل إصدار مسجَّل.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function sh(cmd) {
  return execSync(cmd, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v || '');
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmpVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function main() {
  const pkgPath = path.join(repoRoot, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const pkgVersion = parseVersion(pkg.version);
  if (!pkgVersion) {
    console.error(`✗ تعذّر قراءة رقم إصدار صالح من ${pkgPath} (${pkg.version})`);
    process.exit(1);
  }

  const whatsNewPath = path.join(repoRoot, 'apps/renderer/src/lib/whatsNew.ts');
  const whatsNewSrc = readFileSync(whatsNewPath, 'utf8');
  const versionMatches = [...whatsNewSrc.matchAll(/version:\s*'([\d.]+)'/g)].map((m) => m[1]);
  if (versionMatches.length === 0) {
    console.error(`✗ لا يوجد أي إصدار مسجَّل في ${whatsNewPath}`);
    process.exit(1);
  }
  const parsedWhatsNew = versionMatches.map(parseVersion).filter(Boolean);
  const maxWhatsNew = parsedWhatsNew.reduce((max, v) => (cmpVersion(v, max) > 0 ? v : max));

  if (cmpVersion(pkgVersion, maxWhatsNew) <= 0) {
    console.log(`✓ إصدار package.json (${pkg.version}) لا يتجاوز أعلى إصدار في whatsNew.ts (${maxWhatsNew.join('.')}) — لا حاجة لفحص إضافي.`);
    return;
  }

  // إصدار package.json أعلى من كل ما هو معلَن — تحقّق من تغيّر صفحات منذ آخر وسم.
  let lastTag;
  try {
    lastTag = sh('git describe --tags --abbrev=0');
  } catch {
    console.log('✓ لا يوجد وسم سابق في هذا المستودع — تخطّي الفحص (أول إصدار).');
    return;
  }

  let changedFiles = [];
  try {
    changedFiles = sh(`git diff --name-only ${lastTag}..HEAD`).split('\n').filter(Boolean);
  } catch (e) {
    console.error(`✗ تعذّر تشغيل git diff منذ الوسم ${lastTag}: ${e.message}`);
    process.exit(1);
  }

  const changedPages = changedFiles.filter((f) => f.startsWith('apps/renderer/src/pages/'));
  if (changedPages.length === 0) {
    console.log(`✓ لا تغييرات في apps/renderer/src/pages/ منذ ${lastTag} رغم أن الإصدار (${pkg.version}) أعلى من whatsNew.ts.`);
    return;
  }

  console.error(
    `✗ إصدار package.json هو ${pkg.version}، وأعلى إصدار في whatsNew.ts هو ${maxWhatsNew.join('.')} — ` +
    `لكن تغيّرت ${changedPages.length} ملفات صفحات منذ آخر وسم (${lastTag}):\n` +
    changedPages.map((f) => `  - ${f}`).join('\n') +
    `\n\nأضف مدخلاً بإصدار ${pkg.version} إلى apps/renderer/src/lib/whatsNew.ts قبل الوسم، ` +
    `أو — إن كانت التغييرات لا تحمل ميزة يراها المستخدم — تجاهل هذا الفحص عن علم.`
  );
  process.exit(1);
}

main();
