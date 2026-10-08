// @vitest-environment jsdom
// 回归:渠道编辑弹窗里的「自定义测试」只能改草稿,不能提前写回已保存的渠道
// (取消编辑即作废;曾经会直接改已保存渠道的 url / 测试用语 / 测试结果)。
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { apiSettings, defaults, newChannel, type ApiChannel } from '@/api/settings';
import * as client from '@/api/client';
import ChannelTestModals from './ChannelTestModals.vue';

vi.mock('@/api/client', async importOriginal => {
  const orig = await importOriginal<typeof import('@/api/client')>();
  return {
    ...orig,
    // 模拟 testChannel:与真实实现一样把结果写到传入的渠道对象上
    testChannel: vi.fn(async (ch: ApiChannel) => {
      const res = { ok: true, ms: 5, reply: 'OK', prompt: '测试', withJailbreak: false, message: '' };
      ch.lastTest = { at: 1, ...res };
      return res;
    }),
  };
});

let app: App | undefined;

function savedChannel(): ApiChannel {
  const c = newChannel();
  c.id = 'c-saved';
  c.name = '已保存渠道';
  c.url = 'https://saved.example/v1';
  c.testPrompt = '旧用语';
  return c;
}

beforeEach(() => {
  Object.assign(apiSettings, defaults());
  apiSettings.channels = [savedChannel()];
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="test-root"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function mountModals(): Promise<any> {
  app = createApp(ChannelTestModals);
  const vm = app.mount('#test-root') as any;
  await nextTick();
  return vm;
}

function clickRunTest() {
  const btn = [...document.querySelectorAll('button')].find(b => /开始测试|重新测试/.test(b.textContent ?? ''));
  expect(btn, '测试按钮').toBeTruthy();
  btn!.click();
}

it('编辑草稿上测试:只改草稿,已保存渠道的 url / 测试用语 / 测试结果保持不变', async () => {
  const vm = await mountModals();
  const draft = JSON.parse(JSON.stringify(apiSettings.channels[0])) as ApiChannel;
  draft.url = 'https://draft.example/v1';
  draft.testPrompt = '新用语';

  vm.openSingle(draft, { topLayer: true });
  await nextTick();
  clickRunTest();
  await vi.waitFor(() => expect(draft.lastTest).toBeDefined());

  // 测试确实用了草稿的地址,结果留在草稿上(点「完成」时才会一起保存)
  expect(client.testChannel).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'https://draft.example/v1' }),
    expect.anything(),
  );
  expect(draft.lastTest?.ok).toBe(true);

  // 已保存渠道一个字段都不能被改
  const saved = apiSettings.channels[0];
  expect(saved.url).toBe('https://saved.example/v1');
  expect(saved.testPrompt).toBe('旧用语');
  expect(saved.lastTest).toBeUndefined();
});

it('列表里的单独测试(非草稿)仍然把结果写回已保存渠道', async () => {
  const vm = await mountModals();
  const saved = apiSettings.channels[0];

  vm.openSingle(saved);
  await nextTick();
  clickRunTest();
  await vi.waitFor(() => expect(saved.lastTest).toBeDefined());

  expect(saved.lastTest?.ok).toBe(true);
  expect(saved.url).toBe('https://saved.example/v1');
});
