import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as context from '@/st/context';
import type { STContext, STMessage } from '@/st/context';
import * as client from '@/api/client';
import * as settings from '@/api/settings';
import * as notices from '@/st/toast';
import { apiSettings, defaults, newChannel } from '@/api/settings';
import { memory, recomputeDerived } from '@/memory/store';
import { createEmptyMemory, type MemSummary } from '@/memory/types';
import { runSummary, handleGenerationIntercept, currentSummaryPromise, batchBackfill, summarizeSelected, checkResummary, syncHiddenNow } from '@/memory/engine';
import { deleteLeafAt, deleteSummary, deleteSummarySubtrees, leafValid } from '@/memory/apply';
import { generateAnchorSilently, harvestAnchorAt, handleAnchorIntercept, bindAnchor } from '@/anchor/engine';
import { addAnchor, anchorState, currentAnchor, loadAnchors, ANCHOR_META_KEY } from '@/anchor/store';
import { externalState, loadExternal, pushExternalNotes, selectExternalNotes, removeExternalNote, setExternalPinned, buildExternalInjectionText, EXTERNAL_META_KEY } from '@/bridge/external';
import { restoreState, buildSnapshot, parseSnapshot, applySnapshot, restoreTrashEntry, createRestorePoint } from '@/backend/restore';
import { trashState } from '@/backend/trash';
import { importPhoneProfile } from '@/bridge/phone';
import { createNewChatWithCarryover } from '@/memory/carryover';
import { beginManualFloorSummary, addManualFloorSummary } from '@/memory/manual';
import { captureSession, sessionCurrent } from '@/st/session';

function msg(text: string, id?: string): STMessage {
  return { name: 'Character', is_user: false, is_system: false, mes: text, swipe_id: 0,
    extra: id ? { bbs_leaf: { id, text: `summary-${text}`, delta: {}, createdAt: 1, swipe: 0, v: 1 } } : {} };
}
let bus: EventEmitter, active: STContext;
function host(id: string, chat: STMessage[] = [msg(id)]): STContext {
  return { chat, chatMetadata: {}, name1: 'User', name2: 'Character', characterId: 0, characters: [{ avatar: 'character.png', name: 'Character' }],
    eventSource: bus, eventTypes: { CHAT_CHANGED: 'chat_changed', MESSAGE_RECEIVED: 'message_received', MESSAGE_EDITED: 'message_edited', MESSAGE_SWIPED: 'message_swiped', MESSAGE_DELETED: 'message_deleted' },
    getCurrentChatId: () => id, getRequestHeaders: () => ({}),
    saveChat: vi.fn().mockResolvedValue(undefined), saveMetadata: vi.fn().mockResolvedValue(undefined),
    saveMetadataDebounced: vi.fn(), saveSettingsDebounced: vi.fn(), extensionSettings: {},
    setExtensionPrompt: vi.fn(), reloadCurrentChat: vi.fn().mockResolvedValue(undefined),
  } as unknown as STContext;
}
function switchTo(ctx: STContext) { active = ctx; Object.assign(memory, createEmptyMemory()); loadAnchors(); loadExternal(); bus.emit('chat_changed'); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function sum(id: string, level = 1, childIds: string[] = []): MemSummary { return { id, text: id, level, childIds, createdAt: 1, auto: false }; }
beforeEach(() => {
  vi.useFakeTimers(); bus = new EventEmitter();
  Object.assign(memory, createEmptyMemory()); Object.assign(apiSettings, defaults());
  apiSettings.enabled = true; apiSettings.anchor.enabled = true;
  anchorState.anchors = []; anchorState.busy = false; externalState.notes = [];
  trashState.items = []; restoreState.points = []; active = host('A');
  vi.spyOn(context, 'getContext').mockImplementation(() => active);
  vi.spyOn(notices, 'toast').mockImplementation(() => {});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
function delayedSummary() {
  const result = deferred<string>(), started = deferred<void>();
  vi.spyOn(settings, 'getChannelForTask').mockReturnValue(null);
  vi.spyOn(context, 'getCheckWorldInfo').mockResolvedValue(null);
  vi.spyOn(client, 'mainApiAvailable').mockReturnValue(true);
  vi.spyOn(client, 'requestViaMainApi').mockImplementation(() => { started.resolve(); return result.promise; });
  return { result, started };
}
const reply = JSON.stringify({ summary: '请求发起时的摘要', timeStart: '2026/10/2 10:00', timeEnd: '2026/10/2 10:05' });

describe('会话与异步输入护栏（真实模块、模拟宿主）', () => {
  it('B01: A 锚点等待时切 B，结果不写 A/B 的任何 metadata', async () => {
    const { result, started } = delayedSummary(); const a = active, b = host('B');
    const pending = generateAnchorSilently(); await started.promise; switchTo(b);
    result.resolve('<anchor>A private</anchor>'); expect(await pending).toBeNull();
    expect(b.chatMetadata[ANCHOR_META_KEY]).toBeUndefined(); expect(a.chatMetadata[ANCHOR_META_KEY]).toBeUndefined();
    expect(anchorState.anchors).toEqual([]);
  });
  it('A→B→A 即使原数组/ID 完全相同也使旧票据失效', () => {
    const a = active, ticket = captureSession(); switchTo(host('B')); switchTo(a);
    expect(sessionCurrent(ticket)).toBe(false);
  });
  it('手写弹窗也拒绝 A→B→A 的旧票据', () => {
    const a = active, ticket = beginManualFloorSummary(0); switchTo(host('B')); switchTo(a);
    expect(() => addManualFloorSummary(ticket, '旧弹窗')).toThrow('聊天'); expect(active.chat[0].extra?.bbs_leaf).toBeUndefined();
  });
  it.each(['swipe', 'edit', 'delete', 'replace', 'switch', 'reenter'] as const)('N06: 摘要等待时 %s，不落下旧叶子', async kind => {
    const { result, started } = delayedSummary(); const a = active;
    const pending = runSummary(0, { checkResummary: false }); await started.promise;
    if (kind === 'swipe') active.chat[0].swipe_id = 1;
    if (kind === 'edit') active.chat[0].mes = '新的正文';
    if (kind === 'delete') active.chat.splice(0, 1);
    if (kind === 'replace') active.chat[0] = msg('另一条同楼消息');
    if (kind === 'switch' || kind === 'reenter') switchTo(host('B'));
    if (kind === 'reenter') switchTo(a);
    result.resolve(reply); await pending;
    expect(a.chat.every(m => !m.extra?.bbs_leaf)).toBe(true); expect(active.chat.every(m => !m.extra?.bbs_leaf)).toBe(true);
  });
  it('正常并行：请求前缀不变、尾部追加回复，仍可保存原楼摘要', async () => {
    const { result, started } = delayedSummary(); const pending = runSummary(0, { checkResummary: false }); await started.promise;
    active.chat.push(msg('新的尾部回复')); result.resolve(reply); await pending;
    expect(leafValid(active.chat[0])).toBe(true); expect(active.chat[1].extra?.bbs_leaf).toBeUndefined();
  });
  it('N07: A 后台追补结束不会向 B 发 /hide', async () => {
    const { result, started } = delayedSummary();
    const dialogue = () => Array.from({ length: 6 }, (_, i) => ({ ...msg('floor ' + i), is_user: i % 2 === 0 }));
    active = host('A', dialogue()); const a = active, b = host('B', dialogue());
    b.executeSlashCommandsWithOptions = vi.fn().mockResolvedValue(undefined);
    apiSettings.autoSummaryEnabled = true; apiSettings.keepRecent = 1;
    apiSettings.backlogPolicy = 'pass'; apiSettings.backlogCatchUp = true; apiSettings.backlogWaitSec = 0;
    expect(await handleGenerationIntercept('normal', vi.fn())).toBe(false);
    await started.promise; switchTo(b); result.resolve(reply); await currentSummaryPromise(); await Promise.resolve();
    expect(b.executeSlashCommandsWithOptions).not.toHaveBeenCalled(); expect(a.chat.every(m => !m.extra?.bbs_leaf)).toBe(true);
  });
  it('批量补摘跨聊天后不落叶、不逐楼回退，不多发请求', async () => {
    const { result, started } = delayedSummary(); active.chat = [msg('第一楼'), msg('第二楼')]; const a = active;
    const pending = batchBackfill(); await started.promise; switchTo(host('B'));
    result.resolve(JSON.stringify({ floors: [{ summary: '一' }, { summary: '二' }] })); const r = await pending;
    expect(r.cancelled).toBe(true); expect(client.requestViaMainApi).toHaveBeenCalledOnce(); expect(a.chat.every(m => !m.extra?.bbs_leaf)).toBe(true);
  });
  it('手选合并等待期间修改输入叶子，不提交过时压缩节点', async () => {
    const { result, started } = delayedSummary(); active.chat = [msg('一', 'l1'), msg('二', 'l2')]; recomputeDerived();
    const pending = summarizeSelected(['l1', 'l2']); await started.promise;
    active.chat[0].extra!.bbs_leaf!.text = '用户新编辑'; result.resolve(reply);
    expect((await pending).made).toBe(0); expect(memory.summaries).toHaveLength(0);
  });
});

describe('锚点开关与分支、外部记录、参数', () => {
  it('B04: 无 anchor 的 swipe 不再使用旧版，切回才重新生效', () => {
    active.chat[0].mes = '<anchor>原分支</anchor>'; const entry = harvestAnchorAt(0)!;
    expect(currentAnchor()?.id).toBe(entry.id);
    active.chat[0].mes = '另一分支'; active.chat[0].swipe_id = 1; harvestAnchorAt(0); expect(currentAnchor()).toBeNull();
    active.chat[0].mes = '<anchor>原分支</anchor>'; active.chat[0].swipe_id = 0; harvestAnchorAt(0); expect(currentAnchor()?.id).toBe(entry.id);
  });
  it('正文锚点删除/消息删除均撤销；手动锚点不受正文删除影响', () => {
    addAnchor('手动兜底', -1, 'manual'); active.chat[0].mes = '<anchor>正文锚点</anchor>'; harvestAnchorAt(0);
    active.chat.splice(0); expect(currentAnchor()?.text).toBe('手动兜底');
  });
  it('B05: 总开关关闭或角色排除，不注入生成指令', () => {
    apiSettings.anchor.onDemand = false; apiSettings.enabled = false; handleAnchorIntercept();
    expect(active.setExtensionPrompt).toHaveBeenLastCalledWith(expect.any(String), '', 1, 0, false, 0, null);
    apiSettings.enabled = true; apiSettings.excludedChars = ['Character']; handleAnchorIntercept();
    expect(active.setExtensionPrompt).toHaveBeenLastCalledWith(expect.any(String), '', 1, 0, false, 0, null);
  });
  it('B07: 首条超预算也跳过，201 条全置顶仍硬限制 200', () => {
    pushExternalNotes('p', [{ id: 'big', text: '字'.repeat(4000), pinned: true }]); expect(selectExternalNotes(200)).toHaveLength(0);
    pushExternalNotes('p', Array.from({ length: 201 }, (_, i) => ({ id: String(i), text: 'x', pinned: true })));
    expect(externalState.notes.filter(n => n.source === 'p')).toHaveLength(200);
    apiSettings.phoneBridge.enabled = true; apiSettings.phoneBridge.injectExternal = true; apiSettings.phoneBridge.externalMaxChars = 200;
    expect(buildExternalInjectionText().length).toBeLessThanOrEqual(200);
  });
  it('B09: 同 id 不同来源可准确置顶/删除；缺 source 且歧义时拒绝', () => {
    pushExternalNotes('A', [{ id: 'same', text: 'A' }]); pushExternalNotes('B', [{ id: 'same', text: 'B' }]);
    expect(removeExternalNote('same')).toBeNull(); setExternalPinned('same', true, 'B');
    expect(externalState.notes.find(n => n.source === 'A')?.pinned).toBeUndefined();
    expect(removeExternalNote('same', 'B')?.source).toBe('B'); expect(externalState.notes.map(n => n.source)).toEqual(['A']);
  });
  it('B12: 新建和更新渠道都采用手机 maxTokens=1800，而非默认 65535', () => {
    active.extensionSettings = { tsukiyo_phone: { config: { profiles: [{ id: 'p', name: 'P', url: 'https://example.invalid', model: 'm', maxTokens: 1800 }] } } };
    expect(importPhoneProfile('p', newChannel).channel.maxTokens).toBe(1800);
    apiSettings.channels[0].maxTokens = 65535; expect(importPhoneProfile('p', newChannel).channel.maxTokens).toBe(1800);
  });
});

describe('v2 快照预检与回收站完整恢复', () => {
  const state = () => JSON.stringify([active.chat, active.chatMetadata, memory.summaries, memory.varTemplates, anchorState.anchors, externalState.notes, restoreState.points]);
  it.each(['future', 'nullSummary', 'duplicate', 'badDelta', 'fractional', 'dangling', 'cycle', 'badTemplate'] as const)('N01: %s 在任何修改之前拒绝', kind => {
    active.chat = [msg('保留', 'keep')]; const snapshot = buildSnapshot();
    if (kind === 'future') snapshot.snapshotVersion = 999;
    if (kind === 'nullSummary') snapshot.summaries = [null as never];
    if (kind === 'duplicate') snapshot.leaves.push(snapshot.leaves[0]);
    if (kind === 'badDelta') snapshot.leaves[0].leaf.delta.items = { add: [null as never] };
    if (kind === 'fractional') snapshot.leaves[0].msgIndex = 0.5;
    if (kind === 'dangling') snapshot.summaries = [sum('x', 1, ['missing'])];
    if (kind === 'cycle') snapshot.summaries = [sum('x', 1, ['y']), sum('y', 2, ['x'])];
    if (kind === 'badTemplate') snapshot.varsTemplate.json = null as never;
    const before = state(); expect(parseSnapshot(snapshot)).toBeNull(); expect(() => applySnapshot(snapshot)).toThrow(); expect(state()).toBe(before);
  });
  it.each(['delete', 'edit', 'swipe', 'reorder', 'foreign'] as const)('N02: %s 消息冲突拒绝整份覆盖，不挂错楼', kind => {
    active.chat = [msg('序言'), msg('B', 'leaf-B'), msg('C')]; const snapshot = buildSnapshot();
    if (kind === 'delete') active.chat.splice(1, 1);
    if (kind === 'edit') active.chat[1].mes = '别的正文';
    if (kind === 'swipe') active.chat[1].swipe_id = 1;
    if (kind === 'reorder') [active.chat[1], active.chat[2]] = [active.chat[2], active.chat[1]];
    if (kind === 'foreign') active = host('other', active.chat);
    const before = state(); expect(() => applySnapshot(snapshot)).toThrow(); expect(state()).toBe(before);
  });
  it('有效快照往返保留聊天模板、锚点、外部记录和向量 bundle 引用', () => {
    active.chat = [msg('正文', 'leaf')]; memory.summaries = [sum('s', 1, ['leaf'])];
    memory.varTemplates.chat = { json: { hp: 5 }, meaning: '生命', rule: '受伤减少' };
    active.chatMetadata.bbs_bundles = ['bundle1']; addAnchor('手工记忆', 0, 'manual'); pushExternalNotes('phone', [{ id: '1', text: '约定', pinned: true }]);
    const snapshot = buildSnapshot(); expect(parseSnapshot(snapshot)).not.toBeNull();
    delete active.chat[0].extra!.bbs_leaf; memory.summaries = []; memory.varTemplates.chat = { json: {}, meaning: '', rule: '' };
    applySnapshot(snapshot, { makePoint: false }); expect(active.chat[0].extra!.bbs_leaf!.id).toBe('leaf');
    expect(memory.vars.hp).toBe(5); expect(currentAnchor()?.text).toBe('手工记忆'); expect(externalState.notes).toHaveLength(1); expect(active.chatMetadata.bbs_bundles).toEqual(['bundle1']);
  });
  it('只有聊天变量模板也建立恢复点', () => {
    memory.varTemplates.chat.meaning = '模板说明'; expect(createRestorePoint('模板')).not.toBeNull();
  });
  it('B08: 恢复被删总结同时恢复原父边及顺序', () => {
    memory.summaries = [sum('a'), sum('child'), sum('c'), sum('parent', 2, ['a', 'child', 'c'])];
    deleteSummary('child'); expect(memory.summaries.find(s => s.id === 'parent')!.childIds).toEqual(['a', 'c']);
    expect(restoreTrashEntry(trashState.items[0].id).ok).toBe(true); expect(memory.summaries.find(s => s.id === 'parent')!.childIds).toEqual(['a', 'child', 'c']);
  });
  it('父边已改动时不部分恢复，回收条目保留', () => {
    memory.summaries = [sum('child'), sum('other'), sum('parent', 2, ['child'])]; deleteSummary('child');
    memory.summaries.find(s => s.id === 'parent')!.childIds = ['other']; const before = state();
    expect(restoreTrashEntry(trashState.items[0].id).ok).toBe(false); expect(state()).toBe(before); expect(trashState.items).toHaveLength(1);
  });
  it('回收叶子按消息身份映射：删除前面的消息后仍回原消息', () => {
    active.chat = [msg('前面'), msg('原消息', 'l')]; deleteLeafAt(1); active.chat.splice(0, 1);
    expect(restoreTrashEntry(trashState.items[0].id).ok).toBe(true); expect(active.chat[0].extra?.bbs_leaf?.id).toBe('l');
  });
  it('回收叶子的原消息被删后，不把摘要塞进顶上来的楼；保留回收条目', () => {
    active.chat = [msg('原消息', 'l'), msg('别的消息')]; deleteLeafAt(0); active.chat.splice(0, 1);
    expect(restoreTrashEntry(trashState.items[0].id).ok).toBe(false); expect(active.chat[0].extra?.bbs_leaf).toBeUndefined(); expect(trashState.items).toHaveLength(1);
  });
});

describe('N03 带数据新聊天', () => {
  it('迁移独立锚点、外部记录、聊天模板与叶子；源聊天不丢数据', async () => {
    active.chat = [msg('recent', 'l')]; const source = active, target = host('B', []);
    addAnchor('独立手动锚点', 0, 'manual'); pushExternalNotes('tsukiyo-phone', [{ id: 'p', text: '未完约定', floor: 0, pinned: true }]);
    memory.varTemplates.chat = { json: { hp: 10 }, meaning: '含义', rule: '规则' };
    vi.spyOn(context, 'getDoNewChat').mockResolvedValue(async () => { switchTo(target); }); apiSettings.vector.enabled = false;
    expect(await createNewChatWithCarryover()).toBe(true);
    expect(target.chat.some(m => m.extra?.bbs_leaf?.id === 'l')).toBe(true); expect(currentAnchor()?.text).toBe('独立手动锚点');
    expect(externalState.notes[0]).toMatchObject({ id: 'p', floor: 1, pinned: true }); expect(memory.varTemplates.chat.meaning).toBe('含义');
    expect(target.chatMetadata[ANCHOR_META_KEY]).toBeDefined(); expect(target.chatMetadata[EXTERNAL_META_KEY]).toBeDefined();
    expect(source.chatMetadata[ANCHOR_META_KEY]).toBeDefined(); expect(source.chatMetadata[EXTERNAL_META_KEY]).toBeDefined();
  });
  it('等待新聊天接口期间切换聊天，取消而不调用创建', async () => {
    const d = deferred<NonNullable<Awaited<ReturnType<typeof context.getDoNewChat>>>>(); const create = vi.fn();
    vi.spyOn(context, 'getDoNewChat').mockReturnValue(d.promise); const pending = createNewChatWithCarryover();
    switchTo(host('B')); d.resolve(create); expect(await pending).toBe(false); expect(create).not.toHaveBeenCalled();
  });
});


describe('扩展回归：压缩、分段隐藏、级联关系', () => {
  it('自动压缩等待期间切换聊天，不向新森林加入旧节点', async () => {
    const { result, started } = delayedSummary(); active.chat = [msg('一', 'a'), msg('二', 'b')];
    apiSettings.leafBatchThreshold = 2; apiSettings.leafKeepRecent = 0;
    const pending = checkResummary(); await started.promise; switchTo(host('B')); result.resolve(reply);
    expect(await pending).toBe(0); expect(memory.summaries).toEqual([]);
  });
  it('自动摘要等待期间模板变化，拒绝旧变量更新', async () => {
    const { result, started } = delayedSummary(); const pending = runSummary(0, { checkResummary: false }); await started.promise;
    memory.varTemplates.chat.rule = '新规则'; result.resolve(reply); await pending; expect(active.chat[0].extra?.bbs_leaf).toBeUndefined();
  });
  it('隐藏一段尚未完成时切聊天，后续 /hide 不再执行', async () => {
    active.chat = [msg('一', 'a'), msg('未摘'), msg('三', 'b'), msg('尾部')];
    apiSettings.keepRecent = 0; const d = deferred<unknown>();
    active.executeSlashCommandsWithOptions = vi.fn().mockReturnValue(d.promise); const old = active;
    const pending = syncHiddenNow(true); await Promise.resolve();
    expect(old.executeSlashCommandsWithOptions).toHaveBeenCalledOnce(); switchTo(host('B')); d.resolve(undefined); await pending;
    expect(old.executeSlashCommandsWithOptions).toHaveBeenCalledOnce();
  });
  it('删除叶子再恢复，级联剪掉的多层祖先一并恢复', () => {
    active.chat = [msg('一', 'a'), msg('二', 'b')]; memory.summaries = [sum('L1', 1, ['a', 'b']), sum('L2', 2, ['L1'])];
    deleteLeafAt(0); expect(memory.summaries).toHaveLength(0);
    expect(restoreTrashEntry(trashState.items[0].id).ok).toBe(true);
    expect(memory.summaries.find(s => s.id === 'L2')?.childIds).toEqual(['L1']);
    expect(memory.summaries.find(s => s.id === 'L1')?.childIds).toEqual(['a', 'b']);
  });
  it('删除子树恢复时恢复祖先，旁支叶子不被删除', () => {
    active.chat = [msg('一', 'a'), msg('二', 'b')]; memory.summaries = [sum('L1', 1, ['a']), sum('L2', 2, ['L1', 'b'])];
    deleteSummarySubtrees(['L1']); expect(active.chat[1].extra?.bbs_leaf?.id).toBe('b');
    expect(restoreTrashEntry(trashState.items[0].id).ok).toBe(true); expect(memory.summaries.find(s => s.id === 'L2')?.childIds).toEqual(['L1', 'b']);
  });
  it('两页锚点文本相同仍分别绑定 swipe，切回不重复生成版本', () => {
    active.chat[0].mes = '<anchor>相同文本</anchor>'; harvestAnchorAt(0); const old = currentAnchor()!.id;
    active.chat[0].swipe_id = 1; harvestAnchorAt(0); expect(currentAnchor()?.origin?.swipe).toBe(1);
    active.chat[0].swipe_id = 0; harvestAnchorAt(0); expect(currentAnchor()?.id).toBe(old); expect(anchorState.anchors).toHaveLength(2);
  });
  it('旧锚点任务的 finally 不清除新聊天正在运行的锚点任务', async () => {
    delayedSummary(); const a = deferred<string>(), b = deferred<string>();
    vi.mocked(client.requestViaMainApi).mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);
    bindAnchor(); const old = generateAnchorSilently(); switchTo(host('B')); const fresh = generateAnchorSilently();
    a.resolve('<anchor>A 旧结果</anchor>'); await old; expect(anchorState.busy).toBe(true); expect(anchorState.lastError).toBe('');
    b.resolve('<anchor>B 新结果</anchor>'); expect((await fresh)?.text).toBe('B 新结果'); expect(anchorState.busy).toBe(false);
  });
});
