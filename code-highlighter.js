(function initCodeHighlighter(root) {
  "use strict";

  const LANGUAGE_ALIASES = Object.freeze({
    "": "",
    text: "",
    txt: "",
    plaintext: "",
    plain: "",
    none: "",
    py: "python",
    python3: "python",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    node: "javascript",
    nodejs: "javascript",
    ts: "typescript",
    jsx: "jsx",
    tsx: "tsx",
    html: "markup",
    htm: "markup",
    xml: "markup",
    svg: "markup",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    fish: "bash",
    console: "bash",
    terminal: "bash",
    jsonc: "json",
    json5: "json",
    yml: "yaml",
    md: "markdown",
    mdx: "markdown",
    cxx: "cpp",
    "c++": "cpp",
    cc: "cpp",
    hpp: "cpp",
    "c#": "csharp",
    cs: "csharp",
    golang: "go",
    rs: "rust",
    rb: "ruby",
    rlang: "r",
    ps1: "powershell",
    pwsh: "powershell",
    dockerfile: "docker",
    docker: "docker",
    kt: "kotlin",
    kts: "kotlin",
    objective_c: "objectivec",
    "objective-c": "objectivec",
    objc: "objectivec",
    shellsession: "bash"
  });

  const DISPLAY_NAMES = Object.freeze({
    javascript: "JavaScript",
    typescript: "TypeScript",
    jsx: "JSX",
    tsx: "TSX",
    python: "Python",
    bash: "Shell",
    json: "JSON",
    markup: "HTML / XML",
    css: "CSS",
    c: "C",
    cpp: "C++",
    csharp: "C#",
    java: "Java",
    go: "Go",
    rust: "Rust",
    sql: "SQL",
    yaml: "YAML",
    markdown: "Markdown",
    diff: "Diff",
    docker: "Dockerfile",
    powershell: "PowerShell",
    kotlin: "Kotlin",
    swift: "Swift",
    ruby: "Ruby",
    r: "R",
    matlab: "MATLAB",
    scala: "Scala",
    objectivec: "Objective-C"
  });

  function normalizeLanguage(value) {
    const raw = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^language-/, "")
      .replace(/^lang-/, "")
      .replace(/[()]/g, "")
      .split(/[\s,;/]+/)[0]
      .replace(/[^a-z0-9+#_-]/g, "");
    return Object.prototype.hasOwnProperty.call(LANGUAGE_ALIASES, raw)
      ? LANGUAGE_ALIASES[raw]
      : raw;
  }

  function scoreLanguage(text) {
    const source = String(text || "");
    const trimmed = source.trim();
    if (!trimmed) return "";

    if (/^[\[{]/.test(trimmed)) {
      try {
        JSON.parse(trimmed);
        return "json";
      } catch {
        // Continue with heuristic detection.
      }
    }

    const scores = new Map();
    const add = (name, value) => scores.set(name, (scores.get(name) || 0) + value);

    if (/^\s*#!.*\b(?:bash|sh|zsh)\b/m.test(source)) add("bash", 12);
    if (/\b(?:echo|export|source|chmod|curl|wget|grep|awk|sed)\b/.test(source)) add("bash", 4);
    if (/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(source)) add("bash", 2);

    if (/^\s*(?:from\s+[\w.]+\s+import|import\s+[\w.]+)/m.test(source)) add("python", 7);
    if (/^\s*(?:async\s+)?def\s+\w+\s*\(/m.test(source)) add("python", 8);
    if (/^\s*class\s+\w+(?:\([^)]*\))?\s*:/m.test(source)) add("python", 7);
    if (/\b(?:self|torch|numpy|pandas|nn|pytest)\./.test(source)) add("python", 5);
    if (/^\s*(?:for|while|if|elif|else|try|except|with)\b.*:\s*$/m.test(source)) add("python", 4);

    if (/\b(?:const|let|var)\s+[A-Za-z_$]/.test(source)) add("javascript", 5);
    if (/=>|\b(?:function|console\.log|document\.|window\.)\b/.test(source)) add("javascript", 5);
    if (/\b(?:interface|type|enum|implements|readonly)\s+[A-Z]/.test(source)) add("typescript", 7);
    if (/\b(?:string|number|boolean|unknown|never)\b\s*[;=,)]/.test(source)) add("typescript", 3);
    if (/<[A-Z][A-Za-z0-9]*(?:\s|\/?>)/.test(source)) add("jsx", 6);

    if (/^\s*<[!?A-Za-z][\s\S]*>\s*$/m.test(source) || /<\/?(?:html|body|div|span|svg|section|article)\b/i.test(source)) add("markup", 9);
    if (/^[^{\n]+\{\s*(?:[\w-]+\s*:\s*[^;]+;?\s*)+\}/m.test(source)) add("css", 7);

    if (/^\s*#include\s*[<"]/m.test(source) || /\bstd::|\bcout\s*<</.test(source)) add("cpp", 9);
    if (/\b(?:printf|malloc|size_t)\s*\(/.test(source)) add("c", 4);
    if (/\bpublic\s+(?:static\s+)?(?:class|void)|\bSystem\.out\./.test(source)) add("java", 7);
    if (/\busing\s+System\b|\bnamespace\s+\w+|\bConsole\.WriteLine/.test(source)) add("csharp", 7);
    if (/^\s*package\s+\w+/m.test(source) && /\bfunc\s+\w+\s*\(/.test(source)) add("go", 9);
    if (/\bfn\s+\w+\s*\(|\blet\s+mut\b|\bimpl\s+\w+/.test(source)) add("rust", 8);

    if (/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(source)) add("sql", 8);
    if (/\bFROM\b[\s\S]*\bWHERE\b/i.test(source)) add("sql", 4);
    if (/^\s*[\w.-]+:\s+(?:[^\n]+|$)/m.test(source) && !/[{};]/.test(source)) add("yaml", 4);
    if (/^#{1,6}\s+\S/m.test(source) || /^```/m.test(source) || /^\s*[-*+]\s+\S/m.test(source)) add("markdown", 5);
    if (/^(?:diff --git|@@\s+-\d|\+\+\+\s+|---\s+)/m.test(source)) add("diff", 9);
    if (/^\s*FROM\s+\S+/mi.test(source) && /^\s*(?:RUN|COPY|CMD|ENTRYPOINT|WORKDIR)\b/mi.test(source)) add("docker", 9);
    if (/\b(?:Write-Host|Get-ChildItem|Set-Location|param\s*\()\b/i.test(source)) add("powershell", 8);
    if (/\bfun\s+\w+\s*\(|\bval\s+\w+|\bdata\s+class\b/.test(source)) add("kotlin", 7);
    if (/\bfunc\s+\w+\s*\(|\blet\s+\w+\s*=|\bguard\s+let\b/.test(source)) add("swift", 5);
    if (/\b(?:puts|require|attr_reader|end)\b/.test(source) && /^\s*def\s+\w+/m.test(source)) add("ruby", 6);
    if (/<-\s*|\b(?:library|data\.frame|ggplot)\s*\(/.test(source)) add("r", 6);
    if (/^\s*(?:function\s+\w+\s*=|end\s*$)/m.test(source) && /\b(?:zeros|ones|plot)\s*\(/.test(source)) add("matlab", 6);

    let best = "";
    let bestScore = 0;
    for (const [name, score] of scores) {
      if (score > bestScore) {
        best = name;
        bestScore = score;
      }
    }
    return bestScore >= 4 ? best : "";
  }

  function resolveLanguage(label, text, prism = root.Prism) {
    const normalized = normalizeLanguage(label);
    if (normalized && prism?.languages?.[normalized]) return normalized;
    const detected = scoreLanguage(text);
    if (detected && prism?.languages?.[detected]) return detected;
    return "";
  }

  function displayName(language, fallback = "") {
    return DISPLAY_NAMES[language] || fallback || language || "Code";
  }

  function highlightElement(codeElement, label, prism = root.Prism) {
    if (!codeElement) return { language: "", highlighted: false };
    const raw = codeElement.dataset.rawCode ?? codeElement.textContent ?? "";
    codeElement.dataset.rawCode = raw;
    codeElement.textContent = raw;

    for (const className of Array.from(codeElement.classList || [])) {
      if (/^language-/.test(className)) codeElement.classList.remove(className);
    }

    const language = resolveLanguage(label, raw, prism);
    if (!language || !prism?.languages?.[language] || typeof prism.highlightElement !== "function") {
      codeElement.classList.add("language-none");
      return { language: "", highlighted: false };
    }

    codeElement.classList.add(`language-${language}`);
    prism.highlightElement(codeElement);
    return { language, highlighted: true };
  }

  function highlightAll(container, prism = root.Prism) {
    if (!container?.querySelectorAll) return { total: 0, highlighted: 0, languages: {} };
    const stats = { total: 0, highlighted: 0, languages: {} };
    for (const code of container.querySelectorAll(".code-block pre > code")) {
      stats.total += 1;
      const wrapper = code.closest(".code-block");
      const explicit = wrapper?.dataset.language || wrapper?.querySelector("figcaption")?.dataset.language || "";
      const result = highlightElement(code, explicit, prism);
      if (result.highlighted) {
        stats.highlighted += 1;
        stats.languages[result.language] = (stats.languages[result.language] || 0) + 1;
      }
      if (wrapper) {
        wrapper.dataset.highlighted = result.highlighted ? "true" : "false";
        wrapper.dataset.resolvedLanguage = result.language || "plain";
        let caption = wrapper.querySelector(":scope > figcaption");
        if (!caption && result.language) {
          caption = document.createElement("figcaption");
          wrapper.prepend(caption);
        }
        if (caption) {
          caption.dataset.language = result.language || normalizeLanguage(explicit) || "";
          caption.textContent = displayName(result.language, String(explicit || "").trim());
        }
      }
    }
    return stats;
  }

  root.XPDFCodeHighlight = Object.freeze({
    normalizeLanguage,
    detectLanguage: scoreLanguage,
    resolveLanguage,
    displayName,
    highlightElement,
    highlightAll
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
