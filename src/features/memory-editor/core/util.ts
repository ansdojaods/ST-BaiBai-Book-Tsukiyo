/** 剧情剪辑台 · 基础工具（纯函数，无副作用） */

export const clampNum = (value: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

export const trimText = (value: unknown, max = 2000): string =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, max);

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

let seq = 0;
export const mkId = (prefix: string): string => {
  seq = (seq + 1) % 100000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}${rand}`;
};

/** 标点/空白无关的归一化，用于去重与比较 */
export const norm = (value: unknown): string =>
  String(value ?? "")
    .replace(/[\s\u3000，。、；：！？…—·“”‘’"'()（）【】[\]<>《》~～]+/g, "")
    .toLowerCase();

/** 英文/数字整词 + 中文 1~3 字滑窗 */
export const tokens = (value: unknown): string[] => {
  const raw = String(value ?? "").slice(0, 4000).toLowerCase();
  const out: string[] = [];
  const latin = raw.match(/[a-z0-9_]+/g) || [];
  for (const word of latin) if (word.length > 1) out.push(word);
  const runs = raw.replace(/[^\u4e00-\u9fa5]+/g, " ").split(/\s+/);
  for (const run of runs) {
    if (!run) continue;
    for (let i = 0; i < run.length; i++) {
      out.push(run[i]);
      if (i + 1 < run.length) out.push(run.slice(i, i + 2));
      if (i + 2 < run.length) out.push(run.slice(i, i + 3));
    }
  }
  return out;
};

export const hash32 = (value: string): number => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1000000;
};

export type SparseVector = Record<number, number>;

export const vectorize = (value: string | string[]): SparseVector => {
  const list = Array.isArray(value) ? value : tokens(value);
  const vec: SparseVector = {};
  for (const token of list) {
    const key = hash32(token);
    vec[key] = (vec[key] || 0) + (token.length > 1 ? 2 : 1);
  }
  return vec;
};

export const cosine = (a: SparseVector, b: SparseVector): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const key of Object.keys(a)) {
    const av = a[Number(key)];
    na += av * av;
    const bv = b[Number(key)];
    if (bv) dot += av * bv;
  }
  for (const key of Object.keys(b)) {
    const bv = b[Number(key)];
    nb += bv * bv;
  }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
};

const STOP = new Set([
  "什么", "怎么", "这个", "那个", "我们", "你们", "他们", "自己", "现在", "已经",
  "可以", "还是", "如果", "因为", "所以", "然后", "知道", "觉得", "时候", "东西", "事情",
]);

export const pickKeywords = (value: unknown, extra: string[] = [], limit = 12): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...extra, ...tokens(value)]) {
    const word = String(item ?? "").trim();
    if (word.length < 2 || STOP.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= limit) break;
  }
  return out;
};

/** 去掉 ```json 围栏与 <think> 段，再解析 JSON；失败返回 null */
export const parseJsonLoose = (raw: unknown): unknown => {
  let text = String(raw ?? "").trim();
  text = text.replace(/<think[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
};

export const rangeLabel = (from: number, to: number): string => (from === to ? `#${from + 1}楼` : `#${from + 1}-${to + 1}楼`);

export const dayStamp = (ts: number): string => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
