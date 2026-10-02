/** 手写补摘：仅处理现有未摘要 AI 楼，不调用任何生成/向量 API。 */
import { getContext, type STMessage } from '@/st/context';
import { getLeaf, invalidateSummaryAncestors, makeLeafId } from './apply';
import { batchState, engineState, pendingAiFloors } from './engine';
import { recomputeDerived, saveMemory, scheduleLeafFlush } from './store';
import { refreshInjection } from './inject';
import { clampToTimeTags, parseTimeRange } from './timeTag';
import { invalidateRecallCache } from './vector/cache';
import { createRestorePoint } from '@/backend/restore';
import type { LeafExtra } from './types';

export interface ManualFloorTicket {
  chatId: string;
  chat: STMessage[];
  message: STMessage;
  floor: number;
  body: string;
  swipe: number;
  oldLeaf: LeafExtra | undefined;
}
const swipeOf = (m: STMessage) => typeof m.swipe_id === 'number' ? m.swipe_id : 0;
function assertIdle(): void {
  if (engineState.running || batchState.running) throw new Error('摘要任务正在进行，请等待完成或取消批量补摘后再手写');
}
export function beginManualFloorSummary(floor: number): ManualFloorTicket {
  assertIdle();
  const ctx = getContext();
  const chatId = ctx?.getCurrentChatId?.();
  if (!ctx || !chatId) throw new Error('请先打开一个聊天');
  if (!Number.isInteger(floor) || !pendingAiFloors(ctx.chat).includes(floor)) {
    throw new Error('该楼层不是待摘要的 AI 消息；已有摘要请使用编辑入口');
  }
  const message = ctx.chat[floor];
  return { chatId, chat: ctx.chat, message, floor, body: message.mes, swipe: swipeOf(message), oldLeaf: getLeaf(message) };
}
export function addManualFloorSummary(ticket: ManualFloorTicket, text: string, timeStart = '', timeEnd = ''): LeafExtra {
  assertIdle();
  const body = text.trim();
  if (!body) throw new Error('请填写摘要正文');
  if (body.length > 60000) throw new Error('单条手写摘要请控制在60000字符以内');
  if (timeStart.length > 200 || timeEnd.length > 200) throw new Error('时间字段过长');
  const ctx = getContext();
  if (!ctx || ctx.getCurrentChatId?.() !== ticket.chatId || ctx.chat !== ticket.chat) throw new Error('聊天已切换，请重新选择楼层');
  const m = ctx.chat[ticket.floor];
  if (m !== ticket.message || m.mes !== ticket.body || swipeOf(m) !== ticket.swipe) throw new Error('楼层或正文/swipe已变化，请关闭并重新选择楼层');
  if (getLeaf(m) !== ticket.oldLeaf || !pendingAiFloors(ctx.chat).includes(ticket.floor)) throw new Error('该楼层的摘要已变化，不会覆盖，请重新打开');
  const tag = parseTimeRange(clampToTimeTags(m.mes));
  const start = timeStart.trim() || tag.start || undefined;
  const end = timeEnd.trim() || tag.end || undefined;
  // 手写文本不猜测结构化变化；时间只作摘要范围标签，不伪造 state delta。
  const leaf: LeafExtra = { id: makeLeafId(), text: body, delta: {}, createdAt: Date.now(), swipe: ticket.swipe, v: 1, timeStart: start, timeEnd: end };
  createRestorePoint('手写补摘前');
  if (ticket.oldLeaf) invalidateSummaryAncestors(ticket.oldLeaf.id);
  (m.extra ??= {}).bbs_leaf = leaf;
  invalidateRecallCache();
  recomputeDerived();
  saveMemory();
  scheduleLeafFlush();
  refreshInjection();
  return leaf;
}
