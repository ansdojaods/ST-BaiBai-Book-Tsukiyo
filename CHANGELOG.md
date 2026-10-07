# 1.4.2 联动接线修复（与手机 2.9.5 配套）

- **剪辑台召回接进生成流程**：`src/index.ts` 的生成拦截器在放行路径上调用 `runEditorRecall()`（写独立槽 `baibai_book_editor`）；剪辑台在 `onGenerationEnded` 里记完「上次召回」就清空注入槽。此前宿主一处都没调 → 召回从未自动生效，手动注入会一直挂着（`setExtensionPrompt` 是持久化的）。
- **「汇入小手机记录」修好**：`host.ts` 传入 `notesProvider`（取 `externalState.notes` 中 `source === 'tsukiyo-phone'` 的记录），`mergePhoneNotes()` 这条链路打通。
- **自动摘要归属二选一**：新增设置 `editorOwnsAutoSummary`（设置 → 摘要设置 →「自动摘要归属」）。柏宝书（默认）由摘要森林自动摘要；选「剧情剪辑台」后 `engine.ts` 的 `maybeSummarizePrevAi` 直接早退，改由剪辑台自动生成（进「待确认」草稿）。时间标签 / 旧楼隐藏 / 积压拦截仍跟随 `autoSummaryEnabled`，不受归属影响。宿主通过 `ports.autoSummaryAllowed()` 告知剪辑台，剪辑台在 `onGenerationEnded` 里让位。
- **能力声明扩展**：`capability()` 增加 `enabled`（剪辑台总开关）与 `mode`；新增 `memoryEditor.open()/close()/toggle()`（宿主传 `panelControls`），`CreateOptions.notesProvider` / `panelControls` 类型补齐。
- **面板按需重绘 + 角标**：`st-baibai-book:changed` 到达时面板收起则不重建 DOM、同轮事件合并（120ms）；新增 `features/memory-editor/badge.ts`，魔杖菜单「剧情剪辑台」显示待确认草稿数；自动生成草稿后 toast 一次提示。
- **恋爱心迹注入可关**：`phoneBridge.injectHeart`（默认开）—— 关闭后 `phone_heart` 记录仍保留在「联动」页与摘要材料里，只是不塞进主模型，避免与「锚点日记」重复占上下文。
- **清理**：删除无人引用的 `describeEditor()`；修正 `mountMemoryEditorPanel` 里恒为假的补挂条件（改为查 `.bme-root`）；更正 `host.ts` 里挂错位置的注释。
- 测试：剪辑台模块用例 55 → **60**（能力开关 / 一次性注入 / 归属让位 / 草稿提示 / 旧宿主兼容）；vitest 302、timeRel 810、vector-depth 12、memory 53 全绿；`vue-tsc` 0 报错；`vite build` + `check:local` 通过。

# 1.4.1 剪辑台显示修复 + 去重

- **修复「剧情剪辑台在酒馆里显示不对」**：
  - 根因一：面板容器 `#bme-panel-host` 与 Vue 根节点 `.bbs-root` 是 shadow root 里的**兄弟节点**，而主题令牌 `--bbs-*` 定义在 `.bbs-root` 上 —— 容器里所有 `var(--bbs-*)` 取不到值（背景透明、字号颜色随宿主漂移）；现给容器补上 `.bbs-root` 类与 `data-theme`，并 `watch(ui.theme)` 跟随主题切换。
  - 根因二：容器此前**没有任何 CSS**（全仓库搜不到 `#bme-panel-host` 规则），`position:static` + `display:contents` 的父级 → 面板排在页面流末尾、被 `#chat` 盖住，`hidden` 也压不住布局；现新增 `src/styles/memory-editor.css`：右侧抽屉（fixed / `z-index 10050` / 整高 / 主题化配色 + 兜底值 / 窄屏整屏 / `[hidden]` 显式 `display:none` / 页签条吸顶）。
  - 面板加骨架（`host.ts → ensureChrome()`）：标题条 +「刷新」「关闭」+ 可滚动内容区；`toggleMemoryEditorPanel(force?)` 支持强制收起，打开时重绘并绑一次 `Esc`。
  - `createMemoryEditor()` 新增 `renderPanel()`；引擎 `st-baibai-book:changed` 事件现在同时重绘面板（此前只在创建时渲染一次，打开时可能看到旧内容）。
  - 详细定位过程与可调项见 `docs/剪辑台显示修复_1.4.1.md`。
- **去掉与手机仓库重复的 `phone/` 镜像**（46 个文件 / 约 11MB：1.5.2 基线、1.6.3/2.0/2.5 脚本、补丁脚本、vendor 参考件、旧发行 JSON），手机已由独立仓库 `ansdojaods/tsukiyo-phone`（v2.9.2）维护；移除 `package.json` 的 `test:phone` / `build:phone` / `test:phone-ui`，`verify` 改为 `typecheck → test → build → check:local`。
- **README 清理**：删除误粘贴的 `</content>` / `</invoke>` 片段；新增「与月夜来信小手机的关系（谁是谁）」一节，把三者（百宝月夜书 / 剧情剪辑台 / 小手机）的边界与三条联动链路写清楚。
- 验证：`vue-tsc` 0 报错；vitest 302 项 + timeRel 810 / vector-depth 12 / memory 53 断言全绿；`vite build` 重建 `dist/`；`check:local` 通过。

---

# 1.4.0 剧情剪辑台

- **主题：剧情剪辑台（楼层摘要树 / 状态账本 / 缺口 / 召回注入 / 待确认草稿）**：新增引擎侧模块 `src/features/memory-editor/`（EDITOR_VERSION 1.0.0）——三层摘要、剧情状态账本、记忆缺口与补课、本地可解释召回（哈希词频余弦，零外部依赖）、楼层收纳、草稿与撤回、脱敏诊断、配置/档案导入导出。
- 新增 `window.STBaiBaiBook.memoryEditor`（`apiVersion` 1）：`capability() / mirror() / info() / recall() / mergeExternal() / mergePhoneNotes() / exportArchive() / diagnostics()`，并广播 `st-baibai-book:memory-editor`；既有公开 API 语义不变。
- 与月夜来信小手机（≥ v2.9.1）互斥：引擎接管楼层记忆后，手机侧不再生成楼层摘要、不再注入楼层记忆；手机记录仍按原通道单向汇入（`mergePhoneNotes`）。
- 宿主接线（`src/features/memory-editor/host.ts`）：状态按聊天落盘 `chatMetadata.bbs_editor_state`；生成走副 API「摘要」渠道（支持 AbortSignal）、无渠道回退主 API `generateRaw`；注入独立槽 `baibai_book_editor`（D4，切聊天即清空）；楼层/缺口口径与 `getFloor` / `coverage.missingAiFloors` 完全一致；`busy()` 让行引擎摘要与批量任务。
- 入口：魔杖菜单 →「剧情剪辑台」（面板挂主 shadow root，默认隐藏）。
- 未接：楼层收纳的 `hideFloors/showFloors`（可选端口）——引擎窗口自动隐藏已管理楼层可见性，侧路再隐藏会冲突；模块对缺失端口自动降级为「不可用」。
- 测试：模块 55 项全绿（`tests/memory-editor/`，`npx tsc -p tsconfig.test.json` 编到 `.build/`，已加 .gitignore）；vue-tsc 0 报错；vitest + timeRel(810)/vector-depth(12)/memory(53) 回归通过；`vite build` 重建 dist。

# 1.3.4 / 手机 1.6.3

- 为异步摘要/锚点和隐藏操作增加会话代次与输入一致性检查。
- v2 快照严格预检和原聊天消息身份校验；旧版无身份快照拒绝直接恢复，可单独导出旧恢复点。
- 回收站保留父边和级联祖先；身份恢复叶子；发生冲突不移除条目。
- carryover 携带融合锚点、外部记录及聊天变量模板，显示迁移数量。
- 外部记录预算/数量上限、来源复合键、渠道 token 参数修复。
- 手机结束状态和删除标记回写，保留历史消息；读写开关独立机制不变。
- 新增安全回归测试、手机生命周期测试与统一 verify 脚本。完整边界见 docs/SAFETY_EDITION_1.3.4.md。

# 本地改版1.3.3（已推送部署仓库）

- 新增现有未摘要AI楼层的手写补摘和身份检查，不调用AI。
- 手机1.6.2可选实时记忆读取，补齐各生成入口、记忆页预览和开关；读取与回写独立。
- 移除白鸟远程适配、同步、探测与UI，保留本地恢复/回收站/JSON导出。
- 新导入记忆默认仅玩家知情；修复手机失败回写的签名重试时机。
- 修复构建工具Node类型配置，新增单元与模拟UI回归测试。
- 本次不涵盖全部历史审查发现，详见docs/LOCAL_EDITION_1.3.3.md。

---

# 更新日志

## 1.3.2 百宝月夜书(2026-10-02)
- **摘要失败不再拦截正文生成**(新增设置 `backlogPolicy`,默认 `pass`):以前「前面有楼没摘上」时拦截器会 `abort` 正文并用 `/sendas` 插一楼「【柏宝书】积压提示」,要求先补摘再删楼;现在默认**照常生成**——未摘的楼层正文本来就还留在上下文里(只有已摘的旧楼才会被隐藏),剧情不断,缺口交给后台追补或手动/批量补摘。原版拦截行为改为可选项「拦截并提示补摘(原版)」。
- 等待上限 `backlogWaitSec`(默认 20 秒,0=不等):发送前若上一楼摘要正在补(或拦截器自补),最多等这么久;等不到就先生成正文,摘要继续在后台跑完落盘。API 卡死 / 反复超时时不会再把玩家晾在那里。开场白时间锚点的等待同样受此上限约束。
- 后台追补 `backlogCatchUp`(默认开):放行时若仍有缺口且引擎空闲,每次生成在后台补最旧的一楼(一次只补一楼,不会一口气刷光 API;刚失败的那一楼本轮不重复重试)。缺口提示 toast 同一数量 60 秒内只弹一次。
- 设置页「摘要设置」新增三项:摘要缺口时 / 缺口等待上限(秒) / 后台自动追补缺口;诊断包 `apiSettings` 一并导出。
- 修复:刷新页面后锚点日记 / 数据后端 / 小手机联动的设置会退回默认值(`applyInto` 漏回灌嵌套设置);现已随其它设置一起从 `extension_settings` 恢复。
- 源码与部署版对齐:仓库源码中的显示名统一为「百宝月夜书」,`REMOTE_MANIFEST_URL` / `homePage` 指向 `ansdojaods/ST-BaiBai-Book-Tsukiyo`(与部署版 1.3.1 的手改一致,重新构建的 `dist/` 不再需要手工改字符串)。小手机 1.6.1 导入 JSON 由补丁源重新生成,与部署版逐字节相同,**手机侧无需更新**。
- 测试:新增 `backlog policy` 6 条 + `hydrateSettings` 1 条,共 9 文件 232 条。

## 1.3.1 百宝月夜书(2026-10-02,部署版)
- 更名:「柏宝书-月夜来信版」更名为「百宝月夜书」——`manifest.json` 显示名、扩展 UI 文案(品牌名 / 设置页标题 / 弹窗标题)、诊断包 `plugin.name` 与文档同步更新;`window.STBaiBaiBook`、事件名、`chatMetadata` 键、CSS 前缀等接口与数据键**不变**,小手机联动不受影响。
- 部署配置:`dist/index.js` 的 `REMOTE_MANIFEST_URL` 与 `manifest.json` 的 `homePage` 指向 `ansdojaods/ST-BaiBai-Book-Tsukiyo`,更新检测启用。
- `phone/dist/` 导入 JSON 与相关文档中的扩展显示名同步为「百宝月夜书」,脚本逻辑未改。

## 1.3.1 月夜来信版(2026-10-02)
- 更名:扩展显示名 / 窗口标题 / 扩展菜单 / 顶栏提示 / 设置页标题统一为「柏宝书-月夜来信版」;仓库与文件夹名 `ST-BaiBai-Book-Tsukiyo`;package 名 `st-baibai-book-tsukiyo`。
- **接口与数据完全不变**:`window.STBaiBaiBook`(含 `.phone`)、事件名、`chatMetadata` 键、设置键、`bbs-` CSS 前缀、隐藏正则 id 都沿用,因此小手机 1.6.0 无需改动即可识别;原版柏宝书的聊天数据可直接被本版读取。
- 诊断包 `plugin.name` 改为 `ST-BaiBai-Book-Tsukiyo (柏宝书-月夜来信版)`;更新检测占位地址改为 `<your-account>/ST-BaiBai-Book-Tsukiyo`。
- 小手机 1.6.1:仅提示文案(设置卡片、连接状态、报错)改为「柏宝书-月夜来信版」,逻辑与 1.6.0 相同;新增 `phone/patch/build_json.py` 一键写回角色卡 / 导入版 JSON。


## 1.3.0 融合版(2026-10-02)

### 新增
- **锚点日记**(`src/anchor/`):触发词催更 / 每回合两种模式;收割回复末尾 `<anchor>` 块为版本化锚点;注入主模型(可设深度与最大字符);可选用锚点替代其覆盖范围内的历史摘要;ST 正则隐藏正文里的锚点块;静默生成、粘贴导入、编辑、排除、回滚、删除进回收站。
- **数据后端 / 备份**(`src/backend/`):白鸟数据(ST-BaiNiaoData)可选服务端快照,乐观并发,回收站镜像;摘要后自动备份;本地恢复点(上限可设,批量补摘 / 导入 / 恢复前自动建点);本地回收站(摘要 / 子树 / 叶子 / 锚点 / 外部记录 / 计划);诊断包导出(密钥脱敏)。
- **API 渠道**:每渠道自定义测活短语、测活结果留存(✓/✗ 与耗时)、全部测活;从小手机的跨设备同步配置导入 API 方案。
- **小手机联动**(`src/bridge/`):`window.STBaiBaiBook.phone`(getBrief / getNpcProfile / getAnchor / pushNotes / listNotes / listChannels / requestWithChannel / testChannel / exportChannel / isEnabled);外部记录按预算注入 `【小手机】` 并可并入摘要材料;事件 `st-baibai-book:phone-update`。
- **「联动」设置页**(`src/pages/fusion/`):上述全部开关、锚点列表、后端快照、恢复点、回收站、诊断、简报预览、外部记录、渠道测活。
- **小手机 1.6.0 补丁**(`phone/`):月夜来信小手机的柏宝书联动模块、设置卡片、导入 JSON 与测试。
- 计划到期提示:注入的计划列表附带「还剩 N 天 / 已逾期」。

### 变更
- `src/api/settings.ts` 新增 `anchor / backend / phoneBridge` 设置块与渠道 `testPrompt / lastTest`;`defaults()`、`normalize()` 改为导出。
- `src/memory/update.ts` 更新检测地址改为常量 `REMOTE_MANIFEST_URL`,未配置(含 `<`)时不检测。
- `manifest.json` 显示名「柏宝书 · 融合版」,版本 1.3.0。

### 测试
- 新增 `src/fusion/fusion.test.ts`(17 条);`npm test` 共 8 文件 225 条 + 3 个回归脚本全部通过;`npm run test:phone` 小手机联动冒烟测试。

## 1.2.9 及更早
见原版仓库 https://github.com/baibai-git/ST-BaiBai-Book 的提交记录。
