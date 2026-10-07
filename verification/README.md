# 最终验证

## 1.4.2（当前）

- 本版改动与逐条证据见 [`../docs/联动接线修复_1.4.2.md`](../docs/联动接线修复_1.4.2.md)。
- `npm run verify` 全绿：`vue-tsc` 0 报错 → vitest **302 项** → 剪辑台模块 **65 项**（55 → 65，含 5 项跨仓库契约夹具）→ `vite build`（143 模块）→ `check:local` LOCAL_ONLY_OK。
- 另跑：`timeRel 810` / `vector-depth 12` / `memory-regressions 53` 断言全绿。
- 说明：剪辑台模块测试用假宿主（`tests/memory-editor/fake-host.cjs`），没有真实酒馆 / 真实 API 的端到端验证。
- 机器可读记录：[`results-1.4.2.json`](results-1.4.2.json)（版本、命令状态、构建文件 SHA256、验证范围）。
- 注意：同目录的 `results.json` 与 `SHA256SUMS.txt` 是 **1.3.4 时代**的清单（还含已移出的 `phone/` 目录），仅作历史留存，不代表当前构建。

---

以下为 1.3.4 时代的记录（当时的 `phone/` 镜像已在 1.4.1 移除，手机改为独立仓库 `ansdojaods/tsukiyo-phone`）。


`npm-ci-final.log`：重装依赖成功。

`verify-final.log`：对本包源码完整运行 `npm run verify` 的最终通过记录：12 个 Vitest 文件、298 项测试（其中新增安全回归 47 项）；手机实际 bundle 32 项生成/回写用例及模拟 UI 通过。

`phone-repro.log`：从原始 1.5.2 手机脚本重新应用补丁，已用 cmp 与交付 1.6.3 JS 比对相同。

`results.json`：版本、命令状态、构建文件 SHA256 与验证范围。

`changed-files-vs-1.3.3.txt`：相对前次交付的文件变化。

以上均为本地/模拟宿主测试，不代表已经在用户的真实酒馆部署或验证。未运行旧审查的缺陷复现测试来冒充修复；新增 safety.test.ts 断言的是修复后的安全行为。
