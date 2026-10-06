/** 剧情剪辑台 · 计划类纯函数：补课范围、楼层收纳、分层合并素材 */
import { activeNodes, coverage } from "./coverage";
import type { CoverageReport, MemoryEditorState, SummaryLevel, SummaryNode } from "../types";

/** 补课计划：只补没有摘要覆盖的楼块 */
export const planBackfill = (
  state: MemoryEditorState,
  floors: number[],
  options: { from?: number; to?: number; step?: number } = {},
): { ranges: Array<[number, number]>; coverage: CoverageReport | null } => {
  if (!floors.length) return { ranges: [], coverage: null };
  const step = Math.max(1, Math.round(options.step || state.cfg.auto.every || 6));
  const lo = Number.isInteger(options.from) ? (options.from as number) : Math.min(...floors);
  const hi = Number.isInteger(options.to) ? (options.to as number) : Math.max(...floors);
  const report = coverage(state.tree, lo, hi, step, []);
  return { ranges: report.missing.map(([a, b]) => [a, b] as [number, number]), coverage: report };
};

export const planStage = (
  state: MemoryEditorState,
  range: { from: number; to: number },
): { material: SummaryNode[]; covers: string[]; from: number; to: number } => {
  const material = activeNodes(state.tree).filter(
    (node) => node.level === 0 && node.to >= range.from && node.from <= range.to,
  );
  return {
    material,
    covers: material.map((node) => node.id),
    from: material.length ? Math.min(...material.map((node) => node.from)) : range.from,
    to: material.length ? Math.max(...material.map((node) => node.to)) : range.to,
  };
};

export const planLong = (
  state: MemoryEditorState,
  range: { from: number; to: number },
): { material: SummaryNode[]; covers: string[]; from: number; to: number } => {
  const material = activeNodes(state.tree).filter(
    (node) => node.level === 1 && node.to >= range.from && node.from <= range.to,
  );
  return {
    material,
    covers: material.map((node) => node.id),
    from: material.length ? Math.min(...material.map((node) => node.from)) : range.from,
    to: material.length ? Math.max(...material.map((node) => node.to)) : range.to,
  };
};

/**
 * 收纳计划：只收纳「已被阶段总结/多次总结覆盖」且「超出保留最近 N 楼」的楼层。
 * 不做任何隐藏动作，只算清单；真正的隐藏由宿主端口的 hideFloors 执行。
 */
export const planShelve = (
  state: MemoryEditorState,
  floors: number[],
  options: { keepRecent?: number } = {},
): { hide: number[]; keep: number; limit: number; covered: number[] } => {
  const keep = Math.max(10, Math.round(options.keepRecent ?? state.cfg.shelve.keepRecent ?? 80));
  if (!floors.length) return { hide: [], keep, limit: 0, covered: [] };
  const maxFloor = Math.max(...floors);
  const limit = Math.max(0, maxFloor - keep);
  const hidden = new Set(state.hidden);
  const upper = activeNodes(state.tree).filter((node) => node.level >= 1);
  const covered: number[] = [];
  for (const node of upper) {
    for (let f = Math.max(0, node.from); f <= node.to; f++) if (f <= limit && !hidden.has(f)) covered.push(f);
  }
  const unique = Array.from(new Set(covered)).sort((a, b) => a - b);
  return { hide: unique, keep, limit, covered: unique };
};

export const levelLabel = (level: SummaryLevel): string => ["剧情摘要", "阶段总结", "多次总结"][level];
