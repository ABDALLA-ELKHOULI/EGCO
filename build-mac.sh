#!/usr/bin/env bash
# بناء التطبيق على ماك — شغّله بـ:  bash build-mac.sh
set -e
cd "$(dirname "$0")"

echo
echo "============================================"
echo "   بناء تطبيق لوحة إعمار الخليج — ماك"
echo "============================================"
echo

command -v node >/dev/null || { echo "  >> Node.js غير مثبّت — حمّله من https://nodejs.org"; exit 1; }
command -v python3 >/dev/null || { echo "  >> Python غير مثبّت — حمّله من https://python.org"; exit 1; }
echo "[1/4] Node $(node -v) · $(python3 --version)"

echo "[2/4] تثبيت المكتبات…"
npm install
npm run setup

echo "[3/4] اختبار الحسابات المالية…"
npm run test:api

echo "[4/4] بناء المثبّت…"
npm run package

echo
echo "تم البناء. المثبّت في مجلد release/"
open release 2>/dev/null || true
