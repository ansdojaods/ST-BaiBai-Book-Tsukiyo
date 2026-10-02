import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as context from '@/st/context';
import * as client from '@/api/client';
import type { STContext, STMessage } from '@/st/context';
import { apiSettings, defaults } from '@/api/settings';
import { memory, recomputeDerived, derivedMeta } from './store';
import { createEmptyMemory } from './types';
import { engineState, batchState } from './engine';
import { leafValid } from './apply';
import { beginManualFloorSummary, addManualFloorSummary } from './manual';
import { getBrief, createPhoneApi, getNpcProfile } from '@/bridge/phone';
import { externalState } from '@/bridge/external';
import { restoreState } from '@/backend/restore';
import { anchorState } from '@/anchor/store';

const message = (): STMessage => ({ name: 'Character', mes: '这是一条尚未摘要的真实回复。', is_user: false, is_system: false, extra: {}, swipe_id: 0 });
let ctx: STContext;
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(memory, createEmptyMemory()); Object.assign(apiSettings, defaults());
  engineState.running = false; batchState.running = false; restoreState.points = [];
  anchorState.anchors = []; externalState.notes = [];
  ctx = { chat: [message()], chatMetadata: {}, name1: 'User', name2: 'Character',
    getCurrentChatId: () => 'chat-A', saveChat: vi.fn().mockResolvedValue(undefined),
    saveMetadataDebounced: vi.fn(), setExtensionPrompt: vi.fn() } as unknown as STContext;
  vi.spyOn(context, 'getContext').mockImplementation(() => ctx);
  vi.spyOn(client, 'requestViaMainApi').mockRejectedValue(new Error('AI unavailable'));
  vi.spyOn(client, 'requestCompletion').mockRejectedValue(new Error('AI unavailable'));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('manual floor summary without AI', () => {
  it('saves a valid leaf, removes pending state and exposes it to phone history without AI', async () => {
    apiSettings.enabled = false; apiSettings.autoSummaryEnabled = false;
    recomputeDerived(); expect(derivedMeta.pendingFloors).toContain(0);
    const original = ctx.chat[0].mes;
    const leaf = addManualFloorSummary(beginManualFloorSummary(0), '两人约好周六在咖啡馆见面。', '2026/10/2 09:00', '2026/10/2 09:10');
    expect(leafValid(ctx.chat[0])).toBe(true); expect(leaf.delta).toEqual({});
    expect(derivedMeta.pendingFloors).not.toContain(0); expect(ctx.chat[0].mes).toBe(original);
    expect(getBrief().history).toContain('两人约好周六');
    await vi.advanceTimersByTimeAsync(1600);
    expect(ctx.saveChat).toHaveBeenCalled();
    expect(client.requestViaMainApi).not.toHaveBeenCalled(); expect(client.requestCompletion).not.toHaveBeenCalled();
  });
  it('rejects empty text before mutation', () => {
    expect(() => addManualFloorSummary(beginManualFloorSummary(0), '  ')).toThrow('填写');
    expect(ctx.chat[0].extra!.bbs_leaf).toBeUndefined();
  });
  it('does not overwrite an existing valid summary', () => {
    addManualFloorSummary(beginManualFloorSummary(0), '已有摘要');
    expect(() => beginManualFloorSummary(0)).toThrow('已有摘要');
  });
  it.each(['chat', 'message', 'body', 'swipe', 'deleted', 'leaf'] as const)('rejects changed %s since the editor opened', change => {
    const ticket = beginManualFloorSummary(0);
    if (change === 'chat') ctx = { ...ctx, chat: [message()], getCurrentChatId: () => 'chat-B' };
    if (change === 'message') ctx.chat[0] = message();
    if (change === 'body') ctx.chat[0].mes = 'edited';
    if (change === 'swipe') ctx.chat[0].swipe_id = 1;
    if (change === 'deleted') ctx.chat.splice(0, 1);
    if (change === 'leaf') ctx.chat[0].extra!.bbs_leaf = { id: 'other', text: 'new', delta: {}, createdAt: 1, swipe: 0, v: 1 };
    expect(() => addManualFloorSummary(ticket, '不该被写入')).toThrow();
    expect(JSON.stringify(ctx.chat)).not.toContain('不该被写入');
  });
  it('does not collide with an in-flight AI summary', () => {
    const ticket = beginManualFloorSummary(0); engineState.running = true;
    expect(() => addManualFloorSummary(ticket, 'summary')).toThrow('任务正在进行');
  });
  it('allows the new swipe to replace a stale leaf and records a recovery point', () => {
    addManualFloorSummary(beginManualFloorSummary(0), '旧页摘要');
    ctx.chat[0].swipe_id = 1;
    const leaf = addManualFloorSummary(beginManualFloorSummary(0), '新页摘要');
    expect(leaf.swipe).toBe(1); expect(restoreState.points).toHaveLength(1);
    expect(restoreState.points[0].snapshot.leaves[0].leaf.text).toBe('旧页摘要');
  });
  it('uses existing time tags as optional defaults', () => {
    ctx.chat[0].mes = '<bbs_start>2026/10/2 10:00</bbs_start>发生事件<bbs_end>2026/10/2 10:20</bbs_end>';
    expect(addManualFloorSummary(beginManualFloorSummary(0), '事件摘要')).toMatchObject({ timeStart: '2026/10/2 10:00', timeEnd: '2026/10/2 10:20', delta: {} });
  });
  it.each(['user', 'system', 'omitted', 'missing'] as const)('rejects a %s floor', kind => {
    if (kind === 'user') ctx.chat[0].is_user = true;
    if (kind === 'system') { ctx.chat[0].is_system = true; ctx.chat[0].extra!.type = 'narrator'; }
    if (kind === 'omitted') ctx.chat[0].extra!.bbs_omit = true;
    expect(() => beginManualFloorSummary(kind === 'missing' ? 99 : 0)).toThrow('待摘要');
  });
});

describe('independent phone read permission', () => {
  it('read-off prevents memory exports but leaves write-back available', () => {
    apiSettings.phoneBridge.shareMemory = false;
    const api = createPhoneApi();
    expect(api.isEnabled()).toBe(true); expect(api.canReadMemory()).toBe(false);
    expect(() => getBrief()).toThrow('读取已关闭'); expect(getNpcProfile('Character')).toBe(''); expect(api.getAnchor()).toBeNull();
    expect(api.pushNotes('phone', [{ id: 'x', text: 'phone record' }]).added).toBe(1);
  });
  it('legacy settings gain the read permission by default', () => {
    expect(defaults().phoneBridge.shareMemory).toBe(true);
  });
});
