# 提交到你的 GitHub 仓库

## 放在哪里

- **主维护仓库：`ansdojaods/tsukiyo-phone`**。AVS 是手机 App、存档和 API 模块的一部分，不依赖柏宝书扩展才可工作。
- **镜像：`ansdojaods/ST-BaiBai-Book-Tsukiyo` 的 `phone/`**。只同步手机及其构建/测试命令；扩展主版本保持 1.3.4，未修改摘要、向量、渠道或服务器逻辑。
- 大奉卡单独交付，不自动加入公开仓库，避免把私房整合卡当作公共测试夹具上传。

本次没有 GitHub 写入授权，两个线上仓库均未被本次操作更新。源码 ZIP 是可复制进你的本地克隆、审核并提交的版本，不包含 `.git`、访问令牌、API 密钥、node_modules 或个人聊天。

## 推荐流程

先用你的账号克隆仓库，再将对应源码 ZIP 的根目录内容覆盖进去。注意保留克隆出来的 `.git/`，不要把另一个仓库的根目录混入当前仓库。

```bash
git switch -c phone-v2.5
# 复制本交付对应仓库的源码
npm ci
npm run verify
# 核查变更：不得包括自己的卡、聊天、密钥或.env
git status --short
git diff --stat
git add .
git commit -m "feat(phone): integrate native AVS visual archive v2.5"
git push -u origin phone-v2.5
```

然后在 GitHub 对你的默认分支创建 Pull Request。也可以按你原来的发布流程提交默认分支，但先备份与审核。

主仓新增 `src/avs`、`vendor/avs`、v2.5 补丁、测试、说明、`package.json/package-lock.json`、当前源码和 `releases`。AVS 原始资料来自本次用户上传；原作者权利/许可按原文件或原项目约定，本次不替第三方重新授权。公开发布前请确认你有权分发这些原始资料。

## 以后同步镜像

把手机仓库下除 `.git/`、`node_modules/`、Python 缓存之外的源码复制到扩展仓库的 `phone/`。扩展仓库根目录运行 `npm run build:phone` 与 `npm run test:phone-ui`。不要将两处分别编辑后再靠版本号猜测是否一致，优先比较 v2.5 bundle 的 SHA-256。

本次v2.5额外参考五个公开仓库，但不复制其运行时代码。`st-direct-event`实际许可证与README存在冲突，WorldEngine未找到许可证；本次采用独立实现，未把这些克隆仓库打包分发。见 `V2.5-REPOSITORY-REVIEW.md`。
