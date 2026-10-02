#!/usr/bin/env python3
"""Patch 月夜来信 1.5.2 bundle -> 1.6.3 (柏宝书联动 + 全模块一键清空与多选删除 + 每楼层恋爱心迹). Textual, anchor-based, every anchor must match exactly once."""
import pathlib, sys

# 用法: python3 apply_phone_patch.py <1.5.2 原始脚本 content 导出的 .js> <输出 .js>
P = pathlib.Path(__file__).resolve().parent
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else P.parent / 'base' / 'tsukiyo-phone-1.5.2.js'
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else P.parent / 'tsukiyo-phone-1.6.3.js'
js = SRC.read_text(encoding='utf-8')
NEW_VERSION = '1.6.3'


def rep(old, new, count=1):
    global js
    n = js.count(old)
    assert n == count, f'anchor matched {n} times (expected {count}): {old[:80]!r}'
    js = js.replace(old, new)


# 0. banner + version
rep('/* 月夜来信 · 小手机 v1.5.2（',
    '/* 月夜来信 · 小手机 v1.6.3（百宝月夜书联动：自动读取柏宝书的剧情时间/地点/在场人物作回退、柏宝书分层摘要·锚点日记·未了结计划进入手机人物与规划上下文、手机交流/约定/动态/恋爱心迹回写柏宝书【小手机】记录、每楼层恋爱心迹生成与主要配角联动、全模块一键清空与多选删除、一键导入柏宝书记忆与副 API 方案、经柏宝书测活渠道 · ')
rep('var package_default = { name: "tsukiyo-phone", version: "1.5.2",',
    'var package_default = { name: "tsukiyo-phone", version: "' + NEW_VERSION + '",')

# 1. new module before context.js
rep('  // src/services/context.js\n', (P / 'baibai_module.js').read_text(encoding='utf-8') + '  // src/services/context.js\n')

# 2. storyFor: 柏宝书 fallback (MVU > 玩家手动 > 柏宝书 > 角色卡预设)
old_story = '''    const date = raw.date || data.manualStory.date || ps?.date || "";
    return { ...raw, date, time: raw.time || data.manualStory.time || (date === ps?.date ? String(ps.time || "") : ""), place: raw.place || data.manualStory.place || (date === ps?.date ? String(ps.place || "") : ""), origin: raw.date ? "主线变量" : data.manualStory.date ? "玩家手动设置" : ps ? "角色卡开场预设" : "尚未提供剧情日期" };'''
new_story = '''    const bb = raw.date && raw.time && raw.place ? null : baibaiStory();
    const date = raw.date || data.manualStory.date || bb?.date || ps?.date || "";
    const fromBaibai = !!bb && !raw.date && !data.manualStory.date && !!(bb.date || bb.clock);
    const out = { ...raw, date, time: raw.time || data.manualStory.time || (fromBaibai ? bb.time : "") || (date === ps?.date ? String(ps.time || "") : ""), place: raw.place || data.manualStory.place || bb?.place || (date === ps?.date ? String(ps.place || "") : ""), origin: raw.date ? "主线变量" : data.manualStory.date ? "玩家手动设置" : fromBaibai ? "柏宝书记忆" : ps ? "角色卡开场预设" : "尚未提供剧情日期" };
    if (bb && (fromBaibai || !raw.date)) {
      if (bb.clock) out.柏宝书时间 = bb.clock;
      if (bb.weekday) out.weekday = bb.weekday;
    }
    if (fromBaibai) out.known = !!date;
    return out;'''
rep(old_story, new_story)

# 3. actorContext / planningContext additions
rep(' 知情说明: mainAllowed ? ', ' 柏宝书简报: baibaiActorBrief(contact, mainAllowed, { social, group: !!groupId }), 知情说明: mainAllowed ? ')
rep('模式: s.settings.planningMode };', '柏宝书: baibaiPlanningBrief(), 模式: s.settings.planningMode };')

# 4. phoneDigest: imported 柏宝书 memories never re-injected into main prompt
rep('memories = s.memories.filter((m) => m.enabled !== false && !(viaBook && m.wb) && (',
    'memories = s.memories.filter((m) => m.enabled !== false && !m.bb && !(viaBook && m.wb) && (')

# 5. capture(): present NPC fallback
rep('      const present = (stat.NPC动态?.当前互动NPC || []).map((n) => n.名字).filter(Boolean);',
    '      const present = baibaiPresentFallback((stat.NPC动态?.当前互动NPC || []).map((n) => n.名字).filter(Boolean), this.win);')

# 6. memory world-book sync: skip 柏宝书-imported memories
rep('planMemorySync(data.memories, entries, opts())', 'planMemorySync(data.memories.filter(notBaibai), entries, opts())')
rep('planMemorySync(data.memories, fresh, opts())', 'planMemorySync(data.memories.filter(notBaibai), fresh, opts())')

# 7. engine wiring
rep('      this.memoryBook = new MemoryBook(this);\n', '      this.memoryBook = new MemoryBook(this);\n      this.baibai = new BaiBaiLink(this);\n')
rep('      this.memoryBook.start();\n', '      this.memoryBook.start();\n      this.baibai.start();\n')
rep('      this.memoryBook.stop();\n', '      this.memoryBook.stop();\n      this.baibai.stop();\n')

# 8. actions
rep('      case "read-narrative":\n', (P / 'baibai_actions.js').read_text(encoding='utf-8') + '      case "read-narrative":\n')

# 9. memory card tag
rep('${viaBook ? tag("世界书", "gold") : ""}', '${viaBook ? tag("世界书", "gold") : ""}${m.bb ? tag("柏宝书", "gold") : ""}')

# 10. api view button
rep('${button("导入方案", "import-api")}', '${button("导入方案", "import-api")}${button("导入柏宝书方案", "baibai-import-api")}')

# 11. settings view: 柏宝书联动 card
rep('    const s = ui.data, c = ui.engine.settings.data, bridge = ui.engine.bridge;\n    return `<div class="pad"><div class="card"><div style="display:flex;align-items:center;gap:12px"><span class="avatar sage">${icon("moon", 23)}</span>',
    '    const s = ui.data, c = ui.engine.settings.data, bridge = ui.engine.bridge, bb = ui.engine.baibai ? ui.engine.baibai.status() : null;\n    return `<div class="pad"><div class="card"><div style="display:flex;align-items:center;gap:12px"><span class="avatar sage">${icon("moon", 23)}</span>')
card = ('<div class="card"><h3 style="margin:0 0 6px">柏宝书联动</h3><p class="tiny muted">${e(bb ? bb.text : "不可用")}</p>'
        '${switchRow("启用柏宝书联动", "检测到「百宝月夜书」(≥1.3.0) 时双向联动；关闭后手机完全独立运行", "baibai-enabled", !!bb?.prefs.enabled)}'
        '${switchRow("使用柏宝书记忆生成（实时读取）", "聊天、主动来信、朋友圈/评论、日记、备忘、清单、日历、规划与记忆整理可参考柏宝书；关闭后不再读取，也不使用带柏宝书标记的导入记忆。公开动态/群聊只取有限本人资料，不公开全局私密摘要", "baibai-brief", !!bb?.prefs.brief)}'
        '${switchRow("在场人物兜底", "主线变量没有“当前互动NPC”时，采用柏宝书推断的在场人物", "baibai-present", !!bb?.prefs.present)}'
        '${switchRow("手机交流回写柏宝书", "新消息、约定、动态、未完约定推送到柏宝书的【小手机】外部记录，参与其正文注入与摘要；不会改动柏宝书自身的记忆", "baibai-push", !!bb?.prefs.push)}'
        '<div class="buttons">${button("立即回写", "baibai-push-now")}${button("导入柏宝书记忆", "baibai-import-memory")}${button("导入柏宝书 API 方案", "baibai-import-api")}${button("经柏宝书测活渠道", "baibai-test")}</div>'
        '<p class="form-note">只读取柏宝书公开的 window.STBaiBaiBook.phone 接口；柏宝书密钥不经过手机（“导入方案”除外，它会复制一份密钥到本机）。</p></div>')
rep('<p class="form-note">独立扩展与卡内脚本二选一即可；', card + '<p class="form-note">独立扩展与卡内脚本二选一即可；')


# 全部生成入口经过同一个可选记忆闸门；不改原始base脚本。
rep('const data = clone(this.repo.choose(snap));', 'const data = baibaiFilterInput(clone(this.repo.choose(snap)));')
rep('        const request = prepare(data, snap);', '        const bbPolicy = fingerprint([baibaiPrefs(), baibaiReadEnabled()]);\n        const request = baibaiEnrichRequest(module, prepare(data, snap));')
rep('        const value = request.parse(raw);', '        assert(bbPolicy === fingerprint([baibaiPrefs(), baibaiReadEnabled()]), "记忆联动开关已变化，请重新生成");\n        const value = request.parse(raw);')
# 派生文本不会进入sig，关闭读取只过滤请求副本；并发签名仍按原存档计算。
rep('sig = sigFn(data), apiSig =', 'sig = sigFn(this.repo.choose(snap)), apiSig =')
# 角色日记原来丢掉了actorContext中的记忆字段，补齐；不再给多人共用整个正文。
rep('本人知道的约定与记忆: ctx.相关约定, 可见正文:', '本人知道的约定与记忆: ctx.相关约定, 柏宝书简报: ctx.柏宝书简报, 可见正文:')
rep('角色资料: people, 近期正文: snap.history.slice(-5),', '角色资料: people, 玩家记忆参考: chosen.length === 1 && chosen[0].id === "user" ? baibaiPlanningBrief() : void 0, 近期正文: chosen.length === 1 && chosen[0].id === "user" ? snap.history.slice(-5) : [],')
# 关闭读取后，旧导入记忆即使仍在手机中也不会进入角色上下文。
rep('const accepted = s.memories.filter((m) => m.enabled !== false && (', 'const accepted = s.memories.filter((m) => (!m.bb || baibaiReadEnabled()) && m.enabled !== false && (')
# 手机记忆页显示实时读取状态和预览，不需要反复复制整库。
rep('${bookCard(ui)}${hint("原文、来源、知情者分别保留。', '${bookCard(ui)}${baibaiMemoryCard()}${hint("原文、来源、知情者分别保留。')

# 12. PhoneActions: heartTraces (每楼层恋爱心迹生成) & heartFollowup (针对单条心迹回应/追问)
old_diaries_end = '''      }, (s, rows, snap) => {
        const date = storyFor(s, snap).date;
        for (const r of rows) limitAppend(s.diary, { id: id("diary"), ...r, date, status: "draft", ts: Date.now(), source: "AI · " + r.authorName }, 300, "日记");
        return rows;
      }, options);
    }'''
new_diaries_end = old_diaries_end + '''
    heartTraces(authors, options = {}) {
      return this.perform("diary", (s, snap) => {
        const chosen = (authors || []).map((a) => s.contacts.find((c) => c.id === a || nameKey(c.name) === nameKey(String(a)))).filter(Boolean);
        assert(chosen.length, "请至少选择一位要生成恋爱心迹的角色");
        const fctx = collectFloorContext(this.bridge, snap, options.floor);
        const brief = baibaiBrief(null, { maxAge: 1500 });
        const people = chosen.map((c) => {
          const ctx = actorContext(s, snap, c);
          const bbNpc = (brief?.npcs || []).find((n) => nameKey(n.name) === nameKey(c.name));
          const prevHearts = s.diary.filter((d) => d.kind === "heart" && d.author === c.id).slice(-2).map((d) => ({ 楼层: "#" + ((d.floor ?? 0) + 1) + "楼", 心情: d.mood, 心动: d.heartbeat, 摘要: text(d.replyToFloor || d.text, 120) }));
          return {
            名字: c.name,
            年龄: c.age,
            状态: c.status,
            人设: text(c.bio || ctx.本人?.人设 || "", 900),
            柏宝书关系与好感: bbNpc ? { 称呼: text(bbNpc.title, 80), 与玩家关系: text(bbNpc.relation, 100), 纽带: text(bbNpc.ties, 120), 好感状态: text(bbNpc.affinityText, 120), 好感备注: text(bbNpc.affinityNote, 160), 当前近况: text(bbNpc.condition, 120), 在场: !!bbNpc.present } : void 0,
            柏宝书简报: ctx.柏宝书简报,
            先前恋爱心迹延续: prevHearts,
            本人知道的约定与记忆: ctx.相关约定
          };
        });
        const focusHint = text(options.focusHint || "", 200);
        return {
          system: rules + '\\n你是「恋爱心迹」专属叙事心理师。请紧扣【目标楼层正文】中玩家与角色的互动细节、角色性格设定与【柏宝书关系与好感】，为每位指定角色各写一篇针对该楼层的「恋爱心迹」。\\n要求：\\n1. 严格贴合角色本人的性格、说话腔调与心理防线（如傲娇嘴硬、温柔克制、天然呆、腹黑占有等），绝不千篇一律。\\n2. 必须直接呼应【目标楼层正文】和【本楼层前一条玩家言行】里的具体动作、眼神或话语，写出角色在那一刻最真实的悸动、醋意、纠结或心软。\\n3. 即使角色当时未直接开口，也可写ta在场旁观、事后听闻或此刻挂念玩家时的私密心声。' + (focusHint ? '\\n4. 本次额外侧重：' + focusHint : '') + '\\n只输出严格 JSON：{"traces":[{"author":"角色名","title":"18字内浪漫或微妙的心迹标题","mood":"2到4字情绪词（如：耳根发烫/嘴硬心软/暗自吃味）","heartbeat":"心动指数与变化（如：78% · 心跳漏拍）","stage":"当前情感阶段（如：暧昧拉扯/情根深种/暗恋试探）","surface":"50字内：本楼层里ta表面上装作的样子或外在反应","replyToFloor":"90字内：针对本楼层你的言行，ta在心底对你说却没敢说出口的话（用第二人称“你”）","text":"180—360字：第一人称（“我”）恋爱心迹独白，细腻描写本楼层互动瞬间ta的真实悸动与心事","secret":"55字内：藏在心底的小秘密，或下一次见面想悄悄对你做的小动作"}]}，顺序与给定角色一致。',
          payload: {
            剧情时间: storyFor(s, snap),
            目标楼层编号: "#" + (fctx.targetFloor + 1) + "楼",
            本楼层前一条玩家言行: fctx.prevUserText || "（无单独前置输入，见目标楼层正文）",
            目标楼层正文: fctx.targetText,
            近期上下文楼层: fctx.recentTurns,
            心迹角色: chosen.map((c) => c.name),
            角色资料与好感: people
          },
          parse: (raw) => heartTracesFrom(raw, chosen, fctx.targetFloor, brief),
          meta: { floor: fctx.targetFloor },
          success: "已生成 #" + (fctx.targetFloor + 1) + " 楼的恋爱心迹"
        };
      }, (s, rows, snap, meta) => {
        const date = storyFor(s, snap).date;
        for (const r of rows) {
          limitAppend(s.diary, {
            id: id("heart"),
            ...r,
            date,
            status: "confirmed",
            ts: Date.now(),
            source: "恋爱心迹 · #" + ((meta.floor ?? 0) + 1) + "楼"
          }, 300, "日记");
        }
        return rows;
      }, options);
    }
    heartFollowup(diaryId, playerPrompt, options = {}) {
      return this.perform("diary", (s, snap) => {
        const d = s.diary.find((x) => x.id === diaryId && x.kind === "heart");
        assert(d, "恋爱心迹不存在");
        const c = s.contacts.find((x) => x.id === d.author) || { id: d.author, name: d.authorName || "角色", bio: "" };
        const ctx = s.contacts.some((x) => x.id === c.id) ? actorContext(s, snap, c) : {};
        const q = text(playerPrompt, 400);
        assert(q, "请输入你想回应或追问的内容");
        return {
          system: rules + '\\n玩家正在回应或追问角色在 #' + ((d.floor ?? 0) + 1) + ' 楼写下的「恋爱心迹」。请以角色本人的第一人称口吻，针对玩家的这句追问/撩拨/互动做出既有表面反应、又有心底真实悸动的回应。只输出 JSON：{"mood":"2到4字当下反应情绪","answer":"80—200字：角色对玩家这句回应的心底回音与反应（第一人称“我”，对玩家称“你”）"}。',
          payload: {
            角色: c.name,
            人设: text(c.bio || "", 700),
            柏宝书简报: ctx.柏宝书简报,
            原恋爱心迹: { 楼层: "#" + ((d.floor ?? 0) + 1) + "楼", 标题: d.title, 心情: d.mood, 表面: d.surface, 心底回应: d.replyToFloor, 正文: d.text, 秘密: d.secret },
            已有互动追问: (d.followups || []).slice(-3),
            玩家本次追问或动作: q
          },
          parse: (raw) => {
            const body = parseModelJson(raw, 2e4);
            const ans = text(body.answer || body.reply || body.text, 1e3);
            assert(ans, "未生成有效的心迹回音");
            return { q, a: ans, mood: text(body.mood || "", 24), ts: Date.now() };
          },
          meta: { diaryId },
          success: c.name + " 回应了你的心迹追问"
        };
      }, (s, item, _snap, meta) => {
        const target = s.diary.find((x) => x.id === meta.diaryId);
        assert(target, "恋爱心迹已被移除");
        target.followups = [...(Array.isArray(target.followups) ? target.followups : []).slice(-9), item];
        return item;
      }, options);
    }'''
rep(old_diaries_end, new_diaries_end)

# 13. diaryEditor: 支持编辑恋爱心迹与普通日记
old_diary_editor = '''  async function diaryEditor(ui, diaryId) {
    const snap = snapshot(ui), row = ui.data.diary.find((n) => n.id === diaryId), world = storyFor(ui.data, snap);
    const r = await ui.dialog(row ? "读一篇日记" : "写一篇日记", field("标题", "title", row?.title || "", { required: true, max: 80 }) + field("剧情日期", "date", row?.date || world.date, { type: "date" }) + field("记录", "text", row?.text || "", { textarea: true, required: true, max: 6e3 }) + checkbox("我已核对，这篇不是未经确认的AI草稿", "confirmed", row?.status === "confirmed") + (row ? checkbox("删除这篇手机日记", "remove", false) : ""));
    if (!r) return;
    if (r.date) isoDay(r.date);
    still(ui, snap);
    await change(ui, (s) => {
      if (r.remove) {
        s.diary = s.diary.filter((x) => x.id !== diaryId);
        return;
      }
      const entry = { title: text(r.title, 80), date: r.date || "", text: text(r.text, 6e3), status: r.confirmed ? "confirmed" : "draft", ts: Date.now() };
      if (row) Object.assign(s.diary.find((x) => x.id === diaryId), entry);
      else limitAppend(s.diary, { id: id("diary"), ...entry, source: "玩家记录" }, 300, "日记");
    }, "保存日记", snap);
  }'''
new_diary_editor = '''  async function diaryEditor(ui, diaryId) {
    const snap = snapshot(ui), row = ui.data.diary.find((n) => n.id === diaryId), world = storyFor(ui.data, snap);
    const isHeart = row?.kind === "heart";
    const r = await ui.dialog(row ? (isHeart ? "编辑恋爱心迹" : "读一篇日记") : "写一篇日记",
      field("标题", "title", row?.title || "", { required: true, max: 80 }) +
      field("剧情日期", "date", row?.date || world.date, { type: "date" }) +
      (isHeart ? field("情绪关键词", "mood", row?.mood || "", { max: 24 }) + field("心动指数", "heartbeat", row?.heartbeat || "", { max: 36 }) + field("本楼表面装作", "surface", row?.surface || "", { textarea: true, max: 240 }) + field("心底回应（致本楼的你）", "replyToFloor", row?.replyToFloor || "", { textarea: true, max: 400 }) : "") +
      field(isHeart ? "恋爱心迹独白" : "记录", "text", row?.text || "", { textarea: true, required: true, max: 6e3 }) +
      (isHeart ? field("未说出口的小秘密", "secret", row?.secret || "", { textarea: true, max: 260 }) : checkbox("我已核对，这篇不是未经确认的AI草稿", "confirmed", row?.status === "confirmed")) +
      (row ? checkbox(isHeart ? "删除这条恋爱心迹" : "删除这篇手机日记", "remove", false) : ""));
    if (!r) return;
    if (r.date) isoDay(r.date);
    still(ui, snap);
    await change(ui, (s) => {
      if (r.remove) {
        s.diary = s.diary.filter((x) => x.id !== diaryId);
        return;
      }
      const entry = {
        title: text(r.title, 80),
        date: r.date || "",
        text: text(r.text, 6e3),
        status: isHeart ? "confirmed" : (r.confirmed ? "confirmed" : "draft"),
        ts: Date.now(),
        ...(isHeart ? {
          mood: text(r.mood || row?.mood || "", 24),
          heartbeat: text(r.heartbeat || row?.heartbeat || "", 36),
          surface: text(r.surface || "", 240),
          replyToFloor: text(r.replyToFloor || "", 400),
          secret: text(r.secret || "", 260)
        } : {})
      };
      if (row) Object.assign(s.diary.find((x) => x.id === diaryId), entry);
      else limitAppend(s.diary, { id: id("diary"), ...entry, source: "玩家记录" }, 300, "日记");
    }, isHeart ? "保存恋爱心迹" : "保存日记", snap);
  }'''
rep(old_diary_editor, new_diary_editor)

# 14. 全模块删除管理（一键清空 + 多选删除 + 单项删除）& 恋爱心迹视图
# 14.1 messagesView
rep('return `<div class="subnav"><button class="chip active" data-action="go" data-id="messages">全部消息</button><button class="chip" data-action="go" data-id="contacts">通讯录</button><button class="chip" data-action="go" data-id="outbox">待发 ${s.threads.reduce((n, t) => n + t.pending.length, 0)}</button></div><div class="inline-banner">${ui.engine.bridge.mode === "demo" ? "离线演示 · 角色消息为演示样例，不连接真实模型" : "来信、已读与约定会接入当前正文参考"}<button data-action="proactive">检查来信</button></div><div class="list">',
    'return `<div class="subnav"><button class="chip active" data-action="go" data-id="messages">全部消息</button><button class="chip" data-action="go" data-id="contacts">通讯录</button><button class="chip" data-action="go" data-id="outbox">待发 ${s.threads.reduce((n, t) => n + t.pending.length, 0)}</button></div><div class="inline-banner">${ui.engine.bridge.mode === "demo" ? "离线演示 · 角色消息为演示样例，不连接真实模型" : "来信、已读与约定会接入当前正文参考"}<button data-action="proactive">检查来信</button></div>${ rows.length ? `<div style="padding:8px 17px 0">${tpDeleteBar("threads", rows.length, "会话")}</div>` : "" }<div class="list">')

# 14.2 chatView (顶部本会话消息多选删除/一键清空 + 每条消息旁单项删除按钮)
rep('return `<div class="chat-scroll"><div class="chat-meta">${t.kind === "group" ? e(t.members.map((n) => contactName(s, n)).join("、")) : "仅你和" + e(t.title) + "参与此会话"}</div>',
    'return `<div class="chat-scroll"><div class="chat-meta">${t.kind === "group" ? e(t.members.map((n) => contactName(s, n)).join("、")) : "仅你和" + e(t.title) + "参与此会话"}</div>${t.messages.length ? tpDeleteBar("chat:" + t.id, t.messages.length, "消息") : ""}')
rep('${!me ? `<button data-action="speak" data-id="${e(m.id)}" aria-label="朗读消息">${icon("volume", 12)}</button>` : ""}</div></div></div>`;',
    '${!me ? `<button data-action="speak" data-id="${e(m.id)}" aria-label="朗读消息">${icon("volume", 12)}</button>` : ""}<button data-action="delete-chat-msg" data-id="${e(t.id + "|" + m.id)}" aria-label="删除此消息" title="删除此消息">${icon("trash", 11)}</button></div></div></div>`;')

# 14.3 contactsView
rep('<div class="buttons">${button(icon("plus", 14) + " 添加联系人", "edit-contact")}${button(icon("book", 14) + " 从世界书导入", "import-wb-contacts")}${button(icon("people", 14) + " 建一个群", "new-group")}</div></div><div class="list">',
    '<div class="buttons">${button(icon("plus", 14) + " 添加联系人", "edit-contact")}${button(icon("book", 14) + " 从世界书导入", "import-wb-contacts")}${button(icon("people", 14) + " 建一个群", "new-group")}</div>${rows.length ? tpDeleteBar("contacts", rows.length, "联系人") : ""}</div><div class="list">')

# 14.4 feedView
rep('<div class="subnav"><button class="chip active">朋友的日常</button><button class="chip" data-action="new-post">${icon("plus", 13)}写动态</button><button class="chip" data-action="generate-post">${icon("spark", 13)}生成动态…</button></div>${s.feed.length ?',
    '<div class="subnav"><button class="chip active">朋友的日常</button><button class="chip" data-action="new-post">${icon("plus", 13)}写动态</button><button class="chip" data-action="generate-post">${icon("spark", 13)}生成动态…</button></div>${s.feed.length ? `<div style="padding:6px 17px 0">${tpDeleteBar("feed", s.feed.length, "动态")}</div>` : ""}${s.feed.length ?')

# 14.5 outboxView
rep('return `<div class="pad">${hint("待发不是已发送。只有你按发送或回复，内容才会交给模型；后台不会偷看未发送草稿。")}${rows.length ?',
    'const totalPending = rows.reduce((n, t) => n + t.pending.length, 0);\n    return `<div class="pad">${hint("待发不是已发送。只有你按发送或回复，内容才会交给模型；后台不会偷看未发送草稿。")}${totalPending ? tpDeleteBar("outbox", totalPending, "待发消息") : ""}${rows.length ?')

# 14.6 arcPlaneView, arcLineView, arcPointView
rep('<div class="arc-timeline">${o.beats.map((b, i) => arcBeatHtml(b, i, o.cursor)).join("")}</div>',
    '${tpDeleteBar("arc_beats", n, "大纲节点")}<div class="arc-timeline">${o.beats.map((b, i) => arcBeatHtml(b, i, o.cursor)).join("")}</div>')
rep('<div class="buttons">${button(icon("spark", 14) + (act.length ? " 推进事件线" : " 生成事件线"), "arc-lines-run", "", "primary")}${button(icon("plus", 13) + " 新增一条线", "arc-line-add")}</div>',
    '<div class="buttons">${button(icon("spark", 14) + (act.length ? " 推进事件线" : " 生成事件线"), "arc-lines-run", "", "primary")}${button(icon("plus", 13) + " 新增一条线", "arc-line-add")}</div>${arc.lines.items.length ? tpDeleteBar("arc_lines", arc.lines.items.length, "事件线") : ""}')
rep('<div class="buttons">${button(icon("spark", 14) + (P.days.length ? " 刷新日程" : " 生成日程"), "arc-points-run", "", "primary")}${button(icon("plus", 13) + " 手动添加", "arc-pt-add")}</div>',
    '<div class="buttons">${button(icon("spark", 14) + (P.days.length ? " 刷新日程" : " 生成日程"), "arc-points-run", "", "primary")}${button(icon("plus", 13) + " 手动添加", "arc-pt-add")}</div>${(P.days.reduce((n, x) => n + x.events.length, 0) + P.future.length + P.past.length) ? tpDeleteBar("arc_points", P.days.reduce((n, x) => n + x.events.length, 0) + P.future.length + P.past.length, "日程点") : ""}')

# 14.7 plannerView & planCard
rep('${button(icon("spark", 15) + " 生成新的未来方向", "generate-plan", "", "primary wide")}${active ? section("正在沿着这条方向", planCard(ui, active, true)) : ""}',
    '${button(icon("spark", 15) + " 生成新的未来方向", "generate-plan", "", "primary wide")}${s.plans.length ? tpDeleteBar("plans", s.plans.length, "方向") : ""}${active ? section("正在沿着这条方向", planCard(ui, active, true)) : ""}')
rep('${!active && ["candidate", "paused"].includes(p.status) ? button("采用", "adopt-plan", p.id, "primary") : ""}</div></article>',
    '${!active && ["candidate", "paused"].includes(p.status) ? button("采用", "adopt-plan", p.id, "primary") : ""}${button("删除", "delete-plan", p.id, "danger")}</div></article>')

# 14.8 agendaView (所有状态日程均可直接移除 + 顶部多选删除/一键清空)
rep('${["event", "cancelled", "completed"].includes(a.status) ? button("移除", "agenda-delete", a.id, "ghost") : ""}</div></div>`;',
    '${button("删除", "agenda-delete", a.id, "danger")}</div></div>`;')
rep('<div class="buttons">${button(icon("spark", 14) + " 一键生成本月节日", "gen-festivals", mStart, "primary")}${button(icon("plus", 14) + " 新建约定", "new-agenda")}${button("剧情日期", "story-date")}</div>',
    '<div class="buttons">${button(icon("spark", 14) + " 一键生成本月节日", "gen-festivals", mStart, "primary")}${button(icon("plus", 14) + " 新建约定", "new-agenda")}${button("剧情日期", "story-date")}</div>${s.agenda.length ? tpDeleteBar("agenda", s.agenda.length, "日程与约定") : ""}')

# 14.9 memoryView
rep('<div class="buttons">${button("整理新的交流", "summarize", "", "primary")}${button("查看正文注入", "inspect-injection")}${button(icon("plus", 14) + " 新增记忆", "new-memory")}</div>',
    '<div class="buttons">${button("整理新的交流", "summarize", "", "primary")}${button("查看正文注入", "inspect-injection")}${button(icon("plus", 14) + " 新增记忆", "new-memory")}</div>${s.memories.length ? tpDeleteBar("memories", s.memories.length, "记忆") : ""}')

# 14.10 lifeView (生活清单)
rep('${section("慢慢完成", tasks.length ?',
    '${tasks.length ? tpDeleteBar("tasks", tasks.length, "清单") : ""}${section("慢慢完成", tasks.length ?')

# 14.11 notesView (备忘便签：多选删除/一键清空 + 单张卡片删除按钮)
old_notes_view = '''  function notesView(ui) {
    const rows = ui.data.notes;
    return `<div class="pad"><div class="buttons" style="margin:0 0 15px">${button(icon("spark", 14) + " 生成备忘…", "auto-notes", "", "primary")}${button(icon("plus", 14) + " 写一张便签", "new-note")}</div>${rows.length ? `<div class="note-grid">${[...rows].reverse().map((n) => `<button class="note-card" data-action="edit-note" data-id="${e(n.id)}"><h3>${e(n.title || "无题")}</h3><p>${e(n.text)}</p><small>${e(new Date(n.ts).toLocaleDateString("zh-CN"))}${n.source === "正文生成" ? " · 自动" : n.source === "人物生成" ? " · 人物" : ""}${n.people?.length ? " · " + e(n.people.map((id2) => contactName(ui.data, id2)).join("、")) : ""}</small></button>`).join("")}</div>` : empty("留一句给未来的自己", "也可以让手机从最近的正文里整理，或选几位角色各记几张。", "note")}</div>`;
  }'''
new_notes_view = '''  function notesView(ui) {
    const rows = ui.data.notes;
    return `<div class="pad"><div class="buttons" style="margin:0 0 10px">${button(icon("spark", 14) + " 生成备忘…", "auto-notes", "", "primary")}${button(icon("plus", 14) + " 写一张便签", "new-note")}</div>${rows.length ? tpDeleteBar("notes", rows.length, "便签") : ""}${rows.length ? `<div class="note-grid">${[...rows].reverse().map((n) => `<div class="note-card tp-note-wrap"><button type="button" class="tp-note-main" data-action="edit-note" data-id="${e(n.id)}"><h3>${e(n.title || "无题")}</h3><p>${e(n.text)}</p><small>${e(new Date(n.ts).toLocaleDateString("zh-CN"))}${n.source === "正文生成" ? " · 自动" : n.source === "人物生成" ? " · 人物" : ""}${n.people?.length ? " · " + e(n.people.map((id2) => contactName(ui.data, id2)).join("、")) : ""}</small></button><button type="button" class="icon-btn tp-note-del" data-action="delete-note" data-id="${e(n.id)}" aria-label="删除便签" title="删除便签">${icon("trash", 13)}</button></div>`).join("")}</div>` : empty("留一句给未来的自己", "也可以让手机从最近的正文里整理，或选几位角色各记几张。", "note")}</div>`;
  }'''
rep(old_notes_view, new_notes_view)

# 14.12 diaryView (日记 + 恋爱心迹双视图 + 楼层筛选 + 角色筛选 + 多选删除/一键清空)
old_diary_view = '''  function diaryView(ui) {
    const s = ui.data, filter = ui.route.author || "all";
    const authors = [...new Set(s.diary.map((d) => d.author || "user"))];
    const rows = [...s.diary].reverse().filter((d) => filter === "all" || (d.author || "user") === filter);
    const who = (d) => !d.author || d.author === "user" ? "我" : contactName(s, d.author);
    return `<div class="pad">${hint("可以指定角色，也可以随机抽几位角色，各写一篇自己的日记。每人只写本人知道的事；AI先写草稿，你确认后保存。")}<div class="buttons">${button(icon("spark", 14) + " 生成角色日记", "generate-diary", "", "primary")}${button(icon("people", 14) + " 随机 3 位", "random-diary")}${button(icon("edit", 14) + " 自己写", "new-diary")}</div>${authors.length > 1 ? `<div class="subnav" style="padding:12px 0 0"><button class="chip ${filter === "all" ? "active" : ""}" data-action="diary-filter" data-id="all">全部</button>${authors.map((a) => `<button class="chip ${filter === a ? "active" : ""}" data-action="diary-filter" data-id="${e(a)}">${e(a === "user" ? "我" : contactName(s, a))}</button>`).join("")}</div>` : ""}${section("留下来的日子", rows.length ? rows.map((d) => `<button class="card" style="display:block;width:100%;text-align:left" data-action="edit-diary" data-id="${e(d.id)}"><div class="eyebrow">${e(who(d))} · ${e(d.date || "未注明日期")} ${d.mood ? tag(d.mood, "rose") : ""}${d.status === "draft" ? tag("草稿", "gold") : tag("已确认")}</div><h3 style="margin-top:8px">${e(d.title)}</h3><p class="muted tiny">${e(d.text.slice(0, 130))}${d.text.length > 130 ? "…" : ""}</p></button>`).join("") : empty("还没有写下今天", "普通的一天，也值得留下几行。", "book"))}</div>`;
  }'''
new_diary_view = '''  function diaryView(ui) {
    const s = ui.data, tab = ui.route.tab || "all", filter = ui.route.author || "all", floorFilter = ui.route.floor || "all";
    const hearts = s.diary.filter((d) => d.kind === "heart");
    const diaries = s.diary.filter((d) => d.kind !== "heart");
    const basePool = tab === "heart" ? hearts : tab === "diary" ? diaries : s.diary;
    const authors = [...new Set(basePool.map((d) => d.author || "user"))];
    const heartFloors = [...new Set(hearts.map((d) => Number.isInteger(d.floor) ? d.floor : 0))].sort((a, b) => b - a);
    const rows = [...basePool].reverse().filter((d) => {
      if (filter !== "all" && (d.author || "user") !== filter) return false;
      if (tab === "heart" && floorFilter !== "all" && String(d.floor ?? 0) !== String(floorFilter)) return false;
      return true;
    });
    const delModule = tab === "heart" ? "heart" : tab === "diary" ? "diary" : "diary_all";
    const delLabel = tab === "heart" ? "恋爱心迹" : tab === "diary" ? "角色日记" : "日记与心迹";
    return `<div class="pad">
      <div class="segmented" style="margin-bottom:12px">
        <button class="${tab === "all" ? "active" : ""}" data-action="diary-tab" data-id="all">${icon("book", 13)} 全部 (${s.diary.length})</button>
        <button class="${tab === "heart" ? "active" : ""}" data-action="diary-tab" data-id="heart">${icon("heart", 13)} 恋爱心迹 (${hearts.length})</button>
        <button class="${tab === "diary" ? "active" : ""}" data-action="diary-tab" data-id="diary">${icon("edit", 13)} 角色日记 (${diaries.length})</button>
      </div>
      ${tab !== "diary" ? renderHeartTracePanel(ui) : ""}
      ${tab !== "heart" ? `<div class="card" style="margin-bottom:10px"><div class="row-top"><b>角色与玩家日记</b><small class="muted">每人只写本人知道的事</small></div><div class="buttons" style="margin-top:8px">${button(icon("spark", 14) + " 生成角色日记", "generate-diary", "", "primary")}${button(icon("people", 14) + " 随机 3 位", "random-diary")}${button(icon("edit", 14) + " 自己写", "new-diary")}</div></div>` : ""}
      ${authors.length > 1 ? `<div class="subnav" style="padding:6px 0 0"><button class="chip ${filter === "all" ? "active" : ""}" data-action="diary-filter" data-id="all">全部角色</button>${authors.map((a) => `<button class="chip ${filter === a ? "active" : ""}" data-action="diary-filter" data-id="${e(a)}">${e(a === "user" ? "我" : contactName(s, a))}</button>`).join("")}</div>` : ""}
      ${tab === "heart" && heartFloors.length > 1 ? `<div class="subnav" style="padding:6px 0 0"><button class="chip ${floorFilter === "all" ? "active" : ""}" data-action="diary-floor" data-id="all">全部楼层</button>${heartFloors.slice(0, 12).map((fl) => `<button class="chip ${String(floorFilter) === String(fl) ? "active" : ""}" data-action="diary-floor" data-id="${fl}">#${fl + 1}楼</button>`).join("")}</div>` : ""}
      ${basePool.length ? tpDeleteBar(delModule, basePool.length, delLabel) : ""}
      ${section(tab === "heart" ? "每楼层恋爱心迹" : tab === "diary" ? "留下来的日子" : "心迹与日记档案", rows.length ? rows.map((d) => renderDiaryEntryCard(ui, d)).join("") : empty(tab === "heart" ? "还没有记录下心迹" : "还没有写下今天", tab === "heart" ? "点上方“一键生成本楼心迹”，或开启每楼层自动生成，聆听角色在每层正文背后的悸动与潜台词。" : "普通的一天，也值得留下几行。", tab === "heart" ? "heart" : "book"))}
    </div>`;
  }'''
rep(old_diary_view, new_diary_view)

# 14.13 bagView (随身物品)
rep('${section("手机记录与备注", s.items.length ?',
    '${s.items.length ? tpDeleteBar("items", s.items.length, "物品记录") : ""}${section("手机记录与备注", s.items.length ?')

# 14.14 albumView (相册：多选删除/一键清空 + 照片弹窗删除按钮 + 卡片快捷删除)
old_album_view = '''  function albumView(ui) {
    const rows = ui.data.album;
    return `<div class="pad">${hint("本地上传的照片存在本机手机专用图片库；用网址添加的照片只保存链接（图床、GitHub、Gitee 等），换设备也能显示。")}<div class="buttons" style="margin-bottom:15px">${button(icon("image", 14) + " 本地上传", "album-upload", "", "primary")}${button(icon("plus", 14) + " 用网址添加", "album-url")}</div>${rows.length ? `<div class="photo-grid">${[...rows].reverse().map((p) => `<button class="photo-card" data-action="photo" data-id="${e(p.id)}"><span class="photo"><img data-media="${e(p.mediaId)}" alt="${e(p.title || "留影")}"></span><small>${e(p.title || "这一刻")}</small></button>`).join("")}</div>` : empty("把某个瞬间留下来", "支持本地上传，也可以粘贴图床或 Git 仓库里的图片网址。", "image")}</div>`;
  }'''
new_album_view = '''  function albumView(ui) {
    const rows = ui.data.album;
    return `<div class="pad">${hint("本地上传的照片存在本机手机专用图片库；用网址添加的照片只保存链接（图床、GitHub、Gitee 等），换设备也能显示。")}<div class="buttons" style="margin-bottom:10px">${button(icon("image", 14) + " 本地上传", "album-upload", "", "primary")}${button(icon("plus", 14) + " 用网址添加", "album-url")}</div>${rows.length ? tpDeleteBar("album", rows.length, "照片") : ""}${rows.length ? `<div class="photo-grid">${[...rows].reverse().map((p) => `<div class="photo-card tp-photo-wrap"><button type="button" class="tp-photo-main" data-action="photo" data-id="${e(p.id)}"><span class="photo"><img data-media="${e(p.mediaId)}" alt="${e(p.title || "留影")}"></span><small>${e(p.title || "这一刻")}</small></button><button type="button" class="icon-btn tp-photo-del" data-action="delete-photo" data-id="${e(p.id)}" aria-label="删除照片" title="删除照片">${icon("trash", 12)}</button></div>`).join("")}</div>` : empty("把某个瞬间留下来", "支持本地上传，也可以粘贴图床或 Git 仓库里的图片网址。", "image")}</div>`;
  }'''
rep(old_album_view, new_album_view)

# 14.15 placesView (自建地点多选删除/一键清空)
rep('<div class="buttons">${button(icon("spark", 14) + " 今天去哪玩", "place-random", "", "primary")}${button(icon("plus", 14) + " 添加地点", "new-place")}</div>',
    '<div class="buttons">${button(icon("spark", 14) + " 今天去哪玩", "place-random", "", "primary")}${button(icon("plus", 14) + " 添加地点", "new-place")}</div>${custom.length ? tpDeleteBar("places", custom.length, "自建地点") : ""}')

# 14.16 logsView (运行记录多选删除/一键清空)
rep('${logs.length ? [...logs].reverse().map((l) =>',
    '${logs.length ? tpDeleteBar("logs", logs.length, "运行记录") : ""}${logs.length ? [...logs].reverse().map((l) =>')

# 15. CSS 样式扩展（删除工具栏 + 恋爱心迹专属浪漫卡片样式）
extra_css = r'''
/* ===== V1.6.3：全模块删除管理栏 & 恋爱心迹 ===== */
.tp-del-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 11px;margin:8px 0 10px;background:var(--soft);border:1px solid var(--line);border-radius:13px;font-size:11px}
.tp-del-count{color:var(--sub)}
.tp-del-count b{color:var(--ink);font-weight:600}
.tp-del-actions{display:flex;gap:6px;align-items:center}
.tp-mini-btn{padding:4px 9px!important;font-size:11px!important;border-radius:9px!important;min-height:26px!important;display:inline-flex;align-items:center;gap:4px}
.tp-note-wrap,.tp-photo-wrap{position:relative;display:flex;flex-direction:column}
.tp-note-main,.tp-photo-main{text-align:left;width:100%;flex:1}
.tp-note-del,.tp-photo-del{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:8px;background:rgba(255,255,255,.78);color:var(--danger);opacity:.78;z-index:2}
.window[data-theme=night] .tp-note-del,.window[data-theme=night] .tp-photo-del{background:rgba(36,51,42,.85)}
.tp-note-del:hover,.tp-photo-del:hover{opacity:1;background:var(--card)}
.bubble-tools button[data-action="delete-chat-msg"]{color:var(--sub);opacity:.65;margin-left:4px}
.bubble-tools button[data-action="delete-chat-msg"]:hover{color:var(--danger);opacity:1}
.heart-panel{border:1px solid #ead5d3;background:linear-gradient(180deg,#fdf8f7 0%,var(--card) 100%)}
.window[data-theme=night] .heart-panel{border-color:#5a3f42;background:linear-gradient(180deg,#2e2326 0%,var(--card) 100%)}
.heart-panel-title{display:inline-flex;align-items:center;gap:6px}
.heart-badge-icon{width:24px;height:24px;border-radius:8px;background:#f6e2df;color:#b25d63;display: inline-grid;place-items:center}
.window[data-theme=night] .heart-badge-icon{background:#4d3135;color:#e39ca1}
.heart-npc-strip{margin-top:10px;padding:8px 10px;border-radius:12px;background:rgba(246,233,228,.55);border:1px dashed #e3c8c3}
.window[data-theme=night] .heart-npc-strip{background:rgba(68,46,49,.45);border-color:#5c3f43}
.heart-npc-pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.heart-npc-pill{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:999px;background:var(--card);border:1px solid #e5ccc8;font-size:11px;color:var(--ink);transition:transform .12s,border-color .12s}
.window[data-theme=night] .heart-npc-pill{border-color:#5b4245}
.heart-npc-pill:hover{transform:translateY(-1px);border-color:#c67b80}
.heart-npc-pill.is-present{border-color:#c67b80;background:#fcf1ef}
.window[data-theme=night] .heart-npc-pill.is-present{background:#3c2a2d;border-color:#9e5f64}
.heart-npc-pill span{color:var(--sub);font-size:10px}
.heart-npc-pill .pill-tag{font-style:normal;font-size:9px;padding:1px 5px;border-radius:999px;background:#e8efe7;color:var(--accent)}
.heart-npc-pill .pill-tag.gold{background:#f2eddd;color:var(--gold)}
.heart-auto-bar{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:8px}
.heart-card{border:1px solid #ead5d3;background:linear-gradient(180deg,#fffafa 0%,var(--card) 48%);position:relative;overflow:hidden}
.window[data-theme=night] .heart-card{border-color:#573d40;background:linear-gradient(180deg,#2b2123 0%,var(--card) 48%)}
.heart-meta-strip{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;padding:5px 9px;border-radius:9px;background:var(--soft);font-size:11px;color:var(--sub)}
.heart-meta-strip b{color:var(--ink)}
.heart-title{margin:10px 0 6px;font-size:15px;color:#8e464c}
.window[data-theme=night] .heart-title{color:#e6a6ac}
.heart-box{margin:7px 0;padding:8px 10px;border-radius:11px;font-size:12px;line-height:1.55}
.heart-box b{display:block;font-size:11px;margin-bottom:2px}
.heart-box.surface{background:var(--soft);color:var(--ink)}
.heart-box.reply{background:#faecea;border-left:3px solid #c67b80;color:#5a2e32}
.window[data-theme=night] .heart-box.reply{background:#3a272a;border-left-color:#c67b80;color:#ebd3d5}
.heart-body{margin-top:8px;font-size:12.5px;line-height:1.7;white-space:pre-wrap}
.heart-secret{margin-top:9px;padding:7px 10px;border-radius:10px;border:1px dashed #dfb8b4;background:#fdf4f2;font-size:11.5px;color:#7d4247}
.window[data-theme=night] .heart-secret{border-color:#634347;background:#332325;color:#dfb2b6}
.heart-secret span{font-weight:600}
.heart-followups{margin-top:9px;border-top:1px dashed var(--line);padding-top:8px;display:flex;flex-direction:column;gap:6px}
.heart-followup-item{padding:7px 9px;border-radius:10px;background:var(--soft);font-size:11.5px;line-height:1.55}
.heart-followup-item .hf-q{color:var(--sub);margin-bottom:3px}
.heart-followup-item .hf-a{color:var(--ink);white-space:pre-wrap}
'''
rep(r".memory-card.is-off{opacity:.62}\n';", r".memory-card.is-off{opacity:.62}\n" + extra_css.strip().replace('\n', r'\n') + r"\n';")

OUT.write_text(js, encoding='utf-8')
print('written', OUT, len(js), 'chars')
