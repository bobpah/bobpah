#!/usr/bin/env bash
# รวมไฟล์ .gs ทั้งหมดเป็นไฟล์เดียว → dist/Code.gs (คัดลอกไปวางใน Apps Script ได้ทีเดียว)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
{
  echo "// EA Finance Bot — ไฟล์รวม (สร้างจาก scripts/build.sh ห้ามแก้ไฟล์นี้โดยตรง)"
  for f in Sheet Setup Line Slip Commands Summary RichMenu Code; do
    echo
    echo "// ===== $f.gs ====="
    cat "apps-script/$f.gs"
  done
} > dist/Code.gs
cp apps-script/Dashboard.html dist/Dashboard.html
cp apps-script/appsscript.json dist/appsscript.json
echo "built dist/ ($(wc -c < dist/Code.gs) bytes)"
