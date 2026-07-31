(() => {
  "use strict";

  const ENDPOINT = "http://127.0.0.1:8787/api/integrations/x2pdf/documents";
  const button = document.getElementById("sendX2REDButton");
  const status = document.getElementById("x2redStatus");
  const title = document.getElementById("documentTitle");
  if (!button) return;

  const label = (key, fallback) => {
    try { return globalThis.XPDFI18n?.t(key) || fallback; } catch { return fallback; }
  };

  button.addEventListener("click", async () => {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = label("sendingToX2RED", "Sending…");
    if (status) status.textContent = label("x2redConnecting", "Connecting to local X2RED…");
    try {
      const stored = await chrome.storage.session.get("pendingXDocument");
      const documentValue = structuredClone(stored.pendingXDocument || null);
      if (!documentValue || !Array.isArray(documentValue.blocks)) {
        throw new Error(label("x2redNoDocument", "No normalized document is available."));
      }
      if (title?.textContent?.trim()) {
        documentValue.metadata = { ...(documentValue.metadata || {}), title: title.textContent.trim() };
      }
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: documentValue }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `X2RED HTTP ${response.status}`);
      if (status) {
        status.textContent = label("x2redSent", "Sent to X2RED") + ` · ${payload.block_count || 0} blocks`;
      }
      button.textContent = label("sentToX2RED", "Sent ✓");
      setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
      }, 1800);
      window.open(`http://127.0.0.1:8787/?source=${encodeURIComponent(payload.source_id)}`, "_blank", "noopener");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (status) status.textContent = `${label("x2redUnavailable", "X2RED unavailable")}: ${message}`;
      button.textContent = label("sendToX2RED", "Send to X2RED");
    }
    button.disabled = false;
  });
})();
