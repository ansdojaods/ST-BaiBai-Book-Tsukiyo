import { getContext, type STMessage } from './context';

let epoch = 0;
const bound = new WeakSet<object>();
export function bindSessionGuard(): void {
  const ctx = getContext(), events = ctx?.eventSource;
  if (events && ctx?.eventTypes?.CHAT_CHANGED && !bound.has(events)) {
    bound.add(events);
    if (ctx?.eventTypes?.CHAT_CHANGED) events.on(ctx.eventTypes.CHAT_CHANGED, () => { epoch++; });
  }
}
function ownerKey(): string {
  const c = getContext();
  return JSON.stringify([c?.groupId ?? '', c?.characters?.[Number(c?.characterId)]?.avatar ?? c?.characterId ?? c?.name2 ?? '', c?.getCurrentChatId?.() ?? '']);
}
export interface SessionTicket { chat: STMessage[]; key: string; epoch: number }
export function captureSession(): SessionTicket {
  bindSessionGuard();
  return { chat: getContext()?.chat ?? [], key: ownerKey(), epoch };
}
export function sessionCurrent(t: SessionTicket): boolean {
  return t.epoch === epoch && t.key === ownerKey() && getContext()?.chat === t.chat;
}
export class StaleTaskError extends Error {
  constructor() { super('聊天、消息或摘要输入已变化，旧任务结果已丢弃，请重新操作'); }
}
export function assertSession(t: SessionTicket): void { if (!sessionCurrent(t)) throw new StaleTaskError(); }
/** 只冻结请求实际读取的前缀；在其后追加新回复不会使摘要失效。 */
export function captureInput(chat: STMessage[], end = chat.length): () => void {
  const session = captureSession();
  if (session.chat !== chat) throw new StaleTaskError();
  const inputs = chat.slice(0, end).map(m => ({ m, body: m.mes, swipe: m.swipe_id ?? 0, name: m.name, user: m.is_user, leaf: JSON.stringify(m.extra?.bbs_leaf), omit: m.extra?.bbs_omit }));
  return () => {
    assertSession(session);
    for (let i = 0; i < inputs.length; i++) {
      const x = inputs[i], m = chat[i];
      if (m !== x.m || m.mes !== x.body || m.name !== x.name || m.is_user !== x.user || (m.swipe_id ?? 0) !== x.swipe || JSON.stringify(m.extra?.bbs_leaf) !== x.leaf || m.extra?.bbs_omit !== x.omit) throw new StaleTaskError();
    }
  };
}

export interface MessageIdentity { id: string; fingerprint: string; swipe: number }
let idSeq = 0;
export function messageFingerprint(m: STMessage): string {
  const s = JSON.stringify([m.name, !!m.is_user, m.mes]);
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 16777619); b = Math.imul(b ^ s.charCodeAt(i), 3266489917); }
  return `${s.length}:${a >>> 0}:${b >>> 0}`;
}
export function identifyMessage(m: STMessage): MessageIdentity {
  const extra = (m.extra ??= {});
  if (typeof extra.bbs_message_id !== 'string' || !extra.bbs_message_id) {
    extra.bbs_message_id = globalThis.crypto?.randomUUID?.() ?? `msg_${Date.now().toString(36)}_${++idSeq}_${Math.random().toString(36).slice(2)}`;
  }
  return { id: extra.bbs_message_id as string, fingerprint: messageFingerprint(m), swipe: m.swipe_id ?? 0 };
}
export function matchesMessage(m: STMessage | undefined, identity: MessageIdentity | undefined): boolean {
  return !!m && !!identity && m.extra?.bbs_message_id === identity.id && (m.swipe_id ?? 0) === identity.swipe && messageFingerprint(m) === identity.fingerprint;
}
