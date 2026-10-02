# 月夜来信 · 小手机 1.6.1(百宝月夜书联动)

本目录是**小手机侧**的联动实现:在你提供的 1.5.2 打包脚本(`臭小鬼_月夜来信_V3.5_已修复.json` 内置的「月夜来信 · 小手机 1.5.2」,与导入版 v1.5.2 内容完全相同)之上,用锚点式文本补丁加入一个新模块 `src/services/baibai-bridge.js`,并在上下文、存档、设置页等 11 处接线。

```
phone/
  base/tsukiyo-phone-1.5.2.js      你原来的 1.5.2 脚本内容(基线,未改动)
  patch/apply_phone_patch.py       补丁脚本:每个锚点必须且只能命中一次,否则报错退出
  patch/baibai_module.js           新模块:查找柏宝书、简报缓存、时间解析、上下文片段、BaiBaiLink(回写)
  patch/baibai_actions.js          设置页 / API 页的新动作(开关、立即回写、导入记忆、导入方案、测活)
  patch/build_json.py              把产物写回 角色卡 / 导入版 JSON(自动更新脚本名、info、character_version)
  tsukiyo-phone-1.6.1.js           打补丁后的产物(= 两个导入 JSON 的 content 字段)
  dist/月夜来信小手机_酒馆助手导入版_v1.6.1_柏宝书联动.json   酒馆助手「导入脚本」用
  test/smoke.cjs (+ smoke.scenario.js)   纯 Node 冒烟测试
  test/demo.jsdom.cjs              jsdom 集成测试(离线演示模式启动整部手机,点一遍联动按钮;需 npm i -D jsdom)
```

> 角色卡版本(`臭小鬼_月夜来信_V3.5_小手机1.6.1_柏宝书联动.json`,`character_version = 3.5.0-tsukiyo-phone-1.6.1`)在发布包里,不放进仓库——它包含你的整张角色卡与 118 条世界书。

## 安装(二选一,勿同时启用)

- **角色卡用户**:导入新的角色卡 JSON,替换旧卡(聊天记录不受影响;手机数据存在消息变量里,照常读取)。
- **独立版用户**:酒馆助手 → 脚本库 → 导入 `dist/月夜来信小手机_酒馆助手导入版_v1.6.1_柏宝书联动.json`,停用 / 删除 v1.5.2。

再在扩展里装好「百宝月夜书」(≥1.3.0,其「联动 → 小手机联动」默认开启)。两边装齐后手机「设置」页的「柏宝书联动」卡片会显示「已连接 · 百宝月夜书 v1.3.1 · …」。

## 新增行为(全部可关)

| 手机设置 → 柏宝书联动 | 默认 | 作用 |
| --- | --- | --- |
| 启用柏宝书联动 | 开 | 总开关 |
| 剧情简报进入手机上下文 | 开 | MVU 变量缺日期 / 地点时用柏宝书兜底;人物生成与规划上下文附带柏宝书分层摘要、锚点日记、未了结计划、NPC 档案(遵守知情边界) |
| 在场人物兜底 | 开 | MVU 没有「当前互动NPC」时采用柏宝书推断的在场人物 |
| 手机交流回写柏宝书 | 开 | 消息 / 约定 / 动态 / 未完约定推送到柏宝书【小手机】外部记录(增量、防抖 2.5 s) |
| 按钮:立即回写 / 导入柏宝书记忆 / 导入柏宝书 API 方案 / 经柏宝书测活渠道 | – | 见 `docs/PHONE_BRIDGE.md` §3 |

API 方案页也多了「导入柏宝书方案」按钮。未检测到柏宝书时,一切与 1.5.2 相同。

## 不变的东西
- 存档格式(schema 1)与命名空间 `tsukiyo_phone_v1`;`validatePhone` 校验原样通过(新增字段 `memories[].bb`、`settings.ui.baibai` 都在允许范围内)。
- 记忆世界书同步:带 `bb` 标记(从柏宝书导入)的记忆被排除在同步之外,其余逻辑未动。
- 主模型注入 `tsukiyo-phone:context`:不加入柏宝书内容(柏宝书自己注入),只是在无 MVU 日期时 `剧情时间.origin` 可能显示「柏宝书记忆」。

## 重新生成
```bash
python3 phone/patch/apply_phone_patch.py phone/base/tsukiyo-phone-1.5.2.js phone/tsukiyo-phone-1.6.1.js
node phone/test/smoke.cjs                 # 期望最后一行 ALL_OK
cd phone/test && npm i jsdom@24 && node demo.jsdom.cjs   # 可选,期望 DEMO2_OK
```
把产物写回 JSON:
```bash
python3 phone/patch/build_json.py phone/tsukiyo-phone-1.6.1.js 输出目录 --card 臭小鬼_月夜来信_V3.5_已修复.json --standalone 月夜来信小手机_酒馆助手导入版_v1.5.2.json
```

## 1.6.0 → 1.6.1
只改了三处提示文案(连接状态、报错、设置卡片说明),把「ST-BaiBai-Book 融合版」改成「柏宝书-月夜来信版」;联动接口 `window.STBaiBaiBook.phone` 与事件名在柏宝书更名后**没有变化**,已导入 1.6.0 的用户不必重新导入。

## 若将来小手机升级到 1.5.x 之后的版本
补丁依赖的锚点都是函数签名级别的稳定文本(`storyFor`、`capture()` 的 `present` 行、`planMemorySync(...)` 调用、`settingsView` 开头、`case "read-narrative":` 等)。换基线后直接重跑补丁脚本,报哪个锚点没命中就只需修那一处。
