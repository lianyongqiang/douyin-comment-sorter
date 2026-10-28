import type {
  PageStatus,
  SelectorDiagnostics,
  SortMode
} from "../shared/types";
import arrowsClockwiseIcon from "@phosphor-icons/core/regular/arrows-clockwise.svg";
import caretDownIcon from "@phosphor-icons/core/regular/caret-down.svg";
import chatCircleIcon from "@phosphor-icons/core/regular/chat-circle.svg";
import copyIcon from "@phosphor-icons/core/regular/copy.svg";
import downloadSimpleIcon from "@phosphor-icons/core/regular/download-simple.svg";
import fileCsvIcon from "@phosphor-icons/core/regular/file-csv.svg";
import listPlusIcon from "@phosphor-icons/core/regular/list-plus.svg";
import stopCircleIcon from "@phosphor-icons/core/regular/stop-circle.svg";
import thumbsUpIcon from "@phosphor-icons/core/regular/thumbs-up.svg";

const TOOLBAR_HOST_ID = "dcs-inline-toolbar-host";
const COMPACT_WIDTH_PX = 720;

interface StickyToolbarCallbacks {
  onSort: (mode: SortMode) => void;
  onRefresh: () => void;
  onExportCurrent: () => void;
  onExportTop200: () => void;
  onCancelCollection: () => void;
  onCopyDiagnostics: () => void;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createButton(
  label: string,
  className: string,
  handler: () => void,
  icons: {
    leading?: string;
    trailing?: string;
  } = {}
): HTMLButtonElement {
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

function createIcon(markup: string, className: string): HTMLSpanElement {
  const icon = createElement("span", className);
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = markup.trim();
  return icon;
}

const TOOLBAR_CSS = `
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

export class StickyCommentToolbar {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private commentContainer: Element | null = null;
  private currentSort: SortMode = "original";
  private currentCount = 0;
  private statusMessage = "等待读取当前评论。";
  private statusIsError = false;
  private exportMenuOpen = false;
  private isCollecting = false;
  private pulseTimer: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private compactMode = false;

  public constructor(private readonly callbacks: StickyToolbarCallbacks) {}

  public mount(container: Element, anchor: Element | null): void {
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

  public update(
    mode: SortMode,
    count: number,
    message: string,
    isError = false
  ): void {
    this.currentSort = mode;
    this.currentCount = count;
    this.statusMessage = message;
    this.statusIsError = isError;
    this.exportMenuOpen = false;
    this.render();
  }

  public updateCount(count: number): void {
    this.currentCount = count;
    this.render();
  }

  public setCollectionState(
    isCollecting: boolean,
    count: number,
    message: string
  ): void {
    this.isCollecting = isCollecting;
    this.currentCount = count;
    this.statusMessage = message;
    this.statusIsError = false;
    this.exportMenuOpen = false;
    this.render();
  }

  public showError(
    status: PageStatus,
    diagnostics: SelectorDiagnostics | null
  ): void {
    const detail = diagnostics?.candidateNodeCount
      ? `${status.message} 发现${diagnostics.candidateNodeCount}个候选节点。`
      : status.message;
    this.update(this.currentSort, 0, detail, true);
  }

  public reveal(): void {
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

  public unmount(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.commentContainer = null;
    this.compactMode = false;
  }

  public destroy(): void {
    this.unmount();
    if (this.pulseTimer !== null) {
      window.clearTimeout(this.pulseTimer);
      this.pulseTimer = null;
    }
  }

  private render(): void {
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
      this.isCollecting
        ? createButton(
            "停止采集",
            "stop",
            this.callbacks.onCancelCollection,
            { leading: stopCircleIcon }
          )
        : createButton(
            "刷新并重排",
            "refresh",
            this.callbacks.onRefresh,
            { leading: arrowsClockwiseIcon }
          )
    );

    const statusRow = createElement("div", "status-row");
    statusRow.append(
      createElement(
        "span",
        `status${this.statusIsError ? " error" : ""}`,
        `${this.currentCount ? `${this.currentCount}条主评论 · ` : ""}${this.statusMessage}`
      )
    );
    if (this.statusIsError) {
      statusRow.append(
        createButton(
          "复制诊断",
          "diagnostics",
          this.callbacks.onCopyDiagnostics,
          { leading: copyIcon }
        )
      );
    }
    content.append(bar, statusRow);
    this.shadow.append(content);
  }

  private updateCompactMode(width: number, shouldRender = true): void {
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

  private removeLegacyHosts(): void {
    const legacyHosts = document.querySelectorAll(
      `#${TOOLBAR_HOST_ID}, [data-dcs-ui="toolbar"]`
    );
    for (const legacyHost of legacyHosts) {
      if (legacyHost !== this.host) legacyHost.remove();
    }
  }

  private createExportMenu(): HTMLElement {
    const wrap = createElement("div", "export-wrap");
    const toggle = createButton(
      "导出 CSV",
      "export-toggle",
      () => {
        this.exportMenuOpen = !this.exportMenuOpen;
        this.render();
      },
      {
        leading: downloadSimpleIcon,
        trailing: caretDownIcon
      }
    );
    toggle.disabled = this.isCollecting;
    toggle.setAttribute("aria-expanded", String(this.exportMenuOpen));
    wrap.append(toggle);
    if (this.exportMenuOpen && !this.isCollecting) {
      const menu = createElement("div", "export-menu");
      const choices: Array<[string, string, () => void]> = [
        ["导出当前CSV", fileCsvIcon, this.callbacks.onExportCurrent],
        [
          "自动采集并导出前200条CSV",
          downloadSimpleIcon,
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

  private sortModes(): Array<[SortMode, string, string]> {
    return [
      ["original", "页面顺序", listPlusIcon],
      ["likes", "点赞最多", thumbsUpIcon],
      ["replies", "回复最多", chatCircleIcon]
    ];
  }
}
