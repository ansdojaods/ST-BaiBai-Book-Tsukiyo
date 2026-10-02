# 更新日志

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
