// jsdom 集成测试(需先 npm i -D jsdom):离线演示模式下启动整部手机,用假的 STBaiBaiBook.phone 点一遍联动按钮。
// 用法: node phone/test/demo.jsdom.cjs [bundle.js]
const { JSDOM } = require('jsdom');
const fs = require('fs');
let src = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'tsukiyo-phone-1.6.3.js'), 'utf8');
src = src.replace('baibaiRuntime.enabled = eng.bridge.mode !== "demo";', 'baibaiRuntime.enabled = true;');
const code = src.slice(0, src.lastIndexOf('TsukiyoPhoneBundle.start('));
const dom = new JSDOM('<!doctype html><html><body><div id="chat"></div></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;
window.console = console;
const notesStore = [];
let pushCalls = 0;
window.STBaiBaiBook = { phone: {
  isEnabled: () => true,
  getBrief: () => ({ apiVersion: 1, pluginVersion: '1.3.0', time: '2024年3月15日 下午3点', weekday: '周五', location: '咖啡馆', presentNpcs: ['艾琳'], plans: [{ kind: '约定', content: '周日和艾琳去看电影', targetTime: '2024-03-17', daysLeft: 2 }], history: '【3天前】主角搬到新城市。\n【昨天】艾琳在咖啡馆帮主角点了拿铁。', anchor: { version: 2, floor: 40, text: '锚点日记正文……' }, externalCount: notesStore.length }),
  getNpcProfile: (n) => '【' + n + '】\n与主角关系:邻居',
  listNotes: (s) => notesStore.filter(n => n.source === s),
  pushNotes: (s, notes) => { pushCalls++; let added = 0, updated = 0; for (const n of notes) { const p = notesStore.find(x => x.id === n.id); if (p) { Object.assign(p, n); updated++; } else { notesStore.push({ ...n, source: s }); added++; } } window.dispatchEvent(new window.CustomEvent('st-baibai-book:phone-update', { detail: { type: 'external', source: s, added, updated } })); return { added, updated, total: notesStore.length }; },
  listChannels: () => [{ id: 'c1', name: '主渠道', model: 'gpt-4o', host: 'api.openai.com', hasKey: true, lastTest: null }, { id: 'c 2/x', name: '备用', model: 'claude', host: 'x.y', hasKey: false, lastTest: null }],
  exportChannel: (id) => id === 'c1' ? ({ id, name: '主渠道', url: 'https://api.openai.com', key: 'sk-test', model: 'gpt-4o', temperature: 0.7, maxTokens: 4096 }) : ({ id, name: '备用', url: 'https://x.y/v1/chat/completions', key: '', model: 'claude', temperature: 1, maxTokens: 99999 }),
  testChannel: async (id) => ({ ok: id === 'c1', message: id === 'c1' ? 'OK' : '401' }),
}};
window.eval(code + '\nwindow.TsukiyoPhoneBundle = TsukiyoPhoneBundle;');
const B = window.TsukiyoPhoneBundle;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const app = B.start({ mode: 'demo', source: window });
  await sleep(1500);
  const eng = app.engine, ui = app.ui;
  ui.confirm = async (t, c) => { console.log('  [confirm]', t, '|', String(c).split('\n')[0].slice(0, 70)); return true; };
  const notices = [];
  const origNotify = ui.notify.bind(ui);
  ui.notify = (m, k) => { notices.push((k || 'info') + ': ' + m); return origNotify(m, k); };
  console.log('status:', eng.baibai.status().text);
  console.log('demo data: contacts', eng.repo.data.contacts.length, 'threads', eng.repo.data.threads.length, 'memories', eng.repo.data.memories.length);
  const click = async (view, action) => { ui.open(view); await sleep(700); const b = ui.shadow.querySelector(`button[data-action="${action}"]`); if (!b) throw Error('no button ' + action); b.click(); await sleep(700); };
  await click('settings', 'baibai-push-now');
  console.log('after push-now: pushCalls', pushCalls, 'notes', notesStore.length, '| kinds', [...new Set(notesStore.map(n => n.kind))]);
  await click('settings', 'baibai-import-memory');
  const bbMem = eng.repo.data.memories.filter(m => m.bb);
  console.log('after import-memory: bb memories', bbMem.length, bbMem.map(m => m.kind + ':' + m.title).slice(0, 4));
  await click('settings', 'baibai-import-memory');
  console.log('second import notice:', notices.slice(-1)[0]);
  await click('settings', 'baibai-import-api');
  const profs = eng.settings.data.profiles.filter(p => p.id.startsWith('baibai-'));
  console.log('after import-api: profiles', profs.map(p => [p.id, p.name, p.url, p.model, p.maxTokens, p.rememberKey, !!eng.settings.key(p.id)]));
  await click('settings', 'baibai-test');
  console.log('notices tail:', notices.slice(-3));
  // story fallback inside the real engine context functions: planningContext via engine? check prompt compile does not throw
  eng.updatePrompt();
  console.log('prompt compiled length:', (eng.prompt || '').length, 'contains 柏宝书?', (eng.prompt || '').includes('柏宝书'));
  // memory view shows 柏宝书 tag
  ui.open('memories'); await sleep(250);
  console.log('memory view tag 柏宝书:', ui.shadow.innerHTML.includes('>柏宝书<'));
  // memory-sync exclusion: planMemorySync input filtered — check via memoryBook plan if accessible
  // New memory-page controls in the real rendered phone UI.
  await click('memories', 'baibai-preview-memory');
  await click('memories', 'baibai-brief');
  if (eng.settings.data.ui.baibai.brief !== false) throw Error('read toggle did not switch OFF');
  await click('memories', 'baibai-brief');
  if (eng.settings.data.ui.baibai.brief !== true) throw Error('read toggle did not switch ON');
  if (!eng.repo.data.memories.some(m => m.bb)) throw Error('toggle deleted saved book memories');
  console.log('MEMORY_UI_OK: preview and read toggle ON/OFF; saved memories retained');
  // toggles
  await click('settings', 'baibai-enabled');
  console.log('after disable: status:', eng.baibai.status().text, '| settings.ui.baibai =', JSON.stringify(eng.settings.data.ui.baibai));
  await click('settings', 'baibai-enabled');
  console.log('after re-enable:', JSON.stringify(eng.settings.data.ui.baibai));
  app.dispose();
  console.log('DEMO2_OK');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
