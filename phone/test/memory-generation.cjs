// Execute the actual built phone bundle, without its auto-start. No network or real ST.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path');
let code = fs.readFileSync(path.join(__dirname, '..', 'tsukiyo-phone-1.6.2.js'), 'utf8');
code = code.slice(0, code.lastIndexOf('TsukiyoPhoneBundle.start(')).replace('return __toCommonJS(index_exports);',
  'return {PhoneActions, baibaiRuntime, baibaiReadEnabled, baibaiMemoryCandidates, baibaiFilterInput, actorContext, BaiBaiLink};');
const window = {};
const B = vm.runInNewContext(code + '\nTsukiyoPhoneBundle;', { window, console, URL, TextEncoder, AbortController, setTimeout, clearTimeout });
let allowed = true, reads = 0, history = 'BOOK_HISTORY_SENTINEL：两人约好明天讨论，还未执行。';
window.STBaiBaiBook = { phone: {
  isEnabled: () => true, canReadMemory: () => allowed,
  getBrief: () => { reads++; return { time: '2026/10/2 10:00', location: '咖啡馆', presentNpcs: ['阿青'],
    npcs: [{ name: '阿青', title: 'BOOK_PUBLIC_PROFILE', personality: '安静' }], plans: [{ content: '瞒着乙筹办惊喜，乙尚不知道。' }], history,
    lifeDetails: [], items: [], anchor: { text: 'BOOK_ANCHOR_SENTINEL', version: 1, floor: 0 } }; },
  getNpcProfile: () => 'BOOK_PRIVATE_PROFILE', listNotes: () => [], pushNotes: () => ({ added: 1 })
} };
function fixture(on = true) {
  const cfg = { ui: { baibai: { brief: on, enabled: true, push: true } }, profiles: [], routes: {}, enabled: {}, defaultProfile: '' };
  B.baibaiRuntime.win = window; B.baibaiRuntime.enabled = true; B.baibaiRuntime.settings = () => cfg;
  const contact = { id: 'a', name: '阿青', age: 21, recognized: true, reachable: true, allowNarrative: true, follow: true, proactive: true, bio: '普通朋友', status: '', history: [], references: [] };
  const data = { contacts: [contact], memories: [{ id: 'bb', text: 'BOOK_IMPORTED_SENTINEL', kind: 'narrative_fact', bb: { kind: 'history' }, audience: ['a', 'user'], enabled: true, visibility: 'private' }],
    settings: { readNarrative: true, planningMode: 'manual', auto: {} }, manualStory: {}, agenda: [], notes: [], tasks: [], diary: [], logs: [],
    threads: [{ id: 'd', kind: 'direct', title: '私聊', members: ['a'], pending: [], messages: [{ id: 'm', author: 'user', role: 'user', text: '我们明天去咖啡馆讨论。', read: true }] },
      { id: 'g', kind: 'group', title: '群聊', members: ['a'], pending: [], messages: [] }],
    summaries: [], feed: [{ id: 'post', author: 'user', text: '今天喝咖啡', comments: [] }], plans: [{ id: 'plan', title: '待讨论', status: 'active', beats: [{ id: 'beat', title: '讨论', finish: '明确讨论完成', choices: [] }] }], activePlan: { id: 'plan', cursor: 0 }, automation: { last: {}, next: {}, failures: {} } };
  const snap = { owner: 'test-owner', floor: 0, userName: '玩家', present: ['阿青'], stat: {}, story: { date: '2026-10-02', time: '10:00', place: '咖啡馆' }, history: [{ floor: 0, text: '玩家和阿青在咖啡馆讨论了下一步打算。', role: 'assistant' }] };
  const repo = { choose: () => data, mutate: async (fn, opt) => { assert(opt.guard(data)); return fn(data, snap); } };
  const actions = new B.PhoneActions({ repo, settings: { data: cfg, isEnabled: () => true }, runner: { run: (_module, fn) => fn({ snapshot: snap, signal: null, guard() {}, alive: () => true }) }, router: null });
  return { cfg, data, snap, actions };
}
let cases = 0;
async function test(name, fn) { await fn(); cases++; console.log('PASS', name); }
const capture = new Error('CAPTURE_REQUEST');
async function requestFor(method, args, on) {
  const f = fixture(on); let request;
  if (method === 'reply') f.data.threads.find(t => t.id === args[0]).pending = [{ id: 'pending', text: '你好' }];
  f.actions.router = { call: async (module, req) => { request = { module, ...req }; throw capture; } };
  try { await f.actions[method](...args); assert.fail('must stop at capture'); } catch (e) { if (e !== capture) throw e; }
  assert(request, 'request must reach router'); return request;
}
(async () => {
  const methods = [ ['reply', ['d']], ['reply', ['g']], ['proactive', ['a']], ['plan', []], ['social', ['a']], ['postReply', ['post', 'a']],
    ['diary', []], ['diaries', [['a']]], ['diaries', [['user']]], ['festivals', []], ['autoTasks', []], ['autoNotes', []], ['socialMany', []], ['memory', ['d']], ['reviewPlan', []], ['memoryBookGenerate', []] ];
  for (const [method, args] of methods) {
    await test(`${method} ${JSON.stringify(args)}: ON adds scoped reference; OFF removes live/imported book inputs`, async () => {
      const on = await requestFor(method, args, true); assert(on.user.includes('BOOK_'), on.user.slice(0, 160));
      const off = await requestFor(method, args, false); assert(!off.user.includes('BOOK_'));
    });
  }
  await test('public posts and group chat never receive global book history or anchors', async () => {
    for (const [m, a] of [['social', ['a']], ['socialMany', []], ['postReply', ['post', 'a']], ['reply', ['g']]]) {
      const r = await requestFor(m, a, true);
      assert(!r.user.includes('BOOK_HISTORY_SENTINEL')); assert(!r.user.includes('BOOK_ANCHOR_SENTINEL'));
      assert(r.user.includes('BOOK_PUBLIC_PROFILE'));
    }
  });
  await test('book-side read permission stops reads even with phone toggle on', async () => {
    allowed = false; reads = 0;
    const r = await requestFor('diary', [], true); assert(!r.user.includes('BOOK_')); assert.equal(reads, 0); allowed = true;
  });
  await test('turning read off filters request copies without deleting saved imported memories', () => {
    const f = fixture(false); const copy = B.baibaiFilterInput(JSON.parse(JSON.stringify(f.data)));
    assert.equal(copy.memories.length, 0); assert.equal(f.data.memories.length, 1);
  });
  await test('each generation refreshes the book memory rather than copying stale cache', async () => {
    history = 'BOOK_OLD_HISTORY'; const r1 = await requestFor('diary', [], true);
    history = 'BOOK_NEW_MANUAL_SUMMARY'; const r2 = await requestFor('diary', [], true);
    assert(r1.user.includes('BOOK_OLD_HISTORY')); assert(r2.user.includes('BOOK_NEW_MANUAL_SUMMARY')); assert(!r2.user.includes('BOOK_OLD_HISTORY'));
  });
  await test('name mention is not knowledge permission; imported copies default to player only', () => {
    fixture(); const absent = B.actorContext({ ...fixture().data, settings: { readNarrative: false } }, { ...fixture().snap, present: [] }, { id: 'yi', name: '乙', history: [] });
    assert(!JSON.stringify(absent.柏宝书简报).includes('乙尚不知道'));
    const candidates = B.baibaiMemoryCandidates({ plans: [{ content: '瞒着乙筹办惊喜，乙尚不知道。' }] }, { contacts: [{ id: 'yi', name: '乙' }] });
    assert.equal(JSON.stringify(candidates[0].audience), '["user"]');
  });
  await test('successful diary generation still commits with read ON and OFF and preserves stored memories', async () => {
    for (const on of [true, false]) {
      const f = fixture(on);
      f.actions.router = { call: async () => JSON.stringify({ title: '今日记录', text: '今天在咖啡馆讨论，计划尚未执行。' }) };
      await f.actions.diary();
      assert.equal(f.data.diary.length, 1); assert.equal(f.data.diary[0].status, 'draft');
      assert.equal(f.data.memories.length, 1);
    }
  });
  await test('changing the read switch during a request prevents stale result commit', async () => {
    const f = fixture(); let committed = false;
    f.actions.router = { call: async () => { f.cfg.ui.baibai.brief = false; return '{}'; } };
    await assert.rejects(f.actions.perform('diary', () => ({ system: '', payload: {}, parse: JSON.parse, meta: {} }), () => { committed = true; }), /开关已变化/);
    assert.equal(committed, false);
  });
  await test('failed writeback can retry unchanged content and force cannot bypass write-off', async () => {
    const f = fixture(); let calls = 0;
    window.STBaiBaiBook.phone.pushNotes = () => { calls++; if (calls === 1) throw Error('temporary'); return { added: 1 }; };
    const link = new B.BaiBaiLink({ win: window, bridge: { mode: 'tavern' }, settings: { data: f.cfg }, repo: { data: f.data, snapshot: f.snap }, emit() {} });
    await assert.rejects(link.push(), /temporary/); await link.push(); assert.equal(calls, 2);
    f.cfg.ui.baibai.push = false; await link.push({ force: true }); assert.equal(calls, 2);
  });
  console.log(`PHONE_MEMORY_OK: ${cases} cases (all generation payloads tested with ON/OFF)`);
})().catch(e => { console.error(e); process.exitCode = 1; });
