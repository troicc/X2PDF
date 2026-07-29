const t = (key, vars = {}) => globalThis.XPDFI18n?.t(key, vars) ?? key;

const elements = {
  document: document.getElementById("document"),
  emptyState: document.getElementById("emptyState"),
  errorMessage: document.getElementById("errorMessage"),
  title: document.getElementById("documentTitle"),
  metadata: document.getElementById("metadata"),
  coverImage: document.getElementById("coverImage"),
  content: document.getElementById("content"),
  sourceFooter: document.getElementById("sourceFooter"),
  sourceLink: document.getElementById("sourceLink"),
  capturedAt: document.getElementById("capturedAt"),
  pageSize: document.getElementById("pageSize"),
  fontFamily: document.getElementById("fontFamily"),
  fontSize: document.getElementById("fontSize"),
  codeTheme: document.getElementById("codeTheme"),
  includeImages: document.getElementById("includeImages"),
  includeEmbeds: document.getElementById("includeEmbeds"),
  includeSource: document.getElementById("includeSource"),
  wrapCode: document.getElementById("wrapCode"),
  printButton: document.getElementById("printButton"),
  diagnosticsButton: document.getElementById("diagnosticsButton"),
  exportStatus: document.getElementById("exportStatus"),
  qualityBanner: document.getElementById("qualityBanner"),
  pageRule: document.getElementById("pageRule")
};

const PREFERENCES_KEY = "xpdfPreviewPreferencesV07";
const DEFAULT_PREFERENCES = Object.freeze({
  pageSize: "A4",
  fontFamily: "x-native",
  fontSize: "11.2",
  codeTheme: "x-light",
  includeImages: true,
  includeEmbeds: true,
  includeSource: true,
  wrapCode: true
});

let currentDocument = null;
let originalDocumentTitle = document.title;
let preferenceSaveTimer = null;
let renderingDiagnostics = {
  syntaxHighlighting: { total: 0, highlighted: 0, languages: {} },
  formulas: { total: 0, rendered: 0, failed: 0, formats: {} },
  font: { preset: DEFAULT_PREFERENCES.fontFamily, chirpLoaded: null }
};
let formulaTypesetQueue = Promise.resolve();

initialize().catch((error) => {
  showError(error instanceof Error ? error.message : String(error));
});

async function initialize() {
  const { pendingXDocument, exportError } = await chrome.storage.session.get([
    "pendingXDocument",
    "exportError"
  ]);

  if (exportError || !pendingXDocument) {
    showError(exportError || t("emptyMessage"));
    return;
  }

  currentDocument = pendingXDocument;
  renderDocument(pendingXDocument);
  renderQualityStatus(pendingXDocument);
  bindControls();
  await restorePreferences();
  applyCodeHighlighting();

  elements.printButton.disabled = true;
  if (elements.exportStatus) elements.exportStatus.textContent = t("caching");
  await Promise.all([hydrateRemoteMedia(), ensureSelectedFonts(), typesetFormulas()]);
  elements.printButton.disabled = false;
  if (elements.exportStatus) elements.exportStatus.textContent = readyStatusMessage();
}

function renderQualityStatus(doc) {
  if (!elements.qualityBanner) return;
  const diagnostics = doc?.diagnostics || {};
  const acquisition = diagnostics.acquisition || {};
  const titleInfo = diagnostics.title || {};
  const completeness = diagnostics.completeness || {};
  const output = diagnostics.output || diagnostics.blockCounts || {};
  const entities = diagnostics.entities || {};
  const messages = [];
  let level = "ok";

  if (acquisition.method === "captured-response" && titleInfo.verified === true) {
    messages.push(t("structuredReady"));
    messages.push(t("outputSummary", { heading: output.heading || 0, quote: output.blockquote || 0, code: output.code || 0, formula: output.formula || 0, image: output.image || 0 }));
    if (entities.markdown != null || entities.formula != null) {
      messages.push(t("entitySummary", { markdown: entities.markdown || 0, formula: entities.formula || 0 }));
    }
  } else {
    level = "warning";
    messages.push(t("domFallback"));
  }

  const gaps = Array.isArray(completeness.suspectedContentGaps) ? completeness.suspectedContentGaps : [];
  if (completeness.status === "warning" || gaps.length) {
    level = "warning";
    messages.push(t("gaps", { count: gaps.length || 1 }));
  }
  const unresolved = Array.isArray(diagnostics.unresolvedMedia) ? diagnostics.unresolvedMedia.length : 0;
  if (unresolved) {
    level = "warning";
    messages.push(t("unresolvedMedia", { count: unresolved }));
  }
  const unresolvedFormulas = Array.isArray(diagnostics.unresolvedFormulas) ? diagnostics.unresolvedFormulas.length : 0;
  if (unresolvedFormulas) {
    level = "warning";
    messages.push(t("unresolvedFormulas", { count: unresolvedFormulas }));
  }

  elements.qualityBanner.hidden = false;
  elements.qualityBanner.className = `quality-banner${level === "warning" ? " warning" : ""}`;
  elements.qualityBanner.textContent = messages.join(" ");
}

function renderDocument(doc) {
  elements.emptyState.hidden = true;
  elements.document.hidden = false;
  elements.document.classList.add("font-x-native");
  elements.document.dataset.codeTheme = "x-light";

  const cleanTitle = doc.metadata?.title || t("defaultTitle");
  elements.title.textContent = cleanTitle;
  originalDocumentTitle = `${cleanTitle} - ${t("previewSuffix")}`;
  document.title = originalDocumentTitle;

  renderMetadata(doc.metadata || {});
  renderCover(doc.metadata?.coverImage);
  renderBlocks(Array.isArray(doc.blocks) ? doc.blocks : []);
  renderSource(doc.source || {});
}

function renderMetadata(metadata) {
  elements.metadata.replaceChildren();

  if (metadata.authorName && metadata.authorName !== `@${metadata.authorHandle || ""}`) {
    elements.metadata.append(createMetaSpan(metadata.authorName));
  }
  if (metadata.authorHandle) {
    elements.metadata.append(createMetaSpan(`@${String(metadata.authorHandle).replace(/^@/, "")}`));
  }
  if (metadata.publishedAt) {
    const date = new Date(metadata.publishedAt);
    if (!Number.isNaN(date.getTime())) {
      elements.metadata.append(createMetaSpan(new Intl.DateTimeFormat(globalThis.XPDFI18n?.locale === "zh" ? "zh-CN" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date)));
    }
  }
}

function createMetaSpan(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function renderCover(src) {
  if (!isSafeXMediaUrl(src)) {
    elements.coverImage.hidden = true;
    return;
  }

  elements.coverImage.dataset.remoteSrc = src;
  elements.coverImage.src = src;
  elements.coverImage.hidden = false;
}

function renderBlocks(blocks) {
  elements.content.replaceChildren();
  for (const block of blocks) {
    const node = renderBlock(block);
    if (node) elements.content.append(node);
  }
}

function renderBlock(block) {
  switch (block?.type) {
    case "heading": {
      const level = Math.min(Math.max(Number(block.level) || 2, 2), 4);
      const heading = document.createElement(`h${level}`);
      applyBlockLayout(heading, block);
      setSafeInlineHtml(heading, block.html || "");
      return heading.textContent?.trim() ? heading : null;
    }

    case "paragraph": {
      const paragraph = document.createElement("p");
      applyBlockLayout(paragraph, block);
      setSafeInlineHtml(paragraph, block.html || "");
      return paragraph.textContent?.trim() ? paragraph : null;
    }

    case "blockquote": {
      const quote = document.createElement("blockquote");
      applyBlockLayout(quote, block);
      const paragraphs = Array.isArray(block.paragraphs)
        ? block.paragraphs
        : block.html ? [block.html] : [];
      for (const html of paragraphs) {
        const paragraph = document.createElement("p");
        setSafeInlineHtml(paragraph, html);
        if (paragraph.textContent?.trim()) quote.append(paragraph);
      }
      if (block.cite) {
        const cite = document.createElement("cite");
        cite.textContent = block.cite;
        quote.append(cite);
      }
      return quote.childElementCount ? quote : null;
    }

    case "list":
      return renderList(block);

    case "image":
      return renderImageFigure(block);

    case "media":
      return renderMedia(block);

    case "embedded_post":
      return renderEmbeddedPost(block);

    case "link_card":
      return renderLinkCard(block);

    case "poll":
      return renderPoll(block);

    case "table":
      return renderTable(block);

    case "formula": {
      const figure = document.createElement("figure");
      figure.className = "formula-block";
      const target = document.createElement("div");
      target.className = "formula-render-target";
      target.__xpdfFormula = {
        latex: typeof block.latex === "string" ? block.latex.trim() : "",
        mathml: typeof block.mathml === "string" ? block.mathml.trim() : "",
        display: block.display !== false
      };
      const fallback = document.createElement("code");
      fallback.className = "formula-source-fallback";
      fallback.textContent = target.__xpdfFormula.latex || stripMathMlText(target.__xpdfFormula.mathml) || t("formulaUnavailable");
      target.append(fallback);

      if (target.__xpdfFormula.latex) {
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "formula-copy-button";
        copyButton.dataset.screenOnly = "true";
        copyButton.textContent = t("copyLatex");
        copyButton.addEventListener("click", () => copyFormulaLatex(target, copyButton));
        figure.append(copyButton);
      }

      figure.append(target);
      return target.__xpdfFormula.latex || target.__xpdfFormula.mathml ? figure : null;
    }

    case "code": {
      const rawCode = typeof block.text === "string" ? block.text : "";
      const wrapper = document.createElement("figure");
      wrapper.className = `code-block${Number(block.lineCount) > 30 ? " long-code" : ""}`;
      wrapper.dataset.language = String(block.language || "").trim();

      const toolbar = document.createElement("figcaption");
      toolbar.className = "code-block-toolbar";

      const languageLabel = document.createElement("span");
      languageLabel.className = "code-language-label";
      languageLabel.dataset.language = String(block.language || "").trim();
      languageLabel.textContent = block.language || t("code");
      toolbar.append(languageLabel);

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "code-copy-button";
      copyButton.dataset.screenOnly = "true";
      copyButton.textContent = t("copy");
      copyButton.title = t("copyFullCode");
      copyButton.setAttribute("aria-label", t("copyCodeAria", { language: block.language ? ` ${block.language}` : "" }));
      copyButton.addEventListener("click", () => copyCodeText(rawCode, copyButton));
      toolbar.append(copyButton);
      wrapper.append(toolbar);

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = rawCode;
      code.dataset.rawCode = rawCode;
      pre.append(code);
      wrapper.append(pre);
      return code.textContent.trim() ? wrapper : null;
    }

    case "separator":
      return document.createElement("hr");

    default:
      return null;
  }
}

function applyBlockLayout(node, block) {
  const indent = Math.min(Math.max(Number(block.indent) || 0, 0), 4);
  if (indent) node.dataset.indent = String(indent);
  if (["left", "center", "right", "justify"].includes(block.align)) {
    node.style.textAlign = block.align;
  }
}

function renderList(block) {
  const list = document.createElement(block.ordered ? "ol" : "ul");
  if (block.ordered && Number(block.start) > 1) list.start = Number(block.start);

  for (const itemData of Array.isArray(block.items) ? block.items : []) {
    const item = document.createElement("li");
    const body = document.createElement("div");
    body.className = "list-item-body";
    setSafeInlineHtml(body, typeof itemData === "string" ? itemData : itemData?.html || "");
    if (body.textContent?.trim()) item.append(body);

    for (const child of Array.isArray(itemData?.children) ? itemData.children : []) {
      const nested = renderList(child);
      if (nested) item.append(nested);
    }
    if (item.childElementCount) list.append(item);
  }
  return list.childElementCount ? list : null;
}

function renderImageFigure(block, className = "") {
  if (!isSafeXMediaUrl(block.src)) return null;
  const figure = document.createElement("figure");
  figure.className = className;
  const image = document.createElement("img");
  image.dataset.remoteSrc = block.src;
  image.src = block.src;
  image.alt = block.alt || "";
  image.loading = "eager";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  if (block.width) image.width = Number(block.width);
  if (block.height) image.height = Number(block.height);
  figure.append(image);

  if (block.caption) {
    const caption = document.createElement("figcaption");
    caption.textContent = block.caption;
    figure.append(caption);
  }
  return figure;
}

function renderMedia(block) {
  if (!isSafeXMediaUrl(block.poster) && !isSafeHttpUrl(block.sourceUrl)) return null;
  const figure = document.createElement("figure");
  figure.className = "media-block embed-block";

  if (isSafeXMediaUrl(block.poster)) {
    const image = document.createElement("img");
    image.dataset.remoteSrc = block.poster;
    image.src = block.poster;
    image.alt = block.caption || block.mediaType || t("media");
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove(), { once: true });
    figure.append(image);
  }

  const badge = document.createElement("span");
  badge.className = "media-badge";
  badge.textContent = block.mediaType === "gif" ? "GIF" : "VIDEO";
  figure.append(badge);

  if (isSafeHttpUrl(block.sourceUrl)) {
    const link = document.createElement("a");
    link.className = "media-link";
    link.href = block.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = block.mediaType === "gif" ? t("viewGif") : t("viewVideo");
    figure.append(link);
  }
  return figure;
}

function renderEmbeddedPost(block) {
  const card = document.createElement("aside");
  card.className = "embedded-post embed-block";

  const header = document.createElement("div");
  header.className = "embedded-post-header";
  const author = [block.authorName, block.authorHandle ? `@${String(block.authorHandle).replace(/^@/, "")}` : ""]
    .filter(Boolean).join("  ");
  header.textContent = author || "X Post";
  card.append(header);

  const body = document.createElement("div");
  body.className = "embedded-post-body";
  setSafeInlineHtml(body, block.html || "");
  if (body.textContent?.trim()) card.append(body);

  if (Array.isArray(block.images) && block.images.length) {
    const gallery = document.createElement("div");
    gallery.className = `embedded-gallery count-${Math.min(block.images.length, 4)}`;
    for (const imageBlock of block.images.slice(0, 4)) {
      if (!isSafeXMediaUrl(imageBlock.src)) continue;
      const image = document.createElement("img");
      image.dataset.remoteSrc = imageBlock.src;
      image.src = imageBlock.src;
      image.alt = imageBlock.alt || "";
      image.referrerPolicy = "no-referrer";
      gallery.append(image);
    }
    if (gallery.childElementCount) card.append(gallery);
  }

  if (isSafeHttpUrl(block.sourceUrl)) {
    const link = document.createElement("a");
    link.className = "view-on-x";
    link.href = block.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = t("viewPost");
    card.append(link);
  }
  return card;
}

function renderLinkCard(block) {
  if (!isSafeHttpUrl(block.url)) return null;
  const link = document.createElement("a");
  link.className = "link-card embed-block";
  link.href = block.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  if (isSafeXMediaUrl(block.image)) {
    const image = document.createElement("img");
    image.dataset.remoteSrc = block.image;
    image.src = block.image;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    link.append(image);
  }

  const text = document.createElement("span");
  text.className = "link-card-text";
  const title = document.createElement("strong");
  title.textContent = block.title || block.url;
  text.append(title);
  if (block.description) {
    const description = document.createElement("span");
    description.textContent = block.description;
    text.append(description);
  }
  const host = document.createElement("small");
  host.textContent = block.hostname || new URL(block.url).hostname;
  text.append(host);
  link.append(text);
  return link;
}

function renderPoll(block) {
  const box = document.createElement("section");
  box.className = "poll-block embed-block";
  const title = document.createElement("strong");
  title.textContent = t("poll");
  box.append(title);
  const list = document.createElement("ul");
  for (const option of Array.isArray(block.options) ? block.options : []) {
    const item = document.createElement("li");
    item.textContent = option;
    list.append(item);
  }
  box.append(list);
  return list.childElementCount ? box : null;
}

function renderTable(block) {
  const wrapper = document.createElement("div");
  wrapper.className = "table-wrapper";
  const table = document.createElement("table");
  const rows = Array.isArray(block.rows) ? block.rows : [];
  const firstIsHeader = rows[0]?.length && rows[0].every((cell) => cell?.header);
  const head = firstIsHeader ? document.createElement("thead") : null;
  const body = document.createElement("tbody");

  rows.forEach((rowData, rowIndex) => {
    const row = document.createElement("tr");
    for (const cellData of Array.isArray(rowData) ? rowData : []) {
      const cell = document.createElement(cellData?.header ? "th" : "td");
      setSafeInlineHtml(cell, cellData?.html || "");
      if (cellData?.colspan) cell.colSpan = Number(cellData.colspan);
      if (cellData?.rowspan) cell.rowSpan = Number(cellData.rowspan);
      row.append(cell);
    }
    if (row.childElementCount) (firstIsHeader && rowIndex === 0 ? head : body).append(row);
  });

  if (head?.childElementCount) table.append(head);
  table.append(body);
  if (!table.querySelector("tr")) return null;
  wrapper.append(table);
  return wrapper;
}

function renderSource(source) {
  if (isSafeHttpUrl(source.url)) {
    elements.sourceLink.href = source.url;
    elements.sourceLink.textContent = source.url;
  } else {
    elements.sourceLink.removeAttribute("href");
    elements.sourceLink.textContent = "";
  }

  if (source.capturedAt) {
    const date = new Date(source.capturedAt);
    if (!Number.isNaN(date.getTime())) {
      elements.capturedAt.textContent = t("capturedAt", { date: new Intl.DateTimeFormat(globalThis.XPDFI18n?.locale === "zh" ? "zh-CN" : "en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date) });
    }
  }
}

function bindControls() {
  elements.pageSize.addEventListener("change", () => {
    updatePageSize();
    schedulePreferenceSave();
  });
  elements.fontFamily.addEventListener("change", async () => {
    applyFontFamily(elements.fontFamily.value);
    schedulePreferenceSave();
    if (elements.exportStatus) elements.exportStatus.textContent = t("loadingFont");
    await ensureSelectedFonts();
    if (elements.exportStatus) elements.exportStatus.textContent = readyStatusMessage();
  });
  elements.fontSize.addEventListener("change", () => {
    document.documentElement.style.setProperty("--reading-font-size", `${elements.fontSize.value}pt`);
    schedulePreferenceSave();
  });
  elements.codeTheme.addEventListener("change", () => {
    applyCodeTheme(elements.codeTheme.value);
    schedulePreferenceSave();
  });
  elements.includeImages.addEventListener("change", () => {
    elements.document.classList.toggle("hide-images", !elements.includeImages.checked);
    schedulePreferenceSave();
  });
  elements.includeEmbeds.addEventListener("change", () => {
    elements.document.classList.toggle("hide-embeds", !elements.includeEmbeds.checked);
    schedulePreferenceSave();
  });
  elements.includeSource.addEventListener("change", () => {
    elements.document.classList.toggle("hide-source", !elements.includeSource.checked);
    schedulePreferenceSave();
  });
  elements.wrapCode.addEventListener("change", () => {
    elements.document.classList.toggle("nowrap-code", !elements.wrapCode.checked);
    schedulePreferenceSave();
  });
  elements.printButton.addEventListener("click", printDocument);
  elements.diagnosticsButton?.addEventListener("click", copyDiagnostics);
}

async function restorePreferences() {
  let stored = {};
  try {
    stored = (await chrome.storage.local.get(PREFERENCES_KEY))[PREFERENCES_KEY] || {};
  } catch {
    stored = {};
  }
  const preferences = { ...DEFAULT_PREFERENCES, ...stored };

  elements.pageSize.value = preferences.pageSize === "Letter" ? "Letter" : "A4";
  elements.fontFamily.value = ["x-native", "serif", "system"].includes(preferences.fontFamily)
    ? preferences.fontFamily
    : DEFAULT_PREFERENCES.fontFamily;
  elements.fontSize.value = ["10.4", "11.2", "12.0"].includes(String(preferences.fontSize))
    ? String(preferences.fontSize)
    : DEFAULT_PREFERENCES.fontSize;
  elements.codeTheme.value = ["x-light", "github-light", "one-dark", "plain"].includes(preferences.codeTheme)
    ? preferences.codeTheme
    : DEFAULT_PREFERENCES.codeTheme;
  elements.includeImages.checked = preferences.includeImages !== false;
  elements.includeEmbeds.checked = preferences.includeEmbeds !== false;
  elements.includeSource.checked = preferences.includeSource !== false;
  elements.wrapCode.checked = preferences.wrapCode !== false;

  updatePageSize();
  applyFontFamily(elements.fontFamily.value);
  document.documentElement.style.setProperty("--reading-font-size", `${elements.fontSize.value}pt`);
  applyCodeTheme(elements.codeTheme.value);
  elements.document.classList.toggle("hide-images", !elements.includeImages.checked);
  elements.document.classList.toggle("hide-embeds", !elements.includeEmbeds.checked);
  elements.document.classList.toggle("hide-source", !elements.includeSource.checked);
  elements.document.classList.toggle("nowrap-code", !elements.wrapCode.checked);
}

function currentPreferences() {
  return {
    pageSize: elements.pageSize.value === "Letter" ? "Letter" : "A4",
    fontFamily: elements.fontFamily.value,
    fontSize: elements.fontSize.value,
    codeTheme: elements.codeTheme.value,
    includeImages: elements.includeImages.checked,
    includeEmbeds: elements.includeEmbeds.checked,
    includeSource: elements.includeSource.checked,
    wrapCode: elements.wrapCode.checked
  };
}

function schedulePreferenceSave() {
  clearTimeout(preferenceSaveTimer);
  preferenceSaveTimer = setTimeout(() => {
    chrome.storage.local.set({ [PREFERENCES_KEY]: currentPreferences() }).catch(() => {});
  }, 160);
}

function applyFontFamily(value) {
  const preset = ["x-native", "serif", "system"].includes(value) ? value : "x-native";
  elements.document.classList.remove("font-x-native", "font-serif", "font-system");
  elements.document.classList.add(`font-${preset}`);
  renderingDiagnostics.font.preset = preset;
  if (preset !== "x-native") renderingDiagnostics.font.chirpLoaded = null;
}

function applyCodeTheme(value) {
  const theme = ["x-light", "github-light", "one-dark", "plain"].includes(value) ? value : "x-light";
  elements.document.dataset.codeTheme = theme;
}

function applyCodeHighlighting() {
  if (!globalThis.XPDFCodeHighlight) return;
  renderingDiagnostics.syntaxHighlighting = globalThis.XPDFCodeHighlight.highlightAll(elements.content);
}


function typesetFormulas(options = {}) {
  const force = options.force === true;
  formulaTypesetQueue = formulaTypesetQueue.then(async () => {
    const targets = Array.from(elements.content.querySelectorAll(".formula-render-target"));
    const diagnostics = {
      total: targets.length,
      rendered: 0,
      failed: 0,
      formats: {},
      renderers: {},
      selectable: 0,
      nonSelectable: 0,
      svgFallback: 0,
      assistiveLayersRemoved: 0,
      rootRowsNormalized: 0,
      mathErrors: 0,
      nativeMathMLSupported: Boolean(globalThis.XPDFFormulaRenderer?.supportsNativeMathML?.())
    };
    if (!targets.length) {
      renderingDiagnostics.formulas = diagnostics;
      return diagnostics;
    }

    if (!globalThis.XPDFFormulaRenderer?.render) {
      for (const target of targets) markFormulaFailure(target, t("formulaRendererMissing"));
      diagnostics.failed = targets.length;
      renderingDiagnostics.formulas = diagnostics;
      return diagnostics;
    }

    for (const target of targets) {
      const formula = target.__xpdfFormula || {};
      const source = formula.mathml || formula.latex || "";
      const format = formula.mathml ? "mathml" : "tex";
      diagnostics.formats[format] = (diagnostics.formats[format] || 0) + 1;
      if (!source) {
        diagnostics.failed += 1;
        markFormulaFailure(target, t("formulaEmpty"));
        continue;
      }
      if (!force && target.dataset.formulaRendered === "true") {
        diagnostics.rendered += 1;
        const renderer = target.dataset.formulaRenderer || "unknown";
        diagnostics.renderers[renderer] = (diagnostics.renderers[renderer] || 0) + 1;
        if (target.dataset.formulaSelectable === "true") diagnostics.selectable += 1;
        else diagnostics.nonSelectable += 1;
        continue;
      }

      try {
        const result = await globalThis.XPDFFormulaRenderer.render(target, formula, {
          allowSvgFallback: true
        });
        const renderer = result.renderer || "unknown";
        diagnostics.renderers[renderer] = (diagnostics.renderers[renderer] || 0) + 1;
        diagnostics.assistiveLayersRemoved += Number(result.assistiveLayersRemoved) || 0;
        diagnostics.rootRowsNormalized += Number(result.rootRowsNormalized) || 0;
        if (renderer === "svg-fallback") diagnostics.svgFallback += 1;
        if (result.selectable) diagnostics.selectable += 1;
        else diagnostics.nonSelectable += 1;

        target.setAttribute("aria-label", formula.latex || stripMathMlText(formula.mathml) || t("mathFormula"));
        target.dataset.formulaRendered = "true";
        target.classList.remove("formula-render-failed");
        target.removeAttribute("title");
        diagnostics.rendered += 1;
      } catch (error) {
        diagnostics.failed += 1;
        diagnostics.mathErrors += 1;
        markFormulaFailure(target, error instanceof Error ? error.message : String(error));
      }
    }
    renderingDiagnostics.formulas = diagnostics;
    updateFormulaExportStatus(diagnostics);
    return diagnostics;
  }).catch((error) => {
    renderingDiagnostics.formulas = {
      total: elements.content.querySelectorAll(".formula-render-target").length,
      rendered: 0,
      failed: elements.content.querySelectorAll(".formula-render-target").length,
      formats: {},
      renderers: {},
      selectable: 0,
      nonSelectable: 0,
      svgFallback: 0,
      rootRowsNormalized: 0,
      error: error instanceof Error ? error.message : String(error)
    };
    return renderingDiagnostics.formulas;
  });
  return formulaTypesetQueue;
}

function updateFormulaExportStatus(diagnostics) {
  if (!elements.exportStatus || !diagnostics?.total) return;
  if (diagnostics.failed) {
    elements.exportStatus.textContent = t("formulaFailures", { count: diagnostics.failed });
    return;
  }
  if (diagnostics.nonSelectable) {
    elements.exportStatus.textContent = t("formulaSelectableMixed", { selectable: diagnostics.selectable, total: diagnostics.total, nonSelectable: diagnostics.nonSelectable });
    return;
  }
  elements.exportStatus.textContent = t("formulaSelectableAll", { total: diagnostics.total });
}

async function copyFormulaLatex(target, button) {
  const latex = target?.__xpdfFormula?.latex || "";
  if (!latex) return;
  await copyTextWithButtonFeedback(latex, button, t("copyLatex"));
}

async function copyCodeText(rawCode, button) {
  if (typeof rawCode !== "string" || !rawCode) return;
  await copyTextWithButtonFeedback(rawCode, button, t("copy"));
}

async function copyTextWithButtonFeedback(text, button, idleLabel) {
  const original = button?.textContent || idleLabel;
  if (button) {
    button.disabled = true;
    button.classList.remove("copy-success", "copy-error");
  }

  let copied = false;
  try {
    copied = Boolean(await globalThis.XPDFClipboard?.copyText?.(text));
  } catch {
    copied = false;
  }

  if (button) {
    button.textContent = copied ? t("copied") : t("copyFailed");
    button.classList.add(copied ? "copy-success" : "copy-error");
    button.setAttribute("aria-live", "polite");
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
      button.classList.remove("copy-success", "copy-error");
    }, 1400);
  }
  return copied;
}

function markFormulaFailure(target, message) {
  const formula = target.__xpdfFormula || {};
  const fallback = document.createElement("code");
  fallback.className = "formula-source-fallback";
  fallback.textContent = formula.latex || stripMathMlText(formula.mathml) || t("formulaUnavailable");
  target.replaceChildren(fallback);
  target.classList.add("formula-render-failed");
  target.dataset.formulaRendered = "false";
  target.dataset.formulaSelectable = "true";
  target.dataset.formulaRenderer = "source-fallback";
  target.title = message || t("formulaRenderFailed");
}

function stripMathMlText(mathml) {
  if (!mathml) return "";
  try {
    const doc = new DOMParser().parseFromString(String(mathml), "application/xml");
    return doc.documentElement?.textContent?.replace(/\s+/g, " ").trim() || "";
  } catch {
    return "";
  }
}

async function copyDiagnostics() {
  const data = {
    source: currentDocument?.source,
    metadata: currentDocument?.metadata,
    diagnostics: currentDocument?.diagnostics,
    rendering: {
      ...renderingDiagnostics,
      preferences: currentPreferences()
    },
    blockTypes: (currentDocument?.blocks || []).map((block) => block.type)
  };
  const copied = await copyTextWithButtonFeedback(
    JSON.stringify(data, null, 2),
    elements.diagnosticsButton,
    t("copyDiagnostics")
  );
  if (!copied && elements.diagnosticsButton) {
    elements.diagnosticsButton.title = t("clipboardDenied");
  }
}

async function printDocument() {
  elements.printButton.disabled = true;
  elements.printButton.textContent = t("generatingPdf");
  if (elements.exportStatus) elements.exportStatus.textContent = t("waitingAssets");

  try {
    applyCodeHighlighting();
    await hydrateRemoteMedia();
    await ensureSelectedFonts();
    await typesetFormulas({ force: true });
    await waitForImages();
    document.title = getPrintableTitle();
    if (elements.exportStatus) elements.exportStatus.textContent = t("invokingPdf");

    const response = await chrome.runtime.sendMessage({
      type: "EXPORT_PDF",
      filename: getPrintableTitle(),
      pageSize: elements.pageSize.value === "Letter" ? "Letter" : "A4"
    });

    if (!response?.ok) throw new Error(response?.error || t("pdfFailed"));
    if (elements.exportStatus) elements.exportStatus.textContent = t("downloadStarted", { filename: response.filename || "PDF" });
    elements.printButton.textContent = t("downloaded");
  } catch (error) {
    if (elements.exportStatus) elements.exportStatus.textContent = error instanceof Error ? error.message : String(error);
    elements.printButton.textContent = t("retryDownload");
  } finally {
    document.title = originalDocumentTitle;
    setTimeout(() => {
      elements.printButton.disabled = false;
      if (elements.printButton.textContent === t("downloaded")) elements.printButton.textContent = t("downloadPdf");
    }, 1200);
  }
}

function getPrintableTitle() {
  return (elements.title.textContent || currentDocument?.metadata?.title || t("defaultTitle"))
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function updatePageSize() {
  const pageSize = elements.pageSize.value === "Letter" ? "Letter" : "A4";
  const paperWidth = pageSize === "Letter" ? "215.9mm" : "210mm";
  document.documentElement.style.setProperty("--paper-width", paperWidth);
  elements.pageRule.textContent = `@page { size: ${pageSize}; margin: 16mm 16mm 18mm; }`;
}

let mediaHydrationPromise = null;

async function hydrateRemoteMedia() {
  if (mediaHydrationPromise) return mediaHydrationPromise;
  mediaHydrationPromise = (async () => {
    const images = Array.from(elements.document.querySelectorAll("img[data-remote-src]"));
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, images.length) }, async () => {
      while (cursor < images.length) {
        const image = images[cursor++];
        await hydrateOneImage(image);
      }
    });
    await Promise.all(workers);
  })().finally(() => {
    mediaHydrationPromise = null;
  });
  return mediaHydrationPromise;
}

async function hydrateOneImage(image) {
  if (!(image instanceof HTMLImageElement) || image.dataset.hydrated === "true") return;
  const source = image.dataset.remoteSrc || image.src;
  if (!isSafeXMediaUrl(source)) return;

  try {
    const response = await chrome.runtime.sendMessage({ type: "FETCH_MEDIA", url: source });
    if (!response?.ok || !response.dataUrl) throw new Error(response?.error || t("mediaCacheFailed"));
    image.src = response.dataUrl;
    await decodeImage(image);
    image.dataset.hydrated = "true";
    image.classList.remove("media-load-failed");
  } catch {
    image.src = source;
    try {
      await decodeImage(image, 10000);
      image.dataset.hydrated = "true";
    } catch {
      image.classList.add("media-load-failed");
      image.closest("figure")?.classList.add("media-load-failed");
      if (image === elements.coverImage) image.hidden = true;
    }
  }
}

function decodeImage(image, timeout = 12000) {
  if (image.complete && image.naturalWidth > 0) {
    return typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(t("imageTimeout"))); }, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
    };
    const onLoad = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(t("imageFailed"))); };
    image.addEventListener("load", onLoad, { once: true });
    image.addEventListener("error", onError, { once: true });
  });
}

async function waitForImages() {
  const images = Array.from(elements.document.querySelectorAll("img:not([hidden])"));
  await Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, 8000);
    });
  }));
  if (document.fonts?.ready) await document.fonts.ready;
}

async function ensureSelectedFonts() {
  if (elements.fontFamily?.value !== "x-native" || !document.fonts?.load) {
    renderingDiagnostics.font.chirpLoaded = null;
    return;
  }

  try {
    const load = Promise.all([
      document.fonts.load('400 16px "TwitterChirp"', "X Article"),
      document.fonts.load('500 16px "TwitterChirp"', "X Article"),
      document.fonts.load('700 16px "TwitterChirp"', "X Article"),
      document.fonts.load('800 24px "TwitterChirp"', "X Article")
    ]);
    const timeout = new Promise((resolve) => setTimeout(() => resolve([]), 8000));
    const results = await Promise.race([load, timeout]);
    renderingDiagnostics.font.chirpLoaded = Array.isArray(results)
      && results.length === 4
      && results.every((fonts) => Array.isArray(fonts) && fonts.length > 0);
  } catch {
    renderingDiagnostics.font.chirpLoaded = false;
  }
}

function readyStatusMessage() {
  const messages = [];
  const fontMessage = fontStatusMessage();
  if (fontMessage) messages.push(fontMessage);
  const formulas = renderingDiagnostics.formulas || {};
  if (formulas.total) {
    if (formulas.failed) messages.push(t("formulaFailedShort", { count: formulas.failed }));
    else if (formulas.nonSelectable) messages.push(t("formulaSelectableShort", { selectable: formulas.selectable || 0, total: formulas.total, nonSelectable: formulas.nonSelectable }));
    else messages.push(t("formulaNativeShort", { total: formulas.total }));
  }
  return messages.join(" ");
}

function fontStatusMessage() {
  if (elements.fontFamily?.value !== "x-native") return "";
  if (renderingDiagnostics.font.chirpLoaded === false) return t("chirpFallback");
  return "";
}

function setSafeInlineHtml(target, html) {
  const template = document.createElement("template");
  template.innerHTML = String(html);
  sanitizeTree(template.content);
  target.replaceChildren(template.content.cloneNode(true));
}

function sanitizeTree(parent) {
  const allowedTags = new Set([
    "A", "STRONG", "B", "EM", "I", "S", "U", "CODE", "BR", "SPAN", "SUP", "SUB"
  ]);

  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (!(child instanceof Element)) {
      child.remove();
      continue;
    }

    if (!allowedTags.has(child.tagName)) {
      const fragment = document.createDocumentFragment();
      while (child.firstChild) fragment.append(child.firstChild);
      child.replaceWith(fragment);
      sanitizeTree(parent);
      continue;
    }

    for (const attribute of Array.from(child.attributes)) {
      const keepHref = child.tagName === "A" && attribute.name.toLowerCase() === "href";
      if (!keepHref) child.removeAttribute(attribute.name);
    }

    if (child.tagName === "A") {
      const href = child.getAttribute("href") || "";
      if (!isSafeHttpUrl(href)) {
        child.removeAttribute("href");
      } else {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
    }
    sanitizeTree(child);
  }
}

function isSafeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isSafeXMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "pbs.twimg.com" && [
      "/media/",
      "/amplify_video_thumb/",
      "/ext_tw_video_thumb/",
      "/tweet_video_thumb/"
    ].some((prefix) => url.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

function showError(message) {
  elements.document.hidden = true;
  elements.emptyState.hidden = false;
  elements.errorMessage.textContent = message;
}
