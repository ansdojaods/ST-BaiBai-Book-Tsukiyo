  // src/services/baibai-bridge.js
  // 柏宝书（ST-BaiBai-Book 融合版 ≥1.3.0）联动：只读其公开 API，不触碰其内部数据；手机的一切改动都留在手机。
  var BAIBAI_SOURCE = "tsukiyo-phone";
  var BAIBAI_EVENTS = ["st-baibai-book:phone-update", "st-baibai-book:changed", "st-baibai-book:ready"];
  var BAIBAI_BRIEF_ARGS = { historyChars: 2400, anchorChars: 1200 };
  var baibaiRuntime = { win: null, settings: () => null, enabled: true, cache: null, cacheAt: 0 };
  function baibaiCandidates(win) {
    const list = [];
    const add = (w) => {
      try {
        if (w && typeof w === "object" && !list.includes(w)) list.push(w);
      } catch {
      }
    };
    add(win);
    add(baibaiRuntime.win);
    if (typeof window !== "undefined") add(window);
    for (const w of list.slice()) {
      try {
        add(w.parent);
      } catch {
      }
      try {
        add(w.top);
      } catch {
      }
    }
    return list;
  }
  function baibaiApi(win = null) {
    if (!baibaiRuntime.enabled) return null;
    for (const w of baibaiCandidates(win)) {
      try {
        const api = w.STBaiBaiBook;
        if (api && api.phone && typeof api.phone.getBrief === "function") return api.phone;
      } catch {
      }
    }
    return null;
  }
  function baibaiPrefs() {
    let cfg = null;
    try {
      cfg = baibaiRuntime.settings();
    } catch {
    }
    const b = cfg && cfg.ui && isObject(cfg.ui.baibai) ? cfg.ui.baibai : {};
    const enabled = baibaiRuntime.enabled && b.enabled !== false;
    return { enabled, brief: enabled && b.brief !== false, push: enabled && b.push !== false, present: enabled && b.present !== false };
  }
  function baibaiInvalidate() {
    baibaiRuntime.cache = null;
    baibaiRuntime.cacheAt = 0;
  }
  function baibaiBrief(win = null, { maxAge = 2500 } = {}) {
    const api = baibaiApi(win);
    if (!api) return null;
    try {
      if (typeof api.isEnabled === "function" && api.isEnabled() === false) return null;
    } catch {
    }
    if (baibaiRuntime.cache && Date.now() - baibaiRuntime.cacheAt < maxAge) return baibaiRuntime.cache;
    try {
      const brief = api.getBrief({ ...BAIBAI_BRIEF_ARGS });
      if (!isObject(brief)) return null;
      baibaiRuntime.cache = brief;
      baibaiRuntime.cacheAt = Date.now();
      return brief;
    } catch (e2) {
      console.warn("[月夜来信] 读取柏宝书简报失败", e2?.message);
      return null;
    }
  }
  function baibaiSplitTime(raw) {
    const s = text(raw, 120);
    if (!s) return { date: "", time: "", clock: "" };
    const m = s.match(/(\d{4})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})\s*日?/);
    if (!m) return { date: "", time: s, clock: s };
    const date = m[1] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[3]).padStart(2, "0");
    const rest = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).replace(/^[\s,，、·]+|[\s,，、·]+$/g, "").trim();
    return { date, time: rest, clock: s };
  }
  function baibaiStory(win = null) {
    if (!baibaiPrefs().brief) return null;
    const brief = baibaiBrief(win);
    if (!brief) return null;
    const t = baibaiSplitTime(brief.time);
    if (!t.clock && !brief.location) return null;
    return { date: t.date, time: text(t.time, 60), clock: t.clock, weekday: text(brief.weekday, 10), place: text(brief.location, 80), present: Array.isArray(brief.presentNpcs) ? brief.presentNpcs.map((n) => text(n, 40)).filter(Boolean) : [] };
  }
  function baibaiPresentFallback(present, win = null) {
    if (Array.isArray(present) && present.length) return present;
    if (!baibaiPrefs().present) return present || [];
    const brief = baibaiBrief(win, { maxAge: 5e3 });
    return brief && Array.isArray(brief.presentNpcs) && brief.presentNpcs.length ? brief.presentNpcs.map((n) => text(n, 40)).filter(Boolean) : present || [];
  }
  var baibaiTail = (v, max) => {
    const s = text(v, 2e5);
    return s.length > max ? "…" + s.slice(-max) : s;
  };
  var baibaiClock = (brief) => [text(brief.time, 60), text(brief.weekday, 10)].filter(Boolean).join(" ");
  function baibaiPlanLine(p) {
    if (!isObject(p)) return "";
    const left = Number.isFinite(p.daysLeft) ? p.daysLeft < 0 ? "已逾期" + -p.daysLeft + "天" : p.daysLeft === 0 ? "就在今天" : "还剩" + p.daysLeft + "天" : "";
    const extra = [p.targetTime ? "目标 " + text(p.targetTime, 40) : "", left].filter(Boolean).join("，");
    const body = text(p.content, 200);
    return body ? (p.kind ? "[" + text(p.kind, 12) + "] " : "") + body + (extra ? "（" + extra + "）" : "") : "";
  }
  function baibaiActorBrief(contact, mainAllowed) {
    if (!baibaiPrefs().brief) return void 0;
    const brief = baibaiBrief();
    if (!brief) return void 0;
    let profile = "";
    try {
      profile = text(baibaiApi()?.getNpcProfile?.(contact.name) || "", 1200);
    } catch {
    }
    const plans = (Array.isArray(brief.plans) ? brief.plans : []).filter((p) => mainAllowed || String(p?.content || "").includes(contact.name)).map(baibaiPlanLine).filter(Boolean).slice(0, 6);
    return { 来源: "柏宝书记忆引擎（只读；与正文冲突时以正文为准）", 剧情时间: baibaiClock(brief), 本人档案: profile || "（柏宝书尚未记录此人）", 相关未了结计划: plans, 近期剧情摘要: mainAllowed ? baibaiTail(brief.history, 1800) : "（本人不在场，不读取主线摘要）", 锚点日记: mainAllowed && brief.anchor && brief.anchor.text ? baibaiTail(brief.anchor.text, 800) : "" };
  }
  function baibaiPlanningBrief() {
    if (!baibaiPrefs().brief) return void 0;
    const brief = baibaiBrief();
    if (!brief) return void 0;
    return { 剧情时间: baibaiClock(brief), 地点: text(brief.location, 80), 在场: Array.isArray(brief.presentNpcs) ? brief.presentNpcs.slice(0, 12) : [], 未了结计划: (Array.isArray(brief.plans) ? brief.plans : []).map(baibaiPlanLine).filter(Boolean).slice(0, 8), 近期剧情摘要: baibaiTail(brief.history, 2e3), 锚点日记: brief.anchor && brief.anchor.text ? baibaiTail(brief.anchor.text, 600) : "", 说明: "来自柏宝书的分层摘要，用于把握时间线与伏笔；与【实际正文】冲突时以正文为准" };
  }
  function baibaiMemoryCandidates(brief, s) {
    const out = [];
    const mention = (t) => ["user", ...s.contacts.filter((c) => c.name && t.includes(c.name)).map((c) => c.id)];
    for (const p of Array.isArray(brief.plans) ? brief.plans : []) {
      const line = baibaiPlanLine(p);
      if (!line) continue;
      out.push({ id: "baibai-plan-" + fingerprint(text(p.content, 200)), kind: "promise", title: text("柏宝书·" + (p.kind || "计划"), 40), text: text(line, 400), audience: mention(line), bb: { kind: "plan", target: text(p.targetTime || "", 40) } });
    }
    if (brief.anchor && brief.anchor.text) {
      const t = text(brief.anchor.text, 1800);
      out.push({ id: "baibai-anchor-" + fingerprint(t), kind: "narrative_fact", title: text("柏宝书·锚点日记 v" + (brief.anchor.version ?? "") + "（第" + (brief.anchor.floor ?? "?") + "层）", 40), text: t, audience: mention(t), bb: { kind: "anchor", version: Number(brief.anchor.version) || 0 } });
    }
    const lines = String(brief.history || "").split(/\n+/).map((l) => text(l, 400)).filter((l) => l.length >= 12).slice(-10);
    for (const l of lines) out.push({ id: "baibai-hist-" + fingerprint(l), kind: "narrative_fact", title: "柏宝书·剧情摘要", text: l, audience: mention(l), bb: { kind: "history" } });
    return out;
  }
  function baibaiNormalizeUrl(url) {
    const u = text(url, 500).replace(/\/+$/, "");
    if (!u) return u;
    if (/\/chat\/completions$/i.test(u)) return u.replace(/\/chat\/completions$/i, "");
    if (/^https?:\/\/[^/?#]+$/i.test(u)) return u + "/v1";
    return u;
  }
  var notBaibai = (m) => !m.bb;
  var BaiBaiLink = class {
    constructor(eng) {
      this.eng = eng;
      this.timer = null;
      this.offs = [];
      this.busy = false;
      this.lastSig = "";
      this.last = { at: 0, ok: null, message: "", added: 0, updated: 0 };
      baibaiRuntime.win = eng.win;
      baibaiRuntime.enabled = eng.bridge.mode !== "demo";
      baibaiRuntime.settings = () => eng.settings.data;
    }
    status() {
      const prefs = baibaiPrefs(), api = baibaiApi();
      if (!baibaiRuntime.enabled) return { connected: false, text: "离线演示不连接柏宝书", prefs };
      if (!prefs.enabled) return { connected: !!api, text: api ? "已检测到柏宝书，但联动已关闭" : "联动已关闭", prefs };
      if (!api) return { connected: false, text: "未检测到柏宝书（需要 ST-BaiBai-Book 融合版 ≥1.3.0，并在其设置里开启“小手机联动”）", prefs };
      const brief = baibaiBrief();
      const parts = ["已连接"];
      if (brief) {
        if (brief.pluginVersion) parts.push("柏宝书 v" + text(brief.pluginVersion, 20));
        if (brief.time) parts.push(text(brief.time, 40));
        parts.push("外部记录 " + (Number(brief.externalCount) || 0) + " 条");
      } else parts.push("简报暂不可用（柏宝书可能关闭了联动）");
      if (this.last.at) parts.push((this.last.ok ? "上次回写成功" : "上次回写失败") + " · " + new Date(this.last.at).toLocaleTimeString("zh-CN", { hour12: false }));
      return { connected: true, text: parts.join(" · "), prefs, brief };
    }
    start() {
      if (!baibaiRuntime.enabled) return;
      this.offs.push(this.eng.repo.on((ev) => {
        if (ev.type === "save") this.schedule(2500);
      }));
      const win = this.eng.win, handler = (ev) => {
        baibaiInvalidate();
        const d = ev?.detail;
        if (ev?.type === "st-baibai-book:phone-update" && d && d.type === "external" && d.source === BAIBAI_SOURCE) return;
        clearTimeout(this.eng.debounce);
        this.eng.debounce = setTimeout(() => this.eng.refresh(), 600);
        this.eng.emit("status");
      };
      for (const name of BAIBAI_EVENTS) {
        try {
          win.addEventListener(name, handler);
          this.offs.push(() => win.removeEventListener(name, handler));
        } catch {
        }
      }
      this.schedule(4e3);
    }
    stop() {
      clearTimeout(this.timer);
      for (const off of this.offs) try {
        off();
      } catch {
      }
      this.offs = [];
    }
    schedule(ms) {
      if (!baibaiPrefs().push) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.push().catch(() => {
      }), ms);
    }
    notes(s, snap) {
      const rows = [], me = snap.userName || "玩家";
      const name = (uid) => uid === "user" ? me : s.contacts.find((c) => c.id === uid)?.name || "未知人物";
      const floor = Number.isInteger(snap.floor) ? snap.floor : void 0;
      const msgs = [];
      for (const t of s.threads) for (const m of t.messages.slice(-8)) msgs.push({ t, m });
      msgs.sort((a, b) => (a.m.ts || 0) - (b.m.ts || 0));
      for (const { t, m } of msgs.slice(-20)) {
        const scope = t.kind === "direct" ? "私聊" : "群聊「" + text(t.title, 30) + "」";
        const to = t.kind === "direct" ? m.author === "user" ? name(t.members[0]) : me : "群内";
        const body = m.kind && m.kind !== "text" ? "[" + text(m.kind, 10) + "] " + text(m.text, 300) : text(m.text, 300);
        if (!body) continue;
        rows.push({ id: "msg:" + m.id, kind: "phone_chat", title: scope + " · " + name(m.author), text: name(m.author) + "→" + to + "：" + body + (m.role === "character" && !m.read ? "（玩家尚未读）" : ""), time: text(m.story, 60) || void 0, floor });
      }
      for (const a of s.agenda.filter((x) => ["proposed", "confirmed"].includes(x.status)).slice(-10)) {
        const when = a.date ? text(a.date, 10) + (a.time ? " " + text(a.time, 5) : "") : "";
        rows.push({ id: "agenda:" + a.id, kind: "phone_agenda", title: "手机约定 · " + (a.status === "confirmed" ? "已确认" : "待确认"), text: text(a.title, 160) + "（" + (a.status === "confirmed" ? "已确认" : "待确认") + "）" + (when ? " · " + when : "") + " · 参与：" + (a.members || []).map(name).join("、") + (a.note ? " · " + text(a.note, 120) : ""), time: when || void 0, floor, pinned: true });
      }
      for (const p of s.feed.slice(-3)) {
        const body = text(p.text, 240);
        if (body) rows.push({ id: "feed:" + p.id, kind: "phone_moment", title: "动态 · " + name(p.author), text: name(p.author) + " 发了动态：" + body, floor });
      }
      for (const m of s.memories.filter((x) => x.kind === "promise" && !x.resolved && x.enabled !== false && !x.bb).slice(-6)) rows.push({ id: "promise:" + m.id, kind: "phone_promise", title: "未完约定", text: text(m.text, 300) + "（知情：" + m.audience.map(name).join("、") + "）", floor, pinned: true });
      return rows;
    }
    async push({ force = false } = {}) {
      if (!baibaiPrefs().push && !force) return null;
      const api = baibaiApi(), s = this.eng.repo.data, snap = this.eng.repo.snapshot;
      if (!api || !s || !snap || this.busy) return null;
      this.busy = true;
      try {
        const rows = this.notes(s, snap);
        const sig = fingerprint(rows.map((r) => [r.id, r.text]));
        if (!force && sig === this.lastSig) return null;
        const existing = /* @__PURE__ */ new Map();
        try {
          for (const n of api.listNotes?.(BAIBAI_SOURCE) || []) existing.set(n.id, n);
        } catch {
        }
        const fresh = rows.filter((r) => {
          const prev = existing.get(r.id);
          return !prev || prev.text !== r.text || (prev.title || "") !== (r.title || "");
        }).map((r) => {
          const prev = existing.get(r.id);
          return prev && Number.isInteger(prev.floor) ? { ...r, floor: prev.floor } : r;
        });
        this.lastSig = sig;
        if (!fresh.length) return { added: 0, updated: 0, total: existing.size };
        const r = api.pushNotes(BAIBAI_SOURCE, fresh);
        this.last = { at: Date.now(), ok: true, message: "", added: Number(r?.added) || 0, updated: Number(r?.updated) || 0 };
        baibaiInvalidate();
        this.eng.emit("status");
        return r;
      } catch (e2) {
        this.last = { at: Date.now(), ok: false, message: text(e2?.message || e2, 200), added: 0, updated: 0 };
        this.eng.emit("status");
        throw e2;
      } finally {
        this.busy = false;
      }
    }
  };

