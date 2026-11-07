#!/usr/bin/env bash
# 公開用のフォルダを組み立てる。使い方: scripts/build_site.sh [出力先] [ビルド識別子]
# - prototype/ の最新版(番号が最大の brain_dojo_v*.html)を index.html にする
# - 過去の版、PWA のファイル(manifest・アイコン・サービスワーカー)も置く
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-_site}"
BUILD="${2:-${GITHUB_SHA:-dev}}"
rm -rf "$OUT"
mkdir -p "$OUT"
latest=$(ls prototype/brain_dojo_v*.html | sort -V | tail -n 1)
echo "最新版: $latest / ビルド: $BUILD"
cp "$latest" "$OUT/index.html"
cp prototype/brain_dojo_v*.html "$OUT/"
cp pwa/manifest.webmanifest pwa/icon-192.png pwa/icon-512.png pwa/apple-touch-icon.png "$OUT/"
sed "s/__BUILD__/${BUILD}/" pwa/sw.js > "$OUT/sw.js"
touch "$OUT/.nojekyll"
