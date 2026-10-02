/**
 * 外部记录(融合版新增):小手机等外部脚本推送进柏宝书的"正文之外发生的事"。
 *
 * 典型内容:手机私聊/群聊的要点、手机里许下的约定、朋友圈动态、日程提醒。
 * 它们不在聊天正文里,柏宝书原版的摘要链路看不到;融合版把它们:
 *  1. 存进 chatMetadata['baibai_book_external'](随聊天保存、随聊天切换);
 *  2. 按字符预算注入主模型(slot: baibai_book_external),让正文角色"记得手机里聊过什么";
 *  3. 作为摘要/总结的附加材料(engine 组装消息时追加一条 system),让摘要也覆盖手机事件。
 *
 * 写入口只有一个:pushExternalNotes(source, notes) —— 同 id 覆盖、按来源限量、置顶优先。
 */
import { reactive } from 'vue';
import { getContext } from '@/st/context';
import { apiSettings } from '@/api/settings';

export const EXTERNAL_META_KEY = 'baibai_book_external';
/** 每个来源最多保留的条数(超出淘汰最旧的非置顶条目) */
const MAX_PER_SOURCE = 200;

export interface ExternalNote {
  /** 调用方给的稳定 id(同 id 再推即覆盖) */
  id: string;
  /** 来源标识,如 'tsukiyo-phone' */
  source: string;
  /** 类别:phone_chat / phone_promise / phone_moment / agenda / fact / 其它自定义 */
  kind: string;
  title?: string;
  text: string;
  /** 故事内时间(可选,原样展示) */
  time?: string;
  /** 关联的聊天楼层(可选;用于把记录归入对应楼层的摘要材料) */
  floor?: number;
  /** 推送时间戳 */
  ts: number;
  /** 置顶:注入时优先且不受"最新 N 条"限制 */
  pinned?: boolean;
}

export interface ExternalNoteInput {
  id?: string;
  kind?: string;
  title?: string;
  text: string;
  time?: string;
  floor?: number;
  pinned?: boolean;
}

export const externalState = reactive<{ notes: ExternalNote[]; rev: number; lastPushAt: number; lastSource: string }>({
  notes: [],
  rev: 0,
  lastPushAt: 0,
  lastSource: '',
});

const listeners = new Set<(info: { source: string; added: number; updated: number }) => void>();
export function onExternalChanged(cb: (info: { source: string; added: number; updated: number }) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function sanitize(raw: unknown): ExternalNote | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== 'string' || !r.text.trim() || typeof r.id !== 'string' || !r.id) return null;
  return {
    id: r.id,
    source: typeof r.source === 'string' && r.source ? r.source : 'external',
    kind: typeof r.kind === 'string' && r.kind ? r.kind : 'fact',
    title: typeof r.title === 'string' && r.title ? r.title.slice(0, 120) : undefined,
    text: r.text.slice(0, 4000),
    time: typeof r.time === 'string' && r.time ? r.time.slice(0, 80) : undefined,
    floor: typeof r.floor === 'number' && Number.isFinite(r.floor) ? Math.floor(r.floor) : undefined,
    ts: typeof r.ts === 'number' ? r.ts : Date.now(),
    pinned: r.pinned ? true : undefined,
  };
}

export function loadExternal(): void {
  const meta = getContext()?.chatMetadata as Record<string, unknown> | undefined;
  const raw = meta?.[EXTERNAL_META_KEY] as { notes?: unknown[] } | undefined;
  externalState.notes = (Array.isArray(raw?.notes) ? raw!.notes : []).map(sanitize).filter((x): x is ExternalNote => !!x);
  externalState.rev += 1;
}

export function saveExternal(): void {
  const ctx = getContext();
  if (!ctx?.chatMetadata) return;
  (ctx.chatMetadata as Record<string, unknown>)[EXTERNAL_META_KEY] = {
    version: 1,
    notes: JSON.parse(JSON.stringify(externalState.notes)),
  };
  ctx.saveMetadataDebounced?.();
  externalState.rev += 1;
}

let seq = 0;
/**
 * 推送/更新一批外部记录。返回 {added, updated, total}。
 * - 同 (source,id) 覆盖;没给 id 的按 kind+text 哈希生成,避免重复推送造成重复条目;
 * - 每来源上限 MAX_PER_SOURCE,超出淘汰最旧的非置顶条目。
 */
export function pushExternalNotes(source: string, notes: ExternalNoteInput[], opts: { replace?: boolean } = {}): { added: number; updated: number; total: number } {
  const src = String(source || 'external').slice(0, 40);
  if (opts.replace) externalState.notes = externalState.notes.filter(n => n.source !== src);
  let added = 0;
  let updated = 0;
  const byId = new Map(externalState.notes.filter(n => n.source === src).map(n => [n.id, n]));
  for (const input of Array.isArray(notes) ? notes : []) {
    if (!input || typeof input.text !== 'string' || !input.text.trim()) continue;
    const id = input.id && typeof input.id === 'string' ? input.id.slice(0, 80) : `auto_${hashText(`${input.kind ?? ''}|${input.text}`)}`;
    const note = sanitize({ ...input, id, source: src, ts: Date.now() });
    if (!note) continue;
    const prev = byId.get(id);
    if (prev) {
      Object.assign(prev, note, { ts: prev.ts === note.ts ? prev.ts : Date.now() });
      updated++;
    } else {
      externalState.notes.push(note);
      byId.set(id, note);
      added++;
    }
  }
  // 限量:同源超出时淘汰最旧非置顶
  const mine = externalState.notes.filter(n => n.source === src);
  if (mine.length > MAX_PER_SOURCE) {
    const removable = mine.filter(n => !n.pinned).sort((a, b) => a.ts - b.ts);
    const drop = new Set(removable.slice(0, mine.length - MAX_PER_SOURCE).map(n => n.id));
    externalState.notes = externalState.notes.filter(n => !(n.source === src && drop.has(n.id)));
  }
  externalState.lastPushAt = Date.now();
  externalState.lastSource = src;
  seq += 1;
  saveExternal();
  for (const cb of listeners) {
    try {
      cb({ source: src, added, updated });
    } catch (e) {
      console.warn('[柏宝书] 外部记录订阅者异常', e);
    }
  }
  return { added, updated, total: externalState.notes.length };
}

export function removeExternalNote(id: string): ExternalNote | null {
  const idx = externalState.notes.findIndex(n => n.id === id);
  if (idx < 0) return null;
  const [removed] = externalState.notes.splice(idx, 1);
  saveExternal();
  return removed;
}

export function clearExternal(source?: string): number {
  const before = externalState.notes.length;
  externalState.notes = source ? externalState.notes.filter(n => n.source !== source) : [];
  saveExternal();
  return before - externalState.notes.length;
}

export function setExternalPinned(id: string, pinned: boolean): void {
  const n = externalState.notes.find(x => x.id === id);
  if (!n) return;
  n.pinned = pinned || undefined;
  saveExternal();
}

export function replaceExternal(notes: ExternalNote[]): void {
  externalState.notes = notes.map(sanitize).filter((x): x is ExternalNote => !!x);
  saveExternal();
}

export function externalSnapshot(): ExternalNote[] {
  return JSON.parse(JSON.stringify(externalState.notes));
}

function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const SOURCE_LABEL: Record<string, string> = {
  'tsukiyo-phone': '小手机',
};
const KIND_LABEL: Record<string, string> = {
  phone_chat: '手机聊天',
  phone_promise: '手机约定',
  phone_moment: '朋友圈',
  agenda: '日程',
  fact: '事实',
};

function fmtNote(n: ExternalNote): string {
  const kind = KIND_LABEL[n.kind] ?? n.kind;
  const head = [n.time ? `[${n.time}]` : '', `(${kind})`, n.title ? `${n.title}:` : ''].filter(Boolean).join(' ');
  return `- ${head} ${n.text.replace(/\s*\n\s*/g, ' ')}`.trim();
}

/** 按预算挑选:置顶优先,其余按时间倒序(最新优先),输出时再按时间正序 */
export function selectExternalNotes(maxChars: number, filter?: (n: ExternalNote) => boolean): ExternalNote[] {
  const pool = filter ? externalState.notes.filter(filter) : externalState.notes.slice();
  const pinned = pool.filter(n => n.pinned).sort((a, b) => b.ts - a.ts);
  const rest = pool.filter(n => !n.pinned).sort((a, b) => b.ts - a.ts);
  const chosen: ExternalNote[] = [];
  let used = 0;
  for (const n of [...pinned, ...rest]) {
    const len = fmtNote(n).length + 1;
    if (used + len > maxChars && chosen.length) break;
    chosen.push(n);
    used += len;
  }
  return chosen.sort((a, b) => a.ts - b.ts);
}

/** 注入主模型的文本;关闭/无记录返回 '' */
export function buildExternalInjectionText(): string {
  const s = apiSettings.phoneBridge;
  if (!s?.enabled || !s.injectExternal) return '';
  const chosen = selectExternalNotes(s.externalMaxChars);
  if (!chosen.length) return '';
  const groups = new Map<string, ExternalNote[]>();
  for (const n of chosen) {
    const k = n.source;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(n);
  }
  const body = [...groups.entries()]
    .map(([src, list]) => `【${SOURCE_LABEL[src] ?? src}】\n${list.map(fmtNote).join('\n')}`)
    .join('\n');
  return `[正文之外的记录]\n以下事情发生在正文之外(例如手机聊天、约定与动态),角色知道这些事,请在合适时自然体现,不要原样复述、不要提及这份清单:\n${body}\n[正文之外的记录结束]`;
}

/**
 * 摘要材料:给定楼层范围 (from, to],挑出关联楼层落在范围内或没有楼层信息且推送时间较新的记录。
 * 返回 '' 表示没有可用材料。
 */
export function buildExternalSummaryMaterial(fromFloor: number, toFloor: number, maxChars = 1500): string {
  const s = apiSettings.phoneBridge;
  if (!s?.enabled || !s.includeInSummary) return '';
  const chosen = selectExternalNotes(maxChars, n => {
    if (typeof n.floor === 'number') return n.floor > fromFloor && n.floor <= toFloor;
    return true;
  });
  if (!chosen.length) return '';
  return `[外部记录(手机等渠道,发生在正文之外,但属于同一故事;可作为摘要/状态更新的依据)]\n${chosen.map(fmtNote).join('\n')}`;
}
