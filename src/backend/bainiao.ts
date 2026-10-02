/**
 * 白鸟数据(ST-BaiNiaoData)服务端插件的前端适配层(融合版新增)。
 *
 * 柏宝书仍是纯前端 UI 扩展:这里只是用 fetch 访问 ST 同源下的
 * `/api/plugins/st-bainiaodata/v1/*`;服务端插件没装(或 enableServerPlugins 没开)时
 * 探测失败,所有调用方自动回落到本地 chatMetadata,功能不受影响。
 *
 * 契约(白鸟数据 v0.1.x):
 *  GET  /v1/health                                   → { ok, plugin{version}, api{current,supported}, capabilities }
 *  GET  /v1/records/:ns/:collection                  → 列表
 *  GET  /v1/records/:ns/:collection/:id              → 信封 { schemaVersion, revision, createdAt, updatedAt, data }
 *  PUT  /v1/records/:ns/:collection/:id  {data, expectedRevision}   (0 = 新建;不符 → 409 conflict + currentRevision)
 *  DELETE 同上 {expectedRevision}                     → 进回收站 { trashId, deletedAt, deletedRevision }
 *  GET  /v1/trash/:ns  /  POST /v1/trash/:ns/:trashId/restore
 * 请求必须带 ST 的 CSRF 头(ctx.getRequestHeaders())。
 */
import { reactive } from 'vue';
import { getContext } from '@/st/context';
import { apiSettings } from '@/api/settings';

const BASE = '/api/plugins/st-bainiaodata/v1';
const PROBE_TTL_MS = 60_000;

export interface BackendHealth {
  ok: boolean;
  version: string;
  apiCurrent: number;
  checkedAt: number;
  error: string;
}

export interface RecordEnvelope<T = unknown> {
  schemaVersion: number;
  revision: number;
  generationId?: string;
  createdAt: string;
  updatedAt: string;
  data: T;
}

export interface RecordListItem {
  recordId: string;
  revision?: number;
  updatedAt?: string;
  createdAt?: string;
  [k: string]: unknown;
}

export interface TrashItem {
  trashId: string;
  recordId?: string;
  collection?: string;
  deletedAt?: string;
  [k: string]: unknown;
}

export class BackendError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public currentRevision?: number,
  ) {
    super(message);
  }
}

export const backendState = reactive<{ available: boolean; checking: boolean; health: BackendHealth | null; lastError: string }>({
  available: false,
  checking: false,
  health: null,
  lastError: '',
});

let lastProbe = 0;
let probing: Promise<boolean> | null = null;

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = { ...(getContext()?.getRequestHeaders?.() ?? {}) };
  if (json) h['Content-Type'] = 'application/json';
  else delete h['Content-Type'];
  return h;
}

async function parseError(res: Response): Promise<BackendError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* 非 JSON 错误体 */
  }
  return new BackendError(
    res.status,
    String(body.error ?? `http_${res.status}`),
    String(body.message ?? `HTTP ${res.status}`),
    typeof body.currentRevision === 'number' ? body.currentRevision : undefined,
  );
}

/** 探测后端是否可用;结果缓存 60s,force=true 立即重测 */
export async function probeBackend(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && now - lastProbe < PROBE_TTL_MS && backendState.health) return backendState.available;
  if (probing) return probing;
  backendState.checking = true;
  probing = (async () => {
    try {
      const res = await fetch(`${BASE}/health`, { method: 'GET', headers: headers() });
      if (!res.ok) throw await parseError(res);
      const j = (await res.json()) as { ok?: boolean; plugin?: { version?: string }; api?: { current?: number } };
      const ok = !!j.ok;
      backendState.health = {
        ok,
        version: String(j.plugin?.version ?? ''),
        apiCurrent: Number(j.api?.current ?? 1),
        checkedAt: Date.now(),
        error: ok ? '' : '健康检查返回 ok=false',
      };
      backendState.available = ok;
      backendState.lastError = '';
      return ok;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      backendState.health = { ok: false, version: '', apiCurrent: 0, checkedAt: Date.now(), error: msg };
      backendState.available = false;
      backendState.lastError = msg;
      return false;
    } finally {
      lastProbe = Date.now();
      backendState.checking = false;
      probing = null;
    }
  })();
  return probing;
}

/** 设置允许 + 探测可用 */
export function backendUsable(): boolean {
  return !!apiSettings.backend?.enabled && backendState.available;
}

/** 路径段只允许 [A-Za-z0-9_-],其余字符转义,过长截断并附哈希,满足"≤128 字符、无斜杠" */
export function safeSegment(raw: string): string {
  const s = String(raw ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hash = (h >>> 0).toString(36);
  const ascii = s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `${ascii || 'x'}-${hash}`;
}

/** 当前聊天在后端的记录键:角色头像文件名 + 聊天 id(群聊用 groupId) */
export function currentChatKey(): string | null {
  const ctx = getContext();
  const chatId = ctx?.getCurrentChatId?.();
  if (!chatId) return null;
  const owner = ctx?.groupId
    ? `group_${ctx.groupId}`
    : String(ctx?.characters?.[Number(ctx.characterId)]?.avatar ?? ctx?.name2 ?? 'char');
  return safeSegment(`${owner}|${chatId}`);
}

function ns(): string {
  return apiSettings.backend?.namespace || 'baibai-book';
}

export async function getRecord<T = unknown>(collection: string, id: string): Promise<RecordEnvelope<T> | null> {
  const res = await fetch(`${BASE}/records/${ns()}/${collection}/${encodeURIComponent(id)}`, { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as RecordEnvelope<T>;
}

/**
 * 写记录。expectedRevision 省略时先读当前 revision(读-改-写),碰到 409 自动按服务端 currentRevision 重试一次。
 * 这是"最后写入者赢"的保守策略——柏宝书的快照本来就是整份覆盖,不做字段级合并。
 */
export async function putRecord<T = unknown>(collection: string, id: string, data: T, expectedRevision?: number): Promise<RecordEnvelope<T>> {
  let rev = expectedRevision;
  if (rev === undefined) {
    const cur = await getRecord(collection, id);
    rev = cur ? cur.revision : 0;
  }
  const attempt = async (r: number) => {
    const res = await fetch(`${BASE}/records/${ns()}/${collection}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: headers(true),
      body: JSON.stringify({ data, expectedRevision: r }),
    });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as RecordEnvelope<T>;
  };
  try {
    return await attempt(rev);
  } catch (e) {
    if (e instanceof BackendError && e.status === 409 && typeof e.currentRevision === 'number') {
      return attempt(e.currentRevision);
    }
    throw e;
  }
}

export async function deleteRecord(collection: string, id: string): Promise<{ trashId: string } | null> {
  const cur = await getRecord(collection, id);
  if (!cur) return null;
  const res = await fetch(`${BASE}/records/${ns()}/${collection}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: headers(true),
    body: JSON.stringify({ expectedRevision: cur.revision }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { trashId: string };
}

export async function listRecords(collection: string): Promise<RecordListItem[]> {
  const res = await fetch(`${BASE}/records/${ns()}/${collection}`, { headers: headers() });
  if (!res.ok) throw await parseError(res);
  const j = (await res.json()) as unknown;
  const arr = Array.isArray(j) ? j : Array.isArray((j as { records?: unknown[] })?.records) ? (j as { records: unknown[] }).records : Array.isArray((j as { items?: unknown[] })?.items) ? (j as { items: unknown[] }).items : [];
  return arr.map(x => {
    if (typeof x === 'string') return { recordId: x };
    const o = (x ?? {}) as Record<string, unknown>;
    return { ...o, recordId: String(o.recordId ?? o.id ?? '') } as RecordListItem;
  });
}

export async function listTrash(): Promise<TrashItem[]> {
  const res = await fetch(`${BASE}/trash/${ns()}`, { headers: headers() });
  if (!res.ok) throw await parseError(res);
  const j = (await res.json()) as unknown;
  const arr = Array.isArray(j) ? j : Array.isArray((j as { items?: unknown[] })?.items) ? (j as { items: unknown[] }).items : Array.isArray((j as { trash?: unknown[] })?.trash) ? (j as { trash: unknown[] }).trash : [];
  return arr.map(x => {
    const o = (x ?? {}) as Record<string, unknown>;
    return { ...o, trashId: String(o.trashId ?? o.id ?? '') } as TrashItem;
  });
}

export async function restoreTrash(trashId: string): Promise<void> {
  const res = await fetch(`${BASE}/trash/${ns()}/${encodeURIComponent(trashId)}/restore`, { method: 'POST', headers: headers(true), body: '{}' });
  if (!res.ok) throw await parseError(res);
}
