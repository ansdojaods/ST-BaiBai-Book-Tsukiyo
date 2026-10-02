// ---- scenario ----
let pushed = [];
let notesStore = [];
window.STBaiBaiBook = { phone: {
  isEnabled: () => true,
  getBrief: ({historyChars}) => ({ apiVersion: 1, pluginVersion: "1.3.0", time: "2024年3月15日 下午3点", weekday: "周五", location: "咖啡馆", presentNpcs: ["艾琳"], plans: [{kind:"约定", content:"周日和艾琳去看电影", targetTime:"2024-03-17", daysLeft:2}], history: "【3天前】主角搬到新城市。\n【昨天】艾琳在咖啡馆帮主角点了拿铁。\n短", anchor: {version: 2, floor: 40, text: "锚点日记正文……"}, externalCount: notesStore.length }),
  getNpcProfile: (n) => n === "艾琳" ? "【艾琳】\n与主角关系:邻居" : "",
  listNotes: (src) => notesStore.filter(n => n.source === src),
  pushNotes: (src, notes) => { let added = 0, updated = 0; for (const n of notes) { const p = notesStore.find(x => x.id === n.id && x.source === src); if (p) { Object.assign(p, n); updated++; } else { notesStore.push({ ...n, source: src }); added++; } } pushed.push(notes.length); return { added, updated, total: notesStore.length }; },
  listChannels: () => [{ id: "c1", name: "主渠道", model: "gpt-4o", host: "api.openai.com", hasKey: true }],
  exportChannel: (id) => ({ id, name: "主渠道", url: "https://api.openai.com", key: "sk-test", model: "gpt-4o", temperature: 0.7, maxTokens: 4096 }),
}};
const settings = { ui: { baibai: {} } };
baibaiRuntime.settings = () => settings; baibaiRuntime.win = window; baibaiRuntime.enabled = true;
const data = { manualStory: { date: "", time: "", place: "" }, contacts: [{ id: "c-ailin", name: "艾琳" }], memories: [] };
const w = storyFor(data, { story: { date: "", time: "", place: "" } });
console.log("storyFor:", JSON.stringify(w));
if (w.date !== "2024-03-15" || w.origin !== "柏宝书记忆" || w.place !== "咖啡馆" || w.time !== "下午3点") throw Error("storyFor fallback wrong");
const w2 = storyFor(data, { story: { date: "2024-04-01", time: "早上", place: "家" } });
if (w2.origin !== "主线变量" || w2.date !== "2024-04-01") throw Error("MVU priority broken");
console.log("storyFor(MVU):", JSON.stringify(w2));
settings.ui.baibai.brief = false; baibaiInvalidate();
const w3 = storyFor(data, { story: {} });
if (w3.origin !== "尚未提供剧情日期") throw Error("brief toggle not respected: " + w3.origin);
settings.ui.baibai.brief = true; baibaiInvalidate();
console.log("present fallback:", baibaiPresentFallback([]), baibaiPresentFallback(["小明"]));
console.log("actorBrief(present):", JSON.stringify(baibaiActorBrief({ name: "艾琳" }, true)).slice(0, 300));
console.log("actorBrief(absent):", JSON.stringify(baibaiActorBrief({ name: "小明" }, false)));
console.log("planningBrief:", JSON.stringify(baibaiPlanningBrief()).slice(0, 200));
const cands = baibaiMemoryCandidates(baibaiBrief(), data);
console.log("memory candidates:", cands.length, cands.map(c => [c.id.slice(0, 20), c.kind, c.audience]));
if (cands.length !== 4) throw Error("expected 4 candidates (1 plan + 1 anchor + 2 history lines >= 12 chars)");
console.log("splitTime:", JSON.stringify(baibaiSplitTime("2024-03-15 15:00")), JSON.stringify(baibaiSplitTime("第三天 清晨")), JSON.stringify(baibaiSplitTime("2024.3.5")));
console.log("normalizeUrl:", baibaiNormalizeUrl("https://api.openai.com"), baibaiNormalizeUrl("https://x.y/v1/chat/completions/"), baibaiNormalizeUrl("https://x.y/v2/coding"));
// BaiBaiLink push
const eng = { win: window, bridge: { mode: "tavern" }, settings: { data: settings }, repo: { data: { threads: [{ id: "t1", kind: "direct", title: "", members: ["c-ailin"], messages: [{ id: "m1", author: "user", text: "在吗", kind: "text", ts: 1, story: "2024-03-15 下午3点", read: true, role: "user" }, { id: "m2", author: "c-ailin", text: "在的，怎么了？", kind: "text", ts: 2, story: "2024-03-15 下午3点", read: false, role: "character" }] }], agenda: [{ id: "a1", title: "周日看电影", date: "2024-03-17", time: "14:00", status: "proposed", members: ["c-ailin"], note: "" }], feed: [{ id: "f1", author: "c-ailin", text: "今天的拿铁拉花很好看", comments: [] }], memories: [{ id: "p1", kind: "promise", text: "艾琳答应借主角一本书", audience: ["user", "c-ailin"], resolved: false, enabled: true, sources: [] }], contacts: data.contacts }, snapshot: { floor: 41, userName: "小月" }, on: () => () => {} }, emit: () => {}, refresh: () => {}, debounce: null };
const link = new BaiBaiLink(eng);
baibaiRuntime.settings = () => settings;
(async () => {
  const r1 = await link.push({ force: true });
  console.log("push1:", JSON.stringify(r1), "notes:", notesStore.map(n => n.id));
  if (r1.added !== 5) throw Error("expected 5 notes added, got " + r1.added);
  const r2 = await link.push({ force: true });
  console.log("push2 (no change):", JSON.stringify(r2), "pushed batches:", pushed);
  if (pushed.length !== 1) throw Error("second push should not resend unchanged notes");
  eng.repo.data.agenda[0].status = "confirmed";
  const r3 = await link.push({ force: true });
  console.log("push3 (agenda confirmed):", JSON.stringify(r3), notesStore.find(n => n.id === "agenda:a1").text, "floor kept:", notesStore.find(n => n.id === "agenda:a1").floor);
  if (r3.updated !== 1 || r3.added !== 0) throw Error("expected exactly one update");
  console.log("status:", link.status().text);
  settings.ui.baibai.enabled = false;
  console.log("status(disabled):", link.status().text, "brief:", baibaiStory());
  console.log("ALL_OK");
})().catch(e => { console.error("FAIL", e); process.exit(1); });
