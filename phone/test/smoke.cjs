// 纯 Node 冒烟测试:从打包产物中切出 utils + baibai-bridge + storyFor,用假的 STBaiBaiBook.phone 跑一遍联动逻辑。
// 用法: node phone/test/smoke.cjs [bundle.js]
const fs = require("fs");
const path = require("path");
const file = process.argv[2] || path.join(__dirname, "..", "tsukiyo-phone-1.6.3.js");
const js = fs.readFileSync(file, "utf8");
const between = (a, b) => { const i = js.indexOf(a); if (i < 0) throw Error("marker missing: " + a); const j = js.indexOf(b, i + a.length); return js.slice(i, j); };
const utilsStart = js.indexOf("  // src/core/utils.js");
const utils = js.slice(utilsStart, js.indexOf("  // src/", utilsStart + 10));
const mod = between("  // src/services/baibai-bridge.js", "  // src/services/context.js");
const ctx = between("  // src/services/context.js", "  var names = ");
const scenario = fs.readFileSync(path.join(__dirname, "smoke.scenario.js"), "utf8");
new Function("globalThis.window = globalThis; var PRESET = null; var package_default = { version: '1.6.3' };\n" + utils + mod + ctx + scenario)();
