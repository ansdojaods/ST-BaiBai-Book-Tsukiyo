/**
 * 融合版启动绑定(单入口):锚点日记 / 外部记录 / 回收站 / 恢复点 / 白鸟后端同步 / 小手机联动。
 * 由 src/index.ts 在 bindChatLifecycle 之后调用;所有子模块都是幂等绑定。
 */
import { getContext } from '@/st/context';
import { PLUGIN_VERSION } from '@/version';
import { bindAnchor } from '@/anchor/engine';
import { loadExternal } from '@/bridge/external';
import { bindPhoneBridge } from '@/bridge/phone';
import { loadTrash } from '@/backend/trash';
import { loadRestorePoints, setSnapshotPluginVersion } from '@/backend/restore';
import { bindBackendSync } from '@/backend/sync';

let bound = false;

export function bindFusion(): void {
  if (bound) return;
  bound = true;
  setSnapshotPluginVersion(PLUGIN_VERSION);
  const loadAll = () => {
    loadExternal();
    loadTrash();
    loadRestorePoints();
  };
  loadAll();
  const ctx = getContext();
  if (ctx?.eventSource && ctx.eventTypes) ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, loadAll);
  bindAnchor();
  bindBackendSync();
  bindPhoneBridge();
  console.log('[柏宝书-月夜来信版] 锚点日记 / 备份恢复 / 小手机联动 已绑定');
}
