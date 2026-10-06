/**
 * 剧情剪辑台 · 数据类型
 * 放在百宝月夜书内：本模块只依赖 ports.ts 里的宿主端口，不 import 仓库内其它文件。
 */

export type PromptKind = "block" | "stage" | "long" | "ledger" | "keywords";

/** 0 剧情摘要（按楼块）· 1 阶段总结（合并多条摘要）· 2 多次总结（再压一层） */
export type SummaryLevel = 0 | 1 | 2;

export type SourceTag = "ai" | "manual" | "import" | "phone";

export interface SummaryNode {
  id: string;
  level: SummaryLevel;
  /** 覆盖楼层（0 基，闭区间，和 mesid 对齐） */
  from: number;
  to: number;
  text: string;
  /** 下级节点 id：被 covers 的节点视为“已折叠”，不参与召回与注入 */
  covers: string[];
  source: SourceTag;
  kept: boolean;
  createdAt: number;
  updatedAt: number;
  history: Array<{ at: number; text: string }>;
}

export type LedgerKind = "person" | "relation" | "promise" | "item" | "place" | "time" | "other";

export interface LedgerHistoryRow {
  at: number;
  from: string;
  to: string;
  evidence: string;
  floor: number;
}

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  subject: string;
  key: string;
  from: string;
  to: string;
  evidence: string;
  floor: number;
  source: SourceTag;
  updatedAt: number;
  history: LedgerHistoryRow[];
}

export interface LedgerDeltaRow {
  kind: LedgerKind;
  subject: string;
  key: string;
  from: string;
  to: string;
  evidence: string;
  floor: number;
}

export interface Draft {
  id: string;
  kind: "summary" | "ledger";
  level?: SummaryLevel;
  from: number;
  to: number;
  /** kind === "summary" */
  text?: string;
  /** kind === "summary"：本节点的下级节点 id */
  covers?: string[];
  /** kind === "ledger" */
  rows?: LedgerDeltaRow[];
  source: SourceTag;
  createdAt: number;
}

export interface RecallHit {
  id: string;
  kind: "summary" | "ledger" | "memory" | "life" | "item" | "history";
  label: string;
  text: string;
  /** -1 表示没有楼层归属 */
  floor: number;
  score: number;
  why: string[];
}

export interface RecallSkipped {
  id: string;
  label: string;
  score: number;
  reason: string;
}

export interface RecallRecord {
  at: number;
  floor: number;
  scope: "floor" | "phone";
  budget: number;
  chars: number;
  keywords: string[];
  query: string;
  picks: RecallHit[];
  skipped: RecallSkipped[];
  /** 实际注入的原文（截断保存） */
  text: string;
}

export interface CoverageReport {
  from: number;
  to: number;
  step: number;
  total: number;
  covered: number;
  /** 没有被任何层级摘要覆盖的楼块 */
  missing: Array<[number, number]>;
  ratio: number;
  /** 宿主（或手机）额外报告的缺失楼层，例如百宝月夜的 coverage.missingAiFloors */
  extraMissing: number[];
}

export interface UndoFrame {
  at: number;
  label: string;
  tree: SummaryNode[];
  ledger: LedgerEntry[];
  hidden: number[];
}

export interface MemoryEditorConfig {
  /** 自动摘要：每轮回复后另外生成 */
  auto: {
    enabled: boolean;
    every: number;
    minIntervalMs: number;
    levels: { block: boolean; stage: boolean; long: boolean };
  };
  recall: {
    enabled: boolean;
    top: number;
    bodies: number;
    minScore: number;
    maxChars: number;
    depth: number;
    keywords: string[];
    sources: { summary: boolean; ledger: boolean; memory: boolean; life: boolean; item: boolean; history: boolean };
  };
  shelve: { enabled: boolean; keepRecent: number };
  /** 手机侧降级联动：把楼层记忆交给本模块时，手机只读镜像 */
  handoff: { phoneMirror: boolean; exposeMirror: boolean };
}

export interface MemoryEditorState {
  version: string;
  enabled: boolean;
  mode: "extra" | "manual";
  cfg: MemoryEditorConfig;
  tree: SummaryNode[];
  ledger: LedgerEntry[];
  drafts: Draft[];
  undo: UndoFrame[];
  hidden: number[];
  history: Array<{ at: number; text: string }>;
  presets: Partial<Record<PromptKind, string>>;
  inject: { last: RecallRecord | null };
  seen: { lastFloor: number; lastBlockAt: number; lastRunsAt: number };
  stats: {
    blocks: number;
    stages: number;
    longs: number;
    confirmed: number;
    rejected: number;
    recalls: number;
    backfills: number;
    shelved: number;
    runs: number;
    failures: number;
  };
  log: Array<{ at: number; kind: "info" | "warn" | "error"; text: string }>;
}

/** 给“小手机”等外部消费方看的只读镜像（脱敏到剧情层面，不含 API 与正文全文） */
export interface MemoryEditorMirror {
  available: true;
  apiVersion: number;
  pluginVersion: string;
  updatedAt: number;
  enabled: boolean;
  mode: MemoryEditorState["mode"];
  owner: "engine";
  coverage: CoverageReport | null;
  summaries: Array<{ id: string; level: SummaryLevel; from: number; to: number; text: string; covers: string[] }>;
  ledger: Array<{ id: string; kind: LedgerKind; subject: string; key: string; from: string; to: string; floor: number }>;
  counts: { summaries: number; active: number; drafts: number; ledger: number; hidden: number };
  /** 最近一次注入记录了什么（只给标签、分数与理由，不给正文） */
  lastRecall: { at: number; floor: number; chars: number; budget: number; hits: Array<{ label: string; score: number; why: string[] }> } | null;
}
