/** 极简测试工具（零依赖，node tests/run-all.cjs 直接跑） */
const queue = [];
let group = "";

const setGroup = (name) => {
  group = name;
};

/** 注册一个用例；支持同步与 async 函数，执行顺序 = 注册顺序 */
const test = (name, fn) => {
  queue.push({ name, group, fn });
};

const ok = (value, message = "期望为真") => {
  if (!value) throw new Error(message);
};

const eq = (actual, expected, message = "") => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message ? message + "：" : ""}期望 ${b}，实际 ${a}`);
};

const near = (actual, expected, tol = 1e-6, message = "") => {
  if (Math.abs(Number(actual) - Number(expected)) > tol) throw new Error(`${message ? message + "：" : ""}期望 ≈${expected}，实际 ${actual}`);
};

const includes = (haystack, needle, message = "") => {
  if (String(haystack).indexOf(needle) < 0) throw new Error(`${message ? message + "：" : ""}没有找到「${needle}」`);
};

const notIncludes = (haystack, needle, message = "") => {
  if (String(haystack).indexOf(needle) >= 0) throw new Error(`${message ? message + "：" : ""}不该出现「${needle}」`);
};

const throws = (fn, message = "") => {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`${message ? message + "：" : ""}期望抛错但没有`);
};

const rejects = async (promise, needle, message = "") => {
  try {
    await promise;
  } catch (error) {
    if (needle) includes(String(error && error.message), needle, message);
    return;
  }
  throw new Error(`${message ? message + "：" : ""}期望抛错但没有`);
};

const run = async () => {
  let passed = 0;
  const failures = [];
  let lastGroup = "";
  for (const item of queue) {
    if (item.group !== lastGroup) {
      console.log(`\n[${item.group || "未分组"}]`);
      lastGroup = item.group;
    }
    try {
      await item.fn();
      passed += 1;
      console.log(`  \u2713 ${item.name}`);
    } catch (error) {
      failures.push(`${item.group} · ${item.name}: ${error && error.message}`);
      console.log(`  \u2717 ${item.name}\n      ${error && error.message}`);
    }
  }
  console.log(`\n通过 ${passed} · 失败 ${failures.length}`);
  if (failures.length) {
    for (const line of failures) console.log(`  ! ${line}`);
    process.exitCode = 1;
  }
  return { passed, failed: failures.length };
};

module.exports = { test, ok, eq, near, includes, notIncludes, throws, rejects, run, setGroup };
