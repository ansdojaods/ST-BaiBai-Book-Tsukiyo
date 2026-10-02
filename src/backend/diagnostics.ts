/**
 * 诊断导出(融合版新增;思路来自世界背面的"诊断包",独立实现)。
 *
 * 用户反馈问题时常常说不清"哪儿不对"。这里把 插件版本 / 关键设置(密钥脱敏)/ 后端健康 /
 * 记忆统计 / 最近错误 打成一份 JSON,可复制或下载,方便排查;不包含任何聊天正文与密钥。
 */
import { apiSettings } from '@/api/settings';
import { getContext } from '@/st/context';
import { memory, derivedMeta } from '@/memory/store';
import { engineState } from '@/memory/engine';
import { anchorState } from '@/anchor/store';
import { externalState } from '@/bridge/external';
import { backendState } from './bainiao';
import { syncState } from './sync';
import { restoreState } from './restore';
import { trashState } from './trash';

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url ? '(非法 URL)' : '';
  }
}

function byteSize(x: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(x)).length;
  } catch {
    return -1;
  }
}

export function buildDiagnostics(pluginVersion: string): Record<string, unknown> {
  const ctx = getContext();
  const chat = ctx?.chat ?? [];
  const meta = (ctx?.chatMetadata ?? {}) as Record<string, unknown>;
  const s = apiSettings;
  const hidden = chat.filter(m => m?.is_system).length;
  const levels: Record<string, number> = {};
  for (const n of memory.summaries) levels[`L${n.level}`] = (levels[`L${n.level}`] ?? 0) + 1;
  return {
    generatedAt: new Date().toISOString(),
    plugin: { name: 'ST-BaiBai-Book-Tsukiyo (柏宝书-月夜来信版)', version: pluginVersion },
    host: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      stReady: !!ctx,
      hasGenerateRaw: typeof ctx?.generateRaw === 'function',
      hasConnectionManager: !!ctx?.ConnectionManagerRequestService,
      chatOpen: !!ctx?.getCurrentChatId?.(),
      isGroup: !!ctx?.groupId,
    },
    chat: {
      floors: chat.length,
      hiddenFloors: hidden,
      pendingFloors: derivedMeta.pendingFloors.length,
      leaves: derivedMeta.leaves.length,
      summaryNodes: memory.summaries.length,
      summaryLevels: levels,
      latestStoryTime: derivedMeta.latestStoryTime,
      metadataBytes: {
        baibai_book: byteSize(meta.baibai_book),
        baibai_book_anchor: byteSize(meta.baibai_book_anchor),
        baibai_book_external: byteSize(meta.baibai_book_external),
        baibai_book_restore: byteSize(meta.baibai_book_restore),
        baibai_book_trash: byteSize(meta.baibai_book_trash),
      },
    },
    engine: {
      running: engineState.running,
      lastError: engineState.lastError,
    },
    anchor: {
      enabled: s.anchor.enabled,
      versions: anchorState.anchors.length,
      excluded: anchorState.anchors.filter(a => a.excluded).length,
      lastError: anchorState.lastError,
      settings: { ...s.anchor, instruction: s.anchor.instruction ? `(自定义,${s.anchor.instruction.length} 字)` : '(内置)' },
    },
    external: {
      notes: externalState.notes.length,
      bySource: externalState.notes.reduce<Record<string, number>>((acc, n) => ((acc[n.source] = (acc[n.source] ?? 0) + 1), acc), {}),
      lastPushAt: externalState.lastPushAt ? new Date(externalState.lastPushAt).toISOString() : '',
      settings: s.phoneBridge,
    },
    backend: {
      settings: s.backend,
      health: backendState.health,
      sync: { ...syncState },
      restorePoints: restoreState.points.map(p => ({ id: p.id, createdAt: new Date(p.createdAt).toISOString(), reason: p.reason, floors: p.snapshot.floors })),
      trashItems: trashState.items.length,
    },
    api: {
      channels: s.channels.map(c => ({
        name: c.name,
        url: redactUrl(c.url),
        model: c.model,
        hasKey: !!c.key,
        stream: c.stream,
        timeoutSec: c.timeoutSec,
        lastTest: c.lastTest ?? null,
      })),
      assignments: s.assignments,
      summaryMaxRetries: s.summaryMaxRetries,
    },
    memorySettings: {
      enabled: s.enabled,
      autoSummaryEnabled: s.autoSummaryEnabled,
      summaryOnlyMode: s.summaryOnlyMode,
      keepRecent: s.keepRecent,
      leafBatchThreshold: s.leafBatchThreshold,
      leafKeepRecent: s.leafKeepRecent,
      resummaryThreshold: s.resummaryThreshold,
      verbosity: s.verbosity,
      vectorEnabled: s.vector?.enabled,
    },
  };
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
