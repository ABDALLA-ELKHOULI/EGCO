/**
 * يثبّت اسم مستودع GitHub في إعدادات البناء:  node scripts/set-repo.mjs OWNER REPO
 * Replaces the __GH_OWNER__/__GH_REPO__ placeholders in electron-builder.yml.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [owner, repo] = process.argv.slice(2);
if (!owner || !repo) {
  console.error('usage: node scripts/set-repo.mjs <owner> <repo>');
  process.exit(1);
}
const p = new URL('../electron-builder.yml', import.meta.url);
let s = readFileSync(p, 'utf8');
s = s.replace(/owner: .*$/m, `owner: ${owner}`).replace(/repo: .*$/m, `repo: ${repo}`);
writeFileSync(p, s);
console.log(`publish -> github.com/${owner}/${repo}`);
