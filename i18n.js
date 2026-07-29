(() => {
  const messages = {
    en: {
      appTitle: "X2PDF — X to PDF",
      brandTitle: "X2PDF",
      brandSubtitle: "Structured Article preview v0.12",
      page: "Page",
      font: "Font",
      textSize: "Text size",
      codeTheme: "Code theme",
      fontX: "X native (Chirp)",
      fontSerif: "Serif reading",
      fontSystem: "System sans-serif",
      sizeCompact: "Compact",
      sizeStandard: "Standard",
      sizeComfortable: "Comfortable",
      themeXLight: "X Light",
      themeGithubLight: "GitHub Light",
      themeOneDark: "One Dark",
      themePlain: "No highlighting",
      images: "Images",
      embeds: "Embeds",
      wrapCode: "Wrap code",
      source: "Source",
      copyDiagnostics: "Copy diagnostics",
      downloadPdf: "Download PDF",
      directPdf: "Direct PDF export",
      directPdfDescription: "Chrome lays out and downloads the PDF in the background. The system print dialog is not opened.",
      emptyTitle: "Nothing to preview",
      emptyMessage: "Return to X, wait for the content to load, and click the extension again.",
      troubleshootingTip: "If a format is still incorrect, click Copy diagnostics and attach the sanitized result to a GitHub issue.",
      structuredReady: "The title and DraftJS content_state were captured from X's Article response. Title source: article.title.",
      outputSummary: "Output: {heading} headings, {quote} quotes, {code} code blocks, {formula} formulas, and {image} images.",
      entitySummary: "Markdown entities: {markdown}; formula entities: {formula}.",
      domFallback: "DOM compatibility mode is active. The Article title/content_state is not verified; complex code, media order, or the title may be incomplete.",
      gaps: "The completeness check found {count} possible content gap(s). Review the preview before exporting.",
      unresolvedMedia: "{count} media entity/entities remain unresolved.",
      unresolvedFormulas: "{count} LaTeX formula entity/entities remain unresolved.",
      defaultTitle: "X Article",
      previewSuffix: "PDF Preview",
      formulaUnavailable: "Formula unavailable",
      copyLatex: "Copy LaTeX",
      code: "Code",
      copy: "Copy",
      copyFullCode: "Copy complete code",
      copyCodeAria: "Copy {language} code",
      media: "Media",
      viewGif: "View GIF on X",
      viewVideo: "View video on X",
      viewPost: "View original post on X",
      poll: "Poll",
      capturedAt: "Captured: {date}",
      caching: "Caching images, loading fonts, and typesetting formulas…",
      loadingFont: "Loading selected font…",
      formulaRendererMissing: "Formula renderer is unavailable",
      formulaEmpty: "Formula source is empty",
      mathFormula: "Mathematical formula",
      formulaFailures: "{count} formula(s) failed to render. Review the preview.",
      formulaSelectableMixed: "{selectable}/{total} formulas are selectable; {nonSelectable} use SVG compatibility mode.",
      formulaSelectableAll: "All {total} formulas use selectable native MathML.",
      copied: "Copied",
      copyFailed: "Copy failed",
      formulaRenderFailed: "Formula rendering failed",
      clipboardDenied: "The browser denied clipboard access. Select and copy the diagnostics manually.",
      generatingPdf: "Generating PDF…",
      waitingAssets: "Waiting for images and fonts…",
      invokingPdf: "Calling Chrome's PDF engine…",
      pdfFailed: "PDF generation failed.",
      downloadStarted: "Download started: {filename}",
      downloaded: "Downloaded",
      retryDownload: "Download failed — retry",
      mediaCacheFailed: "Media caching failed",
      imageTimeout: "Image loading timed out",
      imageFailed: "Image failed to load",
      formulaFailedShort: "{count} formula(s) failed to render.",
      formulaSelectableShort: "{selectable}/{total} formulas are selectable; {nonSelectable} use SVG compatibility mode.",
      formulaNativeShort: "All {total} formulas use selectable native MathML.",
      chirpFallback: "Chirp could not be loaded; the system sans-serif fallback is in use."
    },
    zh: {
      appTitle: "X2PDF — X 长文导出 PDF",
      brandTitle: "X2PDF",
      brandSubtitle: "结构化 Article 预览 v0.12",
      page: "页面", font: "字体", textSize: "字号", codeTheme: "代码主题",
      fontX: "X 原生（Chirp）", fontSerif: "衬线阅读", fontSystem: "系统无衬线",
      sizeCompact: "紧凑", sizeStandard: "标准", sizeComfortable: "宽松",
      themeXLight: "X 浅色", themeGithubLight: "GitHub 浅色", themeOneDark: "One Dark", themePlain: "不高亮",
      images: "图片", embeds: "嵌入内容", wrapCode: "代码换行", source: "来源",
      copyDiagnostics: "复制诊断", downloadPdf: "直接下载 PDF",
      directPdf: "直接生成 PDF", directPdfDescription: "点击“直接下载 PDF”后由 Chrome 在后台排版并下载，不会打开系统打印窗口。",
      emptyTitle: "没有可预览的内容", emptyMessage: "请返回 X 页面，等待内容加载完成后再次点击扩展图标。",
      troubleshootingTip: "某一格式仍识别异常时，点击“复制诊断”，将脱敏后的内容附到 GitHub Issue 中。",
      structuredReady: "已从 X 后端 Article 响应取得 title 与 DraftJS content_state。标题来源：article.title。",
      outputSummary: "输出：{heading} 个标题、{quote} 个引用、{code} 个代码块、{formula} 个公式、{image} 张图片。",
      entitySummary: "Markdown 实体：{markdown}；公式实体：{formula}。",
      domFallback: "当前使用 DOM 兼容模式，未验证 article.title/content_state；复杂代码、媒体顺序或标题可能不完整。",
      gaps: "完整性检查发现 {count} 处疑似内容缺口，请先检查预览。",
      unresolvedMedia: "仍有 {count} 个媒体实体未解析。", unresolvedFormulas: "仍有 {count} 个 LATEX 公式实体未解析。",
      defaultTitle: "X 长文", previewSuffix: "PDF 预览", formulaUnavailable: "公式无法解析", copyLatex: "复制 LaTeX",
      code: "代码", copy: "复制", copyFullCode: "复制完整代码", copyCodeAria: "复制{language}代码",
      media: "媒体", viewGif: "在 X 查看 GIF", viewVideo: "在 X 查看视频", viewPost: "在 X 查看原帖", poll: "投票",
      capturedAt: "提取时间：{date}", caching: "正在缓存图片、加载字体并排版公式…", loadingFont: "正在加载所选字体…",
      formulaRendererMissing: "公式渲染器未加载", formulaEmpty: "公式源为空", mathFormula: "数学公式",
      formulaFailures: "{count} 个公式渲染失败，请检查预览。",
      formulaSelectableMixed: "{selectable}/{total} 个公式可选中；{nonSelectable} 个使用 SVG 兼容模式。",
      formulaSelectableAll: "{total} 个公式已使用原生 MathML 排版，可选中并复制。",
      copied: "已复制", copyFailed: "复制失败", formulaRenderFailed: "公式渲染失败",
      clipboardDenied: "浏览器拒绝了剪贴板写入，请手动选择诊断文本。",
      generatingPdf: "正在生成 PDF…", waitingAssets: "正在等待图片和字体加载…", invokingPdf: "正在调用 Chrome PDF 引擎…",
      pdfFailed: "PDF 生成失败。", downloadStarted: "已开始下载：{filename}", downloaded: "已下载", retryDownload: "下载失败，重试",
      mediaCacheFailed: "媒体缓存失败", imageTimeout: "图片加载超时", imageFailed: "图片加载失败",
      formulaFailedShort: "{count} 个公式渲染失败。",
      formulaSelectableShort: "{selectable}/{total} 个公式可选中，{nonSelectable} 个为 SVG 兼容模式。",
      formulaNativeShort: "{total} 个公式已使用原生 MathML 排版，可选中并复制。",
      chirpFallback: "Chirp 未能加载，当前使用系统无衬线回退字体。"
    }
  };

  const browserLanguage = (globalThis.chrome?.i18n?.getUILanguage?.() || navigator.language || "en").toLowerCase();
  const locale = browserLanguage.startsWith("zh") ? "zh" : "en";
  const table = messages[locale];
  const fallback = messages.en;

  function t(key, vars = {}) {
    let value = table[key] ?? fallback[key] ?? key;
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
    return value;
  }

  function apply(root = document) {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
    for (const node of root.querySelectorAll("[data-i18n-title]")) node.title = t(node.dataset.i18nTitle);
    document.title = t("appTitle");
  }

  globalThis.XPDFI18n = { locale, t, apply };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => apply());
  else apply();
})();
