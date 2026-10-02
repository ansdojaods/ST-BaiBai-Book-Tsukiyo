import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const js = readFileSync('dist/index.js', 'utf8');
for (const text of ['/api/plugins/st-bainiaodata', '白鸟数据后端:', '重新检测', '立即备份当前聊天']) {
  assert(!js.includes(text), `remote backend artifact remains: ${text}`);
}
assert(!existsSync('src/backend/sync.ts'));
assert(!existsSync('src/backend/bainiao.ts'));
for (const text of ['手写补摘', '保存手写摘要', 'shareMemory']) assert(js.includes(text), `missing feature: ${text}`);
assert(existsSync('src/backend/restore.ts'));
assert(existsSync('src/backend/trash.ts'));
console.log('LOCAL_ONLY_OK: no whitebird endpoint/remote UI; manual summary, local recovery and read switch present.');
