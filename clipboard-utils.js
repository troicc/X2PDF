(function initClipboardUtils(global) {
  "use strict";

  async function copyText(value) {
    const text = typeof value === "string" ? value : String(value ?? "");
    if (!text) return false;

    if (global.navigator?.clipboard?.writeText) {
      try {
        await global.navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to the legacy selection path. This is useful in
        // hardened browser profiles where the Clipboard API is unavailable.
      }
    }

    return legacyCopyText(text);
  }

  function legacyCopyText(text) {
    const doc = global.document;
    if (!doc?.createElement || !doc.body) return false;

    const textarea = doc.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";

    doc.body.append(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange?.(0, textarea.value.length);

    let copied = false;
    try {
      copied = Boolean(doc.execCommand?.("copy"));
    } catch {
      copied = false;
    }
    textarea.remove();
    return copied;
  }

  global.XPDFClipboard = Object.freeze({ copyText });
})(globalThis);
