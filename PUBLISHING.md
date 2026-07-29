# Publishing X2PDF

## One-command GitHub publication

Requirements: Git, Node.js 20+, Python 3, GitHub CLI, and an authenticated `gh` session.

```bash
gh auth login
./scripts/publish-release.sh 0.12.0
```

The script runs tests, builds `dist/X2PDF-v0.12.0.zip`, commits pending repository files, pushes `main`, updates the repository description/topics, creates the `v0.12.0` release, and uploads the extension ZIP.

## Recommended repository settings

- Description: `Export X Articles and posts to clean PDFs with syntax-highlighted code, selectable formulas, and local-only processing.`
- Website: `https://github.com/troicc/X2PDF`
- Topics: `x`, `twitter`, `pdf`, `chrome-extension`, `manifest-v3`, `draftjs`, `mathjax`, `prismjs`, `article-export`
- Enable Issues and private vulnerability reporting.
- Upload `docs/images/social-preview.png` under **Settings → General → Social preview**.

## Manual release

```bash
npm install
npm run release:check
git add .
git commit -m "release: X2PDF v0.12.0"
git push origin main
gh release create v0.12.0 dist/X2PDF-v0.12.0.zip \
  --title "X2PDF v0.12.0" \
  --notes-file docs/releases/v0.12.0.md \
  --latest
```
