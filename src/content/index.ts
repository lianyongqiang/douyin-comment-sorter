import { DouyinAdapter } from "../adapters/douyin/DouyinAdapter";
import {
  findCommentContainer,
  findCommentScroller,
  findToolbarAnchor
} from "../adapters/douyin/detector";
import { OBSERVER_DEBOUNCE_MS } from "../shared/constants";
import { isActivateToolbarRequest } from "../shared/messages";
import type {
  ScanResult,
  SelectorDiagnostics,
  SortMode
} from "../shared/types";
import { debounce } from "../utils/debounce";
import { exportCommentsCsv } from "../utils/export-csv";
import { stableSortComments } from "../utils/stable-sort";
import { StickyCommentToolbar } from "./sticky-toolbar";

const TOP_EXPORT_LIMIT = 200;
const AUTO_SCROLL_INTERVAL_MS = 1200;
const AUTO_SCROLL_MAX_ROUNDS = 30;
const AUTO_SCROLL_STALL_LIMIT = 3;
const CONTROLLER_CLAIM_EVENT = "dcs-comment-sorter-controller-claim";
const CONTROLLER_OWNER_ATTRIBUTE = "data-dcs-comment-sorter-owner";

interface ContentControllerHandle {
  activate: () => void;
  destroy: () => void;
}

const contentWindow = window as Window & {
  __DCS_COMMENT_SORTER__?: ContentControllerHandle;
  __DCS_FLOATING_SORTER__?: {
    destroy: () => void;
  };
};

function formatFilePart(value: number): string {
  return String(value).padStart(2, "0");
}

function createCsvFilename(prefix: string, now = new Date()): string {
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

function downloadCsv(content: string, prefix: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = createCsvFilename(prefix);
  link.style.display = "none";
  document.documentElement.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.getClientRects().length > 0
  );
}

function hasBlockingPrompt(): boolean {
  const candidates = document.querySelectorAll(
    '[role="dialog"], [class*="captcha"], [id*="captcha"], [class*="verify"], [id*="verify"]'
  );
  return Array.from(candidates)
    .slice(0, 200)
    .some(
      (element) =>
        isVisible(element) &&
        /验证码|安全验证|操作频繁|访问异常|请先登录|登录后/u.test(
          element.textContent ?? ""
        )
    );
}

class ContentController implements ContentControllerHandle {
  private readonly controllerId = crypto.randomUUID();
  private readonly adapter = new DouyinAdapter();
  private readonly ui: StickyCommentToolbar;
  private readonly observer: MutationObserver;
  private readonly mountAfterMutation: ReturnType<typeof debounce>;
  private currentSort: SortMode = "original";
  private lastScan: ScanResult | null = null;
  private lastErrorMessage = "";
  private lastUrl = location.href;
  private urlTimer: number | null = null;
  private collecting = false;
  private cancelCollectionRequested = false;
  private destroyed = false;

  public constructor() {
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
      if (
        mutations.some(
          (mutation) =>
            mutation.addedNodes.length > 0 ||
            mutation.removedNodes.length > 0
        )
      ) {
        this.mountAfterMutation();
      }
    });
  }

  public start(): void {
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
    this.urlTimer = window.setInterval(() => this.checkUrl(), 1000);
    this.scanAndUpdateCount();
  }

  public activate(): void {
    this.activateToolbar();
  }

  public destroy(): void {
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
      // 扩展刚被重新加载时，旧脚本上下文可能已经失效。
    }
    document.removeEventListener(
      CONTROLLER_CLAIM_EVENT,
      this.handleControllerClaim
    );
    if (
      document.documentElement.getAttribute(CONTROLLER_OWNER_ATTRIBUTE) ===
      this.controllerId
    ) {
      document.documentElement.removeAttribute(CONTROLLER_OWNER_ATTRIBUTE);
    }
    this.ui.destroy();
    this.adapter.clear();
    delete contentWindow.__DCS_COMMENT_SORTER__;
  }

  private readonly handleMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean => {
    if (
      sender.id !== chrome.runtime.id ||
      !isActivateToolbarRequest(message)
    ) {
      return false;
    }
    this.activate();
    sendResponse({ ok: true });
    return false;
  };

  private readonly handlePageHide = (): void => {
    this.destroy();
  };

  private readonly handleControllerClaim = (): void => {
    const activeControllerId = document.documentElement.getAttribute(
      CONTROLLER_OWNER_ATTRIBUTE
    );
    if (
      activeControllerId &&
      activeControllerId !== this.controllerId
    ) {
      this.destroy();
    }
  };

  private ensureToolbar(): void {
    const containerMatch = findCommentContainer();
    if (!containerMatch.element) return;
    this.ui.mount(
      containerMatch.element,
      findToolbarAnchor(containerMatch.element)
    );
  }

  private checkUrl(): void {
    if (location.href === this.lastUrl) return;
    if (this.collecting) this.cancelCollectionRequested = true;
    this.lastUrl = location.href;
    this.lastScan = null;
    this.currentSort = "original";
    this.adapter.clear();
    this.ui.unmount();
    this.ui.update("original", 0, "等待读取当前评论。");
    this.ensureToolbar();
  }

  private activateToolbar(): void {
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
        "已读取当前主评论，选择排序方式即可调整原生评论区。"
      );
      this.ui.reveal();
    } catch (error) {
      this.showUnexpectedError(error);
      this.ui.reveal();
    }
  }

  private scanAndApply(mode: SortMode): void {
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
        `${reorder.message} 继续滚动后可再次刷新。`
      );
    } catch (error) {
      this.showUnexpectedError(error);
    }
  }

  private exportCurrentComments(): void {
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
        `已按当前顺序导出${comments.length}条主评论。`
      );
    } catch (error) {
      this.showUnexpectedError(error);
    }
  }

  private async exportTopComments(): Promise<void> {
    if (this.collecting) return;
    this.collecting = true;
    this.cancelCollectionRequested = false;
    let result: ScanResult | null = null;
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
        `正在采集前${TOP_EXPORT_LIMIT}条主评论。`
      );
      let scroller = findCommentScroller();
      let stalledRounds = 0;
      let rounds = 0;
      let previousCount = result.comments.length;

      while (
        result.comments.length < TOP_EXPORT_LIMIT &&
        rounds < AUTO_SCROLL_MAX_ROUNDS &&
        stalledRounds < AUTO_SCROLL_STALL_LIMIT &&
        !this.cancelCollectionRequested
      ) {
        if (hasBlockingPrompt()) {
          stopReason = "检测到登录或验证提示，已停止继续下滑。";
          break;
        }
        if (!scroller?.isConnected) scroller = findCommentScroller();
        if (!scroller) {
          stopReason = "没有找到可继续下滑的评论区域。";
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
        stalledRounds =
          count > previousCount ? 0 : stalledRounds + 1;
        previousCount = count;
        this.ui.setCollectionState(
          true,
          count,
          `正在采集主评论 ${Math.min(count, TOP_EXPORT_LIMIT)}/${TOP_EXPORT_LIMIT}`
        );
      }

      if (this.cancelCollectionRequested) {
        this.ui.setCollectionState(
          false,
          result.comments.length,
          `已停止采集，当前读取${result.comments.length}条主评论。`
        );
        return;
      }
      if (
        !stopReason &&
        result.comments.length < TOP_EXPORT_LIMIT &&
        stalledRounds >= AUTO_SCROLL_STALL_LIMIT
      ) {
        stopReason = "连续多次没有加载新评论，已停止下滑。";
      }
      if (
        !stopReason &&
        result.comments.length < TOP_EXPORT_LIMIT &&
        rounds >= AUTO_SCROLL_MAX_ROUNDS
      ) {
        stopReason = "已达到本次自动下滑上限。";
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
        exported.length >= TOP_EXPORT_LIMIT
          ? `已按当前排序导出前${TOP_EXPORT_LIMIT}条主评论。`
          : `${stopReason} 已导出当前${exported.length}条主评论。`.trim()
      );
    } catch (error) {
      this.ui.setCollectionState(
        false,
        result?.comments.length ?? 0,
        "自动采集失败。"
      );
      this.showUnexpectedError(error);
    } finally {
      this.collecting = false;
      this.cancelCollectionRequested = false;
    }
  }

  private cancelCollection(): void {
    if (!this.collecting) return;
    this.cancelCollectionRequested = true;
    this.ui.setCollectionState(
      true,
      this.lastScan?.comments.length ?? 0,
      "正在停止采集……"
    );
  }

  private scanAndUpdateCount(): void {
    if (this.destroyed) return;
    try {
      const result = this.adapter.scan();
      this.lastScan = result;
      this.ui.updateCount(result.comments.length);
    } catch {
      // 页面可能正处于切换或重绘过程，下一次变化会再次扫描。
    }
  }

  private async copyDiagnostics(): Promise<void> {
    const diagnostics = this.lastScan?.diagnostics ?? null;
    const status = this.adapter.getPageStatus();
    const text = JSON.stringify(
      {
        pageUrl: location.href,
        pageState: status.state,
        message: status.message,
        error: this.lastErrorMessage || null,
        diagnostics: this.safeDiagnostics(diagnostics),
        copiedAt: new Date().toISOString()
      },
      null,
      2
    );
    try {
      await navigator.clipboard.writeText(text);
      this.ui.update(
        this.currentSort,
        this.lastScan?.comments.length ?? 0,
        "诊断信息已复制，不包含评论正文。"
      );
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.documentElement.append(textarea);
      textarea.select();
      const copied =
        typeof document.execCommand === "function" &&
        document.execCommand("copy");
      textarea.remove();
      this.ui.update(
        this.currentSort,
        this.lastScan?.comments.length ?? 0,
        copied ? "诊断信息已复制。" : "复制失败，请重试。",
        !copied
      );
    }
  }

  private showUnexpectedError(error: unknown): void {
    this.lastErrorMessage =
      error instanceof Error ? error.message : "未知读取错误";
    this.ui.showError(
      {
        ...this.adapter.getPageStatus(),
        state: "structure-changed",
        message: "读取评论时出现异常，请重新扫描或复制诊断信息。"
      },
      this.lastScan?.diagnostics ?? null
    );
  }

  private sortLabel(mode: SortMode): string {
    if (mode === "likes") return "点赞数从高到低";
    if (mode === "replies") return "回复数从高到低";
    return "首次读取的页面顺序";
  }

  private safeDiagnostics(
    diagnostics: SelectorDiagnostics | null
  ): SelectorDiagnostics | null {
    if (!diagnostics) return null;
    return {
      ...diagnostics,
      warnings: [...diagnostics.warnings]
    };
  }
}

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
const controller = new ContentController();
contentWindow.__DCS_COMMENT_SORTER__ = controller;
controller.start();
