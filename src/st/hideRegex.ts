/**
 * 通用「仅显示层隐藏」正则注册器(融合版新增)。
 *
 * 与 memory/timeTag.ts 的 ensureHideRegexRegistered 同一套约定:往 extensionSettings.regex 里
 * 按固定 id 幂等写入一条 markdownOnly 的正则脚本——只影响聊天显示,不改写发给模型的提示词。
 * 锚点日记块、外部记录块等融合功能共用它,避免各处复制一份 ST regex 结构。
 */
import { getContext } from './context';

const PLACEMENT_MD_DISPLAY = 0;
const PLACEMENT_USER_INPUT = 1;
const PLACEMENT_AI_OUTPUT = 2;

export interface HideRegexSpec {
  id: string;
  scriptName: string;
  /** ST 正则脚本格式:`/pattern/flags` */
  findRegex: string;
}

export function ensureHideRegex(spec: HideRegexSpec): void {
  const ctx = getContext();
  const es = ctx?.extensionSettings as Record<string, unknown> | undefined;
  if (!es) return;
  if (!Array.isArray(es.regex)) es.regex = [];
  const list = es.regex as Array<Record<string, unknown>>;
  const script = {
    id: spec.id,
    scriptName: spec.scriptName,
    findRegex: spec.findRegex,
    replaceString: '',
    trimStrings: [] as string[],
    placement: [PLACEMENT_MD_DISPLAY, PLACEMENT_USER_INPUT, PLACEMENT_AI_OUTPUT],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  };
  const idx = list.findIndex(s => s?.id === spec.id);
  if (idx >= 0) {
    const cur = list[idx];
    if (cur.findRegex === script.findRegex && cur.scriptName === script.scriptName && cur.disabled === false) return;
    list[idx] = { ...cur, ...script };
  } else list.push(script);
  ctx?.saveSettingsDebounced?.();
}

export function removeHideRegexById(id: string): void {
  const ctx = getContext();
  const es = ctx?.extensionSettings as Record<string, unknown> | undefined;
  if (!es || !Array.isArray(es.regex)) return;
  const list = es.regex as Array<Record<string, unknown>>;
  const next = list.filter(s => String(s?.id ?? '') !== id);
  if (next.length !== list.length) {
    es.regex = next;
    ctx?.saveSettingsDebounced?.();
  }
}
