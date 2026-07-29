# Security policy

## Supported version

Security fixes are provided for the latest released version.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting:

https://github.com/troicc/X2PDF/security/advisories/new

Do not open a public issue for a vulnerability and do not attach cookies, X authentication tokens, browser profiles, or private Article content. Include the affected version, impact, reproduction steps, and a minimal proof of concept.

## Security boundaries

X2PDF does not request the `cookies` permission and does not require users to submit X credentials. It uses the `debugger` permission to observe responses already loaded by the current Article page and to invoke Chromium's PDF engine. Any change that broadens host access, adds remote code, or transmits Article content requires explicit security review.
