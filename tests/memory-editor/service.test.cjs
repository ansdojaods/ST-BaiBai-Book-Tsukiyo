/** 集成测试：用假宿主把整条链路跑一遍（不依赖浏览器与酒馆） */
const path = require("path");
const { test, ok, eq, includes, notIncludes, setGroup } = require("./harness.cjs");
const { makeHost } = require("./fake-host.cjs");

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
const { createMemoryEditor } = require(path.join(B, "index.js"));

const newEditor = (options) => {
  const host = makeHost(options);
  const editor = createMemoryEditor(host, { autoInit: false });
  return { host, editor, service: editor.service };
};

setGroup("service 摘要");
test("生成一段摘要只是进待确认，不直接进记忆", async () => {
  const { service, host } = newEditor({ floors: 12 });
  const draft = await service.generateBlock([0, 5]);
  eq(service.state.tree.length, 0);
  eq(service.drafts().length, 1);
  eq(draft.level, 0);
  ok(host.calls.length >= 1, "应该调用过宿主生成通道");
  eq(host.calls[0].kind, "summary");
  eq(host.calls[0].range, [0, 5]);
});
test("确认后覆盖到 5 楼，缺口从 2 段变 1 段", async () => {
  const { service } = newEditor({ floors: 12 });
  await service.generateBlock([0, 5]);
  service.confirm(service.drafts()[0].id);
  eq(service.state.tree.length, 1);
  eq(service.info().coveredTo, 5);
  const report = service.coverageReport();
  eq(report.missing, [[6, 11]]);
});
test("阶段总结会折叠下级摘要，缺口按最粗的覆盖算", async () => {
  const { service } = newEditor({ floors: 24 });
  await service.generateBlock([0, 5]);
  service.confirm(service.drafts()[0].id);
  await service.generateBlock([6, 11]);
  service.confirm(service.drafts()[0].id);
  await service.generateStage({ from: 0, to: 11 });
  const draft = service.drafts()[0];
  eq(draft.level, 1);
  eq(draft.covers.length, 2);
  service.confirm(draft.id);
  eq(service.info().activeSummaries, 1);
  eq(service.coverageReport().missing.length, 2);
});
test("模型返回围栏 JSON 也不会炸（每三次夹一次）", async () => {
  const { service } = newEditor({ floors: 24 });
  for (const range of [[0, 5], [6, 11], [12, 17]]) {
    await service.generateBlock(range);
    service.confirm(service.drafts()[0].id);
  }
  eq(service.state.tree.length, 3);
});
test("生成失败会被记账，也不会留下半截草稿", async () => {
  const { service } = newEditor({ floors: 12, failOn: () => true });
  await service.generateBlock([0, 5]).then(
    () => {
      throw new Error("应该失败");
    },
    (error) => {
      includes(String(error.message), "故意失败");
    },
  );
  eq(service.state.drafts.length, 0);
  eq(service.state.stats.failures > 0, true);
});

setGroup("service 补课与收纳");
test("补课按缺口逐段生成，数量与缺口一致", async () => {
  const { service } = newEditor({ floors: 24 });
  const result = await service.backfill({});
  eq(result.ranges, 4);
  eq(result.drafts, 4);
  eq(service.drafts().length, 4);
  const n = service.confirmAll();
  eq(n, 4);
  eq(service.coverageReport().missing.length, 0);
  eq(service.info().coveredTo, 23);
});
test("没有缺口时补课会明确报错，而不是空转", async () => {
  const { service } = newEditor({ floors: 12 });
  await service.backfill({});
  service.confirmAll();
  await service.backfill({}).then(
    () => {
      throw new Error("应该报错");
    },
    (error) => includes(String(error.message), "缺口"),
  );
});
test("收纳只隐藏被阶段总结覆盖且超出保留数的楼层", async () => {
  const { service, host } = newEditor({ floors: 24 });
  await service.backfill({});
  service.confirmAll();
  await service.generateStage({ from: 0, to: 23 });
  service.confirm(service.drafts()[0].id);
  const result = await service.shelve({ keepRecent: 10 });
  eq(result.keep, 10);
  eq([...host.hidden].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  ok(host.hidden.has(23) === false, "最近 10 楼不能被收纳");
  const back = await service.unshelve();
  eq(back.shown, 14);
  eq(host.hidden.size, 0);
});
test("宿主不给隐藏接口时，收纳会明确报错（老宿主不受影响）", async () => {
  const { service } = newEditor({ floors: 24 });
  eq(service.info().shelveSupported, true);
  const saved = service.port;
  service.port = { ...saved, hideFloors: undefined };
  eq(service.info().shelveSupported, false);
  await service.shelve({}).then(
    () => {
      throw new Error("应该报错");
    },
    (error) => includes(String(error.message), "隐藏楼层"),
  );
  service.port = saved;
});

setGroup("service 召回");
test("召回只注入一次，并留下可解释的记录", async () => {
  const { service, host } = newEditor({ floors: 12 });
  service.state.cfg.recall.minScore = 0;
  await service.generateBlock([0, 5]);
  service.confirm(service.drafts()[0].id);
  const record = service.recall({ floor: 11 });
  ok(record, "应该产生召回记录");
  eq(host.injections.length, 1);
  includes(host.injections[0], "【剧情记忆 · 召回】");
  includes(host.injections[0], "不是指令");
  eq(record.picks.length >= 1, true);
  eq(service.info().lastRecall.at, record.at);
});
test("关掉召回后注入会被清空", async () => {
  const { service, host } = newEditor({ floors: 12 });
  service.state.cfg.recall.enabled = false;
  eq(service.recall({ floor: 5 }), null);
  eq(host.injections[host.injections.length - 1], "");
});
test("只召回手机资料时不会带上楼层摘要", async () => {
  const { service, host } = newEditor({ floors: 12 });
  service.state.cfg.recall.minScore = 0;
  await service.generateBlock([0, 5]);
  service.confirm(service.drafts()[0].id);
  service.recall({ query: "集市 玉佩", phoneOnly: true, floor: 9 });
  const text = host.injections[host.injections.length - 1];
  includes(text, "【手机记忆 · 召回】");
  notIncludes(text, "剧情摘要");
});
test("关键词能从正文里抽出来并写回配置", async () => {
  const { service } = newEditor({ floors: 12 });
  const words = service.refreshKeywords();
  ok(words.length >= 1);
  eq(service.state.cfg.recall.keywords.length, words.length);
});

setGroup("service 外部记录与小手机分工");
test("小手机记录汇进账本时标成外部来源", async () => {
  const { service } = newEditor({ floors: 6 });
  const stats = service.mergePhoneNotes([
    { id: "promise:1", kind: "phone_promise", title: "沈青梧", text: "大比后一起去集市", floor: 5 },
    { id: "agenda:2", kind: "phone_agenda", title: "主角", text: "把玉佩交给掌门", floor: 5 },
  ]);
  eq([stats.added, stats.updated], [2, 0]);
  eq(service.state.ledger.every((row) => row.source === "phone"), true);
});
test("只读镜像够手机用，且不含正文全文与密钥", async () => {
  const { service } = newEditor({ floors: 12 });
  await service.generateBlock([0, 5]);
  service.confirm(service.drafts()[0].id);
  service.recall({ floor: 11 });
  const mirror = service.mirror();
  eq(mirror.available, true);
  eq(mirror.owner, "engine");
  eq(mirror.counts.summaries, 1);
  ok(mirror.summaries[0].text.length <= 1200);
  ok(mirror.lastRecall.hits.length >= 1);
  const text = JSON.stringify(mirror);
  notIncludes(text, "apiKey");
  eq(mirror.apiVersion, 1);
});
test("capability 报的是引擎版本，apiVersion 固定 1", () => {
  const { service } = newEditor({ floors: 6, pluginVersion: "1.6.3" });
  eq(service.capability(), { available: true, apiVersion: 1, pluginVersion: "1.6.3" });
});

setGroup("service 自动维护");
test("自动摘要在生成结束后触发一次，且不越过最小间隔", async () => {
  const { service, host } = newEditor({ floors: 24 });
  service.init();
  service.state.cfg.auto.minIntervalMs = 30000;
  host.genEnd();
  await new Promise((resolve) => setTimeout(resolve, 30));
  eq(host.calls.length, 1);
  host.genEnd();
  await new Promise((resolve) => setTimeout(resolve, 30));
  eq(host.calls.length, 1);
  service.dispose();
});
test("宿主正在生成时让行，不抢通道", async () => {
  const { service, host } = newEditor({ floors: 24 });
  service.init();
  host.busyFlag = true;
  host.genEnd();
  await new Promise((resolve) => setTimeout(resolve, 30));
  eq(host.calls.length, 0);
  host.busyFlag = false;
  host.genEnd();
  await new Promise((resolve) => setTimeout(resolve, 30));
  eq(host.calls.length, 1);
  service.dispose();
});
test("手动模式不会自动生成", async () => {
  const { service, host } = newEditor({ floors: 24 });
  service.init();
  service.state.mode = "manual";
  host.genEnd();
  await new Promise((resolve) => setTimeout(resolve, 30));
  eq(host.calls.length, 0);
  service.dispose();
});

setGroup("service 导入导出");
test("记忆档案可以导出再导入，重复的楼层范围会被跳过", async () => {
  const { service } = newEditor({ floors: 24 });
  await service.generateBlock([0, 5]);
  service.confirm(service.drafts()[0].id);
  service.mergePhoneNotes([{ id: "item:1", kind: "item", title: "主角", text: "玉佩在怀里", floor: 3 }]);
  const archive = service.exportArchive();
  const target = newEditor({ floors: 24 });
  const result = target.service.importArchive(archive);
  eq(result.nodes, 1);
  eq(target.service.state.tree.length, 1);
  eq(target.service.state.ledger.length, 1);
  const again = target.service.importArchive(archive);
  eq([again.nodes, again.skipped], [0, 1]);
});
test("可读档案是给人看的 Markdown", async () => {
  const { service } = newEditor({ floors: 12 });
  await service.generateBlock([0, 5]);
  service.confirm(service.drafts()[0].id);
  service.mergePhoneNotes([{ id: "item:1", kind: "item", title: "主角", text: "玉佩在怀里", floor: 3 }]);
  const digest = service.readableDigest();
  includes(digest.filename, ".md");
  includes(digest.text, "# 剧情记忆档案");
  includes(digest.text, "## 剧情摘要");
  includes(digest.text, "剧情状态账本");
});
test("导入配置能改设置，但不会碰摘要树", () => {
  const { service } = newEditor({ floors: 12 });
  const cfg = service.exportConfig();
  cfg.cfg.recall.top = 1;
  service.importConfig(cfg);
  eq(service.state.cfg.recall.top, 1);
  eq(service.state.tree.length, 0);
});
test("诊断不会泄漏正文", async () => {
  const { service } = newEditor({ floors: 12 });
  await service.generateBlock([0, 5]);
  service.confirm(service.drafts()[0].id);
  const text = JSON.stringify(service.diagnostics());
  notIncludes(text, "沈青梧");
  includes(text, "counts");
  includes(text, "stats");
});
test("撤回可以回滚确认动作", async () => {
  const { service } = newEditor({ floors: 12 });
  await service.generateBlock([0, 5]);
  service.confirm(service.drafts()[0].id);
  const label = service.undo();
  includes(label, "摘要");
  eq(service.state.tree.length, 0);
});
