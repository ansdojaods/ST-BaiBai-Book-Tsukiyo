/**
 * 剧情剪辑台 · 宿主适配层（百宝月夜书侧的 HostPort 实现 + 接线）
 *
 * 模块本体在 ./（ports.ts 之外零依赖仓库内部）；本文件是 README §2 说的
 * 「只需要动 ports.ts」的那份实现——按仓库内部实现把楼层、存档、LLM 通道、
 * 注入刷新与事件钩子接进 HostPort，并在启动链里创建/挂载剪辑台。
 *
 * 约定：
 *  - 剪辑台状态按聊天落盘：chatMetadata['bbs_editor_state']（与摘要森林同一层，跟聊天走）；
 *  - 生成通道：副 API「摘要」渠道 → 回退主 API generateRaw；支持 AbortSignal（仅副 API 路径）；
 *  - 注入：独立槽 baibai_book_editor（D4，一次生成一次注入，切聊天即清空）；
 *  - 收纳（hideFloors/showFloors）暂未接：引擎的窗口自动隐藏机制已管理楼层可见性，
 *    侧路再隐藏会互相打架；模块对缺失的可选端口自动降级为「不可用」。
 */
import { pendingAiFloors, isRealAiReply, engineState, batchState, currentSummaryPromise } from '@/memory/engine';
import { leafValid } from '@/memory/apply';
import { cleanBody } from '@/memory/timeTag';
import { getContext, type STMessage } from '@/st/context';
import { requestCompletion, requestViaMainApi, mainApiAvailable, type ChatMsg } from '@/api/client';
import { getChannelForTask } from '@/api/settings';
import { toast as stToast } from '@/st/toast';
import { PLUGIN_VERSION } from '@/version';
import { createMemoryEditor } from './index';
import type { HostPort, FloorRef, GenerateRequest, GenerateResult } from './ports';
import type { MemoryEditorState } from './types';

const EDITOR_STATE_KEY = 'bbs_editor_state';
const EDITOR_INJECT_KEY = 'baibai_book_editor';
const EDITOR_INJECT_DEPTH = 4;
/** setExtensionPrompt 的 position/role 常量，语义与 src/memory/inject.ts 一致 */
const IN_CHAT = 1;
const ROLE_SYSTEM = 0;

/** register.ts 的 createApi 通过这个 holder 暴露 window.STBaiBaiBook.memoryEditor（免冻结问题） */
export const memoryEditorApi: { current: Record<string, unknown> | null } = { current: null };

let panelContainer: HTMLElement | null = null;
let editorBound = false;

/** mount() 阶段把面板容器交进来（主 shadow root 内、默认隐藏，由魔杖菜单开合） */
export function mountMemoryEditorPanel(container: HTMLElement): void {
  panelContainer = container;
}

/** 魔杖菜单开合；返回开合后的可见状态 */
export function toggleMemoryEditorPanel(): boolean {
  if (!panelContainer) return false;
  panelContainer.hidden = !panelContainer.hidden;
  return !panelContainer.hidden;
}

function floorRole(m: STMessage): 'user' | 'assistant' | 'system' {
  if (m.is_user) return 'user';
  return isRealAiReply(m) ? 'assistant' : 'system';
}

function createHostPort(): HostPort {
  return {
    pluginVersion: () => PLUGIN_VERSION,

    listFloors(): FloorRef[] {
      const ctx = getContext();
      const chat = ctx?.getCurrentChatId?.() ? ctx.chat ?? [] : [];
      const out: FloorRef[] = [];
      chat.forEach((message, mesid) => {
        out.push({
          mesid,
          text: cleanBody(typeof message.mes === 'string' ? message.mes : ''),
          role: floorRole(message),
          // 与 public/query.ts getFloor 的口径一致：番外(bbs_omit)与失效叶子都算无效
          valid: message.extra?.bbs_omit !== true && leafValid(message),
        });
      });
      return out;
    },

    missingFloors(): number[] {
      const ctx = getContext();
      return ctx?.getCurrentChatId?.() ? pendingAiFloors(ctx.chat ?? []) : [];
    },

    loadState(): MemoryEditorState | null {
      const ctx = getContext();
      if (!ctx?.chatMetadata || !ctx.getCurrentChatId?.()) return null;
      const raw = (ctx.chatMetadata as Record<string, unknown>)[EDITOR_STATE_KEY];
      return raw ? (raw as MemoryEditorState) : null;
    },

    saveState(state: MemoryEditorState): void {
      const ctx = getContext();
      // 欢迎页(未进入任何聊天)不落盘,与 store.ts 的守卫同一口径
      if (!ctx?.chatMetadata || !ctx.getCurrentChatId?.()) return;
      (ctx.chatMetadata as Record<string, unknown>)[EDITOR_STATE_KEY] = JSON.parse(JSON.stringify(state));
      ctx.saveMetadataDebounced?.();
    },

    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const messages: ChatMsg[] = [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ];
      try {
        const channel = getChannelForTask('summary');
        let text: string;
        if (channel) {
          text = await requestCompletion(channel, messages, { signal: req.signal });
        } else if (mainApiAvailable()) {
          text = await requestViaMainApi(messages);
        } else {
          return { ok: false, text: '', error: '没有可用的 LLM 通道：未指派副 API 渠道，且主 API 不支持 generateRaw' };
        }
        return { ok: true, text };
      } catch (e) {
        return { ok: false, text: '', error: e instanceof Error ? e.message : String(e) };
      }
    },

    busy(): boolean {
      // 引擎的摘要/批量任务在跑,或本模块自己已经在生成时,剪辑台都要让行
      return Boolean(engineState.running || batchState.running || currentSummaryPromise());
    },

    requestInject(text: string): void {
      const ctx = getContext();
      if (typeof ctx?.setExtensionPrompt !== 'function') return;
      ctx.setExtensionPrompt(EDITOR_INJECT_KEY, String(text ?? ''), IN_CHAT, EDITOR_INJECT_DEPTH, false, ROLE_SYSTEM, null);
    },

    toast(message: string, level?: 'info' | 'warn' | 'error'): void {
      stToast(message, level === 'warn' ? 'warning' : (level ?? 'info'));
    },

    onChatChanged(cb: () => void): () => void {
      const ctx = getContext();
      const es = ctx?.eventSource;
      const et = ctx?.eventTypes;
      if (!es || !et) return () => {};
      const handler = (): void => {
        // 切聊天先清自己的注入槽(模块随后会按新聊天状态重建)
        try {
          ctx?.setExtensionPrompt?.(EDITOR_INJECT_KEY, '', IN_CHAT, EDITOR_INJECT_DEPTH, false, ROLE_SYSTEM, null);
        } catch {
          /* ignore */
        }
        setTimeout(cb, 0); // 排在 store 的 CHAT_CHANGED 重载之后
      };
      es.on(et.CHAT_CHANGED, handler);
      return () => es.off?.(et.CHAT_CHANGED, handler);
    },

    onGenerationEnded(cb: () => void): () => void {
      const ctx = getContext();
      const es = ctx?.eventSource;
      const et = ctx?.eventTypes;
      if (!es || !et?.GENERATION_ENDED) return () => {};
      const handler = (): void => { setTimeout(cb, 0); };
      es.on(et.GENERATION_ENDED, handler);
      return () => es.off?.(et.GENERATION_ENDED, handler);
    },
  };
}

/**
 * 启动链绑定：创建剪辑台、挂 STBaiBaiBook.memoryEditor、把面板挂进 shadow root。
 * 在 bindMemoryWhenReady() 里、bindFusion() 之后 / registerPublicInterface() 之前调用。
 */
export function bindMemoryEditor(): void {
  if (editorBound) return;
  editorBound = true;
  try {
    const editor = createMemoryEditor(createHostPort(), { autoInit: false, title: '剧情剪辑台' });
    editor.service.init();
    // register.ts 的 createApi 是 Object.freeze 的,memoryEditor 子键经 holder 注入(见 register.ts)
    const apiHolder: Record<string, unknown> = {};
    editor.installGlobal(apiHolder);
    memoryEditorApi.current = apiHolder;
    if (panelContainer) editor.attach(panelContainer);
    // 引擎数据变化(摘要/台账/设置)时刷新只读镜像广播
    window.addEventListener('st-baibai-book:changed', () => editor.refresh());
    console.log('[柏宝书] 剧情剪辑台已绑定（memoryEditor API 已挂载，入口：魔杖菜单 → 剧情剪辑台）');
  } catch (e) {
    console.error('[柏宝书] 剧情剪辑台绑定失败', e);
  }
}
