  // src/services/baibai-bridge.js
  // 百宝月夜书（ST-BaiBai-Book-Tsukiyo ≥1.3.0）联动：只读其公开 API，不触碰其内部数据；手机的一切改动都留在手机。
  var BAIBAI_SOURCE = "tsukiyo-phone";
  var BAIBAI_EVENTS = ["st-baibai-book:phone-update", "st-baibai-book:changed", "st-baibai-book:ready"];
  var BAIBAI_BRIEF_ARGS = { anchorChars: 1200 };
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
  function baibaiReadEnabled() {
    if (!baibaiPrefs().brief) return false;
    const api = baibaiApi();
    try { return !!api && (typeof api.isEnabled !== "function" || api.isEnabled()) && (typeof api.canReadMemory !== "function" || api.canReadMemory()); }
    catch { return false; }
  }
  function baibaiBrief(win = null, { maxAge = 2500 } = {}) {
    if (!baibaiReadEnabled()) { baibaiInvalidate(); return null; }
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
  function baibaiActorBrief(contact, mainAllowed, { social = false, group = false } = {}) {
    const brief = baibaiBrief();
    if (!brief) return void 0;
    // 未标注知情人的计划不凭姓名猜权限。公开动态/群聊不加入整份私密摘要。
    const privateAllowed = !!mainAllowed && !social && !group;
    const npc = (brief.npcs || []).find(n => n.name === contact.name);
    let profile = npc ? { 姓名: npc.name, 称呼: text(npc.title, 80), 性格: text(npc.personality, 200) } : "（暂无本人资料）";
    if (privateAllowed) {
      try { profile = text(baibaiApi()?.getNpcProfile?.(contact.name) || "", 1200) || profile; } catch {}
    }
    return { 来源: "柏宝书记忆（只读参考，不强制采用，不代表已公开或人人知情）", 剧情时间: baibaiClock(brief), 本人档案: profile,
      相关未了结计划: privateAllowed ? (brief.plans || []).map(baibaiPlanLine).filter(Boolean).slice(0, 6) : [],
      近期剧情摘要: privateAllowed ? baibaiTail(brief.history, 1800) : "（未授权或公开/群聊场景，不读取全局剧情摘要）",
      锚点日记: privateAllowed && brief.anchor ? baibaiTail(brief.anchor.text, 800) : "",
      本人生活细节: privateAllowed ? (brief.lifeDetails || []).filter(d => d.subject === contact.name).slice(0, 8).map(d => text(d.text, 160)) : [],
      说明: "摘要是叙事参考，不是本人自动获知的事实。只使用亲历或明确获知的部分；群聊和公开动态不补入私聊秘密。" };
  }
  function baibaiPlanningBrief() {
    const brief = baibaiBrief();
    if (!brief) return void 0;
    return { 来源: "柏宝书记忆·实时只读", 剧情时间: baibaiClock(brief), 地点: text(brief.location, 80),
      在场: (brief.presentNpcs || []).slice(0, 12), 未了结计划: (brief.plans || []).map(baibaiPlanLine).filter(Boolean).slice(0, 8),
      近期剧情摘要: baibaiTail(brief.history, 2400), 锚点日记: brief.anchor ? baibaiTail(brief.anchor.text, 800) : "",
      人物档案: (brief.npcs || []).slice(0, 12).map(n => ({ 姓名: n.name, 称呼: text(n.title, 80), 关系: text(n.relation, 100), 近况: text(n.condition, 120) })),
      物品: (brief.items || []).slice(0, 15).map(i => ({ 名称: text(i.name, 80), 数量: i.qty, 所在: text(i.location, 80) })),
      生活细节: (brief.lifeDetails || []).slice(0, 12).map(d => ({ 主语: text(d.subject, 40), 内容: text(d.text, 160) })),
      说明: "可参考而非必须使用；以当前正文为准。计划不等于已发生，摘要不能替代逐字原文证据；不要凭提及姓名推断知情人。" };
  }
  // 每次生成重新读当前简报；过滤只发生在请求副本，不删除用户手机存档。
  function baibaiFilterInput(data) {
    baibaiInvalidate();
    if (!baibaiReadEnabled()) data.memories = (data.memories || []).filter(m => !m.bb);
    return data;
  }
  function baibaiEnrichRequest(module, request) {
    if (!baibaiReadEnabled()) return request;
    const payload = request.payload;
    if (!isObject(payload)) return request;
    // 聊天/主动来信/朋友圈由 actorContext 按人构建，不能再追加全知简报。
    // 多人角色日记同样只使用各自角色资料中的参考。
    if (["planner", "memory", "diary"].includes(module) && !payload.写日记的角色 && !payload.柏宝书) {
      payload.柏宝书记忆参考 = baibaiPlanningBrief();
    }
    request.system += "\n柏宝书记忆是可选背景，不必强行套用；角色只采用本人已知事实，未执行计划不得写成完成。整理记忆或核对进度时，仍须满足原任务指定的消息ID/正文楼层/逐字引文证据，不能拿简报冒充原文。";
    return request;
  }
  function baibaiMemoryCard() {
    return `<div class="card"><h3>柏宝书 · 实时记忆参考</h3><p class="tiny muted">${baibaiReadEnabled() ? "读取已开启：生成时参考最新记忆，不必重复导入；公开动态与群聊不读取全局私密摘要。" : "读取已关闭或未连接：手机使用自身上下文。开启需要两边的读取开关均允许。"}</p><div class="buttons">${button("切换记忆读取", "baibai-brief")}${button("查看当前参考", "baibai-preview-memory")}</div></div>`;
  }
  function baibaiMemoryCandidates(brief, s) {
    const out = [];
    const mention = (_t) => ["user"]; // 导入副本默认仅玩家可见；知情人须由用户明确设置
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
      if (!api) return { connected: false, text: "未检测到百宝月夜书（需 ≥1.3.0，并在其「联动」页开启小手机联动）", prefs };
      const brief = baibaiBrief();
      const parts = ["已连接"];
      if (brief) {
        if (brief.pluginVersion) parts.push("百宝月夜书 v" + text(brief.pluginVersion, 20));
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
      for (const a of s.agenda) {
        const active = ["proposed", "confirmed"].includes(a.status);
        const status = ({ proposed: "待确认", confirmed: "已确认", cancelled: "已取消", canceled: "已取消", done: "已完成", completed: "已完成", declined: "已拒绝", expired: "已过期" })[a.status] || "已结束";
        const when = a.date ? text(a.date, 10) + (a.time ? " " + text(a.time, 5) : "") : "";
        rows.push({ id: "agenda:" + a.id, kind: "phone_agenda", title: "手机约定 · " + status, text: text(a.title, 160) + "（" + status + "）" + (when ? " · " + when : "") + " · 参与：" + (a.members || []).map(name).join("、") + (a.note ? " · " + text(a.note, 120) : ""), time: when || void 0, floor, pinned: active });
      }
      for (const p of s.feed.slice(-3)) {
        const body = text(p.text, 240);
        if (body) rows.push({ id: "feed:" + p.id, kind: "phone_moment", title: "动态 · " + name(p.author), text: name(p.author) + " 发了动态：" + body, floor });
      }
      for (const m of s.memories.filter((x) => x.kind === "promise" && !x.bb)) {
        const active = !m.resolved && m.enabled !== false;
        const status = m.enabled === false ? "已停用" : m.resolved ? "已完成" : "未完约定";
        rows.push({ id: "promise:" + m.id, kind: "phone_promise", title: status, text: "（" + status + "）" + text(m.text, 300) + "（知情：" + m.audience.map(name).join("、") + "）", floor, pinned: active });
      }
      return rows;
    }
    async push({ force = false } = {}) {
      if (!baibaiPrefs().push) return null;
      const api = baibaiApi(), s = this.eng.repo.data, snap = this.eng.repo.snapshot;
      if (!api || !s || !snap || this.busy || (typeof api.isEnabled === "function" && !api.isEnabled())) return null;
      this.busy = true;
      try {
        const rows = this.notes(s, snap);
        const sig = fingerprint([snap.owner || "", rows.map((r) => [r.id, r.title, r.text, !!r.pinned])]);
        if (!force && sig === this.lastSig) return null;
        const existing = /* @__PURE__ */ new Map();
        try {
          for (const n of api.listNotes?.(BAIBAI_SOURCE) || []) existing.set(n.id, n);
        } catch {
        }
        // 日程/约定是完整状态集合：只有明确消失的事项才写结束标记，绝不清理消息/动态历史窗口。
        const agendaIds = new Set(s.agenda.map((a) => "agenda:" + a.id));
        const promiseIds = new Set(s.memories.filter((m) => m.kind === "promise" && !m.bb).map((m) => "promise:" + m.id));
        for (const prev of existing.values()) {
          const missing = prev.kind === "phone_agenda" && prev.id.startsWith("agenda:") && !agendaIds.has(prev.id)
            || prev.kind === "phone_promise" && prev.id.startsWith("promise:") && !promiseIds.has(prev.id);
          if (missing && prev.pinned) rows.push({ id: prev.id, kind: prev.kind, title: "已移除事项", text: "（手机中已移除，不再是有效约定）" + text(prev.text, 350), floor: prev.floor, pinned: false });
        }
        const fresh = rows.filter((r) => {
          const prev = existing.get(r.id);
          return !prev || prev.text !== r.text || (prev.title || "") !== (r.title || "") || !!prev.pinned !== !!r.pinned;
        }).map((r) => {
          const prev = existing.get(r.id);
          return prev && Number.isInteger(prev.floor) ? { ...r, floor: prev.floor } : r;
        });
        if (!fresh.length) { this.lastSig = sig; return { added: 0, updated: 0, total: existing.size }; }
        const r = await api.pushNotes(BAIBAI_SOURCE, fresh);
        if (this.eng.repo.data !== s || this.eng.repo.snapshot !== snap || !baibaiPrefs().push) return r;
        this.lastSig = sig;
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

