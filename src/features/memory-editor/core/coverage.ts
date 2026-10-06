/** 剧情剪辑台 · 摘要树覆盖与缺口（纯函数） */
import type { CoverageReport, SummaryLevel, SummaryNode } from "../types";

/** 被任何“保留中的节点”写进 covers 的节点视为已折叠，不参与注入与召回 */
export const activeNodes = (tree: SummaryNode[]): SummaryNode[] => {
  const covered = new Set<string>();
  for (const node of tree) {
    if (node.kept === false) continue;
    for (const id of node.covers || []) covered.add(id);
  }
  return tree.filter((node) => node.kept !== false && !covered.has(node.id));
};

export const nodesInRange = (
  tree: SummaryNode[],
  range: { level?: SummaryLevel | null; from?: number; to?: number; activeOnly?: boolean } = {},
): SummaryNode[] => {
  const { level = null, from = -Infinity, to = Infinity, activeOnly = true } = range;
  const pool = activeOnly ? activeNodes(tree) : tree.filter((n) => n.kept !== false);
  return pool.filter((node) => (level === null || node.level === level) && node.to >= from && node.from <= to);
};

/**
 * 「摘要已经管到哪一楼」。
 * 用全部生效节点（含阶段/多次总结）：否则一旦下级摘要被上层折叠，这里会退回原处，
 * 自动摘要就会把已经总结过的楼层再做一遍。
 */
export const coveredTo = (tree: SummaryNode[]): number =>
  activeNodes(tree).reduce((max, node) => Math.max(max, node.to), -1);

/**
 * 缺口检查：把 [from,to] 按 step 楼一块切开，看哪些块没有任何有效摘要覆盖。
 * extraMissing：宿主（或小手机）额外报告的缺失楼层，会被并进 missing。
 */
export const coverage = (
  tree: SummaryNode[],
  from: number,
  to: number,
  step = 6,
  extraMissing: number[] = [],
): CoverageReport => {
  const size = Math.max(1, Math.round(step || 6));
  const lo = Math.max(0, Math.round(from));
  const hi = Math.max(lo, Math.round(to));
  const blocks: Array<[number, number]> = [];
  for (let a = lo; a <= hi; a += size) blocks.push([a, Math.min(hi, a + size - 1)]);
  const flat = activeNodes(tree);
  const missing: Array<[number, number]> = [];
  let covered = 0;
  for (const [a, b] of blocks) {
    const hit = flat.some((node) => node.from <= b && node.to >= a);
    if (hit) covered += 1;
    else missing.push([a, b]);
  }
  const owned = new Set<number>();
  for (const [a, b] of missing) for (let f = a; f <= b; f++) owned.add(f);
  const extra = (extraMissing || [])
    .filter((f) => Number.isInteger(f) && f >= lo && f <= hi && !owned.has(f))
    .sort((x, y) => x - y);
  const merged: Array<[number, number]> = [...missing, ...extra.map((f) => [f, f] as [number, number])].sort((x, y) => x[0] - y[0]);
  const total = blocks.length;
  return {
    from: lo,
    to: hi,
    step: size,
    total,
    covered,
    missing: merged,
    ratio: total ? covered / total : 1,
    extraMissing: extra,
  };
};

/** 下一段可以自动摘要的范围（够一块才返回） */
export const nextPendingRange = (
  tree: SummaryNode[],
  floors: number[],
  step = 6,
): [number, number] | null => {
  if (!floors.length) return null;
  const min = Math.min(...floors);
  const max = Math.max(...floors);
  const from = Math.max(min, coveredTo(tree) + 1);
  if (max - from + 1 < step) return null;
  return [from, Math.min(max, from + step - 1)];
};
