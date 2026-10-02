import { captureSession, assertSession, identifyMessage, matchesMessage, type MessageIdentity } from '@/st/session';
import { validSnapshot, validLeaf, validSummary, validIdentity, validAnchor, validExternal, safeJson } from './schema';
import { BUNDLES_META_KEY, currentBundleHashes } from '@/memory/vector/scope';
import { invalidateRecallCache } from '@/memory/vector/cache';
import { scheduleVectorIndex } from '@/memory/vector';
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
import { getLeaf, deriveMemory } from '@/memory/apply';
import { refreshInjection } from '@/memory/inject';
import type { LeafExtra, MemSummary, VarTemplate } from '@/memory/types';
import { anchorsSnapshot, replaceAnchors, anchorState, type AnchorEntry } from '@/anchor/store';
import { externalSnapshot, replaceExternal, externalState, type ExternalNote } from '@/bridge/external';
import { trashRemove, trashState, type TrashEntry } from './trash';

export const RESTORE_META_KEY = 'baibai_book_restore';
export const SNAPSHOT_VERSION = 2;

export interface MemorySnapshot {
  snapshotVersion: number;
  createdAt: number;
  pluginVersion: string;
  chatId: string;
  owner: string;
  messages: MessageIdentity[];
  bundles: string[];
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
    // 旧版点只保留供导出/人工核对，不把缺失字段交给 UI 或恢复器。
    const snap = p.snapshot;
    if (!safeJson(snap) || !Array.isArray(snap.summaries) || !Array.isArray(snap.leaves) || !Array.isArray(snap.anchors) || !Number.isSafeInteger(snap.floors)) continue;
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
  scheduleLeafFlush(); // 持久化消息身份，与聊天一起保存
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    createdAt: Date.now(),
    pluginVersion,
    owner: captureSession().key,
    messages: chat.map(identifyMessage),
    bundles: [...currentBundleHashes()],
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
  return !s.summaries.length && !s.leaves.length && !s.anchors.length && !s.external.length && !s.bundles?.length && !Object.keys(s.varsTemplate?.json ?? {}).length && !s.varsTemplate?.meaning && !s.varsTemplate?.rule;
}

/** 建恢复点;空状态不建。返回新恢复点或 null */
export function createRestorePoint(reason: string): RestorePoint | null {
  const snapshot = buildSnapshot();
  if (snapshotIsEmpty(snapshot)) return null;
  seq += 1;
  const point: RestorePoint = { id: `rp_${Date.now().toString(36)}_${seq}`, createdAt: Date.now(), reason: reason.slice(0, 80), snapshot };
  const keep = Math.max(1, apiSettings.backend?.restorePoints ?? 3);
  restoreState.points = [point, ...restoreState.points].slice(0, keep);
  const budget = 8 * 1024 * 1024;
  while (restoreState.points.length > 1 && new TextEncoder().encode(JSON.stringify(restoreState.points)).length > budget) restoreState.points = restoreState.points.slice(0, -1);
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
 * v2 对同一聊天的全部原始消息前缀验证 ID/正文指纹/swipe；发生冲突整份拒绝，不按下标猜测。
 * 应用前会自动再建一个"恢复前"的恢复点,保证可反悔。
 */
export function applySnapshot(input: MemorySnapshot, opts: { makePoint?: boolean } = {}): { skippedLeaves: number } {
  const s = parseSnapshot(input);
  if (!s) throw new Error('快照版本或结构不受支持（需 v2 身份快照）；原数据未修改');
  const ctx = getContext();
  const session = captureSession();
  const chat = ctx?.chat;
  if (!ctx?.chatMetadata || !chat || s.chatId !== String(ctx.getCurrentChatId?.() ?? '') || s.owner !== session.key) throw new Error('快照不属于当前角色/聊天，禁止按楼层覆盖');
  if (chat.length < s.floors || s.messages.some((identity, i) => !matchesMessage(chat[i], identity))) throw new Error('聊天正文、楼序或 swipe 与快照不一致；为防错位已取消整份恢复。请先还原对应的聊天正文');
  const staged = JSON.parse(JSON.stringify(chat)) as typeof chat;
  for (const m of staged) if (m.extra) delete m.extra.bbs_leaf;
  for (const { msgIndex, leaf } of s.leaves) {
    if (staged[msgIndex].is_user) throw new Error('快照叶子指向用户楼，已拒绝恢复');
    (staged[msgIndex].extra ??= {}).bbs_leaf = leaf;
  }
  // 用目标模板在副本完整重放；校验/重放失败前绝不清理当前叶子或 metadata。
  deriveMemory(staged, undefined, { ...memory.varTemplates, chat: s.varsTemplate });
  assertSession(session);
  if (opts.makePoint !== false) createRestorePoint('恢复前自动保存');
  assertSession(session);
  flushLeavesNow();
  for (const m of chat) if (m.extra) delete m.extra.bbs_leaf;
  for (const { msgIndex, leaf } of s.leaves) (chat[msgIndex].extra ??= {}).bbs_leaf = leaf;
  memory.summaries = s.summaries;
  memory.varTemplates.chat = s.varsTemplate;
  (ctx.chatMetadata as Record<string, unknown>)[BUNDLES_META_KEY] = s.bundles;
  recomputeDerived();
  saveMemory();
  scheduleLeafFlush();
  replaceAnchors(s.anchors);
  replaceExternal(s.external);
  invalidateRecallCache();
  scheduleVectorIndex();
  refreshInjection();
  return { skippedLeaves: 0 };
}

export function restoreFromPoint(id: string): { ok: boolean; skippedLeaves: number } {
  const p = restoreState.points.find(x => x.id === id);
  if (!p || !safeJson(p)) return { ok: false, skippedLeaves: 0 };
  const r = applySnapshot(p.snapshot);
  return { ok: true, skippedLeaves: r.skippedLeaves };
}

/** 校验导入的快照 JSON 是否形如 MemorySnapshot */
export function parseSnapshot(raw: unknown): MemorySnapshot | null {
  try { return validSnapshot(raw) ? JSON.parse(JSON.stringify(raw)) as MemorySnapshot : null; }
  catch { return null; }
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
  let r: { ok: boolean; message: string };
  try { r = applyTrashPayload(item); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
  if (r.ok) {
    trashRemove(id);
    invalidateRecallCache();
    scheduleVectorIndex();
    refreshInjection();
  }
  return r;
}

interface TrashLeaf { msgIndex: number; identity?: MessageIdentity; leaf: LeafExtra }
function planTrashLeaves(list: TrashLeaf[]): Array<{ index: number; leaf: LeafExtra }> {
  const chat = getContext()?.chat ?? [];
  const plan: Array<{ index: number; leaf: LeafExtra }> = [];
  const ids = new Set<string>();
  for (const x of list) {
    if (!x || !validLeaf(x.leaf) || !validIdentity(x.identity)) throw new Error('旧回收条目缺少消息身份或结构不合法，不能安全恢复');
    const matches = chat.map((m, index) => ({ m, index })).filter(({ m }) => matchesMessage(m, x.identity));
    if (matches.length !== 1 || matches[0].m.is_user || getLeaf(matches[0].m) || ids.has(x.identity!.id)) throw new Error('原消息已删除、修改、切换 swipe 或已有摘要；条目已保留在回收站');
    ids.add(x.identity!.id);
    plan.push({ index: matches[0].index, leaf: JSON.parse(JSON.stringify(x.leaf)) });
  }
  return plan;
}
function commitTrashLeaves(plan: Array<{ index: number; leaf: LeafExtra }>): void {
  const chat = getContext()!.chat;
  for (const x of plan) (chat[x.index].extra ??= {}).bbs_leaf = x.leaf;
}
function assertForest(summaries: MemSummary[], additions: Array<{ index: number; leaf: LeafExtra }> = []): void {
  if (!summaries.every(validSummary)) throw new Error('回收站总结结构不合法');
  const ids = new Map<string, number>();
  for (const m of getContext()?.chat ?? []) { const leaf = getLeaf(m); if (leaf) ids.set(leaf.id, 0); }
  for (const x of additions) { if (ids.has(x.leaf.id)) throw new Error('叶子 ID 冲突'); ids.set(x.leaf.id, 0); }
  for (const x of summaries) { if (ids.has(x.id)) throw new Error('总结 ID 冲突'); ids.set(x.id, x.level); }
  const parents = new Set<string>();
  for (const x of summaries) for (const id of x.childIds) {
    if (!ids.has(id) || ids.get(id)! >= x.level || parents.has(id)) throw new Error('依赖节点缺失或父子关系冲突，请先恢复依赖');
    parents.add(id);
  }
}

function applyTrashPayload(item: TrashEntry): { ok: boolean; message: string } {
  const p = item.payload as Record<string, unknown> | null;
  if (!p || !safeJson(p)) return { ok: false, message: '条目没有可恢复的数据' };
  switch (item.kind) {
    case 'summary': {
      const node = (p.node ?? p) as unknown as MemSummary;
      if (!validSummary(node) || memory.summaries.some(x => x.id === node.id)) return { ok: false, message: '总结结构不合法或同 ID 节点已存在' };
      const proposed: MemSummary[] = JSON.parse(JSON.stringify([...memory.summaries, node]));
      for (const edge of Array.isArray(p.parents) ? p.parents : []) {
        if (!edge || typeof edge.id !== 'string' || !Number.isInteger(edge.index) || !Array.isArray(edge.expected)) throw new Error('父边数据损坏');
        const parent = proposed.find(x => x.id === edge.id);
        if (!parent || JSON.stringify(parent.childIds) !== JSON.stringify(edge.expected)) throw new Error('父总结已变更；条目保留，请先恢复父节点或使用完整恢复点');
        parent.childIds.splice(edge.index, 0, node.id);
      }
      assertForest(proposed);
      memory.summaries = proposed;
      saveMemory();
      return { ok: true, message: p.node ? '总结及原父子关系已恢复' : '旧格式总结已恢复（旧条目没有父边信息）' };
    }
    case 'subtree': {
      if (!Array.isArray(p.summaries) || !Array.isArray(p.leaves)) throw new Error('子树结构不合法');
      const plan = planTrashLeaves(p.leaves as TrashLeaf[]);
      const proposed = [...memory.summaries, ...p.summaries] as MemSummary[];
      assertForest(proposed, plan);
      commitTrashLeaves(plan);
      memory.summaries = JSON.parse(JSON.stringify(proposed));
      recomputeDerived(); saveMemory(); scheduleLeafFlush();
      return { ok: true, message: `已完整恢复 ${p.summaries.length} 个总结、${plan.length} 条叶子` };
    }
    case 'leaf': {
      const plan = planTrashLeaves([p as unknown as TrashLeaf]);
      if (p.summaries !== undefined && !Array.isArray(p.summaries)) throw new Error('祖先总结结构不合法');
      const proposed = [...memory.summaries, ...((p.summaries as MemSummary[] | undefined) ?? [])];
      assertForest(proposed, plan);
      commitTrashLeaves(plan);
      memory.summaries = JSON.parse(JSON.stringify(proposed));
      recomputeDerived(); saveMemory(); scheduleLeafFlush();
      return { ok: true, message: '叶子已恢复到身份匹配的原消息' };
    }
    case 'anchor': {
      if (!validAnchor(p)) throw new Error('锚点结构不合法');
      const a = p as unknown as AnchorEntry;
      if (anchorState.anchors.some(x => x.id === a.id)) return { ok: false, message: '已存在同 id 的锚点' };
      replaceAnchors([...anchorState.anchors, a].sort((x, y) => x.version - y.version));
      return { ok: true, message: `锚点日记 第${a.version}版 已放回` };
    }
    case 'external': {
      if (!validExternal(p)) throw new Error('外部记录结构不合法');
      const n = p as unknown as ExternalNote;
      if (externalState.notes.some(x => x.id === n.id && x.source === n.source)) return { ok: false, message: '已存在同 id 的外部记录' };
      replaceExternal([...externalState.notes, n]);
      return { ok: true, message: '外部记录已放回' };
    }
    default:
      return { ok: false, message: `暂不支持恢复类型:${item.kind}` };
  }
}
