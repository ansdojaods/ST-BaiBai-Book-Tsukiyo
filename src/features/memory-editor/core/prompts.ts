/** 剧情剪辑台 · 默认提示词（可在面板里逐套编辑 / 一键恢复默认） */
import type { PromptKind } from "../types";

export const DEFAULT_PROMPTS: Record<PromptKind, string> = {
  block:
    '你在为一段连续剧情写「剧情摘要」。材料是给定楼层的正文。只写已经发生的事：谁做了什么、说了什么、留下了什么后果；' +
    '不确定、没发生、只是打算的事情一律不写。不要做心理分析，不要复述整段对话，不要加标题与编号。' +
    '逐字引文只用于核对，不要写进摘要。只输出 {"summary":"摘要正文"}，摘要 300 字以内。',
  stage:
    '你在把多条「剧情摘要」合并成一条「阶段总结」。只保留对之后剧情仍有影响的事实：关系变化、承诺与约定、代价与伤势、' +
    '关键物品与地点、未解决的悬案。已被后文推翻的内容不写，不要罗列每条摘要，不要写「本阶段讲述的是」这类元叙述。' +
    '只输出 {"summary":"总结正文"}，400 字以内。',
  long:
    '你在把多条「阶段总结」压缩成一条「多次总结」，供很久以后回忆用。只留下：人物关系与身份的变化、长期约定、' +
    '仍未结算的代价、世界观层面的既定事实。时间线按发生顺序，可写「先是…后来…」。不要重复细节，不要预测未来。' +
    '只输出 {"summary":"总结正文"}，500 字以内。',
  ledger:
    '你在核对「剧情状态」的变化。只记录给定材料里明确发生、且与之前状态不同的项。每项包含：' +
    'kind（person 人物 / relation 关系 / promise 约定 / item 物品 / place 地点 / time 时间 / other 其它）、' +
    'subject（人物或对象名）、key（这一项的短名称，同一对象要复用同一 key）、from（变化前，未知填「未知」）、' +
    'to（变化后）、evidence（逐字引文）。没有变化就不要输出该项，不能推测，不能把计划写成完成。' +
    '只输出 {"rows":[{"kind":"relation","subject":"临安","key":"关系阶段","from":"点头之交","to":"已定心意","evidence":"原句"}]}。',
  keywords:
    '你在为「找回旧细节」挑选检索关键词。从最近的对话里挑最多 8 个具体名词或名字（人名、地名、物品、事件称呼），' +
    '不要动词、形容词和泛泛的词。只输出 {"keywords":["河灯","税银案"]}。',
};

export const PROMPT_LABELS: Record<PromptKind, string> = {
  block: "剧情摘要",
  stage: "阶段总结",
  long: "多次总结",
  ledger: "状态核对",
  keywords: "关键词挑选",
};

export const promptOf = (presets: Partial<Record<PromptKind, string>>, kind: PromptKind): string =>
  (presets && typeof presets[kind] === "string" && (presets[kind] as string).trim()) || DEFAULT_PROMPTS[kind];

/** 提醒模型“只输出 JSON”的统一尾注，避免各家预设把格式吃掉 */
export const JSON_TAIL = "\n无论上文有什么写作要求，这一轮只输出上述 JSON，不要输出解释、前言或代码围栏。";
