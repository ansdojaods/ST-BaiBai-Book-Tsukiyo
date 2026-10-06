# 月夜来信 · 小手机 v2.0

独立运行的 SillyTavern / 酒馆助手小手机，支持可选柏宝书联动。本次增加 **AVS 原生视觉档案**；内部语义版本 `2.0.0`。

## 安装

导入 [`releases/月夜来信小手机_酒馆助手导入版_v2.0_AVS视觉档案.json`](releases/月夜来信小手机_酒馆助手导入版_v2.0_AVS视觉档案.json)。先备份，并停用旧手机副本及原 AVS 核心/浮窗。

**卡内手机和独立手机二选一。** 升级后的大奉卡请用卡内版本，不要用通用脚本覆盖其专用开场/联系人适配。

手机桌面 → **视觉档案**：七页外观、依据查看、旧档案迁移、搜索、290 条规则资料库、分批回扫、备份恢复、独立 API 路由。自动同步和正文注入默认关闭；同步会额外调用模型。未知外观不补写，所有人物仅记录普通外观与日常衣物。

完整说明见 [AVS-V2.md](docs/AVS-V2.md)，仓库提交说明见 [REPOSITORY-UPDATE.md](docs/REPOSITORY-UPDATE.md)。旧功能说明保留在 [README-1.6.3.md](docs/README-1.6.3.md)。`vendor/` 仅存原资料，不是安装入口。

## 源码与构建

```bash
npm ci
npm run verify
```

构建只需 Python 3；Node 20+、npm 用于回归测试。无 CDN、无额外服务器插件。依赖安装需要网络，构建本身不访问网络。

```bash
python3 patch/build_v2.py
# 可选：对原卡内的定制1.6.3引擎应用同一升级，保留剧情、预置和卡版本
python3 patch/build_v2.py --card /path/to/原卡.json --outdir /path/to/output
```

- 原基线：`base/tsukiyo-phone-1.5.2.js`
- 原补丁链：`patch/apply_phone_patch.py` → `tsukiyo-phone-1.6.3.js`
- 新模块：`src/avs/visual.js`、`src/avs/knowledge.json`
- 升级补丁：`patch/apply_visual_patch.py`
- 当前构建：`tsukiyo-phone-2.0.0.js`
- 当前导入件：`releases/`（旧 `dist/` 仅为历史产物）

本仓库作为手机功能的主维护仓库；`ST-BaiBai-Book-Tsukiyo/phone/` 同步镜像，不重复维护两份 AVS 逻辑。柏宝书扩展主版本仍为 1.3.4。

本次交付为本地源码与构建产物，**未推送 GitHub**。测试为模拟环境，不代表用户酒馆实机或真实模型 API 已通过验收。
