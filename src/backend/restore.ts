/**
 * 恢复点 + 回收站恢复 + 完整快照(融合版新增;思路来自世界背面的"恢复点"与白鸟数据的 trash)。
 *
 * - 恢复点:在批量补摘 / 导入历史 / 手写补摘 等"大改"之前,把整份记忆状态
 *   (森林 + 逐楼叶子 + 锚点 + 外部记录 + 变量模板)深拷贝到 chatMetadata['baibai_book_restore'],
 *   最多保留 N 份(设置),出问题一键回滚。
 * - 快照:同样的数据结构也是导出文件时的载荷。
 */
import { shallowReactive } from 'vue';
import { getContext } from '@/st/context';
import { apiSettings } from '@/api/settings';
import { memory, saveMemory, recomputeDerived, scheduleLeafFlush, flushLeavesNow } from '@/memory/store';
import { getLeaf } from '@/memory/apply';
import { refreshInjection } from '@/memory/inject';
import type { LeafExtra, MemSummary, VarTemplate } from '@/memory/types';
import { anchorsSnapshot, replaceAnchors, anchorState, type AnchorEntry } from '@/anchor/store';
import { externalSnapshot, replaceExternal, externalState, type ExternalNote } from '@/bridge/external';
import { trashRemove, trashState, type TrashEntry } from './trash';

export const RESTORE_META_KEY = 'baibai_book_restore';
export const SNAPSHOT_VERSION = 1;

export interface MemorySnapshot {
  snapshotVersion: number;
  createdAt: number;
  pluginVersion: string;
  chatId: string;
  charName: string;
  floors: number;
  summaries: MemSummary[];
  leaves: Array<{ msgIndex: number; leaf: LeafExtra }>;
  varsTemplate: VarTemplate;
  anchors: AnchorEntry[];
  external: ExternalNote[];
}

export interface RestorePoint {
  id: string;
  createdAt: number;
  reason: string;
  snapshot: MemorySnapshot;
}

/** shallowReactive:快照体积大且类型深,只需对 points 整体替换做响应即可(所有写入都重新赋值数组) */
export const restoreState = shallowReactive<{ points: RestorePoint[]; rev: number }>({ points: [], rev: 0 });

let seq = 0;
let pluginVersion = '';
export function setSnapshotPluginVersion(v: string): void {
  pluginVersion = v;
}

export function loadRestorePoints(): void {
  const meta = getContext()?.chatMetadata as Record<string, unknown> | undefined;
  const raw = meta?.[RESTORE_META_KEY] as { points?: unknown[] } | undefined;
  const points: RestorePoint[] = [];
  for (const x of Array.isArray(raw?.points) ? raw!.points : []) {
    const p = x as Partial<RestorePoint>;
    if (!p || typeof p.id !== 'string' || !p.snapshot || typeof p.snapshot !== 'object') continue;
    points.push({ id: p.id, createdAt: Number(p.createdAt ?? 0), reason: String(p.reason ?? ''), snapshot: p.snapshot as MemorySnapshot });
  }
  restoreState.points = points;
  restoreState.rev += 1;
}

function saveRestorePoints(): void {
  const ctx = getContext();
  if (!ctx?.chatMetadata) return;
  (ctx.chatMetadata as Record<string, unknown>)[RESTORE_META_KEY] = {
    version: 1,
    points: JSON.parse(JSON.stringify(restoreState.points)),
  };
  ctx.saveMetadataDebounced?.();
  restoreState.rev += 1;
}

/** 当前记忆状态的完整快照(深拷贝) */
export function buildSnapshot(): MemorySnapshot {
  const ctx = getContext();
  const chat = ctx?.chat ?? [];
  const leaves: Array<{ msgIndex: number; leaf: LeafExtra }> = [];
  chat.forEach((m, i) => {
    const leaf = getLeaf(m);
    if (leaf) leaves.push({ msgIndex: i, leaf: JSON.parse(JSON.stringify(leaf)) });
  });
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    createdAt: Date.now(),
    pluginVersion,
    chatId: String(ctx?.getCurrentChatId?.() ?? ''),
    charName: String(ctx?.name2 ?? ''),
    floors: chat.length,
    summaries: JSON.parse(JSON.stringify(memory.summaries)),
    leaves,
    varsTemplate: JSON.parse(JSON.stringify(memory.varTemplates.chat)),
    anchors: anchorsSnapshot(),
    external: externalSnapshot(),
  };
}

/** 快照是否"有内容"(避免把空状态当恢复点存一堆) */
export function snapshotIsEmpty(s: MemorySnapshot): boolean {
  return !s.summaries.length && !s.leaves.length && !s.anchors.length && !s.external.length;
}

/** 建恢复点;空状态不建。返回新恢复点或 null */
export function createRestorePoint(reason: string): RestorePoint | null {
  const snapshot = buildSnapshot();
  if (snapshotIsEmpty(snapshot)) return null;
  seq += 1;
  const point: RestorePoint = { id: `rp_${Date.now().toString(36)}_${seq}`, createdAt: Date.now(), reason: reason.slice(0, 80), snapshot };
  const keep = Math.max(1, apiSettings.backend?.restorePoints ?? 3);
  restoreState.points = [point, ...restoreState.points].slice(0, keep);
  saveRestorePoints();
  return point;
}

export function deleteRestorePoint(id: string): boolean {
  if (!restoreState.points.some(p => p.id === id)) return false;
  restoreState.points = restoreState.points.filter(p => p.id !== id);
  saveRestorePoints();
  return true;
}

/**
 * 把快照应用到当前聊天(整份覆盖)。
 * 叶子按 msgIndex 回写到消息 extra;楼层数对不上的部分跳过(并计入 skippedLeaves)。
 * 应用前会自动再建一个"恢复前"的恢复点,保证可反悔。
 */
export function applySnapshot(s: MemorySnapshot, opts: { makePoint?: boolean } = {}): { skippedLeaves: number } {
  if (opts.makePoint !== false) createRestorePoint('恢复前自动保存');
  const ctx = getContext();
  const chat = ctx?.chat ?? [];
  flushLeavesNow();
  // 先清空现有叶子,再回写快照里的
  for (const m of chat) {
    if (m?.extra && 'bbs_leaf' in m.extra) delete (m.extra as Record<string, unknown>).bbs_leaf;
  }
  let skipped = 0;
  for (const { msgIndex, leaf } of s.leaves ?? []) {
    const m = chat[msgIndex];
    if (!m || m.is_user) {
      skipped++;
      continue;
    }
    (m.extra ??= {}).bbs_leaf = JSON.parse(JSON.stringify(leaf));
  }
  memory.summaries = JSON.parse(JSON.stringify(Array.isArray(s.summaries) ? s.summaries : []));
  if (s.varsTemplate && typeof s.varsTemplate === 'object') memory.varTemplates.chat = JSON.parse(JSON.stringify(s.varsTemplate));
  recomputeDerived();
  saveMemory();
  scheduleLeafFlush();
  replaceAnchors(Array.isArray(s.anchors) ? s.anchors : []);
  replaceExternal(Array.isArray(s.external) ? s.external : []);
  refreshInjection();
  return { skippedLeaves: skipped };
}

export function restoreFromPoint(id: string): { ok: boolean; skippedLeaves: number } {
  const p = restoreState.points.find(x => x.id === id);
  if (!p) return { ok: false, skippedLeaves: 0 };
  const r = applySnapshot(p.snapshot);
  return { ok: true, skippedLeaves: r.skippedLeaves };
}

/** 校验导入的快照 JSON 是否形如 MemorySnapshot */
export function parseSnapshot(raw: unknown): MemorySnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.summaries) || !Array.isArray(o.leaves)) return null;
  return {
    snapshotVersion: Number(o.snapshotVersion ?? 1),
    createdAt: Number(o.createdAt ?? 0),
    pluginVersion: String(o.pluginVersion ?? ''),
    chatId: String(o.chatId ?? ''),
    charName: String(o.charName ?? ''),
    floors: Number(o.floors ?? 0),
    summaries: o.summaries as MemSummary[],
    leaves: (o.leaves as Array<{ msgIndex: number; leaf: LeafExtra }>).filter(l => l && typeof l.msgIndex === 'number' && l.leaf),
    varsTemplate: (o.varsTemplate as VarTemplate) ?? { json: {}, meaning: '', rule: '' },
    anchors: Array.isArray(o.anchors) ? (o.anchors as AnchorEntry[]) : [],
    external: Array.isArray(o.external) ? (o.external as ExternalNote[]) : [],
  };
}

/* ======================= 回收站恢复 ======================= */

/**
 * 把回收站条目放回原处。按 kind 分派:
 *  - summary:放回森林(若其子节点仍在,会自动重新收纳它们);
 *  - subtree:一次性放回若干总结节点 + 若干叶子;
 *  - leaf:回写到原楼层(该楼层仍存在且没有新叶子时);
 *  - anchor / external / plan:追加回各自列表。
 */
export function restoreTrashEntry(id: string): { ok: boolean; message: string } {
  const item = trashState.items.find(i => i.id === id);
  if (!item) return { ok: false, message: '回收站里没有这条记录' };
  const r = applyTrashPayload(item);
  if (r.ok) {
    trashRemove(id);
    refreshInjection();
  }
  return r;
}

function restoreSummaries(list: MemSummary[]): number {
  let n = 0;
  for (const s of list) {
    if (!s || typeof s.id !== 'string') continue;
    if (memory.summaries.some(x => x.id === s.id)) continue;
    memory.summaries.push(JSON.parse(JSON.stringify(s)));
    n++;
  }
  return n;
}

function restoreLeaves(list: Array<{ msgIndex: number; leaf: LeafExtra }>): { ok: number; skipped: number } {
  const chat = getContext()?.chat ?? [];
  let ok = 0;
  let skipped = 0;
  for (const { msgIndex, leaf } of list) {
    const m = chat[msgIndex];
    if (!m || m.is_user || getLeaf(m)) {
      skipped++;
      continue;
    }
    (m.extra ??= {}).bbs_leaf = JSON.parse(JSON.stringify(leaf));
    ok++;
  }
  return { ok, skipped };
}

function applyTrashPayload(item: TrashEntry): { ok: boolean; message: string } {
  const p = item.payload as Record<string, unknown> | null;
  if (!p) return { ok: false, message: '条目没有可恢复的数据' };
  switch (item.kind) {
    case 'summary': {
      const n = restoreSummaries([p as unknown as MemSummary]);
      if (n) {
        saveMemory();
        return { ok: true, message: '总结节点已放回' };
      }
      return { ok: false, message: '森林里已有同 id 的节点' };
    }
    case 'subtree': {
      const sums = restoreSummaries(Array.isArray(p.summaries) ? (p.summaries as MemSummary[]) : []);
      const lv = restoreLeaves(Array.isArray(p.leaves) ? (p.leaves as Array<{ msgIndex: number; leaf: LeafExtra }>) : []);
      recomputeDerived();
      saveMemory();
      scheduleLeafFlush();
      return { ok: true, message: `已放回 ${sums} 个总结节点、${lv.ok} 条叶子${lv.skipped ? `(${lv.skipped} 条叶子因楼层已变跳过)` : ''}` };
    }
    case 'leaf': {
      const lv = restoreLeaves([p as unknown as { msgIndex: number; leaf: LeafExtra }]);
      if (!lv.ok) return { ok: false, message: '原楼层不存在或已有新摘要,无法放回' };
      recomputeDerived();
      saveMemory();
      scheduleLeafFlush();
      return { ok: true, message: '叶子摘要已放回' };
    }
    case 'anchor': {
      const a = p as unknown as AnchorEntry;
      if (anchorState.anchors.some(x => x.id === a.id)) return { ok: false, message: '已存在同 id 的锚点' };
      replaceAnchors([...anchorState.anchors, a].sort((x, y) => x.version - y.version));
      return { ok: true, message: `锚点日记 第${a.version}版 已放回` };
    }
    case 'external': {
      const n = p as unknown as ExternalNote;
      if (externalState.notes.some(x => x.id === n.id && x.source === n.source)) return { ok: false, message: '已存在同 id 的外部记录' };
      replaceExternal([...externalState.notes, n]);
      return { ok: true, message: '外部记录已放回' };
    }
    default:
      return { ok: false, message: `暂不支持恢复类型:${item.kind}` };
  }
}
