> 小手机独立镜像仓库：https://github.com/ansdojaods/tsukiyo-phone

# 月夜来信小手机1.6.3 · 可选实时柏宝书记忆

## 安装

酒馆助手 → 脚本库 → 导入 `dist/月夜来信小手机_酒馆助手导入版_v1.6.3_柏宝书联动.json`。停用旧独立手机或卡内手机，勿同时运行。

配套百宝月夜书1.3.3，双方读取开关均开启时，各生成模块可参考当前记忆。手机「记忆」页可切换读取和查看参考；「设置 → 柏宝书联动」可独立关闭回写。

这不是整张角色卡替换包，没有改变原存档命名空间。无白鸟服务端要求；手机生成仍使用原来的LLM渠道。

## 构建

项目根目录执行 `npm run build:phone`，会生成JS与酒馆助手JSON并运行手机测试。

- `base/tsukiyo-phone-1.5.2.js`：原始基线，不修改。
- `patch/baibai_module.js`：只读参考、权限闸门、作用域裁剪和回写。
- `patch/baibai_actions.js`：开关、预览、导入动作。
- `patch/apply_phone_patch.py`：每个补丁锚点要求精确命中，重建失败即报错。
- `patch/standalone-template.json`：原仓库导入包去除content后的模板，保留脚本ID。
- `patch/build_json.py`：将构建JS写入导入包。
- `test/memory-generation.cjs`：执行真实bundle内生成入口，验证16类请求的开/关输入及附加边界。
- `test/demo.jsdom.cjs`：模拟UI集成测试（测试中启用demo的模拟联动，产品demo仍默认不连接）。

原作者权利与来源说明见项目根README。详细使用、隐私范围及旧风险见 `docs/LOCAL_EDITION_1.3.3.md`。

## 1.6.3 修复
日程取消/完成/拒绝/过期、约定完成/停用，以及删除事项都会更新书侧旧记录并撤销置顶；不整来源替换外部记录，保留历史消息。重新导入本版 JSON 后停用旧脚本，脚本稳定 ID 保持不变。
