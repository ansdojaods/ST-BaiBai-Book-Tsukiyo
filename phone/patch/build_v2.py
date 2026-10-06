#!/usr/bin/env python3
"""Reproducible v2 build, optionally upgrade an existing customized character-card IN PLACE in memory.
Never replaces a customized card engine with the generic engine, never rewrites story/worldbook/preset.
"""
import argparse, hashlib, json, pathlib, re, subprocess, sys
from apply_visual_patch import upgrade
ROOT = pathlib.Path(__file__).resolve().parent.parent
NOTE = 'v2.0：AVS原生视觉档案、七页查看、290条规则检索、分批事务回扫、旧AVS普通外观迁移。自动同步与正文注入默认关闭；模型调用另行计费。卡内与独立手机二选一，停用原AVS核心与浮窗；未知外观不补写。'

def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def build_card(path, out):
    card = json.loads(path.read_text(encoding='utf-8'))
    count = 0
    def walk(obj):
        nonlocal count
        if isinstance(obj, list):
            for x in obj: walk(x)
        elif isinstance(obj, dict):
            content = obj.get('content')
            if isinstance(content, str) and 'var TsukiyoPhoneBundle = ' in content and 'name: "tsukiyo-phone", version: "1.6.3"' in content:
                obj['content'] = upgrade(content)
                old_name = obj.get('name', '月夜来信 · 小手机')
                old_name = re.sub(r'(?:小手机\s*)?v?1\.6\.3', '', old_name).strip()
                obj['name'] = old_name + ' · 小手机v2.0（AVS视觉档案）'
                obj['info'] = (obj.get('info') or '').replace('1.6.3', '2.0') + '\n' + NOTE
                count += 1
                return
            for x in obj.values(): walk(x)
    walk(card)
    assert count >= 1, '没有找到1.6.3月夜来信脚本；为避免覆盖未知定制版本，已停止'
    for container in [card, card.get('data', {})]:
        ext = container.get('extensions', {})
        if 'tsukiyo_phone' in ext:
            meta = ext['tsukiyo_phone']
            meta.update(version='2.0.0', source_file='tsukiyo-phone-2.0.0.js', note='卡内手机v2.0，保留原卡剧情、联系人与开场适配。' + NOTE)
            meta['source_sha256'] = hashlib.sha256((ROOT / 'tsukiyo-phone-2.0.0.js').read_bytes()).hexdigest()
            meta['avs'] = {'native': True, 'autoDefault': False, 'injectDefault': False, 'knowledgeEntries': 290, 'legacyReadOnly': True}
    name = path.stem + '_小手机v2.0_AVS.json'
    dump(out / name, card)
    print('card ->', out / name, '| customized scripts:', count)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--outdir', type=pathlib.Path, default=ROOT / 'releases')
    ap.add_argument('--standalone', type=pathlib.Path, default=ROOT / 'patch/standalone-template.json')
    ap.add_argument('--card', type=pathlib.Path)
    args = ap.parse_args()
    # Preserve the previous patch chain and verify reproducibility, no network required.
    subprocess.run([sys.executable, str(ROOT / 'patch/apply_phone_patch.py'), str(ROOT / 'base/tsukiyo-phone-1.5.2.js'), str(ROOT / 'tsukiyo-phone-1.6.3.js')], check=True)
    js = upgrade((ROOT / 'tsukiyo-phone-1.6.3.js').read_text(encoding='utf-8'))
    (ROOT / 'tsukiyo-phone-2.0.0.js').write_text(js, encoding='utf-8')
    st = json.loads(args.standalone.read_text(encoding='utf-8'))
    st.update(content=js, name='月夜来信 · 小手机 v2.0（AVS视觉档案 · 柏宝书联动）', info=NOTE)
    dest = args.outdir / '月夜来信小手机_酒馆助手导入版_v2.0_AVS视觉档案.json'
    dump(dest, st)
    print('standalone ->', dest, '| script id preserved:', st.get('id'))
    if args.card: build_card(args.card, args.outdir)
    print('bundle sha256', hashlib.sha256(js.encode()).hexdigest())

if __name__ == '__main__': main()
