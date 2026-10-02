// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import SummaryPage from '@/pages/summary/index.vue';
import FusionPage from '@/pages/fusion/index.vue';
import * as context from '@/st/context';
import { apiSettings, defaults } from '@/api/settings';
import { memory } from './store';
import { createEmptyMemory } from './types';
import { engineState, batchState } from './engine';
import { restoreState } from '@/backend/restore';
import { anchorState } from '@/anchor/store';
import { externalState } from '@/bridge/external';
import * as notices from '@/st/toast';
let app: App | undefined;
let chat: any[];
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(memory, createEmptyMemory()); Object.assign(apiSettings, defaults());
  apiSettings.enabled = false; apiSettings.autoSummaryEnabled = false;
  engineState.running = false; batchState.running = false;
  restoreState.points = []; anchorState.anchors = []; externalState.notes = [];
  chat = [{ name: 'AI', is_user: false, is_system: false, mes: '两个人在街上相遇。', extra: {} }];
  vi.spyOn(context, 'getContext').mockReturnValue({ chat, chatMetadata: {}, name1: 'User', name2: 'AI',
    getCurrentChatId: () => 'ui-A', saveChat: vi.fn().mockResolvedValue(undefined), saveMetadataDebounced: vi.fn(), setExtensionPrompt: vi.fn() } as any);
  vi.spyOn(notices, 'toast').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No network permitted')));
  document.body.innerHTML = '<div id="test-root"></div>';
});
afterEach(() => { app?.unmount(); app = undefined; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  expect(button, 'button ' + text).toBeTruthy(); button!.click();
}
it('real summary page opens manual editor and saves a missing floor without an API', async () => {
  app = createApp(SummaryPage); app.mount('#test-root'); await nextTick();
  click('手写'); await nextTick();
  const editor = document.querySelector('[aria-label="手写楼层摘要"] textarea') as HTMLTextAreaElement;
  expect(editor).toBeTruthy(); editor.value = '两人在街上相遇并互相问候。'; editor.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
  click('保存手写摘要'); await nextTick(); await vi.advanceTimersByTimeAsync(1000); await nextTick();
  expect(chat[0].extra.bbs_leaf.text).toBe('两人在街上相遇并互相问候。');
  expect(document.querySelector('[aria-label="手写楼层摘要"]')).toBeNull();
  expect(document.body.textContent).toContain('两人在街上相遇并互相问候。');
  expect(fetch).not.toHaveBeenCalled();
});
it('real recovery tab contains local controls, no whitebird status or network probe', async () => {
  app = createApp(FusionPage); app.mount('#test-root'); await nextTick();
  click('备份恢复'); await nextTick();
  expect(document.body.textContent).toContain('导出为文件'); expect(document.body.textContent).toContain('回收站');
  expect(document.body.textContent).not.toContain('白鸟数据后端:');
  expect(document.body.textContent).not.toContain('重新检测'); expect(document.body.textContent).not.toContain('立即备份当前聊天');
  await vi.advanceTimersByTimeAsync(30000); expect(fetch).not.toHaveBeenCalled();
});
