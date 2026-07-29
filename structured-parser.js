(function initXpdfStructured(global) {
  "use strict";

  const CODE_INTRO_RE = /(?:would look like this|code(?: changes)? (?:is|are) shown below|pseudocode below|implementation(?: is|:)|rewrite(?:s| the)? .+ from|reparameterized form is|compute all .+ at once|following code|代码如下|伪代码如下)\s*[:：]?$/i;
  const SAFE_MEDIA_PATHS = ["/media/", "/amplify_video_thumb/", "/ext_tw_video_thumb/", "/tweet_video_thumb/"];

  function parseCapturedArticle({ payloads, articleUrl, expectedId, fallbackDocument }) {
    const inputPayloads = Array.isArray(payloads) ? payloads : [];
    const candidates = [];

    inputPayloads.forEach((entry, index) => {
      const json = entry && Object.prototype.hasOwnProperty.call(entry, "json") ? entry.json : entry;
      collectArticleCandidates(json, candidates, [], expectedId, index);
    });

    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates[0] || null;
    if (!selected) {
      return {
        ok: false,
        error: "未在 X 后端响应中找到包含 title 和 content_state 的 Article 数据。",
        diagnostics: {
          acquisition: {
            method: "captured-response",
            responseMatched: false,
            payloadCount: inputPayloads.length
          }
        }
      };
    }

    const article = selected.article;
    const contentState = normalizeContentState(selected.contentState);
    if (!contentState || !Array.isArray(contentState.blocks)) {
      return {
        ok: false,
        error: "已找到 Article 数据，但 content_state 无法解析。",
        diagnostics: {
          acquisition: {
            method: "captured-response",
            responseMatched: true,
            candidatePath: selected.path.join("."),
            payloadCount: inputPayloads.length
          }
        }
      };
    }

    const rawPayloads = inputPayloads.map((entry) => entry?.json ?? entry);
    const mediaIndex = buildMediaIndex(rawPayloads);
    const embeddedPostIndex = buildEmbeddedPostIndex(rawPayloads);
    const formulaIndex = buildFormulaIndex(rawPayloads);
    const fallbackImages = Array.isArray(fallbackDocument?.blocks)
      ? fallbackDocument.blocks.filter((block) => block?.type === "image" || block?.type === "media")
      : [];
    const fallbackFormulas = Array.isArray(fallbackDocument?.blocks)
      ? fallbackDocument.blocks.filter((block) => block?.type === "formula")
      : [];

    const parseContext = {
      article,
      articleUrl,
      expectedId,
      mediaIndex,
      embeddedPostIndex,
      formulaIndex,
      formulaEntityCursor: 0,
      fallbackImages,
      fallbackImageCursor: 0,
      fallbackFormulas,
      fallbackFormulaByRef: new Map(fallbackFormulas
        .filter((block) => block?.entityReference)
        .map((block) => [String(block.entityReference), block])),
      fallbackFormulaCursor: 0,
      entityStats: {
        markdown: 0,
        media: 0,
        formula: 0,
        embeddedPost: 0,
        link: 0,
        unknown: 0
      },
      unresolvedMedia: [],
      unresolvedFormulas: [],
      formulaResolutions: [],
      unknownEntities: []
    };

    const parsed = parseDraftContentState(contentState, parseContext);
    const title = normalizeTitle(article.title || selected.title);
    if (!title) {
      return {
        ok: false,
        error: "Article 后端数据中没有可靠的 title 字段。",
        diagnostics: {
          acquisition: {
            method: "captured-response",
            responseMatched: true,
            candidatePath: selected.path.join(".")
          }
        }
      };
    }

    const author = findAuthorMetadata(inputPayloads, articleUrl, fallbackDocument);
    const post = findPostMetadata(inputPayloads, expectedId, fallbackDocument);
    const coverImage = resolveCoverImage(article, mediaIndex) || normalizeMediaUrl(fallbackDocument?.metadata?.coverImage) || undefined;
    const blocks = mergeAdjacentCodeBlocks(parsed.blocks);
    const completeness = analyzeCompleteness(blocks, parseContext.entityStats, parsed.rawBlockTypes, parseContext.unresolvedFormulas);
    const outputCounts = countBy(blocks, (block) => block.type);

    const sourceUrl = canonicalArticleUrl(articleUrl, expectedId, author.handle);
    const document = {
      version: 2,
      source: {
        platform: "x",
        url: sourceUrl,
        postId: expectedId || extractNumericId(articleUrl),
        capturedAt: new Date().toISOString()
      },
      type: "article",
      metadata: {
        title,
        authorName: author.name || fallbackDocument?.metadata?.authorName,
        authorHandle: author.handle || fallbackDocument?.metadata?.authorHandle,
        avatarUrl: author.avatar || fallbackDocument?.metadata?.avatarUrl,
        publishedAt: post.createdAt || fallbackDocument?.metadata?.publishedAt,
        language: post.lang || fallbackDocument?.metadata?.language,
        coverImage
      },
      blocks,
      options: {
        includeSourceUrl: true,
        includePublishedAt: true,
        includeEngagementMetrics: false
      },
      diagnostics: {
        extractorVersion: "0.12.0",
        acquisition: {
          method: "captured-response",
          responseMatched: true,
          candidatePath: selected.path.join("."),
          candidateScore: selected.score,
          payloadCount: inputPayloads.length
        },
        title: {
          value: title,
          source: "article.title",
          verified: true
        },
        draftjs: {
          blockCount: contentState.blocks.length,
          entityCount: normalizeEntityEntries(contentState.entities ?? contentState.entityMap).length,
          blockTypes: countBy(contentState.blocks, (block) => normalizeBlockType(block?.type))
        },
        entities: {
          ...parseContext.entityStats,
          formulaIndexCandidates: formulaIndex.ordered.length
        },
        output: outputCounts,
        unresolvedMedia: parseContext.unresolvedMedia,
        unresolvedFormulas: parseContext.unresolvedFormulas,
        formulaResolutions: parseContext.formulaResolutions,
        unknownEntities: parseContext.unknownEntities,
        completeness
      }
    };

    return { ok: true, document, selected };
  }

  function collectArticleCandidates(value, output, path, expectedId, payloadIndex, depth = 0, seen = new Set()) {
    if (depth > 36 || value == null) return;

    if (typeof value === "string") {
      const parsed = parsePotentialJsonString(value);
      if (parsed !== null) {
        collectArticleCandidates(parsed, output, path.concat("<json-string>"), expectedId, payloadIndex, depth + 1, seen);
      }
      return;
    }

    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    const object = value;
    const candidateState = extractContentStateFromObject(object);
    const candidateTitle = extractCandidateTitle(object);
    if (candidateState && candidateTitle) {
      const ids = collectObjectIds(object);
      let score = 100;
      if (expectedId && ids.has(String(expectedId))) score += 80;
      if (Array.isArray(normalizeContentState(candidateState)?.blocks)) score += 40;
      if (/article/i.test(path.join("."))) score += 16;
      if (hasOwn(object, "title")) score += 12;
      output.push({
        article: object,
        title: candidateTitle,
        contentState: candidateState,
        path: [String(payloadIndex)].concat(path),
        score
      });
    }

    for (const [key, child] of Object.entries(object)) {
      collectArticleCandidates(child, output, path.concat(key), expectedId, payloadIndex, depth + 1, seen);
    }
  }

  function extractContentStateFromObject(object) {
    if (!object || typeof object !== "object") return null;
    const direct = object.content_state ?? object.contentState;
    if (normalizeContentState(direct)) return direct;

    for (const key of ["content", "body", "article_body", "articleBody", "article_content", "articleContent"]) {
      const child = object[key];
      if (child && typeof child === "object") {
        const nested = child.content_state ?? child.contentState ?? child;
        if (normalizeContentState(nested)) return nested;
      } else if (typeof child === "string") {
        const nested = parsePotentialJsonString(child);
        if (normalizeContentState(nested)) return nested;
      }
    }
    return null;
  }

  function extractCandidateTitle(object) {
    const value = object?.title;
    return typeof value === "string" && normalizeTitle(value) ? value : "";
  }

  function normalizeContentState(value) {
    let current = value;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (typeof current === "string") {
        current = parsePotentialJsonString(current);
        if (current == null) return null;
        continue;
      }
      if (!current || typeof current !== "object") return null;
      if (Array.isArray(current.blocks)) {
        return {
          ...current,
          entities: current.entities ?? current.entityMap ?? []
        };
      }
      current = current.content_state ?? current.contentState ?? current.raw ?? current.value;
    }
    return null;
  }

  function parseDraftContentState(contentState, context) {
    const entityMap = new Map(normalizeEntityEntries(contentState.entities ?? contentState.entityMap));
    const blocks = [];
    const rawBlockTypes = [];
    let listGroup = null;

    const flushList = () => {
      if (!listGroup) return;
      blocks.push(...buildDraftListBlocks(listGroup.items));
      listGroup = null;
    };

    for (const rawBlock of contentState.blocks) {
      if (!rawBlock || typeof rawBlock !== "object") continue;
      const type = normalizeBlockType(rawBlock.type);
      rawBlockTypes.push(type);

      if (type === "ordered-list-item" || type === "unordered-list-item") {
        if (!listGroup) listGroup = { items: [] };
        listGroup.items.push({
          ordered: type === "ordered-list-item",
          depth: clampNumber(rawBlock.depth, 0, 12),
          html: renderDraftInline(rawBlock, entityMap)
        });
        continue;
      }

      flushList();
      const parsedBlocks = parseDraftBlock(rawBlock, type, entityMap, context);
      if (Array.isArray(parsedBlocks)) blocks.push(...parsedBlocks.filter(Boolean));
      else if (parsedBlocks) blocks.push(parsedBlocks);
    }

    flushList();
    return { blocks: blocks.filter(Boolean), rawBlockTypes };
  }

  function parseDraftBlock(rawBlock, type, entityMap, context) {
    const text = String(rawBlock.text ?? "");
    const html = renderDraftInline(rawBlock, entityMap);
    const layout = blockLayout(rawBlock);

    if (type !== "atomic" && hasAtomicEntityReference(rawBlock, entityMap)) {
      const atomic = parseAtomicBlock(rawBlock, entityMap, context);
      if (atomic.length) return atomic;
    }

    switch (type) {
      case "header-one":
      case "header-two":
      case "header-three":
      case "header-four":
      case "heading-one":
      case "heading-two":
      case "heading-three":
        return text.trim() ? {
          type: "heading",
          level: headingLevel(type),
          html,
          ...layout
        } : null;

      case "blockquote":
      case "quote":
        return text.trim() ? {
          type: "blockquote",
          paragraphs: [html],
          ...layout
        } : null;

      case "code-block":
      case "code":
      case "pre":
        return text ? {
          type: "code",
          text,
          language: inferCodeLanguage(rawBlock?.data?.language || rawBlock?.data?.lang, text),
          lineCount: text.split("\n").length
        } : null;

      case "atomic":
      case "media":
      case "embed":
        return parseAtomicBlock(rawBlock, entityMap, context);

      case "horizontal-rule":
      case "separator":
        return { type: "separator" };

      case "unstyled":
      case "paragraph":
      default:
        if (!text.trim()) return null;
        return {
          type: "paragraph",
          html,
          ...layout
        };
    }
  }

  function hasAtomicEntityReference(block, entityMap) {
    const ranges = normalizeRanges(block.entity_ranges ?? block.entityRanges);
    const key = ranges[0]?.key ?? block?.data?.entity_key ?? block?.data?.entityKey;
    if (key == null) return false;
    const entity = normalizeEntityValue(entityMap.get(String(key)) ?? entityMap.get(Number(key)));
    const data = entity?.data && typeof entity.data === "object" ? entity.data : entity || {};
    return Boolean(
      data.markdown != null || data.media_items != null || data.mediaItems != null ||
      data.post_id != null || data.postId != null ||
      (/markdown|code|media|tweet|embed|latex|math|equation/i.test(String(entity?.type || data?.type || "")) && !String(block.text || "").trim())
    );
  }

  function parseAtomicBlock(block, entityMap, context) {
    const ranges = normalizeRanges(block.entity_ranges ?? block.entityRanges);
    const key = ranges[0]?.key ?? block?.data?.entity_key ?? block?.data?.entityKey;
    const entity = entityMap.get(String(key)) ?? entityMap.get(Number(key)) ?? normalizeEntityValue(block?.data?.entity);
    if (!entity) {
      context.entityStats.unknown += 1;
      context.unknownEntities.push({ blockKey: block.key || "", reason: "missing-entity", key: key ?? null });
      return [];
    }

    const value = normalizeEntityValue(entity);
    const data = value?.data && typeof value.data === "object" ? value.data : value || {};
    const typeHint = String(value?.type || data?.type || data?.entity_type || "").toLowerCase();
    const output = [];

    if (/latex|tex|math|equation/.test(typeHint)) {
      const formulaOrdinal = context.formulaEntityCursor++;
      const formula = resolveFormulaEntity({ block, value, data, context, formulaOrdinal });
      if (formula) {
        context.entityStats.formula += 1;
        context.formulaResolutions.push({
          blockKey: block.key || "",
          source: formula.resolutionSource || "unknown",
          format: formula.mathml ? "mathml" : "tex",
          reference: formula.entityReference || null
        });
        output.push(formula);
      }
    }

    const markdown = firstNonEmptyString(data.markdown, data.markdown_text, data.markdownText, data.code, data.text);
    if (markdown && (data.markdown != null || /markdown|code|syntax/.test(typeHint)) && !output.some((block) => block.type === "formula")) {
      context.entityStats.markdown += 1;
      if (/code|syntax/.test(typeHint) && !/^\s*(`{3,}|~{3,})/m.test(markdown)) {
        output.push({
          type: "code",
          language: inferCodeLanguage(firstNonEmptyString(data.language, data.lang), markdown),
          text: markdown.replace(/\r\n?/g, "\n"),
          lineCount: markdown.replace(/\r\n?/g, "\n").split("\n").length
        });
      } else {
        output.push(...markdownToBlocks(markdown));
      }
    }

    const mediaItems = normalizeMediaItems(data.media_items ?? data.mediaItems ?? data.media ?? data.items);
    if (mediaItems.length) {
      context.entityStats.media += 1;
      for (const item of mediaItems) {
        const mediaBlock = resolveMediaBlock(item, data.caption, context);
        if (mediaBlock) output.push(mediaBlock);
      }
    }

    const postId = firstNonEmptyString(data.post_id, data.postId, data.tweet_id, data.tweetId, data.rest_id);
    if (postId) {
      context.entityStats.embeddedPost += 1;
      output.push(resolveEmbeddedPost(postId, context));
    }

    const url = firstNonEmptyString(data.url, data.expanded_url, data.expandedUrl, data.href);
    if (url && !postId && !mediaItems.length) {
      context.entityStats.link += 1;
      output.push({
        type: "link_card",
        url: safeHttpUrl(url),
        title: firstNonEmptyString(data.title, data.name) || safeHttpUrl(url),
        description: firstNonEmptyString(data.description, data.summary),
        hostname: hostnameOf(url)
      });
    }

    if (!output.length && markdown) {
      context.entityStats.markdown += 1;
      output.push(...markdownToBlocks(markdown));
    }

    if (!output.length) {
      context.entityStats.unknown += 1;
      const reference = firstNonEmptyString(
        data.entityKey, data.entity_key, data.formulaKey, data.formula_key,
        value?.entityKey, value?.entity_key, block?.data?.entityKey, block?.data?.entity_key
      );
      const entry = {
        blockKey: block.key || "",
        type: value?.type || "",
        dataKeys: Object.keys(data).slice(0, 20),
        entityReference: reference || null
      };
      context.unknownEntities.push(entry);
      if (/latex|tex|math|equation/.test(typeHint)) {
        context.unresolvedFormulas.push(entry);
      }
    }
    return output;
  }

  function normalizeEntityEntries(entities) {
    if (Array.isArray(entities)) {
      return entities.map((entry, index) => {
        if (entry && typeof entry === "object" && hasOwn(entry, "key")) {
          return [String(entry.key), entry.value ?? entry];
        }
        return [String(index), entry];
      });
    }
    if (entities && typeof entities === "object") {
      return Object.entries(entities);
    }
    return [];
  }

  function normalizeEntityValue(entity) {
    if (!entity || typeof entity !== "object") return entity;
    if (entity.value && typeof entity.value === "object") return entity.value;
    return entity;
  }

  function renderDraftInline(block, entityMap) {
    const text = String(block.text ?? "");
    if (!text) return "";

    const styleRanges = normalizeStyleRanges(block.inline_style_ranges ?? block.inlineStyleRanges);
    const entityRanges = normalizeRanges(block.entity_ranges ?? block.entityRanges);
    const boundaries = new Set([0, text.length]);
    for (const range of styleRanges.concat(entityRanges)) {
      boundaries.add(clampNumber(range.offset, 0, text.length));
      boundaries.add(clampNumber(Number(range.offset) + Number(range.length), 0, text.length));
    }
    const points = Array.from(boundaries).sort((a, b) => a - b);
    let html = "";

    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (end <= start) continue;
      const raw = text.slice(start, end);
      const styles = styleRanges
        .filter((range) => range.offset <= start && range.offset + range.length >= end)
        .map((range) => String(range.style || range.type || "").toUpperCase());
      const entityRange = entityRanges.find((range) => range.offset <= start && range.offset + range.length >= end);
      const entity = entityRange ? normalizeEntityValue(entityMap.get(String(entityRange.key)) ?? entityMap.get(Number(entityRange.key))) : null;
      html += wrapInlineSegment(escapeHtml(raw).replace(/\n/g, "<br>"), styles, entity);
    }
    return html;
  }

  function wrapInlineSegment(html, styles, entity) {
    const hasStyle = (pattern) => styles.some((style) => pattern.test(style));
    let output = html;
    if (hasStyle(/CODE|MONOSPACE/)) output = `<code>${output}</code>`;
    if (hasStyle(/SUPERSCRIPT|SUP(?:ER)?/)) output = `<sup>${output}</sup>`;
    if (hasStyle(/SUBSCRIPT|SUB/)) output = `<sub>${output}</sub>`;
    if (hasStyle(/BOLD|STRONG/)) output = `<strong>${output}</strong>`;
    if (hasStyle(/ITALIC|EMPHASIS/)) output = `<em>${output}</em>`;
    if (hasStyle(/UNDERLINE/)) output = `<u>${output}</u>`;
    if (hasStyle(/STRIKETHROUGH|STRIKE/)) output = `<s>${output}</s>`;

    const data = entity?.data || entity?.value?.data || {};
    const entityType = String(entity?.type || entity?.value?.type || "").toUpperCase();
    const url = firstNonEmptyString(data.url, data.href, data.expanded_url, data.expandedUrl);
    if (url && (/LINK|URL/.test(entityType) || safeHttpUrl(url))) {
      const safe = safeHttpUrl(url);
      if (safe) output = `<a href="${escapeAttribute(safe)}">${output}</a>`;
    }
    return output;
  }

  function normalizeStyleRanges(ranges) {
    if (!Array.isArray(ranges)) return [];
    return ranges.map((range) => ({
      offset: clampNumber(range?.offset, 0, Number.MAX_SAFE_INTEGER),
      length: clampNumber(range?.length, 0, Number.MAX_SAFE_INTEGER),
      style: range?.style ?? range?.type ?? ""
    })).filter((range) => range.length > 0);
  }

  function normalizeRanges(ranges) {
    if (!Array.isArray(ranges)) return [];
    return ranges.map((range) => ({
      offset: clampNumber(range?.offset, 0, Number.MAX_SAFE_INTEGER),
      length: clampNumber(range?.length, 0, Number.MAX_SAFE_INTEGER),
      key: range?.key
    })).filter((range) => range.length >= 0 && range.key != null);
  }

  function buildDraftListBlocks(items) {
    const output = [];
    let cursor = 0;
    while (cursor < items.length) {
      const depth = Math.max(0, Number(items[cursor].depth) || 0);
      const parsed = parseDraftListLevel(items, cursor, depth, Boolean(items[cursor].ordered));
      output.push(parsed.list);
      cursor = parsed.next;
    }
    return output;
  }

  function parseDraftListLevel(items, start, depth, ordered) {
    const list = { type: "list", ordered, items: [] };
    let cursor = start;
    while (cursor < items.length) {
      const item = items[cursor];
      const itemDepth = Math.max(0, Number(item.depth) || 0);
      if (itemDepth < depth) break;
      if (itemDepth === depth && Boolean(item.ordered) !== ordered) break;
      if (itemDepth > depth) {
        const parentItem = list.items[list.items.length - 1];
        if (!parentItem) break;
        const nested = parseDraftListLevel(items, cursor, itemDepth, Boolean(item.ordered));
        parentItem.children = parentItem.children || [];
        parentItem.children.push(nested.list);
        cursor = nested.next;
        continue;
      }
      list.items.push({ html: item.html, children: [] });
      cursor += 1;
    }
    pruneEmptyChildren(list);
    return { list, next: cursor };
  }

  function buildNestedListBlock(items, ordered) {
    const root = { type: "list", ordered, items: [] };
    const stack = [{ depth: -1, list: root }];

    for (const item of items) {
      const depth = Math.max(0, Number(item.depth) || 0);
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
      let parent = stack[stack.length - 1];
      while (parent.depth < depth - 1) {
        const lastItem = parent.list.items[parent.list.items.length - 1];
        if (!lastItem) break;
        const nested = { type: "list", ordered, items: [] };
        lastItem.children = lastItem.children || [];
        lastItem.children.push(nested);
        parent = { depth: parent.depth + 1, list: nested };
        stack.push(parent);
      }
      if (depth > parent.depth) {
        const lastItem = parent.list.items[parent.list.items.length - 1];
        if (lastItem) {
          const nested = { type: "list", ordered, items: [] };
          lastItem.children = lastItem.children || [];
          lastItem.children.push(nested);
          parent = { depth, list: nested };
          stack.push(parent);
        }
      }
      parent.list.items.push({ html: item.html, children: [] });
    }
    pruneEmptyChildren(root);
    return root;
  }

  function pruneEmptyChildren(list) {
    for (const item of list.items || []) {
      item.children = (item.children || []).filter((child) => child.items?.length);
      for (const child of item.children) pruneEmptyChildren(child);
      if (!item.children.length) delete item.children;
    }
  }

  function markdownToBlocks(markdown) {
    const source = String(markdown || "").replace(/\r\n?/g, "\n");
    if (!source.trim()) return [];
    const lines = source.split("\n");
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      const fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/);
      if (fence) {
        const marker = fence[1][0];
        const markerLength = fence[1].length;
        const language = fence[2] || "";
        const codeLines = [];
        index += 1;
        while (index < lines.length && !new RegExp(`^\\s{0,3}${escapeRegExp(marker)}{${markerLength},}\\s*$`).test(lines[index])) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        const text = codeLines.join("\n");
        blocks.push({ type: "code", language: language || inferCodeLanguage("", text), text, lineCount: codeLines.length });
        continue;
      }

      const heading = line.match(/^\s{0,3}(#{1,4})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        blocks.push({ type: "heading", level: Math.min(4, heading[1].length + 1), html: renderMarkdownInline(heading[2]) });
        index += 1;
        continue;
      }

      if (/^\s*>/.test(line)) {
        const quoteLines = [];
        while (index < lines.length && (/^\s*>/.test(lines[index]) || !lines[index].trim())) {
          quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
          index += 1;
        }
        const paragraphs = quoteLines.join("\n").split(/\n\s*\n/).map((part) => renderMarkdownInline(part.replace(/\n/g, " ").trim())).filter(Boolean);
        if (paragraphs.length) blocks.push({ type: "blockquote", paragraphs });
        continue;
      }

      if (isMarkdownListLine(line)) {
        const listLines = [];
        while (index < lines.length && (isMarkdownListLine(lines[index]) || /^\s{2,}\S/.test(lines[index]) || !lines[index].trim())) {
          listLines.push(lines[index]);
          index += 1;
        }
        blocks.push(...parseMarkdownLists(listLines));
        continue;
      }

      if (looksLikeTable(lines, index)) {
        const table = parseMarkdownTable(lines, index);
        blocks.push(table.block);
        index = table.nextIndex;
        continue;
      }

      if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        blocks.push({ type: "separator" });
        index += 1;
        continue;
      }

      const paragraphLines = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() && !isMarkdownSpecialStart(lines, index)) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      blocks.push({ type: "paragraph", html: renderMarkdownInline(paragraphLines.join(" ")) });
    }

    return blocks.filter(Boolean);
  }

  function isMarkdownSpecialStart(lines, index) {
    const line = lines[index] || "";
    return /^\s{0,3}(`{3,}|~{3,})/.test(line)
      || /^\s{0,3}#{1,4}\s+/.test(line)
      || /^\s*>/.test(line)
      || isMarkdownListLine(line)
      || looksLikeTable(lines, index)
      || /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
  }

  function isMarkdownListLine(line) {
    return /^(\s*)(?:[-+*]|\d+[.)])\s+\S/.test(line || "");
  }

  function parseMarkdownLists(lines) {
    const parsedItems = [];
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);
      if (!match) continue;
      const ordered = /^\d/.test(match[2]);
      const indent = match[1].replace(/\t/g, "    ").length;
      const depth = Math.floor(indent / 2);
      const body = [match[3]];
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !isMarkdownListLine(lines[i + 1])) {
        body.push(lines[i + 1].trim());
        i += 1;
      }
      parsedItems.push({ ordered, depth, html: renderMarkdownInline(body.join(" ")) });
    }

    const output = [];
    let group = null;
    for (const item of parsedItems) {
      if (!group || group.ordered !== item.ordered) {
        if (group) output.push(buildNestedListBlock(group.items, group.ordered));
        group = { ordered: item.ordered, items: [] };
      }
      group.items.push(item);
    }
    if (group) output.push(buildNestedListBlock(group.items, group.ordered));
    return output;
  }

  function looksLikeTable(lines, index) {
    if (index + 1 >= lines.length) return false;
    const first = lines[index];
    const second = lines[index + 1];
    return first.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(second);
  }

  function parseMarkdownTable(lines, index) {
    const rows = [];
    rows.push(splitTableRow(lines[index]));
    index += 2;
    while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
      rows.push(splitTableRow(lines[index]));
      index += 1;
    }
    return {
      block: {
        type: "table",
        rows: [
          rows[0].map((cell) => ({ html: renderMarkdownInline(cell), header: true })),
          ...rows.slice(1).map((row) => row.map((cell) => ({ html: renderMarkdownInline(cell), header: false })))
        ]
      },
      nextIndex: index
    };
  }

  function splitTableRow(line) {
    return String(line).trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
  }

  function renderMarkdownInline(text) {
    const source = String(text || "");
    const tokens = [];
    let escaped = escapeHtml(source);

    escaped = escaped.replace(/`([^`\n]+)`/g, (_, code) => stash(tokens, `<code>${code}</code>`));
    escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label, url) => {
      const safe = safeHttpUrl(decodeHtmlEntities(url));
      return safe ? stash(tokens, `<a href="${escapeAttribute(safe)}">${label}</a>`) : label;
    });
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    escaped = escaped.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    escaped = escaped.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
    escaped = escaped.replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>");
    return restore(tokens, escaped);
  }

  function stash(tokens, html) {
    const key = `\uE000${tokens.length}\uE001`;
    tokens.push(html);
    return key;
  }

  function restore(tokens, value) {
    return value.replace(/\uE000(\d+)\uE001/g, (_, index) => tokens[Number(index)] || "");
  }

  function buildFormulaIndex(payloads) {
    const byKey = new Map();
    const ordered = [];
    const seen = new Set();
    const seenFormula = new Set();

    const add = (formula, object, path) => {
      if (!formula) return;
      const signature = formula.mathml
        ? `mml:${formula.mathml}`
        : `tex:${formula.latex}`;
      let entry = ordered.find((item) => item.signature === signature);
      if (!entry) {
        entry = { ...formula, signature, path: path.join(".") };
        ordered.push(entry);
      }
      if (seenFormula.has(signature)) {
        // Still add any additional reference keys below.
      } else {
        seenFormula.add(signature);
      }

      const keys = collectFormulaReferenceKeys(object, path);
      for (const key of keys) {
        if (key && !byKey.has(String(key))) byKey.set(String(key), entry);
      }
    };

    const visit = (value, path = [], depth = 0) => {
      if (depth > 38 || value == null) return;
      if (typeof value === "string") {
        const pathHint = path.join(".");
        const tail = String(path.at(-1) || "");
        if (/latex|tex|mathml|formula|equation/i.test(pathHint) || looksLikeTex(value)) {
          add(normalizeFormulaSource(value, { forced: true, pathHint }), { value }, path);
        }
        return;
      }
      if (typeof value !== "object" || seen.has(value)) return;
      seen.add(value);

      const formula = extractFormulaSource(value, path.join("."));
      if (formula) add(formula, value, path);

      for (const [key, child] of Object.entries(value)) {
        visit(child, path.concat(key), depth + 1);
      }
    };

    for (const payload of payloads || []) visit(payload);
    return { byKey, ordered };
  }

  function resolveFormulaEntity({ block, value, data, context, formulaOrdinal = 0 }) {
    const directCandidates = [data, value, block?.data];
    for (const candidate of directCandidates) {
      const formula = extractFormulaSource(candidate, "LATEX entity", true);
      if (formula) {
        return {
          type: "formula",
          ...formula,
          display: true,
          resolutionSource: "entity-direct"
        };
      }
    }

    const references = collectFormulaReferenceKeys({
      ...((value && typeof value === "object") ? value : {}),
      ...((data && typeof data === "object") ? data : {}),
      ...((block?.data && typeof block.data === "object") ? block.data : {})
    }, []);
    for (const reference of references) {
      const formula = context.formulaIndex?.byKey?.get(String(reference));
      if (formula) {
        return {
          type: "formula",
          latex: formula.latex,
          mathml: formula.mathml,
          display: true,
          entityReference: String(reference),
          resolutionSource: "payload-reference"
        };
      }
    }

    let fallback = null;
    for (const reference of references) {
      if (context.fallbackFormulaByRef?.has(String(reference))) {
        fallback = context.fallbackFormulaByRef.get(String(reference));
        break;
      }
    }
    if (!fallback) fallback = context.fallbackFormulas?.[formulaOrdinal];
    if (!fallback) fallback = context.fallbackFormulas?.[context.fallbackFormulaCursor++];
    if (fallback && (fallback.latex || fallback.mathml)) {
      const normalizedFallback = fallback.mathml
        ? normalizeFormulaSource(fallback.mathml, { forced: true, pathHint: "DOM formula fallback.mathml" })
        : normalizeFormulaSource(fallback.latex, { forced: true, pathHint: "DOM formula fallback.latex" });
      if (normalizedFallback) {
        return {
          type: "formula",
          latex: normalizedFallback.latex,
          mathml: normalizedFallback.mathml,
          display: fallback.display !== false,
          entityReference: references[0] ? String(references[0]) : undefined,
          resolutionSource: "dom-formula-fallback"
        };
      }
    }

    return null;
  }

  function extractFormulaSource(value, pathHint = "", forced = false) {
    if (value == null) return null;
    if (typeof value === "string") return normalizeFormulaSource(value, { forced, pathHint });
    if (typeof value !== "object") return null;

    const typeHint = [
      value.type, value.__typename, value.entity_type, value.entityType,
      value.kind, value.format, value.mime_type, value.mimeType, pathHint
    ].filter(Boolean).join(" ");
    const hasFormulaReference = [value.entityKey, value.entity_key, value.formulaKey, value.formula_key, value.latexKey, value.latex_key]
      .some((item) => typeof item === "string" || typeof item === "number");
    const formulaContext = forced || hasFormulaReference || /latex|tex|mathml|formula|equation|math/i.test(typeHint);

    const mathml = firstNonEmptyString(value.mathml, value.mathML, value.mml, value.math_ml);
    if (mathml) {
      const normalized = normalizeFormulaSource(mathml, { forced: true, pathHint: `${pathHint}.mathml` });
      if (normalized?.mathml) return normalized;
    }

    for (const key of ["latex", "latexSource", "latex_source", "tex", "texSource", "tex_source", "formula", "equation", "expression", "math"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) {
        const normalized = normalizeFormulaSource(candidate, { forced: true, pathHint: `${pathHint}.${key}` });
        if (normalized) return normalized;
      }
    }

    if (formulaContext) {
      for (const key of ["text", "content", "source", "raw", "value", "body", "display", "data"]) {
        const candidate = value[key];
        if (typeof candidate === "string" && candidate.trim()) {
          const normalized = normalizeFormulaSource(candidate, { forced: true, pathHint: `${pathHint}.${key}` });
          if (normalized) return normalized;
        }
        if (candidate && typeof candidate === "object" && candidate !== value) {
          const nested = extractFormulaSource(candidate, `${pathHint}.${key}`, true);
          if (nested) return nested;
        }
      }
    }
    return null;
  }

  function normalizeFormulaSource(value, { forced = false } = {}) {
    let source = decodeHtmlEntities(String(value || ""))
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .trim();
    if (!source || source.length > 100000) return null;

    if (/^<math\b/i.test(source) || /<math\b[\s>]/i.test(source)) {
      const match = source.match(/<math\b[\s\S]*?<\/math>/i);
      return match ? { mathml: match[0] } : null;
    }

    source = source
      .replace(/^\s*\$\$([\s\S]*?)\$\$\s*$/, "$1")
      .replace(/^\s*\\\[([\s\S]*?)\\\]\s*$/, "$1")
      .replace(/^\s*\\\(([\s\S]*?)\\\)\s*$/, "$1")
      .trim();

    source = collapseDuplicateFormulaSource(source);
    source = normalizeXFormulaTex(source);
    source = collapseDuplicateFormulaSource(source).trim();

    if (!source) return null;
    if (!forced && !looksLikeTex(source)) return null;
    if (/^[A-Za-z0-9_-]{8,}$/.test(source) && !/[\\^_{}=+*/()\[\]]/.test(source)) return null;
    return { latex: source.replace(/\u0000/g, "") };
  }

  function collapseDuplicateFormulaSource(value) {
    let source = String(value || "").replace(/\r\n?/g, "\n").trim();
    if (!source) return source;

    const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (lines.length >= 2 && lines.length % 2 === 0) {
      const half = lines.length / 2;
      const left = lines.slice(0, half).join("\n");
      const right = lines.slice(half).join("\n");
      if (formulaComparisonKey(left) === formulaComparisonKey(right)) return left;
    }

    const midpoint = Math.floor(source.length / 2);
    const min = Math.max(1, midpoint - 160);
    const max = Math.min(source.length - 1, midpoint + 160);
    for (let split = min; split <= max; split += 1) {
      if (!/\s/.test(source[split - 1] || "") && !/\s/.test(source[split] || "")) continue;
      const left = source.slice(0, split).trim();
      const right = source.slice(split).trim();
      if (left.length < 4 || right.length < 4) continue;
      if (formulaComparisonKey(left) === formulaComparisonKey(right)) return left;
    }
    return source;
  }

  function formulaComparisonKey(value) {
    return normalizeMathAlphanumericSymbols(String(value || ""))
      .replace(/\\(?:left|right)/g, "")
      .replace(/\s+/g, "")
      .replace(/[−–—]/g, "-")
      .toLowerCase();
  }

  function normalizeXFormulaTex(value) {
    let source = normalizeMathAlphanumericSymbols(String(value || ""))
      .replace(/[−–—]/g, "-")
      .replace(/∼/g, "\\sim ")
      .replace(/⋅/g, "\\cdot ")
      .replace(/‖/g, "\\lVert ")
      .replace(/√/g, "\\sqrt ")
      .replace(/Γ/g, "\\Gamma ")
      .replace(/Θ/g, "\\Theta ")
      .replace(/Ψ/g, "\\Psi ")
      .replace(/π/g, "\\pi ")
      .replace(/σ/g, "\\sigma ")
      .replace(/ℓ/g, "\\ell ");

    const commands = ["boldsymbol", "mathbf", "mathit", "mathrm", "mathsf", "mathtt", "mathcal", "operatorname"];
    for (const command of commands) {
      const macro = new RegExp(`\\\\${command}\\s*(?!\\{)(\\\\[A-Za-z]+|[A-Za-z0-9])`, "g");
      source = source.replace(macro, (_, argument) => `\\${command}{${argument}}`);
    }

    // X's accessible equation text frequently emits single Latin bold symbols as
    // malformed \\boldsymbolS / \\boldsymbolx. MathJax can render these reliably
    // as \\mathbf{S} / \\mathbf{x}; Greek/multi-token bold expressions keep
    // \\boldsymbol and are handled by the bundled boldsymbol TeX extension.
    source = source.replace(/\\boldsymbol\{([A-Za-z0-9])\}/g, "\\mathbf{$1}");
    return source.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").trim();
  }

  function normalizeMathAlphanumericSymbols(value) {
    let output = "";
    for (const character of Array.from(String(value || ""))) {
      const code = character.codePointAt(0);
      if (code >= 0x1D400 && code <= 0x1D7FF) output += character.normalize("NFKC");
      else output += character;
    }
    return output;
  }

  function looksLikeTex(value) {
    const source = String(value || "");
    return /\\(?:frac|sqrt|sum|prod|Gamma|Theta|Psi|mathcal|mathrm|operatorname|begin|left|right|cdot|sim|to|infty|log|sin|cos|tan|arctan|exp|mathbf|boldsymbol)\b/.test(source)
      || /[_^]\s*(?:\{|[A-Za-z0-9])/.test(source)
      || /(?:\\[A-Za-z]+|[=<>±×÷∑∏√πθΘΓΨℓσ])/.test(source);
  }

  function collectFormulaReferenceKeys(object, path = []) {
    const keys = new Set();
    if (object && typeof object === "object") {
      for (const key of [
        "entityKey", "entity_key", "formulaKey", "formula_key", "latexKey", "latex_key",
        "id", "id_str", "rest_id", "restId", "key", "uuid"
      ]) {
        const value = object[key];
        if ((typeof value === "string" || typeof value === "number") && String(value).trim()) {
          keys.add(String(value));
        }
      }
    }
    const tail = path.at(-1);
    if (tail && !/^\d+$/.test(String(tail)) && !/^(?:data|value|content|entityMap|entities)$/i.test(String(tail))) {
      keys.add(String(tail));
    }
    return Array.from(keys);
  }

  function buildMediaIndex(payloads) {
    const index = new Map();
    const seen = new Set();
    for (const payload of payloads) collectMediaObjects(payload, index, seen, 0);
    return index;
  }

  function collectMediaObjects(value, index, seen, depth) {
    if (depth > 32 || value == null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    const media = mediaFromObject(value);
    if (media) {
      for (const id of media.ids) index.set(String(id), media);
      if (media.url) index.set(normalizedMediaKey(media.url), media);
    }

    for (const child of Object.values(value)) collectMediaObjects(child, index, seen, depth + 1);
  }

  function mediaFromObject(object) {
    if (!object || typeof object !== "object") return null;
    const typeHint = String(object.type || object.__typename || object.media_category || "").toLowerCase();
    const looksLikeMedia = [
      "media_url_https", "media_url", "preview_image_url", "media_key", "media_id",
      "media_info", "original_info", "video_info", "sizes", "ext_alt_text"
    ].some((key) => hasOwn(object, key)) || /media|photo|video|animatedgif|image/.test(typeHint);
    if (!looksLikeMedia) return null;
    const urls = collectPbsUrls(object);
    if (!urls.length) return null;
    const url = chooseBestPbsUrl(urls);
    const originalInfo = object.original_info || object.originalInfo || object.sizes?.large || object.media_info?.original_info || {};
    const width = numberOrUndefined(object.width ?? originalInfo.width ?? originalInfo.w);
    const height = numberOrUndefined(object.height ?? originalInfo.height ?? originalInfo.h);
    const typeText = String(object.type || object.media_category || object.__typename || object.media_info?.__typename || "").toLowerCase();
    const type = /video/.test(typeText) ? "video" : /gif|animated/.test(typeText) ? "gif" : "photo";
    const ids = new Set();
    for (const key of ["media_id", "mediaId", "id_str", "id", "rest_id", "restId", "media_key", "mediaKey", "entity_key", "entityKey"]) {
      const value = object[key];
      if (typeof value === "string" || typeof value === "number") ids.add(String(value));
    }
    return {
      ids,
      url: normalizeMediaUrl(url),
      width,
      height,
      type,
      alt: firstNonEmptyString(object.alt_text, object.altText, object.ext_alt_text, object.description),
      source: object
    };
  }

  function collectPbsUrls(object) {
    const urls = [];
    const seen = new Set();
    const visit = (value, depth = 0) => {
      if (depth > 7 || value == null) return;
      if (typeof value === "string") {
        const normalized = normalizeMediaUrl(value);
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          urls.push(normalized);
        }
        return;
      }
      if (typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, depth + 1));
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (/url|src|image|poster|media/i.test(key)) visit(child, depth + 1);
      }
    };
    visit(object);
    return urls;
  }

  function chooseBestPbsUrl(urls) {
    return [...urls].sort((a, b) => mediaUrlScore(b) - mediaUrlScore(a))[0] || "";
  }

  function mediaUrlScore(value) {
    try {
      const url = new URL(value);
      let score = 0;
      if (url.pathname.startsWith("/media/")) score += 20;
      const name = url.searchParams.get("name") || "";
      if (name === "orig") score += 10;
      if (name === "large") score += 8;
      if (/small|thumb/.test(name)) score -= 6;
      return score;
    } catch {
      return 0;
    }
  }

  function resolveMediaBlock(item, caption, context) {
    const direct = mediaFromObject(item);
    let media = direct;
    const ids = collectObjectIds(item);
    for (const id of ids) {
      if (!media && context.mediaIndex.has(String(id))) media = context.mediaIndex.get(String(id));
    }
    const rawId = firstNonEmptyString(item?.media_id, item?.mediaId, item?.id, item?.id_str, item?.media_key, item?.mediaKey);
    if (!media && rawId && context.mediaIndex.has(String(rawId))) media = context.mediaIndex.get(String(rawId));

    if (!media) {
      const fallback = context.fallbackImages[context.fallbackImageCursor++];
      if (fallback) {
        return {
          ...fallback,
          caption: caption || fallback.caption,
          resolutionSource: "dom-media-fallback"
        };
      }
      context.unresolvedMedia.push({ mediaId: rawId || null, keys: Object.keys(item || {}).slice(0, 12) });
      return null;
    }

    if (media.type === "video" || media.type === "gif") {
      return {
        type: "media",
        mediaType: media.type,
        poster: media.url,
        caption: caption || media.alt || "",
        width: media.width,
        height: media.height,
        sourceUrl: context.articleUrl
      };
    }
    return {
      type: "image",
      src: media.url,
      alt: media.alt || "",
      caption: caption || "",
      width: media.width,
      height: media.height
    };
  }

  function resolveCoverImage(article, mediaIndex) {
    const cover = article?.cover_media ?? article?.coverMedia ?? article?.cover ?? article?.cover_image ?? article?.coverImage;
    const direct = mediaFromObject(cover);
    if (direct?.url) return direct.url;
    const ids = collectObjectIds(cover);
    for (const id of ids) {
      if (mediaIndex.has(String(id))) return mediaIndex.get(String(id)).url;
    }
    const url = typeof cover === "string" ? normalizeMediaUrl(cover) : "";
    return url || undefined;
  }

  function buildEmbeddedPostIndex(payloads) {
    const index = new Map();
    const seen = new Set();
    const visit = (value, depth = 0) => {
      if (depth > 32 || value == null || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      const id = firstNonEmptyString(value.rest_id, value.restId, value.id_str, value.id);
      const text = firstNonEmptyString(value.full_text, value.fullText, value.text, value.note_tweet?.text, value.noteTweet?.text);
      const user = value.core?.user_results?.result?.legacy || value.user || value.author || {};
      const handle = firstNonEmptyString(user.screen_name, user.username, value.screen_name, value.username);
      if (id && text && (handle || value.created_at || value.createdAt)) {
        index.set(String(id), {
          id: String(id),
          text,
          authorName: firstNonEmptyString(user.name, value.name),
          authorHandle: handle,
          createdAt: firstNonEmptyString(value.created_at, value.createdAt)
        });
      }
      Object.values(value).forEach((child) => visit(child, depth + 1));
    };
    payloads.forEach((payload) => visit(payload));
    return index;
  }

  function resolveEmbeddedPost(postId, context) {
    const post = context.embeddedPostIndex.get(String(postId));
    return {
      type: "embedded_post",
      authorName: post?.authorName,
      authorHandle: post?.authorHandle,
      html: post?.text ? escapeHtml(post.text).replace(/\n/g, "<br>") : "",
      sourceUrl: post?.authorHandle
        ? `https://x.com/${encodeURIComponent(post.authorHandle)}/status/${encodeURIComponent(postId)}`
        : `https://x.com/i/status/${encodeURIComponent(postId)}`
    };
  }

  function findAuthorMetadata(payloads, articleUrl, fallbackDocument) {
    let handleFromUrl = "";
    try {
      const parts = new URL(articleUrl).pathname.split("/").filter(Boolean);
      if (parts[0] && parts[0] !== "i") handleFromUrl = parts[0];
    } catch {}

    const candidates = [];
    const seen = new Set();
    const visit = (value, depth = 0) => {
      if (depth > 28 || value == null || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      const handle = firstNonEmptyString(value.screen_name, value.screenName, value.username);
      const name = firstNonEmptyString(value.name, value.display_name, value.displayName);
      if (handle && name) {
        let score = 10;
        if (handleFromUrl && handle.toLowerCase() === handleFromUrl.toLowerCase()) score += 100;
        candidates.push({
          handle,
          name,
          avatar: firstNonEmptyString(value.profile_image_url_https, value.profile_image_url, value.profileImageUrl),
          score
        });
      }
      Object.values(value).forEach((child) => visit(child, depth + 1));
    };
    payloads.forEach((entry) => visit(entry?.json ?? entry));
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || {
      handle: fallbackDocument?.metadata?.authorHandle || handleFromUrl,
      name: fallbackDocument?.metadata?.authorName || ""
    };
  }

  function findPostMetadata(payloads, expectedId, fallbackDocument) {
    const candidates = [];
    const seen = new Set();
    const visit = (value, depth = 0) => {
      if (depth > 28 || value == null || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      const ids = collectObjectIds(value);
      const createdAt = firstNonEmptyString(value.created_at, value.createdAt);
      if (createdAt || ids.size) {
        let score = 0;
        if (expectedId && ids.has(String(expectedId))) score += 100;
        if (createdAt) score += 10;
        candidates.push({ createdAt, lang: firstNonEmptyString(value.lang, value.language), score });
      }
      Object.values(value).forEach((child) => visit(child, depth + 1));
    };
    payloads.forEach((entry) => visit(entry?.json ?? entry));
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || {
      createdAt: fallbackDocument?.metadata?.publishedAt,
      lang: fallbackDocument?.metadata?.language
    };
  }

  function analyzeCompleteness(blocks, entityStats, rawBlockTypes, unresolvedFormulas = []) {
    const gaps = [];
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const text = canonicalBlockText(block);
      if (!text || !CODE_INTRO_RE.test(text)) continue;
      const next = blocks[index + 1];
      if (!next || !["code", "image", "media", "table", "formula"].includes(next.type)) {
        gaps.push({ index, text: text.slice(0, 180), nextType: next?.type || null });
      }
    }
    const formulaGaps = (unresolvedFormulas || []).map((item) => ({
      kind: "formula",
      blockKey: item.blockKey || "",
      text: "LATEX entity 未能解析",
      entityReference: item.entityReference || null
    }));
    return {
      status: gaps.length || formulaGaps.length ? "warning" : "complete",
      suspectedContentGaps: gaps.concat(formulaGaps),
      markdownEntities: entityStats.markdown,
      formulaEntities: entityStats.formula,
      codeBlocks: blocks.filter((block) => block.type === "code").length,
      formulaBlocks: blocks.filter((block) => block.type === "formula").length,
      unresolvedFormulaEntities: formulaGaps.length,
      atomicBlocks: rawBlockTypes.filter((type) => ["atomic", "media", "embed"].includes(type)).length
    };
  }

  function canonicalBlockText(block) {
    if (!block) return "";
    if (block.type === "paragraph" || block.type === "heading") return stripHtml(block.html || "").trim();
    if (block.type === "blockquote") return (block.paragraphs || []).map(stripHtml).join(" ").trim();
    return "";
  }

  function mergeAdjacentCodeBlocks(blocks) {
    const output = [];
    for (const block of blocks) {
      const previous = output[output.length - 1];
      if (block?.type === "code" && previous?.type === "code" && (previous.language || "") === (block.language || "")) {
        previous.text = `${previous.text}\n${block.text}`;
        previous.lineCount = previous.text.split("\n").length;
      } else {
        output.push(block);
      }
    }
    return output;
  }

  function blockLayout(block) {
    const data = block?.data || {};
    const output = {};
    const indent = clampNumber(data.indent ?? block.depth, 0, 4);
    if (indent) output.indent = indent;
    const align = String(data.textAlignment || data.text_alignment || data.align || "").toLowerCase();
    if (["left", "center", "right", "justify"].includes(align)) output.align = align;
    return output;
  }

  function headingLevel(type) {
    if (/one$/.test(type)) return 2;
    if (/two$/.test(type)) return 3;
    return 4;
  }

  function normalizeBlockType(type) {
    return String(type || "unstyled").trim().toLowerCase().replace(/_/g, "-");
  }

  function inferCodeLanguage(explicit, text) {
    if (explicit) return String(explicit).toLowerCase();
    const value = String(text || "");
    if (/^\s*(?:from\s+\S+\s+import|import\s+\S+|def\s+\w+|class\s+\w+|@\w+)/m.test(value)) return "python";
    if (/\b(?:const|let|var|function|async|await|console\.log|=>)\b/.test(value)) return "javascript";
    if (/^\s*(?:#include|int\s+main|std::|template\s*<)/m.test(value)) return "cpp";
    if (/^\s*<\/?[A-Za-z][^>]*>/m.test(value)) return "html";
    if (/\bSELECT\b[\s\S]+\bFROM\b/i.test(value)) return "sql";
    if (/\\begin\{|\\frac\{|\\sum|\\alpha|\\beta/.test(value)) return "latex";
    return "";
  }

  function parsePotentialJsonString(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 40 * 1024 * 1024) return null;
    if (!(text.startsWith("{") || text.startsWith("[") || text.startsWith('"{') || text.startsWith('"['))) return null;
    let current = text.replace(/^\)\]\}',?\s*/, "");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const parsed = JSON.parse(current);
        if (typeof parsed === "string") {
          current = parsed;
          continue;
        }
        return parsed;
      } catch {
        return null;
      }
    }
    return null;
  }

  function normalizeMediaItems(value) {
    if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
    if (value && typeof value === "object") return [value];
    return [];
  }

  function collectObjectIds(value) {
    const ids = new Set();
    if (value == null) return ids;
    if (typeof value === "string" || typeof value === "number") {
      ids.add(String(value));
      return ids;
    }
    if (typeof value !== "object") return ids;
    for (const key of ["id", "id_str", "rest_id", "restId", "article_id", "articleId", "post_id", "postId", "media_id", "mediaId", "media_key", "mediaKey", "entity_key", "entityKey"]) {
      const candidate = value[key];
      if (typeof candidate === "string" || typeof candidate === "number") ids.add(String(candidate));
    }
    return ids;
  }

  function normalizeMediaUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com") return "";
      if (!SAFE_MEDIA_PATHS.some((prefix) => url.pathname.startsWith(prefix))) return "";
      if (url.pathname.startsWith("/media/")) {
        if (!url.searchParams.get("format")) {
          const extension = url.pathname.match(/\.([A-Za-z0-9]+)$/)?.[1];
          if (extension) url.searchParams.set("format", extension);
        }
        url.searchParams.set("name", "orig");
      }
      return url.href;
    } catch {
      return "";
    }
  }

  function normalizedMediaKey(value) {
    try {
      const url = new URL(value);
      url.searchParams.delete("name");
      return url.href;
    } catch {
      return String(value || "");
    }
  }

  function canonicalArticleUrl(articleUrl, expectedId, handle) {
    const id = expectedId || extractNumericId(articleUrl);
    if (id && handle) return `https://x.com/${encodeURIComponent(handle)}/article/${encodeURIComponent(id)}`;
    try {
      const url = new URL(articleUrl);
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return articleUrl || "https://x.com";
    }
  }

  function extractNumericId(value) {
    return String(value || "").match(/\/(?:article|status)\/(\d+)/)?.[1];
  }

  function normalizeTitle(value) {
    const title = String(value || "").replace(/\s+/g, " ").trim();
    if (title.length < 2 || title.length > 500) return "";
    if (/^(x|twitter|article|home)\s*$/i.test(title)) return "";
    return title;
  }

  function firstNonEmptyString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return "";
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function hostnameOf(value) {
    try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; }
  }

  function numberOrUndefined(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function countBy(items, keyFn) {
    const output = {};
    for (const item of items || []) {
      const key = String(keyFn(item) || "unknown");
      output[key] = (output[key] || 0) + 1;
    }
    return output;
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
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
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function stripHtml(value) {
    return String(value || "").replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ");
  }

  function decodeHtmlEntities(value) {
    return String(value || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const api = {
    parseCapturedArticle,
    collectArticleCandidates,
    normalizeContentState,
    parseDraftContentState,
    markdownToBlocks,
    renderDraftInline,
    buildMediaIndex,
    buildFormulaIndex,
    analyzeCompleteness,
    normalizeMediaUrl,
    normalizeFormulaSource,
    collapseDuplicateFormulaSource,
    normalizeXFormulaTex
  };

  global.XPDFStructured = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
