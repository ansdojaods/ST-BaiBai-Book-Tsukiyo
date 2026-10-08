/**
 * 回收站(融合版新增;思路来自白鸟数据的 trash/restore,本地化实现)。
 *
 * 柏宝书原版删除摘要/锚点是即时且不可逆的。这里在删除前把对象丢进
 * chatMetadata['baibai_book_trash'],用户可在「联动·备份」页一键恢复;
 * 条数超过设置上限时淘汰最旧的。
 */
import { reactive } from 'vue';
import { getContext } from '@/st/context';
import { apiSettings } from '@/api/settings';

export const TRASH_META_KEY = 'baibai_book_trash';

export type TrashKind = 'summary' | 'subtree' | 'leaf' | 'anchor' | 'external' | 'plan';

export interface TrashEntry {
  id: string;
  kind: TrashKind;
  title: string;
  deletedAt: number;
  /** 被删对象的深拷贝;结构由 kind 决定(见 restoreTrashEntry) */
  payload: unknown;
}

export const trashState = reactive<{ items: TrashEntry[]; rev: number }>({ items: [], rev: 0 });

let seq = 0;

/** 每次变更递增 rev,供界面感知回收站变化 */
function notify(): void {
  trashState.rev += 1;
}

export function loadTrash(): void {
  const meta = getContext()?.chatMetadata as Record<string, unknown> | undefined;
  const raw = meta?.[TRASH_META_KEY] as { items?: unknown[] } | undefined;
  const items: TrashEntry[] = [];
  for (const x of Array.isArray(raw?.items) ? raw!.items : []) {
    const o = x as Partial<TrashEntry>;
    if (!o || typeof o !== 'object' || typeof o.id !== 'string' || typeof o.kind !== 'string') continue;
    items.push({
      id: o.id,
      kind: o.kind as TrashKind,
      title: String(o.title ?? ''),
      deletedAt: typeof o.deletedAt === 'number' ? o.deletedAt : 0,
      payload: o.payload,
    });
  }
  trashState.items = items;
  trashState.rev += 1;
}

function save(): void {
  const ctx = getContext();
  if (!ctx?.chatMetadata) return;
  (ctx.chatMetadata as Record<string, unknown>)[TRASH_META_KEY] = {
    version: 1,
    items: JSON.parse(JSON.stringify(trashState.items)),
  };
  ctx.saveMetadataDebounced?.();
  notify();
}

export function trashPush(entry: { kind: TrashKind; title: string; payload: unknown }): TrashEntry {
  seq += 1;
  const item: TrashEntry = {
    id: `tr_${Date.now().toString(36)}_${seq}`,
    kind: entry.kind,
    title: entry.title.slice(0, 120),
    deletedAt: Date.now(),
    payload: entry.payload,
  };
  trashState.items.unshift(item);
  const keep = Math.max(5, apiSettings.backend?.trashKeep ?? 30);
  if (trashState.items.length > keep) trashState.items.length = keep;
  save();
  return item;
}

export function trashRemove(id: string): TrashEntry | null {
  const idx = trashState.items.findIndex(i => i.id === id);
  if (idx < 0) return null;
  const [removed] = trashState.items.splice(idx, 1);
  save();
  return removed;
}

export function trashClear(): void {
  if (!trashState.items.length) return;
  trashState.items = [];
  save();
}
