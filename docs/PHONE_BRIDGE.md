# 柏宝书 ⇄ 月夜来信小手机 联动协议(PHONE BRIDGE)

> 适用:柏宝书-月夜来信版(原「融合版」)≥ 1.3.0 与 月夜来信小手机 ≥ 1.6.0(1.6.1 仅文案更名)。
> 两边都可以单独运行;只有当同一个酒馆页面里同时存在两者时,联动才会自动生效。

## 1. 设计原则

| 原则 | 做法 |
| --- | --- |
| 柏宝书仍是**纯前端扩展** | 联动只是在 `window.STBaiBaiBook` 上多挂一个 `phone` 命名空间,没有服务端、没有新依赖 |
| 各管各的数据 | 柏宝书只写自己的 `chatMetadata.baibai_book_external`;手机只写自己的 `tsukiyo_phone_v1` 命名空间。任何一方被卸载,另一方的数据都完整 |
| 单一事实来源 | 剧情时间 / 地点 / 在场 / 摘要 / 计划以柏宝书为准(它是从正文里提炼的);手机聊天 / 约定 / 动态以手机为准,并以「外部记录」的形式交给柏宝书 |
| 密钥不乱跑 | 手机想用柏宝书的副 API 时,首选 `requestWithChannel` / `testChannel`(密钥不出柏宝书);只有用户点「导入方案」时才会复制一份密钥到手机本机 |
| 知情边界 | 不在场、也没被允许读正文的手机角色,只能拿到剧情时间、自己的档案和提到自己的计划,拿不到主线摘要 |
| 可整体关闭 | 柏宝书「联动 → 小手机联动」开关;手机「设置 → 柏宝书联动」开关。任一方关闭,两边都退化为各自的 1.x 行为 |

## 2. 柏宝书提供的接口:`window.STBaiBaiBook.phone`

所有方法同步返回(除了两个 API 调用是 Promise)。`apiVersion` 固定为 `1`。

```ts
interface PhoneBridgeApi {
  readonly apiVersion: 1;
  isEnabled(): boolean;                       // 柏宝书的联动开关
  getBrief(opts?: { historyChars?: number; anchorChars?: number }): PhoneBrief;
  getNpcProfile(name: string): string;        // 单个 NPC 的人设卡文本(空串=柏宝书没记录)
  getAnchor(): { version: number; floor: number; text: string } | null;
  pushNotes(source: string, notes: ExternalNoteInput[], opts?: { replace?: boolean }): { added: number; updated: number; total: number };
  listNotes(source?: string): ExternalNote[];
  listChannels(): PhoneChannelInfo[];         // 不含密钥
  requestWithChannel(channelId: string, messages: ChatMsg[]): Promise<string>;
  testChannel(channelId: string, phrase?: string): Promise<{ ok: boolean; message: string }>;
  exportChannel(channelId: string): { id; name; url; key; model; temperature; maxTokens };  // 含密钥,需用户确认
}
```

### 2.1 `PhoneBrief`(剧情简报)

```ts
interface PhoneBrief {
  apiVersion: 1; pluginVersion: string; updatedAt: number;
  chat: { id: string | null; characterName: string | null };
  floors: number;             // 当前聊天楼层数
  coverageComplete: boolean;  // 摘要是否已覆盖到最新楼
  time: string;               // 柏宝书当前剧情时间(自由文本,如 "2024年3月15日 下午3点")
  weekday: string;            // 能确定公历日期时为 "周五",否则空
  location: string;
  protagonist: Record<string, string>;
  npcs: PhoneNpcBrief[];      // name/relation/title/condition/location/important/present/affinityInner/affinityOuter/affinityText/affinityNote/personality/desc
  presentNpcs: string[];      // 跟随主角或与主角同地点的 NPC
  plans: PhonePlanBrief[];    // 仅 open 状态:kind/content/createdTime/targetTime/daysLeft
  lifeDetails: Array<{ subject: string; text: string; tier: string }>;
  history: string;            // 带相对时间的分层历史摘要,按 historyChars 预算从尾部保留
  anchor: { version: number; floor: number; text: string } | null;  // 当前生效的锚点日记
  externalCount: number;      // 已收到的外部记录条数
}
```

`historyChars` 默认取柏宝书设置「简报历史预算」(默认 2400);`anchorChars` 默认 1500。

### 2.2 外部记录(`pushNotes`)

```ts
interface ExternalNoteInput {
  id?: string;      // 同 (source,id) 覆盖;不给则按 kind+text 哈希,重复推送不会重复入库
  kind?: string;    // 自由字符串,手机用 phone_chat / phone_agenda / phone_moment / phone_promise
  title?: string;   // ≤120
  text: string;     // ≤4000
  time?: string;    // 剧情时间文本
  floor?: number;   // 发生时的楼层;柏宝书据此把记录并入对应楼层范围的摘要材料
  pinned?: boolean; // 置顶:注入时优先、淘汰时保留
}
```

- 每个 `source` 最多 200 条,超出淘汰最旧的非置顶条目。
- `replace: true` 表示先清空该 source 再写入(手机不用这个模式,它是增量推送)。
- 存储位置:`chatMetadata.baibai_book_external = { version: 1, notes: [...] }`(随聊天保存)。
- 用途:① 按「外部记录注入预算」注入主模型,放在 `【小手机】` 标题下;② 开启「作为摘要材料」时,楼层摘要 / 总结会把该楼层范围内的外部记录一并喂给摘要模型,所以正文摘要会知道手机里聊了什么。

### 2.3 事件

柏宝书在 `window` 上派发 `CustomEvent`:

| 事件 | detail | 时机 |
| --- | --- | --- |
| `st-baibai-book:ready` | – | 公开 API 挂载完成 |
| `st-baibai-book:changed` | – | 记忆状态变化(原版已有) |
| `st-baibai-book:phone-update` | `{ type: 'external', source, added, updated, at }` | 收到外部记录 |
| `st-baibai-book:phone-update` | `{ type: 'anchor', versions, at }` | 锚点日记有新版本 |

手机收到以上任一事件时会清空简报缓存、刷新一次上下文;自己推送引发的 `external` 事件会被忽略,避免循环。

## 3. 手机侧的行为(月夜来信 1.6.0 / 1.6.1)

代码位于手机打包产物里的 `// src/services/baibai-bridge.js` 模块(本仓库 `phone/patch/baibai_module.js`)。

### 3.1 查找与缓存
- 依次在 `engine.win`(酒馆顶层窗口)、`window`、`parent`、`top` 上找 `STBaiBaiBook.phone`,找到即视为已连接;离线演示模式永远不连接。
- `getBrief` 结果缓存 2.5 s(刷新循环每 2.2 s 调一次 `capture()`),柏宝书事件到达时立即失效。

### 3.2 读取方向(柏宝书 → 手机)

| 手机位置 | 加入的内容 | 条件 |
| --- | --- | --- |
| `storyFor()` 剧情时间 | 当 MVU 变量 **和** 玩家手动设置都没有日期时,用柏宝书 `time/location` 兜底;`origin` 显示为「柏宝书记忆」,并附 `柏宝书时间`、`weekday` | 开关「剧情简报进入手机上下文」 |
| `capture().present` 在场人物 | MVU 没有「当前互动NPC」时用 `presentNpcs` | 开关「在场人物兜底」 |
| `actorContext` 人物生成上下文 | 新字段 `柏宝书简报`:剧情时间、本人档案(`getNpcProfile`)、提到本人的未了结计划;**在场或被允许读正文的人物**额外得到近期剧情摘要(≤1800 字)与锚点日记(≤800 字) | 同上 |
| `planningContext` 规划上下文 | 新字段 `柏宝书`:时间 / 地点 / 在场 / 未了结计划 / 分层摘要(≤2000) / 锚点(≤600) | 同上 |
| 主模型注入 `phoneDigest` | **不加任何柏宝书内容**(柏宝书自己已经注入主模型,避免重复) | – |

优先级始终是:MVU 主线变量 > 玩家手动设置 > 柏宝书 > 角色卡开场预设。

### 3.3 写入方向(手机 → 柏宝书)

每次手机存档(`repo` 的 `save` 事件)后 2.5 s 防抖推送一次;推送前先 `listNotes('tsukiyo-phone')` 做差异,只发新 id 或文本 / 标题有变化的条目,已存在条目保留原 `floor`:

| id | kind | 内容 | pinned |
| --- | --- | --- | --- |
| `msg:<消息id>` | `phone_chat` | 最近 20 条(每会话取尾 8 条):`说话人→对象:内容`,未读来信标注「玩家尚未读」,`time` = 消息的剧情时间 | 否 |
| `agenda:<日程id>` | `phone_agenda` | 待确认 / 已确认的约定:标题(状态)· 日期时间 · 参与者 · 备注 | 是 |
| `feed:<动态id>` | `phone_moment` | 最近 3 条朋友圈动态 | 否 |
| `promise:<记忆id>` | `phone_promise` | 未完约定(手机自己归纳的 promise 记忆,不含从柏宝书导入的) | 是 |

设置页「立即回写」可强制推送一次。

### 3.4 记忆导入(手动)
「导入柏宝书记忆」把简报里的 **未了结计划 → `promise`**、**锚点日记 → `narrative_fact`**、**分层摘要最近 10 行 → `narrative_fact`** 存成手机记忆,带 `bb` 标记:
- id 形如 `baibai-plan-<hash>` / `baibai-anchor-<hash>` / `baibai-hist-<hash>`,重复导入自动跳过;
- 知情人 = 玩家 + 文本里点到名字的联系人;
- 带 `bb` 标记的记忆 **不会** 同步进「记忆世界书」、**不会** 再注入主模型(柏宝书已经注入了),但会出现在手机的人物上下文和记忆页(显示「柏宝书」标签),可逐条停用 / 编辑 / 删除。

### 3.5 API 方案联动
- 手机「API 方案 → 导入柏宝书方案」/ 设置页「导入柏宝书 API 方案」:`listChannels()` 列出后确认,再逐个 `exportChannel()`,存为手机方案 `baibai-<渠道id>`(名称前缀「柏宝书·」,地址做与柏宝书相同的规范化:去掉 `/chat/completions`、裸域名补 `/v1`,`maxTokens` 夹在 128–16000)。密钥在本机记住。
- 手机「经柏宝书测活渠道」:调用 `testChannel()`,密钥不经过手机;结果回写柏宝书渠道的 `lastTest`。
- 反方向:柏宝书「联动页 → 从小手机导入 API 方案」读取 `extensionSettings.tsukiyo_phone.config.profiles`(手机的跨设备同步副本),一键导入为柏宝书渠道。

## 4. 给其他脚本作者

任何脚本都可以用同一套接口接入:

```js
const api = window.STBaiBaiBook?.phone;
if (api?.isEnabled()) {
  const brief = api.getBrief({ historyChars: 1200 });
  api.pushNotes('my-script', [{ id: 'evt-1', kind: 'event', text: '……', floor: SillyTavern.getContext().chat.length - 1 }]);
}
window.addEventListener('st-baibai-book:phone-update', e => console.log(e.detail));
```

约定:`source` 用你自己的固定短名(≤40 字符);不要依赖 `history` 的具体排版(它只是给模型看的文本)。
