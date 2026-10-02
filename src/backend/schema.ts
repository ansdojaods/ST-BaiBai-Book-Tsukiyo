/** 无副作用的持久化数据校验。先校验，再克隆/提交；未知版本不猜测迁移。 */
type Check = (v: unknown) => boolean;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str: Check = v => typeof v === 'string';
const id: Check = v => typeof v === 'string' && v.length > 0 && v.length <= 1000;
const num: Check = v => typeof v === 'number' && Number.isFinite(v);
const int: Check = v => num(v) && Number.isSafeInteger(v) && (v as number) >= 0;
const bool: Check = v => typeof v === 'boolean';
const one = (...values: unknown[]): Check => v => values.includes(v);
const nullable = (check: Check): Check => v => v === null || check(v);
const arr = (check: Check): Check => v => Array.isArray(v) && v.length <= 100000 && v.every(x => check(x));
const strings = arr(str);
const shape = (fields: Record<string, Check>, required: string[] = []): Check => v => obj(v) && required.every(k => Object.hasOwn(v, k)) && Object.entries(fields).every(([k, check]) => !Object.hasOwn(v, k) || check(v[k]));
const textFields = (keys: string): Record<string, Check> => Object.fromEntries(keys.split(' ').map(k => [k, str]));
const record = (check: Check): Check => v => obj(v) && Object.values(v).every(x => check(x));
export function safeJson(v: unknown, depth = 0): boolean {
  if (depth > 48) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.length <= 100000 && v.every(x => safeJson(x, depth + 1));
  return obj(v) && Object.entries(v).every(([k, x]) => !['__proto__', 'constructor', 'prototype'].includes(k) && safeJson(x, depth + 1));
}
const item = shape({ name: str, desc: str, qty: num, carried: bool, location: str }, ['name']);
const npc = shape({ ...textFields('name gender age ageTime relation ties title desc personality outfit condition location affinityNote'), important: bool, follow: bool, affinityInner: one(-2, -1, 0, 1, 2, null), affinityOuter: one(-2, -1, 0, 1, 2, null) }, ['name']);
const scene = shape({ path: strings, desc: str }, ['path']);
const reparent = shape({ node: strings, newPath: strings, descs: record(str) }, ['node', 'newPath']);
const sceneOp: Check = v => obj(v) && (v.op === 'reparent' ? reparent(v) : ['add', 'update', 'remove'].includes(String(v.op)) && scene(v));
const lifeFields = { ...textFields('id subject text until'), topics: strings, anchors: strings, tier: one('pinned', 'active', 'archive') };
const delta = shape({
  time: str, location: str, locationPath: strings,
  protagonist: shape(textFields('gender age ageTime identity appearance outfit condition')),
  sceneFocus: nullable(shape({ ...textFields('situation currentFocus tension pendingBeat updatedTime'), participants: strings })),
  items: shape({ add: arr(item), update: arr(item), remove: strings }),
  npcs: shape({ add: arr(npc), update: arr(npc), remove: strings }),
  scenes: shape({ add: arr(scene), update: arr(scene), reparent: arr(reparent), remove: arr(strings), ops: arr(sceneOp) }),
  plans: shape({ add: arr(shape({ kind: one('plan', 'suspense'), content: str, createdTime: str, targetTime: str }, ['kind', 'content'])), resolve: arr(v => str(v) || shape({ id, outcome: one('done', 'cancelled', 'failed'), reason: str }, ['id'])(v)), remove: strings, reopen: strings }),
  lifeDetails: shape({ add: arr(shape(lifeFields, ['text'])), update: arr(shape(lifeFields, ['id'])), archive: strings, remove: strings }),
  varOps: arr(shape({ op: one('set', 'assign', 'remove', 'add'), path: str, key: v => str(v) || num(v), value: safeJson, delta: num }, ['op', 'path'])),
});
export const validIdentity = shape({ id, fingerprint: id, swipe: int }, ['id', 'fingerprint', 'swipe']);
export const validLeaf = shape({ id, text: str, delta, v: one(1), createdAt: num, swipe: int, seed: bool, ...textFields('timeStart timeEnd timeLabel srcHash') }, ['id', 'text', 'delta', 'createdAt', 'v']);
export const validSummary = shape({ id, text: str, level: v => int(v) && (v as number) >= 1, createdAt: num, auto: bool, childIds: arr(id), imported: bool, importedFloorStart: int, importedFloorEnd: int, ...textFields('timeStart timeEnd timeLabel') }, ['id', 'text', 'level', 'createdAt', 'auto', 'childIds']);
export const validAnchor = shape({ id, text: str, createdAt: num, floor: v => Number.isSafeInteger(v) && (v as number) >= -1, version: int, source: one('chat', 'api', 'manual'), excluded: bool, note: str, origin: shape({ messageId: id, swipe: int, block: str }, ['messageId', 'swipe', 'block']) }, ['id', 'text', 'createdAt', 'floor', 'version', 'source', 'excluded']);
export const validExternal = shape({ id, source: id, kind: str, text: str, ts: num, pinned: bool, floor: v => Number.isSafeInteger(v) && (v as number) >= -1, ...textFields('title time') }, ['id', 'source', 'kind', 'text', 'ts']);
const template = shape({ json: record(safeJson), meaning: str, rule: str }, ['json', 'meaning', 'rule']);
const snapshot = shape({ snapshotVersion: one(2), createdAt: num, pluginVersion: str, chatId: id, owner: id, charName: str, floors: int, messages: arr(validIdentity), summaries: arr(validSummary), leaves: arr(shape({ msgIndex: int, leaf: validLeaf }, ['msgIndex', 'leaf'])), varsTemplate: template, anchors: arr(validAnchor), external: arr(validExternal), bundles: strings }, ['snapshotVersion', 'createdAt', 'pluginVersion', 'chatId', 'owner', 'charName', 'floors', 'messages', 'summaries', 'leaves', 'varsTemplate', 'anchors', 'external', 'bundles']);
export function validSnapshot(raw: unknown): boolean {
  if (!safeJson(raw) || !snapshot(raw)) return false;
  const s = raw as { floors: number; messages: { id: string; swipe: number }[]; summaries: { id: string; level: number; childIds: string[]; imported?: boolean; importedFloorStart?: number; importedFloorEnd?: number }[]; leaves: { msgIndex: number; leaf: { id: string; swipe?: number } }[]; anchors: { id: string }[]; external: { id: string; source: string }[] };
  const unique = (xs: unknown[]) => new Set(xs).size === xs.length;
  if (s.messages.length !== s.floors || !unique(s.messages.map(x => x.id)) || !unique(s.leaves.map(x => x.msgIndex)) || !unique(s.anchors.map(x => x.id)) || !unique(s.external.map(x => JSON.stringify([x.source, x.id])))) return false;
  const levels = new Map<string, number>();
  for (const x of s.leaves) {
    if (x.msgIndex >= s.floors || levels.has(x.leaf.id)) return false;
    levels.set(x.leaf.id, 0);
  }
  for (const x of s.summaries) { if (levels.has(x.id)) return false; levels.set(x.id, x.level); }
  const parents = new Set<string>();
  for (const x of s.summaries) {
    if (x.imported && (x.childIds.length || x.importedFloorStart === undefined || x.importedFloorEnd === undefined || x.importedFloorStart > x.importedFloorEnd || x.importedFloorEnd >= s.floors)) return false;
    if (!unique(x.childIds)) return false;
    for (const child of x.childIds) {
      const level = levels.get(child);
      if (level === undefined || level >= x.level || parents.has(child)) return false;
      parents.add(child);
    }
  }
  return JSON.stringify(raw).length <= 20 * 1024 * 1024;
}
