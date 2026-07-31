(() => {
  "use strict";

  const ENDPOINT = "http://127.0.0.1:8787/api/integrations/x2pdf/documents";
  const button = document.getElementById("sendX2REDButton");
  const status = document.getElementById("x2redStatus");
  const title = document.getElementById("documentTitle");
  if (!button) return;

  const isZh = (globalThis.XPDFI18n?.locale || navigator.language || "en").startsWith("zh");
  const copy = {
    send: isZh ? "发送到 X2RED" : "Send to X2RED",
    sending: isZh ? "发送中…" : "Sending…",
    connecting: isZh ? "正在连接本机 X2RED…" : "Connecting to local X2RED…",
    noDocument: isZh ? "没有可发送的标准化长文。" : "No normalized document is available.",
    sent: isZh ? "已发送到 X2RED" : "Sent to X2RED",
    sentButton: isZh ? "已发送 ✓" : "Sent ✓",
    unavailable: isZh ? "X2RED 不可用" : "X2RED unavailable",
    blocks: isZh ? "个内容块" : "blocks",
  };
  button.textContent = copy.send;

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = copy.sending;
    if (status) status.textContent = copy.connecting;
    try {
      const stored = await chrome.storage.session.get("pendingXDocument");
      const documentValue = structuredClone(stored.pendingXDocument || null);
      if (!documentValue || !Array.isArray(documentValue.blocks)) {
        throw new Error(copy.noDocument);
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
      if (status) status.textContent = `${copy.sent} · ${payload.block_count || 0} ${copy.blocks}`;
      button.textContent = copy.sentButton;
      setTimeout(() => {
        button.textContent = copy.send;
        button.disabled = false;
      }, 1800);
      window.open(
        `http://127.0.0.1:8787/?source=${encodeURIComponent(payload.source_id)}`,
        "_blank",
        "noopener",
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (status) status.textContent = `${copy.unavailable}: ${message}`;
      button.textContent = copy.send;
    }
    button.disabled = false;
  });
})();
