/**
 * 剧情剪辑台 · 宿主端口
 *
 * 这是整个模块**唯一**需要你按百宝月夜书的内部实现去适配的地方。
 * core/ 下的纯函数不需要端口；service.ts 只通过这个接口访问楼层、存档、生成与注入。
 */
import type { MemoryEditorMirror, MemoryEditorState, PromptKind } from "./types";

export interface FloorRef {
  /** 0 基楼层号，与 PUBLIC_API 的 getFloor(n) 对齐 */
  mesid: number;
  text: string;
  role: "user" | "assistant" | "system" | "unknown";
  /** memory.valid：失效/被重写/番外等被排除的楼层为 false */
  valid: boolean;
}

export interface GenerateRequest {
  kind: PromptKind | "summary" | "ledger";
  system: string;
  user: string;
  /** 0 基楼层范围，便于你在宿主侧记录调用来源 */
  range: [number, number];
  signal?: AbortSignal;
}

export interface GenerateResult {
  ok: boolean;
  /** 模型返回的原文（JSON 字符串或普通文本） */
  text: string;
  error?: string;
}

export interface HostPort {
  /** 宿主插件版本，例如 "1.6.3"，会写进镜像与诊断 */
  pluginVersion(): string;

  /** 有效楼层（口径应与 getInjectedHistory() 一致：番外/失效楼层已被排除） */
  listFloors(): FloorRef[];

  /** 只读的扩展资料，作为召回候选；没有就返回空数组 */
  listExtras?(): Array<{
    id: string;
    kind: "memory" | "life" | "item" | "history";
    label: string;
    text: string;
    floor: number;
  }>;

  /** 宿主侧额外报告的缺失楼层（例如 coverage.missingAiFloors），用于缺口合并 */
  missingFloors?(): number[];

  /**
   * 【1.4.2】自动摘要归属：返回 false 时剪辑台**不**再自动生成楼层摘要。
   * 宿主未实现时按 true 处理（旧宿主行为不变）。
   * 柏宝书宿主按「柏宝书设置 → 摘要设置 → 自动摘要归属」回答：默认由柏宝书的摘要森林负责，
   * 避免同一段剧情被两边各自动摘要一次（两次模型调用、两个缺口数字）。
   */
  autoSummaryAllowed?(): boolean;

  /** 读取本聊天的剪辑台状态；没有就返回 null */
  loadState(): MemoryEditorState | null;
  /** 保存（宿主决定存哪里：聊天变量 / 扩展设置 / 世界书） */
  saveState(state: MemoryEditorState): void | Promise<void>;

  /** 生成通道：接你们已有的 LLM 调用 */
  generate(req: GenerateRequest): Promise<GenerateResult>;
  /** 是否正在生成 / 正在流式输出（用于让行与阻塞判断） */
  busy(): boolean;

  /** 让宿主刷新正文注入；文本为空字符串表示清空 */
  requestInject(text: string): void;

  /** 楼层收纳（可选）。返回实际隐藏/恢复的楼层数 */
  hideFloors?(mesids: number[]): Promise<number> | number;
  showFloors?(mesids: number[]): Promise<number> | number;

  /** 提示与日志 */
  toast(message: string, level?: "info" | "warn" | "error"): void;
  log?(message: string, data?: unknown): void;

  /** 事件订阅（返回取消函数）。没有实现时剪辑台退化为“手动模式” */
  onChatChanged?(cb: () => void): () => void;
  onGenerationEnded?(cb: () => void): () => void;

  /** 宿主面板容器；返回 null 时只能用导出的 HTML 自行挂载 */
  mount?(container: HTMLElement): () => void;
}

export interface MemoryEditorCapability {
  available: true;
  apiVersion: number;
  pluginVersion: string;
  /**
   * 【1.4.2】剪辑台总开关是否打开（面板「设置」页的「剪辑台总开关」）。
   * 调用方（例如小手机）在 enabled:false 时应当作「引擎没在管」，
   * 自己接管楼层记忆——否则会出现「剪辑台关了、手机也停手」的空档。
   */
  enabled: boolean;
  mode: MemoryEditorState["mode"];
}

export interface MemoryEditorHandle {
  state(): MemoryEditorState;
  refresh(): void;
  /** 把面板挂到某个容器里（返回卸载函数） */
  attach(container: HTMLElement): () => void;
  capability(): MemoryEditorCapability;
  mirror(): MemoryEditorMirror;
  dispose(): void;
}
