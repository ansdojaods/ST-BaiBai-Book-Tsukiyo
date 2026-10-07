/**
 * 跨仓库契约测试 · 柏宝书侧（剧情剪辑台 core）
 *
 * 手机 v2.9 的记忆工作台（`src/services/memory-studio.js` 的 msCoverage / msLedgerKey）与剪辑台
 * `core/coverage.ts` / `core/ledger.ts` 是**同一套算法的两份实现**（有意为之：引擎没装时手机自管）。
 * 本文件把两侧都必须满足的取值固定成夹具：任何一侧改了算法，自己这份测试先红。
 *
 * 对照实现：`tsukiyo-phone/tools/test_contract.cjs`（同一份夹具，标记 @contract-fixture）。
 * 两个仓库的检查目录同时在本机时，本文件会顺手比对两侧夹具是否一致（漂移即失败）。
 */
const fs = require("fs");
const path = require("path");
const { test, ok, eq, setGroup } = require("./harness.cjs");

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
const ledgerMod = require(path.join(B, "core", "ledger.js"));

// @contract-fixture:begin
const CONTRACT_FIXTURE = {
  coverage: [
    {
      name: "两块都覆盖",
      tree: [[0, 5], [6, 11]],
      from: 0,
      to: 23,
      step: 6,
      extraMissing: [],
      expect: { total: 4, covered: 2, missing: [[12, 17], [18, 23]], ratio: 0.5, extraMissing: [] },
    },
    {
      name: "宿主额外报告缺失楼层（落在已覆盖块里的才算数）",
      tree: [[0, 5], [6, 11], [18, 23]],
      from: 0,
      to: 23,
      step: 6,
      extraMissing: [3, 20],
      expect: { total: 4, covered: 3, missing: [[3, 3], [12, 17], [20, 20]], ratio: 0.75, extraMissing: [3, 20] },
    },
  ],
  ledgerKeys: [
    { row: { kind: "person", subject: " 临 安 ", key: "关系（阶段）" }, key: "person|临安|关系阶段" },
    { row: { kind: "", subject: "临安", key: "关系阶段" }, key: "other|临安|关系阶段" },
    { row: { kind: "Item", subject: "Lantern", key: "Status" }, key: "item|lantern|status" },
  ],
};
// @contract-fixture:end

const mk = (id, a, b, level = 0) => ({ id, level, from: a, to: b, text: "", covers: [], kept: true });

setGroup("跨仓库契约 · 账本键");

test("ledgerKey 与夹具一致（大小写 / 空白 / 标点都归一）", () => {
  for (const { row, key } of CONTRACT_FIXTURE.ledgerKeys) {
    eq(ledgerMod.ledgerKey(row), key, `ledgerKey(${row.kind}/${row.subject}/${row.key})`);
  }
});

test("ledgerKey 幂等：同一对象调用两次结果一致", () => {
  const row = { kind: "person", subject: " 临 安 ", key: "关系（阶段）" };
  eq(ledgerMod.ledgerKey(row), ledgerMod.ledgerKey(row));
});

setGroup("跨仓库契约 · 覆盖几何");

test("覆盖块切分与缺口区间和夹具一致", () => {
  for (const item of CONTRACT_FIXTURE.coverage) {
    const tree = item.tree.map(([a, b], i) => mk(`n${i}`, a, b));
    const r = coverageMod.coverage(tree, item.from, item.to, item.step, item.extraMissing);
    eq(r.total, item.expect.total, `${item.name} · total`);
    eq(r.covered, item.expect.covered, `${item.name} · covered`);
    eq(JSON.stringify(r.missing), JSON.stringify(item.expect.missing), `${item.name} · missing`);
    eq(r.ratio, item.expect.ratio, `${item.name} · ratio`);
    eq(JSON.stringify(r.extraMissing), JSON.stringify(item.expect.extraMissing), `${item.name} · extraMissing`);
  }
});

test("step 非法值回落到 6；from > to 会被夹紧", () => {
  const r = coverageMod.coverage([mk("a", 0, 11)], 0, 11, 0);
  eq(r.step, 6);
  const r2 = coverageMod.coverage([], 5, 3, 6);
  eq(r2.from, 5);
  eq(r2.to, 5);
});

setGroup("跨仓库契约 · 两侧夹具一致");

test("手机仓 tools/test_contract.cjs 的夹具与本文件一致（存在才检查）", () => {
  const candidates = [
    process.env.PHONE_DIR,
    path.join(__dirname, "..", "..", "..", "tsukiyo-phone"),
    path.join(__dirname, "..", "..", "tsukiyo-phone"),
  ].filter(Boolean);
  const file = candidates.map((dir) => path.join(dir, "tools", "test_contract.cjs")).find((p) => fs.existsSync(p));
  if (!file) {
    ok(true, "本机没有手机仓检查目录（已跳过；CI 里两个仓库都在时才生效）");
    return;
  }
  const read = (text) => {
    const m = text.match(/@contract-fixture:begin([\s\S]*?)@contract-fixture:end/);
    return m ? m[1].replace(/\s+/g, "") : "";
  };
  const mine = read(fs.readFileSync(__filename, "utf8"));
  const theirs = read(fs.readFileSync(file, "utf8"));
  ok(mine.length > 0 && mine === theirs, "两侧 @contract-fixture 块逐字节一致（忽略空白）");
});
