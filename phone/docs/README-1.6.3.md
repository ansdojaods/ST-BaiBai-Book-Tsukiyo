# 月夜来信 · 小手机（Tsukiyo Phone）v1.6.3

SillyTavern「酒馆助手」脚本：在酒馆里运行的一整套手机 UI（联系人 / 聊天 / 朋友圈 / 相册 / 记忆 / 剧情规划 / API 方案管理等），原创实现，不含用户 API 密钥或聊天存档。

当前版本：**v1.6.3（百宝月夜书联动）**

## 直接使用（不需要构建）

- **独立版**：SillyTavern 酒馆助手 → 脚本库 → 导入 [`dist/月夜来信小手机_酒馆助手导入版_v1.6.3_柏宝书联动.json`](dist/月夜来信小手机_酒馆助手导入版_v1.6.3_柏宝书联动.json)，任何角色可用；
- **角色卡版**：使用内置了同版本小手机的角色卡（角色卡 JSON 含整张卡与世界书，不放在本仓库）。

## 与百宝月夜书联动（可选）

安装[百宝月夜书扩展](https://github.com/ansdojaods/ST-BaiBai-Book-Tsukiyo)后自动获得双向联动，两边都无需配置：

- 扩展 → 手机：剧情时间 / 地点 / 在场人物兜底；分层摘要、锚点日记、未了结计划、NPC 档案进入人物生成与规划上下文（遵守知情边界）；
- 手机 → 扩展：消息 / 约定 / 动态回写为【小手机】外部记录；一键导入柏宝书记忆；互相导入 API 方案；经柏宝书测活渠道（密钥不经手机）。

联动接口是 `window.STBaiBaiBook.phone` 与 `st-baibai-book:*` 事件，协议详见扩展仓库的 `docs/PHONE_BRIDGE.md`。不装扩展时，手机一切功能照常独立运行。

## 仓库结构

```
tsukiyo-phone/
├── base/tsukiyo-phone-1.5.2.js      1.5.2 原版基线（未改动的打包脚本）
├── patch/
│   ├── apply_phone_patch.py         补丁脚本：1.5.2 → 1.6.3（锚点式文本补丁，每个锚点必须且只能命中一次）
│   ├── baibai_module.js             联动核心模块：查找百宝月夜书、简报缓存、时间/地点回退、回写、导入记忆/API 方案、测活
│   ├── baibai_actions.js            设置页联动卡片的动作（开关、立即回写、导入、测活）
│   ├── build_json.py                把打好补丁的脚本写回 导入版 JSON / 角色卡 JSON
│   └── standalone-template.json     导入版 JSON 模板
├── tsukiyo-phone-1.6.3.js           打完补丁的完整脚本（= dist 导入 JSON 的 content 字段）
├── dist/月夜来信小手机_酒馆助手导入版_v1.6.3_柏宝书联动.json   酒馆助手「导入脚本」用
├── test/
│   ├── smoke.cjs (+ smoke.scenario.js)   纯 Node 冒烟测试
│   ├── memory-generation.cjs             记忆生成回归测试
│   └── demo.jsdom.cjs                    jsdom 集成测试（需 npm i -D jsdom）
└── docs/BAIBAI-BRIDGE.md            联动实现说明（补丁结构、接线点、重新打包）
```

## 从源码重建

```bash
python patch/apply_phone_patch.py base/tsukiyo-phone-1.5.2.js tsukiyo-phone-1.6.3.js
node test/smoke.cjs                 # 期望 ALL_OK
```

把产物写回 JSON（更新导入版 / 角色卡）：

```bash
python patch/build_json.py tsukiyo-phone-1.6.3.js 输出目录 --card 臭小鬼_月夜来信_V3.5_已修复.json --standalone 月夜来信小手机_酒馆助手导入版_v1.5.2.json
```

换基线重跑补丁时，报哪个锚点没命中就只需修那一处（锚点都是函数签名级别的稳定文本）。

## 与百宝月夜书仓库的关系

- 本仓库是百宝月夜书扩展仓库内 `phone/` 目录的独立镜像，内容一致，便于单独跟踪小手机的版本与改动；
- 扩展侧（摘要引擎 / 渠道测话 / 联动设置页）见 https://github.com/ansdojaods/ST-BaiBai-Book-Tsukiyo 。

## 隐私与安全

- 脚本不内置、不携带、不上传任何 API 密钥；密钥只保存在你自己的浏览器存储里（导出 JSON 前请自行确认）；
- 不含聊天存档；历史数据在消息变量与本地存档里，导出分享脚本不会带走它们。

## 制作与归属

- 小手机本体为**月夜来信**原创脚本；
- 1.6.x 百宝月夜书联动模块由本仓库的补丁链（锚点式文本补丁）加入，逻辑与文案修改均可见于 `patch/` 下的补丁源。
