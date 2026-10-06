# 剪辑台显示修复 · 渲染验证（1.4.1）

本目录是「剧情剪辑台在酒馆里显示不对」修复后的**真实浏览器验证材料**，用 Playwright + Chromium 在本地跑出来的，
没有连任何线上环境（页面是脚本自己拼的：一个 fixed 的假 `#chat` + 带 open shadow root 的 `#bbs-app-host`，
容器与 Vue 根的关系、`dist/index.css` 的注入方式、面板的真实 DOM/样式（从 `src/features/memory-editor/ui/panel.ts` 抽出 `panelStyles`）都与插件一致）。

## 怎么跑

```bash
npm i -D playwright && npx playwright install chromium && npx playwright install-deps chromium
node verification/剪辑台修复_1.4.1/render-check.mjs
```

## 结论（关键计算样式）

| 检查项 | 隐藏时 | 打开时 |
| --- | --- | --- |
| `#bme-panel-host` display | `none`（`[hidden]` 生效） | `flex` |
| position / z-index | — | `fixed` / `10050`（高于主窗口 10000 与 `bbs-modal-mask-top` 10002） |
| 宽高 | — | `460px × 800px`（视口高，窄屏 ≤640px 时 `100vw`） |
| 背景 / 文字（日间） | — | `oklch(1 0 0)` 白 / `oklch(.252 .056 264)` 海军蓝墨 |
| 背景 / 文字（夜间） | — | `rgb(68,68,78)` / `rgb(211,218,217)`（主题令牌随 `data-theme` 切换） |
| 内容区 overflow-y | — | `auto`（面板自己滚动，不带动聊天页） |
| 再次收起 | `display: none` | — |

截图：`剪辑台_日间.png`、`剪辑台_夜间.png`、`剪辑台_窄屏.png`（窄屏为整屏抽屉）。
