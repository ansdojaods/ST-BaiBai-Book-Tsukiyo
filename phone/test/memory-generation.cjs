// Execute the actual built phone bundle, without its auto-start. No network or real ST.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path');
let code = fs.readFileSync(path.join(__dirname, '..', 'tsukiyo-phone-1.6.3.js'), 'utf8');
code = code.slice(0, code.lastIndexOf('TsukiyoPhoneBundle.start(')).replace('return __toCommonJS(index_exports);',
  'return {PhoneActions, baibaiRuntime, baibaiReadEnabled, baibaiMemoryCandidates, baibaiFilterInput, actorContext, BaiBaiLink, syncBaibaiMainNpcsToContacts, tpModuleMeta, tpDeleteBar, freshPhone, validatePhone};');
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
  function syncFixture() {
    const f = fixture(), saved = new Map();
    window.STBaiBaiBook.phone.listNotes = () => [...saved.values()];
    window.STBaiBaiBook.phone.pushNotes = (_source, rows) => { for (const r of rows) saved.set(r.id, { ...r }); return { added: rows.length }; };
    const link = new B.BaiBaiLink({ win: window, bridge: { mode: 'tavern' }, settings: { data: f.cfg }, repo: { data: f.data, snapshot: f.snap }, emit() {} });
    return { ...f, saved, link };
  }
  for (const status of ['cancelled', 'done', 'declined', 'expired']) await test('B06 agenda terminal status ' + status + ' updates and unpins old record', async () => {
    const f = syncFixture(); f.data.agenda.push({ id: 'a1', title: '见面', status: 'confirmed', members: ['user', 'a'] });
    await f.link.push(); assert.equal(f.saved.get('agenda:a1').pinned, true);
    f.data.agenda[0].status = status; await f.link.push(); assert.equal(!!f.saved.get('agenda:a1').pinned, false); assert(!f.saved.get('agenda:a1').title.includes('已确认'));
  });
  for (const change of ['resolved', 'disabled', 'removed']) await test('B06 promise ' + change + ' retires its old pinned record, preserving message history', async () => {
    const f = syncFixture(); f.data.memories.push({ id: 'p1', kind: 'promise', text: '一起吃饭', audience: ['user', 'a'], enabled: true });
    await f.link.push(); f.saved.set('msg:old-outside-window', { id: 'msg:old-outside-window', kind: 'phone_chat', text: '历史消息' });
    assert.equal(f.saved.get('promise:p1').pinned, true);
    const p = f.data.memories.at(-1);
    if (change === 'resolved') p.resolved = true;
    if (change === 'disabled') p.enabled = false;
    if (change === 'removed') f.data.memories.pop();
    await f.link.push(); assert.equal(!!f.saved.get('promise:p1').pinned, false); assert(f.saved.has('msg:old-outside-window'));
  });
  await test('B06 deleting agenda writes a tombstone rather than replacing all source history', async () => {
    const f = syncFixture(); f.data.agenda.push({ id: 'a1', title: '约定', status: 'confirmed', members: ['user'] });
    await f.link.push(); f.data.agenda = []; await f.link.push();
    assert.equal(f.saved.get('agenda:a1').title, '已移除事项'); assert.equal(f.saved.get('agenda:a1').pinned, false);
  });
  await test('heartTraces per-floor generation links with BaiBai main NPCs and syncs phone_heart back', async () => {
    const f = syncFixture();
    f.actions.bridge = { context: () => ({ chat: [
      { is_user: true, name: '玩家', mes: '给阿青递了一杯热拿铁。' },
      { is_user: false, name: '阿青', mes: '阿青低头接过杯子，指尖轻轻碰到了你的手背。' }
    ] }) };
    f.actions.router = { call: async (_mod, req) => {
      assert(req.user.includes('#2楼'));
      assert(req.user.includes('给阿青递了一杯热拿铁'));
      return JSON.stringify({
        traces: [{
          author: '阿青',
          title: '杯沿的温度',
          mood: '耳尖微热',
          heartbeat: '82% · 升温',
          stage: '暗生情愫',
          surface: '镇定地道谢并小口喝拿铁',
          replyToFloor: '其实刚才指尖碰到你的时候，我差点没拿稳杯子。',
          text: '他递过来的拿铁热度刚刚好，可我满脑子都是刚才指尖相触的那一秒。',
          secret: '下次想主动帮他系围巾。'
        }]
      });
    } };
    const rows = await f.actions.heartTraces(['a'], { floor: 1 });
    assert.equal(rows.length, 1);
    assert.equal(f.data.diary.length, 1);
    assert.equal(f.data.diary[0].kind, 'heart');
    assert.equal(f.data.diary[0].floor, 1);
    assert.equal(f.data.diary[0].mood, '耳尖微热');
    await f.link.push({ force: true });
    const heartNote = [...f.saved.values()].find(n => n.kind === 'phone_heart');
    assert(heartNote, 'phone_heart must be pushed to BaiBai Book');
    assert(heartNote.title.includes('#2楼'));
    // Test heartFollowup
    f.actions.router = { call: async () => JSON.stringify({ mood: '慌乱掩饰', answer: '我才没有盯着你看，只是在看窗外的雨……好吧，其实有一点。' }) };
    const fu = await f.actions.heartFollowup(f.data.diary[0].id, '刚才是不是在偷看我？');
    assert.equal(fu.mood, '慌乱掩饰');
    assert.equal(f.data.diary[0].followups.length, 1);
  });
  await test('syncBaibaiMainNpcsToContacts imports main NPCs from BaiBai Book into phone contacts', () => {
    const s = B.freshPhone();
    const res = B.syncBaibaiMainNpcsToContacts(s, {
      mainNpcs: [
        { name: '春山未夜', important: true, present: true, relation: '青梅竹马', affinityInner: 85, affinityText: '内心好感:情根深种(85)', condition: '在窗边看书' }
      ]
    });
    assert.equal(res.added.length, 1);
    assert(s.contacts.some(c => c.name === '春山未夜'));
    B.validatePhone(s);
  });
  await test('tpModuleMeta supports multi-select delete and one-click clear across all phone modules', () => {
    const s = B.freshPhone();
    const c1 = { id: 'c1', name: '角色甲', age: 20, bio: '人设', status: '空闲', recognized: true, reachable: true };
    const c2 = { id: 'c2', name: '角色乙', age: 20, bio: '人设', status: '忙碌', recognized: true, reachable: true };
    s.contacts.push(c1, c2);
    s.threads.push({ id: 't1', kind: 'direct', title: '角色甲', members: ['c1'], messages: [{ id: 'm1', role: 'user', author: 'user', text: '你好', ts: 1 }, { id: 'm2', role: 'character', author: 'c1', text: '在的', ts: 2, read: true }], pending: [{ id: 'p1', text: '待发1' }], draft: '', muted: false, createdAt: 1 });
    s.feed.push({ id: 'f1', author: 'c1', text: '动态1', ts: 1, likes: [], comments: [] }, { id: 'f2', author: 'c2', text: '动态2', ts: 2, likes: [], comments: [] });
    s.diary.push({ id: 'd1', title: '普通日记', text: '内容1', ts: 1, status: 'confirmed' }, { id: 'h1', kind: 'heart', floor: 2, author: 'c1', title: '心迹1', text: '心动内容', ts: 2, status: 'confirmed' });
    s.notes.push({ id: 'n1', title: '便签1', text: '便签内容', ts: 1 });
    s.memories.push({ id: 'mem1', kind: 'manual', title: '记忆1', text: '记忆内容', audience: ['user'], sources: [] });
    s.agenda.push({ id: 'ag1', title: '日程1', date: '2026-10-02', status: 'proposed', members: ['c1'] });
    s.tasks.push({ id: 'tk1', title: '清单1', category: '生活', progress: 0, target: 1, done: false });
    s.items.push({ id: 'it1', title: '护身符', quantity: 1, note: '神社求的' });
    s.album.push({ id: 'al1', mediaId: 'url:https://example.com/a.png', title: '照片1', ts: 1 });
    s.places.push({ id: 'pl1', title: '秘密基地', note: '山坡上' });
    s.arc.outline.beats.push({ id: 'b1', title: '第一章', type: '主线', scene: '开端' }, { id: 'b2', title: '第二章', type: '主线', scene: '发展' });
    s.arc.outline.cursor = 1;
    s.arc.lines.items.push({ id: 'l1', name: '感情线', stage: '起线', agency: 'world', desc: '升温中' });
    s.arc.points.days = [{ n: 1, date: '2026-10-02', events: [{ id: 'ev1', type: 'main', title: '偶遇' }] }];
    s.plans.push({ id: 'pl_a', title: '方向1', summary: '概述', status: 'active', members: ['c1'], beats: [{ id: 'pb1', title: '步骤1', scene: '场景', trigger: '前提', finish: '完成', day: 0, choices: [] }] });
    s.activePlan = { id: 'pl_a', cursor: 0 };
    s.logs.push({ id: 'lg1', level: 'info', module: 'chat', message: '完成', ts: 1 });
    B.validatePhone(s);

    const modules = ['chat:t1', 'outbox', 'feed', 'diary', 'heart', 'notes', 'memories', 'agenda', 'tasks', 'items', 'album', 'places', 'arc_beats', 'arc_lines', 'arc_points', 'plans', 'logs', 'threads', 'contacts'];
    for (const key of modules) {
      const meta = B.tpModuleMeta({ data: s }, key);
      assert(meta && meta.items.length > 0, `module ${key} should have items`);
      const firstId = meta.items[0].id;
      const removed = meta.remove(s, new Set([firstId]));
      assert(removed >= 1, `module ${key} remove should delete at least 1 item`);
      meta.clear(s);
      B.validatePhone(s);
    }
  });
  console.log(`PHONE_MEMORY_OK: ${cases} cases (all generation payloads tested with ON/OFF)`);
})().catch(e => { console.error(e); process.exitCode = 1; });
