# Privacy

X2PDF is designed as a local-first browser extension.

- Article extraction, document reconstruction, preview rendering, media caching, and PDF generation occur in the user's browser.
- X2PDF does not operate a project backend and does not send exported Article content to the project maintainer.
- The extension does not request the `cookies` permission and does not ask for X cookies or authentication tokens.
- Temporary document data is stored in `chrome.storage.session`. Layout preferences are stored in `chrome.storage.local`.
- Media is requested from X-owned media hosts when required for the user's export. Chirp may be requested from `abs.twimg.com` when the X-native font option is selected; the extension does not redistribute font files.
- The `debugger` permission is used to inspect network responses already received by the current X Article page and to call Chromium's `Page.printToPDF`.

X2PDF does not bypass X access controls. It can only export content visible to the current browser session.
