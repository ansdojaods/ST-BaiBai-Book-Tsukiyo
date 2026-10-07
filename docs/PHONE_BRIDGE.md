# 柏宝书 ⇄ 月夜来信小手机 · 联动协议 v2（柏宝书 1.4.2 / 手机 2.9.5）

联动全部发生在同一个酒馆页面里，通过 `window.STBaiBaiBook` 暴露的两个命名空间完成，不增加服务端插件：

- `STBaiBaiBook.phone`：**v1 就有的读写桥**（读剧情简报 / 推送外部记录 / 借用渠道），1.4.2 未改语义；
- `STBaiBaiBook.memoryEditor`：**剧情剪辑台**（1.4.0 起挂载，1.4.2 补齐归属闸门与开合句柄）。

协议 `apiVersion` 仍是 `1`：v2 是**加法**（新增字段与方法），不删不改旧字段，老手机对老参数、老柏宝书对新手机都能退化运行。文末附「v1 → v2 改动速查」列了每条改动是哪一端先消费的。

---

## 1. 探测：两边用同一套候选窗口

小手机可能跑在酒馆助手卡内、iframe 或独立扩展里，宿主 API 不一定挂在当前 `window` 上。2.9.5 起手机探测 `STBaiBaiBook` / `memoryEditor` 时与 phone 桥共用同一套候选窗口 `baibaiCandidates(win)`：`win → baibaiRuntime.win → window → (各自的 parent) → (各自的 top)`，去重后逐个试。

如果你在写别的联动脚本，照抄这个顺序即可；柏宝书侧不做反向探测（它永远挂在自己的页面上）。

```js
// 手机侧的实际判据（示意）
const api = w.STBaiBaiBook?.memoryEditor;
if (!api || typeof api.capability !== "function") continue;
const cap = api.capability();
if (cap?.available !== true) continue;          // available 不是 true 就换下一个窗口
const closed = cap.enabled === false;           // 装了剪辑台，但总开关关着（v2 新增）
```

---

## 2. `STBaiBaiBook.phone`（v1 读写桥，语义未变）

### 读取接口和权限

- `isEnabled()`：手机联动总开关。
- `canReadMemory()`：总开关开启且 `phoneBridge.shareMemory` 允许读取。
- `getBrief({ historyChars?, anchorChars? })`：当前聊天的摘要、锚点、时间地点、人物、未完计划、物品、生活细节。读取关闭时抛出可读错误。
- `getMainNpcs()`：核心/主要配角排序列表（看「恋爱心迹」用）。
- `getNpcProfile(name)`：读取关闭时返回空字符串。
- `getAnchor()`：读取关闭时返回 `null`。

`PhoneBrief` 关键字段：`apiVersion / pluginVersion / updatedAt / chat{id,characterName} / floors / coverageComplete / time / weekday / location / protagonist / items / npcs / mainNpcs / presentNpcs / plans / lifeDetails / history / anchor / externalCount`。手机兼容没有 `canReadMemory` 的旧版提供者，按 `isEnabled` 退化；要用书侧独立读取开关，请同时升级两端。

### 回写与导入

`pushNotes(source, notes, {replace?})` 是手机**唯一**的写入口：只写柏宝书的 external 记录（`source` 默认带 `phone` 标记），不修改摘要森林。手机回写由独立 `ui.baibai.push` 控制；手动立即回写也不绕过关闭的开关。更新去重签名在写入成功后才提交，失败可以重试。

新增：剪辑台 1.4.2 起把这类记录统一汇总到状态账本时，走 §3 的 `mergePhoneNotes()`，两条路最终落到同一份 `source: "phone"` 账本行，不重复、不互相覆盖。

### 渠道借用与事件

`listChannels() / requestWithChannel(id, messages) / testChannel(id) / exportChannel(id)`：借用柏宝书渠道发请求、测试、导出凭据（密钥不出柏宝书，导出需用户显式点击）。

柏宝书外部记录或锚点变化时派发 `st-baibai-book:phone-update`，`detail = { type: "external"|"anchor"|"memory", ...附加字段, at }`。

---

## 3. `STBaiBaiBook.memoryEditor`（协议 v2 重点）

未绑定剪辑台时该子键不存在（`undefined`），判空即可。挂载值：`{ apiVersion: 1, owner: "engine", capability, open, close, toggle, mirror, info, recall, mergeExternal, mergePhoneNotes, exportArchive, diagnostics }`。

### 3.1 `capability()` —— 归属判断的唯一依据

```ts
{ available: true, apiVersion: 1, pluginVersion: string, enabled: boolean, mode: "extra" | "manual" }
```

- `enabled`（1.4.2 新增）= 剪辑台**总开关**（面板「设置」页）。为 `false` 时，调用方必须当作「引擎没在管」，自己接管楼层记忆——否则会出现「剪辑台关了、手机也停手」的空档。
- `mode` = 最新摘要方式（`extra` = 额外生成：每轮回复后自动摘要；`manual` = 手动：自动已关），供手机端显示，不参与接管判断。

### 3.2 `mirror()` —— 只读镜像（不含正文全文之外的内部结构）

```ts
{
  available: true, apiVersion: 1, pluginVersion: string, updatedAt: number,
  enabled: boolean, mode: string, owner: "engine",
  coverage: { ratio, missing: number[], ... } | null,
  summaries: [{ id, level, from, to, text, covers: string[] }],   // 生效中的摘要，text 截断到 1200 字
  ledger:    [{ id, kind, subject, key, from, to, floor }],
  counts: { summaries: number, active: number, drafts: number, ledger: number, hidden: number },
  lastRecall: { at, floor, chars, budget, hits: [{ label, score, why: string[] }] } | null
}
```

只给标签、分数与理由，不给正文原文；手机端只用它填「楼层记忆归属」卡片的覆盖/缺口/摘要数/上次召回四行字。

### 3.3 事件 `st-baibai-book:memory-editor`

剪辑台状态变化（面板重绘、`refresh()`、外部调用改写状态后广播）时在全局 `dispatchEvent` 一个 `CustomEvent`：

- 事件名：`st-baibai-book:memory-editor`（常量 `MEMORY_EDITOR_EVENT`）；
- **`detail` 就是 `mirror()` 的返回值**，形状同上，无额外包装；
- 柏宝书侧 **500ms 节流** 广播，一次生成可能连发数条；
- 2.9.5 手机侧订阅它并即时写镜像，手机侧再叠两层保护：**3 秒写存档节流** + **内容签名去重**（`JSON.stringify` 比对 engine/apiVersion/counts/coverage/lastRecall/closed/note，没变就不落盘）。旧手机不订阅也不受影响，靠 10 秒节流 + 120 秒巡检 + 手动点「重新探测引擎」照常工作。

### 3.4 开合句柄 `open() / close() / toggle()`

1.4.2 新增，由宿主把抽屉的开合函数注入 `createMemoryEditor({ panelControls })`；未注入时三个方法存在但为空操作（旧宿主行为不变）。

手机侧「记忆工作台 → 概览 → 楼层记忆归属」卡片在检测到剪辑台时显示「打开剪辑台」按钮，走的命令是 `ms-engine-open`：

```js
const found = ui.engine.ms.engineEditor();
const open = found && typeof found.api.open === "function" ? found.api.open : null;
if (!open) { /* 提示：需要百宝月夜书 1.4.2+，或先到魔杖菜单点「剧情剪辑台」 */ }
else open.call(found.api);
```

**剪辑台入口保持独立**：魔杖菜单 → 剧情剪辑台，永远是主入口；`open()` 只是给小手机等外部脚本的快捷方式，不做书内页签/内嵌。

### 3.5 `mergePhoneNotes()` —— 手机记录进账本（1.4.2 起）

```ts
mergePhoneNotes(notes: Array<{ id: string; kind: string; title: string; text: string; floor?: number; pinned?: boolean }>)
  => { added: number; updated: number; unchanged: number }

mergeExternal(records: Array<{ type: string; subject?: string; key?: string; to?: string; from?: string; evidence?: string; floor?: number }>)
  => { added: number; updated: number; unchanged: number }
```

契约：

- `mergePhoneNotes` 是个转发层，把 `notes` 映射成账本行后调用 `mergeExternal`，两类记录最终都落在同一张账本上，`source` 标成 `phone`；
- kind 映射：`phone_agenda → agenda`、`phone_promise → promise`、`phone_chat → contact_status`、其余 → `other`；`pinned` 只影响手机端展示，不写进账本；
- **不回写摘要森林、不触碰楼层记忆**，只做「手机记录 → 状态账本」的搬运；
- 返回值三个计数分别表示新增 / 按签名更新 / 完全一致跳过；同 `id` 同内容重复调用是幂等的（`unchanged` 计数）；
- 旧手机不认识这两个方法时照旧只用 `pushNotes`，不会因为新方法存在而改变行为。

### 3.6 其余只读方法

`info()`（面板同款统计：楼层、摘要、缺口、待确认、状态、日志尾）、`recall({ query?, floor?, phoneOnly?, inject? })`（手动召回一次；`phoneOnly: true` 只召回外部资料）、`exportArchive()`（记忆档案）、`diagnostics()`（脱敏诊断，不含正文原文、姓名、端点或密钥）。

---

## 4. 归属闸门：两边不会同时自动摘要（1.4.2）

同一段剧情如果柏宝书的摘要森林和小手机各自动摘要一次，就会**两次模型调用、两个缺口数字**。1.4.2 把归属做成了单一开关：

- 柏宝书设置项 `extension_settings["st-baibai-book"].editorOwnsAutoSummary`（设置 → 摘要设置 → **自动摘要归属**，文案：“柏宝书摘要森林 / 剧情剪辑台”）：
  - `false`（默认，归柏宝书摘要森林）：剪辑台**不**自动生成楼层摘要，由摘要森林负责；手机是否停手不由本项决定（见本节末与 §5）；
  - `true`（归剧情剪辑台）：柏宝书的自动摘要停手，剪辑台接管。
- 宿主端口 `autoSummaryAllowed()` **只看 `editorOwnsAutoSummary`**：返回 `false` 时剪辑台停止自动楼层摘要；宿主未实现时按 `true` 处理（旧宿主行为不变）。`memory-editor` 设置页的归属下拉**只切归属**，不再顺手改 `autoSummaryEnabled`。
- 同页的 `autoSummaryEnabled` 仍只管它自己那摊事（时间标签、隐藏楼层、自动摘要拦截），与归属互不牵连。
- 手机侧对应的是「楼层记忆交由引擎管理」（见 §5），它看的是 §3.1 的 `capability().enabled`：**总开关关着 = 引擎没在管，手机继续自己管楼层记忆**，恢复打开后下次探测（或事件到达）自动让位。

---

## 5. 手机 2.9.5 侧的对应字段

**探测与状态**（`记忆工作台` 存档 `delegate`）：

```js
delegate: {
  enabled: true,          // 「楼层记忆交由引擎管理」开关（手机侧）
  keepPhoneRecall: false, // 接管期间是否仍注入手机内记忆
  engine: "",             // 剪辑台 pluginVersion（如 "1.4.2"）
  apiVersion: 0,
  at: 0,                  // 上次成功探测/事件落库时间
  counts: null,           // 镜像直存
  coverage: null,
  lastRecall: null,
  closed: false,          // ① true = 检测到剪辑台但它的总开关关着（2.9.5）
  note: ""
}
```

① `closed` 三态语义：

| 状态 | 判据 | 手机行为 |
| --- | --- | --- |
| 未检测到 | `engineEditor() === null` | 自己管楼层记忆（与 2.9.4 前一致） |
| 已检测到但总开关关着 | `capability().enabled === false`（`closed: true`） | 手机继续自己管；清空镜像 counts/coverage/lastRecall，提示“在剪辑台里打开总开关后自动接管” |
| 接管中 | 手机开关开 && 检测到 && `closed !== true` | `assertOwner()` 拦截手机侧自动摘要/楼层召回/补缺口；手机内记忆按 `keepPhoneRecall` 决定是否仍注入 |

- 命令：`ms-engine-sync`（强制重新探测，三态各有通知文案）、`ms-engine-open`（调用 `open()` 打开剪辑台抽屉）、`ms-engine-help`（接线说明）；界面入口在「记忆工作台 → 概览 → 楼层记忆归属」卡片，接管中显示“引擎接管中 / 剪辑台版本 / 覆盖比例 / 缺口段数 / 上次召回”。
- 镜像刷新节奏：事件订阅（3 秒节流 + 签名去重）、`syncMirror()` 10 秒节流 + 120 秒巡检、手动「重新探测引擎」强制刷新。
- 手机侧对“引擎”只读：从不调用 `mergeExternal` / `mergePhoneNotes` / `recall` 反写剪辑台状态；手机记录仍经 `pushNotes`（§2）或用户点「从手机记录汇入」单向交给账本。

---

## 6. 兼容与边界

- 旧版柏宝书（无 `memoryEditor`）：手机走“未检测到”分支，功能与 2.9.4 相同；`ms-engine-open` 会提示需要 1.4.2+，并指路魔杖菜单。
- 旧版手机（无 `closed` 处理）：在剪辑台总开关关闭时可能误判为“接管中”而停手——升级手机到 2.9.5 即可，柏宝书侧无需改动。
- 手动立即回写、导入、导出都不绕过各自开关；读取关闭时 `getBrief/getNpcProfile/getAnchor` 的返回值/报错语义与 v1 一致。
- 本文件描述的是**本地/模拟宿主验证过的契约**，不代表已在真实酒馆部署验证；完整用户操作与已知限制见 [LOCAL_EDITION_1.3.3.md](LOCAL_EDITION_1.3.3.md) 与 [联动接线修复_1.4.2.md](联动接线修复_1.4.2.md)。

---

## 附：v1 → v2 改动速查

| 改动 | 引入版本 | 消费方 |
| --- | --- | --- |
| `capability()` 增加 `enabled` / `mode` | 柏宝书 1.4.2 | 手机 2.9.5（`closed` 三态） |
| `open() / close() / toggle()` | 柏宝书 1.4.2 | 手机 2.9.5（`ms-engine-open`） |
| `mergePhoneNotes()` / `mergeExternal()` | 柏宝书 1.4.2 | 手机记录汇入账本 |
| 归属闸门 `editorOwnsAutoSummary` + `autoSummaryAllowed()` | 柏宝书 1.4.2 | 设置页 / 剪辑台自动摘要 |
| 订阅 `st-baibai-book:memory-editor` 即时写镜像 | 手机 2.9.5 | 手机存档（3 秒节流 + 签名去重） |
| 与 phone 桥统一候选窗口 `window/parent/top` | 手机 2.9.5 | `engineEditor()` 探测 |
| 事件 detail = `mirror()`，柏宝书侧 500ms 节流 | 柏宝书 1.4.0 | 手机 2.9.5 起订阅 |
