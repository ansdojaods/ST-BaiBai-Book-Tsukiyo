/**
 * 剧情剪辑台 · 入口
 *
 * 用法（在百宝月夜书里）：
 *   import { createMemoryEditor } from "./features/memory-editor";
 *   const editor = createMemoryEditor(hostPort);
 *   editor.attach(document.querySelector("#st-baibai-book-memory-editor"));
 *   editor.installGlobal();   // 挂 window.STBaiBaiBook.memoryEditor，并广播 st-baibai-book:memory-editor
 */
import { MemoryEditorService } from "./service";
import { createPanel } from "./ui/panel";
import type { PanelHandle, PanelOptions } from "./ui/panel";
import type { MemoryEditorHandle, HostPort } from "./ports";
import type { MemoryEditorMirror, MemoryEditorState } from "./types";

export type { HostPort, FloorRef, GenerateRequest, GenerateResult, MemoryEditorHandle } from "./ports";
export type {
  CoverageReport,
  Draft,
  LedgerDeltaRow,
  LedgerEntry,
  LedgerKind,
  MemoryEditorConfig,
  MemoryEditorMirror,
  MemoryEditorState,
  PromptKind,
  RecallHit,
  RecallRecord,
  RecallSkipped,
  SourceTag,
  SummaryLevel,
  SummaryNode,
  UndoFrame,
} from "./types";

export { MemoryEditorService } from "./service";
export { createPanel, panelStyles } from "./ui/panel";
export { EDITOR_VERSION, MIN_ENGINE_VERSION, TARGET_ENGINE_VERSION, VERSIONS } from "./version";
export type { PanelHandle, PanelOptions } from "./ui/panel";

/** core 纯函数也导出，方便你在别处复用（以及给自动化测试用） */
export * from "./core/coverage";
export * from "./core/draft";
export * from "./core/ledger";
export * from "./core/plan";
export * from "./core/prompts";
export * from "./core/recall";
export * from "./core/state";
export * from "./core/util";

export const MEMORY_EDITOR_EVENT = "st-baibai-book:memory-editor";
export const MEMORY_EDITOR_KEY = "memoryEditor";

export interface CreateOptions extends PanelOptions {
  /** 是否在创建时立刻接上宿主的聊天/生成事件（默认 true） */
  autoInit?: boolean;
}

/**
 * 创建一个剪辑台实例。
 * 这个函数不会自己去动楼层/生成/注入：所有副作用都从 host 端口出去。
 */
export const createMemoryEditor = (host: HostPort, options: CreateOptions = {}): MemoryEditorHandle & {
  service: MemoryEditorService;
  installGlobal(target?: Record<string, unknown>): () => void;
  panel(container: HTMLElement): () => void;
  renderPanel(): void;
} => {
  const service = new MemoryEditorService(host);
  if (options.autoInit !== false) service.init();
  const { autoInit: _autoInit, ...panelOptions } = options;
  let panelOff: (() => void) | null = null;
  let globalOff: (() => void) | null = null;
  /** 当前面板句柄：供宿主（如抽屉顶栏的「刷新」按钮）强制重绘 */
  let panelRef: PanelHandle | null = null;
  let lastMirrorAt = 0;

  const broadcast = (): void => {
    const now = Date.now();
    if (now - lastMirrorAt < 500) return;
    lastMirrorAt = now;
    const g = globalThis as unknown as { dispatchEvent?: (event: unknown) => boolean; CustomEvent?: typeof CustomEvent };
    if (typeof g.dispatchEvent !== "function" || typeof g.CustomEvent !== "function") return;
    try {
      g.dispatchEvent(new g.CustomEvent(MEMORY_EDITOR_EVENT, { detail: service.mirror() }));
    } catch {
      /* 非浏览器环境忽略 */
    }
  };

  const handle = {
    service,
    state(): MemoryEditorState {
      return service.state;
    },
    refresh(): void {
      broadcast();
    },
    /** 重绘面板（读当前服务状态，不动数据）——抽屉顶栏「刷新」与面板开合时调用 */
    renderPanel(): void {
      panelRef?.render();
    },
    attach(container: HTMLElement): () => void {
      if (panelOff) panelOff();
      const panel = createPanel(service, { onChange: broadcast, ...panelOptions });
      panelRef = panel;
      container.appendChild(panel.el);
      panelOff = () => {
        panel.dispose();
        if (container.contains(panel.el)) container.removeChild(panel.el);
        panelRef = null;
      };
      broadcast();
      return () => {
        if (panelOff) panelOff();
        panelOff = null;
      };
    },
    panel(container: HTMLElement): () => void {
      return handle.attach(container);
    },
    capability() {
      return service.capability();
    },
    mirror(): MemoryEditorMirror {
      return service.mirror();
    },
    installGlobal(target?: Record<string, unknown>): () => void {
      if (globalOff) globalOff();
      const owner =
        target ||
        ((globalThis as unknown as { STBaiBaiBook?: Record<string, unknown> }).STBaiBaiBook as Record<string, unknown> | undefined) ||
        ((globalThis as unknown as { STBaiBaiBook?: Record<string, unknown> }).STBaiBaiBook = {});
      const previous = owner[MEMORY_EDITOR_KEY];
      owner[MEMORY_EDITOR_KEY] = {
        apiVersion: 1,
        owner: "engine",
        capability: () => service.capability(),
        mirror: () => service.mirror(),
        info: () => service.info(),
        recall: (options?: { query?: string; floor?: number; phoneOnly?: boolean; inject?: boolean }) => service.recall(options),
        mergeExternal: (records: Array<{ type: string; subject?: string; key?: string; to?: string; from?: string; evidence?: string; floor?: number }>) =>
          service.mergeExternal(records),
        mergePhoneNotes: (notes: Array<{ id: string; kind: string; title: string; text: string; floor?: number; pinned?: boolean }>) =>
          service.mergePhoneNotes(notes),
        exportArchive: () => service.exportArchive(),
        diagnostics: () => service.diagnostics(),
      };
      globalOff = () => {
        owner[MEMORY_EDITOR_KEY] = previous;
        globalOff = null;
      };
      return globalOff;
    },
    dispose(): void {
      if (panelOff) panelOff();
      if (globalOff) globalOff();
      service.dispose();
    },
  };
  return handle;
};

export default createMemoryEditor;

/** 供没有全局 window 的宿主使用（例如测试环境） */
export const describeEditor = (service: MemoryEditorService): string => {
  const info = service.info();
  const lines = [
    `剧情剪辑台 ${info.editorVersion} · 引擎 ${info.pluginVersion}`,
    `楼层 ${info.floors.valid}/${info.floors.total} 有效 · 覆盖到 #${info.coveredTo + 1} 楼`,
    `摘要 ${info.summaries}（生效 ${info.activeSummaries}）· 状态 ${info.ledger} · 待确认 ${info.drafts} · 已收纳 ${info.hidden}`,
    info.coverage ? `缺口 ${info.coverage.missing.length} 段 · 覆盖率 ${Math.round(info.coverage.ratio * 100)}%` : "缺口：无楼层",
  ];
  return lines.join("\n");
};
