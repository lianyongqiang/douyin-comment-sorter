import type { PageStatus } from "../../shared/types";
import { DOUYIN_SELECTORS } from "./selectors";

export interface VideoContext {
  videoId: string;
  videoUrl: string;
  videoTitle: string;
}

export interface ElementMatch {
  element: Element | null;
  selector: string | null;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replaceAll(/\s+/g, " ").trim();
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  const style = getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.getClientRects().length > 0
  );
}

function ownText(element: Element): string {
  return cleanText(
    Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join(" ")
  );
}

export function findFirst(
  root: ParentNode,
  selectors: readonly string[]
): ElementMatch {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element && isVisible(element)) return { element, selector };
  }
  return { element: null, selector: null };
}

export function isDouyinPage(url = location.href): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "www.douyin.com";
  } catch {
    return false;
  }
}

export function getVideoContext(): VideoContext {
  const videoUrl = location.href;
  const parsed = new URL(videoUrl);
  const pathMatch = parsed.pathname.match(/\/video\/(\d+)/);
  const queryId =
    parsed.searchParams.get("modal_id") ??
    parsed.searchParams.get("video_id") ??
    "";
  const activeVideoLink = document.querySelector<HTMLAnchorElement>(
    'a[href*="/video/"][aria-current="true"], a[href*="/video/"][data-e2e*="active"]'
  );
  const activeMatch = activeVideoLink?.href.match(/\/video\/(\d+)/);
  const videoId = pathMatch?.[1] || queryId || activeMatch?.[1] || "";

  const metaTitle =
    document
      .querySelector<HTMLMetaElement>('meta[property="og:title"]')
      ?.content.trim() ?? "";
  const headingTitle =
    document
      .querySelector<HTMLElement>(
        '[data-e2e="video-desc"], [data-testid="video-title"], h1'
      )
      ?.textContent?.trim() ?? "";
  const documentTitle = document.title
    .replace(/\s*[-_｜|]\s*抖音.*$/u, "")
    .trim();

  return {
    videoId,
    videoUrl,
    videoTitle: metaTitle || headingTitle || documentTitle || "未读取到视频标题"
  };
}

function findCommentHeader(): Element | null {
  const elements = Array.from(
    document.querySelectorAll("h1, h2, h3, div, span, p")
  ).slice(0, 12_000);
  return (
    elements.find((element) => {
      if (!isVisible(element)) return false;
      const text = ownText(element) || cleanText(element.textContent);
      return /^全部评论\s*[（(]?\s*[\d,.万亿wW+]+/u.test(text);
    }) ?? null
  );
}

function findCommentInput(): Element | null {
  return document.querySelector(
    'textarea[placeholder*="评论"], input[placeholder*="评论"], [contenteditable="true"][data-placeholder*="评论"], [contenteditable="true"][aria-label*="评论"]'
  );
}

function smallestSharedAncestor(
  first: Element,
  second: Element | null
): Element | null {
  let current: Element | null = first;
  for (let level = 0; current && level < 12; level += 1) {
    const text = cleanText(current.textContent);
    const userCount = current.querySelectorAll('a[href*="/user/"]').length;
    const containsSecond = !second || current.contains(second);
    if (
      containsSecond &&
      userCount > 0 &&
      text.length >= 10 &&
      text.length <= 200_000
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function findSemanticCommentContainer(): ElementMatch {
  const header = findCommentHeader();
  const input = findCommentInput();
  if (header) {
    const shared = smallestSharedAncestor(header, input);
    if (shared) {
      return { element: shared, selector: "语义：全部评论标题与评论输入框" };
    }
  }
  if (input) {
    let current: Element | null = input;
    for (let level = 0; current && level < 12; level += 1) {
      const userCount = current.querySelectorAll('a[href*="/user/"]').length;
      if (userCount >= 2) {
        return { element: current, selector: "语义：评论输入框与作者链接" };
      }
      current = current.parentElement;
    }
  }
  return { element: null, selector: null };
}

export function findCommentContainer(): ElementMatch {
  const explicit = findFirst(document, DOUYIN_SELECTORS.commentContainers);
  return explicit.element ? explicit : findSemanticCommentContainer();
}

export function findToolbarAnchor(container: Element): Element | null {
  const localElements = Array.from(
    container.querySelectorAll("h1, h2, h3, div, span, p")
  ).slice(0, 3000);
  return (
    localElements.find((element) => {
      const text = ownText(element) || cleanText(element.textContent);
      return /^全部评论\s*[（(]?\s*[\d,.万亿wW+]+/u.test(text);
    }) ?? null
  );
}

function isScrollable(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return (
    /(?:auto|scroll|overlay)/u.test(style.overflowY) &&
    element.scrollHeight > element.clientHeight + 24
  );
}

export function findCommentScroller(): HTMLElement | null {
  const container = findCommentContainer().element as HTMLElement | null;
  if (!container) return null;

  const descendant = Array.from(
    container.querySelectorAll<HTMLElement>("div, section")
  )
    .filter(
      (element) =>
        isVisible(element) &&
        isScrollable(element) &&
        element.querySelector('a[href*="/user/"]')
    )
    .sort(
      (left, right) =>
        right.scrollHeight -
        right.clientHeight -
        (left.scrollHeight - left.clientHeight)
    )[0];
  if (descendant) return descendant;

  let current: HTMLElement | null = container;
  for (let level = 0; current && level < 10; level += 1) {
    if (isScrollable(current)) return current;
    current = current.parentElement;
  }
  return null;
}

export function getPageStatus(): PageStatus {
  const video = getVideoContext();
  if (!isDouyinPage()) {
    return {
      state: "not-douyin",
      message: "请先打开抖音网页版视频页面。",
      isDouyin: false,
      hasCommentArea: false,
      ...video
    };
  }

  const container = findCommentContainer();
  if (!container.element) {
    return {
      state: "comment-area-missing",
      message: "暂未检测到评论区，请先打开视频评论区。",
      isDouyin: true,
      hasCommentArea: false,
      ...video
    };
  }

  return {
    state: "ready",
    message: "已检测到抖音评论区。",
    isDouyin: true,
    hasCommentArea: true,
    ...video
  };
}
