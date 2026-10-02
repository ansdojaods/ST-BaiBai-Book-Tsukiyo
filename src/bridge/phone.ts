/**
 * 小手机联动 API(融合版新增)。
 *
 * 挂在 globalThis.STBaiBaiBook.phone 上,供「月夜来信小手机」等酒馆助手脚本调用。
 * 设计原则:
 *  - 读:getBrief() 给手机一份"剧情简报"(时间/地点/在场人物/好感/计划/历史摘要/锚点),
 *        字符预算可调,手机拿它补齐自身的 capture()(原本依赖 MVU 变量)并喂给手机模型;
 *  - 写:pushNotes() 是手机唯一的写入口,只能写"外部记录",不能改柏宝书的摘要森林;
 *  - API 联动:手机可以列出/借用柏宝书的副 API 渠道发请求、做测活,密钥留在柏宝书内;
 *        仅当用户显式调用 exportChannel() 才把凭据交给手机(用于"把柏宝书渠道导入手机方案")。
 *  - 事件:window 上派发 'st-baibai-book:phone-update',detail.type ∈ external|anchor|memory。
 */
import { apiSettings, type ApiChannel } from '@/api/settings';
import { requestCompletion, testChannel as testChannelRaw, type ChatMsg } from '@/api/client';
import { getContext } from '@/st/context';
import { getSnapshot, getHistory } from '@/public/query';
import { PLUGIN_VERSION } from '@/version';
import { memory } from '@/memory/store';
import { refreshInjection } from '@/memory/inject';
import { calculateRelativeDays, parseStoryDate, weekdayLabel } from '@/memory/timeRel';
import { anchorState, currentAnchor } from '@/anchor/store';
import { fmtNpcAffinity, NPC_AFFINITY_LABELS } from '@/memory/npcRelations';
import { externalState, pushExternalNotes as pushRaw, onExternalChanged, type ExternalNoteInput } from './external';

export const PHONE_UPDATE_EVENT = 'st-baibai-book:phone-update';
export const PHONE_API_VERSION = 1;

export interface PhoneNpcBrief {
  name: string;
  relation: string;
  title: string;
  condition: string;
  location: string;
  important: boolean;
  present: boolean;
  /** 内心好感档位 -2..2;null/undefined=未知 */
  affinityInner: number | null;
  /** 外在态度档位 -2..2;null/undefined=未知 */
  affinityOuter: number | null;
  /** 两侧档位的文字说明(如「内心好感:亲近 / 外在态度:冷淡」) */
  affinityText: string;
  affinityNote: string;
  personality: string;
  desc: string;
}

export interface PhonePlanBrief {
  kind: 'plan' | 'suspense';
  content: string;
  createdTime: string;
  targetTime: string;
  /** 距目标时间的天数(负=已过期);无法计算为 null */
  daysLeft: number | null;
}

export interface PhoneBrief {
  apiVersion: 1;
  pluginVersion: string;
  updatedAt: number;
  chat: { id: string | null; characterName: string | null };
  floors: number;
  coverageComplete: boolean;
  time: string;
  weekday: string;
  location: string;
  protagonist: Record<string, string>;
  npcs: PhoneNpcBrief[];
  presentNpcs: string[];
  plans: PhonePlanBrief[];
  lifeDetails: Array<{ subject: string; text: string; tier: string }>;
  /** 带相对时间的分层历史摘要(按 briefHistoryChars 预算从尾部保留) */
  history: string;
  anchor: { version: number; floor: number; text: string } | null;
  externalCount: number;
}

export interface PhoneChannelInfo {
  id: string;
  name: string;
  model: string;
  host: string;
  hasKey: boolean;
  lastTest: { at: number; ok: boolean; message: string } | null;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  return `…(更早剧情略)\n${text.slice(text.length - max)}`;
}

function daysLeft(now: string, target: string): number | null {
  if (!now || !target || !parseStoryDate(now) || !parseStoryDate(target)) return null;
  const d = calculateRelativeDays(now, target);
  return typeof d === 'number' && Number.isFinite(d) ? d : null;
}

/** 剧情简报:手机侧一次调用拿齐"现在是什么时候、在哪、谁在、关系如何、之前发生过什么" */
export function getBrief(options: { historyChars?: number; anchorChars?: number } = {}): PhoneBrief {
  const snap = getSnapshot();
  const s = apiSettings.phoneBridge;
  const historyChars = Math.max(0, options.historyChars ?? s.briefHistoryChars);
  const anchorChars = Math.max(0, options.anchorChars ?? 1500);
  const here = snap.state.location ?? '';
  const npcs: PhoneNpcBrief[] = snap.npcs.map(n => ({
    name: n.name,
    relation: n.relation ?? '',
    title: n.title ?? '',
    condition: n.condition ?? '',
    location: n.location ?? '',
    important: !!n.important,
    present: !!n.follow || (!!n.location && !!here && (n.location === here || here.includes(n.location) || n.location.includes(here))),
    affinityInner: typeof n.affinityInner === 'number' ? n.affinityInner : null,
    affinityOuter: typeof n.affinityOuter === 'number' ? n.affinityOuter : null,
    affinityText: fmtNpcAffinity(n, false, false),
    affinityNote: n.affinityNote ?? '',
    personality: n.personality ?? '',
    desc: n.desc ?? '',
  }));
  const plans: PhonePlanBrief[] = snap.plans
    .filter(p => p.status === 'open')
    .map(p => ({
      kind: p.kind,
      content: p.content,
      createdTime: p.createdTime ?? '',
      targetTime: p.targetTime ?? '',
      daysLeft: daysLeft(snap.state.time, p.targetTime ?? ''),
    }));
  const hist = historyChars > 0 ? getHistory() : null;
  const anchor = currentAnchor();
  const protagonist: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap.protagonist ?? {})) if (typeof v === 'string' && v) protagonist[k] = v;
  return {
    apiVersion: PHONE_API_VERSION,
    pluginVersion: PLUGIN_VERSION,
    updatedAt: Date.now(),
    chat: { id: snap.chat.id, characterName: snap.chat.characterName },
    floors: getContext()?.chat?.length ?? 0,
    coverageComplete: snap.coverage.complete,
    time: snap.state.time ?? '',
    weekday: snap.state.time ? weekdayLabel(snap.state.time) : '',
    location: here,
    protagonist,
    npcs,
    presentNpcs: npcs.filter(n => n.present).map(n => n.name),
    plans,
    lifeDetails: snap.lifeDetails.filter(d => d.tier !== 'archive').map(d => ({ subject: d.subject ?? '', text: d.text, tier: d.tier })),
    history: hist ? tail(hist.relativeText || hist.text || '', historyChars) : '',
    anchor: anchor && anchorChars > 0 ? { version: anchor.version, floor: anchor.floor, text: tail(anchor.text, anchorChars) } : null,
    externalCount: externalState.notes.length,
  };
}

/** 单个 NPC 的人设卡文本(手机 actorContext 用) */
export function getNpcProfile(name: string): string {
  const key = String(name ?? '').trim();
  if (!key) return '';
  const n = memory.npcs.find(x => x.name === key) ?? memory.npcs.find(x => key.includes(x.name) || x.name.includes(key));
  if (!n) return '';
  const lines: string[] = [`【${n.name}】`];
  const push = (label: string, v?: string | null) => {
    if (v && String(v).trim()) lines.push(`${label}:${String(v).trim()}`);
  };
  push('身份/称呼', n.title);
  push('与主角关系', n.relation);
  push('牵绊', n.ties);
  push('性格', n.personality);
  push('近况', n.condition);
  push('所在', n.location);
  const inner = typeof n.affinityInner === 'number' ? NPC_AFFINITY_LABELS.affinityInner[n.affinityInner + 2] : '';
  const outer = typeof n.affinityOuter === 'number' ? NPC_AFFINITY_LABELS.affinityOuter[n.affinityOuter + 2] : '';
  push('内心好感', inner);
  push('外在态度', outer);
  push('好感备注', n.affinityNote);
  return lines.join('\n');
}

export function pushNotes(source: string, notes: ExternalNoteInput[], opts: { replace?: boolean } = {}): { added: number; updated: number; total: number } {
  if (!apiSettings.phoneBridge.enabled) return { added: 0, updated: 0, total: externalState.notes.length };
  const r = pushRaw(source, notes, opts);
  refreshInjection();
  return r;
}

export function listChannels(): PhoneChannelInfo[] {
  return apiSettings.channels.map(c => ({
    id: c.id,
    name: c.name,
    model: c.model,
    host: host(c.url),
    hasKey: !!c.key,
    lastTest: c.lastTest ?? null,
  }));
}

function findChannel(id: string): ApiChannel {
  const c = apiSettings.channels.find(x => x.id === id || x.name === id);
  if (!c) throw new Error(`柏宝书里没有渠道:${id}`);
  return c;
}

/** 借柏宝书渠道发一次请求(密钥不出柏宝书) */
export async function requestWithChannel(channelId: string, messages: ChatMsg[]): Promise<string> {
  if (!apiSettings.phoneBridge.enabled) throw new Error('柏宝书的小手机联动已关闭');
  const c = findChannel(channelId);
  const msgs = (Array.isArray(messages) ? messages : []).filter(m => m && typeof m.content === 'string' && (m.role === 'system' || m.role === 'user' || m.role === 'assistant'));
  if (!msgs.length) throw new Error('messages 为空');
  return requestCompletion(c, msgs);
}

export async function testChannel(channelId: string, phrase?: string): Promise<{ ok: boolean; message: string }> {
  const c = findChannel(channelId);
  const r = await testChannelRaw(c, phrase);
  getContext()?.saveSettingsDebounced?.();
  return r;
}

/** 导出渠道凭据(用户在手机端显式点击"导入柏宝书渠道"时使用) */
export function exportChannel(channelId: string): { id: string; name: string; url: string; key: string; model: string; temperature: number; maxTokens: number } {
  if (!apiSettings.phoneBridge.enabled) throw new Error('柏宝书的小手机联动已关闭');
  const c = findChannel(channelId);
  return { id: c.id, name: c.name, url: c.url, key: c.key, model: c.model, temperature: c.temperature, maxTokens: c.maxTokens };
}

export function emitPhoneUpdate(type: 'external' | 'anchor' | 'memory', detail: Record<string, unknown> = {}): void {
  try {
    const w = (typeof window !== 'undefined' ? window : globalThis) as Window & typeof globalThis;
    w.dispatchEvent(new CustomEvent(PHONE_UPDATE_EVENT, { detail: { type, ...detail, at: Date.now() } }));
  } catch (e) {
    console.warn('[柏宝书] 派发联动事件失败', e);
  }
}

export interface PhoneBridgeApi {
  readonly apiVersion: 1;
  getBrief(options?: { historyChars?: number; anchorChars?: number }): PhoneBrief;
  getNpcProfile(name: string): string;
  getAnchor(): { version: number; floor: number; text: string } | null;
  pushNotes(source: string, notes: ExternalNoteInput[], opts?: { replace?: boolean }): { added: number; updated: number; total: number };
  listNotes(source?: string): Array<{ id: string; source: string; kind: string; title?: string; text: string; time?: string; floor?: number; ts: number; pinned?: boolean }>;
  listChannels(): PhoneChannelInfo[];
  requestWithChannel(channelId: string, messages: ChatMsg[]): Promise<string>;
  testChannel(channelId: string, phrase?: string): Promise<{ ok: boolean; message: string }>;
  exportChannel(channelId: string): { id: string; name: string; url: string; key: string; model: string; temperature: number; maxTokens: number };
  isEnabled(): boolean;
}

export function createPhoneApi(): PhoneBridgeApi {
  return Object.freeze({
    apiVersion: PHONE_API_VERSION,
    getBrief,
    getNpcProfile,
    getAnchor: () => {
      const a = currentAnchor();
      return a ? { version: a.version, floor: a.floor, text: a.text } : null;
    },
    pushNotes,
    listNotes: (source?: string) => externalState.notes.filter(n => !source || n.source === source).map(n => ({ ...n })),
    listChannels,
    requestWithChannel,
    testChannel,
    exportChannel,
    isEnabled: () => !!apiSettings.phoneBridge.enabled,
  });
}

let bound = false;
export function bindPhoneBridge(): void {
  if (bound) return;
  bound = true;
  onExternalChanged(info => emitPhoneUpdate('external', info));
  // 锚点变化也通知手机(手机可据此刷新记忆导入)
  let lastRev = anchorState.rev;
  setInterval(() => {
    if (anchorState.rev !== lastRev) {
      lastRev = anchorState.rev;
      emitPhoneUpdate('anchor', { versions: anchorState.anchors.length });
    }
  }, 3000);
}

/* ======================= 从小手机导入 API 方案 ======================= */

export interface PhoneProfileView {
  id: string;
  name: string;
  url: string;
  model: string;
  hasKey: boolean;
  temperature: number;
  maxTokens: number;
}

/**
 * 读取小手机镜像到 extensionSettings.tsukiyo_phone 的 openai 型方案(含 syncKeys 开启时的密钥)。
 * 「跟随酒馆」(type=tavern)没有独立地址,不在导入范围。
 */
export function listPhoneProfiles(): PhoneProfileView[] {
  const es = getContext()?.extensionSettings as Record<string, unknown> | undefined;
  const box = es?.tsukiyo_phone as { config?: { profiles?: unknown[] }; secrets?: Record<string, string> } | undefined;
  const profiles = Array.isArray(box?.config?.profiles) ? box!.config!.profiles! : [];
  const secrets = box?.secrets ?? {};
  return profiles
    .map(p => p as Record<string, unknown>)
    .filter(p => p && p.type === 'openai' && typeof p.url === 'string' && p.url)
    .map(p => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? '未命名方案'),
      url: String(p.url ?? ''),
      model: String(p.model ?? ''),
      hasKey: typeof secrets[String(p.id ?? '')] === 'string' && !!secrets[String(p.id ?? '')],
      temperature: typeof p.temperature === 'number' ? p.temperature : 1,
      maxTokens: typeof p.maxTokens === 'number' ? p.maxTokens : 4096,
    }));
}

/** 把一个手机方案导入为柏宝书渠道(同 url+model 已存在则更新密钥与名称,不重复建) */
export function importPhoneProfile(profileId: string, makeChannel: () => ApiChannel): { channel: ApiChannel; created: boolean } {
  const es = getContext()?.extensionSettings as Record<string, unknown> | undefined;
  const box = es?.tsukiyo_phone as { config?: { profiles?: unknown[] }; secrets?: Record<string, string> } | undefined;
  const p = (Array.isArray(box?.config?.profiles) ? box!.config!.profiles! : []).map(x => x as Record<string, unknown>).find(x => String(x.id) === profileId);
  if (!p) throw new Error('小手机里没有这个方案');
  const url = String(p.url ?? '').trim();
  const model = String(p.model ?? '').trim();
  const key = String(box?.secrets?.[profileId] ?? '');
  let channel = apiSettings.channels.find(c => c.url.trim().replace(/\/+$/, '') === url.replace(/\/+$/, '') && c.model === model);
  const created = !channel;
  if (!channel) {
    channel = makeChannel();
    apiSettings.channels.push(channel);
  }
  channel.name = `手机·${String(p.name ?? '方案')}`;
  channel.url = url;
  channel.model = model;
  if (key) channel.key = key;
  if (typeof p.temperature === 'number') channel.temperature = p.temperature;
  if (typeof p.maxTokens === 'number' && p.maxTokens > 0) channel.maxTokens = Math.max(channel.maxTokens, p.maxTokens);
  return { channel, created };
}
