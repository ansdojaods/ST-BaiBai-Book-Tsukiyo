#!/usr/bin/env python3
"""Upgrade stock OR card-customized 1.6.3 bundle to 2.0.0; fail closed on changed anchors."""
import json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent

def upgrade(js):
    def rep(old, new):
        nonlocal js
        n = js.count(old)
        assert n == 1, f'v2 anchor matched {n} times: {old[:100]!r}'
        js = js.replace(old, new)
    rep('/* 月夜来信 · 小手机 v1.6.3（', '/* 月夜来信 · 小手机 v2.0（AVS原生视觉档案 · ')
    rep('name: "tsukiyo-phone", version: "1.6.3"', 'name: "tsukiyo-phone", version: "2.0.0"')
    rep('var MODULES = Object.freeze({ chat:', 'var MODULES = Object.freeze({ visual: "AVS视觉档案", chat:')
    rep('return { schema: 1, revision: 0, arc:', 'return { schema: 1, revision: 0, visual: avsFresh(), arc:')
    rep('    validateArc(data.arc);', '    avsValidate(data.visual);\n    validateArc(data.arc);')
    mod = (ROOT / 'src/avs/visual.js').read_text(encoding='utf-8')
    knowledge = json.loads((ROOT / 'src/avs/knowledge.json').read_text(encoding='utf-8'))
    mod = mod.replace('/*@@AVS_KNOWLEDGE@@*/[]', json.dumps(knowledge, ensure_ascii=False, separators=(',', ':')))
    rep('  var PhoneEngine = class {', mod + '\n\n  var PhoneEngine = class {')
    rep('      this.baibai = new BaiBaiLink(this);', '      this.baibai = new BaiBaiLink(this);\n      this.visual = new VisualArchive(this);')
    rep('        this.enabledFlags = flags;\n        this.emit();', '        this.enabledFlags = flags;\n        this.updatePrompt();\n        this.emit();')
    rep('      this.timer = setInterval(() => this.refresh(), 2200);', '      this.timer = setInterval(async () => { await this.refresh(); if (!this.disposed) this.visual.tick().catch(() => {}); }, 2200);')
    rep('          this.lastOwner = owner;\n        }', '          this.lastOwner = owner;\n          this.visual.status = "";\n          this.visual.lastAutoKey = "";\n        }')
    rep('const value = compileInjection(this.repo.data, this.repo.snapshot), hash =', 'const value = compileInjection(this.repo.data, this.repo.snapshot) + (this.settings.isEnabled("visual") ? avsProjection(this.repo.data, this.repo.snapshot) : ""), hash =')
    rep('      this.baibai.stop();', '      this.baibai.stop();\n      this.visual.dispose();')
    rep('    const engine = ui.engine;\n    if (action.startsWith("arc-"))', 'unused') if False else None
    rep('    if (action.startsWith("arc-") || action.startsWith("diag-"))', '    if (action.startsWith("avs-")) return handleVisualAction(ui, action, value);\n    if (action.startsWith("arc-") || action.startsWith("diag-"))')
    rep('  var apps = [["messages",', '  var apps = [["visual", "视觉档案", "image", "blue"], ["messages",')
    rep('  var views = { messages:', '  var views = { visual: visualView, visualRules: visualRulesView, messages:')
    rep('    title() {\n', '    title() {\n      if (this.route.view === "visual") return "视觉档案";\n      if (this.route.view === "visualRules") return "视觉规则资料库";\n')
    rep('    if (module === "chat") {\n      const members = meta.thread.members;', '    if (module === "visual") { const quote = "未夜把稿纸挪离杯沿"; return JSON.stringify({ characters: [{ name: "春山未夜", profile: { state: { "动作": { value: "把稿纸挪离杯沿", evidence: quote } } } }] }); }\n    if (module === "chat") {\n      const members = meta.thread.members;')
    return js

if __name__ == '__main__':
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'tsukiyo-phone-1.6.3.js'
    out = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'tsukiyo-phone-2.0.0.js'
    out.write_text(upgrade(src.read_text(encoding='utf-8')), encoding='utf-8')
    print('written', out)
