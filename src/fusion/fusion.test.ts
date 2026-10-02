/**
 * 融合版新增模块的单元测试:锚点解析/存储/注入、外部记录预算、设置兜底、后端键名、回收站与恢复点。
 * 不发网络请求;ST 上下文用最小假对象。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as context from '@/st/context';
import type { STContext, STMessage } from '@/st/context';
import { apiSettings, normalize, defaults } from '@/api/settings';
import { memory, recomputeDerived } from '@/memory/store';
import { createEmptyMemory } from '@/memory/types';
import { dueHint, fmtPlans } from '@/memory/prompts';
import { extractAnchorBlock, harvestAnchorAt, handleAnchorIntercept } from '@/anchor/engine';
import { addAnchor, anchorState, buildAnchorInjectionText, currentAnchor, loadAnchors, setAnchorExcluded, ANCHOR_META_KEY } from '@/anchor/store';
import { buildExternalInjectionText, buildExternalSummaryMaterial, externalState, loadExternal, pushExternalNotes, selectExternalNotes } from '@/bridge/external';
import { safeSegment } from '@/backend/bainiao';
import { loadTrash, trashPush, trashState } from '@/backend/trash';
import { buildSnapshot, createRestorePoint, loadRestorePoints, restoreFromPoint, restoreState, restoreTrashEntry, parseSnapshot } from '@/backend/restore';
import { deleteSummary } from '@/memory/apply';
import { getBrief, listChannels } from '@/bridge/phone';

function msg(mes: string, is_user = false): STMessage {
  return { name: is_user ? '林舟' : '艾琳', is_user, is_system: false, mes, extra: {} };
}

let prompts: Record<string, { text: string; depth: number }> = {};
function setup(chat: STMessage[], chatMetadata: Record<string, unknown> = {}): STContext {
  prompts = {};
  const ctx = {
    chat,
    chatMetadata,
    name1: '林舟',
    name2: '艾琳',
    saveChat: vi.fn().mockResolvedValue(undefined),
    saveMetadataDebounced: vi.fn(),
    saveSettingsDebounced: vi.fn(),
    getCurrentChatId: () => 'fusion-test',
    setExtensionPrompt: (key: string, text: string, _pos: number, depth: number) => {
      prompts[key] = { text, depth };
    },
    extensionSettings: {},
    getRequestHeaders: () => ({}),
  } as unknown as STContext;
  vi.spyOn(context, 'getContext').mockReturnValue(ctx);
  return ctx;
}

beforeEach(() => {
  Object.assign(memory, createEmptyMemory());
  Object.assign(apiSettings, defaults());
  anchorState.anchors = [];
  externalState.notes = [];
  trashState.items = [];
  restoreState.points = [];
});

describe('设置兜底:老数据没有融合字段时回退默认', () => {
  it('normalize 补齐 anchor/backend/phoneBridge 与渠道 testPrompt', () => {
    const n = normalize({ channels: [{ id: 'c1', name: 'x', url: 'https://a.b', key: '', model: 'm' }] } as never);
    expect(n.anchor.triggerPhrase).toBe('请生成锚点日记');
    expect(n.anchor.injectDepth).toBe(4);
    expect(n.backend.namespace).toBe('baibai-book');
    expect(n.backend.restorePoints).toBe(3);
    expect(n.phoneBridge.externalMaxChars).toBe(2500);
    expect(n.channels[0].testPrompt).toBe('');
    expect(n.channels[0].lastTest).toBeUndefined();
  });
  it('非法命名空间 / 越界数值被纠正', () => {
    const n = normalize({ backend: { namespace: '有/斜杠', restorePoints: 99, trashKeep: 1 }, anchor: { injectDepth: -5, maxChars: 10 } } as never);
    expect(n.backend.namespace).toBe('baibai-book');
    expect(n.backend.restorePoints).toBe(10);
    expect(n.backend.trashKeep).toBe(5);
    expect(n.anchor.injectDepth).toBe(0);
    expect(n.anchor.maxChars).toBe(500);
  });
});

describe('锚点日记', () => {
  it('extractAnchorBlock 取最后一个 <anchor> 块并去掉标签', () => {
    const text = '正文……<anchor>第一份</anchor> 更多正文 <anchor>\n版本: 第2版\n一.基础关系: 朋友\n</anchor>';
    expect(extractAnchorBlock(text)).toBe('版本: 第2版\n一.基础关系: 朋友');
    expect(extractAnchorBlock('没有锚点')).toBe('');
  });

  it('harvestAnchorAt 从 AI 楼层收割并按消息去重,版本递增', () => {
    const chat = [msg('开场'), msg('催更', true), msg('正文 <anchor>版本: 第1版\n五.锚点事件: 1. 相遇</anchor>')];
    const ctx = setup(chat);
    expect(harvestAnchorAt(2)?.version).toBe(1);
    expect(harvestAnchorAt(2)).toBeNull(); // 同内容不重复入库
    expect(anchorState.anchors).toHaveLength(1);
    expect(anchorState.anchors[0].floor).toBe(2);
    expect(anchorState.anchors[0].source).toBe('chat');
    expect((ctx.chatMetadata as Record<string, unknown>)[ANCHOR_META_KEY]).toBeTruthy();
    // 编辑后内容变化 → 新版本
    chat[2].mes = '正文 <anchor>版本: 第2版\n五.锚点事件: 1. 相遇 2. 告白</anchor>';
    expect(harvestAnchorAt(2)?.version).toBe(2);
    expect(currentAnchor()?.version).toBe(2);
  });

  it('排除最新版后回退到上一版;注入文本含版本号与截断', () => {
    setup([msg('a')]);
    addAnchor('第一版内容', 0, 'manual');
    const v2 = addAnchor('第二版内容'.repeat(400), 0, 'manual');
    apiSettings.anchor.maxChars = 500;
    expect(currentAnchor()?.id).toBe(v2.id);
    expect(buildAnchorInjectionText()).toContain('第 2 版');
    expect(buildAnchorInjectionText()).toContain('已截断');
    setAnchorExcluded(v2.id, true);
    expect(currentAnchor()?.version).toBe(1);
    expect(buildAnchorInjectionText()).toContain('第一版内容');
    apiSettings.anchor.enabled = false;
    expect(buildAnchorInjectionText()).toBe('');
  });

  it('loadAnchors 从 metadata 读回并按版本排序;坏条目被丢弃', () => {
    setup([msg('a')], {
      [ANCHOR_META_KEY]: { version: 1, anchors: [{ id: 'b', text: 'B', version: 2, createdAt: 2 }, { id: 'a', text: 'A', version: 1, createdAt: 1 }, { id: 'bad' }] },
    });
    loadAnchors();
    expect(anchorState.anchors.map(a => a.id)).toEqual(['a', 'b']);
  });

  it('handleAnchorIntercept:按需模式只在最近用户发言含触发词时注入指令', () => {
    const chat = [msg('开场'), msg('今天天气不错', true)];
    setup(chat);
    handleAnchorIntercept();
    expect(prompts.baibai_book_anchor_instruction.text).toBe('');
    chat.push(msg('请生成锚点日记', true));
    handleAnchorIntercept();
    expect(prompts.baibai_book_anchor_instruction.text).toContain('锚点日记');
    expect(prompts.baibai_book_anchor_instruction.depth).toBe(0);
    // swipe 时末尾是 AI 楼,仍能回溯到用户发言
    chat.push(msg('AI 回复'));
    handleAnchorIntercept();
    expect(prompts.baibai_book_anchor_instruction.text).toContain('锚点日记');
    apiSettings.anchor.onDemand = false;
    chat.length = 1;
    handleAnchorIntercept();
    expect(prompts.baibai_book_anchor_instruction.text).toContain('锚点日记');
    apiSettings.anchor.enabled = false;
    handleAnchorIntercept();
    expect(prompts.baibai_book_anchor_instruction.text).toBe('');
  });
});

describe('外部记录(小手机推送)', () => {
  it('同 id 覆盖、无 id 按内容去重、置顶优先且在预算内', () => {
    setup([msg('a')]);
    const r1 = pushExternalNotes('tsukiyo-phone', [
      { id: 'm1', kind: 'phone_chat', text: '艾琳发消息问晚饭吃什么', time: '2026/9/13 18:00' },
      { kind: 'phone_promise', text: '约好周六去看展' },
      { kind: 'phone_promise', text: '约好周六去看展' },
    ]);
    // 第三条与第二条内容相同 → 视作同一条的更新,不重复入库
    expect(r1).toEqual({ added: 2, updated: 1, total: 2 });
    const r2 = pushExternalNotes('tsukiyo-phone', [{ id: 'm1', kind: 'phone_chat', text: '艾琳发消息问晚饭吃什么(已回复:火锅)', pinned: true }]);
    expect(r2.updated).toBe(1);
    expect(externalState.notes).toHaveLength(2);
    for (let i = 0; i < 30; i++) pushExternalNotes('tsukiyo-phone', [{ id: `x${i}`, kind: 'fact', text: `填充记录 ${i} `.repeat(10) }]);
    const chosen = selectExternalNotes(400);
    expect(chosen.some(n => n.id === 'm1')).toBe(true); // 置顶的一定在
    expect(chosen.length).toBeLessThan(externalState.notes.length);
    const text = buildExternalInjectionText();
    expect(text).toContain('【小手机】');
    expect(text).toContain('火锅');
    apiSettings.phoneBridge.injectExternal = false;
    expect(buildExternalInjectionText()).toBe('');
  });

  it('摘要材料按楼层范围过滤;无楼层的记录视为近期', () => {
    setup([msg('a')]);
    pushExternalNotes('tsukiyo-phone', [
      { id: 'f3', kind: 'phone_chat', text: '三楼时的消息', floor: 3 },
      { id: 'f9', kind: 'phone_chat', text: '九楼时的消息', floor: 9 },
      { id: 'nf', kind: 'agenda', text: '没有楼层的日程' },
    ]);
    const m = buildExternalSummaryMaterial(2, 5);
    expect(m).toContain('三楼时的消息');
    expect(m).not.toContain('九楼时的消息');
    expect(m).toContain('没有楼层的日程');
    apiSettings.phoneBridge.includeInSummary = false;
    expect(buildExternalSummaryMaterial(0, 100)).toBe('');
  });

  it('loadExternal 读回 metadata 并丢弃坏条目', () => {
    setup([msg('a')], { baibai_book_external: { notes: [{ id: 'ok', source: 's', kind: 'fact', text: 'x', ts: 1 }, { id: 'bad' }] } });
    loadExternal();
    expect(externalState.notes).toHaveLength(1);
  });
});

describe('计划目标时间相对提示', () => {
  it('dueHint 给出 今天/明天/还有N天/已过N天;解析失败为空', () => {
    expect(dueHint('2026/9/13 10:00', '2026/9/13 20:00')).toBe('就是今天');
    expect(dueHint('2026/9/13 10:00', '2026/9/14')).toBe('明天');
    expect(dueHint('2026/9/13', '2026/9/20')).toBe('还有 7 天');
    expect(dueHint('2026/9/13', '2026/9/10')).toBe('已过 3 天');
    expect(dueHint('不是时间', '2026/9/10')).toBe('');
  });
  it('fmtPlans 带 now 时附加提示,不带时保持原格式', () => {
    const plans = [{ id: 'p', kind: 'plan', content: '去看展', status: 'open', createdAt: 0, targetTime: '2026/9/20' }] as never;
    expect(fmtPlans(plans)).toContain('目标 2026/9/20)');
    expect(fmtPlans(plans, '2026/9/13')).toContain('目标 2026/9/20,还有 7 天');
  });
});

describe('白鸟后端键名', () => {
  it('safeSegment 只含 [A-Za-z0-9_-],稳定且不同输入不同哈希', () => {
    const a = safeSegment('艾琳.png|2026-9-13 @ 10h05m.jsonl');
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(safeSegment('艾琳.png|2026-9-13 @ 10h05m.jsonl')).toBe(a);
    expect(safeSegment('其它')).not.toBe(a);
  });
});

describe('回收站与恢复点', () => {
  it('deleteSummary 先进回收站;restoreTrashEntry 放回森林', () => {
    setup([msg('a')]);
    loadTrash();
    memory.summaries.push({ id: 's1', text: '一段总结', level: 1, createdAt: 1, auto: true, childIds: [] });
    expect(deleteSummary('s1')).toBe(true);
    expect(memory.summaries).toHaveLength(0);
    expect(trashState.items[0].kind).toBe('summary');
    const r = restoreTrashEntry(trashState.items[0].id);
    expect(r.ok).toBe(true);
    expect(memory.summaries.map(s => s.id)).toEqual(['s1']);
    expect(trashState.items).toHaveLength(0);
  });

  it('回收站按上限淘汰最旧', () => {
    setup([msg('a')]);
    apiSettings.backend.trashKeep = 5;
    for (let i = 0; i < 8; i++) trashPush({ kind: 'anchor', title: `t${i}`, payload: { id: `a${i}`, text: 'x', version: i } });
    expect(trashState.items).toHaveLength(5);
    expect(trashState.items[0].title).toBe('t7');
  });

  it('恢复点:保存→改动→回滚,叶子按楼层回写,空状态不建点', () => {
    const chat = [msg('开场'), msg('第一回合')];
    setup(chat);
    loadRestorePoints();
    expect(createRestorePoint('空')).toBeNull();
    chat[1].extra!.bbs_leaf = { id: 'leaf1', text: '叶子摘要', createdAt: 1 } as never;
    memory.summaries.push({ id: 's1', text: '总结', level: 1, createdAt: 1, auto: true, childIds: ['leaf1'] });
    addAnchor('锚点v1', 1, 'manual');
    recomputeDerived();
    const pt = createRestorePoint('测试');
    expect(pt).not.toBeNull();
    expect(pt!.snapshot.leaves).toHaveLength(1);
    // 改动
    memory.summaries.length = 0;
    delete chat[1].extra!.bbs_leaf;
    anchorState.anchors = [];
    const r = restoreFromPoint(pt!.id);
    expect(r.ok).toBe(true);
    expect(memory.summaries.map(s => s.id)).toEqual(['s1']);
    expect(chat[1].extra!.bbs_leaf).toBeTruthy();
    expect(currentAnchor()?.text).toBe('锚点v1');
    // 回滚前的状态是空的 → 不会多建"恢复前"点;再回滚一次(此时有数据)则会多出一个
    expect(restoreState.points.length).toBe(1);
    restoreFromPoint(pt!.id);
    expect(restoreState.points.length).toBe(2);
    expect(restoreState.points[0].reason).toBe('恢复前自动保存');
    apiSettings.backend.restorePoints = 2;
    createRestorePoint('第三个');
    expect(restoreState.points.length).toBe(2);
    // 快照往返
    const snap = parseSnapshot(JSON.parse(JSON.stringify(buildSnapshot())));
    expect(snap?.summaries).toHaveLength(1);
    expect(parseSnapshot({ nope: true })).toBeNull();
  });
});

describe('小手机联动 API', () => {
  it('getBrief 汇总时间/地点/在场/计划/锚点,listChannels 不泄露密钥', () => {
    // 简报与公共 API 一样从叶子重放派生状态,所以用一条带 delta 的叶子造数据
    const leafMsg = msg('b');
    leafMsg.extra!.bbs_leaf = {
      id: 'leaf-brief',
      text: '两人在客厅约好周六看展',
      createdAt: 1,
      swipe: 0,
      v: 1,
      delta: {
        time: '2026/9/13 19:00',
        location: '艾琳家-客厅',
        npcs: {
          add: [
            { name: '艾琳', relation: '恋人', location: '艾琳家-客厅', affinityInner: 2, affinityOuter: 1 },
            { name: '老王', relation: '邻居', location: '隔壁' },
          ],
        },
        plans: { add: [{ kind: 'plan', content: '周六看展', targetTime: '2026/9/19' }] },
      },
    } as never;
    setup([msg('a'), leafMsg]);
    recomputeDerived();
    addAnchor('锚点内容', 1, 'manual');
    apiSettings.channels.push({ id: 'c1', name: '渠道A', url: 'https://api.example.com/v1', key: 'sk-secret', model: 'gpt', temperature: 1, maxTokens: 10, timeoutSec: 10, stream: false, prefill: true, excludeParams: [], reasoningEffort: '', testPrompt: '' });
    const brief = getBrief({ historyChars: 0 });
    expect(brief.time).toBe('2026/9/13 19:00');
    expect(brief.presentNpcs).toEqual(['艾琳']);
    expect(brief.npcs.find(n => n.name === '艾琳')?.affinityText).toContain('感情深厚');
    expect(brief.plans[0].daysLeft).toBe(6);
    expect(brief.anchor?.text).toBe('锚点内容');
    const chs = listChannels();
    expect(chs[0].hasKey).toBe(true);
    expect(JSON.stringify(chs)).not.toContain('sk-secret');
  });
});
