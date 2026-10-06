#!/usr/bin/env python3
"""Strict v2.0.0 -> v2.5.0 native workbench patch, including customized card engines."""
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parent.parent

def upgrade(js):
    def rep(old,new):
        nonlocal js
        assert js.count(old)==1, f'v2.5 anchor mismatch ({js.count(old)}): {old[:110]}'
        js=js.replace(old,new)
    rep('/* 月夜来信 · 小手机 v2.0（','/* 月夜来信 · 小手机 v2.5（可编辑视觉资料库 · 剧情工作台 · ')
    rep('name: "tsukiyo-phone", version: "2.0.0"','name: "tsukiyo-phone", version: "2.5.0"')
    rep('var MODULES = Object.freeze({ visual:', 'var MODULES = Object.freeze({ director: "候选事件导演", parallel: "离场NPC侧写", world: "世界状态审核", visual:')
    rep('revision: 0, visual: avsFresh(), arc:', 'revision: 0, studio: studioFresh(), visual: avsFresh(), arc:')
    rep('    avsValidate(data.visual);', '    studioValidate(data.studio);\n    avsValidate(data.visual);')
    module=(ROOT/'src/studio/core.js').read_text(encoding='utf-8')+'\n'+(ROOT/'src/studio/ui.js').read_text(encoding='utf-8')
    rep('  var PhoneEngine = class {',module+'\n  var PhoneEngine = class {')
    rep('      this.visual = new VisualArchive(this);','      this.visual = new VisualArchive(this);\n      this.studio = new StoryStudio(this);')
    rep('      this.visual.dispose();','      this.visual.dispose();\n      this.studio.dispose();')
    rep('          this.visual.status = "";','          this.studio.status = "";\n          this.studio.lastRequest = null;\n          this.visual.status = "";')
    rep('    if (action.startsWith("avs-"))', '    if (action.startsWith("st-")) return studioAction(ui, action, value);\n    if (action.startsWith("avs-"))')
    rep('  var apps = [["visual",','  var apps = [["studio", "剧情工作台", "compass", "sand"], ["visual",')
    rep('  var views = { visual:', '  var views = { studio: studioView, visual:')
    rep('    title() {\n', '    title() {\n      if (this.route.view === "studio") return "剧情工作台";\n')
    rep('const value = compileInjection(this.repo.data, this.repo.snapshot) + (this.settings.isEnabled("visual") ? avsProjection(this.repo.data, this.repo.snapshot) : ""), hash =',
        'const value = compileInjection(studioBasePhone(this.repo.data, this.repo.snapshot, this.settings), this.repo.snapshot) + (this.settings.isEnabled("visual") ? avsProjection(this.repo.data, this.repo.snapshot) : "") + studioProjection(this.repo.data, this.repo.snapshot, this.settings), hash =')
    rep('blocks = compileArcInjection(s, snap) || {};','blocks = this.settings.isEnabled("director") && studioDirectorOn(s, snap) ? {} : compileArcInjection(s, snap) || {};')
    rep('return !this.stopped && !eng.disposed && eng.state === "ready" && !!eng.repo.data && !!eng.repo.snapshot;',
        'return !this.stopped && !eng.disposed && eng.state === "ready" && !!eng.repo.data && !!eng.repo.snapshot && !(eng.settings.isEnabled("director") && studioDirectorOn(eng.repo.data, eng.repo.snapshot));')
    rep('const next = nextAutomatic(data, snapshot2, Date.now(), (m) => this.settings.isEnabled(m));',
        'const next = nextAutomatic(data, snapshot2, Date.now(), (m) => this.settings.isEnabled(m) && !(m === "planner" && this.settings.isEnabled("director") && studioDirectorOn(data, snapshot2)));')
    rep('const alive = () => !this.stopped && !this.abortAuto && !eng.disposed && eng.state === "ready" && (manual || owns());',
        'const alive = () => !this.stopped && !this.abortAuto && !eng.disposed && eng.state === "ready" && (manual || owns()) && !(eng.settings.isEnabled("director") && studioDirectorOn(eng.repo.data, eng.repo.snapshot));')
    rep('  function baibaiEnrichRequest(module, request) {', '  function baibaiEnrichRequest(module, request) {\n    if (["director", "parallel", "world"].includes(module)) return request;')
    rep('const origin = e.bridge.capture(), snapSignature = origin.signature;', 'const origin = e.bridge.capture(), snapSignature = origin.signature;\n      assert(e.repo.snapshot?.owner === origin.owner && e.repo.snapshot?.signature === origin.signature, "聊天/正文正在刷新，请稍后再同步");')
    # Editor overrides live in chat state, not a mutation of the constant library.
    start=js.index('  function visualRulesView(ui) {')
    end=js.index('  async function handleVisualAction(',start)
    js=js[:start]+'  function visualRulesView(ui) { return studioRuleView(ui); }\n'+js[end:]
    rep('const rulesText = AVS_KNOWLEDGE.filter(r => AVS_RULE_TITLES.includes(r.title.split("] ").at(-1))).map(r => r.title + "\\n" + r.text.split("\\n").filter(line => line.startsWith("本条主题：")).join("\\n")).join("\\n").slice(0, 3000);',
        'const rulesText = studioRulePrompt(e.repo.data).text;')
    rep('sigOf: s => fingerprint(avsData(s))','sigOf: s => fingerprint([avsData(s), studioData(s).rules])')
    rep('AVS · VISUAL ARCHIVE / 2.0','AVS · VISUAL ARCHIVE / 2.5')
    rep('button("规则资料库", "go", "visualRules")','button("编辑视觉资料库", "go", "visualRules")')
    # Demo returns the same explicit schemas as production parsers. Never calls an external model.
    rep('    if (module === "visual") {', '''    if (module === "director") return JSON.stringify({events:[{title:"演示 · 临窗的一阵风",weight:10,secret:"作者备忘：只是一个日常提议。",stages:[{hook:"窗边一张便笺被风吹到桌角，留待玩家决定是否查看。",condition:"正文实际提到便笺"},{hook:"如果有人拾起便笺，可发现它是一份未完成的购物清单。",condition:"正文实际核对清单"}]}]});
    if (module === "parallel") return JSON.stringify({portraits:(payload.npcs||[]).map(c=>({contactId:c.contactId,text:c.name+"在自己的休息处整理手边物品，暂时不知主角现场发生了什么。这是演示草稿。",summary:"整理物品的候选片段"}))});
    if (module === "world") return JSON.stringify({updates:[]});
    if (module === "visual") {''')
    # Visible entry from the existing planning page, no second disconnected planner.
    anchor='  function arcPlanView(ui) {'
    assert js.count(anchor)==1
    rep(anchor,'  function arcPlanViewOriginal(ui) {')
    rep('  var views = { studio:', '  function arcPlanView(ui) { return `<div class="pad"><div class="buttons">${button("v2.5事件池 / NPC侧写 / 世界状态", "go", "studio")}</div>${studioDirectorOn(ui.data, ui.snapshot) ? hint("当前由事件导演提供阶段钩子；旧点线面自动推演和规划注入暂时让行，原数据保留。") : ""}</div>` + arcPlanViewOriginal(ui); }\n  var views = { studio:')
    return js

if __name__=='__main__':
    src=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'tsukiyo-phone-2.0.0.js'
    dest=Path(sys.argv[2]) if len(sys.argv)>2 else ROOT/'tsukiyo-phone-2.5.0.js'
    dest.write_text(upgrade(src.read_text(encoding='utf-8')),encoding='utf-8')
    print('written',dest)
