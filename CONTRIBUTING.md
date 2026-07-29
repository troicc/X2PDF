# Contributing to X2PDF

Thank you for helping improve X2PDF. English is the primary repository language; Chinese contributions are also welcome.

## Before opening a pull request

1. Search existing issues.
2. Keep changes focused.
3. Do not include private X content, cookies, tokens, browser profiles, generated PDFs, or font files.
4. Run `npm install` and `npm test`.
5. Load the repository as an unpacked extension and test the affected workflow.

## Architecture rule

For X Articles, prefer structured `content_state` and entity parsing. DOM selectors are a compatibility fallback, not the primary semantic source. New formats should be represented in the internal document block model and rendered by `preview.js`.

## Bug reports

Use the bug template and include a public URL, browser version, extension version, reproduction steps, and sanitized diagnostics.

## Coding style

- Use plain JavaScript, HTML, and CSS.
- Prefer small functions with explicit failure states.
- Preserve original source text for code and LaTeX.
- Do not silently discard unsupported content; record it in diagnostics.
- Keep all runtime dependencies bundled locally.

## Commit messages

Conventional-style messages are preferred, for example:

```text
fix: preserve nested list depth
feat: add Mermaid entity support
docs: clarify debugger permission
```
