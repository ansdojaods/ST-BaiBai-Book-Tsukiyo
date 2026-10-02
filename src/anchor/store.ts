/**
 * 锚点日记:数据层(融合版新增)。
 *
 * 存储:chatMetadata['baibai_book_anchor'] = { version: 1, anchors: AnchorEntry[] }
 *  - 每次生成/粘贴一份锚点就追加一个版本,不覆盖旧版 → 可以回看、可以"排除"某一版回退到上一版;
 *  - 当前生效锚点 = 最新一条未被排除的版本;
 *  - 删除走回收站(backend/trash),误删可恢复。
 *
 * 不依赖额外服务端插件；随当前聊天保存。
 */
import { reactive } from 'vue';
import { getContext } from '@/st/context';
import { apiSettings } from '@/api/settings';
import { identifyMessage } from '@/st/session';
import { ANCHOR_INJECT_HEAD, ANCHOR_INJECT_TAIL, RE_ANCHOR_BLOCK } from './prompts';

export const ANCHOR_META_KEY = 'baibai_book_anchor';
const STORE_VERSION = 1;
/** 为防 metadata 膨胀,每聊天最多保留的版本数(超出删最旧的「已排除」版本,再删最旧版本) */
const MAX_VERSIONS = 40;

export type AnchorSource = 'chat' | 'api' | 'manual';

export interface AnchorEntry {
  id: string;
  /** 锚点正文(不含 <anchor> 标签) */
  text: string;
  createdAt: number;
  /** 锚点覆盖到的截止楼层(含);-1=未知 */
  floor: number;
  /** 第几版(单调递增) */
  version: number;
  /** 来源:正文解析 / 副 API 静默生成 / 手动粘贴 */
  source: AnchorSource;
  /** 被用户排除(不再生效,回退到上一版) */
  excluded: boolean;
  /** 用户备注 */
  note?: string;
  origin?: { messageId: string; swipe: number; block: string };
}

interface AnchorStoreData {
  version: number;
  anchors: AnchorEntry[];
}

export const anchorState = reactive<{ anchors: AnchorEntry[]; rev: number; busy: boolean; lastError: string }>({
  anchors: [],
  rev: 0,
  busy: false,
  lastError: '',
});

let seq = 0;
function newId(): string {
  seq += 1;
  return `anc_${Date.now().toString(36)}_${seq}`;
}

function sanitizeEntry(raw: unknown): AnchorEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== 'string' || !r.text.trim()) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newId(),
    text: r.text,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    floor: typeof r.floor === 'number' && Number.isFinite(r.floor) ? Math.floor(r.floor) : -1,
    version: typeof r.version === 'number' && Number.isFinite(r.version) ? Math.floor(r.version) : 1,
    source: r.source === 'api' || r.source === 'manual' ? r.source : 'chat',
    excluded: !!r.excluded,
    origin: r.origin && typeof r.origin === 'object' && typeof (r.origin as AnchorEntry['origin'])?.messageId === 'string' ? r.origin as AnchorEntry['origin'] : undefined,
    note: typeof r.note === 'string' && r.note ? r.note : undefined,
  };
}

/** 从当前聊天 metadata 读入(CHAT_CHANGED 时调用) */
export function loadAnchors(): void {
  const ctx = getContext();
  const meta = ctx?.chatMetadata as Record<string, unknown> | undefined;
  const raw = meta?.[ANCHOR_META_KEY] as Partial<AnchorStoreData> | undefined;
  const list = Array.isArray(raw?.anchors) ? raw!.anchors.map(sanitizeEntry).filter((x): x is AnchorEntry => !!x) : [];
  list.sort((a, b) => a.version - b.version || a.createdAt - b.createdAt);
  anchorState.anchors = list;
  anchorState.rev += 1;
  anchorState.lastError = '';
}

export function saveAnchors(): void {
  const ctx = getContext();
  if (!ctx?.chatMetadata) return;
  const data: AnchorStoreData = {
    version: STORE_VERSION,
    anchors: JSON.parse(JSON.stringify(anchorState.anchors)),
  };
  (ctx.chatMetadata as Record<string, unknown>)[ANCHOR_META_KEY] = data;
  ctx.saveMetadataDebounced?.();
  anchorState.rev += 1;
}

/** 当前生效的锚点(最新且未排除) */
export function currentAnchor(): AnchorEntry | null {
  for (let i = anchorState.anchors.length - 1; i >= 0; i--) {
    const a = anchorState.anchors[i];
    if (!a.excluded && anchorSourceCurrent(a)) return a;
  }
  return null;
}

/** 正文来源只在原消息的原 swipe、原锚点块仍存在时生效；版本保留供回看。 */
export function anchorSourceCurrent(a: AnchorEntry): boolean {
  if (a.source !== 'chat') return true;
  const chat = getContext()?.chat ?? [];
  const candidates = chat.filter(m => a.origin ? m.extra?.bbs_message_id === a.origin.messageId : (m.extra?.bbs_anchor as { id?: string } | undefined)?.id === a.id);
  if (candidates.length !== 1) return false;
  const m = candidates[0];
  if (m.is_user || (a.origin && (m.swipe_id ?? 0) !== a.origin.swipe)) return false;
  const matches = [...String(m.mes ?? '').matchAll(new RegExp(RE_ANCHOR_BLOCK.source, 'gi'))];
  return (matches.at(-1)?.[1] ?? '').trim() === (a.origin?.block ?? a.text);
}

export function nextVersion(): number {
  let v = 0;
  for (const a of anchorState.anchors) v = Math.max(v, a.version);
  return v + 1;
}

/** 追加一版锚点并落盘;返回新条目 */
export function addAnchor(text: string, floor: number, source: AnchorSource, note?: string): AnchorEntry {
  const entry: AnchorEntry = {
    id: newId(),
    text: text.trim(),
    createdAt: Date.now(),
    floor: Number.isFinite(floor) ? Math.floor(floor) : -1,
    version: nextVersion(),
    source,
    excluded: false,
    note,
  };
  const msg = getContext()?.chat?.[floor];
  if (source === 'chat' && msg) {
    const identity = identifyMessage(msg);
    entry.origin = { messageId: identity.id, swipe: identity.swipe, block: text.trim() };
  }
  anchorState.anchors.push(entry);
  trimVersions();
  saveAnchors();
  return entry;
}

function trimVersions(): void {
  while (anchorState.anchors.length > MAX_VERSIONS) {
    const idx = anchorState.anchors.findIndex(a => a.excluded);
    anchorState.anchors.splice(idx >= 0 ? idx : 0, 1);
  }
}

export function setAnchorExcluded(id: string, excluded: boolean): boolean {
  const a = anchorState.anchors.find(x => x.id === id);
  if (!a) return false;
  a.excluded = excluded;
  saveAnchors();
  return true;
}

export function updateAnchorText(id: string, text: string, note?: string): boolean {
  const a = anchorState.anchors.find(x => x.id === id);
  if (!a) return false;
  a.text = text.trim();
  if (note !== undefined) a.note = note || undefined;
  saveAnchors();
  return true;
}

/** 从列表移除(调用方负责先丢进回收站);返回被移除的条目 */
export function removeAnchor(id: string): AnchorEntry | null {
  const idx = anchorState.anchors.findIndex(x => x.id === id);
  if (idx < 0) return null;
  const [removed] = anchorState.anchors.splice(idx, 1);
  saveAnchors();
  return removed;
}

/** 整体替换(恢复点/后端恢复用) */
export function replaceAnchors(list: AnchorEntry[]): void {
  anchorState.anchors = list.map(sanitizeEntry).filter((x): x is AnchorEntry => !!x);
  saveAnchors();
}

/** 导出用:纯数据快照 */
export function anchorsSnapshot(): AnchorEntry[] {
  return JSON.parse(JSON.stringify(anchorState.anchors));
}

/**
 * 当前锚点的注入文本;无生效锚点或功能关闭返回空串。
 * 超出 maxChars 时从末尾截断(锚点前几节是关系/人物等稳定信息,更值得保留)。
 */
export function buildAnchorInjectionText(): string {
  const s = apiSettings.anchor;
  if (!s?.enabled) return '';
  const a = currentAnchor();
  if (!a) return '';
  let text = a.text.trim();
  if (text.length > s.maxChars) text = `${text.slice(0, s.maxChars)}\n…(锚点过长,已截断)`;
  const head = ANCHOR_INJECT_HEAD.replace('{{version}}', String(a.version)).replace(
    '{{floor}}',
    a.floor >= 0 ? String(a.floor) : '?',
  );
  return `${head}\n${text}\n${ANCHOR_INJECT_TAIL}`;
}
