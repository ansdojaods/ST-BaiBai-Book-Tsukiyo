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
import { apiSettings, getChannelForTask } from '@/api/settings';
import { toast as stToast } from '@/st/toast';
import { PLUGIN_VERSION } from '@/version';
import { externalState } from '@/bridge/external';
import { setEditorBadge } from './badge';
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

/** 【1.4.2】剪辑台 service 的模块级引用：给生成拦截器一个「生成前召回」的入口 */
let editorService: { recall: (options?: { floor?: number }) => unknown } | null = null;

/**
 * 【1.4.2】生成前调用一次剪辑台召回（写它自己的注入槽 baibai_book_editor）。
 * 由 src/index.ts 的生成拦截器在放行路径上调用；剪辑台未绑定/已关闭/召回已关时内部自会
 * 清空注入槽并返回 null，不抛错、不影响生成。
 * 清空交给剪辑台自己在「生成结束」时做（一次生成一次注入，见 service.onGenerationEnded）。
 */
export function runEditorRecall(): void {
  try {
    editorService?.recall({});
  } catch (e) {
    console.warn('[柏宝书] 剪辑台召回异常（忽略，不影响生成）', e);
  }
}

let panelContainer: HTMLElement | null = null;
let panelBody: HTMLElement | null = null;
let editorBound = false;
let escBound = false;
let editorHandle: { refresh: () => void; renderPanel?: () => void } | null = null;

/**
 * 【1.4.1 修复】给面板容器搭一层「抽屉骨架」：标题条 + 可滚动内容区。
 *
 * 之前容器是空的：面板直接挂在 #bme-panel-host 上，而这个 div 既没有定位也没有层级，
 * 主题令牌（.bbs-root 上的 --bbs-*）也取不到，所以酒馆里看到的是一坨挤在页面末尾、
 * 半透明、被聊天盖住的文字。骨架 + memory-editor.css 一起把「显示不对」修掉。
 */
function ensureChrome(container: HTMLElement): HTMLElement {
  const existing = container.querySelector<HTMLElement>(':scope > .bme-host-body');
  if (existing) return existing;
  container.textContent = '';

  const left = document.createElement('div');
  left.className = 'bme-host-left';
  const title = document.createElement('strong');
  title.className = 'bme-host-title';
  title.textContent = '剧情剪辑台';
  const hint = document.createElement('span');
  hint.className = 'bme-host-hint';
  hint.textContent = '楼层摘要 / 状态账本 / 记忆缺口 / 召回 · Esc 或「关闭」收起';
  left.append(title, hint);

  const actions = document.createElement('div');
  actions.className = 'bme-host-actions';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'bme-host-refresh';
  refresh.textContent = '刷新';
  refresh.addEventListener('click', () => {
    editorHandle?.renderPanel?.();
    editorHandle?.refresh();
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bme-host-close';
  close.textContent = '关闭';
  close.addEventListener('click', () => {
    toggleMemoryEditorPanel(false);
  });
  actions.append(refresh, close);

  const bar = document.createElement('div');
  bar.className = 'bme-host-bar';
  bar.append(left, actions);

  const body = document.createElement('div');
  body.className = 'bme-host-body';

  container.append(bar, body);
  return body;
}

/** mount() 阶段把面板容器交进来（主 shadow root 内、默认隐藏，由魔杖菜单开合） */
export function mountMemoryEditorPanel(container: HTMLElement): void {
  panelContainer = container;
  panelBody = ensureChrome(container);
  // 极端顺序（剪辑台实例早于 mount 建好）时补挂一次，避免面板落在容器外。
  // 【1.4.2】原判断 panelBody.contains(panelBody.lastElementChild ?? panelBody) 恒为 true（自身总被包含），
  // 补挂实际从未执行；改成看「内容区里有没有面板挂进去」。
  if (editorHandle && panelBody && !panelBody.querySelector(':scope > .bme-root')) {
    editorHandle.renderPanel?.();
  }
}

/** 魔杖菜单开合；返回开合后的可见状态。传 false 表示强制收起（关闭按钮 / Esc 用） */
export function toggleMemoryEditorPanel(force?: boolean): boolean {
  if (!panelContainer) return false;
  panelContainer.hidden = typeof force === 'boolean' ? !force : !panelContainer.hidden;
  const open = !panelContainer.hidden;
  if (open) {
    editorHandle?.renderPanel?.();
    if (!escBound) {
      escBound = true;
      // 只在第一次打开时挂一次：Esc 收起面板（不拦其它按键，不阻止冒泡）
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && panelContainer && !panelContainer.hidden) toggleMemoryEditorPanel(false);
      });
    }
  }
  return open;
}

/** 楼层角色：AI 正文算 assistant，非 AI 的系统/旁白算 system */
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

    /**
     * 【1.4.2】自动摘要归属：柏宝书的摘要森林默认负责自动摘要，
     * 剪辑台只在「柏宝书设置 → 摘要设置 → 自动摘要归属」选它时（或柏宝书自动摘要关掉时）才自动生成，
     * 避免同一段剧情被两边各摘一次。
     */
    autoSummaryAllowed(): boolean {
      return apiSettings.editorOwnsAutoSummary === true;
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
    const editor = createMemoryEditor(createHostPort(), {
      autoInit: false,
      title: '剧情剪辑台',
      // 【1.4.0 设计、1.4.2 接线】「汇入小手机记录」按钮的数据源：柏宝书【小手机】外部记录。
      // 之前没人传这个 provider —— 按钮点了永远提示「没有可汇入的手机记录」。
      notesProvider: () =>
        externalState.notes
          .filter((note) => note.source === 'tsukiyo-phone')
          .map((note) => ({
            id: note.id,
            kind: note.kind,
            title: note.title ?? '',
            text: note.text,
            floor: typeof note.floor === 'number' ? note.floor : undefined,
            pinned: !!note.pinned,
          })),
      // 【1.4.2】让小手机等外部脚本可以反向打开/收起剪辑台抽屉
      panelControls: {
        open: () => void toggleMemoryEditorPanel(true),
        close: () => void toggleMemoryEditorPanel(false),
        toggle: () => void toggleMemoryEditorPanel(),
      },
    });
    editor.service.init();
    editorService = editor.service as unknown as { recall: (options?: { floor?: number }) => unknown };
    // register.ts 的 createApi 是 Object.freeze 的,memoryEditor 子键经 holder 注入(见 register.ts)
    const apiHolder: Record<string, unknown> = {};
    editor.installGlobal(apiHolder);
    memoryEditorApi.current = apiHolder;
    // 面板挂到抽屉骨架的内容区（bme-host-body），不是容器本身；骨架由 mountMemoryEditorPanel 建好
    editorHandle = editor;
    const mountPoint = panelContainer ? (panelBody ?? ensureChrome(panelContainer)) : null;
    if (mountPoint) editor.attach(mountPoint);
    // 引擎数据变化(摘要/台账/设置)时刷新只读镜像广播 + 面板重绘。
    // 【1.4.2】① 面板收起时不再重建 DOM（监听的是 ST 的逐条消息事件，长聊天里很密集）；
    //          ② 同轮多次事件合并成一次，避免一次生成重绘好几遍；
    //          ③ 顺带把「待确认草稿数」写进魔杖菜单角标。
    let renderQueued = false;
    const syncBadge = (): void => setEditorBadge(editor.service.state.drafts.length);
    window.addEventListener('st-baibai-book:changed', () => {
      editor.refresh();
      syncBadge();
      if (!panelContainer || panelContainer.hidden || renderQueued) return;
      renderQueued = true;
      setTimeout(() => {
        renderQueued = false;
        if (panelContainer && !panelContainer.hidden) editor.renderPanel();
      }, 120);
    });
    syncBadge();
    console.log('[柏宝书] 剧情剪辑台已绑定（memoryEditor API 已挂载，入口：魔杖菜单 → 剧情剪辑台）');
  } catch (e) {
    console.error('[柏宝书] 剧情剪辑台绑定失败', e);
  }
}
