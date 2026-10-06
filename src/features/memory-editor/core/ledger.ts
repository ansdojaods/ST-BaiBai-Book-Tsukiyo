/** 剧情剪辑台 · 剧情状态账本（只记明确发生、且和之前不同的变化） */
import { mkId, norm, trimText } from "./util";
import type { LedgerDeltaRow, LedgerEntry, LedgerKind, SourceTag } from "../types";

export const LEDGER_KINDS: LedgerKind[] = ["person", "relation", "promise", "item", "place", "time", "other"];

export const LEDGER_LABELS: Record<LedgerKind, string> = {
  person: "人物",
  relation: "关系",
  promise: "约定",
  item: "物品",
  place: "地点",
  time: "时间",
  other: "其它",
};

export const ledgerKey = (row: { kind: string; subject: string; key: string }): string =>
  `${norm(row.kind || "other")}|${norm(row.subject)}|${norm(row.key)}`;

export interface LedgerApplyStats {
  added: number;
  updated: number;
  unchanged: number;
}

/**
 * 把一批变化写进账本：
 * - 同一 (kind, subject, key) 只保留一条，更新时把旧值压进 history
 * - 值没变则计 unchanged，不再写历史（避免同一句话反复进历史）
 */
export const applyRows = (
  ledger: LedgerEntry[],
  rows: LedgerDeltaRow[],
  floor: number,
  source: SourceTag,
): LedgerApplyStats => {
  const stats: LedgerApplyStats = { added: 0, updated: 0, unchanged: 0 };
  for (const raw of rows || []) {
    const kind: LedgerKind = LEDGER_KINDS.includes(raw.kind) ? raw.kind : "other";
    const subject = trimText(raw.subject, 40);
    const key = trimText(raw.key, 40);
    const to = trimText(raw.to, 200);
    if (!subject || !key || !to) continue;
    const normKey = ledgerKey({ kind, subject, key });
    const prev = ledger.find((row) => ledgerKey(row) === normKey);
    const entryFloor = Number.isInteger(raw.floor) ? raw.floor : floor;
    if (!prev) {
      ledger.push({
        id: mkId("bme-ledger"),
        kind,
        subject,
        key,
        from: trimText(raw.from, 200) || "未知",
        to,
        evidence: trimText(raw.evidence, 300),
        floor: entryFloor,
        source,
        updatedAt: Date.now(),
        history: [],
      });
      stats.added += 1;
      continue;
    }
    if (norm(prev.to) === norm(to)) {
      stats.unchanged += 1;
      continue;
    }
    prev.history = [
      ...prev.history,
      { at: prev.updatedAt, from: prev.from, to: prev.to, evidence: prev.evidence, floor: prev.floor },
    ].slice(-20);
    prev.from = prev.to;
    prev.to = to;
    prev.evidence = trimText(raw.evidence, 300) || prev.evidence;
    prev.floor = entryFloor;
    prev.source = source;
    prev.updatedAt = Date.now();
    stats.updated += 1;
  }
  return stats;
};

export const editEntry = (
  ledger: LedgerEntry[],
  id: string,
  patch: Partial<Pick<LedgerEntry, "from" | "to" | "subject" | "key" | "evidence" | "kind">>,
): boolean => {
  const row = ledger.find((entry) => entry.id === id);
  if (!row) return false;
  row.history = [
    ...row.history,
    { at: row.updatedAt, from: row.from, to: row.to, evidence: row.evidence, floor: row.floor },
  ].slice(-20);
  if (patch.to !== undefined) row.to = trimText(patch.to, 200);
  if (patch.from !== undefined) row.from = trimText(patch.from, 200);
  if (patch.subject !== undefined) row.subject = trimText(patch.subject, 40) || row.subject;
  if (patch.key !== undefined) row.key = trimText(patch.key, 40) || row.key;
  if (patch.evidence !== undefined) row.evidence = trimText(patch.evidence, 300);
  if (patch.kind !== undefined && LEDGER_KINDS.includes(patch.kind)) row.kind = patch.kind;
  row.source = "manual";
  row.updatedAt = Date.now();
  return true;
};

export const removeEntry = (ledger: LedgerEntry[], id: string): boolean => {
  const before = ledger.length;
  const keep = ledger.filter((row) => row.id !== id);
  ledger.length = 0;
  ledger.push(...keep);
  return ledger.length !== before;
};

/** 把外部记录（例如小手机 pushNotes 过来的行）转成账本变化 */
export const rowsFromExternal = (
  records: Array<{
    type: string;
    subject?: string;
    key?: string;
    to?: string;
    from?: string;
    evidence?: string;
    floor?: number;
  }>,
): LedgerDeltaRow[] => {
  const kinds: Record<string, LedgerKind> = {
    contact: "person",
    contact_status: "person",
    recognized: "relation",
    agenda: "promise",
    promise: "promise",
    item: "item",
    place: "place",
    time: "time",
  };
  const out: LedgerDeltaRow[] = [];
  for (const row of records || []) {
    const kind = kinds[row.type] || "other";
    const subject = trimText(row.subject, 40);
    const key = trimText(row.key, 40);
    const to = trimText(row.to, 200);
    if (!subject || !key || !to) continue;
    out.push({
      kind,
      subject,
      key,
      from: trimText(row.from, 200) || "未知",
      to,
      evidence: trimText(row.evidence, 300) || "外部记录",
      floor: Number.isInteger(row.floor) ? (row.floor as number) : -1,
    });
  }
  return out;
};

export const ledgerLine = (row: LedgerEntry): string =>
  `${LEDGER_LABELS[row.kind]} · ${row.subject} / ${row.key}：${row.from === "未知" ? "" : row.from + " → "}${row.to}`;
