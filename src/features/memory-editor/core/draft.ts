/** 剧情剪辑台 · 待确认草稿区 + 撤回栈（事务式快照） */
import { coveredTo } from "./coverage";
import { applyRows } from "./ledger";
import { mkId, norm } from "./util";
import type { Draft, LedgerEntry, MemoryEditorState, SummaryLevel, SummaryNode, UndoFrame } from "../types";

export const MAX_DRAFTS = 40;
export const MAX_UNDO = 20;
export const MAX_NODES = 500;
export const MAX_LEDGER = 600;

export const snapshotFrame = (state: MemoryEditorState, label: string): UndoFrame => ({
  at: Date.now(),
  label,
  tree: JSON.parse(JSON.stringify(state.tree)) as SummaryNode[],
  ledger: JSON.parse(JSON.stringify(state.ledger)) as LedgerEntry[],
  hidden: [...state.hidden],
});

export const pushUndo = (state: MemoryEditorState, label: string): void => {
  state.undo = [...state.undo, snapshotFrame(state, label)].slice(-MAX_UNDO);
};

/** 撤回：整块还原摘要树 / 账本 / 隐藏楼层 */
export const undo = (state: MemoryEditorState): UndoFrame | null => {
  const frame = state.undo.pop() || null;
  if (!frame) return null;
  state.tree = frame.tree;
  state.ledger = frame.ledger;
  state.hidden = frame.hidden;
  state.history = [...state.history, { at: Date.now(), text: `撤回：${frame.label}` }].slice(-60);
  return frame;
};

export const pushDraft = (state: MemoryEditorState, draft: Omit<Draft, "id" | "createdAt">): Draft => {
  if (state.drafts.length >= MAX_DRAFTS) throw new Error("待确认已经堆满（" + MAX_DRAFTS + " 条），先处理或清空再生成");
  const row: Draft = { ...draft, id: mkId("bme-draft"), createdAt: Date.now() };
  state.drafts = [...state.drafts, row].slice(-MAX_DRAFTS);
  return row;
};

export const findDraft = (state: MemoryEditorState, id: string): Draft | null =>
  state.drafts.find((row) => row.id === id) || null;

export const dropDraft = (state: MemoryEditorState, id: string): boolean => {
  const before = state.drafts.length;
  state.drafts = state.drafts.filter((row) => row.id !== id);
  return state.drafts.length !== before;
};

/** 确认一条草稿：写入摘要树或状态账本（可撤回） */
export const confirmDraft = (state: MemoryEditorState, id: string): { kind: "summary" | "ledger"; level?: SummaryLevel; added: number; updated: number; unchanged: number } | null => {
  const draft = findDraft(state, id);
  if (!draft) return null;
  pushUndo(state, draft.kind === "ledger" ? "确认状态变化" : `确认${["剧情摘要", "阶段总结", "多次总结"][draft.level ?? 0]}`);
  dropDraft(state, id);
  const now = Date.now();
  if (draft.kind === "ledger") {
    const stats = applyRows(state.ledger, draft.rows || [], draft.from, draft.source === "ai" ? "ai" : "manual");
    state.stats.confirmed += 1;
    state.history = [...state.history, { at: now, text: `确认状态变化（${draft.from + 1}-${draft.to + 1} 楼）：+${stats.added} / ~${stats.updated}` }].slice(-60);
    return { kind: "ledger", added: stats.added, updated: stats.updated, unchanged: stats.unchanged };
  }
  const level = (draft.level ?? 0) as SummaryLevel;
  const node: SummaryNode = {
    id: mkId("bme-node"),
    level,
    from: draft.from,
    to: draft.to,
    text: (draft.text || "").slice(0, level === 0 ? 2000 : 3000),
    covers: [...(draft.covers || [])],
    source: draft.source === "ai" ? "ai" : "manual",
    kept: true,
    createdAt: now,
    updatedAt: now,
    history: [],
  };
  state.tree = [...state.tree, node].slice(-MAX_NODES);
  if (level === 0) state.stats.blocks += 1;
  else if (level === 1) state.stats.stages += 1;
  else state.stats.longs += 1;
  state.stats.confirmed += 1;
  state.history = [...state.history, { at: now, text: `确认${["剧情摘要", "阶段总结", "多次总结"][level]}（${draft.from + 1}-${draft.to + 1} 楼）` }].slice(-60);
  return { kind: "summary", level, added: 1, updated: 0, unchanged: 0 };
};

/** 确认全部草稿（自动摘要堆积时用） */
export const confirmAll = (state: MemoryEditorState): number => {
  const ids = state.drafts.map((row) => row.id);
  let done = 0;
  for (const id of ids) if (confirmDraft(state, id)) done += 1;
  return done;
};

export const clearDrafts = (state: MemoryEditorState): number => {
  const n = state.drafts.length;
  state.drafts = [];
  return n;
};

export const editDraftText = (state: MemoryEditorState, id: string, text: string): boolean => {
  const draft = findDraft(state, id);
  if (!draft || draft.kind !== "summary") return false;
  draft.text = text.slice(0, draft.level === 0 ? 2000 : 3000);
  return true;
};

export const editDraftRow = (
  state: MemoryEditorState,
  id: string,
  index: number,
  patch: { to?: string; from?: string; evidence?: string },
): boolean => {
  const draft = findDraft(state, id);
  if (!draft || draft.kind !== "ledger" || !draft.rows || !draft.rows[index]) return false;
  const row = draft.rows[index];
  if (patch.to !== undefined) row.to = String(patch.to).slice(0, 200);
  if (patch.from !== undefined) row.from = String(patch.from).slice(0, 200);
  if (patch.evidence !== undefined) row.evidence = String(patch.evidence).slice(0, 300);
  return true;
};

/** 去掉明显重复/空白的草稿行（模型偶尔会重复输出同一变化） */
export const dedupeDraft = (draft: Draft): Draft => {
  if (draft.kind !== "ledger" || !draft.rows) return draft;
  const seen = new Set<string>();
  const rows = draft.rows.filter((row) => {
    const key = norm(row.kind) + "|" + norm(row.subject) + "|" + norm(row.key) + "|" + norm(row.to);
    if (!row.subject || !row.key || !row.to || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...draft, rows };
};

export const pendingDrafts = (state: MemoryEditorState): Draft[] => state.drafts;

export const treeSummaryLine = (state: MemoryEditorState): string => {
  const active = state.tree.filter((node) => node.kept !== false);
  const lv = (n: SummaryLevel) => active.filter((node) => node.level === n).length;
  return `摘要 ${state.tree.length} 条（剧情 ${lv(0)} · 阶段 ${lv(1)} · 多次 ${lv(2)}）· 覆盖到 #${coveredTo(state.tree) + 1} 楼`;
};
