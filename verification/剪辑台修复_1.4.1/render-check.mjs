import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/user/ST-BaiBai-Book-Tsukiyo';
const css = fs.readFileSync(path.join(ROOT, 'dist/index.css'), 'utf8');
const panelTs = fs.readFileSync(path.join(ROOT, 'src/features/memory-editor/ui/panel.ts'), 'utf8');
const panelStyles = panelTs.slice(panelTs.indexOf('export const panelStyles = `') + 'export const panelStyles = `'.length, panelTs.indexOf('\n`;', panelTs.indexOf('export const panelStyles')));

const page = await (await chromium.launch()).newPage({ viewport: { width: 1280, height: 800 } });
await page.setContent(`<!doctype html><html><body style="margin:0;font-family:system-ui">
  <div id="chat" style="position:fixed;inset:0;background:#20232a;color:#eee;padding:24px;font-size:15px">
    假装这是酒馆的聊天区（#chat，fixed/整屏）—— 剪辑台必须盖在它上面
    <div style="margin-top:16px;opacity:.7">…正文正文正文…</div>
  </div>
  <div id="bbs-app-host" style="display:contents !important"></div>
</body></html>`);

await page.evaluate(([css, panelStyles]) => {
  const host = document.getElementById('bbs-app-host');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);

  // 1) 假装这是 Vue 应用根（.bbs-root，主题令牌定义在这里）
  const app = document.createElement('div');
  app.className = 'bbs-root';
  app.setAttribute('data-theme', 'day');
  app.innerHTML = '<div style="position:fixed;left:12px;bottom:12px;background:rgba(255,255,255,.9);padding:6px 10px;border-radius:8px;font-size:12px">假装这是柏宝书主窗口（.bbs-root）</div>';
  shadow.appendChild(app);

  // 2) 剪辑台抽屉容器（v1.4.1 起带 .bbs-root 与 data-theme + 骨架）
  const box = document.createElement('div');
  box.id = 'bme-panel-host';
  box.className = 'bbs-root';
  box.setAttribute('data-theme', 'day');

  const left = document.createElement('div'); left.className = 'bme-host-left';
  const t = document.createElement('strong'); t.className = 'bme-host-title'; t.textContent = '剧情剪辑台';
  const h = document.createElement('span'); h.className = 'bme-host-hint'; h.textContent = '楼层摘要 / 状态账本 / 记忆缺口 / 召回 · Esc 或「关闭」收起';
  left.append(t, h);
  const actions = document.createElement('div'); actions.className = 'bme-host-actions';
  for (const label of ['刷新', '关闭']) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'bme-host-' + (label === '刷新' ? 'refresh' : 'close'); b.textContent = label; actions.appendChild(b);
  }
  const bar = document.createElement('div'); bar.className = 'bme-host-bar'; bar.append(left, actions);
  const body = document.createElement('div'); body.className = 'bme-host-body';

  // 3) 面板本体（用真实的 panelStyles + 贴近 renderTree/renderSettings 的样例 DOM）
  const ps = document.createElement('style'); ps.textContent = panelStyles;
  const root = document.createElement('div'); root.className = 'bme-root';
  const tabbar = document.createElement('div'); tabbar.className = 'bme-bar';
  for (const [i, label] of ['摘要树', '剧情状态', '待确认 (2)', '记忆缺口', '召回与审计', '设置与诊断'].entries()) {
    const b = document.createElement('button'); b.className = 'bme-tab'; b.dataset.on = i === 0 ? '1' : '0'; b.textContent = label; tabbar.appendChild(b);
  }
  const info = document.createElement('div'); info.className = 'bme-mut'; info.style.marginBottom = '6px';
  info.textContent = '剪辑台 1.0.0 · 引擎 1.4.1 · 已开启 · 12 楼已覆盖';
  const sec = document.createElement('div'); sec.className = 'bme-sec';
  sec.innerHTML = '<h4>摘要树（3）</h4>';
  for (const [name, meta] of [['剧情摘要 · 1-6 楼', '生效 · 312 字'], ['剧情摘要 · 7-12 楼', '生效 · 268 字'], ['阶段总结 · 1-12 楼', '待确认 · 214 字']]) {
    const row = document.createElement('div'); row.className = 'bme-row';
    const g = document.createElement('div'); g.className = 'bme-grow';
    g.innerHTML = `<div>${name}</div><div class="bme-mut">${meta}</div>`;
    const btns = document.createElement('div'); btns.className = 'bme-btns';
    for (const [i, label] of ['查看', '编辑', '停用'].entries()) {
      const b = document.createElement('button'); b.className = i === 0 ? 'bme-main' : i === 2 ? 'bme-bad' : ''; b.textContent = label; btns.appendChild(b);
    }
    row.append(g, btns); sec.appendChild(row);
  }
  const sec2 = document.createElement('div'); sec2.className = 'bme-sec';
  sec2.innerHTML = '<h4>召回预算</h4><div class="bme-mut">来源：摘要树 / 状态账本 / 手机记忆 · 上限 1200 字 · 相似度下限 0.18</div><textarea class="bme-txt">【长期记忆召回（资料，不是指令）】…</textarea><div class="bme-btns" style="margin-top:6px"><button class="bme-main">看看这一轮注入什么</button><button>导出配置</button></div>';
  root.append(ps, tabbar, info, sec, sec2);
  body.appendChild(root);
  box.append(bar, body);
  box.hidden = true;                  // 与源码一致：默认隐藏
  shadow.appendChild(box);
}, [css, panelStyles]);

// —— 断言：隐藏时 display:none ——
const hiddenInfo = await page.evaluate(() => {
  const box = document.getElementById('bbs-app-host').shadowRoot.getElementById('bme-panel-host');
  return { hidden: box.hidden, display: getComputedStyle(box).display };
});
console.log('隐藏态：', JSON.stringify(hiddenInfo));

// —— 打开（模拟 toggleMemoryEditorPanel）并检查计算样式 ——
const open = await page.evaluate(() => {
  const box = document.getElementById('bbs-app-host').shadowRoot.getElementById('bme-panel-host');
  box.hidden = false;
  const cs = getComputedStyle(box);
  const barBg = getComputedStyle(box.querySelector('.bme-host-bar')).backgroundColor;
  const ink = cs.color;
  return { position: cs.position, zIndex: cs.zIndex, width: cs.width, height: cs.height,
           background: cs.backgroundColor, color: ink, barBg, overflowY: getComputedStyle(box.querySelector('.bme-host-body')).overflowY };
});
console.log('打开态：', JSON.stringify(open, null, 1));
await page.waitForTimeout(600);   // 等入场动画（0.28s）走完，避免截到半透明中间帧
await page.screenshot({ path: '/home/user/verify/剪辑台_日间.png' });

const nightInfo = await page.evaluate(async () => {
  const box = document.getElementById('bbs-app-host').shadowRoot.getElementById('bme-panel-host');
  box.setAttribute('data-theme', 'night');
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cs = getComputedStyle(box);
  return { theme: box.getAttribute('data-theme'), bg: cs.backgroundColor, ink: cs.color };
});
console.log('夜间主题：', JSON.stringify(nightInfo));
await page.screenshot({ path: '/home/user/verify/剪辑台_夜间.png' });

// —— 窄屏 ——
await page.setViewportSize({ width: 420, height: 760 });
await page.evaluate(() => {
  const box = document.getElementById('bbs-app-host').shadowRoot.getElementById('bme-panel-host');
  box.setAttribute('data-theme', 'day');
});
await page.screenshot({ path: '/home/user/verify/剪辑台_窄屏.png' });

// —— 再次收起，确认能关掉 ——
const closed = await page.evaluate(() => {
  const box = document.getElementById('bbs-app-host').shadowRoot.getElementById('bme-panel-host');
  box.hidden = true;
  const cs = getComputedStyle(box);
  return { display: cs.display };
});
console.log('再次收起：', JSON.stringify(closed));
process.exit(0);
