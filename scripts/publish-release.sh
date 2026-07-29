#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.12.0}"
TAG="v${VERSION#v}"
ASSET="dist/X2PDF-${TAG}.zip"

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v gh >/dev/null || { echo "GitHub CLI (gh) is required" >&2; exit 1; }

gh auth status >/dev/null
npm install --no-package-lock
npm run release:check

if [[ ! -f "$ASSET" ]]; then
  echo "Release asset not found: $ASSET" >&2
  exit 1
fi

git add .
if ! git diff --cached --quiet; then
  git commit -m "release: X2PDF ${TAG}"
fi
git push origin main

gh repo edit troicc/X2PDF \
  --description "Export X Articles and posts to clean PDFs with syntax-highlighted code, selectable formulas, and local-only processing." \
  --homepage "https://github.com/troicc/X2PDF" \
  --add-topic x \
  --add-topic twitter \
  --add-topic pdf \
  --add-topic chrome-extension \
  --add-topic manifest-v3 \
  --add-topic draftjs \
  --add-topic mathjax \
  --add-topic prismjs \
  --add-topic article-export

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$ASSET" --clobber
else
  gh release create "$TAG" "$ASSET" \
    --title "X2PDF ${TAG}" \
    --notes-file "docs/releases/${TAG}.md" \
    --latest
fi

echo "Published ${TAG}: https://github.com/troicc/X2PDF/releases/tag/${TAG}"
