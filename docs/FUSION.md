# 百宝月夜书(v1.3.2,原「融合版」/「柏宝书-月夜来信版」)技术说明

> 本文说明「百宝月夜书」(下文沿用开发期的简称「融合版」)在原版 ST-BaiBai-Book v1.2.9 之上**新增了什么、放在哪、怎么关、怎么测**。
> 原版功能(自动摘要 / 台账 / 向量记忆 / 带数据新建 / 公开 API …)不在此重复,见仓库 `README.md` 与 `PUBLIC_API.md`。

## 0. 一句话

柏宝书**仍然是一个纯前端 UI 扩展**(安装方式、manifest 类型、数据位置都没变)。融合版只做了四类加法:

| 来源 | 融合进柏宝书的能力 | 实现方式 |
| --- | --- | --- |
| 锚点日记(AnchorNote) | 手动「催更」生成的 `<anchor>` 剧情存档卡;注入主模型;可编辑 / 排除 / 回滚;正文里隐藏标签 | 独立重写(TypeScript),提示词为融合版自撰 |
| 白鸟数据(ST-BaiNiaoData) | 可选的服务端备份:快照、乐观并发、回收站镜像 | 浏览器端 `fetch` 客户端适配器;未安装时自动回落到 `chatMetadata` |
| 世界背面(world-backstage) | 恢复点、回收站、诊断导出、渠道测活留痕、小手机桥接事件等**思路** | 全部按思路独立实现,未复制任何源码 / 提示词 / 文案 |
| 月夜来信小手机 | 双向联动(简报 / 外部记录 / API 渠道) | 新增 `STBaiBaiBook.phone` 公开 API,见 `docs/PHONE_BRIDGE.md` |

## 1. 目录结构(新增部分)

```
src/
  anchor/            锚点日记
    prompts.ts         内置锚点指令、注入包裹文案、<anchor> 正则
    store.ts           锚点存取(chatMetadata.baibai_book_anchor)、版本号、排除、注入文本
    engine.ts          生成拦截(催更触发)、收割回复里的 <anchor>、静默生成、隐藏正则同步、删除进回收站
  backend/           数据后端 / 备份 / 恢复
    bainiao.ts         白鸟数据 HTTP 客户端(health 探测、records CRUD、trash)
    sync.ts            快照备份 / 拉取 / 列表 / 删除、回收站镜像、摘要后自动备份(安静 20 s)
    restore.ts         本地恢复点(chatMetadata.baibai_book_restore)、快照构建 / 应用 / 解析
    trash.ts           本地回收站(chatMetadata.baibai_book_trash)
    diagnostics.ts     诊断包(版本 / 脱敏设置 / 后端健康 / 覆盖情况),下载或复制
  bridge/            外部联动
    external.ts        外部记录存取与注入文本
    phone.ts           STBaiBaiBook.phone 实现 + 从手机导入 API 方案
  st/hideRegex.ts    用 ST 正则在显示层隐藏指定标签(固定 id,幂等)
  fusion/bind.ts     融合模块统一绑定入口(index.ts 调用)
  fusion/fusion.test.ts  融合功能单元测试(17 条)
  pages/fusion/index.vue 「联动」设置页
phone/               月夜来信小手机 1.6.1 补丁与产物(见 phone/README.md)
docs/                本文、PHONE_BRIDGE.md
```

改动过的原文件:`src/api/settings.ts`(新增 `anchor / backend / phoneBridge` 设置与渠道 `testPrompt / lastTest`,并导出 `defaults()/normalize()`)、`src/api/client.ts`(测活可自定义短语)、`src/memory/inject.ts`(锚点 + 外部记录注入)、`src/memory/prompts.ts`(计划到期提示 `dueHint`)、`src/memory/engine.ts`(摘要材料并入外部记录、补摘前自动恢复点)、`src/memory/apply.ts`(删除走回收站)、`src/memory/update.ts`(更新检测改为可配置仓库地址,未配置时不检测)、`src/public/{types,register}.ts`(挂 `phone` 命名空间)、`src/index.ts`、`src/pages/registry.ts`、`src/components/Icon.vue`、`src/pages/settings/index.vue`(全部测活 / 测活短语)。

## 2. 锚点日记

**流程**
1. 用户在输入框写入触发词(默认「请生成锚点日记」;联动页按钮可一键填入),或关闭「按需」让每回合都要求。
2. `generate_interceptor` 发现本回合命中 → 以 `setExtensionPrompt` 注入锚点指令(深度 `injectDepth`)。
3. AI 回复到达后 `harvestAnchorAt()` 取最后一个 `<anchor>…</anchor>` 块,存为新版本(`version` 自增,`floor` = 该楼)。
4. 之后每次生成都把**当前生效**的锚点注入(头尾文案 `ANCHOR_INJECT_HEAD/TAIL`,超出 `maxChars` 截断)。
5. 可选 `supersedeHistory`:锚点覆盖范围(≤ 锚点楼层)的历史摘要不再注入,省 token。
6. `hideTagInChat`:通过 ST 正则(固定 id `bbs-hide-anchor-tag`)在显示层隐藏 `<anchor>` 块,提示词仍保留。

**手动操作(联动页)**:静默生成(用副 API / 主 API 对最近 N 个 AI 楼层生成,不占正文回合)、粘贴导入旧锚点、编辑文本与备注、排除某版本(不注入但保留)、删除(进回收站)、回滚到任一版本。

**数据**:`chatMetadata.baibai_book_anchor = { version: 1, anchors: AnchorEntry[] }`;`AnchorEntry = { id, version, floor, text, source: 'chat'|'api'|'manual', excluded, note?, createdAt }`。

## 3. 数据后端 / 备份 / 恢复

### 3.1 白鸟数据(可选)
- 启动与打开设置页时 `probeBackend()` 访问 `GET /api/plugins/st-bainiaodata/v1/health`,请求头来自 `ctx.getRequestHeaders()`(含 CSRF)。
- 可用时:
  - 「备份快照到后端」→ `PUT /v1/records/<namespace>/snapshots/<chatKey>`,带 `expectedRevision` 做乐观并发(冲突时提示并刷新 revision);
  - 「从后端恢复」→ 拉取 → 先建本地恢复点 → `applySnapshot()`;
  - 后端回收站 `GET /v1/trash/<ns>`、`POST …/restore` 镜像到本地回收站列表;
  - `autoBackup` 开启时,每轮摘要 / 批量补摘完成且安静 20 s 后自动备份一次。
- `chatKey` 与 `namespace` 都经过 `safeSegment()`(≤128、仅 `[A-Za-z0-9_-]`,其余哈希),满足白鸟的路径段约束。
- 未安装 / 探测失败 / 开关关闭:上述按钮置灰,其它一切照常。柏宝书不因后端缺席而报错。

### 3.2 本地恢复点
- `createRestorePoint(reason)` 把当前记忆状态(叶子 / 总结树 / 台账 / 锚点 / 外部记录)快照进 `chatMetadata.baibai_book_restore`,上限 `backend.restorePoints`(默认 3,删旧留新)。
- 自动创建时机:批量补摘前、导入快照 / 任何恢复操作前(当前状态为空时不建,避免无意义的点);联动页也可手动保存。
- `restoreFromPoint(id)` 应用快照;超出当前聊天楼层的叶子会被跳过并计数(`skippedLeaves`)。

### 3.3 回收站
`trashPush({ kind, title, payload })` 记录被删除的摘要 / 子树 / 叶子 / 锚点 / 外部记录 / 计划,上限 `backend.trashKeep`(默认 30)。联动页可逐条恢复 / 清空。原版的删除入口(`memory/apply.ts`)都已挂钩。

### 3.4 诊断
`buildDiagnostics()` 生成一份 JSON:插件版本、宿主环境(UA、ST 接口可用性、是否群聊)、关键设置(不含密钥、渠道地址脱敏)、渠道与上次测活、后端健康、当前聊天覆盖情况(楼层 / 隐藏楼 / 待补楼 / 各层总结数)、锚点 / 外部记录 / 恢复点数量。可下载或复制,方便反馈问题而不泄露隐私。

## 4. API 渠道测活
- 每个渠道可设 `testPrompt`(空=默认「请回复 OK」);测活结果 `lastTest = { ok, at, message }` 留存并在列表显示 ✓ / ✗。
- 设置页「全部测活」顺序测全部渠道;联动页同样提供(并可被手机经 `STBaiBaiBook.phone.testChannel` 调用)。
- 「从小手机导入 API 方案」:读取 `extensionSettings.tsukiyo_phone.config.profiles`(手机的跨设备同步副本)列出并导入为渠道。

## 5. 小手机联动
见 `docs/PHONE_BRIDGE.md`。柏宝书侧要点:
- `STBaiBaiBook.phone`:`getBrief / getNpcProfile / getAnchor / pushNotes / listNotes / listChannels / requestWithChannel / testChannel / exportChannel / isEnabled`。
- 外部记录注入在 `【小手机】` 标题下,预算 `phoneBridge.externalMaxChars`(默认 2500),置顶优先;`includeInSummary` 时按楼层范围并入摘要材料。
- 事件 `st-baibai-book:phone-update`。

## 6. 设置项速查(`apiSettings`)

```ts
anchor:      { enabled: true, triggerPhrase: '请生成锚点日记', onDemand: true, instruction: '', injectDepth: 4, supersedeHistory: false, hideTagInChat: true, maxChars: 6000 }
backend:     { enabled: true, autoBackup: false, namespace: 'baibai-book', restorePoints: 3, trashKeep: 30 }
phoneBridge: { enabled: true, injectExternal: true, externalMaxChars: 2500, includeInSummary: true, briefHistoryChars: 2400 }
channels[i]: { ..., testPrompt?: string, lastTest?: { ok, at, message } }
```

老数据缺这些键时 `normalize()` 逐字段回退默认,不会因升级丢设置。

### 6.1 摘要缺口策略(1.3.2 起:摘要失败不拦截正文)

```ts
backlogPolicy:  'pass' | 'block'   // 默认 'pass'
backlogWaitSec: number             // 默认 20(0–600;0=不等)
backlogCatchUp: boolean            // 默认 true
```

原版 `handleGenerationIntercept`(`src/memory/engine.ts`)守的是不变式「除最后一条 AI 外其余 AI 楼都必须有摘要」:恰好 1 个缺口时等它补完;等完仍有缺口(补失败)或缺口 >1 时 `abort(true)` 并用 `/sendas` 插一楼「【柏宝书】积压提示」,用户补摘后删楼才能继续。

1.3.2 的默认 `pass` 模式:
- **绝不 `abort`、绝不插提示楼**。缺口楼层的正文本来就留在上下文里(只有已摘的旧楼才会被隐藏),主模型仍能看到剧情,只是该楼暂时没有结构化台账增量。
- 仍会为「正在补的上一楼」等待,但最多 `backlogWaitSec` 秒(`block` 模式等到完成);超时先放行,摘要继续在后台跑完并落盘。开场白建立时间锚点的等待同样受此上限约束。
- 放行时若仍有缺口:toast 一次(同一缺口数 60 秒内不重复);`backlogCatchUp` 开着且引擎空闲时,后台 `runSummary(最旧缺口)`(不等待、一次一楼;本轮刚失败的那一楼不紧接着重试,留给下一轮)。多缺口时 `maybeSummarizePrevAi` 仍按原逻辑停手,因此追补速度 = 每次生成一楼;想一次补完请用摘要页「批量补摘」。
- `block` = 原版行为,提示楼文案末尾多了一行「不想被拦:设置页改为照常生成」。

对应单测:`src/memory/engine.test.ts` → `backlog policy`;设置回灌:`src/api/settings.hydrate.test.ts`。

## 7. 构建与测试

```bash
npm install --no-audit --no-fund     # 或 pnpm install
npm test        # vitest 9 文件 232 条 + timeRel / vector-depth / memory 回归脚本
npm run build   # 产出 dist/index.js、dist/index.css(dist 已随仓库提交,直接安装即可用)
npm run test:phone   # 小手机联动模块的纯 Node 冒烟测试
```

融合功能的单测在 `src/fusion/fusion.test.ts`:外部记录增删 / 预算、恢复点上限与回滚、回收站、锚点版本与注入文本、`getBrief` 的 NPC 在场判定与计划剩余天数、`safeSegment` 等。

## 8. 升级 / 回退
- 从原版 1.2.9 升级:直接覆盖安装;所有新功能默认开启但**无副作用**(锚点需要你触发,备份需要你点,外部记录需要手机推送)。
- 回退到原版:删除本扩展、重新安装原版即可;融合版写入的 `chatMetadata.baibai_book_{anchor,external,trash,restore}` 键会被原版忽略,不影响其读取自己的数据。

## 9. 仓库地址配置
- 本仓库已配置更新检测:`dist/index.js` 的 `REMOTE_MANIFEST_URL` 与 `manifest.json` 的 `homePage` 均指向 `ansdojaods/ST-BaiBai-Book-Tsukiyo`。
- 若迁移仓库:改 `src/memory/update.ts` 顶部的 `REMOTE_MANIFEST_URL`(占位符含 `<` 时不会检查更新)后重新 `npm run build`,并同步修改 `manifest.json` 的 `homePage`。
