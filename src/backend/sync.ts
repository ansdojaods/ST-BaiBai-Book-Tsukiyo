/**
 * 与白鸟后端的同步(融合版新增)。
 *
 * 集合约定(namespace 默认 baibai-book):
 *  - snapshots/<chatKey>  :当前聊天完整记忆快照(MemorySnapshot)
 *  - trash/<chatKey>      :本地回收站镜像(整份覆盖)
 * 全部为"整份覆盖 + 乐观并发(自动按服务端 revision 重试一次)",不做字段级合并。
 * 后端不可用时所有函数要么静默跳过(自动任务),要么抛出可读错误(用户点击的操作)。
 */
import { reactive, watch } from 'vue';
import { apiSettings } from '@/api/settings';
import { memory, derivedMeta } from '@/memory/store';
import { anchorState } from '@/anchor/store';
import { externalState } from '@/bridge/external';
import { backendUsable, currentChatKey, getRecord, listRecords, probeBackend, putRecord, deleteRecord, type RecordListItem } from './bainiao';
import { buildSnapshot, applySnapshot, parseSnapshot, snapshotIsEmpty, type MemorySnapshot } from './restore';
import { onTrashChanged, trashSnapshot, replaceTrash, type TrashEntry } from './trash';

export const SNAPSHOT_COLLECTION = 'snapshots';
export const TRASH_COLLECTION = 'trash';

export const syncState = reactive<{
  busy: boolean;
  lastBackupAt: number;
  lastBackupRevision: number;
  lastError: string;
  remoteUpdatedAt: string;
  remoteRevision: number;
}>({ busy: false, lastBackupAt: 0, lastBackupRevision: 0, lastError: '', remoteUpdatedAt: '', remoteRevision: 0 });

/** 备份当前聊天快照到后端。manual=true 时后端不可用会抛错;自动任务静默跳过 */
export async function backupSnapshotToBackend(manual = false): Promise<boolean> {
  if (!(await probeBackend()) || !backendUsable()) {
    if (manual) throw new Error('白鸟数据后端不可用(未安装服务端插件、未开启 enableServerPlugins,或设置里已关闭)');
    return false;
  }
  const key = currentChatKey();
  if (!key) {
    if (manual) throw new Error('当前没有打开的聊天');
    return false;
  }
  const snapshot = buildSnapshot();
  if (snapshotIsEmpty(snapshot)) {
    if (manual) throw new Error('当前聊天还没有任何记忆数据,无需备份');
    return false;
  }
  syncState.busy = true;
  try {
    const env = await putRecord(SNAPSHOT_COLLECTION, key, snapshot);
    syncState.lastBackupAt = Date.now();
    syncState.lastBackupRevision = env.revision;
    syncState.remoteRevision = env.revision;
    syncState.remoteUpdatedAt = env.updatedAt;
    syncState.lastError = '';
    return true;
  } catch (e) {
    syncState.lastError = e instanceof Error ? e.message : String(e);
    if (manual) throw e;
    return false;
  } finally {
    syncState.busy = false;
  }
}

/** 读取后端上当前聊天的快照(不应用) */
export async function fetchRemoteSnapshot(): Promise<{ snapshot: MemorySnapshot; revision: number; updatedAt: string } | null> {
  if (!(await probeBackend()) || !backendUsable()) throw new Error('白鸟数据后端不可用');
  const key = currentChatKey();
  if (!key) throw new Error('当前没有打开的聊天');
  const env = await getRecord(SNAPSHOT_COLLECTION, key);
  if (!env) return null;
  const snapshot = parseSnapshot(env.data);
  if (!snapshot) throw new Error('后端快照格式无法识别');
  syncState.remoteRevision = env.revision;
  syncState.remoteUpdatedAt = env.updatedAt;
  return { snapshot, revision: env.revision, updatedAt: env.updatedAt };
}

/** 从后端恢复到当前聊天(会先建"恢复前"恢复点) */
export async function restoreSnapshotFromBackend(recordId?: string): Promise<{ skippedLeaves: number; snapshot: MemorySnapshot }> {
  if (!(await probeBackend()) || !backendUsable()) throw new Error('白鸟数据后端不可用');
  const key = recordId ?? currentChatKey();
  if (!key) throw new Error('当前没有打开的聊天');
  const env = await getRecord(SNAPSHOT_COLLECTION, key);
  if (!env) throw new Error('后端上没有这份快照');
  const snapshot = parseSnapshot(env.data);
  if (!snapshot) throw new Error('后端快照格式无法识别');
  const r = applySnapshot(snapshot);
  return { skippedLeaves: r.skippedLeaves, snapshot };
}

export interface RemoteSnapshotInfo {
  recordId: string;
  revision: number;
  updatedAt: string;
  charName: string;
  chatId: string;
  floors: number;
  summaries: number;
  anchors: number;
  isCurrent: boolean;
}

/** 列出后端上的全部快照(供"从别的聊天恢复"与清理) */
export async function listRemoteSnapshots(): Promise<RemoteSnapshotInfo[]> {
  if (!(await probeBackend()) || !backendUsable()) throw new Error('白鸟数据后端不可用');
  const cur = currentChatKey();
  const items = await listRecords(SNAPSHOT_COLLECTION);
  return items.map((it: RecordListItem) => {
    const d = (it.data ?? {}) as Partial<MemorySnapshot>;
    return {
      recordId: it.recordId,
      revision: Number(it.revision ?? 0),
      updatedAt: String(it.updatedAt ?? ''),
      charName: String(d.charName ?? ''),
      chatId: String(d.chatId ?? ''),
      floors: Number(d.floors ?? 0),
      summaries: Array.isArray(d.summaries) ? d.summaries.length : 0,
      anchors: Array.isArray(d.anchors) ? d.anchors.length : 0,
      isCurrent: it.recordId === cur,
    };
  });
}

export async function deleteRemoteSnapshot(recordId: string): Promise<void> {
  await deleteRecord(SNAPSHOT_COLLECTION, recordId);
}

/* ---------------- 回收站镜像 ---------------- */

let trashTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleTrashMirror(): void {
  if (!apiSettings.backend?.enabled) return;
  if (trashTimer) clearTimeout(trashTimer);
  trashTimer = setTimeout(async () => {
    trashTimer = null;
    if (!(await probeBackend()) || !backendUsable()) return;
    const key = currentChatKey();
    if (!key) return;
    try {
      await putRecord(TRASH_COLLECTION, key, { version: 1, items: trashSnapshot() });
    } catch (e) {
      console.warn('[柏宝书] 回收站镜像到后端失败', e);
    }
  }, 4000);
}

/** 从后端取回回收站镜像并替换本地(本地丢了时用) */
export async function pullTrashMirror(): Promise<number> {
  if (!(await probeBackend()) || !backendUsable()) throw new Error('白鸟数据后端不可用');
  const key = currentChatKey();
  if (!key) throw new Error('当前没有打开的聊天');
  const env = await getRecord<{ items?: TrashEntry[] }>(TRASH_COLLECTION, key);
  const items = Array.isArray(env?.data?.items) ? env!.data.items! : [];
  replaceTrash(items);
  return items.length;
}

/* ---------------- 自动备份 ---------------- */

let autoTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutoBackup(): void {
  if (!apiSettings.backend?.enabled || !apiSettings.backend.autoBackup) return;
  if (autoTimer) clearTimeout(autoTimer);
  // 摘要常常连着落几次盘,等它们安静 20s 再备份一次
  autoTimer = setTimeout(() => {
    autoTimer = null;
    void backupSnapshotToBackend(false);
  }, 20_000);
}

let bound = false;
export function bindBackendSync(): void {
  if (bound) return;
  bound = true;
  onTrashChanged(scheduleTrashMirror);
  watch(
    () => [derivedMeta.rev, memory.summaries.length, anchorState.rev, externalState.rev] as const,
    scheduleAutoBackup,
  );
  // 启动时探测一次(不阻塞)
  void probeBackend();
}
