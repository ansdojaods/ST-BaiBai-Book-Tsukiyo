import { afterAll, describe, expect, it, vi } from 'vitest';
import * as context from '@/st/context';
import type { STContext } from '@/st/context';
import { apiSettings, defaults, hydrateSettings } from './settings';

/**
 * 刷新页面后从 extension_settings 回灌:融合版新增的嵌套设置(锚点/后端/小手机)和
 * 月夜版的摘要缺口策略都必须被 applyInto 带回来,否则用户每次刷新都会退回默认值。
 * (hydrateSettings 只会真正执行一次,故独立成文件。)
 */
describe('hydrateSettings', () => {
  // node 环境没有 window:共享渠道/排除名单监听器只需要 addEventListener 存在
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() });
  afterAll(() => vi.unstubAllGlobals());

  it('restores nested fusion settings and backlog policy from extension_settings', () => {
    const stored = defaults();
    stored.anchor.triggerPhrase = '写日记';
    stored.anchor.injectDepth = 9;
    stored.backend.restorePoints = 6;
    stored.backend.trashKeep = 42;
    stored.phoneBridge.enabled = false;
    stored.phoneBridge.shareMemory = false;
    stored.phoneBridge.briefHistoryChars = 1234;
    stored.backlogPolicy = 'block';
    stored.backlogWaitSec = 5;
    stored.backlogCatchUp = false;

    const extensionSettings: Record<string, unknown> = { baibai_book: JSON.parse(JSON.stringify(stored)) };
    vi.spyOn(context, 'getContext').mockReturnValue({
      extensionSettings,
      saveSettingsDebounced: vi.fn(),
      eventSource: { on: vi.fn(), emit: vi.fn() },
      eventTypes: {},
    } as unknown as STContext);

    hydrateSettings();

    expect(apiSettings.anchor.triggerPhrase).toBe('写日记');
    expect(apiSettings.anchor.injectDepth).toBe(9);
    expect(apiSettings.backend.restorePoints).toBe(6);
    expect(apiSettings.backend.trashKeep).toBe(42);
    expect(apiSettings.phoneBridge.enabled).toBe(false);
    expect(apiSettings.phoneBridge.shareMemory).toBe(false);
    expect(apiSettings.phoneBridge.briefHistoryChars).toBe(1234);
    expect(apiSettings.backlogPolicy).toBe('block');
    expect(apiSettings.backlogWaitSec).toBe(5);
    expect(apiSettings.backlogCatchUp).toBe(false);
  });
});
