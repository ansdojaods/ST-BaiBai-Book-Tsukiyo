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
  function heartPrefs() {
    let cfg = null;
    try {
      cfg = baibaiRuntime.settings();
    } catch {
    }
    const h = cfg && cfg.ui && isObject(cfg.ui.heartTrace) ? cfg.ui.heartTrace : {};
    const autoMode = ["baibai_main", "present", "pinned"].includes(h.autoMode) ? h.autoMode : "baibai_main";
    const maxPerFloor = Math.min(4, Math.max(1, Math.trunc(Number(h.maxPerFloor) || 2)));
    const pinnedIds = Array.isArray(h.pinnedIds) ? h.pinnedIds.filter((x) => typeof x === "string" && x) : [];
    return {
      autoEveryFloor: h.autoEveryFloor === true,
      autoMode,
      maxPerFloor,
      pinnedIds,
      syncToBaibai: h.syncToBaibai !== false
    };
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
    const privateAllowed = !!mainAllowed && !social && !group;
    const npc = (brief.npcs || []).find((n) => nameKey(n.name) === nameKey(contact.name));
    let profile = npc ? { 姓名: npc.name, 称呼: text(npc.title, 80), 性格: text(npc.personality, 200), 关系: text(npc.relation, 100), 好感状态: text(npc.affinityText, 120) } : "（暂无本人资料）";
    if (privateAllowed) {
      try { profile = text(baibaiApi()?.getNpcProfile?.(contact.name) || "", 1200) || profile; } catch {}
    }
    return { 来源: "柏宝书记忆（只读参考，不强制采用，不代表已公开或人人知情）", 剧情时间: baibaiClock(brief), 本人档案: profile,
      好感与关系: npc ? { 关系: text(npc.relation, 100), 纽带: text(npc.ties, 120), 好感: text(npc.affinityText, 120), 好感备注: privateAllowed ? text(npc.affinityNote, 160) : "" } : void 0,
      相关未了结计划: privateAllowed ? (brief.plans || []).map(baibaiPlanLine).filter(Boolean).slice(0, 6) : [],
      近期剧情摘要: privateAllowed ? baibaiTail(brief.history, 1800) : "（未授权或公开/群聊场景，不读取全局剧情摘要）",
      锚点日记: privateAllowed && brief.anchor ? baibaiTail(brief.anchor.text, 800) : "",
      本人生活细节: privateAllowed ? (brief.lifeDetails || []).filter((d) => nameKey(d.subject) === nameKey(contact.name)).slice(0, 8).map((d) => text(d.text, 160)) : [],
      说明: "摘要是叙事参考，不是本人自动获知的事实。只使用亲历或明确获知的部分；群聊和公开动态不补入私聊秘密。" };
  }
  function baibaiPlanningBrief() {
    const brief = baibaiBrief();
    if (!brief) return void 0;
    return { 来源: "柏宝书记忆·实时只读", 剧情时间: baibaiClock(brief), 地点: text(brief.location, 80),
      在场: (brief.presentNpcs || []).slice(0, 12), 未了结计划: (brief.plans || []).map(baibaiPlanLine).filter(Boolean).slice(0, 8),
      近期剧情摘要: baibaiTail(brief.history, 2400), 锚点日记: brief.anchor ? baibaiTail(brief.anchor.text, 800) : "",
      人物档案: (brief.npcs || []).slice(0, 12).map((n) => ({ 姓名: n.name, 称呼: text(n.title, 80), 关系: text(n.relation, 100), 好感: text(n.affinityText, 120), 主要角色: !!n.important, 近况: text(n.condition, 120) })),
      物品: (brief.items || []).slice(0, 15).map((i) => ({ 名称: text(i.name, 80), 数量: i.qty, 所在: text(i.location, 80) })),
      生活细节: (brief.lifeDetails || []).slice(0, 12).map((d) => ({ 主语: text(d.subject, 40), 内容: text(d.text, 160) })),
      说明: "可参考而非必须使用；以当前正文为准。计划不等于已发生，摘要不能替代逐字原文证据；不要凭提及姓名推断知情人。" };
  }
  function baibaiFilterInput(data) {
    baibaiInvalidate();
    if (!baibaiReadEnabled()) data.memories = (data.memories || []).filter((m) => !m.bb);
    return data;
  }
  function baibaiEnrichRequest(module, request) {
    if (!baibaiReadEnabled()) return request;
    const payload = request.payload;
    if (!isObject(payload)) return request;
    if (["planner", "memory", "diary"].includes(module) && !payload.写日记的角色 && !payload.心迹角色 && !payload.柏宝书) {
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
    const mention = (_t) => ["user"];
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

  // ===== 恋爱心迹（每楼层角色心声 · 联动百宝月夜书主要配角） =====
  function baibaiMainNpcsForHeart(s, snap) {
    const brief = baibaiBrief(null, { maxAge: 1500 });
    const presentSet = new Set((snap?.present || []).map(nameKey));
    const rawList = Array.isArray(brief?.mainNpcs) && brief.mainNpcs.length
      ? brief.mainNpcs
      : Array.isArray(brief?.npcs)
        ? [...brief.npcs].sort((a, b) => (Number(!!b.important) - Number(!!a.important)) || (Number(!!b.present) - Number(!!a.present)) || ((b.affinityInner ?? -999) - (a.affinityInner ?? -999)))
        : [];
    const seen = new Set();
    const out = [];
    for (const n of rawList) {
      const k = nameKey(n?.name || "");
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const c = s?.contacts?.find((x) => nameKey(x.name) === k);
      out.push({
        name: text(n.name, 40),
        contactId: c?.id || "",
        inContacts: !!c,
        important: !!n.important,
        present: !!n.present || presentSet.has(k),
        title: text(n.title, 80),
        relation: text(n.relation, 100),
        ties: text(n.ties, 120),
        personality: text(n.personality, 200),
        desc: text(n.desc, 260),
        condition: text(n.condition, 120),
        location: text(n.location, 80),
        affinityInner: Number.isFinite(n.affinityInner) ? n.affinityInner : null,
        affinityOuter: Number.isFinite(n.affinityOuter) ? n.affinityOuter : null,
        affinityText: text(n.affinityText, 120),
        affinityNote: text(n.affinityNote, 160)
      });
    }
    return { brief, list: out };
  }
  function syncBaibaiMainNpcsToContacts(s, brief = null, { onlyImportantOrPresent = false } = {}) {
    const b = brief || baibaiBrief(null, { maxAge: 0 });
    if (!b || !s) return { added: [], updated: 0 };
    const candidates = Array.isArray(b.mainNpcs) && b.mainNpcs.length ? b.mainNpcs : Array.isArray(b.npcs) ? b.npcs : [];
    const removedNames = new Set((s.removedContacts || []).map((r) => nameKey(r.name)));
    const colors = ["rose", "sage", "amber", "blue"];
    const added = [];
    let updated = 0;
    for (let i = 0; i < candidates.length; i++) {
      const n = candidates[i];
      const nm = text(n?.name, 40);
      if (!nm) continue;
      const isMain = !!n.important || !!n.present || Number.isFinite(n.affinityInner) || !!n.relation;
      if (onlyImportantOrPresent && !isMain) continue;
      const k = nameKey(nm);
      const existing = s.contacts.find((c) => nameKey(c.name) === k);
      const bioParts = [
        n.title ? "身份/称呼：" + text(n.title, 80) : "",
        n.relation ? "与玩家关系：" + text(n.relation, 100) : "",
        n.ties ? "关系纽带：" + text(n.ties, 120) : "",
        n.affinityText ? "好感状态：" + text(n.affinityText, 120) : "",
        n.personality ? "性格：" + text(n.personality, 240) : "",
        n.desc ? "设定：" + text(n.desc, 400) : ""
      ].filter(Boolean).join("\n");
      if (existing) {
        if (!existing.bio && bioParts) {
          existing.bio = text(bioParts, 12e3);
          updated++;
        }
        if (n.condition && (!existing.status || existing.status === "最近有自己的事在忙")) {
          existing.status = text(n.condition, 240);
          updated++;
        }
        continue;
      }
      if (removedNames.has(k) || s.contacts.length >= 200) continue;
      try {
        const c = addContact(s, {
          name: nm,
          bio: bioParts || "百宝月夜书联动角色",
          status: text(n.condition || n.location || (n.relation ? "关系：" + n.relation : "百宝书主要角色"), 240),
          recognized: true,
          reachable: true,
          color: colors[i % colors.length],
          source: "manual",
          allowNarrative: true,
          proactive: true
        });
        added.push(c);
      } catch {
      }
    }
    return { added, updated };
  }
  function collectFloorContext(bridge, snap, requestedFloor) {
    let raw = [];
    try {
      raw = bridge.context()?.chat || [];
    } catch {
    }
    const floors = [];
    if (Array.isArray(raw) && raw.length) {
      for (let i = 0; i < raw.length; i++) {
        const m = raw[i];
        if (!m || m.is_system || m.extra?.isSmallSys || m.is_user) continue;
        const clean = cleanNarrative(m.mes ?? m.message ?? "");
        if (!clean) continue;
        floors.push({ floor: i, name: m.name || snap?.character?.name || "角色", text: clean });
      }
    }
    if (!floors.length && Array.isArray(snap?.history)) {
      for (const h of snap.history) {
        if (h.role === "assistant" && h.text) floors.push({ floor: h.floor, name: h.name || "角色", text: h.text });
      }
    }
    const latestFloor = floors.length ? floors[floors.length - 1].floor : (snap?.floor ?? 0);
    const targetFloor = Number.isInteger(Number(requestedFloor)) && requestedFloor !== "" && requestedFloor !== null && requestedFloor !== void 0
      ? Number(requestedFloor)
      : latestFloor;
    let targetAi = floors.find((f) => f.floor === targetFloor) || floors[floors.length - 1] || { floor: targetFloor, name: snap?.character?.name || "正文", text: "" };
    let prevUser = "";
    if (Array.isArray(raw) && raw.length && targetAi.floor > 0 && targetAi.floor < raw.length) {
      for (let j = targetAi.floor - 1; j >= Math.max(0, targetAi.floor - 3); j--) {
        if (raw[j]?.is_user) {
          prevUser = cleanNarrative(raw[j].mes ?? raw[j].message ?? "");
          break;
        }
      }
    } else if (Array.isArray(snap?.history)) {
      const idx = snap.history.findIndex((h) => h.floor === targetAi.floor);
      if (idx > 0 && snap.history[idx - 1]?.role === "user") prevUser = snap.history[idx - 1].text;
    }
    const recentTurns = [];
    if (Array.isArray(raw) && raw.length) {
      for (let j = Math.max(0, targetAi.floor - 4); j <= Math.min(raw.length - 1, targetAi.floor); j++) {
        const m = raw[j];
        if (!m || m.is_system || m.extra?.isSmallSys) continue;
        const t = cleanNarrative(m.mes ?? m.message ?? "");
        if (t) recentTurns.push({ floor: j, role: m.is_user ? "user" : "assistant", name: m.name || (m.is_user ? (snap?.userName || "玩家") : "角色"), text: text(t, 1200) });
      }
    } else {
      for (const h of (snap?.history || []).slice(-4)) recentTurns.push({ floor: h.floor, role: h.role, name: h.name, text: text(h.text, 1200) });
    }
    return {
      floors: floors.slice(-30),
      targetFloor: targetAi.floor,
      targetText: text(targetAi.text, 2600),
      prevUserText: text(prevUser, 900),
      recentTurns
    };
  }
  function heartTracesFrom(raw, chosen, floor, brief) {
    const body = parseModelJson(raw, 5e4);
    const list = Array.isArray(body.traces) ? body.traces : Array.isArray(body.entries) ? body.entries : body.title || body.text ? [body] : [];
    assert(list.length, "恋爱心迹生成需要 traces 数组");
    const npcs = brief?.npcs || [];
    return list.slice(0, 6).map((x) => {
      assert(isObject(x) && text(x.text, 6e3), "恋爱心迹缺少正文内容");
      const rawName = text(x.author, 40);
      const author = chosen.find((a) => a.name === rawName || a.id === rawName || nameKey(a.name) === nameKey(rawName))
        || (chosen.length === 1 ? chosen[0] : chosen.find((a) => rawName.includes(a.name) || a.name.includes(rawName)));
      assert(author, "恋爱心迹角色不在所选列表中：" + rawName);
      const bbNpc = npcs.find((n) => nameKey(n.name) === nameKey(author.name));
      return {
        kind: "heart",
        floor: Number.isInteger(floor) ? floor : 0,
        author: author.id,
        authorName: author.name,
        title: text(x.title || (author.name + "的心迹"), 80),
        mood: text(x.mood || "心动", 24),
        heartbeat: text(x.heartbeat || "", 36),
        stage: text(x.stage || bbNpc?.relation || "", 48),
        surface: text(x.surface || "", 240),
        replyToFloor: text(x.replyToFloor || "", 400),
        text: text(x.text, 6e3),
        secret: text(x.secret || "", 260),
        affinitySnap: text(bbNpc?.affinityText || "", 120),
        followups: []
      };
    });
  }
  function pickAutoHeartContacts(s, snap) {
    const hp = heartPrefs();
    const { brief, list: bbMain } = baibaiMainNpcsForHeart(s, snap);
    if (brief) syncBaibaiMainNpcsToContacts(s, brief, { onlyImportantOrPresent: true });
    const available = s.contacts.filter((c) => c.age === null || c.age >= 12);
    if (!available.length) return [];
    let picked = [];
    if (hp.autoMode === "pinned" && hp.pinnedIds.length) {
      picked = available.filter((c) => hp.pinnedIds.includes(c.id));
    }
    if (!picked.length && hp.autoMode === "baibai_main" && bbMain.length) {
      const mainNames = bbMain.filter((n) => n.important || n.present || n.affinityInner !== null).map((n) => nameKey(n.name));
      picked = available.filter((c) => mainNames.includes(nameKey(c.name)));
      picked.sort((a, b) => mainNames.indexOf(nameKey(a.name)) - mainNames.indexOf(nameKey(b.name)));
    }
    if (!picked.length) {
      const pres = new Set((snap?.present || []).map(nameKey));
      picked = available.filter((c) => pres.has(nameKey(c.name)));
    }
    if (!picked.length && bbMain.length) {
      const anyNames = bbMain.map((n) => nameKey(n.name));
      picked = available.filter((c) => anyNames.includes(nameKey(c.name)));
    }
    if (!picked.length) {
      const lastFloorText = snap?.history?.at(-1)?.text || "";
      picked = available.filter((c) => lastFloorText.includes(c.name));
    }
    if (!picked.length) picked = available.slice(0, 1);
    return picked.slice(0, hp.maxPerFloor).map((c) => c.id);
  }
  function renderHeartTracePanel(ui) {
    const s = ui.data, snap = ui.snapshot, hp = heartPrefs();
    const { brief, list: mainNpcs } = baibaiMainNpcsForHeart(s, snap);
    const curFloor = Number.isInteger(snap?.floor) ? snap.floor : 0;
    const pinnedNames = hp.pinnedIds.map((id2) => contactName(s, id2)).filter((n) => n && n !== "未知联系人");
    return `<div class="card heart-panel">
      <div class="row-top">
        <div class="heart-panel-title"><span class="heart-badge-icon">${icon("heart", 15)}</span><b>恋爱心迹 · 每楼层角色心声</b></div>
        <span>${tag("当前 #" + (curFloor + 1) + " 楼", "rose")} ${brief ? tag("百宝书联动 · " + mainNpcs.length + " 人", "gold") : tag("独立模式")}</span>
      </div>
      <p class="tiny muted" style="margin-top:5px">紧贴每一楼层正文互动，剖析角色当下的表面伪装、心底回应、悸动独白与未说出口的小秘密；自动联动百宝月夜书的主要配角、好感度与人物记忆。</p>
      <div class="buttons" style="margin-top:10px">
        ${button(icon("heart", 14) + " 一键生成本楼心迹", "quick-heart-baibai", "", "primary")}
        ${button(icon("spark", 14) + " 选楼层 / 选角色…", "generate-heart-trace")}
        ${brief ? button(icon("people", 14) + " 同步百宝书主要配角", "heart-sync-baibai") : ""}
      </div>
      ${mainNpcs.length ? `<div class="heart-npc-strip"><small class="muted">百宝书主要配角（点名字立即生成 ta 在 #${curFloor + 1} 楼的恋爱心迹）：</small><div class="heart-npc-pills">${mainNpcs.slice(0, 10).map((n) => `<button type="button" class="heart-npc-pill ${n.present ? "is-present" : ""} ${n.important ? "is-main" : ""}" data-action="quick-heart-npc" data-id="${e(n.name)}" title="${e([n.relation, n.affinityText, n.condition].filter(Boolean).join(" · "))}"><b>${e(n.name)}</b>${n.present ? `<i class="pill-tag">在场</i>` : n.important ? `<i class="pill-tag gold">主配</i>` : ""}${n.affinityText ? `<span>${e(n.affinityText.replace(/^内心好感:/, "♥ "))}</span>` : n.relation ? `<span>${e(n.relation)}</span>` : ""}</button>`).join("")}</div></div>` : ""}
      <div class="divider" style="margin:10px 0 6px"></div>
      ${switchRow("每楼层回复自动生成恋爱心迹", "酒馆每次生成新楼层后，自动为所选范围的主要配角写下本楼恋爱心迹", "heart-auto-toggle", hp.autoEveryFloor)}
      <div class="heart-auto-bar">
        <span class="tiny muted">自动联动对象：</span>
        <button type="button" class="chip ${hp.autoMode === "baibai_main" ? "active" : ""}" data-action="heart-auto-mode" data-id="baibai_main">百宝书主要配角</button>
        <button type="button" class="chip ${hp.autoMode === "present" ? "active" : ""}" data-action="heart-auto-mode" data-id="present">当前在场角色</button>
        <button type="button" class="chip ${hp.autoMode === "pinned" ? "active" : ""}" data-action="heart-auto-mode" data-id="pinned">固定关注${pinnedNames.length ? " (" + pinnedNames.length + ")" : ""}</button>
        <button type="button" class="chip" data-action="heart-pick-pinned">设置关注 / 人数（每楼≤${hp.maxPerFloor}人）</button>
      </div>
    </div>`;
  }
  function renderHeartCard(ui, d) {
    const s = ui.data;
    const who = !d.author || d.author === "user" ? "我" : contactName(s, d.author) !== "未知联系人" ? contactName(s, d.author) : (d.authorName || "角色");
    const c = s.contacts.find((x) => x.id === d.author);
    const floorLabel = Number.isInteger(d.floor) ? "#" + (d.floor + 1) + "楼" : "当层";
    return `<article class="card heart-card">
      <div class="row-top">
        <div style="display:flex;align-items:center;gap:8px">
          ${avatar(c, "small")}
          <div>
            <b style="font-size:13px">${e(who)}</b>
            <small style="display:block">${e(d.date || new Date(d.ts).toLocaleDateString("zh-CN"))} · ${e(floorLabel)}</small>
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
          ${tag("恋爱心迹 · " + floorLabel, "rose")}
          ${d.mood ? tag(d.mood, "gold") : ""}
          ${d.heartbeat ? tag("♥ " + d.heartbeat, "rose") : ""}
        </div>
      </div>
      ${d.stage || d.affinitySnap ? `<div class="heart-meta-strip">${d.stage ? `<span>关系心境：<b>${e(d.stage)}</b></span>` : ""}${d.affinitySnap ? `<span>百宝书好感：<b>${e(d.affinitySnap)}</b></span>` : ""}</div>` : ""}
      <h3 class="heart-title">${e(d.title)}</h3>
      ${d.surface ? `<div class="heart-box surface"><b>【本楼表面装作】</b><p>${e(d.surface)}</p></div>` : ""}
      ${d.replyToFloor ? `<div class="heart-box reply"><b>【心底回应 · 致本楼的你】</b><p>${e(d.replyToFloor)}</p></div>` : ""}
      <div class="heart-body"><p>${e(d.text)}</p></div>
      ${d.secret ? `<div class="heart-secret"><span>♥ 未说出口的小秘密：</span>${e(d.secret)}</div>` : ""}
      ${Array.isArray(d.followups) && d.followups.length ? `<div class="heart-followups">${d.followups.map((f) => `<div class="heart-followup-item"><div class="hf-q"><b>你追问/回应：</b>${e(f.q)}</div><div class="hf-a"><b>${e(who)}心底回音${f.mood ? "（" + e(f.mood) + "）" : ""}：</b>${e(f.a)}</div></div>`).join("")}</div>` : ""}
      <div class="buttons" style="margin-top:10px">
        ${button(icon("heart", 13) + " 回应 / 追问心迹", "heart-followup", d.id, "primary")}
        ${button(icon("edit", 13) + " 编辑", "edit-diary", d.id)}
        ${button(icon("trash", 13) + " 删除", "delete-diary", d.id, "danger")}
      </div>
    </article>`;
  }
  function renderDiaryEntryCard(ui, d) {
    if (d.kind === "heart") return renderHeartCard(ui, d);
    const s = ui.data;
    const who = !d.author || d.author === "user" ? "我" : contactName(s, d.author) !== "未知联系人" ? contactName(s, d.author) : (d.authorName || "角色");
    return `<div class="card"><div class="row-top"><div class="eyebrow">${e(who)} · ${e(d.date || "未注明日期")} ${d.mood ? tag(d.mood, "rose") : ""}${d.status === "draft" ? tag("草稿", "gold") : tag("已确认")}</div></div><h3 style="margin-top:8px">${e(d.title)}</h3><p class="muted tiny" style="margin-top:4px;white-space:pre-wrap">${e(d.text.slice(0, 180))}${d.text.length > 180 ? "…" : ""}</p><div class="buttons" style="margin-top:8px">${button(icon("edit", 13) + " 阅读 / 编辑", "edit-diary", d.id)}${button(icon("trash", 13) + " 删除", "delete-diary", d.id, "danger")}</div></div>`;
  }

  // ===== 全模块通用删除管理栏（多选删除 + 一键清空） =====
  function tpDeleteBar(moduleKey, count, label = "记录") {
    if (!count || count <= 0) return "";
    return `<div class="tp-del-bar"><span class="tp-del-count">共 <b>${count}</b> 条${e(label)}</span><div class="tp-del-actions"><button type="button" class="btn tp-mini-btn" data-action="batch-delete-modal" data-id="${e(moduleKey)}">${icon("check", 12)} 多选删除</button><button type="button" class="btn tp-mini-btn danger" data-action="clear-module" data-id="${e(moduleKey)}">${icon("trash", 12)} 一键清空</button></div></div>`;
  }
  function tpModuleMeta(ui, moduleKey) {
    const s = ui.data;
    if (!s) return null;
    if (moduleKey.startsWith("chat:")) {
      const tid = moduleKey.slice(5);
      const t = s.threads.find((x) => x.id === tid);
      if (!t) return null;
      return {
        title: `会话「${t.title}」消息`,
        warn: "仅删除所选的手机聊天消息，不会修改正文楼层。",
        items: [...t.messages].reverse().map((m) => ({
          id: m.id,
          name: (m.role === "user" ? "我" : contactName(s, m.author)) + "：" + text(m.text || "[图片]", 36),
          note: m.story || time(m.ts)
        })),
        remove(d, ids) {
          const th = d.threads.find((x) => x.id === tid);
          if (!th) return 0;
          const before = th.messages.length;
          th.messages = th.messages.filter((m) => !ids.has(m.id));
          return before - th.messages.length;
        },
        clear(d) {
          const th = d.threads.find((x) => x.id === tid);
          if (!th) return 0;
          const n = th.messages.length;
          th.messages = [];
          return n;
        }
      };
    }
    switch (moduleKey) {
      case "threads":
        return {
          title: "消息会话",
          warn: "将删除所选会话及其全部聊天记录与关联摘要。",
          items: [...s.threads].sort((a, b) => (b.messages.at(-1)?.ts || b.createdAt) - (a.messages.at(-1)?.ts || a.createdAt)).map((t) => ({
            id: t.id,
            name: t.title + (t.kind === "group" ? "（群聊）" : ""),
            note: `${t.messages.length} 条消息` + (t.pending.length ? ` · ${t.pending.length} 条待发` : "") + (t.messages.at(-1)?.text ? " · " + text(t.messages.at(-1).text, 30) : "")
          })),
          remove(d, ids) {
            const before = d.threads.length;
            d.threads = d.threads.filter((t) => !ids.has(t.id));
            d.summaries = d.summaries.filter((m) => !ids.has(m.threadId));
            return before - d.threads.length;
          },
          clear(d) {
            const n = d.threads.length;
            d.threads = [];
            d.summaries = [];
            return n;
          }
        };
      case "outbox": {
        const flat = [];
        for (const t of s.threads) for (const p of t.pending) flat.push({ id: t.id + "|" + p.id, name: `【${t.title}】` + text(p.text, 42), note: "待发草稿" });
        return {
          title: "待发箱消息",
          warn: "将移除所选的未发送暂存消息。",
          items: flat,
          remove(d, ids) {
            let n = 0;
            for (const t of d.threads) {
              const b = t.pending.length;
              t.pending = t.pending.filter((p) => !ids.has(t.id + "|" + p.id));
              n += b - t.pending.length;
            }
            return n;
          },
          clear(d) {
            let n = 0;
            for (const t of d.threads) {
              n += t.pending.length;
              t.pending = [];
            }
            return n;
          }
        };
      }
      case "contacts":
        return {
          title: "通讯录联系人",
          warn: "将从通讯录移除所选人物，并清理其私聊与引用（角色卡人物可在通讯录底部恢复）。",
          items: s.contacts.map((c) => ({ id: c.id, name: c.name, note: text(c.status || "", 50) })),
          remove(d, ids) {
            let n = 0;
            for (const cid of ids) {
              if (d.contacts.some((c) => c.id === cid)) {
                deleteContact(d, cid);
                n++;
              }
            }
            return n;
          },
          clear(d) {
            const allIds = d.contacts.map((c) => c.id);
            for (const cid of allIds) deleteContact(d, cid);
            return allIds.length;
          }
        };
      case "feed":
        return {
          title: "朋友圈动态",
          warn: "将从手机朋友圈移除所选动态与评论。",
          items: [...s.feed].reverse().map((p) => ({
            id: p.id,
            name: contactName(s, p.author) + "：" + text(p.text, 40),
            note: (p.story || time(p.ts)) + (p.comments?.length ? ` · ${p.comments.length} 条评论` : "")
          })),
          remove(d, ids) {
            const b = d.feed.length;
            d.feed = d.feed.filter((p) => !ids.has(p.id));
            return b - d.feed.length;
          },
          clear(d) {
            const b = d.feed.length;
            d.feed = [];
            return b;
          }
        };
      case "diary": {
        const list = [...s.diary].reverse().filter((d) => d.kind !== "heart");
        return {
          title: "角色与玩家日记",
          warn: "将删除所选日记（不影响恋爱心迹）。",
          items: list.map((d) => ({
            id: d.id,
            name: ((!d.author || d.author === "user") ? "我" : contactName(s, d.author)) + " · " + d.title,
            note: (d.date || "无日期") + " · " + text(d.text, 36)
          })),
          remove(d, ids) {
            const b = d.diary.length;
            d.diary = d.diary.filter((x) => !ids.has(x.id));
            return b - d.diary.length;
          },
          clear(d) {
            const b = d.diary.length;
            d.diary = d.diary.filter((x) => x.kind === "heart");
            return b - d.diary.length;
          }
        };
      }
      case "heart": {
        const list = [...s.diary].reverse().filter((d) => d.kind === "heart");
        return {
          title: "恋爱心迹",
          warn: "将删除所选楼层的恋爱心迹记录（不影响普通日记）。",
          items: list.map((d) => ({
            id: d.id,
            name: `${contactName(s, d.author) !== "未知联系人" ? contactName(s, d.author) : (d.authorName || "角色")} · #${(d.floor ?? 0) + 1}楼 · ${d.title}`,
            note: [d.mood, d.heartbeat, text(d.replyToFloor || d.text, 36)].filter(Boolean).join(" · ")
          })),
          remove(d, ids) {
            const b = d.diary.length;
            d.diary = d.diary.filter((x) => !ids.has(x.id));
            return b - d.diary.length;
          },
          clear(d) {
            const b = d.diary.length;
            d.diary = d.diary.filter((x) => x.kind !== "heart");
            return b - d.diary.length;
          }
        };
      }
      case "diary_all":
        return {
          title: "全部日记与恋爱心迹",
          warn: "将删除所选的日记与恋爱心迹。",
          items: [...s.diary].reverse().map((d) => ({
            id: d.id,
            name: (d.kind === "heart" ? `[心迹 #${(d.floor ?? 0) + 1}楼] ` : "[日记] ") + ((!d.author || d.author === "user") ? "我" : (contactName(s, d.author) !== "未知联系人" ? contactName(s, d.author) : (d.authorName || "角色"))) + " · " + d.title,
            note: text(d.text, 40)
          })),
          remove(d, ids) {
            const b = d.diary.length;
            d.diary = d.diary.filter((x) => !ids.has(x.id));
            return b - d.diary.length;
          },
          clear(d) {
            const b = d.diary.length;
            d.diary = [];
            return b;
          }
        };
      case "notes":
        return {
          title: "备忘便签",
          warn: "将删除所选便签。",
          items: [...s.notes].reverse().map((n) => ({
            id: n.id,
            name: n.title || "无题",
            note: text(n.text, 45)
          })),
          remove(d, ids) {
            const b = d.notes.length;
            d.notes = d.notes.filter((n) => !ids.has(n.id));
            return b - d.notes.length;
          },
          clear(d) {
            const b = d.notes.length;
            d.notes = [];
            return b;
          }
        };
      case "memories":
        return {
          title: "手机记忆",
          warn: "将删除所选手机记忆；已同步到记忆世界书的条目也会在下次同步时移除。",
          items: [...s.memories].reverse().map((m) => ({
            id: m.id,
            name: (m.title || KIND_LABEL[m.kind] || "记忆") + (m.bb ? " [柏宝书]" : ""),
            note: text(m.text, 48)
          })),
          remove(d, ids) {
            const toRemove = d.memories.filter((m) => ids.has(m.id));
            for (const m of toRemove) {
              if (d.memoryBook?.linked && m.wb && !d.memoryBook.pendingDelete.includes(m.id) && d.memoryBook.pendingDelete.length < 500) {
                d.memoryBook.pendingDelete.push(m.id);
              }
            }
            d.memories = d.memories.filter((m) => !ids.has(m.id));
            return toRemove.length;
          },
          clear(d) {
            const n = d.memories.length;
            if (d.memoryBook?.linked) {
              for (const m of d.memories) {
                if (m.wb && !d.memoryBook.pendingDelete.includes(m.id) && d.memoryBook.pendingDelete.length < 500) {
                  d.memoryBook.pendingDelete.push(m.id);
                }
              }
            }
            d.memories = [];
            d.summaries = [];
            return n;
          }
        };
      case "agenda":
        return {
          title: "日历与约定",
          warn: "将从手机日历移除所选日程或约定。",
          items: [...s.agenda].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((a) => ({
            id: a.id,
            name: `${a.date || "未定日"} · ${a.title}`,
            note: `${a.status} · ${text(a.note || "", 36)}`
          })),
          remove(d, ids) {
            const b = d.agenda.length;
            d.agenda = d.agenda.filter((a) => !ids.has(a.id));
            return b - d.agenda.length;
          },
          clear(d) {
            const b = d.agenda.length;
            d.agenda = [];
            return b;
          }
        };
      case "tasks":
        return {
          title: "生活清单",
          warn: "将从手机生活清单移除所选条目。",
          items: s.tasks.map((t) => ({
            id: t.id,
            name: t.title,
            note: `${t.category || "生活"} · ${t.progress || 0}/${t.target || 1}${t.done ? "（已完成）" : ""}`
          })),
          remove(d, ids) {
            const b = d.tasks.length;
            d.tasks = d.tasks.filter((t) => !ids.has(t.id));
            return b - d.tasks.length;
          },
          clear(d) {
            const b = d.tasks.length;
            d.tasks = [];
            return b;
          }
        };
      case "items":
        return {
          title: "随身包手机记录",
          warn: "将移除所选手机物品附注（不会修改主线角色卡背包变量）。",
          items: s.items.map((x) => ({
            id: x.id,
            name: `${x.title} × ${x.quantity}`,
            note: text(x.note || "", 45)
          })),
          remove(d, ids) {
            const b = d.items.length;
            d.items = d.items.filter((x) => !ids.has(x.id));
            return b - d.items.length;
          },
          clear(d) {
            const b = d.items.length;
            d.items = [];
            return b;
          }
        };
      case "album":
        return {
          title: "相册照片",
          warn: "将从手机相册移除所选照片。",
          items: [...s.album].reverse().map((p) => ({
            id: p.id,
            name: p.title || "留影",
            note: (p.date || new Date(p.ts).toLocaleDateString("zh-CN")) + (p.url ? " · 网络图" : " · 本地图片")
          })),
          remove(d, ids) {
            const b = d.album.length;
            d.album = d.album.filter((p) => !ids.has(p.id));
            return b - d.album.length;
          },
          clear(d) {
            const b = d.album.length;
            d.album = [];
            return b;
          }
        };
      case "places":
        return {
          title: "自建地点",
          warn: "将移除所选自建地点（内置地图地点不会被删除）。",
          items: (s.places || []).map((p) => ({
            id: p.id,
            name: p.title,
            note: text(p.note || "", 45)
          })),
          remove(d, ids) {
            const b = d.places.length;
            d.places = d.places.filter((p) => !ids.has(p.id));
            return b - d.places.length;
          },
          clear(d) {
            const b = d.places.length;
            d.places = [];
            return b;
          }
        };
      case "arc_beats":
        return {
          title: "剧情规划 · 面（大纲节点）",
          warn: "将删除所选大纲节点，并自动校准当前游标。",
          items: s.arc.outline.beats.map((b, i) => ({
            id: b.id,
            name: `${i + 1}. ${b.title}`,
            note: `${b.time || "阶段"} · ${text(b.scene, 40)}`
          })),
          remove(d, ids) {
            const o = d.arc.outline, b = o.beats.length;
            o.beats = o.beats.filter((x) => !ids.has(x.id));
            o.cursor = o.beats.length ? Math.min(o.cursor, o.beats.length - 1) : 0;
            return b - o.beats.length;
          },
          clear(d) {
            const o = d.arc.outline, b = o.beats.length;
            o.beats = [];
            o.cursor = 0;
            o.judge = { at: 0, verdict: "", note: "" };
            return b;
          }
        };
      case "arc_lines":
        return {
          title: "剧情规划 · 线（事件线）",
          warn: "将删除所选事件线。",
          items: s.arc.lines.items.map((l) => ({
            id: l.id,
            name: `${l.name} [${l.stage}]`,
            note: text(l.desc, 42)
          })),
          remove(d, ids) {
            const b = d.arc.lines.items.length;
            d.arc.lines.items = d.arc.lines.items.filter((x) => !ids.has(x.id));
            return b - d.arc.lines.items.length;
          },
          clear(d) {
            const b = d.arc.lines.items.length;
            d.arc.lines.items = [];
            return b;
          }
        };
      case "arc_points": {
        const pts = [];
        for (const day of s.arc.points.days) {
          for (const ev of day.events) pts.push({ id: ev.id, name: `[Day ${day.n}] ${ev.title}`, note: [ev.date, ev.time, ev.place, text(ev.desc, 30)].filter(Boolean).join(" · ") });
        }
        for (const ev of s.arc.points.future) pts.push({ id: ev.id, name: `[远期] ${ev.title}`, note: [ev.date, ev.time, ev.place, text(ev.desc, 30)].filter(Boolean).join(" · ") });
        for (const ev of s.arc.points.past) pts.push({ id: ev.id, name: `[已过去] ${ev.title}`, note: [ev.date, ev.time, ev.place].filter(Boolean).join(" · ") });
        return {
          title: "剧情规划 · 点（日程事件）",
          warn: "将删除所选日程事件点。",
          items: pts,
          remove(d, ids) {
            let n = 0;
            for (const day of d.arc.points.days) {
              const b = day.events.length;
              day.events = day.events.filter((x) => !ids.has(x.id));
              n += b - day.events.length;
            }
            const bf = d.arc.points.future.length;
            d.arc.points.future = d.arc.points.future.filter((x) => !ids.has(x.id));
            n += bf - d.arc.points.future.length;
            const bp = d.arc.points.past.length;
            d.arc.points.past = d.arc.points.past.filter((x) => !ids.has(x.id));
            n += bp - d.arc.points.past.length;
            return n;
          },
          clear(d) {
            let n = d.arc.points.future.length + d.arc.points.past.length;
            for (const day of d.arc.points.days) {
              n += day.events.length;
              day.events = [];
            }
            d.arc.points.future = [];
            d.arc.points.past = [];
            return n;
          }
        };
      }
      case "plans":
        return {
          title: "未来方向档案",
          warn: "将删除所选未来方向。",
          items: [...s.plans].reverse().map((p) => ({
            id: p.id,
            name: p.title,
            note: `${p.tone || "日常"} · ${p.status} · ${text(p.summary, 36)}`
          })),
          remove(d, ids) {
            const b = d.plans.length;
            d.plans = d.plans.filter((p) => !ids.has(p.id));
            if (d.activePlan && ids.has(d.activePlan.id)) d.activePlan = null;
            return b - d.plans.length;
          },
          clear(d) {
            const b = d.plans.length;
            d.plans = [];
            d.activePlan = null;
            return b;
          }
        };
      case "logs":
        return {
          title: "运行记录",
          warn: "仅清理诊断日志，不影响任何聊天或存档数据。",
          items: [...(s.logs || [])].reverse().map((l) => ({
            id: l.id,
            name: `${MODULES[l.module] || "系统"} · ${new Date(l.ts).toLocaleTimeString("zh-CN")}`,
            note: text(l.message, 60)
          })),
          remove(d, ids) {
            const b = d.logs.length;
            d.logs = d.logs.filter((l) => !ids.has(l.id));
            return b - d.logs.length;
          },
          clear(d) {
            const b = d.logs.length;
            d.logs = [];
            return b;
          }
        };
      default:
        return null;
    }
  }

  var BaiBaiLink = class {
    constructor(eng) {
      this.eng = eng;
      this.timer = null;
      this.heartTimer = null;
      this.heartBusy = false;
      this.lastHeartAutoKey = "";
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
        if (Array.isArray(brief.mainNpcs) && brief.mainNpcs.length) parts.push("主要配角 " + brief.mainNpcs.length + " 人");
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
      this.offs.push(this.eng.bridge.listen((kind) => {
        if (kind === "narrative") this.pokeHeart("narrative");
      }));
      const win = this.eng.win, handler = (ev) => {
        baibaiInvalidate();
        const d = ev?.detail;
        if (ev?.type === "st-baibai-book:phone-update" && d && d.type === "external" && d.source === BAIBAI_SOURCE) return;
        clearTimeout(this.eng.debounce);
        this.eng.debounce = setTimeout(() => this.eng.refresh(), 600);
        this.eng.emit("status");
        if (ev?.type === "st-baibai-book:phone-update" && d && d.type === "memory") {
          this.pokeHeart("baibai-memory");
        }
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
      clearTimeout(this.heartTimer);
      for (const off of this.offs) try {
        off();
      } catch {
      }
      this.offs = [];
    }
    pokeHeart(reason = "narrative") {
      if (!heartPrefs().autoEveryFloor) return;
      clearTimeout(this.heartTimer);
      this.heartTimer = setTimeout(() => {
        this.maybeAutoHeartTrace(reason).catch((e2) => {
          console.warn("[月夜来信] 自动生成恋爱心迹跳过：", e2?.message || e2);
        });
      }, reason === "baibai-memory" ? 1200 : 2800);
    }
    async maybeAutoHeartTrace(_reason = "narrative") {
      const hp = heartPrefs();
      if (!hp.autoEveryFloor || this.heartBusy || this.eng.disposed) return null;
      if (!this.eng.settings.isEnabled("diary")) return null;
      if (this.eng.bridge.isBusy?.() || this.eng.runner.active) {
        this.pokeHeart("retry");
        return null;
      }
      let snap;
      try {
        snap = this.eng.bridge.capture();
      } catch {
        return null;
      }
      const s = this.eng.repo.data;
      if (!s || !snap || !Number.isInteger(snap.floor) || snap.floor < 0 || !snap.narrativeKey) return null;
      const autoKey = (snap.owner || "") + "|" + snap.narrativeKey;
      if (this.lastHeartAutoKey === autoKey || s.automation?.lastHeartKey === autoKey) return null;
      if (s.diary.some((d) => d.kind === "heart" && d.floor === snap.floor)) {
        this.lastHeartAutoKey = autoKey;
        return null;
      }
      this.heartBusy = true;
      try {
        await this.eng.repo.mutate((d) => {
          syncBaibaiMainNpcsToContacts(d, null, { onlyImportantOrPresent: true });
          d.automation.lastHeartKey = autoKey;
        }, { snapshot: snap, label: "同步百宝书主要配角（恋爱心迹）" }).catch(() => {});
        const picked = pickAutoHeartContacts(this.eng.repo.data, snap);
        if (!picked.length) return null;
        this.lastHeartAutoKey = autoKey;
        return await this.eng.actions.heartTraces(picked, { floor: snap.floor, background: true });
      } finally {
        this.heartBusy = false;
      }
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
      if (heartPrefs().syncToBaibai !== false && Array.isArray(s.diary)) {
        for (const d of s.diary.filter((x) => x.kind === "heart").slice(-12)) {
          const who = d.author && d.author !== "user" ? (name(d.author) !== "未知人物" ? name(d.author) : (d.authorName || "角色")) : me;
          const fl = Number.isInteger(d.floor) ? d.floor : floor;
          const summaryParts = [
            d.mood ? `心情：${text(d.mood, 20)}` : "",
            d.heartbeat ? `心动：${text(d.heartbeat, 30)}` : "",
            d.surface ? `表面：${text(d.surface, 100)}` : "",
            d.replyToFloor ? `心底回应：${text(d.replyToFloor, 140)}` : "",
            text(d.text, 220)
          ].filter(Boolean).join(" ｜ ");
          rows.push({
            id: "heart:" + d.id,
            kind: "phone_heart",
            title: `恋爱心迹 · ${who}（#${(fl ?? 0) + 1}楼）`,
            text: `${who}在 #${(fl ?? 0) + 1} 楼的恋爱心迹《${text(d.title, 40)}》：${summaryParts}`,
            time: text(d.date, 20) || void 0,
            floor: fl
          });
        }
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

