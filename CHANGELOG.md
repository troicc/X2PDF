# Changelog

All notable changes to X2PDF are documented here.

## 0.12.0

- Added a **Copy** button to every code-block toolbar.
- Copying uses the original source string rather than PrismJS-generated markup, preserving indentation, line breaks, comments, and special characters.
- Added Clipboard API and hidden-textarea fallback paths.
- Added success and failure feedback; copy controls are hidden during PDF export.
- Reused the same clipboard helper for code, LaTeX, and diagnostics.
- Added clipboard and code-toolbar regression tests.

## 0.11.0

- Fixed native MathML formulas being laid out as vertical columns in Chromium.
- Wrapped multiple top-level MathML children in an explicit `<mrow>`.
- Removed forced full-width MathML sizing that stretched fraction bars across the page.
- Preserved selectable/searchable formula text and LaTeX copying.
- Added `rootRowsNormalized` diagnostics and screen/print layout regression fixtures.

## 0.10.0

- Changed the primary formula renderer to native Chromium MathML.
- Kept SVG as a per-formula compatibility fallback.
- Added **Copy LaTeX** controls in the preview.
- Removed annotation and assistive layers that caused duplicate formula lines.
- Added renderer and selectability diagnostics.
- Enabled tagged PDF output and document outlines where Chromium supports them.
- Raised the minimum Chromium version to 109.

## 0.9.0

- Removed duplicate assistive-MathML output from generated PDFs.
- Added MathJax `merror` detection so red TeX error output is not counted as a successful formula.
- Added duplicate-TeX collapsing and normalization for Unicode mathematical letters and malformed bold commands.
- Reduced false-positive formula indexing of UUIDs and ordinary strings.

## 0.8.0

- Added parsing for `LATEX`, `TEX`, `MATH`, and `EQUATION` DraftJS entities.
- Added `entityKey` lookup across captured X responses.
- Added rendered-page formula fallback collection for MathML, MathJax, KaTeX, data attributes, and accessibility labels.
- Preserved formula order by aligning fallback formulas with DraftJS atomic blocks.
- Bundled MathJax locally and waited for formula layout before PDF generation.
- Added formula source, resolution, failure, and completeness diagnostics.

## 0.7.0

- Added locally bundled PrismJS syntax highlighting.
- Added common programming-language components and conservative language detection.
- Added X Light, GitHub Light, One Dark, and plain code themes.
- Added X-native, serif, and system sans-serif font presets.
- Added runtime Chirp loading with a system-font fallback; no font files are redistributed.
- Persisted page, font, text-size, code-theme, media, source, and wrapping preferences.

## 0.6.0

- Added Chrome DevTools Protocol network capture before Article navigation.
- Added recursive Article-payload detection independent of GraphQL operation names and hashes.
- Made `article.title` the authoritative verified title.
- Added DraftJS `content_state` parsing for blocks, entities, inline styles, nested lists, Markdown code, tables, formulas, and media.
- Inserted Article media according to atomic-block order.
- Added content-gap and structured-acquisition diagnostics.

## 0.5.0

- Added rolling collection for virtualized X media.
- Added pre-export caching for `pbs.twimg.com` images.
- Expanded media discovery outside the rich-text container.
- Fixed external code-node filtering and missing-image timing during PDF generation.
