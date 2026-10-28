"use strict";
(() => {
  // src/shared/constants.ts
  var OBSERVER_DEBOUNCE_MS = 450;
  var LOW_PARSE_SUCCESS_RATE = 0.45;

  // src/utils/deduplicate.ts
  function deduplicateComments(comments) {
    const seen = /* @__PURE__ */ new Set();
    const unique = [];
    let duplicateCount = 0;
    for (const comment of comments) {
      const key = `${comment.videoId}${comment.id}`;
      if (seen.has(key)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(key);
      unique.push(comment);
    }
    return { comments: unique, duplicateCount };
  }

  // src/utils/hash.ts
  function fnv1a(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function createFallbackCommentId(input) {
    const source = [
      input.videoId,
      input.authorName.trim(),
      input.text.trim(),
      input.publishTimeText ?? ""
    ].join("");
    return `fallback_${fnv1a(source)}`;
  }

  // src/adapters/douyin/selectors.ts
  var DOUYIN_SELECTORS = {
    commentContainers: [
      '[data-e2e="comment-list"]',
      '[data-e2e="comment-list-container"]',
      '[data-e2e="feed-comment-list"]',
      '[data-e2e="comment-panel"]',
      '[data-testid="comment-list"]',
      '[aria-label*="\u8BC4\u8BBA\u5217\u8868"]',
      'div[class*="comment-list"]',
      'div[class*="CommentList"]',
      'div[class*="commentList"]',
      'div[class*="comment-container"]',
      'div[class*="CommentContainer"]'
    ],
    commentItems: [
      '[data-e2e="comment-item"]',
      '[data-e2e="comment-item-container"]',
      '[data-testid="comment-item"]',
      '[data-testid*="comment-item"]',
      '[role="listitem"][data-e2e*="comment"]',
      'div[class*="comment-item"]',
      'div[class*="CommentItem"]',
      'div[class*="commentItem"]'
    ],
    commentText: [
      '[data-e2e="comment-level-1"]',
      '[data-e2e="comment-content"]',
      '[data-testid="comment-content"]',
      '[class*="comment-text"]',
      '[class*="CommentText"]',
      '[class*="commentContent"]'
    ],
    author: [
      '[data-e2e="comment-user-name"]',
      '[data-e2e="comment-author"]',
      '[data-testid="comment-author"]',
      'a[href*="/user/"]'
    ],
    likeCount: [
      '[data-e2e="comment-like-count"]',
      '[data-testid="comment-like-count"]',
      '[aria-label*="\u70B9\u8D5E"]',
      '[aria-label*="\u8D5E"]',
      '[title*="\u70B9\u8D5E"]',
      '[class*="comment-like"]',
      '[class*="CommentLike"]'
    ],
    replyCount: [
      '[data-e2e="comment-reply-count"]',
      '[data-testid="comment-reply-count"]',
      '[aria-label*="\u6761\u56DE\u590D"]',
      '[class*="reply-count"]',
      '[class*="ReplyCount"]'
    ],
    publishTime: [
      '[data-e2e="comment-time"]',
      '[data-testid="comment-time"]',
      "time",
      '[class*="comment-time"]',
      '[class*="CommentTime"]'
    ]
  };

  // src/adapters/douyin/detector.ts
  function cleanText(value) {
    return (value ?? "").replaceAll(/\s+/g, " ").trim();
  }
  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return true;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }
  function ownText(element) {
    return cleanText(
      Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? "").join(" ")
    );
  }
  function findFirst(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (element && isVisible(element)) return { element, selector };
    }
    return { element: null, selector: null };
  }
  function isDouyinPage(url = location.href) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname === "www.douyin.com";
    } catch {
      return false;
    }
  }
  function getVideoContext() {
    const videoUrl = location.href;
    const parsed = new URL(videoUrl);
    const pathMatch = parsed.pathname.match(/\/video\/(\d+)/);
    const queryId = parsed.searchParams.get("modal_id") ?? parsed.searchParams.get("video_id") ?? "";
    const activeVideoLink = document.querySelector(
      'a[href*="/video/"][aria-current="true"], a[href*="/video/"][data-e2e*="active"]'
    );
    const activeMatch = activeVideoLink?.href.match(/\/video\/(\d+)/);
    const videoId = pathMatch?.[1] || queryId || activeMatch?.[1] || "";
    const metaTitle = document.querySelector('meta[property="og:title"]')?.content.trim() ?? "";
    const headingTitle = document.querySelector(
      '[data-e2e="video-desc"], [data-testid="video-title"], h1'
    )?.textContent?.trim() ?? "";
    const documentTitle = document.title.replace(/\s*[-_｜|]\s*抖音.*$/u, "").trim();
    return {
      videoId,
      videoUrl,
      videoTitle: metaTitle || headingTitle || documentTitle || "\u672A\u8BFB\u53D6\u5230\u89C6\u9891\u6807\u9898"
    };
  }
  function findCommentHeader() {
    const elements = Array.from(
      document.querySelectorAll("h1, h2, h3, div, span, p")
    ).slice(0, 12e3);
    return elements.find((element) => {
      if (!isVisible(element)) return false;
      const text = ownText(element) || cleanText(element.textContent);
      return /^全部评论\s*[（(]?\s*[\d,.万亿wW+]+/u.test(text);
    }) ?? null;
  }
  function findCommentInput() {
    return document.querySelector(
      'textarea[placeholder*="\u8BC4\u8BBA"], input[placeholder*="\u8BC4\u8BBA"], [contenteditable="true"][data-placeholder*="\u8BC4\u8BBA"], [contenteditable="true"][aria-label*="\u8BC4\u8BBA"]'
    );
  }
  function smallestSharedAncestor(first, second) {
    let current = first;
    for (let level = 0; current && level < 12; level += 1) {
      const text = cleanText(current.textContent);
      const userCount = current.querySelectorAll('a[href*="/user/"]').length;
      const containsSecond = !second || current.contains(second);
      if (containsSecond && userCount > 0 && text.length >= 10 && text.length <= 2e5) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }
  function findSemanticCommentContainer() {
    const header = findCommentHeader();
    const input = findCommentInput();
    if (header) {
      const shared = smallestSharedAncestor(header, input);
      if (shared) {
        return { element: shared, selector: "\u8BED\u4E49\uFF1A\u5168\u90E8\u8BC4\u8BBA\u6807\u9898\u4E0E\u8BC4\u8BBA\u8F93\u5165\u6846" };
      }
    }
    if (input) {
      let current = input;
      for (let level = 0; current && level < 12; level += 1) {
        const userCount = current.querySelectorAll('a[href*="/user/"]').length;
        if (userCount >= 2) {
          return { element: current, selector: "\u8BED\u4E49\uFF1A\u8BC4\u8BBA\u8F93\u5165\u6846\u4E0E\u4F5C\u8005\u94FE\u63A5" };
        }
        current = current.parentElement;
      }
    }
    return { element: null, selector: null };
  }
  function findCommentContainer() {
    const explicit = findFirst(document, DOUYIN_SELECTORS.commentContainers);
    return explicit.element ? explicit : findSemanticCommentContainer();
  }
  function findToolbarAnchor(container) {
    const localElements = Array.from(
      container.querySelectorAll("h1, h2, h3, div, span, p")
    ).slice(0, 3e3);
    return localElements.find((element) => {
      const text = ownText(element) || cleanText(element.textContent);
      return /^全部评论\s*[（(]?\s*[\d,.万亿wW+]+/u.test(text);
    }) ?? null;
  }
  function isScrollable(element) {
    const style = getComputedStyle(element);
    return /(?:auto|scroll|overlay)/u.test(style.overflowY) && element.scrollHeight > element.clientHeight + 24;
  }
  function findCommentScroller() {
    const container = findCommentContainer().element;
    if (!container) return null;
    const descendant = Array.from(
      container.querySelectorAll("div, section")
    ).filter(
      (element) => isVisible(element) && isScrollable(element) && element.querySelector('a[href*="/user/"]')
    ).sort(
      (left, right) => right.scrollHeight - right.clientHeight - (left.scrollHeight - left.clientHeight)
    )[0];
    if (descendant) return descendant;
    let current = container;
    for (let level = 0; current && level < 10; level += 1) {
      if (isScrollable(current)) return current;
      current = current.parentElement;
    }
    return null;
  }
  function getPageStatus() {
    const video = getVideoContext();
    if (!isDouyinPage()) {
      return {
        state: "not-douyin",
        message: "\u8BF7\u5148\u6253\u5F00\u6296\u97F3\u7F51\u9875\u7248\u89C6\u9891\u9875\u9762\u3002",
        isDouyin: false,
        hasCommentArea: false,
        ...video
      };
    }
    const container = findCommentContainer();
    if (!container.element) {
      return {
        state: "comment-area-missing",
        message: "\u6682\u672A\u68C0\u6D4B\u5230\u8BC4\u8BBA\u533A\uFF0C\u8BF7\u5148\u6253\u5F00\u89C6\u9891\u8BC4\u8BBA\u533A\u3002",
        isDouyin: true,
        hasCommentArea: false,
        ...video
      };
    }
    return {
      state: "ready",
      message: "\u5DF2\u68C0\u6D4B\u5230\u6296\u97F3\u8BC4\u8BBA\u533A\u3002",
      isDouyin: true,
      hasCommentArea: true,
      ...video
    };
  }

  // src/utils/parse-count.ts
  var MULTIPLIERS = {
    \u4E07: 1e4,
    w: 1e4,
    W: 1e4,
    \u4EBF: 1e8
  };
  function parseCountDetailed(input) {
    const raw = typeof input === "string" ? input : input == null ? "" : String(input);
    const normalized = raw.trim().replaceAll(/\s+/g, "").replaceAll(",", "").replace(/^(点赞|获赞|赞同|回复|评论|共|查看|展开|还有)/, "").replace(/(条)?(回复|评论)$/, "").replace(/\+$/, "");
    if (!normalized || normalized === "\u8D5E" || normalized === "\u6536\u8D77\u56DE\u590D") {
      return { value: 0, raw, parsed: normalized === "" || normalized === "\u8D5E" };
    }
    const match = normalized.match(/^(-?\d+(?:\.\d+)?)(万|亿|w|W)?$/);
    if (!match) return { value: 0, raw, parsed: false };
    const numeric = Number(match[1]);
    const unit = match[2] ?? "";
    if (!Number.isFinite(numeric) || numeric < 0) {
      return { value: 0, raw, parsed: false };
    }
    const multiplier = unit ? MULTIPLIERS[unit] ?? 1 : 1;
    const value = Math.round(numeric * multiplier);
    return {
      value: Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER,
      raw,
      parsed: true
    };
  }

  // src/adapters/douyin/extractor.ts
  var REPLY_COUNT_PATTERN = /(?:展开|共|查看|还有)?\s*([\d.,]+\s*[万亿wW]?\+?)\s*条?\s*回复/iu;
  var TIME_PATTERN = /(?:刚刚|昨天|\d+\s*(?:秒|分钟|小时|天|周|月|年)前|\d{1,4}[-/.]\d{1,2}[-/.]\d{1,2})/u;
  var ACTION_ONLY_PATTERN = /^(?:回复|评论|分享|转发|收藏|赞|点赞|举报|删除|置顶|作者赞过|收起回复)$/u;
  function cleanText2(value) {
    return (value ?? "").replaceAll(/\s+/g, " ").trim();
  }
  function ownText2(element) {
    return cleanText2(
      Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? "").join(" ")
    );
  }
  function getElementLabel(element) {
    return cleanText2(
      [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        ownText2(element),
        element.textContent
      ].filter(Boolean).join(" ")
    );
  }
  function isAfter(element, reference) {
    return Boolean(
      reference.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING
    );
  }
  function isBefore(element, reference) {
    return Boolean(
      element.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING
    );
  }
  function isInteractionOnlyText(text) {
    const compact = text.replaceAll(/\s+/g, "").replaceAll(/[·•|｜/\\:：,，。;；()（）\[\]【】]/g, "");
    return /^(?:(?:\d+(?:\.\d+)?[万亿wW]?\+?)|回复|评论|分享|转发|收藏|赞|点赞|举报|删除|置顶|作者赞过|收起回复)+$/u.test(
      compact
    );
  }
  function meaningfulCommentText(text, authorName) {
    if (!text || text === authorName || text.length > 2400) return false;
    if (ACTION_ONLY_PATTERN.test(text)) return false;
    if (isInteractionOnlyText(text)) return false;
    if (REPLY_COUNT_PATTERN.test(text)) return false;
    if (TIME_PATTERN.test(text) && text.length <= 40) return false;
    if (/^IP(?:属地)?\s*[:：]?/u.test(text)) return false;
    if (/^[\d.,]+\s*[万亿wW]?\+?$/u.test(text)) return false;
    return !/^(?:回复|分享|点赞)\s*[\d.,万亿wW+]*$/u.test(text);
  }
  function findActionRow(node) {
    const candidates = Array.from(
      node.querySelectorAll(
        'button, [role="button"], div, span'
      )
    ).filter((element) => {
      const text = ownText2(element) || cleanText2(element.textContent);
      const label = cleanText2(element.getAttribute("aria-label"));
      return text === "\u56DE\u590D" || text === "\u8BC4\u8BBA" || label === "\u56DE\u590D" || label === "\u8BC4\u8BBA";
    });
    for (const candidate of candidates) {
      let current = candidate;
      for (let level = 0; current && level < 5; level += 1) {
        const text = cleanText2(current.textContent);
        const controls = current.querySelectorAll(
          'button, [role="button"], svg'
        ).length;
        if (text.includes("\u5206\u4EAB") && controls >= 2 || controls >= 3) {
          return current;
        }
        current = current.parentElement;
        if (current === node.parentElement) break;
      }
    }
    return candidates[0]?.parentElement ?? null;
  }
  function extractAuthor(node) {
    const candidates = /* @__PURE__ */ new Set();
    for (const selector of DOUYIN_SELECTORS.author) {
      node.querySelectorAll(selector).forEach((element2) => {
        candidates.add(element2);
      });
    }
    const elements = Array.from(candidates);
    const element = elements.find((candidate) => {
      const text = cleanText2(candidate.textContent);
      return text.length > 0 && text.length <= 100;
    }) ?? findFirst(node, DOUYIN_SELECTORS.author).element;
    const anchor = element instanceof HTMLAnchorElement ? element : element?.closest("a[href]");
    return {
      name: cleanText2(element?.textContent),
      url: anchor?.href ?? null,
      element
    };
  }
  function extractCommentText(node, authorName, authorElement) {
    const actionRow = findActionRow(node);
    const explicit = findFirst(node, DOUYIN_SELECTORS.commentText).element;
    const explicitText = cleanText2(explicit?.textContent);
    const explicitIsSeparateFromActions = !explicit || !actionRow || !actionRow.contains(explicit) && !explicit.contains(actionRow);
    if (explicitIsSeparateFromActions && meaningfulCommentText(explicitText, authorName)) {
      return { text: explicitText, foundBySelector: true };
    }
    const elements = Array.from(
      node.querySelectorAll("div, span, p")
    ).slice(0, 500);
    const scored = [];
    const directPieces = [];
    for (const element of elements) {
      if (actionRow && (actionRow === element || actionRow.contains(element))) {
        continue;
      }
      if (authorElement && !isAfter(element, authorElement)) continue;
      if (actionRow && !isBefore(element, actionRow)) continue;
      if (element.querySelector('a[href*="/user/"]')) continue;
      const direct = ownText2(element);
      const full = direct || (element.childElementCount <= 6 ? cleanText2(element.textContent) : "");
      if (!meaningfulCommentText(full, authorName)) continue;
      const classHint = String(element.className).toLocaleLowerCase();
      let score = full.length;
      if (direct) score += Math.min(direct.length * 2, 400);
      if (/comment|content|text/u.test(classHint)) score += 120;
      if (element.childElementCount === 0) score += 40;
      if (/time|action|reply|like/u.test(classHint)) score -= 180;
      scored.push({ text: full, score });
      if (direct && !directPieces.includes(direct)) directPieces.push(direct);
    }
    scored.sort((left, right) => right.score - left.score);
    const best = scored[0]?.text ?? "";
    const combined = directPieces.join("\n").trim();
    const text = combined.length > best.length && combined.length <= 2400 && directPieces.length <= 30 ? combined : best;
    return { text, foundBySelector: false };
  }
  function extractLikeCount(node) {
    const actionRow = findActionRow(node);
    const searchRoot = actionRow ?? node;
    const explicit = findFirst(searchRoot, DOUYIN_SELECTORS.likeCount).element;
    const explicitLabel = explicit ? getElementLabel(explicit) : "";
    const explicitRaw = explicitLabel.match(/([\d.,]+\s*[万亿wW]?\+?)/u)?.[1] ?? (explicitLabel === "\u8D5E" ? "\u8D5E" : "");
    if (explicitRaw) {
      const parsed2 = parseCountDetailed(explicitRaw);
      return { value: parsed2.value, raw: explicitRaw, parsed: parsed2.parsed };
    }
    const numericCandidates = Array.from(
      searchRoot.querySelectorAll(
        'button, [role="button"], span, div'
      )
    ).map((element, index) => {
      const text = ownText2(element) || cleanText2(element.textContent);
      const raw2 = text.match(/^([\d.,]+\s*[万亿wW]?\+?)$/u)?.[1] ?? "";
      const hint = `${element.className} ${element.getAttribute("aria-label") ?? ""}`.toLocaleLowerCase();
      return {
        raw: raw2,
        index,
        score: /(like|digg|赞|heart)/u.test(hint) ? 1e3 + index : index
      };
    }).filter((candidate) => candidate.raw).sort((left, right) => right.score - left.score);
    const raw = numericCandidates[0]?.raw ?? "";
    if (!raw) return { value: 0, raw: "", parsed: false };
    const parsed = parseCountDetailed(raw);
    return { value: parsed.value, raw, parsed: parsed.parsed };
  }
  function extractReplyCount(node) {
    const explicit = findFirst(node, DOUYIN_SELECTORS.replyCount).element;
    const candidates = [
      explicit ? getElementLabel(explicit) : "",
      ...Array.from(node.querySelectorAll("button, span, div")).slice(0, 500).map((element) => ownText2(element)).filter(Boolean),
      cleanText2(node.textContent)
    ];
    for (const text of candidates) {
      const match = text.match(REPLY_COUNT_PATTERN);
      if (!match) continue;
      const parsed = parseCountDetailed(match[1] ?? "");
      if (parsed.parsed) {
        return {
          value: parsed.value,
          raw: match[0],
          estimated: false,
          parsed: true
        };
      }
    }
    return { value: 0, raw: "", estimated: true, parsed: false };
  }
  function extractPublishTime(node) {
    const explicit = findFirst(node, DOUYIN_SELECTORS.publishTime).element;
    const explicitText = cleanText2(explicit?.textContent);
    if (explicitText && TIME_PATTERN.test(explicitText)) return explicitText;
    const pieces = Array.from(
      node.querySelectorAll("time, span, div")
    ).slice(0, 500).map((element) => ownText2(element) || cleanText2(element.textContent)).filter((text) => text.length <= 80);
    return pieces.find((text) => TIME_PATTERN.test(text)) ?? null;
  }
  function extractIpLocation(node) {
    const pieces = Array.from(
      node.querySelectorAll("time, span, div, p")
    ).slice(0, 500).map((element) => ownText2(element)).filter((text) => text.length > 0 && text.length <= 80);
    for (const text of pieces) {
      const explicit = text.match(
        /IP(?:属地)?\s*[:：]?\s*([^\s·|]{1,20})$/u
      );
      if (explicit) return explicit[0].trim();
      const timeAndLocation = text.match(
        /(?:刚刚|昨天|\d+\s*(?:秒|分钟|小时|天|周|月|年)前|\d{1,4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?)\s*[·・|]\s*([^\s·|]{1,20})$/u
      );
      if (timeAndLocation?.[1]) {
        return `IP\u5C5E\u5730\uFF1A${timeAndLocation[1]}`;
      }
    }
    return null;
  }
  function extractNativeId(node) {
    const idAttributes = [
      "data-comment-id",
      "data-commentid",
      "data-cid",
      "data-item-id"
    ];
    for (const attribute of idAttributes) {
      const ownValue = node.getAttribute(attribute);
      if (ownValue?.trim()) return ownValue.trim();
      const nested = node.querySelector(`[${attribute}]`)?.getAttribute(attribute);
      if (nested?.trim()) return nested.trim();
    }
    const link = node.querySelector(
      'a[href*="comment_id="], a[href*="commentId="], a[href*="cid="]'
    );
    if (!link) return null;
    const parsed = new URL(link.href, location.href);
    return parsed.searchParams.get("comment_id") ?? parsed.searchParams.get("commentId") ?? parsed.searchParams.get("cid");
  }

  // src/adapters/douyin/DouyinAdapter.ts
  function cleanText3(value) {
    return (value ?? "").replaceAll(/\s+/g, " ").trim();
  }
  function isVisible2(element) {
    if (!(element instanceof HTMLElement)) return true;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }
  function selectLargestCandidateSet(root) {
    let best = { nodes: [], selector: null };
    for (const selector of DOUYIN_SELECTORS.commentItems) {
      const nodes = Array.from(root.querySelectorAll(selector)).filter(isVisible2);
      if (nodes.length > best.nodes.length) best = { nodes, selector };
    }
    return best;
  }
  function authorElements(root) {
    const found = /* @__PURE__ */ new Set();
    for (const selector of DOUYIN_SELECTORS.author) {
      root.querySelectorAll(selector).forEach((element) => found.add(element));
    }
    return Array.from(found).filter(isVisible2).slice(0, 2e3);
  }
  function scoreCommentRoot(candidate, author) {
    const text = cleanText3(candidate.textContent);
    if (text.length < 5 || text.length > 6e3 || /全部评论/u.test(text)) {
      return -1;
    }
    const authorCount = authorElements(candidate).length;
    if (authorCount === 0 || authorCount > 4) return -1;
    let score = 0;
    if (candidate.contains(author)) score += 3;
    if (authorCount === 1) score += 4;
    if (findActionRow(candidate)) score += 6;
    if (/(?:刚刚|昨天|\d+\s*(?:秒|分钟|小时|天|周|月|年)前|\d{1,4}[-/.]\d{1,2})/u.test(
      text
    )) {
      score += 4;
    }
    if (/(?:展开|查看|共|还有)\s*[\d.,万亿wW+]+\s*条?\s*回复/u.test(text)) {
      score += 2;
    }
    if (candidate.querySelector('button, [role="button"], svg')) score += 2;
    if (text.length >= 12) score += 1;
    return score;
  }
  function semanticCommentNodes(root) {
    const found = /* @__PURE__ */ new Set();
    for (const author of authorElements(root)) {
      let current = author.parentElement;
      let best = null;
      for (let level = 0; current && level < 9; level += 1) {
        if (!root.contains(current)) break;
        const score = scoreCommentRoot(current, author);
        const length = cleanText3(current.textContent).length;
        if (score >= 7 && (!best || score > best.score || score === best.score && length < best.length)) {
          best = { node: current, score, length };
        }
        if (current === root) break;
        current = current.parentElement;
      }
      if (best) found.add(best.node);
    }
    return Array.from(found);
  }
  function nearestCandidateParent(node, candidateSet) {
    let parent = node.parentElement;
    while (parent && parent !== document.body) {
      if (candidateSet.has(parent)) return parent;
      parent = parent.parentElement;
    }
    return null;
  }
  function elementStructureHint(element) {
    return [
      element.id,
      element.className,
      element.getAttribute("data-e2e"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-comment-level"),
      element.getAttribute("aria-label")
    ].filter(Boolean).join(" ").toLocaleLowerCase();
  }
  function hasExplicitReplyStructure(node, container) {
    const levelOne = node.querySelector('[data-e2e="comment-level-1"]');
    const levelTwo = node.querySelector('[data-e2e="comment-level-2"]');
    if (levelTwo && !levelOne) return true;
    let current = node;
    for (let level = 0; current && level < 12; level += 1) {
      if (/reply[-_]?(?:item|list|container|comment)|comment[-_]?reply|sub[-_]?(?:comment|reply)|comment[-_]?level[-_]?2|level[-_]?2/iu.test(
        elementStructureHint(current)
      )) {
        return true;
      }
      if (current === container) break;
      current = current.parentElement;
    }
    return false;
  }
  function collapseCommentThreads(nodes, container) {
    if (!container || nodes.length < 2) {
      return { nodes, filteredReplies: 0 };
    }
    const parentGroups = /* @__PURE__ */ new Map();
    for (const node of nodes) {
      let branch = node;
      let parent = node.parentElement;
      for (let level = 0; parent && level < 14; level += 1) {
        if (!container.contains(parent) && parent !== container) break;
        const branches = parentGroups.get(parent) ?? /* @__PURE__ */ new Map();
        const groupedNodes = branches.get(branch) ?? [];
        groupedNodes.push(node);
        branches.set(branch, groupedNodes);
        parentGroups.set(parent, branches);
        if (parent === container) break;
        branch = parent;
        parent = parent.parentElement;
      }
    }
    const candidates = Array.from(parentGroups, ([parent, branches]) => ({
      parent,
      branches,
      coverage: Array.from(branches.values()).reduce(
        (total, groupedNodes) => total + groupedNodes.length,
        0
      )
    })).filter(({ branches }) => branches.size >= 2).sort(
      (left, right) => right.coverage - left.coverage || right.branches.size - left.branches.size
    );
    const best = candidates[0];
    if (!best || best.coverage < Math.ceil(nodes.length * 0.6)) {
      return { nodes, filteredReplies: 0 };
    }
    const selected = /* @__PURE__ */ new Set();
    for (const groupedNodes of best.branches.values()) {
      const first = groupedNodes[0];
      if (first) selected.add(first);
    }
    for (const node of nodes) {
      if (!best.parent.contains(node)) selected.add(node);
    }
    const collapsed = nodes.filter((node) => selected.has(node));
    return {
      nodes: collapsed,
      filteredReplies: nodes.length - collapsed.length
    };
  }
  function mainLevelNodes(nodes, container) {
    const withoutExplicitReplies = nodes.filter(
      (node) => !hasExplicitReplyStructure(node, container)
    );
    const explicitReplyCount = nodes.length - withoutExplicitReplies.length;
    const collapsed = collapseCommentThreads(
      withoutExplicitReplies,
      container
    );
    const candidateSet = new Set(collapsed.nodes);
    const leftValues = collapsed.nodes.map((node) => node.getBoundingClientRect().left).filter((value) => Number.isFinite(value) && value > 0);
    const minLeft = leftValues.length ? Math.min(...leftValues) : 0;
    const main = [];
    let filteredReplies = explicitReplyCount + collapsed.filteredReplies;
    for (const node of collapsed.nodes) {
      const nested = Boolean(nearestCandidateParent(node, candidateSet));
      const left = node.getBoundingClientRect().left;
      const indented = minLeft > 0 && left > minLeft + 36;
      if (nested || indented) {
        filteredReplies += 1;
      } else {
        main.push(node);
      }
    }
    return { main, filteredReplies };
  }
  function diagnosticRate(success, total) {
    return total === 0 ? 0 : success / total;
  }
  function selectMovableNodes(nodes, container) {
    const groups = /* @__PURE__ */ new Map();
    for (const commentNode of nodes) {
      let unit = commentNode;
      for (let level = 0; level < 10; level += 1) {
        const parent = unit.parentElement;
        if (!parent || !container.contains(parent)) break;
        const entries = groups.get(parent) ?? [];
        entries.push({ commentNode, unit, level });
        groups.set(parent, entries);
        if (parent === container) break;
        unit = parent;
      }
    }
    const selected = /* @__PURE__ */ new Map();
    for (const entries of groups.values()) {
      if (entries.length < 2) continue;
      const uniqueUnits = new Set(entries.map(({ unit }) => unit));
      if (uniqueUnits.size !== entries.length) continue;
      for (const entry of entries) {
        const previous = selected.get(entry.commentNode);
        if (!previous || entry.level < previous.level) {
          selected.set(entry.commentNode, {
            unit: entry.unit,
            level: entry.level
          });
        }
      }
    }
    return new Map(
      Array.from(selected, ([commentNode, selection]) => [
        commentNode,
        selection.unit
      ])
    );
  }
  var DouyinAdapter = class {
    originalIndices = /* @__PURE__ */ new Map();
    moveNodeByCommentId = /* @__PURE__ */ new Map();
    commentsById = /* @__PURE__ */ new Map();
    nextOriginalIndex = 0;
    videoKey = "";
    getPageStatus() {
      return getPageStatus();
    }
    clear() {
      this.originalIndices.clear();
      this.moveNodeByCommentId.clear();
      this.commentsById.clear();
      this.nextOriginalIndex = 0;
      this.videoKey = "";
    }
    scan() {
      const startedAt = performance.now();
      const initialStatus = getPageStatus();
      const video = getVideoContext();
      const nextVideoKey = video.videoId || video.videoUrl;
      if (this.videoKey && this.videoKey !== nextVideoKey) this.clear();
      this.videoKey = nextVideoKey;
      const containerMatch = findCommentContainer();
      const container = containerMatch.element;
      const warnings = [];
      let selected = { nodes: [], selector: null };
      if (container) {
        const semanticNodes = semanticCommentNodes(container);
        if (semanticNodes.length > 0) {
          selected = {
            nodes: semanticNodes,
            selector: "\u8BED\u4E49\uFF1A\u4F5C\u8005\u3001\u65F6\u95F4\u4E0E\u8BC4\u8BBA\u64CD\u4F5C\u533A"
          };
        } else {
          selected = selectLargestCandidateSet(container);
          if (selected.nodes.length > 0) {
            warnings.push("\u672A\u5F62\u6210\u8BED\u4E49\u8BC4\u8BBA\u8FB9\u754C\uFF0C\u5DF2\u4F7F\u7528\u5019\u9009\u8BC4\u8BBA\u8282\u70B9\u3002");
          }
        }
      }
      const visibleNodes = selected.nodes.filter(isVisible2);
      const levelResult = mainLevelNodes(visibleNodes, container);
      const mainNodes = levelResult.main;
      const movableNodes = container ? selectMovableNodes(mainNodes, container) : /* @__PURE__ */ new Map();
      const rawComments = [];
      this.moveNodeByCommentId.clear();
      let textParseSuccess = 0;
      let authorParseSuccess = 0;
      let likeParseSuccess = 0;
      let replyParseSuccess = 0;
      let filteredNodeCount = selected.nodes.length - visibleNodes.length + levelResult.filteredReplies;
      for (const node of mainNodes) {
        const author = extractAuthor(node);
        const textResult = extractCommentText(
          node,
          author.name,
          author.element
        );
        if (!textResult.text) {
          filteredNodeCount += 1;
          continue;
        }
        const like = extractLikeCount(node);
        const reply = extractReplyCount(node);
        const publishTimeText = extractPublishTime(node);
        const nativeId = extractNativeId(node);
        const id = nativeId !== null ? `native_${nativeId}` : createFallbackCommentId({
          videoId: video.videoId,
          authorName: author.name,
          text: textResult.text,
          publishTimeText
        });
        const parseWarnings = [];
        if (!author.name) parseWarnings.push("\u672A\u8BFB\u53D6\u5230\u4F5C\u8005");
        if (!like.parsed) parseWarnings.push("\u70B9\u8D5E\u6570\u672A\u660E\u786E\u5C55\u793A\u6216\u65E0\u6CD5\u89E3\u6790");
        if (!reply.parsed) parseWarnings.push("\u56DE\u590D\u6570\u672A\u660E\u786E\u5C55\u793A");
        if (!textResult.foundBySelector) {
          parseWarnings.push("\u8BC4\u8BBA\u6B63\u6587\u7531\u8BED\u4E49\u89C4\u5219\u8BC6\u522B");
        }
        let originalIndex = this.originalIndices.get(id);
        if (originalIndex === void 0) {
          originalIndex = this.nextOriginalIndex;
          this.originalIndices.set(id, originalIndex);
          this.nextOriginalIndex += 1;
        }
        const comment = {
          id,
          nativeId,
          videoId: video.videoId,
          videoUrl: video.videoUrl,
          videoTitle: video.videoTitle,
          authorName: author.name || "\u672A\u8BFB\u53D6\u5230\u4F5C\u8005",
          authorUrl: author.url,
          text: textResult.text,
          likeCount: like.value,
          likeCountRaw: like.raw,
          replyCount: reply.value,
          replyCountRaw: reply.raw,
          replyCountEstimated: reply.estimated,
          publishTimeText,
          ipLocationText: extractIpLocation(node),
          originalIndex,
          scannedAt: (/* @__PURE__ */ new Date()).toISOString(),
          parseWarnings
        };
        textParseSuccess += 1;
        if (author.name) authorParseSuccess += 1;
        if (like.parsed) likeParseSuccess += 1;
        if (reply.parsed) replyParseSuccess += 1;
        rawComments.push(comment);
        const moveNode = movableNodes.get(node);
        if (moveNode) this.moveNodeByCommentId.set(id, moveNode);
      }
      const deduplicated = deduplicateComments(rawComments);
      for (const comment of deduplicated.comments) {
        this.commentsById.set(comment.id, comment);
      }
      const collectedComments = Array.from(this.commentsById.values()).sort(
        (left, right) => left.originalIndex - right.originalIndex
      );
      const diagnostics = {
        commentContainerFound: Boolean(container),
        commentContainerSelector: containerMatch.selector,
        commentItemSelector: selected.selector,
        candidateNodeCount: selected.nodes.length,
        commentItemCount: collectedComments.length,
        textParseSuccess,
        authorParseSuccess,
        likeParseSuccess,
        replyParseSuccess,
        filteredNodeCount,
        duplicateCount: deduplicated.duplicateCount,
        elapsedMs: Math.round(performance.now() - startedAt),
        warnings
      };
      let pageStatus = initialStatus;
      if (initialStatus.state === "ready" && collectedComments.length === 0) {
        pageStatus = {
          ...initialStatus,
          state: selected.nodes.length ? "structure-changed" : "comments-empty",
          message: selected.nodes.length ? "\u627E\u5230\u4E86\u8BC4\u8BBA\u533A\u57DF\uFF0C\u4F46\u6CA1\u6709\u6210\u529F\u8BFB\u53D6\u8BC4\u8BBA\u6B63\u6587\u3002" : "\u8BC4\u8BBA\u533A\u5DF2\u6253\u5F00\uFF0C\u4F46\u5F53\u524D\u6CA1\u6709\u8BFB\u53D6\u5230\u5DF2\u52A0\u8F7D\u8BC4\u8BBA\u3002"
        };
      } else if (mainNodes.length > 0 && diagnosticRate(textParseSuccess, mainNodes.length) < LOW_PARSE_SUCCESS_RATE) {
        pageStatus = {
          ...initialStatus,
          state: "structure-changed",
          message: "\u8BC4\u8BBA\u6B63\u6587\u8BC6\u522B\u7387\u504F\u4F4E\uFF0C\u8BF7\u91CD\u65B0\u626B\u63CF\u6216\u590D\u5236\u8BCA\u65AD\u4FE1\u606F\u3002"
        };
        diagnostics.warnings.push("\u8BC4\u8BBA\u6B63\u6587\u8BC6\u522B\u7387\u504F\u4F4E\u3002");
      }
      const htmlContainer = container;
      const likelyHasUnloadedComments = Boolean(
        htmlContainer && (htmlContainer.scrollHeight > htmlContainer.clientHeight || /(?:展开|查看|还有)\s*[\d.,万亿wW+]*\s*条?\s*回复/u.test(
          htmlContainer.innerText
        ))
      ) || collectedComments.length > 0;
      return {
        pageStatus,
        comments: collectedComments,
        mainCommentCount: collectedComments.length,
        scannedAt: (/* @__PURE__ */ new Date()).toISOString(),
        likelyHasUnloadedComments,
        diagnostics
      };
    }
    reorder(comments, label) {
      const groups = /* @__PURE__ */ new Map();
      for (const comment of comments) {
        const moveNode = this.moveNodeByCommentId.get(comment.id);
        const parent = moveNode?.parentElement;
        if (!moveNode?.isConnected || !parent) continue;
        const units = groups.get(parent) ?? [];
        if (!units.includes(moveNode)) units.push(moveNode);
        groups.set(parent, units);
      }
      let movedCount = 0;
      let groupCount = 0;
      for (const [parent, units] of groups) {
        if (units.length < 2) continue;
        const unitSet = new Set(units);
        const currentUnits = Array.from(parent.children).filter(
          (child) => unitSet.has(child)
        );
        if (currentUnits.length !== units.length) continue;
        const markers = currentUnits.map((unit) => {
          const marker = document.createComment("dcs-comment-sort-position");
          parent.insertBefore(marker, unit);
          return marker;
        });
        units.forEach((unit, index) => {
          const marker = markers[index];
          if (marker) parent.insertBefore(unit, marker);
        });
        markers.forEach((marker) => marker.remove());
        movedCount += units.length;
        groupCount += 1;
      }
      return {
        movedCount,
        groupCount,
        message: movedCount > 0 ? `\u5DF2\u6309${label}\u8C03\u6574${movedCount}\u6761\u4E3B\u8BC4\u8BBA\u3002` : "\u5F53\u524D\u8BC4\u8BBA\u8282\u70B9\u65E0\u6CD5\u5B89\u5168\u8C03\u6574\uFF0C\u8BF7\u6EDA\u52A8\u8BC4\u8BBA\u533A\u540E\u91CD\u65B0\u626B\u63CF\u3002"
      };
    }
  };

  // src/shared/messages.ts
  function isActivateToolbarRequest(value) {
    if (!value || typeof value !== "object") return false;
    const candidate = value;
    return candidate.type === "DCS_ACTIVATE_TOOLBAR";
  }

  // src/utils/debounce.ts
  function debounce(callback, waitMs) {
    let timer;
    const debounced = ((...args) => {
      if (timer !== void 0) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = void 0;
        callback(...args);
      }, waitMs);
    });
    debounced.cancel = () => {
      if (timer !== void 0) clearTimeout(timer);
      timer = void 0;
    };
    return debounced;
  }

  // src/utils/export-csv.ts
  var HEADERS = [
    "\u6392\u540D",
    "\u8BC4\u8BBA\u5185\u5BB9",
    "\u4F5C\u8005",
    "\u70B9\u8D5E\u6570",
    "\u56DE\u590D\u6570",
    "\u53D1\u5E03\u65F6\u95F4"
  ];
  var TIME_PATTERN2 = /(?:刚刚|昨天|\d+\s*(?:秒|分钟|小时|天|周|月|年)前|\d{1,4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?)/u;
  function protectSpreadsheetFormula(value) {
    return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  }
  function csvCell(value) {
    const stringValue = protectSpreadsheetFormula(
      value == null ? "" : String(value)
    );
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  function formatPublishInfo(comment) {
    const rawTime = comment.publishTimeText?.trim() ?? "";
    const time = rawTime.match(TIME_PATTERN2)?.[0]?.replaceAll(/\s+/g, "") ?? "";
    const locationFromTime = rawTime.match(/[·・|]\s*([^\s·・|]{1,20})\s*$/u)?.[1] ?? "";
    const location2 = (comment.ipLocationText ?? "").replace(/^IP(?:属地)?\s*[:：]?\s*/u, "").trim() || locationFromTime;
    if (time && location2) return `${time}\xB7${location2}`;
    return time || location2;
  }
  function exportCommentsCsv(comments) {
    const rows = comments.map((comment, index) => {
      return [
        index + 1,
        comment.text,
        comment.authorName,
        comment.likeCount,
        comment.replyCount,
        formatPublishInfo(comment)
      ];
    });
    return `\uFEFF${[HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  }

  // src/utils/stable-sort.ts
  function compareNumberDesc(left, right) {
    return right - left;
  }
  function stableSortComments(comments, mode) {
    return comments.map((comment, stableIndex) => ({ comment, stableIndex })).sort((left, right) => {
      const a = left.comment;
      const b = right.comment;
      let result = 0;
      if (mode === "likes") {
        result = compareNumberDesc(a.likeCount, b.likeCount) || compareNumberDesc(a.replyCount, b.replyCount);
      } else if (mode === "replies") {
        result = compareNumberDesc(a.replyCount, b.replyCount) || compareNumberDesc(a.likeCount, b.likeCount);
      }
      return result || a.originalIndex - b.originalIndex || left.stableIndex - right.stableIndex;
    }).map(({ comment }) => comment);
  }

  // node_modules/@phosphor-icons/core/assets/regular/arrows-clockwise.svg
  var arrows_clockwise_default = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M224,48V96a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h28.69L182.06,73.37a79.56,79.56,0,0,0-56.13-23.43h-.45A79.52,79.52,0,0,0,69.59,72.71,8,8,0,0,1,58.41,61.27a96,96,0,0,1,135,.79L208,76.69V48a8,8,0,0,1,16,0ZM186.41,183.29a80,80,0,0,1-112.47-.66L59.31,168H88a8,8,0,0,0,0-16H40a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V179.31l14.63,14.63A95.43,95.43,0,0,0,130,222.06h.53a95.36,95.36,0,0,0,67.07-27.33,8,8,0,0,0-11.18-11.44Z"/></svg>';

  // node_modules/@phosphor-icons/core/assets/regular/caret-down.svg
  var caret_down_default = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/></svg>';

  // node_modules/@phosphor-icons/core/assets/regular/chat-circle.svg
  var chat_circle_default = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z"/></svg>';

  // node_modules/@phosphor-icons/core/assets/regular/copy.svg
  var copy_default = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg>';

  // node_modules/@phosphor-icons/core/assets/regular/download-simple.svg
  var download_simple_default = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32Z"/></svg>';

  // node_modules/@phosphor-icons/core/assets/regular/file-csv.svg
  var file_csv_default = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M48,180c0,11,7.18,20,16,20a14.24,14.24,0,0,0,10.22-4.66A8,8,0,0,1,85.78,206.4,30.06,30.06,0,0,1,64,216c-17.65,0-32-16.15-32-36s14.35-36,32-36a30.06,30.06,0,0,1,21.78,9.6,8,8,0,0,1-11.56,11.06A14.24,14.24,0,0,0,64,160C55.18,160,48,169,48,180Zm79.6-8.69c-4-1.16-8.14-2.35-10.45-3.84-1.25-.81-1.23-1-1.12-1.9a4.57,4.57,0,0,1,2-3.67c4.6-3.12,15.34-1.73,19.82-.56A8,8,0,0,0,142,145.86c-2.12-.55-21-5.22-32.84,2.76a20.58,20.58,0,0,0-9,14.95c-2,15.88,13.65,20.41,23,23.11,12.06,3.49,13.12,4.92,12.78,7.59-.31,2.41-1.26,3.34-2.14,3.93-4.6,3.06-15.17,1.56-19.55.36A8,8,0,0,0,109.94,214a61.34,61.34,0,0,0,15.19,2c5.82,0,12.3-1,17.49-4.46a20.82,20.82,0,0,0,9.19-15.23C154,179,137.49,174.17,127.6,171.31Zm83.09-26.84a8,8,0,0,0-10.23,4.84L188,184.21l-12.47-34.9a8,8,0,0,0-15.07,5.38l20,56a8,8,0,0,0,15.07,0l20-56A8,8,0,0,0,210.69,144.47ZM216,88v24a8,8,0,0,1-16,0V96H152a8,8,0,0,1-8-8V40H56v72a8,8,0,0,1-16,0V40A16,16,0,0,1,56,24h96a8,8,0,0,1,5.66,2.34l56,56A8,8,0,0,1,216,88Zm-27.31-8L160,51.31V80Z"/></svg>';

  // node_modules/@phosphor-icons/core/assets/regular/list-plus.svg
  var list_plus_default = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M32,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H40A8,8,0,0,1,32,64Zm8,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16Zm104,48H40a8,8,0,0,0,0,16H144a8,8,0,0,0,0-16Zm88,0H216V168a8,8,0,0,0-16,0v16H184a8,8,0,0,0,0,16h16v16a8,8,0,0,0,16,0V200h16a8,8,0,0,0,0-16Z"/></svg>';

  // node_modules/@phosphor-icons/core/assets/regular/stop-circle.svg
  var stop_circle_default = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216ZM160,88H96a8,8,0,0,0-8,8v64a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V96A8,8,0,0,0,160,88Zm-8,64H104V104h48Z"/></svg>';

  // node_modules/@phosphor-icons/core/assets/regular/thumbs-up.svg
  var thumbs_up_default = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M234,80.12A24,24,0,0,0,216,72H160V56a40,40,0,0,0-40-40,8,8,0,0,0-7.16,4.42L75.06,96H32a16,16,0,0,0-16,16v88a16,16,0,0,0,16,16H204a24,24,0,0,0,23.82-21l12-96A24,24,0,0,0,234,80.12ZM32,112H72v88H32ZM223.94,97l-12,96a8,8,0,0,1-7.94,7H88V105.89l36.71-73.43A24,24,0,0,1,144,56V80a8,8,0,0,0,8,8h64a8,8,0,0,1,7.94,9Z"/></svg>';

  // src/content/sticky-toolbar.ts
  var TOOLBAR_HOST_ID = "dcs-inline-toolbar-host";
  var COMPACT_WIDTH_PX = 720;
  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== void 0) element.textContent = text;
    return element;
  }
  function createButton(label, className, handler, icons = {}) {
    const button = createElement("button", className);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    if (icons.leading) {
      button.append(createIcon(icons.leading, "button-icon"));
    }
    button.append(createElement("span", "button-label", label));
    if (icons.trailing) {
      button.append(createIcon(icons.trailing, "button-icon trailing-icon"));
    }
    button.addEventListener("click", handler);
    return button;
  }
  function createIcon(markup, className) {
    const icon = createElement("span", className);
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = markup.trim();
    return icon;
  }
  var TOOLBAR_CSS = `
  :host {
    display: block;
    width: 100%;
    padding: 10px 12px 14px;
    color: #f4f4f6;
    font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  .content {
    position: relative;
    overflow: visible;
    padding: clamp(16px, 2.7cqw, 24px);
    border: 1px solid rgba(255, 255, 255, 0.11);
    border-radius: 22px;
    background: rgba(17, 18, 22, 0.97);
    box-shadow:
      0 18px 48px rgba(0, 0, 0, 0.34),
      inset 0 1px 0 rgba(255, 255, 255, 0.025);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: clamp(6px, 1.15cqw, 10px);
    min-width: 0;
  }
  .content.pulse { animation: dcs-pulse 700ms ease-out; }
  .button-icon svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  button {
    display: inline-flex;
    min-width: 0;
    min-height: clamp(40px, 5.7cqw, 50px);
    align-items: center;
    justify-content: center;
    gap: clamp(6px, 1cqw, 10px);
    padding: 0 clamp(11px, 2.2cqw, 20px);
    border: 1px solid transparent;
    border-radius: 16px;
    color: #dedee4;
    background: rgba(255, 255, 255, 0.065);
    font: inherit;
    font-size: clamp(12px, 1.8cqw, 16px);
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    transition:
      color 160ms ease,
      background-color 160ms ease,
      border-color 160ms ease,
      box-shadow 160ms ease,
      transform 160ms ease;
  }
  button:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.11);
  }
  button:active { transform: translateY(1px); }
  button:focus-visible {
    outline: 2px solid rgba(255, 81, 120, 0.9);
    outline-offset: 2px;
  }
  button:disabled {
    opacity: 0.48;
    cursor: not-allowed;
    transform: none;
  }
  button.active {
    border-color: rgba(255, 91, 126, 0.82);
    color: #fff;
    background: #f22558;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.22),
      0 8px 22px rgba(242, 37, 88, 0.23);
  }
  .sort-button {
    min-width: 112px;
    flex: 1 1 132px;
    max-width: 160px;
  }
  .button-icon {
    display: inline-flex;
    flex: 0 0 auto;
    width: clamp(18px, 2.7cqw, 24px);
    height: clamp(18px, 2.7cqw, 24px);
  }
  .trailing-icon {
    width: clamp(14px, 2cqw, 19px);
    height: clamp(14px, 2cqw, 19px);
    margin-left: 2px;
    transition: transform 160ms ease;
  }
  .button-label {
    flex: 0 0 auto;
    overflow: visible;
    text-overflow: clip;
  }
  .spacer {
    min-width: clamp(8px, 3.5cqw, 34px);
    flex: 1 1 34px;
  }
  .refresh {
    flex: 0 1 138px;
    border-color: rgba(255, 91, 126, 0.82);
    color: #fff;
    background: #f22558;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.22),
      0 8px 22px rgba(242, 37, 88, 0.23);
  }
  .refresh:hover {
    background: #ff3567;
  }
  .stop {
    flex: 0 1 138px;
    border-color: rgba(255, 91, 126, 0.55);
    color: #fff;
    background: #b72b4a;
  }
  .export-wrap {
    position: relative;
    flex: 0 1 154px;
  }
  .export-toggle {
    width: 100%;
    border-color: rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.055);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.035);
  }
  .export-toggle[aria-expanded="true"] .trailing-icon {
    transform: rotate(180deg);
  }
  .export-menu {
    position: absolute;
    top: calc(100% + 12px);
    right: 0;
    z-index: 60;
    display: grid;
    width: 262px;
    gap: 6px;
    padding: 8px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 16px;
    background: #1c1d22;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.46);
  }
  .export-menu button {
    width: 100%;
    min-height: 44px;
    justify-content: flex-start;
    gap: 10px;
    padding: 0 14px;
    border: 0;
    border-radius: 11px;
    color: #ededf1;
    text-align: left;
    background: transparent;
  }
  .export-menu button:hover {
    background: rgba(255, 255, 255, 0.09);
  }
  .status-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    margin-top: clamp(16px, 2.7cqw, 24px);
  }
  .status {
    overflow: hidden;
    flex: 1;
    color: #8f9099;
    font-size: clamp(12px, 1.75cqw, 16px);
    font-weight: 400;
    line-height: 1.45;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status.error { color: #ff7895; }
  .diagnostics {
    min-height: 34px;
    padding: 0 12px;
    border-color: rgba(255, 103, 137, 0.3);
    color: #ff9eb2;
    font-size: 12px;
    background: rgba(255, 66, 108, 0.08);
  }
  @keyframes dcs-pulse {
    0% {
      box-shadow:
        0 18px 48px rgba(0, 0, 0, 0.34),
        0 0 0 0 rgba(255, 64, 106, 0.55);
    }
    100% {
      box-shadow:
        0 18px 48px rgba(0, 0, 0, 0.34),
        0 0 0 12px rgba(255, 64, 106, 0);
    }
  }
  .content.compact {
    padding: 14px;
    border-radius: 18px;
  }
  .content.compact .bar { gap: 7px; }
  .content.compact .bar > .sort-button,
  .content.compact .bar > .refresh,
  .content.compact .bar > .stop,
  .content.compact .bar > .export-wrap > .export-toggle {
    min-width: 44px;
    width: 44px;
    min-height: 44px;
    gap: 0;
    padding: 0;
    border-radius: 12px;
    font-size: 0;
  }
  .content.compact .bar > .sort-button,
  .content.compact .bar > .refresh,
  .content.compact .bar > .stop {
    flex: 0 0 44px;
    max-width: 44px;
  }
  .content.compact .bar > .sort-button .button-label,
  .content.compact .bar > .refresh .button-label,
  .content.compact .bar > .stop .button-label,
  .content.compact .bar > .export-wrap > .export-toggle .button-label {
    display: none !important;
  }
  .content.compact .bar > .sort-button .button-icon,
  .content.compact .bar > .refresh .button-icon,
  .content.compact .bar > .stop .button-icon {
    width: 21px;
    height: 21px;
  }
  .content.compact .spacer {
    min-width: 0;
    flex: 1 1 auto;
  }
  .content.compact .export-wrap {
    width: 54px;
    flex: 0 0 54px;
  }
  .content.compact .bar > .export-wrap > .export-toggle {
    width: 54px;
    gap: 4px;
  }
  .content.compact .bar > .export-wrap > .export-toggle .button-icon:not(.trailing-icon) {
    width: 20px;
    height: 20px;
  }
  .content.compact .bar > .export-wrap > .export-toggle .trailing-icon {
    width: 12px;
    height: 12px;
    margin-left: 0;
  }
  .content.compact .export-menu button {
    min-height: 44px;
    gap: 10px;
    padding: 0 14px;
    font-size: 13px;
  }
  .content.compact .export-menu .button-icon {
    width: 18px;
    height: 18px;
  }
  .content.compact .export-menu .button-label { display: inline !important; }
  .content.compact .status-row { margin-top: 14px; }
  .content.compact .status { font-size: 11px; }
`;
  var StickyCommentToolbar = class {
    constructor(callbacks) {
      this.callbacks = callbacks;
    }
    host = null;
    shadow = null;
    commentContainer = null;
    currentSort = "original";
    currentCount = 0;
    statusMessage = "\u7B49\u5F85\u8BFB\u53D6\u5F53\u524D\u8BC4\u8BBA\u3002";
    statusIsError = false;
    exportMenuOpen = false;
    isCollecting = false;
    pulseTimer = null;
    resizeObserver = null;
    compactMode = false;
    mount(container, anchor) {
      if (this.host?.isConnected && this.commentContainer === container) return;
      this.unmount();
      this.removeLegacyHosts();
      this.commentContainer = container;
      const host = createElement("div");
      host.id = TOOLBAR_HOST_ID;
      host.setAttribute("data-dcs-ui", "toolbar");
      host.setAttribute("data-dcs-active-toolbar", "true");
      host.style.position = "sticky";
      host.style.top = "0";
      host.style.zIndex = "2147483000";
      host.style.alignSelf = "stretch";
      const insertionRow = anchor?.parentElement ?? anchor;
      if (insertionRow?.parentElement && container.contains(insertionRow)) {
        insertionRow.insertAdjacentElement("afterend", host);
      } else {
        container.prepend(host);
      }
      const shadow = host.attachShadow({ mode: "open" });
      const style = createElement("style");
      style.textContent = TOOLBAR_CSS;
      shadow.append(style);
      this.host = host;
      this.shadow = shadow;
      this.updateCompactMode(host.getBoundingClientRect().width, false);
      this.render();
      this.resizeObserver = new ResizeObserver((entries) => {
        if (this.host !== host) return;
        const width = entries[0]?.contentRect.width ?? host.getBoundingClientRect().width;
        this.updateCompactMode(width);
      });
      this.resizeObserver.observe(host);
    }
    update(mode, count, message, isError = false) {
      this.currentSort = mode;
      this.currentCount = count;
      this.statusMessage = message;
      this.statusIsError = isError;
      this.exportMenuOpen = false;
      this.render();
    }
    updateCount(count) {
      this.currentCount = count;
      this.render();
    }
    setCollectionState(isCollecting, count, message) {
      this.isCollecting = isCollecting;
      this.currentCount = count;
      this.statusMessage = message;
      this.statusIsError = false;
      this.exportMenuOpen = false;
      this.render();
    }
    showError(status, diagnostics) {
      const detail = diagnostics?.candidateNodeCount ? `${status.message} \u53D1\u73B0${diagnostics.candidateNodeCount}\u4E2A\u5019\u9009\u8282\u70B9\u3002` : status.message;
      this.update(this.currentSort, 0, detail, true);
    }
    reveal() {
      if (!this.host?.isConnected) return;
      this.host.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const content = this.shadow?.querySelector(".content");
      content?.classList.add("pulse");
      if (this.pulseTimer !== null) window.clearTimeout(this.pulseTimer);
      this.pulseTimer = window.setTimeout(() => {
        content?.classList.remove("pulse");
        this.pulseTimer = null;
      }, 750);
    }
    unmount() {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.host?.remove();
      this.host = null;
      this.shadow = null;
      this.commentContainer = null;
      this.compactMode = false;
    }
    destroy() {
      this.unmount();
      if (this.pulseTimer !== null) {
        window.clearTimeout(this.pulseTimer);
        this.pulseTimer = null;
      }
    }
    render() {
      if (!this.shadow) return;
      this.shadow.querySelector(".content")?.remove();
      const content = createElement(
        "div",
        `content${this.compactMode ? " compact" : ""}`
      );
      const bar = createElement("div", "bar");
      for (const [mode, label, icon] of this.sortModes()) {
        const button = createButton(
          label,
          `sort-button${this.currentSort === mode ? " active" : ""}`,
          () => this.callbacks.onSort(mode),
          { leading: icon }
        );
        button.disabled = this.isCollecting;
        bar.append(button);
      }
      bar.append(createElement("span", "spacer"));
      bar.append(this.createExportMenu());
      bar.append(
        this.isCollecting ? createButton(
          "\u505C\u6B62\u91C7\u96C6",
          "stop",
          this.callbacks.onCancelCollection,
          { leading: stop_circle_default }
        ) : createButton(
          "\u5237\u65B0\u5E76\u91CD\u6392",
          "refresh",
          this.callbacks.onRefresh,
          { leading: arrows_clockwise_default }
        )
      );
      const statusRow = createElement("div", "status-row");
      statusRow.append(
        createElement(
          "span",
          `status${this.statusIsError ? " error" : ""}`,
          `${this.currentCount ? `${this.currentCount}\u6761\u4E3B\u8BC4\u8BBA \xB7 ` : ""}${this.statusMessage}`
        )
      );
      if (this.statusIsError) {
        statusRow.append(
          createButton(
            "\u590D\u5236\u8BCA\u65AD",
            "diagnostics",
            this.callbacks.onCopyDiagnostics,
            { leading: copy_default }
          )
        );
      }
      content.append(bar, statusRow);
      this.shadow.append(content);
    }
    updateCompactMode(width, shouldRender = true) {
      if (!Number.isFinite(width) || width <= 0) return;
      const compactMode = width <= COMPACT_WIDTH_PX;
      this.host?.setAttribute(
        "data-dcs-layout",
        compactMode ? "compact" : "regular"
      );
      if (compactMode === this.compactMode) return;
      this.compactMode = compactMode;
      if (shouldRender) this.render();
    }
    removeLegacyHosts() {
      const legacyHosts = document.querySelectorAll(
        `#${TOOLBAR_HOST_ID}, [data-dcs-ui="toolbar"]`
      );
      for (const legacyHost of legacyHosts) {
        if (legacyHost !== this.host) legacyHost.remove();
      }
    }
    createExportMenu() {
      const wrap = createElement("div", "export-wrap");
      const toggle = createButton(
        "\u5BFC\u51FA CSV",
        "export-toggle",
        () => {
          this.exportMenuOpen = !this.exportMenuOpen;
          this.render();
        },
        {
          leading: download_simple_default,
          trailing: caret_down_default
        }
      );
      toggle.disabled = this.isCollecting;
      toggle.setAttribute("aria-expanded", String(this.exportMenuOpen));
      wrap.append(toggle);
      if (this.exportMenuOpen && !this.isCollecting) {
        const menu = createElement("div", "export-menu");
        const choices = [
          ["\u5BFC\u51FA\u5F53\u524DCSV", file_csv_default, this.callbacks.onExportCurrent],
          [
            "\u81EA\u52A8\u91C7\u96C6\u5E76\u5BFC\u51FA\u524D200\u6761CSV",
            download_simple_default,
            this.callbacks.onExportTop200
          ]
        ];
        for (const [label, icon, handler] of choices) {
          menu.append(
            createButton(
              label,
              "",
              () => {
                this.exportMenuOpen = false;
                handler();
              },
              { leading: icon }
            )
          );
        }
        wrap.append(menu);
      }
      return wrap;
    }
    sortModes() {
      return [
        ["original", "\u9875\u9762\u987A\u5E8F", list_plus_default],
        ["likes", "\u70B9\u8D5E\u6700\u591A", thumbs_up_default],
        ["replies", "\u56DE\u590D\u6700\u591A", chat_circle_default]
      ];
    }
  };

  // src/content/index.ts
  var TOP_EXPORT_LIMIT = 200;
  var AUTO_SCROLL_INTERVAL_MS = 1200;
  var AUTO_SCROLL_MAX_ROUNDS = 30;
  var AUTO_SCROLL_STALL_LIMIT = 3;
  var CONTROLLER_CLAIM_EVENT = "dcs-comment-sorter-controller-claim";
  var CONTROLLER_OWNER_ATTRIBUTE = "data-dcs-comment-sorter-owner";
  var contentWindow = window;
  function formatFilePart(value) {
    return String(value).padStart(2, "0");
  }
  function createCsvFilename(prefix, now = /* @__PURE__ */ new Date()) {
    return [
      prefix,
      "-",
      now.getFullYear(),
      "-",
      formatFilePart(now.getMonth() + 1),
      "-",
      formatFilePart(now.getDate()),
      "-",
      formatFilePart(now.getHours()),
      formatFilePart(now.getMinutes()),
      ".csv"
    ].join("");
  }
  function downloadCsv(content, prefix) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = createCsvFilename(prefix);
    link.style.display = "none";
    document.documentElement.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
  function isVisible3(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }
  function hasBlockingPrompt() {
    const candidates = document.querySelectorAll(
      '[role="dialog"], [class*="captcha"], [id*="captcha"], [class*="verify"], [id*="verify"]'
    );
    return Array.from(candidates).slice(0, 200).some(
      (element) => isVisible3(element) && /验证码|安全验证|操作频繁|访问异常|请先登录|登录后/u.test(
        element.textContent ?? ""
      )
    );
  }
  var ContentController = class {
    controllerId = crypto.randomUUID();
    adapter = new DouyinAdapter();
    ui;
    observer;
    mountAfterMutation;
    currentSort = "original";
    lastScan = null;
    lastErrorMessage = "";
    lastUrl = location.href;
    urlTimer = null;
    collecting = false;
    cancelCollectionRequested = false;
    destroyed = false;
    constructor() {
      this.ui = new StickyCommentToolbar({
        onSort: (mode) => this.scanAndApply(mode),
        onRefresh: () => this.scanAndApply(this.currentSort),
        onExportCurrent: () => this.exportCurrentComments(),
        onExportTop200: () => {
          void this.exportTopComments();
        },
        onCancelCollection: () => this.cancelCollection(),
        onCopyDiagnostics: () => {
          void this.copyDiagnostics();
        }
      });
      this.mountAfterMutation = debounce(() => {
        this.checkUrl();
        this.ensureToolbar();
        this.scanAndUpdateCount();
      }, OBSERVER_DEBOUNCE_MS);
      this.observer = new MutationObserver((mutations) => {
        if (mutations.some(
          (mutation) => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0
        )) {
          this.mountAfterMutation();
        }
      });
    }
    start() {
      document.addEventListener(
        CONTROLLER_CLAIM_EVENT,
        this.handleControllerClaim
      );
      document.documentElement.setAttribute(
        CONTROLLER_OWNER_ATTRIBUTE,
        this.controllerId
      );
      document.dispatchEvent(new Event(CONTROLLER_CLAIM_EVENT));
      if (this.destroyed) return;
      this.ensureToolbar();
      this.observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      chrome.runtime.onMessage.addListener(this.handleMessage);
      window.addEventListener("pagehide", this.handlePageHide, { once: true });
      this.urlTimer = window.setInterval(() => this.checkUrl(), 1e3);
      this.scanAndUpdateCount();
    }
    activate() {
      this.activateToolbar();
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.observer.disconnect();
      this.mountAfterMutation.cancel();
      if (this.urlTimer !== null) {
        window.clearInterval(this.urlTimer);
        this.urlTimer = null;
      }
      try {
        chrome.runtime.onMessage.removeListener(this.handleMessage);
      } catch {
      }
      document.removeEventListener(
        CONTROLLER_CLAIM_EVENT,
        this.handleControllerClaim
      );
      if (document.documentElement.getAttribute(CONTROLLER_OWNER_ATTRIBUTE) === this.controllerId) {
        document.documentElement.removeAttribute(CONTROLLER_OWNER_ATTRIBUTE);
      }
      this.ui.destroy();
      this.adapter.clear();
      delete contentWindow.__DCS_COMMENT_SORTER__;
    }
    handleMessage = (message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || !isActivateToolbarRequest(message)) {
        return false;
      }
      this.activate();
      sendResponse({ ok: true });
      return false;
    };
    handlePageHide = () => {
      this.destroy();
    };
    handleControllerClaim = () => {
      const activeControllerId = document.documentElement.getAttribute(
        CONTROLLER_OWNER_ATTRIBUTE
      );
      if (activeControllerId && activeControllerId !== this.controllerId) {
        this.destroy();
      }
    };
    ensureToolbar() {
      const containerMatch = findCommentContainer();
      if (!containerMatch.element) return;
      this.ui.mount(
        containerMatch.element,
        findToolbarAnchor(containerMatch.element)
      );
    }
    checkUrl() {
      if (location.href === this.lastUrl) return;
      if (this.collecting) this.cancelCollectionRequested = true;
      this.lastUrl = location.href;
      this.lastScan = null;
      this.currentSort = "original";
      this.adapter.clear();
      this.ui.unmount();
      this.ui.update("original", 0, "\u7B49\u5F85\u8BFB\u53D6\u5F53\u524D\u8BC4\u8BBA\u3002");
      this.ensureToolbar();
    }
    activateToolbar() {
      this.ensureToolbar();
      try {
        const result = this.adapter.scan();
        this.lastScan = result;
        this.lastErrorMessage = "";
        const count = result.comments.length;
        if (result.comments.length === 0) {
          this.ui.showError(result.pageStatus, result.diagnostics);
          this.ui.reveal();
          return;
        }
        this.ui.update(
          this.currentSort,
          count,
          "\u5DF2\u8BFB\u53D6\u5F53\u524D\u4E3B\u8BC4\u8BBA\uFF0C\u9009\u62E9\u6392\u5E8F\u65B9\u5F0F\u5373\u53EF\u8C03\u6574\u539F\u751F\u8BC4\u8BBA\u533A\u3002"
        );
        this.ui.reveal();
      } catch (error) {
        this.showUnexpectedError(error);
        this.ui.reveal();
      }
    }
    scanAndApply(mode) {
      if (this.collecting) return;
      this.currentSort = mode;
      this.ensureToolbar();
      try {
        const result = this.adapter.scan();
        this.lastScan = result;
        this.lastErrorMessage = "";
        const count = result.comments.length;
        if (result.comments.length === 0) {
          this.ui.showError(result.pageStatus, result.diagnostics);
          return;
        }
        const reorder = this.adapter.reorder(
          stableSortComments(result.comments, mode),
          this.sortLabel(mode)
        );
        this.ui.update(
          mode,
          count,
          `${reorder.message} \u7EE7\u7EED\u6EDA\u52A8\u540E\u53EF\u518D\u6B21\u5237\u65B0\u3002`
        );
      } catch (error) {
        this.showUnexpectedError(error);
      }
    }
    exportCurrentComments() {
      if (this.collecting) return;
      this.ensureToolbar();
      try {
        const result = this.adapter.scan();
        this.lastScan = result;
        this.lastErrorMessage = "";
        if (result.comments.length === 0) {
          this.ui.showError(result.pageStatus, result.diagnostics);
          return;
        }
        const comments = stableSortComments(result.comments, this.currentSort);
        downloadCsv(exportCommentsCsv(comments), "douyin-comments");
        this.ui.update(
          this.currentSort,
          result.comments.length,
          `\u5DF2\u6309\u5F53\u524D\u987A\u5E8F\u5BFC\u51FA${comments.length}\u6761\u4E3B\u8BC4\u8BBA\u3002`
        );
      } catch (error) {
        this.showUnexpectedError(error);
      }
    }
    async exportTopComments() {
      if (this.collecting) return;
      this.collecting = true;
      this.cancelCollectionRequested = false;
      let result = null;
      let stopReason = "";
      try {
        this.ensureToolbar();
        result = this.adapter.scan();
        this.lastScan = result;
        if (result.comments.length === 0) {
          this.ui.showError(result.pageStatus, result.diagnostics);
          return;
        }
        this.ui.setCollectionState(
          true,
          result.comments.length,
          `\u6B63\u5728\u91C7\u96C6\u524D${TOP_EXPORT_LIMIT}\u6761\u4E3B\u8BC4\u8BBA\u3002`
        );
        let scroller = findCommentScroller();
        let stalledRounds = 0;
        let rounds = 0;
        let previousCount = result.comments.length;
        while (result.comments.length < TOP_EXPORT_LIMIT && rounds < AUTO_SCROLL_MAX_ROUNDS && stalledRounds < AUTO_SCROLL_STALL_LIMIT && !this.cancelCollectionRequested) {
          if (hasBlockingPrompt()) {
            stopReason = "\u68C0\u6D4B\u5230\u767B\u5F55\u6216\u9A8C\u8BC1\u63D0\u793A\uFF0C\u5DF2\u505C\u6B62\u7EE7\u7EED\u4E0B\u6ED1\u3002";
            break;
          }
          if (!scroller?.isConnected) scroller = findCommentScroller();
          if (!scroller) {
            stopReason = "\u6CA1\u6709\u627E\u5230\u53EF\u7EE7\u7EED\u4E0B\u6ED1\u7684\u8BC4\u8BBA\u533A\u57DF\u3002";
            break;
          }
          const distance = Math.max(
            480,
            Math.round(scroller.clientHeight * 0.82)
          );
          scroller.scrollTo({
            top: Math.min(
              scroller.scrollHeight,
              scroller.scrollTop + distance
            ),
            behavior: "smooth"
          });
          rounds += 1;
          await wait(AUTO_SCROLL_INTERVAL_MS);
          if (this.cancelCollectionRequested) break;
          result = this.adapter.scan();
          this.lastScan = result;
          const count = result.comments.length;
          stalledRounds = count > previousCount ? 0 : stalledRounds + 1;
          previousCount = count;
          this.ui.setCollectionState(
            true,
            count,
            `\u6B63\u5728\u91C7\u96C6\u4E3B\u8BC4\u8BBA ${Math.min(count, TOP_EXPORT_LIMIT)}/${TOP_EXPORT_LIMIT}`
          );
        }
        if (this.cancelCollectionRequested) {
          this.ui.setCollectionState(
            false,
            result.comments.length,
            `\u5DF2\u505C\u6B62\u91C7\u96C6\uFF0C\u5F53\u524D\u8BFB\u53D6${result.comments.length}\u6761\u4E3B\u8BC4\u8BBA\u3002`
          );
          return;
        }
        if (!stopReason && result.comments.length < TOP_EXPORT_LIMIT && stalledRounds >= AUTO_SCROLL_STALL_LIMIT) {
          stopReason = "\u8FDE\u7EED\u591A\u6B21\u6CA1\u6709\u52A0\u8F7D\u65B0\u8BC4\u8BBA\uFF0C\u5DF2\u505C\u6B62\u4E0B\u6ED1\u3002";
        }
        if (!stopReason && result.comments.length < TOP_EXPORT_LIMIT && rounds >= AUTO_SCROLL_MAX_ROUNDS) {
          stopReason = "\u5DF2\u8FBE\u5230\u672C\u6B21\u81EA\u52A8\u4E0B\u6ED1\u4E0A\u9650\u3002";
        }
        const sorted = stableSortComments(
          result.comments,
          this.currentSort
        );
        this.adapter.reorder(sorted, this.sortLabel(this.currentSort));
        const exported = sorted.slice(0, TOP_EXPORT_LIMIT);
        downloadCsv(
          exportCommentsCsv(exported),
          "douyin-top-200-comments"
        );
        this.ui.setCollectionState(
          false,
          result.comments.length,
          exported.length >= TOP_EXPORT_LIMIT ? `\u5DF2\u6309\u5F53\u524D\u6392\u5E8F\u5BFC\u51FA\u524D${TOP_EXPORT_LIMIT}\u6761\u4E3B\u8BC4\u8BBA\u3002` : `${stopReason} \u5DF2\u5BFC\u51FA\u5F53\u524D${exported.length}\u6761\u4E3B\u8BC4\u8BBA\u3002`.trim()
        );
      } catch (error) {
        this.ui.setCollectionState(
          false,
          result?.comments.length ?? 0,
          "\u81EA\u52A8\u91C7\u96C6\u5931\u8D25\u3002"
        );
        this.showUnexpectedError(error);
      } finally {
        this.collecting = false;
        this.cancelCollectionRequested = false;
      }
    }
    cancelCollection() {
      if (!this.collecting) return;
      this.cancelCollectionRequested = true;
      this.ui.setCollectionState(
        true,
        this.lastScan?.comments.length ?? 0,
        "\u6B63\u5728\u505C\u6B62\u91C7\u96C6\u2026\u2026"
      );
    }
    scanAndUpdateCount() {
      if (this.destroyed) return;
      try {
        const result = this.adapter.scan();
        this.lastScan = result;
        this.ui.updateCount(result.comments.length);
      } catch {
      }
    }
    async copyDiagnostics() {
      const diagnostics = this.lastScan?.diagnostics ?? null;
      const status = this.adapter.getPageStatus();
      const text = JSON.stringify(
        {
          pageUrl: location.href,
          pageState: status.state,
          message: status.message,
          error: this.lastErrorMessage || null,
          diagnostics: this.safeDiagnostics(diagnostics),
          copiedAt: (/* @__PURE__ */ new Date()).toISOString()
        },
        null,
        2
      );
      try {
        await navigator.clipboard.writeText(text);
        this.ui.update(
          this.currentSort,
          this.lastScan?.comments.length ?? 0,
          "\u8BCA\u65AD\u4FE1\u606F\u5DF2\u590D\u5236\uFF0C\u4E0D\u5305\u542B\u8BC4\u8BBA\u6B63\u6587\u3002"
        );
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.documentElement.append(textarea);
        textarea.select();
        const copied = typeof document.execCommand === "function" && document.execCommand("copy");
        textarea.remove();
        this.ui.update(
          this.currentSort,
          this.lastScan?.comments.length ?? 0,
          copied ? "\u8BCA\u65AD\u4FE1\u606F\u5DF2\u590D\u5236\u3002" : "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002",
          !copied
        );
      }
    }
    showUnexpectedError(error) {
      this.lastErrorMessage = error instanceof Error ? error.message : "\u672A\u77E5\u8BFB\u53D6\u9519\u8BEF";
      this.ui.showError(
        {
          ...this.adapter.getPageStatus(),
          state: "structure-changed",
          message: "\u8BFB\u53D6\u8BC4\u8BBA\u65F6\u51FA\u73B0\u5F02\u5E38\uFF0C\u8BF7\u91CD\u65B0\u626B\u63CF\u6216\u590D\u5236\u8BCA\u65AD\u4FE1\u606F\u3002"
        },
        this.lastScan?.diagnostics ?? null
      );
    }
    sortLabel(mode) {
      if (mode === "likes") return "\u70B9\u8D5E\u6570\u4ECE\u9AD8\u5230\u4F4E";
      if (mode === "replies") return "\u56DE\u590D\u6570\u4ECE\u9AD8\u5230\u4F4E";
      return "\u9996\u6B21\u8BFB\u53D6\u7684\u9875\u9762\u987A\u5E8F";
    }
    safeDiagnostics(diagnostics) {
      if (!diagnostics) return null;
      return {
        ...diagnostics,
        warnings: [...diagnostics.warnings]
      };
    }
  };
  try {
    contentWindow.__DCS_FLOATING_SORTER__?.destroy();
  } catch {
    delete contentWindow.__DCS_FLOATING_SORTER__;
  }
  try {
    contentWindow.__DCS_COMMENT_SORTER__?.destroy();
  } catch {
    delete contentWindow.__DCS_COMMENT_SORTER__;
  }
  var controller = new ContentController();
  contentWindow.__DCS_COMMENT_SORTER__ = controller;
  controller.start();
})();
