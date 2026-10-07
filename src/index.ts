import { hydrateSettings } from '@/api/settings';
import { bindEngine, handleGenerationIntercept } from '@/memory/engine';
import { runVectorRecall, shouldRecallForType } from '@/memory/vector/recall';
import { refreshInjection } from '@/memory/inject';
import { syncTimeTagRegex } from '@/memory/timeTag';
import { bindChatLifecycle } from '@/memory/store';
import { checkForUpdate } from '@/memory/update';
import App from '@/App.vue';
import { vAutosize } from '@/directives/autosize';
import { injectMenuButton } from '@/menu';
import { syncTopBarButton } from '@/topbar';
import { syncQuickReplyButton } from '@/quickReply';
import { bindFloorPanel } from '@/floorPanel';
import { registerPublicInterface } from '@/public/register';
import { bindMemoryEditor, mountMemoryEditorPanel, runEditorRecall } from '@/features/memory-editor/host';
import { bindFusion } from '@/fusion/bind';
import { handleAnchorIntercept } from '@/anchor/engine';
import { ui } from '@/state/ui';
import { guardEditableArrowKeys } from '@/st/keyboard';
import { versionedAssetUrl } from '@/version';
import { watch } from 'vue';
// 这几行让 Vite 把全局样式打进 dist/index.css(随后注入 shadow root)
import '@/styles/base.css';
import '@/styles/theme.css';
// 【1.4.1】剧情剪辑台抽屉容器样式：容器与 Vue 根是兄弟节点，样式与主题令牌都得自己带
import '@/styles/memory-editor.css';
import { createApp } from 'vue';

const HOST_ID = 'bbs-app-host';

/**
 * 生成拦截器:ST 在每次生成前会 await 调用 manifest.generate_interceptor 指名的全局函数,
 * 签名 (chat, contextSize, abort, type),调 abort(true) 即中止本次生成。
 * 这里委托给引擎判断「积压楼层过多」并按需拦截 + 插提示楼。挂在 globalThis 上供 ST 找到。
 */
(globalThis as Record<string, unknown>).bbs_generateInterceptor = async (
  _chat: unknown,
  _contextSize: number,
  abort: (immediately: boolean) => void,
  type: string | undefined,
): Promise<void> => {
  try {
    // 【融合版】锚点日记:按本回合用户发言是否含触发词,决定是否注入锚点指令(同步、极轻)
    try {
      handleAnchorIntercept();
    } catch (e) {
      console.warn('[柏宝书] 锚点指令判定异常(忽略)', e);
    }
    // 先走积压拦截:返回 true = 已 abort 本次生成,无需召回(生成不会发生)。
    const intercepted = await handleGenerationIntercept(type, abort);
    // 放行且该类型需要召回 → 阻塞式向量召回(写注入槽后再放行生成)。
    // 召回内部自带向量开关/可用性判断,失败静默降级,绝不影响生成。
    if (!intercepted && shouldRecallForType(type)) {
      await runVectorRecall();
      // 【1.4.2】剧情剪辑台的召回：写它自己的注入槽 baibai_book_editor（深度 4）。
      // 契约是「生成前召回一次、生成结束后清空」——清空由剪辑台在自己的 onGenerationEnded 里做；
      // 之前宿主一处都没调，剪辑台的召回实际从未生效（手动点一次还会一直挂着）。
      runEditorRecall();
    }
  } catch (e) {
    console.error('[柏宝书] 生成拦截器异常(放行本次生成)', e);
  }
};

/**
 * 可继承的排版属性——shadow DOM 不隔离继承,这些会透过 host 从 ST 漏进来。
 * 在 host 上用内联 !important 钉死,从根上切断继承链。
 */
const INHERITED_RESET: Record<string, string> = {
  'font-family':
    "'MiSans','HarmonyOS Sans SC','PingFang SC','Microsoft YaHei',-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',system-ui,sans-serif",
  'font-size': '14px',
  'font-weight': '400',
  'font-style': 'normal',
  'font-variant': 'normal',
  'line-height': '1.6',
  'letter-spacing': 'normal',
  'word-spacing': 'normal',
  'text-align': 'left',
  'text-transform': 'none',
  'text-indent': '0',
  'text-shadow': 'none',
  'white-space': 'normal',
  color: '#1c242c',
  direction: 'ltr',
};

function mount() {
  // host 元素留在 ST 的 light DOM,Vue 应用整体活在它的 shadow root 里。
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    document.body.appendChild(host);
  }

  // host 不参与布局(窗口内部用 fixed 定位),并切断继承
  host.style.setProperty('display', 'contents', 'important');
  for (const [prop, value] of Object.entries(INHERITED_RESET)) {
    host.style.setProperty(prop, value, 'important');
  }

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.textContent = '';
  guardEditableArrowKeys(shadow);

  // 把我们构建出的 dist/index.css 以 <link> 注入 shadow root——
  // 这样样式只在这棵 shadow 树内生效,ST 全局样式进不来,我们的也出不去。
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  // index.js 与 index.css 在 dist 同级,据当前模块 URL 推导,部署路径无关。
  link.href = versionedAssetUrl('./index.css', import.meta.url);
  shadow.appendChild(link);

  const container = document.createElement('div');
  shadow.appendChild(container);

  const app = createApp(App);
  app.directive('autosize', vAutosize);
  app.mount(container);

  // 【1.4.0】剧情剪辑台面板容器:活在主 shadow root 里,默认隐藏,由魔杖菜单「剧情剪辑台」开合
  // 【1.4.1】必须挂上 .bbs-root 与 data-theme:主题令牌(--bbs-*)定义在 .bbs-root 上,
  // 而本容器与 Vue 应用的根节点是兄弟关系,不加这一层就拿不到变量(面板会半透明、字号错乱)。
  const editorHost = document.createElement('div');
  editorHost.id = 'bme-panel-host';
  editorHost.className = 'bbs-root';
  editorHost.setAttribute('data-theme', ui.theme);
  editorHost.hidden = true;
  shadow.appendChild(editorHost);
  mountMemoryEditorPanel(editorHost);
  // 设置页/题首切换主题时,抽屉里的变量跟着换
  watch(
    () => ui.theme,
    theme => editorHost.setAttribute('data-theme', theme),
  );

  $(window).on('pagehide', () => app.unmount());
}

$(() => {
  mount();
  injectMenuButton();
  // 顶栏快速打开按钮:按开关注入/移除。watch 在开关变化(含 hydrate 回灌真值)时同步。
  syncTopBarButton(ui.showTopBar);
  watch(
    () => ui.showTopBar,
    on => syncTopBarButton(on),
  );
  // 聊天框快速回复式按钮:同上范式
  syncQuickReplyButton(ui.showQuickReply);
  watch(
    () => ui.showQuickReply,
    on => syncQuickReplyButton(on),
  );
  // 记忆系统:等 ST 的 getContext 就绪后再绑定(加载顺序不确定时轮询)
  bindMemoryWhenReady();
});

function bindMemoryWhenReady(attempt = 0) {
  if (window.SillyTavern?.getContext) {
    try {
      console.log('[柏宝书] 启动链开始绑定(getContext 就绪)');
      // 设置先 hydrate:从 extension_settings 载入(或从旧 localStorage 迁移),之后才跨设备同步
      hydrateSettings();
      bindChatLifecycle();
      // 【融合版】锚点日记 / 外部记录 / 回收站 / 恢复点 / 后端同步 / 小手机联动(需在注入刷新前载入数据)
      bindFusion();
      // 【1.4.0】剧情剪辑台:创建实例并注入 STBaiBaiBook.memoryEditor(须在 registerPublicInterface 之前)
      bindMemoryEditor();
      // 公共读取接口不依赖记忆引擎开关；聊天载入后立即暴露，供其它插件/脚本读取。
      void registerPublicInterface();
      bindEngine();
      // 时间标签:按开关注册/移除 ST 隐藏正则(幂等;开关变化的后续同步在 bindEngine 的 watch 里)
      syncTimeTagRegex();
      // 首屏:把当前聊天已有的记忆挂上注入
      refreshInjection();
      // 楼内摘要锚点:按设置开关注入(bindFloorPanel 内 watch 开关 + 主题,immediate 首次同步)
      bindFloorPanel();
      // 后台检测更新(实时比对本地/远端 manifest 版本;失败静默,不阻断启动)
      void checkForUpdate();
      console.log('[柏宝书] 启动链绑定完成');
    } catch (e) {
      console.error('[柏宝书] 记忆系统绑定失败', e);
    }
    return;
  }
  if (attempt > 40) return; // 最多约 20s
  setTimeout(() => bindMemoryWhenReady(attempt + 1), 500);
}
