(() => {
  const isZh = String(globalThis.chrome?.i18n?.getUILanguage?.() || navigator.language || "").toLowerCase().startsWith("zh");
  const l = (en, zh) => isZh ? zh : en;

  const OWNER_TYPES = new Set([
    "blockquote", "list", "code", "table", "figure", "media", "embedded_post", "link_card"
  ]);

  try {
    const page = classifyPage();

    if (page.postId && !page.articleId) {
      const linkedArticle = findLinkedArticle();
      if (linkedArticle) {
        return { kind: "redirect", ...linkedArticle };
      }
    }

    const documentData = page.articleId ? extractArticle(page) : extractPost(page);
    return { kind: "document", document: documentData };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const loading = /not finished loading|wait and try again|body has not finished|尚未加载|等待页面|正文区域|加载完成/i.test(message);
    return { kind: loading ? "loading" : "error", message };
  }

  function classifyPage() {
    const path = location.pathname;
    return {
      path,
      articleId: path.match(/\/article\/(\d+)/)?.[1],
      postId: path.match(/\/status\/(\d+)/)?.[1]
    };
  }

  function findLinkedArticle() {
    const links = Array.from(document.querySelectorAll("a[href*='/article/']"));
    const link = links.find((node) => {
      const href = node.getAttribute("href") || "";
      return /\/(?:i|[A-Za-z0-9_]+)\/article\/\d+/.test(href);
    });

    if (!link) return null;

    try {
      const url = new URL(link.href || link.getAttribute("href"));
      url.search = "";
      url.hash = "";
      return {
        articleUrl: url.href,
        articleTitleHint: detectArticleCardTitle(link)
      };
    } catch {
      return null;
    }
  }

  function detectArticleCardTitle(link) {
    const scope = link.closest("[data-testid='card.wrapper']") || link;
    const candidates = [];
    const nodes = [link, ...scope.querySelectorAll("h1, h2, h3, strong, span, div")];

    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      const text = cleanTitle(node.textContent || "");
      if (!isPlausibleTitle(text) || text.length < 8) continue;
      if (/^https?:\/\/|^x\.com\b|^twitter\.com\b/i.test(text)) continue;
      if (/^(Show more|Read more|Article|Long post)$/i.test(text)) continue;

      const style = getComputedStyle(node);
      const size = px(style.fontSize);
      const weight = fontWeight(style.fontWeight);
      let score = 0;
      if (node === link) score += 80;
      if (/^H[1-3]$/.test(node.tagName)) score += 600;
      score += Math.min(size, 36) * 12;
      score += Math.max(0, weight - 400) / 2;
      if (text.length >= 18 && text.length <= 180) score += 180;
      if (node.children.length > 8) score -= 240;
      candidates.push({ text, score });
    }

    candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
    return candidates[0]?.text || undefined;
  }

  function extractArticle(page) {
    const bodyRoot = findArticleBody();
    if (!bodyRoot) {
      throw new Error(l("The X Article body has not finished loading. Wait and try again.", "X Article 正文尚未加载完成，请等待页面加载后重试。"));
    }

    const pageRoot = document.querySelector("main") || bodyRoot.closest("article") || document.body;
    const authorHandle = detectAuthorHandle(pageRoot, page.path);
    const authorName = detectAuthorName(pageRoot, authorHandle);
    const title = detectArticleTitle(pageRoot, bodyRoot, authorHandle, authorName);
    const cover = detectArticleCover(pageRoot, bodyRoot);
    const publishedAt = detectPublishedAt(pageRoot, bodyRoot);
    const extraction = extractBlocks(bodyRoot, { title, coverSrc: cover?.src });

    if (extraction.blocks.length === 0) {
      throw new Error(l("The X Article page was found, but no exportable body content was detected.", "找到了 X Article 页面，但没有识别到可导出的正文内容。"));
    }

    return buildDocument({
      type: "article",
      page,
      title,
      authorName,
      authorHandle,
      publishedAt,
      coverImage: cover?.src,
      blocks: extraction.blocks,
      diagnostics: extraction.diagnostics
    });
  }

  function extractPost(page) {
    const postRoot = findPostRoot(page.postId);
    if (!postRoot) {
      throw new Error(l("The post body has not finished loading. Wait and try again.", "帖子正文区域尚未加载完成，请等待页面加载后重试。"));
    }

    const authorHandle = detectAuthorHandle(postRoot, page.path);
    const authorName = detectAuthorName(postRoot, authorHandle);
    const publishedAt = postRoot.querySelector("time")?.getAttribute("datetime") || undefined;
    const tweetText = postRoot.querySelector("[data-testid='tweetText']");
    const rawText = normalizeText(tweetText?.textContent || "");
    const title = rawText
      ? rawText.length > 90 ? `${rawText.slice(0, 90).trim()}…` : rawText
      : cleanTitle(document.title, authorHandle, authorName) || l("X Post", "X 帖子");

    const blocks = [];
    if (tweetText) {
      const html = serializeInline(tweetText);
      if (isUsefulText(normalizeText(stripHtml(html)))) {
        blocks.push({ type: "paragraph", html, indent: 0 });
      }
    }

    const nestedPosts = collectEmbeddedPosts(postRoot, postRoot);
    const nestedRoots = new Set(nestedPosts.map((item) => item.node));

    for (const media of collectMediaBlocks(postRoot, nestedRoots)) blocks.push(media.block);
    for (const image of collectContentImages(postRoot)) {
      if (isInsideAny(image.node, nestedRoots) || image.node.closest("[data-testid='card.wrapper']")) continue;
      blocks.push(toImageBlock(image));
    }
    for (const item of nestedPosts) blocks.push(item.block);
    for (const card of collectLinkCards(postRoot, nestedRoots)) blocks.push(card);
    const poll = extractPoll(postRoot);
    if (poll) blocks.push(poll);

    const finalBlocks = deduplicateBlocks(blocks);
    if (finalBlocks.length === 0) {
      throw new Error(l("No exportable text, media, or embedded content was detected in this post.", "当前帖子没有识别到可导出的文字、媒体或嵌入内容。"));
    }

    return buildDocument({
      type: "long_post",
      page,
      title,
      authorName,
      authorHandle,
      publishedAt,
      coverImage: undefined,
      blocks: finalBlocks,
      diagnostics: buildDiagnostics(finalBlocks, [])
    });
  }

  function buildDocument({
    type, page, title, authorName, authorHandle, publishedAt, coverImage, blocks, diagnostics
  }) {
    const canonicalUrl = new URL(location.href);
    canonicalUrl.search = "";
    canonicalUrl.hash = "";

    return {
      version: 5,
      source: {
        platform: "x",
        url: canonicalUrl.href,
        postId: page.articleId || page.postId,
        capturedAt: new Date().toISOString()
      },
      type,
      metadata: {
        title,
        authorName,
        authorHandle,
        publishedAt,
        language: document.documentElement.lang || undefined,
        coverImage
      },
      blocks,
      diagnostics,
      options: {
        includeSourceUrl: true,
        includePublishedAt: true,
        includeImages: true,
        includeEmbeds: true,
        wrapCode: true
      }
    };
  }

  function findArticleBody() {
    const selectors = [
      "[data-testid='twitterArticleRichTextView']",
      "[data-testid*='ArticleRichText']",
      "[data-testid*='articleRichText']",
      "article [data-testid*='RichTextView']",
      "[role='document'][contenteditable='false']"
    ];

    const candidates = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => normalizeText(node.innerText || "").length > 120);

    if (candidates.length > 0) {
      candidates.sort((a, b) => articleBodyScore(b) - articleBodyScore(a));
      return candidates[0];
    }

    const fallbackCandidates = Array.from(
      document.querySelectorAll("main article section, main article [role='document'], main article")
    ).filter((node) => node instanceof HTMLElement);

    fallbackCandidates.sort((a, b) => articleBodyScore(b) - articleBodyScore(a));
    const best = fallbackCandidates[0];
    return best && articleBodyScore(best) > 700 ? best : null;
  }

  function articleBodyScore(node) {
    const textLength = normalizeText(node.innerText || "").length;
    const paragraphs = node.querySelectorAll("p, [data-block='true'], [role='paragraph']").length;
    const headings = node.querySelectorAll("h1, h2, h3, h4, [role='heading']").length;
    const contentImages = collectContentImages(node).length;
    const buttons = node.querySelectorAll("button").length;
    const navs = node.querySelectorAll("nav, aside, [role='navigation']").length;
    return textLength + paragraphs * 90 + headings * 160 + contentImages * 55 - buttons * 45 - navs * 900;
  }

  function findPostRoot(postId) {
    if (postId) {
      const time = document.querySelector(`a[href*='/status/${postId}'] time`);
      const article = time?.closest("article");
      if (article instanceof HTMLElement) return article;

      const matching = Array.from(document.querySelectorAll("article")).find((node) =>
        node.querySelector(`a[href*='/status/${postId}']`)
      );
      if (matching instanceof HTMLElement) return matching;
    }
    return document.querySelector("main article");
  }

  function detectArticleTitle(pageRoot, bodyRoot, handle, authorName) {
    const candidates = [];
    const bodyTop = absoluteTop(bodyRoot);

    const explicitSelectors = [
      "[data-testid='twitterArticleTitle']",
      "[data-testid*='ArticleTitle']",
      "[data-testid*='articleTitle']",
      "article header h1",
      "article header [role='heading']"
    ];

    for (const selector of explicitSelectors) {
      for (const node of pageRoot.querySelectorAll(selector)) {
        if (!(node instanceof HTMLElement) || bodyRoot.contains(node)) continue;
        addTitleCandidate(node, 1500);
      }
    }

    for (const node of pageRoot.querySelectorAll("h1, [role='heading'][aria-level='1']")) {
      if (!(node instanceof HTMLElement) || bodyRoot.contains(node)) continue;
      addTitleCandidate(node, node.tagName === "H1" ? 1300 : 900);
    }

    const visuallyProminent = Array.from(pageRoot.querySelectorAll("div, span"))
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => !bodyRoot.contains(node))
      .filter((node) => {
        const text = normalizeText(node.textContent || "");
        if (!isPlausibleTitle(text) || node.children.length > 8) return false;
        const style = getComputedStyle(node);
        const size = px(style.fontSize);
        const weight = fontWeight(style.fontWeight);
        const top = absoluteTop(node);
        return size >= 24 && weight >= 600 && top <= bodyTop + 80 && bodyTop - top <= 2200;
      })
      .slice(0, 24);

    for (const node of visuallyProminent) addTitleCandidate(node, 900);

    for (const selector of ["meta[property='og:title']", "meta[name='twitter:title']"]) {
      const raw = document.querySelector(selector)?.getAttribute("content") || "";
      const text = cleanTitle(raw, handle, authorName);
      if (isPlausibleTitle(text)) candidates.push({ text, score: 700, source: selector });
    }

    const documentTitle = cleanTitle(document.title, handle, authorName);
    if (isPlausibleTitle(documentTitle)) candidates.push({ text: documentTitle, score: 520, source: "document.title" });

    // Last resort only: the first body heading. Never let a section heading beat a real article title.
    const firstBodyHeading = Array.from(bodyRoot.querySelectorAll("h1, h2, h3, [role='heading']"))
      .find((node) => isPlausibleTitle(cleanTitle(node.textContent || "", handle, authorName)));
    if (firstBodyHeading) {
      const text = cleanTitle(firstBodyHeading.textContent || "", handle, authorName);
      candidates.push({ text, score: 120, source: "body-heading-fallback" });
    }

    candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
    return candidates[0]?.text || l("X Article", "X 长文");

    function addTitleCandidate(node, baseScore) {
      const raw = normalizeText(node.textContent || "");
      const text = cleanTitle(raw, handle, authorName);
      if (!isPlausibleTitle(text)) return;
      const top = absoluteTop(node);
      let score = baseScore;
      score -= Math.min(Math.abs(bodyTop - top), 4000) / 12;
      if (top < bodyTop) score += 180;
      if (/@[A-Za-z0-9_]+|\bFollow\b|\bReply\b|\bRepost\b/i.test(raw)) score -= 1200;
      candidates.push({ text, score, source: compactDomHint(node) });
    }
  }

  function cleanTitle(value, handle, authorName) {
    let text = normalizeText(value)
      .replace(/\s*[\/|·-]\s*X\s*$/i, "")
      .replace(/^.+?\s+on X:\s*/i, "")
      .trim();

    if (handle) {
      const token = `@${handle.replace(/^@/, "")}`;
      const index = text.toLowerCase().indexOf(token.toLowerCase());
      if (index > 3) text = text.slice(0, index).trim();
    }
    if (authorName && text.endsWith(authorName)) text = text.slice(0, -authorName.length).trim();

    return text
      .replace(/\s+[^\s]{1,30}\s+·\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b.*$/i, "")
      .replace(/\s+·\s+\d{1,2}月\d{1,2}日.*$/, "")
      .replace(/\s+Follow(?:ing)?\b.*$/i, "")
      .replace(/\s+\d+[KM万千]?\s+\d+[KM万千]?…?\s*$/i, "")
      .trim();
  }

  function isPlausibleTitle(text) {
    if (!text || text.length < 2 || text.length > 280) return false;
    return !/^(Home|Explore|Notifications|Messages|Bookmarks|Lists|Profile|More)$/i.test(text);
  }

  function detectAuthorHandle(root, pathname) {
    for (const block of root.querySelectorAll("[data-testid='User-Name']")) {
      const handle = Array.from(block.querySelectorAll("span"))
        .map((node) => normalizeText(node.textContent || ""))
        .find((text) => /^@[A-Za-z0-9_]{1,15}$/.test(text));
      if (handle) return handle.slice(1);
    }

    const pathHandle = pathname.match(/^\/([^/]+)\/(?:status|article)\//)?.[1];
    if (pathHandle && pathHandle !== "i") return pathHandle;

    const profileLink = Array.from(root.querySelectorAll("a[href]"))
      .map((node) => node.getAttribute("href") || "")
      .find((href) => /^\/[A-Za-z0-9_]{1,15}$/.test(href));
    return profileLink ? profileLink.slice(1) : undefined;
  }

  function detectAuthorName(root, handle) {
    const blocks = Array.from(root.querySelectorAll("[data-testid='User-Name']"));
    const ordered = handle
      ? [...blocks.filter((block) => normalizeText(block.textContent || "").includes(`@${handle}`)), ...blocks]
      : blocks;

    for (const block of ordered) {
      const values = Array.from(block.querySelectorAll("span"))
        .map((node) => normalizeText(node.textContent || ""))
        .filter(Boolean);
      const name = values.find((value) => value !== `@${handle}` && !value.startsWith("@") && !/^Follow/i.test(value));
      if (name) return name;
    }
    return handle ? `@${handle}` : undefined;
  }

  function detectPublishedAt(pageRoot, bodyRoot) {
    const bodyTop = absoluteTop(bodyRoot);
    const times = Array.from(pageRoot.querySelectorAll("time[datetime]"))
      .filter((node) => absoluteTop(node) <= bodyTop + 180)
      .sort((a, b) => Math.abs(bodyTop - absoluteTop(a)) - Math.abs(bodyTop - absoluteTop(b)));
    return times[0]?.getAttribute("datetime") || undefined;
  }

  function detectArticleCover(pageRoot, bodyRoot) {
    const captured = (getCaptureSnapshot().media || [])
      .map((item) => {
        const src = normalizeXMediaUrl(item.src || item.poster || "");
        if (!src) return null;
        const width = Number(item.width) || 0;
        const height = Number(item.height) || 0;
        return {
          src,
          alt: normalizeText(item.alt || ""),
          width,
          height,
          renderedWidth: Number(item.renderedWidth) || width,
          renderedHeight: Number(item.renderedHeight) || height,
          area: Number(item.area) || width * height,
          top: Number(item.top),
          bottom: Number(item.bottom)
        };
      })
      .filter(Boolean);
    const images = [...collectContentImages(pageRoot), ...captured];
    if (!images.length) return null;

    const bodyTop = absoluteTop(bodyRoot);
    const bodyFirstMediaTop = Math.min(
      ...collectContentImages(bodyRoot).map((image) => image.top),
      ...captured.filter((image) => Number.isFinite(image.top) && image.top >= bodyTop - 20).map((image) => image.top),
      Number.POSITIVE_INFINITY
    );
    const headings = Array.from(pageRoot.querySelectorAll("h1, [role='heading'][aria-level='1']"))
      .filter((node) => absoluteTop(node) <= bodyTop + 180)
      .sort((a, b) => absoluteTop(b) - absoluteTop(a));
    const titleBottom = headings[0] ? absoluteBottom(headings[0]) : Math.max(0, bodyTop - 900);

    const candidates = images
      .filter((image) => image.top >= titleBottom - 100)
      .filter((image) => image.top <= bodyTop + 900)
      .filter((image) => image.top < bodyFirstMediaTop + 2 || image.top < bodyTop)
      .map((image) => {
        const ratio = image.width > 0 && image.height > 0 ? image.width / image.height : 1;
        let score = 2500 - Math.max(0, image.top - titleBottom);
        if (ratio >= 1.25 && ratio <= 4.8) score += 500;
        if (image.renderedWidth >= 480) score += 280;
        if (image.top <= bodyTop + 180) score += 220;
        return { image, score };
      })
      .sort((a, b) => b.score - a.score || a.image.top - b.image.top);

    return candidates[0]?.image || null;
  }

  function extractBlocks(root, { title, coverSrc }) {
    const supplemental = findSupplementalRichBlocks(root);
    const supplementalSet = new Set();
    for (const node of supplemental) {
      supplementalSet.add(node);
      for (const descendant of node.querySelectorAll("*")) supplementalSet.add(descendant);
    }

    const all = Array.from(new Set([
      ...root.querySelectorAll("*"),
      ...supplemental,
      ...supplemental.flatMap((node) => Array.from(node.querySelectorAll("*")))
    ]))
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => !shouldSkipNode(node))
      .sort(compareDomOrder);

    const kindByNode = new Map();
    for (const node of all) {
      const kind = classifyBlockNode(node, root, supplementalSet);
      if (kind) kindByNode.set(node, kind);
    }

    const blocks = [];
    const classifications = [];
    let sequence = 0;

    for (const node of all) {
      const kind = kindByNode.get(node);
      if (!kind) continue;

      const owner = closestOwnedAncestor(node, kindByNode, root);
      if (owner) continue;

      if (isTextKind(kind) && hasOwnedDescendant(node, kindByNode)) continue;
      if (kind === "image" && node.closest("figure, [data-testid='card.wrapper']")) continue;

      let block = null;
      if (kind === "heading") block = extractHeadingBlock(node, root, title);
      else if (kind === "paragraph") block = extractParagraphBlock(node, root, title);
      else if (kind === "blockquote") block = extractQuoteBlock(node, root);
      else if (kind === "list") block = extractListBlock(node);
      else if (kind === "code") block = extractCodeBlock(node);
      else if (kind === "table") block = extractTableBlock(node);
      else if (kind === "figure") block = extractFigureBlock(node, coverSrc);
      else if (kind === "image") {
        const image = toImageData(node);
        if (image && !sameImage(image.src, coverSrc)) block = toImageBlock(image);
      }
      else if (kind === "media") block = extractMediaBlock(node);
      else if (kind === "embedded_post") block = extractEmbeddedPost(node);
      else if (kind === "link_card") block = extractLinkCard(node);
      else if (kind === "separator") block = { type: "separator" };

      if (block) {
        attachSourceOrder(block, node, sequence++);
        blocks.push(block);
        classifications.push({
          type: block.type,
          tag: node.tagName.toLowerCase(),
          hint: compactDomHint(node),
          textLength: normalizeText(node.textContent || "").length
        });
      }
    }

    // X Article currently renders many rich-media blocks (including screenshots of
    // code and equations) as siblings of twitterArticleRichTextView. It also
    // virtualizes them while scrolling. Merge both live DOM media and the rolling
    // capture inventory collected by background.js.
    for (const block of collectArticleMediaInventory(root, coverSrc)) {
      block.__sequence = sequence++;
      blocks.push(block);
    }
    for (const block of collectCapturedCodeBlocks(root)) {
      block.__sequence = sequence++;
      blocks.push(block);
    }
    for (const block of collectCapturedFormulaBlocks(root)) {
      block.__sequence = sequence++;
      blocks.push(block);
    }

    const ordered = sortBlocksBySourceOrder(blocks);
    const grouped = groupPseudoLists(mergeAdjacentCodeBlocks(deduplicateBlocks(ordered)));
    stripInternalBlockFields(grouped);
    return { blocks: grouped, diagnostics: buildDiagnostics(grouped, classifications) };
  }

  function attachSourceOrder(block, node, sequence) {
    block.__top = absoluteTop(node);
    block.__bottom = absoluteBottom(node);
    block.__sequence = sequence;
  }

  function sortBlocksBySourceOrder(blocks) {
    return blocks.slice().sort((a, b) => {
      const topA = Number.isFinite(a.__top) ? a.__top : Number.POSITIVE_INFINITY;
      const topB = Number.isFinite(b.__top) ? b.__top : Number.POSITIVE_INFINITY;
      if (Math.abs(topA - topB) > 2) return topA - topB;
      return (a.__sequence || 0) - (b.__sequence || 0);
    });
  }

  function stripInternalBlockFields(blocks) {
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      delete block.__top;
      delete block.__bottom;
      delete block.__sequence;
      if (block.type === "list") {
        for (const item of block.items || []) {
          for (const child of item.children || []) stripInternalBlockFields([child]);
        }
      }
    }
  }

  function findSupplementalRichBlocks(root) {
    const scope = root.closest("article") || root.parentElement?.parentElement || root.parentElement || document.body;
    const rootTop = absoluteTop(root);
    const rootBottom = absoluteBottom(root);
    const selectors = [
      "pre",
      ".public-DraftStyleDefault-pre",
      "[data-code-block]",
      "[data-block-type='code-block']",
      "[data-block-type='code']",
      "[class*='code-block']",
      "[class*='CodeBlock']"
    ].join(",");

    return Array.from(scope.querySelectorAll(selectors))
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => !root.contains(node))
      .filter((node) => {
        const top = absoluteTop(node);
        const bottom = absoluteBottom(node);
        return bottom >= rootTop - 300 && top <= rootBottom + 600;
      });
  }

  function compareDomOrder(a, b) {
    if (a === b) return 0;
    const relation = a.compareDocumentPosition(b);
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return absoluteTop(a) - absoluteTop(b);
  }

  function classifyBlockNode(node, root, supplementalSet = new Set()) {
    const inRoot = root.contains(node);
    const supplemental = supplementalSet.has(node);
    if (!isVisibleEnough(node) || (!inRoot && !supplemental)) return null;
    const tag = node.tagName.toLowerCase();

    if (isEmbeddedPostNode(node, root)) return "embedded_post";
    if (isLinkCardNode(node)) return "link_card";
    if (tag === "table") return "table";
    if (tag === "figure") return "figure";
    if (isMediaNode(node)) return "media";
    if (tag === "img" && toImageData(node)) return "image";
    if (tag === "hr") return "separator";
    if (tag === "ul" || tag === "ol") return "list";
    if (isCodeBlockNode(node)) return "code";
    if (isQuoteBlockNode(node)) return "blockquote";
    if (!inRoot) return null;
    if (isHeadingNode(node, root)) return "heading";
    if (isParagraphNode(node)) return "paragraph";
    return null;
  }

  function isTextKind(kind) {
    return kind === "heading" || kind === "paragraph";
  }

  function closestOwnedAncestor(node, kindByNode, root) {
    let parent = node.parentElement;
    while (parent && parent !== root) {
      const kind = kindByNode.get(parent);
      if (kind && OWNER_TYPES.has(kind)) return parent;
      parent = parent.parentElement;
    }
    return null;
  }

  function hasOwnedDescendant(node, kindByNode) {
    for (const descendant of node.querySelectorAll("*")) {
      const kind = kindByNode.get(descendant);
      if (kind && (OWNER_TYPES.has(kind) || isTextKind(kind))) return true;
    }
    return false;
  }

  function isVisibleEnough(node) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;
    const text = normalizeText(node.textContent || "");
    if (!text && !node.matches("img, video, figure, hr, table")) return false;
    return true;
  }

  function isEmbeddedPostNode(node, root) {
    if (node === root) return false;
    if (node.tagName !== "ARTICLE" && !node.matches("[data-testid='tweet']")) return false;
    return Boolean(node.querySelector("[data-testid='tweetText']") && node.querySelector("a[href*='/status/']"));
  }

  function isLinkCardNode(node) {
    return node.matches("[data-testid='card.wrapper'], [data-testid*='cardWrapper']") ||
      /(?:^|\s)(?:link[-_ ]?card|card-wrapper|summary-card)(?:\s|$)/i.test(`${node.className || ""} ${node.getAttribute("data-type") || ""}`);
  }

  function isMediaNode(node) {
    if (node.tagName === "VIDEO") return true;
    return node.matches("[data-testid='videoPlayer'], [data-testid='videoComponent'], [data-testid*='videoPlayer']") ||
      Boolean(node.querySelector(":scope > video"));
  }

  function isCodeBlockNode(node) {
    if (node.tagName === "PRE") return true;
    if (node.tagName === "CODE" && node.parentElement?.tagName === "PRE") return false;

    const token = compactDomHint(node);
    if (/\b(code[-_ ]?block|codeblock|editor-code|syntax|highlight|monaco|prism|public-DraftStyleDefault-pre|public-DraftStyleDefault-code)\b/i.test(token)) return true;
    if (node.hasAttribute("data-language") || node.hasAttribute("data-code-block")) return true;

    const text = node.innerText || node.textContent || "";
    if (normalizeText(text).length < 4) return false;
    const style = getComputedStyle(node);
    const family = style.fontFamily.toLowerCase();
    const mono = /mono|menlo|consolas|courier|code/.test(family);
    const preLike = /pre|break-spaces/.test(style.whiteSpace);
    const background = !isTransparentColor(style.backgroundColor);
    const multiline = text.includes("\n");
    const codeish = codePunctuationScore(text) >= 4;

    return mono && (preLike || (background && multiline) || (multiline && codeish));
  }

  function isQuoteBlockNode(node) {
    if (node.tagName === "BLOCKQUOTE") return true;
    const token = compactDomHint(node);
    if (/\b(blockquote|quote[-_ ]?block|editor-quote|pullquote)\b/i.test(token)) return true;

    const style = getComputedStyle(node);
    const border = px(style.borderLeftWidth);
    const hasBorder = border >= 2 && style.borderLeftStyle !== "none";
    const text = normalizeText(node.textContent || "");
    return hasBorder && text.length >= 8 && node.children.length <= 20;
  }

  function isHeadingNode(node, root) {
    if (/^H[1-6]$/.test(node.tagName) || node.matches("[role='heading']")) return true;
    if (!isParagraphNode(node)) return false;

    const text = normalizeText(node.textContent || "");
    if (text.length < 2 || text.length > 220 || text.includes("\n\n")) return false;
    if (/^[•◦▪‣*-]\s+|^\d+[.)]\s+/.test(text)) return false;

    const hint = compactDomHint(node);
    if (/\b(heading|header[-_ ]?(?:one|two|three|1|2|3)|title[-_ ]?block|editor-heading)\b/i.test(hint)) return true;

    const rootStyle = getComputedStyle(root);
    const style = getComputedStyle(node);
    const size = px(style.fontSize);
    const base = Math.max(12, px(rootStyle.fontSize));
    const ratio = size / base;
    const weight = Math.max(fontWeight(style.fontWeight), dominantFontWeight(node));
    const spacing = px(style.marginTop) + px(style.marginBottom);
    const short = text.length <= 160;
    const sentenceLike = /[.!?。！？]$/.test(text) && text.length > 60;
    const colonLabel = /[:：]$/.test(text) && text.length <= 120;

    if (ratio >= 1.28 && short) return true;
    if (ratio >= 1.14 && weight >= 600 && short) return true;
    if (!sentenceLike && weight >= 650 && short && (spacing >= 8 || colonLabel)) return true;
    if (colonLabel && text.length <= 110 && isFollowedByRichBlock(node, root)) return true;
    return false;
  }

  function isFollowedByRichBlock(node, root) {
    let current = node;
    for (let depth = 0; depth < 4 && current && current !== root; depth += 1) {
      let sibling = current.nextElementSibling;
      while (sibling) {
        const text = normalizeText(sibling.textContent || "");
        if (!text && !sibling.matches("pre, figure, img, video, ul, ol, table")) {
          sibling = sibling.nextElementSibling;
          continue;
        }
        return isCodeBlockNode(sibling) ||
          sibling.matches("pre, figure, img, video, ul, ol, table") ||
          Boolean(sibling.querySelector("pre, .public-DraftStyleDefault-pre, figure, video, ul, ol, table"));
      }
      current = current.parentElement;
    }
    return false;
  }

  function isParagraphNode(node) {
    if (node.matches("p, [data-block='true'], [role='paragraph'], [data-paragraph='true']")) return true;
    if (node.tagName !== "DIV") return false;

    const hint = compactDomHint(node);
    if (/\b(public-DraftStyleDefault-block|editor-paragraph|paragraph|lexical-paragraph)\b/i.test(hint)) return true;

    const text = normalizeText(node.textContent || "");
    if (text.length < 2) return false;
    if (node.querySelector(":scope > div, :scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > ul, :scope > ol, :scope > blockquote, :scope > pre, :scope > figure, :scope > table, :scope > article")) return false;
    const style = getComputedStyle(node);
    return ["block", "list-item"].includes(style.display) && node.children.length <= 30;
  }

  function extractHeadingBlock(node, root, title) {
    const text = normalizeText(node.textContent || "");
    if (!isUsefulText(text) || canonicalText(text) === canonicalText(title)) return null;
    const html = serializeInline(node);
    return {
      type: "heading",
      level: inferHeadingLevel(node, root),
      html,
      indent: detectIndentLevel(node, root)
    };
  }

  function inferHeadingLevel(node, root) {
    if (/^H[1-6]$/.test(node.tagName)) return Math.min(Math.max(Number(node.tagName.slice(1)), 2), 4);
    const aria = Number(node.getAttribute("aria-level"));
    if (aria) return Math.min(Math.max(aria, 2), 4);

    const size = px(getComputedStyle(node).fontSize);
    const base = Math.max(12, px(getComputedStyle(root).fontSize));
    const ratio = size / base;
    if (ratio >= 1.55) return 2;
    if (ratio >= 1.25) return 3;
    return 4;
  }

  function extractParagraphBlock(node, root, title) {
    const text = normalizeText(node.textContent || "");
    if (!isUsefulText(text) || canonicalText(text) === canonicalText(title)) return null;
    const html = serializeInline(node);
    if (!isUsefulText(normalizeText(stripHtml(html)))) return null;
    return {
      type: "paragraph",
      html,
      indent: detectIndentLevel(node, root),
      align: normalizeTextAlign(getComputedStyle(node).textAlign)
    };
  }

  function extractQuoteBlock(node, root) {
    const paragraphs = [];
    const paragraphNodes = Array.from(node.querySelectorAll("p, [data-block='true'], [role='paragraph']"))
      .filter((child) => !child.closest("blockquote blockquote"));

    if (paragraphNodes.length) {
      for (const paragraph of paragraphNodes) {
        const html = serializeInline(paragraph);
        if (isUsefulText(normalizeText(stripHtml(html)))) paragraphs.push(html);
      }
    } else {
      const html = serializeInline(node);
      if (isUsefulText(normalizeText(stripHtml(html)))) paragraphs.push(html);
    }

    if (!paragraphs.length) return null;
    return {
      type: "blockquote",
      paragraphs,
      indent: detectIndentLevel(node, root),
      cite: detectQuoteCitation(node)
    };
  }

  function detectQuoteCitation(node) {
    const cite = node.getAttribute("cite") || node.querySelector("cite")?.textContent || "";
    return normalizeText(cite) || undefined;
  }

  function extractListBlock(node) {
    const items = Array.from(node.children)
      .filter((child) => child.tagName === "LI")
      .map((item) => extractListItem(item))
      .filter(Boolean);
    if (!items.length) return null;
    return {
      type: "list",
      ordered: node.tagName === "OL",
      start: Number(node.getAttribute("start")) || undefined,
      items
    };
  }

  function extractListItem(item) {
    const clone = item.cloneNode(true);
    for (const nested of clone.querySelectorAll("ul, ol")) nested.remove();
    const temp = document.createElement("div");
    temp.append(...Array.from(clone.childNodes));
    const html = serializeInline(temp);
    const children = Array.from(item.children)
      .filter((child) => child.tagName === "UL" || child.tagName === "OL")
      .map((child) => extractListBlock(child))
      .filter(Boolean);
    if (!isUsefulText(normalizeText(stripHtml(html))) && !children.length) return null;
    return { html, children };
  }

  function extractCodeBlock(node) {
    const leafBlocks = Array.from(node.querySelectorAll("[data-block='true']"))
      .filter((block) => !block.querySelector("[data-block='true']"));

    let text = leafBlocks.length > 1
      ? leafBlocks.map((block) => block.innerText || block.textContent || "").join("\n")
      : node.innerText || node.textContent || "";

    text = text
      .replace(/\u2028|\u2029/g, "\n")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/^\n+|\n+$/g, "");

    if (!text.trim()) return null;
    const language = node.getAttribute("data-language") ||
      node.querySelector("[data-language]")?.getAttribute("data-language") ||
      inferCodeLanguageFromClass(compactDomHint(node)) || inferCodeLanguageFromText(text);
    return {
      type: "code",
      text,
      language: language || undefined,
      lineCount: text.split("\n").length
    };
  }

  function inferCodeLanguageFromClass(value) {
    return value.match(/(?:language|lang)[-_]([A-Za-z0-9+#.-]+)/i)?.[1];
  }

  function extractTableBlock(node) {
    const rows = Array.from(node.querySelectorAll("tr"))
      .map((row) => Array.from(row.querySelectorAll(":scope > th, :scope > td"))
        .map((cell) => ({
          header: cell.tagName === "TH",
          html: serializeInline(cell),
          colspan: Number(cell.getAttribute("colspan")) || undefined,
          rowspan: Number(cell.getAttribute("rowspan")) || undefined
        })))
      .filter((row) => row.length > 0);
    if (!rows.length) return null;
    return { type: "table", rows };
  }

  function extractFigureBlock(node, coverSrc) {
    const image = Array.from(node.querySelectorAll("img")).map(toImageData).find(Boolean);
    if (!image || sameImage(image.src, coverSrc)) return null;
    const caption = normalizeText(node.querySelector("figcaption")?.textContent || "");
    return toImageBlock(image, caption);
  }

  function extractMediaBlock(node) {
    const video = node.tagName === "VIDEO" ? node : node.querySelector("video");
    const posterRaw = video?.poster || node.querySelector("img")?.currentSrc || node.querySelector("img")?.src || "";
    const poster = posterRaw ? normalizeMediaUrl(posterRaw) : undefined;
    const sourceUrl = findNearestStatusUrl(node);
    const hint = `${node.getAttribute("aria-label") || ""} ${node.textContent || ""}`;
    const mediaType = /gif/i.test(hint) ? "gif" : "video";
    if (!poster && !sourceUrl) return null;
    return {
      type: "media",
      mediaType,
      poster,
      sourceUrl,
      caption: mediaType === "gif" ? "GIF" : l("Video", "视频")
    };
  }

  function collectMediaBlocks(root, excludedRoots = new Set()) {
    const nodes = Array.from(root.querySelectorAll("video, [data-testid='videoPlayer'], [data-testid='videoComponent']"));
    const output = [];
    const seen = new Set();
    for (const node of nodes) {
      if (isInsideAny(node, excludedRoots)) continue;
      const owner = node.closest("[data-testid='videoPlayer'], [data-testid='videoComponent']") || node;
      if (seen.has(owner)) continue;
      seen.add(owner);
      const block = extractMediaBlock(owner);
      if (block) output.push({ node: owner, block });
    }
    return output;
  }

  function extractEmbeddedPost(node) {
    const textNode = node.querySelector("[data-testid='tweetText']");
    if (!textNode) return null;
    const url = findNearestStatusUrl(node);
    const handle = detectAuthorHandle(node, url ? new URL(url).pathname : "");
    const name = detectAuthorName(node, handle);
    const time = node.querySelector("time[datetime]")?.getAttribute("datetime") || undefined;
    const html = serializeInline(textNode);
    const images = collectContentImages(node).slice(0, 4).map((image) => toImageBlock(image));
    return {
      type: "embedded_post",
      authorName: name,
      authorHandle: handle,
      publishedAt: time,
      html,
      sourceUrl: url,
      images
    };
  }

  function collectEmbeddedPosts(root, excludeNode) {
    return Array.from(root.querySelectorAll("article, [data-testid='tweet']"))
      .filter((node) => node !== excludeNode)
      .filter((node) => isEmbeddedPostNode(node, root))
      .map((node) => ({ node, block: extractEmbeddedPost(node) }))
      .filter((item) => item.block);
  }

  function extractLinkCard(node) {
    const anchor = node.matches("a[href]") ? node : node.querySelector("a[href]");
    if (!anchor) return null;
    let href;
    try {
      href = new URL(anchor.getAttribute("href"), location.href).href;
    } catch {
      return null;
    }

    const image = Array.from(node.querySelectorAll("img")).map(toImageData).find(Boolean);
    const textNodes = Array.from(node.querySelectorAll("span, div"))
      .map((child) => normalizeText(child.textContent || ""))
      .filter((text) => text.length >= 2 && text.length <= 300);
    const unique = [...new Set(textNodes)];
    const title = unique.find((text) => text.length <= 160) || normalizeText(anchor.textContent || "") || href;
    const description = unique.find((text) => text !== title && text.length > title.length) || undefined;
    let hostname;
    try { hostname = new URL(href).hostname; } catch { hostname = undefined; }

    return {
      type: "link_card",
      url: href,
      title,
      description,
      hostname,
      image: image?.src
    };
  }

  function collectLinkCards(root, excludedRoots = new Set()) {
    return Array.from(root.querySelectorAll("[data-testid='card.wrapper'], [data-testid*='cardWrapper']"))
      .filter((node) => !isInsideAny(node, excludedRoots))
      .map(extractLinkCard)
      .filter(Boolean);
  }

  function extractPoll(root) {
    const poll = root.querySelector("[data-testid='cardPoll'], [data-testid*='poll']");
    if (!poll) return null;
    const options = Array.from(poll.querySelectorAll("[role='radio'], [data-testid*='choice'], [data-testid*='option']"))
      .map((node) => normalizeText(node.textContent || ""))
      .filter(Boolean);
    if (!options.length) {
      const text = normalizeText(poll.textContent || "");
      if (!text) return null;
      return { type: "poll", options: [text] };
    }
    return { type: "poll", options: [...new Set(options)] };
  }

  function shouldSkipNode(node) {
    if (node.closest([
      "button", "nav", "aside", "form",
      "[aria-hidden='true']",
      "[role='navigation']", "[role='menu']", "[role='dialog']",
      "[data-testid='User-Name']",
      "[data-testid='reply']", "[data-testid='retweet']", "[data-testid='like']",
      "[data-testid='bookmark']", "[data-testid='caret']"
    ].join(","))) return true;

    const hint = compactDomHint(node);
    return /\b(toolbar|menu|navigation|reaction|engagement|follow-button|tweet-actions)\b/i.test(hint);
  }

  function collectContentImages(root) {
    const candidates = [
      ...Array.from(root.querySelectorAll("img")).map(toImageData),
      ...Array.from(root.querySelectorAll("[role='img'], [style*='background-image']")).map(toBackgroundImageData)
    ].filter(Boolean);

    const unique = new Map();
    for (const image of candidates) {
      const key = normalizedImageUrl(image.src);
      const existing = unique.get(key);
      if (!existing || image.area > existing.area) unique.set(key, image);
    }
    return Array.from(unique.values());
  }

  function toImageData(node) {
    if (!(node instanceof HTMLImageElement)) return null;
    const rawSrc = bestImageSource(node);
    return buildImageData(node, rawSrc, normalizeText(node.alt || ""));
  }

  function bestImageSource(node) {
    const values = [node.currentSrc, node.src, node.getAttribute("src")];
    const srcset = node.getAttribute("srcset") || node.closest("picture")?.querySelector("source[srcset]")?.getAttribute("srcset") || "";
    if (srcset) {
      const entries = srcset.split(",").map((entry) => entry.trim()).filter(Boolean);
      const last = entries.at(-1)?.split(/\s+/)[0];
      if (last) values.unshift(last);
    }
    return values.find((value) => value && !String(value).startsWith("data:") && !String(value).startsWith("blob:")) || "";
  }

  function toBackgroundImageData(node) {
    if (!(node instanceof HTMLElement) || node instanceof HTMLImageElement) return null;
    const style = getComputedStyle(node);
    const match = String(style.backgroundImage || "").match(/url\(["']?([^"')]+)["']?\)/i);
    return buildImageData(node, match?.[1] || "", normalizeText(node.getAttribute("aria-label") || ""));
  }

  function buildImageData(node, rawSrc, alt = "") {
    if (!rawSrc || String(rawSrc).startsWith("data:") || String(rawSrc).startsWith("blob:")) return null;
    const src = normalizeXMediaUrl(rawSrc);
    if (!src) return null;

    const rect = node.getBoundingClientRect();
    const naturalWidth = node instanceof HTMLImageElement ? node.naturalWidth : 0;
    const naturalHeight = node instanceof HTMLImageElement ? node.naturalHeight : 0;
    const width = naturalWidth || Math.round(rect.width) || Number(node.getAttribute("width")) || 0;
    const height = naturalHeight || Math.round(rect.height) || Number(node.getAttribute("height")) || 0;
    const renderedWidth = Math.round(rect.width) || width;
    const renderedHeight = Math.round(rect.height) || height;
    const area = Math.max(width * height, renderedWidth * renderedHeight);

    if (width > 0 && height > 0) {
      if (width < 150 || height < 80 || area < 32_000) return null;
      const ratio = width / height;
      if (ratio < 0.08 || ratio > 12) return null;
    }

    const contextHint = compactDomHint(node.closest("figure, [role='group'], div") || node);
    if (/avatar|emoji|badge|icon|profile|UserAvatar/i.test(contextHint) && area < 250_000) return null;

    return {
      node,
      src,
      alt,
      width, height, renderedWidth, renderedHeight, area,
      top: absoluteTop(node),
      bottom: absoluteBottom(node),
      contextHint
    };
  }

  function normalizeXMediaUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com") return null;
      const allowedPath = [
        "/media/", "/amplify_video_thumb/", "/ext_tw_video_thumb/", "/tweet_video_thumb/"
      ].some((prefix) => url.pathname.startsWith(prefix));
      if (!allowedPath) return null;
      if (url.pathname.startsWith("/media/")) url.searchParams.set("name", "large");
      return url.href;
    } catch {
      return null;
    }
  }

  function collectArticleMediaInventory(root, coverSrc) {
    const rootTop = absoluteTop(root);
    const rootBottom = absoluteBottom(root);
    const scope = findArticleMediaScope(root);
    const items = [];

    for (const image of collectContentImages(scope)) {
      if (sameImage(image.src, coverSrc)) continue;
      if (image.bottom < rootTop - 1200 || image.top > rootBottom + 1600) continue;
      const block = toImageBlock(image);
      block.__top = image.top;
      block.__bottom = image.bottom;
      block.__source = "live-media";
      items.push(block);
    }

    const capture = getCaptureSnapshot();
    for (const media of capture.media || []) {
      const src = normalizeXMediaUrl(media.src || media.poster || "");
      if (!src || sameImage(src, coverSrc)) continue;
      const top = Number(media.top);
      const bottom = Number(media.bottom);
      if (Number.isFinite(bottom) && bottom < rootTop - 1600) continue;
      if (Number.isFinite(top) && top > rootBottom + 2200) continue;
      if (/avatar|emoji|badge|icon|profile|UserAvatar/i.test(String(media.contextHint || "")) && Number(media.area || 0) < 250_000) continue;

      let block;
      if (media.mediaType === "video" || media.mediaType === "gif") {
        block = {
          type: "media",
          mediaType: media.mediaType,
          poster: src,
          sourceUrl: safeAbsoluteHttpUrl(media.sourceUrl),
          caption: media.mediaType === "gif" ? "GIF" : l("Video", "视频")
        };
      } else {
        block = {
          type: "image",
          src,
          alt: normalizeText(media.alt || "") || undefined,
          width: Number(media.width) || undefined,
          height: Number(media.height) || undefined
        };
      }
      block.__top = Number.isFinite(top) ? top : Number.POSITIVE_INFINITY;
      block.__bottom = Number.isFinite(bottom) ? bottom : block.__top;
      block.__source = "scroll-capture";
      block.__beforeText = normalizeText(media.beforeText || "");
      block.__afterText = normalizeText(media.afterText || "");
      items.push(block);
    }

    return dedupeMediaInventory(items, root);
  }

  function collectCapturedCodeBlocks(root) {
    const capture = getCaptureSnapshot();
    const rootTop = absoluteTop(root);
    const rootBottom = absoluteBottom(root);
    const output = [];
    for (const item of capture.codes || []) {
      const text = String(item.text || "").replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
      if (text.trim().length < 4) continue;
      const top = Number(item.top);
      const bottom = Number(item.bottom);
      if (Number.isFinite(bottom) && bottom < rootTop - 1000) continue;
      if (Number.isFinite(top) && top > rootBottom + 1800) continue;
      output.push({
        type: "code",
        text,
        language: item.language || inferCodeLanguageFromText(text),
        lineCount: text.split("\n").length,
        __top: Number.isFinite(top) ? top : Number.POSITIVE_INFINITY,
        __bottom: Number.isFinite(bottom) ? bottom : top,
        __source: "scroll-capture-code"
      });
    }
    return output;
  }

  function collectCapturedFormulaBlocks(root) {
    const capture = getCaptureSnapshot();
    const rootTop = absoluteTop(root);
    const rootBottom = absoluteBottom(root);
    const output = [];
    for (const item of capture.formulas || []) {
      const latex = String(item.latex || "").trim();
      const mathml = String(item.mathml || "").trim();
      if (!latex && !mathml) continue;
      const top = Number(item.top);
      const bottom = Number(item.bottom);
      if (Number.isFinite(bottom) && bottom < rootTop - 1000) continue;
      if (Number.isFinite(top) && top > rootBottom + 1800) continue;
      output.push({
        type: "formula",
        latex: latex || undefined,
        mathml: mathml || undefined,
        display: item.display !== false,
        entityReference: item.entityReference || undefined,
        resolutionSource: "scroll-capture-formula",
        __top: Number.isFinite(top) ? top : Number.POSITIVE_INFINITY,
        __bottom: Number.isFinite(bottom) ? bottom : top,
        __source: "scroll-capture-formula"
      });
    }
    return output;
  }

  function findArticleMediaScope(root) {
    let node = root;
    let best = root;
    const main = root.closest("main") || document.querySelector("main") || document.body;
    while (node.parentElement && node !== main) {
      node = node.parentElement;
      const textLength = normalizeText(node.innerText || "").length;
      const imageCount = node.querySelectorAll("img, [role='img'], [style*='background-image']").length;
      if (textLength >= normalizeText(root.innerText || "").length * 0.9) best = node;
      if (imageCount > 0 && node.getBoundingClientRect().width <= root.getBoundingClientRect().width * 1.8) best = node;
      if (node.tagName === "ARTICLE") return node;
    }
    return best === root ? main : best;
  }

  function getCaptureSnapshot() {
    const value = globalThis.__XPDF_CAPTURE__;
    if (!value || typeof value !== "object") return { media: [], codes: [], formulas: [] };
    return {
      media: Array.isArray(value.media) ? value.media : [],
      codes: Array.isArray(value.codes) ? value.codes : [],
      formulas: Array.isArray(value.formulas) ? value.formulas : [],
      scans: Number(value.scans) || 0
    };
  }

  function dedupeMediaInventory(items, root) {
    const byKey = new Map();
    for (const block of items) {
      const key = block.type === "media"
        ? normalizedImageUrl(block.poster || "")
        : normalizedImageUrl(block.src || "");
      if (!key) continue;
      const previous = byKey.get(key);
      if (!previous || mediaBlockScore(block, root) > mediaBlockScore(previous, root)) byKey.set(key, block);
    }
    return Array.from(byKey.values());
  }

  function mediaBlockScore(block, root) {
    let score = 0;
    if (block.__source === "live-media") score += 200;
    if (Number.isFinite(block.__top)) score += 100;
    if (block.__beforeText || block.__afterText) score += 60;
    if (block.type === "image") score += Math.min(Number(block.width || 0), 2000) / 10;
    const top = Number(block.__top);
    if (Number.isFinite(top)) {
      const rootTop = absoluteTop(root);
      const rootBottom = absoluteBottom(root);
      if (top >= rootTop - 400 && top <= rootBottom + 400) score += 100;
    }
    return score;
  }

  function toImageBlock(image, caption = "") {
    return {
      type: "image",
      src: image.src,
      alt: image.alt || undefined,
      caption: caption || undefined,
      width: image.width || undefined,
      height: image.height || undefined
    };
  }

  function normalizeMediaUrl(value) {
    return normalizeXMediaUrl(value) || undefined;
  }

  function normalizedImageUrl(value) {
    try {
      const url = new URL(value);
      url.searchParams.delete("name");
      return url.href;
    } catch {
      return value;
    }
  }

  function sameImage(a, b) {
    return Boolean(a && b && normalizedImageUrl(a) === normalizedImageUrl(b));
  }

  function serializeInline(root) {
    const reference = root instanceof Element ? (root.parentElement || root) : null;
    const baseStyle = reference ? getComputedStyle(reference) : null;
    return applyMathTypography(cleanupInlineHtml(serializeChildren(root, baseStyle, root)));
  }

  function serializeChildren(parent, baseStyle, blockRoot) {
    return Array.from(parent.childNodes).map((child) => serializeInlineNode(child, baseStyle, blockRoot)).join("");
  }

  function serializeInlineNode(node, baseStyle, blockRoot) {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue || "");
    if (!(node instanceof Element)) return "";
    if (node.getAttribute("aria-hidden") === "true") return "";

    const tag = node.tagName;
    if (tag === "BR") return "<br>";
    if (tag === "IMG") return escapeHtml(node.getAttribute("alt") || "");
    if (["SCRIPT", "STYLE", "NOSCRIPT", "BUTTON", "SVG"].includes(tag)) {
      return node.getAttribute("aria-label") ? escapeHtml(node.getAttribute("aria-label")) : "";
    }

    let content = serializeChildren(node, baseStyle, blockRoot);
    if (!content) return "";

    const style = getComputedStyle(node);
    const baseWeight = baseStyle ? fontWeight(baseStyle.fontWeight) : 400;
    const weight = fontWeight(style.fontWeight);
    const semanticStrong = tag === "STRONG" || tag === "B";
    const semanticEm = tag === "EM" || tag === "I";
    const semanticStrike = tag === "S" || tag === "STRIKE" || tag === "DEL";
    const semanticCode = tag === "CODE";
    const semanticUnderline = tag === "U";
    const decoration = `${style.textDecorationLine || ""} ${style.textDecoration || ""}`;
    const family = style.fontFamily.toLowerCase();
    const baseFamily = baseStyle?.fontFamily?.toLowerCase() || "";

    const wrappers = [];
    if (semanticCode || (/mono|menlo|consolas|courier/.test(family) && !/mono|menlo|consolas|courier/.test(baseFamily))) wrappers.push("code");
    if (semanticStrong || (weight >= 600 && weight >= baseWeight + 100)) wrappers.push("strong");
    if (semanticEm || (style.fontStyle === "italic" && baseStyle?.fontStyle !== "italic")) wrappers.push("em");
    if (semanticStrike || decoration.includes("line-through")) wrappers.push("s");
    if (semanticUnderline || (decoration.includes("underline") && tag !== "A")) wrappers.push("u");
    if (tag === "SUP" || style.verticalAlign === "super" || isVisualSuperscript(node, style, baseStyle)) wrappers.push("sup");
    if (tag === "SUB" || style.verticalAlign === "sub" || isVisualSubscript(node, style, baseStyle)) wrappers.push("sub");

    for (const wrapper of [...new Set(wrappers)].reverse()) content = `<${wrapper}>${content}</${wrapper}>`;

    if (tag === "A") {
      const href = safeAbsoluteHttpUrl(node.getAttribute("href"));
      if (href) content = `<a href="${escapeAttribute(href)}">${content}</a>`;
    }

    if (node !== blockRoot && ["DIV", "P"].includes(tag)) content = `<br>${content}<br>`;
    return content;
  }

  function isVisualSuperscript(node, style, baseStyle) {
    const baseSize = px(baseStyle?.fontSize || "0");
    const size = px(style.fontSize);
    const top = px(style.top);
    const transform = style.transform || "";
    return baseSize > 0 && size > 0 && size <= baseSize * 0.86 &&
      (top < -0.5 || /translateY\(\s*-/.test(transform));
  }

  function isVisualSubscript(node, style, baseStyle) {
    const baseSize = px(baseStyle?.fontSize || "0");
    const size = px(style.fontSize);
    const top = px(style.top);
    const transform = style.transform || "";
    return baseSize > 0 && size > 0 && size <= baseSize * 0.86 &&
      (top > 0.5 || /translateY\(\s*[1-9]/.test(transform));
  }

  function applyMathTypography(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const textNode of textNodes) {
      const parent = textNode.parentElement;
      if (parent?.closest("code, pre, sup, sub")) continue;
      const value = textNode.nodeValue || "";
      const regex = /([A-Za-z0-9\)\]\}α-ωΑ-Ω])\^(\{[^{}\s]{1,24}\}|[-+]?(?:\d+(?:\.\d+)?|[A-Za-zα-ωΑ-Ω][A-Za-z0-9α-ωΑ-Ω]*))/g;
      let match;
      let last = 0;
      const fragment = document.createDocumentFragment();
      let changed = false;

      while ((match = regex.exec(value))) {
        changed = true;
        fragment.append(document.createTextNode(value.slice(last, match.index) + match[1]));
        const sup = document.createElement("sup");
        sup.textContent = match[2].replace(/^\{|\}$/g, "");
        fragment.append(sup);
        last = match.index + match[0].length;
      }

      if (changed) {
        fragment.append(document.createTextNode(value.slice(last)));
        textNode.replaceWith(fragment);
      }
    }
    return template.innerHTML;
  }

  function cleanupInlineHtml(html) {
    return String(html || "")
      .replace(/(?:<br>\s*){3,}/g, "<br><br>")
      .replace(/^(?:\s|<br>)+|(?:\s|<br>)+$/g, "")
      .trim();
  }

  function safeAbsoluteHttpUrl(value) {
    try {
      const url = new URL(value || "", location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function findNearestStatusUrl(node) {
    const anchor = node.matches("a[href*='/status/']") ? node : node.querySelector("a[href*='/status/']") || node.closest("a[href*='/status/']");
    return anchor ? safeAbsoluteHttpUrl(anchor.getAttribute("href")) : undefined;
  }

  function detectIndentLevel(node, root) {
    const delta = Math.max(0, node.getBoundingClientRect().left - root.getBoundingClientRect().left);
    const style = getComputedStyle(node);
    const explicit = px(style.marginLeft) + px(style.paddingLeft);
    return Math.min(4, Math.max(0, Math.round(Math.max(delta, explicit) / 24)));
  }

  function normalizeTextAlign(value) {
    return ["left", "center", "right", "justify"].includes(value) ? value : undefined;
  }

  function mergeAdjacentCodeBlocks(blocks) {
    const output = [];
    for (const block of blocks) {
      const previous = output[output.length - 1];
      if (block?.type === "code" && previous?.type === "code") {
        previous.text = `${previous.text.replace(/\n+$/g, "")}\n${String(block.text || "").replace(/^\n+/g, "")}`;
        previous.lineCount = previous.text.split("\n").length;
        previous.language = previous.language || block.language;
      } else {
        output.push(block);
      }
    }
    return output;
  }

  function groupPseudoLists(blocks) {
    const output = [];
    let index = 0;
    while (index < blocks.length) {
      const block = blocks[index];
      if (block.type !== "paragraph") {
        output.push(block);
        index += 1;
        continue;
      }

      const first = parsePseudoListItem(block);
      if (!first) {
        output.push(block);
        index += 1;
        continue;
      }

      const items = [first.item];
      let cursor = index + 1;
      while (cursor < blocks.length) {
        const parsed = blocks[cursor].type === "paragraph" ? parsePseudoListItem(blocks[cursor]) : null;
        if (!parsed || parsed.ordered !== first.ordered) break;
        items.push(parsed.item);
        cursor += 1;
      }

      if (items.length >= 2) {
        output.push({ type: "list", ordered: first.ordered, items });
        index = cursor;
      } else {
        output.push(block);
        index += 1;
      }
    }
    return output;
  }

  function parsePseudoListItem(block) {
    const text = normalizeText(stripHtml(block.html || ""));
    const bullet = text.match(/^[•◦▪‣*-]\s+(.+)$/s);
    const number = text.match(/^\d+[.)]\s+(.+)$/s);
    const match = bullet || number;
    if (!match) return null;
    return {
      ordered: Boolean(number),
      item: { html: escapeHtml(match[1]), children: [] }
    };
  }

  function deduplicateBlocks(blocks) {
    const output = [];
    const exactText = new Set();
    const exactImages = new Set();

    for (const block of blocks) {
      if (["paragraph", "heading"].includes(block.type)) {
        const text = normalizeText(stripHtml(block.html || ""));
        const canonical = canonicalText(text);
        if (!canonical || exactText.has(`text:${canonical}`)) continue;

        const recent = output.slice(-6).filter((item) => ["paragraph", "blockquote"].includes(item.type));
        if (recent.some((item) => isContainedTextDuplicate(canonical, canonicalBlockText(item)))) continue;

        exactText.add(`text:${canonical}`);
        output.push(block);
        continue;
      }

      if (block.type === "blockquote") {
        const canonical = canonicalText((block.paragraphs || [block.html || ""]).map(stripHtml).join(" "));
        if (!canonical || exactText.has(`text:${canonical}`)) continue;
        exactText.add(`text:${canonical}`);
        output.push(block);
        continue;
      }

      if (block.type === "list") {
        const canonical = canonicalText(flattenListText(block));
        if (!canonical || exactText.has(`list:${canonical}`)) continue;
        exactText.add(`list:${canonical}`);
        output.push(block);
        continue;
      }

      if (block.type === "code") {
        const canonical = normalizeText(block.text || "");
        if (!canonical || exactText.has(`code:${canonical}`)) continue;
        exactText.add(`code:${canonical}`);
        output.push(block);
        continue;
      }

      if (block.type === "formula") {
        const canonical = String(block.latex || block.mathml || "").replace(/\s+/g, " ").trim();
        if (!canonical || exactText.has(`formula:${canonical}`)) continue;
        exactText.add(`formula:${canonical}`);
        output.push(block);
        continue;
      }

      if (block.type === "image") {
        const key = normalizedImageUrl(block.src || "");
        if (!key || exactImages.has(key)) continue;
        exactImages.add(key);
        output.push(block);
        continue;
      }

      if (block.type === "media") {
        const key = normalizedImageUrl(block.poster || "") || block.sourceUrl;
        if (key && exactImages.has(key)) continue;
        if (key) exactImages.add(key);
        output.push(block);
        continue;
      }

      if (block.type === "separator" && output.at(-1)?.type === "separator") continue;
      output.push(block);
    }
    return output;
  }

  function canonicalBlockText(block) {
    if (block.type === "blockquote") return canonicalText((block.paragraphs || []).map(stripHtml).join(" "));
    return canonicalText(stripHtml(block.html || ""));
  }

  function isContainedTextDuplicate(a, b) {
    if (!a || !b || a.length < 20 || b.length < 20) return false;
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return shorter / longer >= 0.62 && (a.includes(b) || b.includes(a));
  }

  function flattenListText(block) {
    return (block.items || []).map((item) => `${stripHtml(item.html || "")} ${(item.children || []).map(flattenListText).join(" ")}`).join(" ");
  }

  function buildDiagnostics(blocks, classifications) {
    const counts = {};
    for (const block of blocks) counts[block.type] = (counts[block.type] || 0) + 1;
    const capture = getCaptureSnapshot();
    return {
      extractorVersion: "0.12.0",
      blockCounts: counts,
      mediaCapture: {
        scans: capture.scans,
        mediaCandidates: capture.media.length,
        codeCandidates: capture.codes.length,
        formulaCandidates: capture.formulas.length
      },
      classifiedNodes: classifications.slice(0, 250),
      bodySelector: compactDomHint(findArticleBody() || document.body)
    };
  }

  function compactDomHint(node) {
    if (!(node instanceof Element)) return "";
    const values = [
      node.id,
      typeof node.className === "string" ? node.className : "",
      node.getAttribute("data-testid"),
      node.getAttribute("data-block-type"),
      node.getAttribute("data-lexical-decorator"),
      node.getAttribute("role")
    ].filter(Boolean).join(" ");
    return values.replace(/\s+/g, " ").slice(0, 240);
  }

  function dominantFontWeight(node) {
    let weighted = 0;
    let total = 0;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = normalizeText(walker.currentNode.nodeValue || "");
      if (!text) continue;
      const parent = walker.currentNode.parentElement;
      if (!parent) continue;
      const length = text.length;
      weighted += fontWeight(getComputedStyle(parent).fontWeight) * length;
      total += length;
    }
    return total ? weighted / total : fontWeight(getComputedStyle(node).fontWeight);
  }

  function codePunctuationScore(text) {
    const patterns = [/=>/g, /\b(?:const|let|var|def|class|return|import|from|if|else|for|while)\b/g, /[{};][\s\n]/g, /\([^\n]*\)/g, /^\s{2,}\S/gm, /\[[^\]]+\]/g];
    return patterns.reduce((score, pattern) => score + (text.match(pattern)?.length || 0), 0);
  }

  function inferCodeLanguageFromText(text) {
    if (/\b(?:def|import|from)\s+\w+|:\s*(?:#.*)?$/m.test(text)) return "python";
    if (/\b(?:const|let|var|function)\b|=>/.test(text)) return "javascript";
    if (/<\/?[A-Za-z][^>]*>/.test(text)) return "html";
    return undefined;
  }

  function fontWeight(value) {
    if (value === "bold") return 700;
    if (value === "normal") return 400;
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? number : 400;
  }

  function px(value) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : 0;
  }

  function isTransparentColor(value) {
    return !value || value === "transparent" || /^rgba\([^)]*,\s*0\s*\)$/.test(value);
  }

  function stripHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    return template.content.textContent || "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/[\u200b-\u200d\ufeff\ufffe]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function canonicalText(value) {
    return normalizeText(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "").trim();
  }

  function isUsefulText(text) {
    if (!text || text.length < 2) return false;
    return !/^(Reply|Repost|Like|Bookmark|Share|Show more|Translate post|Post your reply|Follow|Following|回复|转发|喜欢|点赞|收藏|分享|显示更多|翻译帖子|关注)$/i.test(text);
  }

  function isInsideAny(node, roots) {
    for (const root of roots) if (root.contains(node)) return true;
    return false;
  }

  function absoluteTop(node) {
    const rect = node.getBoundingClientRect();
    return rect.top + window.scrollY;
  }

  function absoluteBottom(node) {
    const rect = node.getBoundingClientRect();
    return rect.bottom + window.scrollY;
  }
})();
