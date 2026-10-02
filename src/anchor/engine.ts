import { captureSession, sessionCurrent, captureInput } from '@/st/session';
/**
 * 锚点日记:引擎(融合版新增)。
 *
 * 职责:
 *  1. 催更检测:生成拦截器里查看最近一条用户发言是否含触发词 → 本回合向主模型注入锚点指令;
 *  2. 收割:AI 回复落地/编辑/切换 swipe 后扫描正文里的 <anchor> 块 → 存为新版本(按消息去重);
 *  3. 显示隐藏:用 ST 正则(仅显示层)把正文里的 <anchor> 块藏起来,提示词仍保留;
 *  4. 静默生成:不打扰正文,用副 API(或主 API)把柏宝书历史摘要 + 最近楼层原文 + 上一份锚点喂给模型,
 *     直接产出新版锚点(适合不想让锚点占用正文输出的用户);
 *  5. 注入:当前锚点作为独立 slot 注入(深度可调),与柏宝书历史/状态注入并列。
 */
import { watch } from 'vue';
import { getContext, appendChatInput, type STMessage } from '@/st/context';
import { apiSettings, engineActiveHere, getChannelForTask, getFallbackChannels } from '@/api/settings';
import { requestCompletion, requestViaMainApi, mainApiAvailable, type ChatMsg } from '@/api/client';
import { memory, scheduleLeafFlush } from '@/memory/store';
import { selectInjectionNodes, renderHistoryNodesWithRelative, refreshInjection } from '@/memory/inject';
import { cleanBody, latestStoryTime } from '@/memory/timeTag';
import { JAILBREAK_PROMPT } from '@/memory/prompts';
import { ensureHideRegex, removeHideRegexById } from '@/st/hideRegex';
import { trashPush } from '@/backend/trash';
import {
  anchorState,
  anchorSourceCurrent,
  addAnchor,
  currentAnchor,
  loadAnchors,
  removeAnchor,
  type AnchorEntry,
} from './store';
import {
  ANCHOR_API_SYSTEM,
  ANCHOR_TAG,
  DEFAULT_ANCHOR_INSTRUCTION,
  RE_ANCHOR_BLOCK,
  buildAnchorApiUser,
} from './prompts';

const IN_CHAT = 1;
const ROLE_SYSTEM = 0;
/** 锚点指令 slot:深度 0 = 紧贴最新消息,确保模型读到"这回合要写锚点" */
const INSTRUCTION_INJECT_KEY = 'baibai_book_anchor_instruction';
const INSTRUCTION_INJECT_DEPTH = 0;
const HIDE_ANCHOR_SCRIPT_ID = 'bbs-hide-anchor-tag';
/** 消息 extra 里记录"该消息的锚点块已收割为哪个版本",避免编辑/重渲染重复入库 */
const EXTRA_KEY = 'bbs_anchor';

export function effectiveInstruction(): string {
  return apiSettings.anchor.instruction.trim() || DEFAULT_ANCHOR_INSTRUCTION;
}

/** 从一段正文里取出最后一个 <anchor> 块的内部文本;没有返回 '' */
export function extractAnchorBlock(mes: string): string {
  if (!mes) return '';
  let last = '';
  RE_ANCHOR_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_ANCHOR_BLOCK.exec(mes))) last = m[1] ?? '';
  return last.trim();
}

/** 简单稳定哈希,用于判断同一消息里的锚点块是否已变化 */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 扫描某楼层正文,发现新的锚点块就入库(同一消息同一内容只入一次) */
export function harvestAnchorAt(index: number): AnchorEntry | null {
  if (!engineActiveHere() || !apiSettings.anchor.enabled) return null;
  const chat = getContext()?.chat;
  const msg = chat?.[index];
  if (!msg || msg.is_user) return null;
  const block = extractAnchorBlock(String(msg.mes ?? ''));
  if (!block) { refreshInjection(); return null; }
  const h = hash(block);
  const extra = (msg.extra ??= {}) as Record<string, unknown>;
  const prev = extra[EXTRA_KEY] as { hash?: string; id?: string } | undefined;
  const existing = anchorState.anchors.find(a => a.source === 'chat' && (a.id === prev?.id || a.origin?.messageId === extra.bbs_message_id) && anchorSourceCurrent(a) && (a.origin?.block ?? a.text) === block);
  if (existing) { extra[EXTRA_KEY] = { hash: h, id: existing.id }; refreshInjection(); return null; }
  const entry = addAnchor(block, index, 'chat');
  extra[EXTRA_KEY] = { hash: h, id: entry.id };
  // 去重标记写在消息 extra 上,复用柏宝书的 saveChat 节流链路落盘;锚点本体已在 metadata
  scheduleLeafFlush();
  refreshInjection();
  return entry;
}

/** 最近一条用户发言(swipe/regenerate 时末尾是 AI 楼,需回溯) */
function lastUserMessage(chat: STMessage[] | undefined): STMessage | null {
  if (!chat) return null;
  for (let i = chat.length - 1; i >= 0 && i >= chat.length - 4; i--) {
    if (chat[i]?.is_user) return chat[i];
  }
  return null;
}

/**
 * 生成拦截器调用:决定本回合是否注入锚点指令。
 *  - 功能关 → 清空 slot;
 *  - 非按需(onDemand=false)→ 每回合注入;
 *  - 按需 → 最近一条用户发言包含触发词才注入。
 */
export function handleAnchorIntercept(): void {
  const ctx = getContext();
  if (!ctx?.setExtensionPrompt) return;
  const s = apiSettings.anchor;
  let text = '';
  if (engineActiveHere() && s.enabled) {
    if (!s.onDemand) text = effectiveInstruction();
    else {
      const trigger = s.triggerPhrase.trim();
      const last = lastUserMessage(ctx.chat);
      if (trigger && last && String(last.mes ?? '').includes(trigger)) text = effectiveInstruction();
    }
  }
  ctx.setExtensionPrompt(INSTRUCTION_INJECT_KEY, text, IN_CHAT, INSTRUCTION_INJECT_DEPTH, false, ROLE_SYSTEM, null);
}

/** 「生成锚点日记」按钮:把触发词填进输入框,用户随手一发即可 */
export function insertTriggerIntoInput(): boolean {
  const t = apiSettings.anchor.triggerPhrase.trim();
  if (!t) return false;
  return appendChatInput(t);
}

/** 同步显示隐藏正则(开→注册/更新,关→移除) */
export function syncAnchorHideRegex(): void {
  const s = apiSettings.anchor;
  if (engineActiveHere() && s.enabled && s.hideTagInChat) {
    ensureHideRegex({
      id: HIDE_ANCHOR_SCRIPT_ID,
      scriptName: '柏宝书 · 隐藏锚点日记块',
      findRegex: `/<${ANCHOR_TAG}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${ANCHOR_TAG}>/gi`,
    });
  } else {
    removeHideRegexById(HIDE_ANCHOR_SCRIPT_ID);
  }
}

/** 删除一版锚点:先进回收站再移除 */
export function deleteAnchorToTrash(id: string): boolean {
  const a = anchorState.anchors.find(x => x.id === id);
  if (!a) return false;
  trashPush({ kind: 'anchor', title: `锚点日记 第${a.version}版`, payload: JSON.parse(JSON.stringify(a)) });
  removeAnchor(id);
  refreshInjection();
  return true;
}

/** 最近 N 个 AI 楼层(含紧邻的用户发言)的清洗正文,用作静默生成材料 */
function recentFloorsText(chat: STMessage[], aiFloors: number, maxChars: number): { text: string; lastAi: number } {
  const parts: string[] = [];
  let count = 0;
  let lastAi = -1;
  for (let i = chat.length - 1; i >= 0 && count < aiFloors; i--) {
    const m = chat[i];
    if (!m || m.is_system) continue;
    const body = cleanBody(String(m.mes ?? ''));
    if (!body) continue;
    if (!m.is_user) {
      count++;
      if (lastAi < 0) lastAi = i;
    }
    parts.unshift(`#${i} ${m.is_user ? '【用户】' : `【${m.name || 'AI'}】`}\n${body}`);
  }
  let text = parts.join('\n\n');
  if (text.length > maxChars) text = `…(前文略)\n${text.slice(text.length - maxChars)}`;
  return { text, lastAi };
}

/**
 * 静默生成锚点:走副 API(任务「resummary」的渠道指派)或主 API。
 * 成功后入库为 source='api' 的新版本并刷新注入;失败写 anchorState.lastError。
 */
export async function generateAnchorSilently(opts: { recentAiFloors?: number } = {}): Promise<AnchorEntry | null> {
  if (!engineActiveHere() || !apiSettings.anchor.enabled || anchorState.busy) return null;
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!ctx || !chat?.length) {
    anchorState.lastError = '当前没有打开的聊天';
    return null;
  }
  const session = captureSession();
  const verifyInput = captureInput(chat);
  const forestBefore = JSON.stringify(memory.summaries);
  const anchorsBefore = JSON.stringify(anchorState.anchors);
  const task = ++anchorTask;
  anchorState.busy = true;
  anchorState.lastError = '';
  try {
    const channel = getChannelForTask('anchor') ?? getChannelForTask('resummary');
    let send: (messages: ChatMsg[]) => Promise<string>;
    if (channel) {
      send = async messages => {
        try {
          return await requestCompletion(channel, messages);
        } catch (err) {
          const backups = getFallbackChannels(channel.id).slice(0, 2);
          for (const backup of backups) {
            try {
              return await requestCompletion(backup, messages);
            } catch {
              /* 尝试下一个备选渠道 */
            }
          }
          throw err;
        }
      };
    } else if (mainApiAvailable()) {
      send = messages => requestViaMainApi(messages);
    } else {
      throw new Error('未指派副 API 渠道,且当前主 API 不可用');
    }

    const nodes = selectInjectionNodes(memory.summaries, chat);
    const history = nodes.length ? renderHistoryNodesWithRelative(nodes, latestStoryTime(chat)) : '';
    const { text: recent, lastAi } = recentFloorsText(chat, opts.recentAiFloors ?? 6, 12000);
    const prev = currentAnchor();
    const jb = apiSettings.prompts.jailbreak.trim() || JAILBREAK_PROMPT;
    const messages: ChatMsg[] = [
      { role: 'system', content: jb },
      { role: 'system', content: ANCHOR_API_SYSTEM },
      {
        role: 'user',
        content: buildAnchorApiUser({
          history,
          recent,
          previous: prev?.text ?? '',
          userName: ctx.name1 ?? '',
          charName: ctx.name2 ?? '',
        }),
      },
    ];
    const raw = await send(messages);
    verifyInput();
    if (!engineActiveHere() || !apiSettings.anchor.enabled || JSON.stringify(memory.summaries) !== forestBefore || JSON.stringify(anchorState.anchors) !== anchorsBefore) throw new Error('锚点输入或开关已变化，请重新生成');
    const block = extractAnchorBlock(raw) || raw.trim();
    if (!block) throw new Error('模型没有返回锚点内容');
    const entry = addAnchor(block, lastAi >= 0 ? lastAi : chat.length - 1, 'api');
    refreshInjection();
    return entry;
  } catch (e) {
    if (sessionCurrent(session) && task === anchorTask) anchorState.lastError = e instanceof Error ? e.message : String(e);
    return null;
  } finally {
    if (task === anchorTask) anchorState.busy = false;
  }
}

let anchorTask = 0;
let bound = false;
/** 启动时绑定:聊天切换重载、消息事件收割、设置变化同步正则与注入 */
export function bindAnchor(): void {
  if (bound) return;
  bound = true;
  const ctx = getContext();
  loadAnchors();
  syncAnchorHideRegex();
  if (ctx?.eventSource && ctx.eventTypes) {
    const es = ctx.eventSource;
    const et = ctx.eventTypes;
    es.on(et.CHAT_CHANGED, () => {
      anchorTask++;
      anchorState.busy = false;
      loadAnchors();
      handleAnchorIntercept();
      syncAnchorHideRegex();
      handleAnchorIntercept();
      refreshInjection();
    });
    const onFloor = (idx: unknown) => {
      const i = typeof idx === 'number' ? idx : Number(idx);
      if (Number.isFinite(i)) harvestAnchorAt(i);
    };
    es.on(et.MESSAGE_RECEIVED, onFloor);
    es.on(et.MESSAGE_EDITED, onFloor);
    es.on(et.MESSAGE_SWIPED, onFloor);
    if (et.MESSAGE_DELETED) es.on(et.MESSAGE_DELETED, () => refreshInjection());
  }
  watch(
    () => [apiSettings.enabled, apiSettings.excludedChars, apiSettings.anchor.enabled, apiSettings.anchor.hideTagInChat] as const,
    () => {
      syncAnchorHideRegex();
      handleAnchorIntercept();
      refreshInjection();
    },
  );
  watch(
    () => [apiSettings.anchor.injectDepth, apiSettings.anchor.maxChars, apiSettings.anchor.supersedeHistory] as const,
    () => refreshInjection(),
  );
}
