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
