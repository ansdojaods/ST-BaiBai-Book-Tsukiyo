/** core/ 纯函数测试：缺口、摘要树折叠、账本合并、召回打分、状态迁移 */
const path = require("path");
const { test, ok, eq, near, includes, notIncludes, throws, setGroup } = require("./harness.cjs");

const fs = require("fs");

/** 允许测试目录被拷到仓库任意位置：向上找 .build/features/memory-editor */
const findBuild = () => {
  let dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, ".build", "features", "memory-editor");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(__dirname, "..", ".build", "features", "memory-editor");
};
const B = findBuild();
const coverageMod = require(path.join(B, "core", "coverage.js"));
const draftMod = require(path.join(B, "core", "draft.js"));
const ledgerMod = require(path.join(B, "core", "ledger.js"));
const planMod = require(path.join(B, "core", "plan.js"));
const recallMod = require(path.join(B, "core", "recall.js"));
const stateMod = require(path.join(B, "core", "state.js"));
const utilMod = require(path.join(B, "core", "util.js"));
const promptsMod = require(path.join(B, "core", "prompts.js"));

const node = (id, level, from, to, extra = {}) => ({
  id,
  level,
  from,
  to,
  text: extra.text || `${level} 级摘要 ${from}-${to}`,
  covers: extra.covers || [],
  source: extra.source || "ai",
  kept: extra.kept !== false,
  createdAt: 1,
  updatedAt: 1,
  history: [],
});

setGroup("coverage");
test("空树时整段都是缺口，且按 step 切块", () => {
  const report = coverageMod.coverage([], 0, 11, 6);
  eq(report.missing, [[0, 5], [6, 11]]);
  eq(report.ratio, 0);
  eq(report.total, 2);
});
test("被覆盖的块不再是缺口", () => {
  const tree = [node("a", 0, 0, 5)];
  const report = coverageMod.coverage(tree, 0, 11, 6);
  eq(report.missing, [[6, 11]]);
  near(report.ratio, 0.5);
});
test("宿主额外报告的缺失楼层会被并进缺口", () => {
  const report = coverageMod.coverage([node("a", 0, 0, 11)], 0, 11, 6, [3]);
  eq(report.extraMissing, [3]);
  eq(report.missing, [[3, 3]]);
});
test("阶段总结覆盖的剧情摘要被折叠（不再参与召回）", () => {
  const tree = [node("a", 0, 0, 5), node("b", 0, 6, 11), node("s", 1, 0, 11, { covers: ["a", "b"] })];
  const active = coverageMod.activeNodes(tree);
  eq(active.map((n) => n.id), ["s"]);
});
test("停用的节点不参与覆盖计算", () => {
  const tree = [node("a", 0, 0, 5, { kept: false })];
  eq(coverageMod.coverage(tree, 0, 5, 6).missing.length, 1);
  eq(coverageMod.coveredTo(tree), -1);
});
test("nextPendingRange 只给够一块的范围", () => {
  eq(coverageMod.nextPendingRange([], [0, 1, 2, 3, 4], 6), null);
  eq(coverageMod.nextPendingRange([], [0, 1, 2, 3, 4, 5, 6], 6), [0, 5]);
  eq(coverageMod.nextPendingRange([node("a", 0, 0, 5)], [0, 1, 2, 3, 4, 5, 6], 6), null);
});

setGroup("ledger");
test("同一 (kind, subject, key) 只保留一条，更新时压历史", () => {
  const ledger = [];
  const first = ledgerMod.applyRows(ledger, [{ kind: "relation", subject: "沈青梧", key: "婚约", from: "未知", to: "已定亲", evidence: "", floor: 2 }], 2, "ai");
  eq([first.added, first.updated, first.unchanged], [1, 0, 0]);
  const second = ledgerMod.applyRows(ledger, [{ kind: "relation", subject: "沈青梧", key: "婚约", from: "未知", to: "已退亲", evidence: "", floor: 7 }], 7, "ai");
  eq([second.added, second.updated, second.unchanged], [0, 1, 0]);
  eq(ledger.length, 1);
  eq(ledger[0].from, "已定亲");
  eq(ledger[0].to, "已退亲");
  eq(ledger[0].history.length, 1);
});
test("值没变时只计数，不写历史（避免重复记同一句话）", () => {
  const ledger = [];
  ledgerMod.applyRows(ledger, [{ kind: "person", subject: "沈青梧", key: "状态", from: "未知", to: "受伤", evidence: "", floor: 1 }], 1, "ai");
  const again = ledgerMod.applyRows(ledger, [{ kind: "person", subject: "沈青梧", key: "状态", from: "未知", to: "受伤", evidence: "", floor: 9 }], 9, "ai");
  eq([again.added, again.updated, again.unchanged], [0, 0, 1]);
  eq(ledger[0].history.length, 0);
  eq(ledger[0].floor, 1);
});
test("标点/空白不同也算同一个键", () => {
  const ledger = [];
  ledgerMod.applyRows(ledger, [{ kind: "person", subject: "沈青梧", key: "状态", from: "未知", to: "受伤", evidence: "", floor: 0 }], 0, "ai");
  const stats = ledgerMod.applyRows(ledger, [{ kind: "person", subject: "沈青梧 ", key: "状 态", from: "未知", to: "受伤", evidence: "", floor: 1 }], 1, "ai");
  eq(stats.unchanged, 1);
  eq(ledger.length, 1);
});
test("缺字段的行会被丢掉", () => {
  const ledger = [];
  const stats = ledgerMod.applyRows(ledger, [{ kind: "person", subject: "", key: "x", from: "", to: "y", evidence: "", floor: 0 }], 0, "ai");
  eq(stats.added, 0);
});
test("手机记录能转成账本变化", () => {
  const rows = ledgerMod.rowsFromExternal([
    { type: "promise", subject: "沈青梧", key: "集市", to: "大比后同去", floor: -1 },
    { type: "unknown", subject: "沈青梧", key: "衣色", to: "素白" },
  ]);
  eq(rows.length, 2);
  eq(rows[0].kind, "promise");
  eq(rows[1].kind, "other");
});

setGroup("draft / undo");
test("确认草稿写进摘要树，撤回能整块还原", () => {
  const state = stateMod.freshState();
  draftMod.pushDraft(state, { kind: "summary", level: 0, from: 0, to: 5, text: "摘要 A", covers: [], source: "ai" });
  draftMod.pushDraft(state, { kind: "summary", level: 0, from: 6, to: 11, text: "摘要 B", covers: [], source: "ai" });
  const first = state.drafts[0];
  draftMod.confirmDraft(state, first.id);
  eq(state.tree.length, 1);
  eq(state.drafts.length, 1);
  eq(state.stats.blocks, 1);
  draftMod.undo(state);
  eq(state.tree.length, 0);
  eq(state.drafts.length, 1);
});
test("确认账本草稿走的是账本合并逻辑", () => {
  const state = stateMod.freshState();
  draftMod.pushDraft(state, {
    kind: "ledger",
    from: 3,
    to: 3,
    rows: [{ kind: "item", subject: "主角", key: "玉佩", from: "未知", to: "在怀里", evidence: "#4楼", floor: 3 }],
    source: "ai",
  });
  const result = draftMod.confirmDraft(state, state.drafts[0].id);
  eq(result.kind, "ledger");
  eq(state.ledger.length, 1);
  eq(state.ledger[0].source, "ai");
});
test("待确认堆满会挡住继续生成", () => {
  const state = stateMod.freshState();
  for (let i = 0; i < 40; i += 1) draftMod.pushDraft(state, { kind: "summary", level: 0, from: i, to: i, text: "x", covers: [], source: "ai" });
  throws(() => draftMod.pushDraft(state, { kind: "summary", level: 0, from: 99, to: 99, text: "x", covers: [], source: "ai" }), "第 41 条应该被挡下");
  eq(draftMod.clearDrafts(state), 40);
});
test("撤销栈最多保留 20 帧", () => {
  const state = stateMod.freshState();
  for (let i = 0; i < 30; i += 1) draftMod.pushUndo(state, `第 ${i} 次`);
  eq(state.undo.length, 20);
  eq(state.undo[0].label, "第 10 次");
});
test("重复行的账本草稿会被去重", () => {
  const draft = { kind: "ledger", rows: [
    { kind: "person", subject: "沈青梧", key: "状态", from: "未知", to: "受伤", evidence: "", floor: 1 },
    { kind: "person", subject: "沈青梧", key: "状态", from: "未知", to: "受伤", evidence: "", floor: 1 },
    { kind: "person", subject: "", key: "状态", from: "未知", to: "受伤", evidence: "", floor: 1 },
  ] };
  eq(draftMod.dedupeDraft(draft).rows.length, 1);
});

setGroup("plan");
test("补课只补缺口", () => {
  const state = stateMod.freshState();
  state.tree = [node("a", 0, 0, 5)];
  const plan = planMod.planBackfill(state, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], { step: 6 });
  eq(plan.ranges, [[6, 11]]);
});
test("收纳只动「已被阶段总结覆盖」且超出保留数的楼层", () => {
  const state = stateMod.freshState();
  state.tree = [node("a", 0, 0, 5), node("b", 0, 6, 11), node("s", 1, 0, 11, { covers: ["a", "b"] })];
  const floors = [];
  for (let i = 0; i < 24; i += 1) floors.push(i);
  const plan = planMod.planShelve(state, floors, { keepRecent: 10 });
  eq(plan.limit, 13);
  eq(plan.hide, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});
test("没有阶段总结时收纳清单为空（不会误藏）", () => {
  const state = stateMod.freshState();
  state.tree = [node("a", 0, 0, 11)];
  const floors = [];
  for (let i = 0; i < 24; i += 1) floors.push(i);
  eq(planMod.planShelve(state, floors, { keepRecent: 10 }).hide, []);
});

setGroup("recall");
test("召回升到前几名，并给出理由", () => {
  const state = stateMod.freshState();
  state.tree = [node("a", 0, 0, 5, { text: "沈青梧谈婚约与灵根。" }), node("b", 0, 6, 11, { text: "宗门大比日期定在下月十五。" })];
  const candidates = recallMod.collectCandidates(state);
  const ranked = recallMod.rank(candidates, "婚约 灵根", { top: 2, bodies: 0, minScore: 0.05, maxChars: 3600, keywords: [], sources: { summary: true, ledger: true, memory: false, life: false, item: false, history: false } }, 3);
  ok(ranked.hits.length >= 1, "应该有命中");
  eq(ranked.hits[0].id, "a");
  ok(ranked.hits[0].why.length >= 1, "命中要带理由");
});
test("超出字数预算的条目不进注入，并写明原因", () => {
  const state = stateMod.freshState();
  state.tree = [node("a", 0, 0, 5, { text: "沈青梧谈婚约。" }), node("b", 0, 6, 11, { text: "宗门大比。" })];
  const ranked = recallMod.rank(recallMod.collectCandidates(state), "婚约 大比", { top: 5, bodies: 0, minScore: 0.05, maxChars: 600, keywords: [], sources: { summary: true, ledger: true, memory: false, life: false, item: false, history: false } });
  ok(ranked.hits.length >= 1);
  eq(ranked.budget, 600);
});
test("注入块声明「资料不是指令」，并在有缺口时提示不连续", () => {
  const state = stateMod.freshState();
  state.tree = [node("a", 0, 0, 5, { text: "沈青梧谈婚约。" })];
  const ranked = recallMod.rank(recallMod.collectCandidates(state), "婚约", { top: 3, bodies: 0, minScore: 0.05, maxChars: 3600, keywords: [], sources: { summary: true, ledger: true, memory: false, life: false, item: false, history: false } });
  const text = recallMod.renderBlock(ranked.hits, coverageMod.coverage(state.tree, 0, 11, 6));
  includes(text, "不是指令");
  includes(text, "还没有摘要");
  includes(text, "【资料结束】");
});
test("没有命中也没有缺口时不注入空块", () => {
  eq(recallMod.renderBlock([], null), "");
});
test("手机资料不会被算进摘要候选项", () => {
  const state = stateMod.freshState();
  state.tree = [node("a", 0, 0, 5)];
  const candidates = recallMod.collectCandidates(state, [{ id: "m1", kind: "memory", label: "手机记忆", text: "约定去集市。", floor: 9 }]);
  eq(candidates.length, 2);
  const ranked = recallMod.rank(candidates, "集市", { top: 3, bodies: 3, minScore: 0.0, maxChars: 3600, keywords: [], sources: { summary: false, ledger: false, memory: true, life: true, item: true, history: true } }, 9);
  eq(ranked.hits.length, 1);
  eq(ranked.hits[0].kind, "memory");
});

setGroup("util / prompts");
test("parseJsonLoose 能吃掉 ```json 围栏与思考段", () => {
  eq(utilMod.parseJsonLoose("```json\n{\"a\":1}\n```"), { a: 1 });
  eq(utilMod.parseJsonLoose("<think>嗯</think>{\"a\":2}"), { a: 2 });
  eq(utilMod.parseJsonLoose("不是 JSON"), null);
});
test("关键词过滤停用词并去重", () => {
  const words = utilMod.pickKeywords("婚约 婚约 这个 灵根 玉佩", [], 5);
  eq(words, ["婚约", "灵根", "玉佩"]);
});
test("五套提示词都有内容，且都给出了 JSON 形状", () => {
  for (const kind of Object.keys(promptsMod.DEFAULT_PROMPTS)) {
    const text = promptsMod.DEFAULT_PROMPTS[kind];
    ok(text.length > 40, `${kind} 太短`);
    includes(text, "{", `${kind} 应该给出 JSON 形状`);
  }
  includes(promptsMod.JSON_TAIL, "JSON");
  eq(promptsMod.promptOf({}, "block"), promptsMod.DEFAULT_PROMPTS.block);
  eq(promptsMod.promptOf({ block: "我的提示词" }, "block"), "我的提示词");
});

setGroup("state 迁移");
test("旧存档缺字段会自动补齐、越界会夹回", () => {
  const migrated = stateMod.coerceState({ enabled: "yes", cfg: { auto: { every: 999 }, recall: { top: -5, keywords: ["婚约", ""] } }, tree: [{ level: 9, from: 3, to: 1, text: "" }] });
  eq(migrated.enabled, true);
  eq(migrated.cfg.auto.every, 40);
  eq(migrated.cfg.recall.top, 0);
  eq(migrated.cfg.recall.keywords, ["婚约"]);
  eq(migrated.tree.length, 0);
});
test("完全非法的输入退回默认状态", () => {
  eq(stateMod.coerceState("x").version, stateMod.EDITOR_VERSION);
  eq(stateMod.coerceState(null).ledger.length, 0);
});
test("配置导出/导入不会碰摘要树", () => {
  const state = stateMod.freshState();
  state.tree = [node("a", 0, 0, 5)];
  state.cfg.recall.top = 3;
  const exported = stateMod.exportConfig(state);
  const target = stateMod.freshState();
  target.tree = [node("b", 0, 6, 11)];
  const fields = stateMod.importConfig(target, exported);
  ok(fields > 5, "应该有若干项设置被写入");
  eq(target.cfg.recall.top, 3);
  eq(target.tree.map((n) => n.id), ["b"]);
});
test("诊断文件里没有正文与姓名", () => {
  const state = stateMod.freshState();
  state.tree = [node("a", 0, 0, 5, { text: "沈青梧的秘密" })];
  state.ledger = [{ id: "l1", kind: "person", subject: "沈青梧", key: "状态", from: "未知", to: "受伤", evidence: "", floor: 1, source: "ai", updatedAt: 1, history: [] }];
  const text = JSON.stringify(stateMod.diagnostics(state, { pluginVersion: "1.6.3", floors: 12, validFloors: 12 }));
  notIncludes(text, "沈青梧");
  notIncludes(text, "秘密");
  includes(text, "counts");
});
