(() => {
  "use strict";

  const ft = (en, zh) => globalThis.XPDFI18n?.locale === "zh" ? zh : en;

  const MATHML_NS = "http://www.w3.org/1998/Math/MathML";
  const DISALLOWED_ELEMENTS = new Set([
    "script",
    "style",
    "foreignobject",
    "iframe",
    "object",
    "embed",
    "annotation",
    "annotation-xml"
  ]);

  function supportsNativeMathML() {
    try {
      return typeof globalThis.MathMLElement === "function"
        && Boolean(globalThis.CSS?.supports?.("math-style", "normal"));
    } catch {
      return false;
    }
  }

  function parseMathML(markup, display = true) {
    const source = String(markup || "").trim();
    if (!source) throw new Error(ft("MathML source is empty", "MathML 源为空"));

    const xml = new DOMParser().parseFromString(source, "application/xml");
    const parserError = xml.querySelector("parsererror");
    if (parserError) {
      throw new Error((parserError.textContent || ft("MathML parsing failed", "MathML 解析失败")).replace(/\s+/g, " ").trim());
    }

    let root = xml.documentElement;
    if (!root || root.localName.toLowerCase() !== "math") {
      const math = xml.getElementsByTagNameNS(MATHML_NS, "math")[0] || xml.querySelector("math");
      if (!math) throw new Error(ft("MathML has no <math> root", "MathML 中没有 <math> 根节点"));
      root = math;
    }

    sanitizeMathMLTree(root);
    unwrapSemantics(root);
    const rootRowNormalized = normalizeMathRootRow(root);

    root.setAttribute("xmlns", MATHML_NS);
    root.setAttribute("display", display === false ? "inline" : "block");
    root.removeAttribute("style");

    const imported = document.importNode(root, true);
    if (!(imported instanceof Element) || imported.namespaceURI !== MATHML_NS) {
      throw new Error(ft("The browser could not create a native MathML node", "浏览器未能创建原生 MathML 节点"));
    }
    if (rootRowNormalized) imported.dataset.xpdfRootRow = "normalized";
    const error = findMathError(imported);
    if (error) throw new Error(error);
    return imported;
  }

  /**
   * Chromium's native MathML renderer does not reliably infer the implicit
   * top-level mrow emitted by MathJax's TeX-to-MathML converter. When a
   * display formula contains several direct children, Chromium can lay them
   * out as independent rows (or even one glyph per line), especially during
   * print layout. Materialize the implicit row explicitly.
   */
  function normalizeMathRootRow(root) {
    if (!(root instanceof Element) || root.localName.toLowerCase() !== "math") return false;

    const meaningfulNodes = Array.from(root.childNodes).filter((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) return true;
      if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent?.trim());
      return false;
    });

    if (meaningfulNodes.length <= 1) return false;

    const row = root.ownerDocument.createElementNS(MATHML_NS, "mrow");
    while (root.firstChild) row.append(root.firstChild);
    root.append(row);
    return true;
  }

  function sanitizeMathMLTree(root) {
    for (const node of Array.from(root.querySelectorAll("*"))) {
      const name = node.localName.toLowerCase();
      if (DISALLOWED_ELEMENTS.has(name)) {
        node.remove();
        continue;
      }
      for (const attribute of Array.from(node.attributes)) {
        const attrName = attribute.name.toLowerCase();
        if (
          attrName.startsWith("on")
          || attrName === "href"
          || attrName === "xlink:href"
          || attrName === "src"
          || attrName === "style"
          || attrName === "class"
          || attrName === "id"
        ) {
          node.removeAttribute(attribute.name);
        }
      }
    }
  }

  function unwrapSemantics(root) {
    for (const semantics of Array.from(root.querySelectorAll("semantics"))) {
      const visible = Array.from(semantics.children).find((child) => {
        const name = child.localName.toLowerCase();
        return name !== "annotation" && name !== "annotation-xml";
      });
      if (visible) semantics.replaceWith(visible.cloneNode(true));
      else semantics.remove();
    }
  }

  function findMathError(root) {
    if (!(root instanceof Element)) return ft("Invalid formula output", "公式输出无效");
    const node = root.matches("merror") ? root : root.querySelector("merror");
    if (!node) return "";
    return (node.getAttribute("data-mjx-error") || node.textContent || ft("The formula contains unrecognized TeX", "公式包含无法识别的 TeX")).replace(/\s+/g, " ").trim();
  }

  async function sourceToMathML(formula) {
    const display = formula?.display !== false;
    if (typeof formula?.mathml === "string" && formula.mathml.trim()) {
      return { markup: formula.mathml.trim(), format: "mathml", display };
    }

    const latex = typeof formula?.latex === "string" ? formula.latex.trim() : "";
    if (!latex) throw new Error(ft("LaTeX source is empty", "LaTeX 源为空"));
    if (!globalThis.MathJax?.startup?.promise || typeof globalThis.MathJax.tex2mmlPromise !== "function") {
      throw new Error(ft("The MathJax TeX-to-MathML converter is unavailable", "MathJax TeX→MathML 转换器未加载"));
    }
    await globalThis.MathJax.startup.promise;
    const markup = await globalThis.MathJax.tex2mmlPromise(latex, { display });
    return { markup, format: "tex", display };
  }

  async function renderNative(target, formula) {
    if (!supportsNativeMathML()) throw new Error(ft("This Chromium version does not support native MathML", "当前 Chrome 不支持原生 MathML"));
    const converted = await sourceToMathML(formula);
    const math = parseMathML(converted.markup, converted.display);
    const accessibleSource = formula?.latex || math.textContent?.replace(/\s+/g, " ").trim() || ft("Mathematical formula", "数学公式");
    math.setAttribute("aria-label", accessibleSource);
    math.dataset.xpdfMath = "native";
    target.replaceChildren(math);
    target.dataset.formulaRenderer = "native-mathml";
    target.dataset.formulaSelectable = "true";
    return {
      renderer: "native-mathml",
      selectable: true,
      format: converted.format,
      assistiveLayersRemoved: 0,
      rootRowsNormalized: math.dataset.xpdfRootRow === "normalized" ? 1 : 0
    };
  }

  async function renderSvgFallback(target, formula) {
    if (!globalThis.MathJax?.startup?.promise) throw new Error(ft("MathJax is unavailable", "MathJax 未加载"));
    await globalThis.MathJax.startup.promise;
    const node = formula?.mathml
      ? await globalThis.MathJax.mathml2svgPromise(formula.mathml, { display: formula.display !== false })
      : await globalThis.MathJax.tex2svgPromise(formula.latex, { display: formula.display !== false });
    if (!(node instanceof Element) || !node.querySelector("svg")) throw new Error(ft("MathJax did not return SVG output", "MathJax 未返回 SVG"));
    const removed = removeAssistiveLayers(node);
    const mathError = findSvgMathError(node);
    if (mathError) throw new Error(mathError);
    const svg = node.querySelector("svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    target.replaceChildren(node);
    target.dataset.formulaRenderer = "svg-fallback";
    target.dataset.formulaSelectable = "false";
    return {
      renderer: "svg-fallback",
      selectable: false,
      format: formula?.mathml ? "mathml" : "tex",
      assistiveLayersRemoved: removed
    };
  }

  function removeAssistiveLayers(root) {
    if (!(root instanceof Element)) return 0;
    const nodes = Array.from(root.querySelectorAll(
      "mjx-assistive-mml, .MJX_Assistive_MathML, [data-mjx-assistive-mml], annotation, annotation-xml"
    ));
    for (const node of nodes) node.remove();
    return nodes.length;
  }

  function findSvgMathError(root) {
    if (!(root instanceof Element)) return ft("Invalid MathJax output", "MathJax 输出无效");
    const errorNode = root.querySelector('[data-mml-node="merror"], mjx-merror, .mjx-merror, [data-mjx-error]');
    if (!errorNode) return "";
    return (errorNode.textContent || errorNode.getAttribute("data-mjx-error") || ft("The formula contains TeX that MathJax could not parse", "公式包含 MathJax 无法识别的 TeX"))
      .replace(/\s+/g, " ")
      .trim();
  }

  async function render(target, formula, options = {}) {
    if (!(target instanceof Element)) throw new TypeError(ft("Invalid formula target node", "公式目标节点无效"));
    const allowSvgFallback = options.allowSvgFallback !== false;
    try {
      return await renderNative(target, formula);
    } catch (nativeError) {
      if (!allowSvgFallback) throw nativeError;
      try {
        const result = await renderSvgFallback(target, formula);
        result.nativeError = nativeError instanceof Error ? nativeError.message : String(nativeError);
        return result;
      } catch (svgError) {
        const message = [nativeError, svgError]
          .map((error) => error instanceof Error ? error.message : String(error))
          .filter(Boolean)
          .join("；");
        throw new Error(message || ft("Formula rendering failed", "公式渲染失败"));
      }
    }
  }

  globalThis.XPDFFormulaRenderer = Object.freeze({
    MATHML_NS,
    supportsNativeMathML,
    parseMathML,
    normalizeMathRootRow,
    sourceToMathML,
    render,
    removeAssistiveLayers,
    findMathError
  });
})();
