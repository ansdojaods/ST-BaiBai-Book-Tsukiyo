/** 剧情剪辑台 · 状态默认值、宽松校验与迁移（旧版本存档自动补齐） */
import { DEFAULT_PROMPTS } from "./prompts";
import { clampNum, isPlainObject, trimText } from "./util";
import type { Draft, LedgerEntry, MemoryEditorConfig, MemoryEditorState, PromptKind, SourceTag, SummaryNode } from "../types";

import { EDITOR_VERSION, MIN_ENGINE_VERSION, TARGET_ENGINE_VERSION } from "../version";

export { EDITOR_VERSION, MIN_ENGINE_VERSION, TARGET_ENGINE_VERSION };
export const STATE_KEY = "memoryEditor";

export const freshConfig = (): MemoryEditorConfig => ({
  auto: { enabled: true, every: 6, minIntervalMs: 150000, levels: { block: true, stage: false, long: false } },
  recall: {
    enabled: true,
    // 本地哈希向量比较粗，0.12 是「有内容重合就带上」的经验下限
    top: 6,
    bodies: 3,
    minScore: 0.12,
    maxChars: 3600,
    depth: 4,
    keywords: [],
    sources: { summary: true, ledger: true, memory: true, life: true, item: true, history: true },
  },
  shelve: { enabled: false, keepRecent: 80 },
  handoff: { phoneMirror: true, exposeMirror: true },
});

export const freshState = (): MemoryEditorState => ({
  version: EDITOR_VERSION,
  enabled: true,
  mode: "extra",
  cfg: freshConfig(),
  tree: [],
  ledger: [],
  drafts: [],
  undo: [],
  hidden: [],
  history: [],
  presets: { ...DEFAULT_PROMPTS },
  inject: { last: null },
  seen: { lastFloor: -1, lastBlockAt: 0, lastRunsAt: 0 },
  stats: {
    blocks: 0,
    stages: 0,
    longs: 0,
    confirmed: 0,
    rejected: 0,
    recalls: 0,
    backfills: 0,
    shelved: 0,
    runs: 0,
    failures: 0,
  },
  log: [],
});

const asBool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

/**
 * 宽松迁移：任何缺字段都补默认值，越界值夹回区间，非法结构丢弃。
 * 用于读取旧版本存档 / 外部导入的配置。
 */
export const coerceState = (raw: unknown): MemoryEditorState => {
  const base = freshState();
  if (!isPlainObject(raw)) return base;
  const state = base;
  state.enabled = asBool(raw.enabled, base.enabled);
  state.mode = raw.mode === "manual" ? "manual" : "extra";
  const cfg = isPlainObject(raw.cfg) ? (raw.cfg as Record<string, unknown>) : {};
  const auto = isPlainObject(cfg.auto) ? (cfg.auto as Record<string, unknown>) : {};
  const levels = isPlainObject(auto.levels) ? (auto.levels as Record<string, unknown>) : {};
  state.cfg.auto = {
    enabled: asBool(auto.enabled, base.cfg.auto.enabled),
    every: Math.round(clampNum(auto.every, 1, 40, base.cfg.auto.every)),
    minIntervalMs: Math.round(clampNum(auto.minIntervalMs, 30000, 3600000, base.cfg.auto.minIntervalMs)),
    levels: {
      block: asBool(levels.block, base.cfg.auto.levels.block),
      stage: asBool(levels.stage, base.cfg.auto.levels.stage),
      long: asBool(levels.long, base.cfg.auto.levels.long),
    },
  };
  const recall = isPlainObject(cfg.recall) ? (cfg.recall as Record<string, unknown>) : {};
  const sources = isPlainObject(recall.sources) ? (recall.sources as Record<string, unknown>) : {};
  state.cfg.recall = {
    enabled: asBool(recall.enabled, base.cfg.recall.enabled),
    top: Math.round(clampNum(recall.top, 0, 20, base.cfg.recall.top)),
    bodies: Math.round(clampNum(recall.bodies, 0, 10, base.cfg.recall.bodies)),
    minScore: clampNum(recall.minScore, 0, 1, base.cfg.recall.minScore),
    maxChars: Math.round(clampNum(recall.maxChars, 600, 12000, base.cfg.recall.maxChars)),
    depth: Math.round(clampNum(recall.depth, 0, 10, base.cfg.recall.depth)),
    keywords: Array.isArray(recall.keywords)
      ? (recall.keywords as unknown[]).map((x) => trimText(x, 20)).filter(Boolean).slice(0, 20)
      : [],
    sources: {
      summary: asBool(sources.summary, true),
      ledger: asBool(sources.ledger, true),
      memory: asBool(sources.memory, true),
      life: asBool(sources.life, true),
      item: asBool(sources.item, true),
      history: asBool(sources.history, true),
    },
  };
  const shelve = isPlainObject(cfg.shelve) ? (cfg.shelve as Record<string, unknown>) : {};
  state.cfg.shelve = {
    enabled: asBool(shelve.enabled, base.cfg.shelve.enabled),
    keepRecent: Math.round(clampNum(shelve.keepRecent, 10, 2000, base.cfg.shelve.keepRecent)),
  };
  const handoff = isPlainObject(cfg.handoff) ? (cfg.handoff as Record<string, unknown>) : {};
  state.cfg.handoff = {
    phoneMirror: asBool(handoff.phoneMirror, true),
    exposeMirror: asBool(handoff.exposeMirror, true),
  };

  state.tree = (Array.isArray(raw.tree) ? (raw.tree as unknown[]) : [])
    .filter(isPlainObject)
    .map((node): SummaryNode => {
      const row = node as Record<string, unknown>;
      const level = Math.round(clampNum(row.level, 0, 2, 0)) as SummaryNode["level"];
      return {
        id: trimText(row.id, 80) || `bme-node-${Math.random().toString(36).slice(2, 8)}`,
        level,
        from: Math.round(clampNum(row.from, 0, 1e6, 0)),
        to: Math.round(clampNum(row.to, 0, 1e6, 0)),
        text: trimText(row.text, 4000),
        covers: Array.isArray(row.covers) ? (row.covers as unknown[]).map((x) => trimText(x, 80)).filter(Boolean) : [],
        source: (row.source === "manual" || row.source === "import" ? row.source : "ai") as SourceTag,
        kept: row.kept !== false,
        createdAt: clampNum(row.createdAt, 0, 4e12, Date.now()),
        updatedAt: clampNum(row.updatedAt, 0, 4e12, clampNum(row.createdAt, 0, 4e12, Date.now())),
        history: Array.isArray(row.history)
          ? (row.history as unknown[])
              .filter(isPlainObject)
              .map((h) => {
                const item = h as Record<string, unknown>;
                return { at: clampNum(item.at, 0, 4e12, 0), text: trimText(item.text, 4000) };
              })
              .slice(-20)
          : [],
      };
    })
    .filter((node) => node.text && node.to >= node.from)
    .slice(-500);

  state.ledger = (Array.isArray(raw.ledger) ? (raw.ledger as unknown[]) : [])
    .filter(isPlainObject)
    .map((entry): LedgerEntry => {
      const row = entry as Record<string, unknown>;
      return {
        id: trimText(row.id, 80) || `bme-ledger-${Math.random().toString(36).slice(2, 8)}`,
        kind: (["person", "relation", "promise", "item", "place", "time", "other"] as const).includes(row.kind as never)
          ? (row.kind as MemoryEditorState["ledger"][number]["kind"])
          : "other",
        subject: trimText(row.subject, 40),
        key: trimText(row.key, 40),
        from: trimText(row.from, 200) || "未知",
        to: trimText(row.to, 200),
        evidence: trimText(row.evidence, 300),
        floor: Math.round(clampNum(row.floor, -1, 1e6, -1)),
        source: (row.source === "manual" || row.source === "phone" || row.source === "import" ? row.source : "ai") as SourceTag,
        updatedAt: clampNum(row.updatedAt, 0, 4e12, Date.now()),
        history: Array.isArray(row.history)
          ? (row.history as unknown[])
              .filter(isPlainObject)
              .map((h) => {
                const item = h as Record<string, unknown>;
                return {
                  at: clampNum(item.at, 0, 4e12, 0),
                  from: trimText(item.from, 200),
                  to: trimText(item.to, 200),
                  evidence: trimText(item.evidence, 300),
                  floor: Math.round(clampNum(item.floor, -1, 1e6, -1)),
                };
              })
              .slice(-20)
          : [],
      };
    })
    .filter((row) => row.subject && row.key && row.to)
    .slice(-600);

  state.drafts = (Array.isArray(raw.drafts) ? (raw.drafts as unknown[]) : [])
    .filter(isPlainObject)
    .map((draft): Draft => {
      const row = draft as Record<string, unknown>;
      const kind: Draft["kind"] = row.kind === "ledger" ? "ledger" : "summary";
      const level = Math.round(clampNum(row.level, 0, 2, 0)) as SummaryNode["level"];
      return {
        id: trimText(row.id, 80) || `bme-draft-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        level: kind === "summary" ? level : undefined,
        from: Math.round(clampNum(row.from, 0, 1e6, 0)),
        to: Math.round(clampNum(row.to, 0, 1e6, 0)),
        text: kind === "summary" ? trimText(row.text, 3000) : undefined,
        covers: kind === "summary" && Array.isArray(row.covers) ? (row.covers as unknown[]).map((x) => trimText(x, 80)) : undefined,
        rows: kind === "ledger" && Array.isArray(row.rows)
          ? (row.rows as unknown[])
              .filter(isPlainObject)
              .map((r) => {
                const item = r as Record<string, unknown>;
                return {
                  kind: (["person", "relation", "promise", "item", "place", "time", "other"] as const).includes(item.kind as never)
                    ? (item.kind as MemoryEditorState["ledger"][number]["kind"])
                    : "other",
                  subject: trimText(item.subject, 40),
                  key: trimText(item.key, 40),
                  from: trimText(item.from, 200) || "未知",
                  to: trimText(item.to, 200),
                  evidence: trimText(item.evidence, 300),
                  floor: Math.round(clampNum(item.floor, -1, 1e6, -1)),
                };
              })
              .filter((r) => r.subject && r.key && r.to)
          : undefined,
        source: (row.source === "manual" ? "manual" : "ai") as SourceTag,
        createdAt: clampNum(row.createdAt, 0, 4e12, Date.now()),
      };
    })
    .slice(-40);

  state.hidden = Array.isArray(raw.hidden)
    ? Array.from(
        new Set(
          (raw.hidden as unknown[])
            .map((x) => Math.round(Number(x)))
            .filter((n) => Number.isInteger(n) && n >= 0 && n <= 1e6),
        ),
      ).sort((a, b) => a - b)
    : [];

  state.history = Array.isArray(raw.history)
    ? (raw.history as unknown[])
        .filter(isPlainObject)
        .map((h) => {
          const item = h as Record<string, unknown>;
          return { at: clampNum(item.at, 0, 4e12, 0), text: trimText(item.text, 300) };
        })
        .slice(-60)
    : [];

  const presets = isPlainObject(raw.presets) ? (raw.presets as Record<string, unknown>) : {};
  for (const key of Object.keys(DEFAULT_PROMPTS) as PromptKind[]) {
    const value = presets[key];
    if (typeof value === "string" && value.trim()) state.presets[key] = trimText(value, 8000);
  }

  const inject = isPlainObject(raw.inject) ? (raw.inject as Record<string, unknown>) : {};
  state.inject = {
    last: isPlainObject(inject.last) ? (inject.last as unknown as MemoryEditorState["inject"]["last"]) : null,
  };

  const seen = isPlainObject(raw.seen) ? (raw.seen as Record<string, unknown>) : {};
  state.seen = {
    lastFloor: Math.round(clampNum(seen.lastFloor, -1, 1e6, -1)),
    lastBlockAt: clampNum(seen.lastBlockAt, 0, 4e12, 0),
    lastRunsAt: clampNum(seen.lastRunsAt, 0, 4e12, 0),
  };

  const stats = isPlainObject(raw.stats) ? (raw.stats as Record<string, unknown>) : {};
  for (const key of Object.keys(base.stats) as Array<keyof MemoryEditorState["stats"]>) {
    base.stats[key] = Math.round(clampNum(stats[key], 0, 1e9, 0));
  }

  state.log = Array.isArray(raw.log)
    ? (raw.log as unknown[])
        .filter(isPlainObject)
        .map((row) => {
          const item = row as Record<string, unknown>;
          const kind = item.kind === "error" || item.kind === "warn" ? item.kind : "info";
          return { at: clampNum(item.at, 0, 4e12, 0), kind: kind as "info" | "warn" | "error", text: trimText(item.text, 300) };
        })
        .slice(-200)
    : [];

  return state;
};

/** 导出成可分享的配置（不含摘要与账本） */
export const exportConfig = (state: MemoryEditorState) => ({
  app: "st-baibai-book",
  kind: "memory-editor-config",
  version: EDITOR_VERSION,
  exportedAt: new Date().toISOString(),
  mode: state.mode,
  cfg: JSON.parse(JSON.stringify(state.cfg)) as MemoryEditorConfig,
  presets: { ...state.presets },
});

/** 导入配置：返回生效的字段数（摘要树与账本不受影响） */
export const importConfig = (state: MemoryEditorState, raw: unknown): number => {
  if (!isPlainObject(raw)) throw new Error("配置文件格式不对（应为 memory-editor-config 的 JSON）");
  const source = isPlainObject(raw.cfg) ? raw : { cfg: raw as Record<string, unknown> };
  const merged = coerceState({ ...state, cfg: source.cfg, mode: isPlainObject(raw) && raw.mode === "manual" ? "manual" : state.mode });
  let fields = 0;
  const walk = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const key of Object.keys(b)) {
      const av = a[key];
      const bv = b[key];
      if (isPlainObject(av) && isPlainObject(bv)) walk(av as Record<string, unknown>, bv as Record<string, unknown>);
      else if (typeof av !== "object" && typeof bv !== "object") fields += 1;
    }
  };
  walk(merged.cfg as unknown as Record<string, unknown>, state.cfg as unknown as Record<string, unknown>);
  state.cfg = merged.cfg;
  state.mode = merged.mode;
  if (isPlainObject(raw.presets)) {
    const presets = raw.presets as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_PROMPTS) as PromptKind[]) {
      const value = presets[key];
      if (typeof value === "string" && value.trim()) state.presets[key] = trimText(value, 8000);
    }
  }
  return fields;
};

/** 脱敏诊断：只有版本、数量、开关与统计，不含正文、姓名、端点或密钥 */
export const diagnostics = (state: MemoryEditorState, extra: { pluginVersion: string; floors: number; validFloors: number }) => ({
  app: "st-baibai-book",
  kind: "memory-editor-diagnostics",
  editorVersion: EDITOR_VERSION,
  pluginVersion: extra.pluginVersion,
  generatedAt: new Date().toISOString(),
  floors: { total: extra.floors, valid: extra.validFloors },
  counts: {
    summaries: state.tree.length,
    byLevel: {
      0: state.tree.filter((n) => n.level === 0).length,
      1: state.tree.filter((n) => n.level === 1).length,
      2: state.tree.filter((n) => n.level === 2).length,
    },
    inactive: state.tree.filter((n) => n.kept === false).length,
    ledger: state.ledger.length,
    drafts: state.drafts.length,
    hidden: state.hidden.length,
    undo: state.undo.length,
    log: state.log.length,
  },
  flags: {
    enabled: state.enabled,
    mode: state.mode,
    auto: state.cfg.auto,
    recall: {
      enabled: state.cfg.recall.enabled,
      top: state.cfg.recall.top,
      bodies: state.cfg.recall.bodies,
      minScore: state.cfg.recall.minScore,
      maxChars: state.cfg.recall.maxChars,
      sources: state.cfg.recall.sources,
    },
    shelve: state.cfg.shelve,
  },
  stats: { ...state.stats },
});
