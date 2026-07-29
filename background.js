importScripts("structured-parser.js");

const SUPPORTED_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com"
]);

const STRUCTURED_CAPTURE_TIMEOUT_MS = 24000;
const STRUCTURED_CAPTURE_MAX_PAYLOADS = 48;
const STRUCTURED_CAPTURE_MAX_BODY_CHARS = 36 * 1024 * 1024;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;

  let pageUrl;
  try {
    pageUrl = new URL(tab.url);
  } catch {
    await showError("当前标签页地址无效。", tab.id);
    return;
  }

  if (!SUPPORTED_HOSTS.has(pageUrl.hostname.toLowerCase())) {
    await showError("请先打开一篇 X Article、长帖或帖子详情页。", tab.id);
    return;
  }

  try {
    await setBadge(tab.id, "…", "#536471");
    await delay(650);

    let result;
    const directArticleUrl = articleUrlFromLocation(pageUrl);
    if (directArticleUrl) {
      result = await extractArticleWithStructuredData(directArticleUrl);
    } else {
      const pageResult = await runExtractorWithRetry(tab.id, 5);
      if (pageResult?.kind === "redirect" && pageResult.articleUrl) {
        result = await extractArticleWithStructuredData(pageResult.articleUrl);
      } else {
        result = pageResult;
      }
    }

    if (result?.kind !== "document" || !result.document || !Array.isArray(result.document.blocks)) {
      throw new Error(result?.message || "页面中没有识别到可导出的正文。请等待页面加载完成后重试。");
    }

    await chrome.storage.session.set({
      pendingXDocument: result.document,
      exportError: null
    });

    await setBadge(tab.id, "✓", "#1f883d");
    await chrome.tabs.create({ url: chrome.runtime.getURL("preview.html") });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {}), 1800);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await showError(message, tab.id);
  }
});

function articleUrlFromLocation(url) {
  const match = url.pathname.match(/^\/([^/]+)\/article\/(\d+)/);
  if (!match) return "";
  return `https://x.com/${encodeURIComponent(match[1])}/article/${match[2]}`;
}

async function extractArticleWithStructuredData(articleUrl) {
  const expectedId = extractArticleId(articleUrl);
  const temporaryTab = await chrome.tabs.create({ url: "about:blank", active: false });
  if (!temporaryTab.id) throw new Error("无法创建 Article 数据捕获标签页。");

  try {
    const capture = await captureArticleBackendResponses(temporaryTab.id, articleUrl, expectedId);
    await delay(650);

    let fallbackResult = await runExtractorWithRetry(temporaryTab.id, 4, 500).catch(() => null);
    let fallbackDocument = fallbackResult?.kind === "document" ? fallbackResult.document : null;
    let parsed = globalThis.XPDFStructured.parseCapturedArticle({
      payloads: capture.payloads,
      articleUrl,
      expectedId,
      fallbackDocument
    });

    const unresolvedMedia = parsed.ok ? (parsed.document?.diagnostics?.unresolvedMedia?.length || 0) : Number.POSITIVE_INFINITY;
    const expectedMediaEntities = parsed.ok ? (parsed.document?.diagnostics?.entities?.media || 0) : 0;
    const outputMedia = parsed.ok
      ? ((parsed.document?.diagnostics?.output?.image || 0) + (parsed.document?.diagnostics?.output?.media || 0))
      : 0;
    const unresolvedFormulas = parsed.ok ? (parsed.document?.diagnostics?.unresolvedFormulas?.length || 0) : Number.POSITIVE_INFINITY;
    const latexUnknowns = parsed.ok
      ? (parsed.document?.diagnostics?.unknownEntities || []).filter((entry) => /latex|tex|math|equation/i.test(String(entry?.type || ""))).length
      : 0;

    // Perform the rolling DOM capture when structured data still contains
    // unresolved media or LATEX entities. X renders LATEX through separate
    // frontend components, so their MathML/TeX source may only be present in DOM.
    if (!parsed.ok || unresolvedMedia > 0 || unresolvedFormulas > 0 || latexUnknowns > 0 || (expectedMediaEntities > 0 && outputMedia === 0)) {
      await prepareArticleTab(temporaryTab.id);
      fallbackResult = await runExtractorWithRetry(temporaryTab.id, 8, 650).catch(() => null);
      fallbackDocument = fallbackResult?.kind === "document" ? fallbackResult.document : fallbackDocument;
      parsed = globalThis.XPDFStructured.parseCapturedArticle({
        payloads: capture.payloads,
        articleUrl,
        expectedId,
        fallbackDocument
      });
    }

    if (parsed.ok && parsed.document) {
      parsed.document.diagnostics.acquisition.network = capture.stats;
      return { kind: "document", document: parsed.document };
    }

    if (fallbackDocument) {
      fallbackDocument.diagnostics = {
        ...(fallbackDocument.diagnostics || {}),
        extractorVersion: "0.12.0",
        acquisition: {
          method: "dom-fallback",
          responseMatched: false,
          network: capture.stats,
          structuredError: parsed.error || "未取得结构化 Article 数据"
        },
        title: {
          value: fallbackDocument.metadata?.title || "",
          source: "dom-fallback",
          verified: false
        },
        completeness: {
          status: "warning",
          suspectedContentGaps: [{
            text: "未捕获到 X Article content_state；代码、媒体顺序或标题可能不完整。"
          }]
        }
      };
      return { kind: "document", document: fallbackDocument };
    }

    throw new Error(parsed.error || "未能从 X 后端响应中取得 Article content_state。");
  } finally {
    await chrome.tabs.remove(temporaryTab.id).catch(() => {});
  }
}

async function captureArticleBackendResponses(tabId, articleUrl, expectedId) {
  const debuggee = { tabId };
  const requestMeta = new Map();
  const payloads = [];
  const pendingBodies = new Set();
  let attached = false;
  let candidateFoundAt = 0;
  let loadEventAt = 0;
  let totalBodyChars = 0;
  let jsonResponses = 0;
  let bodyErrors = 0;
  let inspectedResponses = 0;
  const responseHints = [];

  const processBody = async (requestId, meta) => {
    if (!meta || payloads.length >= STRUCTURED_CAPTURE_MAX_PAYLOADS || totalBodyChars >= STRUCTURED_CAPTURE_MAX_BODY_CHARS) return;
    try {
      const response = await chrome.debugger.sendCommand(debuggee, "Network.getResponseBody", { requestId });
      const body = decodeResponseBody(response);
      if (!body || body.length > 24 * 1024 * 1024) return;
      totalBodyChars += body.length;
      const parsedValues = parseJsonResponseBody(body);
      for (const json of parsedValues) {
        jsonResponses += 1;
        payloads.push({ url: meta.url, json });
        if (responseHints.length < 120) {
          responseHints.push(...summarizeStructuredHints(json, 120 - responseHints.length));
        }
        const candidates = [];
        globalThis.XPDFStructured.collectArticleCandidates(json, candidates, [], expectedId, payloads.length - 1);
        if (candidates.length && !candidateFoundAt) candidateFoundAt = Date.now();
        if (payloads.length >= STRUCTURED_CAPTURE_MAX_PAYLOADS) break;
      }
    } catch {
      bodyErrors += 1;
    }
  };

  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId) return;
    if (method === "Page.loadEventFired") {
      loadEventAt = Date.now();
      return;
    }
    if (method === "Network.responseReceived") {
      inspectedResponses += 1;
      if (isCandidateJsonResponse(params.response)) {
        requestMeta.set(params.requestId, {
          url: params.response.url,
          mimeType: params.response.mimeType || ""
        });
      }
      return;
    }
    if (method === "Network.loadingFinished") {
      const meta = requestMeta.get(params.requestId);
      if (!meta) return;
      requestMeta.delete(params.requestId);
      const task = processBody(params.requestId, meta).finally(() => pendingBodies.delete(task));
      pendingBodies.add(task);
    }
  };

  try {
    await chrome.debugger.attach(debuggee, "1.3");
    attached = true;
    chrome.debugger.onEvent.addListener(onEvent);
    await chrome.debugger.sendCommand(debuggee, "Network.enable", {
      maxTotalBufferSize: 100 * 1024 * 1024,
      maxResourceBufferSize: 40 * 1024 * 1024,
      maxPostDataSize: 4 * 1024 * 1024
    });
    await chrome.debugger.sendCommand(debuggee, "Network.setCacheDisabled", { cacheDisabled: true });
    await chrome.debugger.sendCommand(debuggee, "Network.setBypassServiceWorker", { bypass: true });
    await chrome.debugger.sendCommand(debuggee, "Page.enable");
    await chrome.debugger.sendCommand(debuggee, "Page.navigate", { url: articleUrl });

    const deadline = Date.now() + STRUCTURED_CAPTURE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await delay(180);
      if (candidateFoundAt && Date.now() - candidateFoundAt > 1800 && pendingBodies.size === 0) break;
      if (!candidateFoundAt && loadEventAt && Date.now() - loadEventAt > 6500 && pendingBodies.size === 0) break;
    }
    if (pendingBodies.size) await Promise.allSettled([...pendingBodies]);
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    if (attached) await chrome.debugger.detach(debuggee).catch(() => {});
  }

  return {
    payloads,
    stats: {
      inspectedResponses,
      jsonResponses,
      payloadCount: payloads.length,
      totalBodyChars,
      bodyErrors,
      candidateFound: Boolean(candidateFoundAt),
      loadObserved: Boolean(loadEventAt),
      responseHints
    }
  };
}

function isCandidateJsonResponse(response) {
  if (!response?.url) return false;
  let host = "";
  try { host = new URL(response.url).hostname.toLowerCase(); } catch { return false; }
  if (!(host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com"))) return false;
  const mime = String(response.mimeType || "").toLowerCase();
  const url = String(response.url).toLowerCase();
  return mime.includes("json") || mime.includes("graphql") || /\/graphql\/|\/i\/api\/|\/2\/tweets|article/.test(url);
}

function decodeResponseBody(response) {
  if (!response?.body) return "";
  if (!response.base64Encoded) return response.body;
  try {
    const binary = atob(response.body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function parseJsonResponseBody(body) {
  let text = String(body || "").trim().replace(/^\)\]\}',?\s*/, "");
  if (!text) return [];
  const output = [];
  const tryParse = (value) => {
    try {
      const parsed = JSON.parse(value);
      output.push(parsed);
      return true;
    } catch {
      return false;
    }
  };
  if (tryParse(text)) return output;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && (trimmed.startsWith("{") || trimmed.startsWith("["))) tryParse(trimmed);
  }
  if (/<script/i.test(text)) {
    const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptPattern.exec(text)) && output.length < 24) {
      let script = match[1].trim().replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      if (tryParse(script)) continue;
      const firstBrace = Math.min(
        ...[script.indexOf("{"), script.indexOf("[")].filter((value) => value >= 0)
      );
      const lastBrace = Math.max(script.lastIndexOf("}"), script.lastIndexOf("]"));
      if (Number.isFinite(firstBrace) && firstBrace >= 0 && lastBrace > firstBrace) {
        tryParse(script.slice(firstBrace, lastBrace + 1));
      }
    }
  }
  return output;
}

function summarizeStructuredHints(root, limit = 80) {
  const output = [];
  const seen = new Set();
  const visit = (value, path = [], depth = 0) => {
    if (output.length >= limit || depth > 18 || value == null) return;
    if (typeof value === "string") {
      if (value.length < 2 * 1024 * 1024 && /content_state|media_items|markdown/.test(value.slice(0, 8000))) {
        output.push({ path: path.join("."), kind: "json-string", length: value.length });
      }
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const keys = Object.keys(value);
    const interesting = keys.filter((key) => /^(?:title|content_state|contentState|blocks|entities|entityMap|markdown|media_items|mediaItems|article|article_results|articleResults|latex|tex|mathml|formula|equation|entityKey|entity_key)$/i.test(key));
    if (interesting.length) {
      output.push({ path: path.join("."), keys: interesting.slice(0, 16) });
    }
    for (const [key, child] of Object.entries(value)) visit(child, path.concat(key), depth + 1);
  };
  visit(root);
  return output;
}

function extractArticleId(value) {
  return String(value || "").match(/\/article\/(\d+)/)?.[1] || "";
}

async function prepareArticleTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const absoluteTop = (node) => node.getBoundingClientRect().top + window.scrollY;
        const absoluteBottom = (node) => node.getBoundingClientRect().bottom + window.scrollY;
        const cleanUrl = (value) => {
          try {
            const url = new URL(value || "", location.href);
            if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com") return null;
            if (!["/media/", "/amplify_video_thumb/", "/ext_tw_video_thumb/", "/tweet_video_thumb/"]
              .some((prefix) => url.pathname.startsWith(prefix))) return null;
            if (url.pathname.startsWith("/media/")) url.searchParams.set("name", "large");
            return url.href;
          } catch {
            return null;
          }
        };
        const normalizedKey = (value) => {
          try {
            const url = new URL(value);
            url.searchParams.delete("name");
            return url.href;
          } catch {
            return value;
          }
        };
        const bestImageSource = (image) => {
          const srcset = image.getAttribute("srcset") || image.closest("picture")?.querySelector("source[srcset]")?.getAttribute("srcset") || "";
          const fromSet = srcset.split(",").map((item) => item.trim()).filter(Boolean).at(-1)?.split(/\s+/)[0];
          return fromSet || image.currentSrc || image.src || image.getAttribute("src") || "";
        };
        const body = document.querySelector(
          "[data-testid='twitterArticleRichTextView'], [data-testid*='ArticleRichText'], [data-testid*='articleRichText'], article [data-testid*='RichTextView']"
        );
        const main = body?.closest("main") || document.querySelector("main") || document.body;
        const article = body?.closest("article") || main;
        const startY = window.scrollY;

        const capture = globalThis.__XPDF_CAPTURE__ = {
          version: 2,
          createdAt: Date.now(),
          scans: 0,
          media: [],
          codes: [],
          formulas: []
        };
        const mediaMap = new Map();
        const codeMap = new Map();
        const formulaMap = new Map();

        const visibleTextAnchors = () => Array.from((body || article).querySelectorAll([
          "[data-block='true']", "p", "h1", "h2", "h3", "h4", "blockquote", "li"
        ].join(",")))
          .filter((node) => normalizeText(node.innerText || node.textContent || "").length >= 3)
          .map((node) => ({
            top: absoluteTop(node),
            bottom: absoluteBottom(node),
            text: normalizeText(node.innerText || node.textContent || "").slice(0, 240)
          }))
          .sort((a, b) => a.top - b.top);

        const nearestAnchors = (top, bottom, anchors) => {
          let before = "";
          let after = "";
          let beforeDistance = Number.POSITIVE_INFINITY;
          let afterDistance = Number.POSITIVE_INFINITY;
          for (const anchor of anchors) {
            if (anchor.bottom <= top + 8) {
              const distance = top - anchor.bottom;
              if (distance < beforeDistance) {
                beforeDistance = distance;
                before = anchor.text;
              }
            }
            if (anchor.top >= bottom - 8) {
              const distance = anchor.top - bottom;
              if (distance < afterDistance) {
                afterDistance = distance;
                after = anchor.text;
              }
            }
          }
          return { beforeText: before, afterText: after };
        };

        const addMedia = ({ node, src, alt = "", mediaType, sourceUrl, contextHint = "" }) => {
          const clean = cleanUrl(src);
          if (!clean || !(node instanceof Element)) return;
          const rect = node.getBoundingClientRect();
          const width = node instanceof HTMLImageElement ? (node.naturalWidth || Math.round(rect.width)) : Math.round(rect.width);
          const height = node instanceof HTMLImageElement ? (node.naturalHeight || Math.round(rect.height)) : Math.round(rect.height);
          const renderedWidth = Math.round(rect.width);
          const renderedHeight = Math.round(rect.height);
          const area = Math.max(width * height, renderedWidth * renderedHeight);
          if (width > 0 && height > 0 && (width < 150 || height < 80 || area < 32000)) return;
          const hint = `${contextHint} ${node.id || ""} ${typeof node.className === "string" ? node.className : ""} ${node.getAttribute("data-testid") || ""}`.slice(0, 260);
          if (/avatar|emoji|badge|icon|profile|UserAvatar/i.test(hint) && area < 250000) return;

          const top = absoluteTop(node);
          const bottom = absoluteBottom(node);
          const anchors = nearestAnchors(top, bottom, visibleTextAnchors());
          const value = {
            src: clean,
            alt: normalizeText(alt),
            width, height, renderedWidth, renderedHeight, area,
            top, bottom,
            mediaType,
            sourceUrl,
            contextHint: hint,
            ...anchors
          };
          const key = normalizedKey(clean);
          const previous = mediaMap.get(key);
          if (!previous || area > previous.area || (!previous.beforeText && value.beforeText)) mediaMap.set(key, value);
        };

        const formulaComparisonKey = (value) => Array.from(String(value || ""))
          .map((character) => {
            const code = character.codePointAt(0);
            return code >= 0x1D400 && code <= 0x1D7FF ? character.normalize("NFKC") : character;
          })
          .join("")
          .replace(/\\(?:left|right)/g, "")
          .replace(/\s+/g, "")
          .toLowerCase();
        const collapseDuplicateFormulaSource = (value) => {
          const source = String(value || "").replace(/\r\n?/g, "\n").trim();
          const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean);
          if (lines.length >= 2 && lines.length % 2 === 0) {
            const half = lines.length / 2;
            const first = lines.slice(0, half).join("\n");
            const second = lines.slice(half).join("\n");
            if (formulaComparisonKey(first) === formulaComparisonKey(second)) return first;
          }
          return source;
        };
        const normalizeFormulaSource = (value) => collapseDuplicateFormulaSource(String(value || "")
          .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
          .replace(/^\s*\$\$([\s\S]*?)\$\$\s*$/, "$1")
          .replace(/^\s*\\\[([\s\S]*?)\\\]\s*$/, "$1")
          .replace(/^\s*\\\(([\s\S]*?)\\\)\s*$/, "$1")
          .trim());

        const formulaReference = (node) => {
          let current = node instanceof Element ? node : null;
          for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
            for (const name of ["data-entity-key", "data-entitykey", "data-formula-key", "data-latex-key", "data-key"]) {
              const value = current.getAttribute(name);
              if (value) return value;
            }
          }
          return "";
        };

        const extractFormula = (node) => {
          if (!(node instanceof Element)) return null;
          const annotation = node.matches("annotation[encoding='application/x-tex' i]")
            ? node
            : node.querySelector("annotation[encoding='application/x-tex' i], annotation[encoding='application/tex' i]");
          if (annotation?.textContent?.trim()) {
            return { format: "tex", latex: normalizeFormulaSource(annotation.textContent) };
          }

          const script = node.matches("script[type^='math/tex' i]")
            ? node
            : node.querySelector("script[type^='math/tex' i]");
          if (script?.textContent?.trim()) {
            return { format: "tex", latex: normalizeFormulaSource(script.textContent) };
          }

          for (const name of ["data-latex", "data-tex", "data-formula", "data-expression", "data-math"]) {
            const value = node.getAttribute(name) || node.closest(`[${name}]`)?.getAttribute(name);
            if (value?.trim()) return { format: "tex", latex: normalizeFormulaSource(value) };
          }

          const math = node.matches("math") ? node : node.querySelector("math");
          if (math) return { format: "mathml", mathml: math.outerHTML };

          const label = node.getAttribute("data-math") || node.getAttribute("alt") || node.getAttribute("aria-label") || node.getAttribute("title") || "";
          const cleanedLabel = label.replace(/^Image of\s+/i, "").replace(/^Math formula:\s*/i, "").trim();
          if (cleanedLabel && (/\\[A-Za-z]+|[_^{}]|[=∑∏√πθΘΓΨℓσ]/.test(cleanedLabel))) {
            return { format: "tex", latex: normalizeFormulaSource(cleanedLabel) };
          }
          return null;
        };

        const addFormula = (node) => {
          const formula = extractFormula(node);
          if (!formula || (!(formula.latex || "").trim() && !(formula.mathml || "").trim())) return;
          let owner = node;
          if (node.matches("annotation, script")) {
            owner = node.closest(".katex, mjx-container, [data-testid*='latex' i], [data-testid*='math' i], [class*='latex' i], [class*='equation' i]") || node.parentElement || node;
          } else if (node.closest(".katex")) {
            owner = node.closest(".katex");
          } else if (node.closest("mjx-container")) {
            owner = node.closest("mjx-container");
          }
          const rect = owner.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) return;
          const top = absoluteTop(owner);
          const bottom = absoluteBottom(owner);
          const source = formula.latex || formula.mathml;
          const key = `${formula.format}:${source}`;
          const anchors = nearestAnchors(top, bottom, visibleTextAnchors());
          const value = {
            ...formula,
            top,
            bottom,
            display: true,
            entityReference: formulaReference(owner),
            contextHint: `${owner.id || ""} ${typeof owner.className === "string" ? owner.className : ""} ${owner.getAttribute("data-testid") || ""}`.trim().slice(0, 260),
            ...anchors
          };
          const previous = formulaMap.get(key);
          if (!previous || (value.entityReference && !previous.entityReference)) formulaMap.set(key, value);
        };

        const collect = () => {
          capture.scans += 1;
          for (const image of article.querySelectorAll("img")) {
            addMedia({
              node: image,
              src: bestImageSource(image),
              alt: image.alt || "",
              contextHint: image.closest("figure, [role='group'], div")?.getAttribute("data-testid") || ""
            });
          }
          for (const node of article.querySelectorAll("[role='img'], [style*='background-image']")) {
            if (node instanceof HTMLImageElement) continue;
            const match = String(getComputedStyle(node).backgroundImage || "").match(/url\(["']?([^"')]+)["']?\)/i);
            if (match) addMedia({ node, src: match[1], alt: node.getAttribute("aria-label") || "" });
          }
          for (const video of article.querySelectorAll("video[poster], [data-testid='videoPlayer'] video")) {
            const owner = video.closest("[data-testid='videoPlayer'], [data-testid='videoComponent']") || video;
            const statusLink = owner.closest("article")?.querySelector("a[href*='/status/']")?.href;
            addMedia({ node: owner, src: video.poster, mediaType: "video", sourceUrl: statusLink });
          }

          const formulaNodes = article.querySelectorAll([
            "annotation[encoding='application/x-tex' i]",
            "annotation[encoding='application/tex' i]",
            "script[type^='math/tex' i]",
            "math",
            ".katex",
            "mjx-container",
            "[data-latex]", "[data-tex]", "[data-formula]", "[data-expression]", "[data-math]",
            "[data-testid*='latex' i]", "[data-testid*='equation' i]",
            "[class*='latex' i]", "[class*='equation' i]",
            "svg[aria-label]", "[role='img'][aria-label]",
            "img[alt*='formula' i]", "img[alt*='equation' i]"
          ].join(","));
          for (const node of formulaNodes) addFormula(node);

          const codeNodes = article.querySelectorAll([
            "pre", ".public-DraftStyleDefault-pre", "[data-code-block]",
            "[data-block-type='code-block']", "[data-block-type='code']",
            "[class*='code-block']", "[class*='CodeBlock']"
          ].join(","));
          for (const node of codeNodes) {
            const text = String(node.innerText || node.textContent || "").replace(/\r\n?/g, "\n").trim();
            if (text.length < 4) continue;
            const top = absoluteTop(node);
            const bottom = absoluteBottom(node);
            const key = `${Math.round(top)}:${text.slice(0, 200)}`;
            const language = node.getAttribute("data-language") || String(node.className || "").match(/(?:language|lang)[-_]([A-Za-z0-9+#.-]+)/i)?.[1];
            codeMap.set(key, { text, top, bottom, language });
          }

          capture.media = Array.from(mediaMap.values()).sort((a, b) => a.top - b.top);
          capture.codes = Array.from(codeMap.values()).sort((a, b) => a.top - b.top);
          capture.formulas = Array.from(formulaMap.values()).sort((a, b) => a.top - b.top);
        };

        for (const image of document.querySelectorAll("img[loading='lazy']")) {
          image.loading = "eager";
          try { image.fetchPriority = "high"; } catch {}
        }

        collect();
        let lastHeight = 0;
        let stableRounds = 0;
        for (let pass = 0; pass < 3 && stableRounds < 2; pass += 1) {
          const targetHeight = Math.min(Math.max(document.documentElement.scrollHeight, article.scrollHeight || 0), 160000);
          const step = Math.max(620, Math.floor(window.innerHeight * 0.72));
          for (let y = 0; y <= targetHeight; y += step) {
            window.scrollTo(0, y);
            await sleep(90);
            collect();
          }
          await sleep(250);
          collect();
          const currentHeight = document.documentElement.scrollHeight;
          if (Math.abs(currentHeight - lastHeight) < 80) stableRounds += 1;
          else stableRounds = 0;
          lastHeight = currentHeight;
        }
        window.scrollTo(0, startY);
        await sleep(350);
        collect();
      }
    });
  } catch {
    // Rolling capture is best effort; extraction retries still run.
  }
}

async function runExtractorWithRetry(tabId, attempts, interval = 550) {
  let lastResult = null;
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        files: ["extractor.js"]
      });
      lastResult = results?.[0]?.result;
      if (lastResult?.kind === "document" || lastResult?.kind === "redirect" || lastResult?.kind === "error") {
        return lastResult;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(interval);
  }

  if (lastResult) {
    return lastResult;
  }
  throw lastError || new Error("无法读取当前 X 页面。");
}

async function showError(message, tabId) {
  await chrome.storage.session.set({
    pendingXDocument: null,
    exportError: message
  });

  if (tabId) {
    await setBadge(tabId, "!", "#cf222e");
  }

  await chrome.tabs.create({
    url: chrome.runtime.getURL("preview.html")
  });
}

async function setBadge(tabId, text, color) {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text }),
    chrome.action.setBadgeBackgroundColor({ tabId, color })
  ]);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "EXPORT_PDF") {
    (async () => {
      const tabId = sender.tab?.id || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      return exportPreviewTabToPdf(tabId, message);
    })()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return true;
  }

  if (message?.type === "FETCH_MEDIA") {
    fetchMediaAsDataUrl(message.url)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return true;
  }

  return undefined;
});

const mediaCache = new Map();
let mediaCacheBytes = 0;
const MAX_MEDIA_CACHE_BYTES = 48 * 1024 * 1024;

async function fetchMediaAsDataUrl(value) {
  const url = normalizeAllowedMediaUrl(value);
  if (!url) throw new Error("不支持的媒体地址。");
  const key = url.href;
  if (mediaCache.has(key)) return mediaCache.get(key).dataUrl;

  const response = await fetch(key, {
    credentials: "omit",
    cache: "force-cache",
    referrerPolicy: "no-referrer"
  });
  if (!response.ok) throw new Error(`图片下载失败：${response.status}`);
  const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("返回内容不是图片。");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 18 * 1024 * 1024) throw new Error("单张图片超过 18 MB。");
  const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;

  if (mediaCacheBytes + buffer.byteLength > MAX_MEDIA_CACHE_BYTES) {
    mediaCache.clear();
    mediaCacheBytes = 0;
  }
  mediaCache.set(key, { dataUrl, bytes: buffer.byteLength });
  mediaCacheBytes += buffer.byteLength;
  return dataUrl;
}

function normalizeAllowedMediaUrl(value) {
  try {
    const url = new URL(value || "");
    if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com") return null;
    if (!["/media/", "/amplify_video_thumb/", "/ext_tw_video_thumb/", "/tweet_video_thumb/"]
      .some((prefix) => url.pathname.startsWith(prefix))) return null;
    if (url.pathname.startsWith("/media/")) url.searchParams.set("name", "large");
    return url;
  } catch {
    return null;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + size)));
  }
  return btoa(chunks.join(""));
}

async function exportPreviewTabToPdf(tabId, options = {}) {
  if (!tabId) throw new Error("无法确定 PDF 预览标签页。");
  const debuggee = { tabId };
  let attached = false;

  try {
    await chrome.debugger.attach(debuggee, "1.3");
    attached = true;
    await chrome.debugger.sendCommand(debuggee, "Page.enable");
    await chrome.debugger.sendCommand(debuggee, "Emulation.setEmulatedMedia", { media: "print" });

    const pageSize = options.pageSize === "Letter" ? "Letter" : "A4";
    const dimensions = pageSize === "Letter"
      ? { paperWidth: 8.5, paperHeight: 11 }
      : { paperWidth: 8.2677165354, paperHeight: 11.6929133858 };

    const result = await chrome.debugger.sendCommand(debuggee, "Page.printToPDF", {
      ...dimensions,
      landscape: false,
      displayHeaderFooter: false,
      printBackground: true,
      preferCSSPageSize: true,
      generateTaggedPDF: true,
      generateDocumentOutline: true,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0
    });

    if (!result?.data) throw new Error("Chrome 没有返回 PDF 数据。");
    const filename = sanitizeFilename(options.filename || "X 长文") + ".pdf";
    const downloadId = await chrome.downloads.download({
      url: `data:application/pdf;base64,${result.data}`,
      filename,
      saveAs: false,
      conflictAction: "uniquify"
    });
    return { downloadId, filename };
  } finally {
    if (attached) {
      await chrome.debugger.sendCommand(debuggee, "Emulation.setEmulatedMedia", { media: "screen" }).catch(() => {});
      await chrome.debugger.detach(debuggee).catch(() => {});
    }
  }
}

function sanitizeFilename(value) {
  const text = String(value || "X 长文")
    .replace(/[\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 140);
  return text || "X 长文";
}

function isUsefulTitleHint(hint, currentTitle) {
  const value = String(hint || "").trim();
  if (value.length < 8 || value.length > 280) return false;
  if (/^(Article|Long post|Read more|Show more)$/i.test(value)) return false;
  const current = String(currentTitle || "").trim();
  return !current || current.length < 12 || value.length >= current.length + 8;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
