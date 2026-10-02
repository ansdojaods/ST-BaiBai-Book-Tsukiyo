#!/usr/bin/env python3
"""Patch 月夜来信 1.5.2 bundle -> 1.6.0 (柏宝书联动). Textual, anchor-based, every anchor must match exactly once."""
import pathlib, sys

# 用法: python3 apply_phone_patch.py <1.5.2 原始脚本 content 导出的 .js> <输出 .js>
# 原始脚本 = 角色卡 data.extensions.tavern_helper.scripts[id=40d8092b-...].content,或 导入版 JSON 的 content 字段。
P = pathlib.Path(__file__).resolve().parent
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else P.parent / 'base' / 'tsukiyo-phone-1.5.2.js'
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else P.parent / 'tsukiyo-phone-1.6.1.js' 
js = SRC.read_text(encoding='utf-8')
NEW_VERSION = '1.6.1'


def rep(old, new, count=1):
    global js
    n = js.count(old)
    assert n == count, f'anchor matched {n} times (expected {count}): {old[:80]!r}'
    js = js.replace(old, new)


# 0. banner + version
rep('/* 月夜来信 · 小手机 v1.5.2（',
    '/* 月夜来信 · 小手机 v1.6.1（柏宝书-月夜来信版联动：自动读取柏宝书的剧情时间/地点/在场人物作回退、柏宝书分层摘要·锚点日记·未了结计划进入手机人物与规划上下文、手机交流/约定/动态回写柏宝书【小手机】记录、一键导入柏宝书记忆与副 API 方案、经柏宝书测活渠道（密钥不经手机） · ')
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
rep(' 知情说明: mainAllowed ? ', ' 柏宝书简报: baibaiActorBrief(contact, mainAllowed), 知情说明: mainAllowed ? ')
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
        '${switchRow("启用柏宝书联动", "检测到「柏宝书-月夜来信版」(≥1.3.0) 时双向联动；关闭后手机完全独立运行", "baibai-enabled", !!bb?.prefs.enabled)}'
        '${switchRow("剧情简报进入手机上下文", "主线变量缺失时用柏宝书的剧情时间/地点兜底；人物生成与规划可参考柏宝书分层摘要、锚点日记、未了结计划、NPC 档案（只给在场或被允许读正文的人物看摘要）", "baibai-brief", !!bb?.prefs.brief)}'
        '${switchRow("在场人物兜底", "主线变量没有“当前互动NPC”时，采用柏宝书推断的在场人物", "baibai-present", !!bb?.prefs.present)}'
        '${switchRow("手机交流回写柏宝书", "新消息、约定、动态、未完约定推送到柏宝书的【小手机】外部记录，参与其正文注入与摘要；不会改动柏宝书自身的记忆", "baibai-push", !!bb?.prefs.push)}'
        '<div class="buttons">${button("立即回写", "baibai-push-now")}${button("导入柏宝书记忆", "baibai-import-memory")}${button("导入柏宝书 API 方案", "baibai-import-api")}${button("经柏宝书测活渠道", "baibai-test")}</div>'
        '<p class="form-note">只读取柏宝书公开的 window.STBaiBaiBook.phone 接口；柏宝书密钥不经过手机（“导入方案”除外，它会复制一份密钥到本机）。</p></div>')
rep('<p class="form-note">独立扩展与卡内脚本二选一即可；', card + '<p class="form-note">独立扩展与卡内脚本二选一即可；')

OUT.write_text(js, encoding='utf-8')
print('written', OUT, len(js), 'chars')
