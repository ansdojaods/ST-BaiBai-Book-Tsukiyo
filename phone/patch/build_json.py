#!/usr/bin/env python3
"""把打补丁后的小手机脚本写回 酒馆助手导入版 JSON 与 臭小鬼角色卡 JSON。

用法:
  python3 build_json.py <bundle.js> <输出目录> [--card 原角色卡.json] [--standalone 原导入版.json]

- 只替换脚本 content / 名称 / info,以及角色卡的 character_version 与 extensions.tsukiyo_phone.version;
  角色卡其它内容(其它脚本、世界书、正则、开场白)原样保留。
"""
import argparse, hashlib, json, pathlib, re, sys

PHONE_SCRIPT_ID = '40d8092b-4cf1-49b4-ae06-2217020db2f1'
NOTE = (' v1.6.x：柏宝书-月夜来信版联动——主线变量缺失时用柏宝书的剧情时间/地点/在场人物兜底；'
        '柏宝书分层摘要、锚点日记、未了结计划、NPC 档案进入人物与规划上下文（遵守知情边界）；'
        '手机消息/约定/动态/未完约定回写柏宝书【小手机】记录；一键导入柏宝书记忆与副 API 方案；'
        '经柏宝书测活渠道（密钥不经手机）。未安装柏宝书-月夜来信版（≥1.3.0）时自动退化为 1.5.2 行为。')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('bundle')
    ap.add_argument('outdir')
    ap.add_argument('--card')
    ap.add_argument('--standalone')
    a = ap.parse_args()
    js = pathlib.Path(a.bundle).read_text(encoding='utf-8')
    m = re.search(r'var package_default = \{ name: "tsukiyo-phone", version: "([\d.]+)"', js)
    if not m:
        print('bundle 里找不到版本号', file=sys.stderr)
        return 1
    ver = m.group(1)
    short = '.'.join(ver.split('.')[:2])
    out = pathlib.Path(a.outdir)
    out.mkdir(parents=True, exist_ok=True)
    if a.standalone:
        st = json.load(open(a.standalone, encoding='utf-8'))
        st['content'] = js
        st['name'] = f'月夜来信 · 小手机（独立版）v{short}（柏宝书-月夜来信版联动）'
        if NOTE not in (st.get('info') or ''):
            st['info'] = (st.get('info') or '') + NOTE
        p = out / f'月夜来信小手机_酒馆助手导入版_v{ver}_柏宝书联动.json'
        p.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding='utf-8')
        print('standalone ->', p)
    if a.card:
        card = json.load(open(a.card, encoding='utf-8'))
        d = card['data']
        hit = 0
        for s in d['extensions']['tavern_helper']['scripts']:
            if s['id'] == PHONE_SCRIPT_ID:
                s['content'] = js
                s['name'] = f'月夜来信 · 小手机 {ver}（柏宝书-月夜来信版联动）'
                if NOTE not in (s.get('info') or ''):
                    s['info'] = (s.get('info') or '') + NOTE
                hit += 1
        if hit != 1:
            print(f'角色卡里小手机脚本命中 {hit} 次(应为 1)', file=sys.stderr)
            return 1
        cv = f'3.5.0-tsukiyo-phone-{ver}'
        d['character_version'] = cv
        card['character_version'] = cv
        tp = d['extensions'].setdefault('tsukiyo_phone', {})
        tp['version'] = ver
        tp['baibai'] = {'minVersion': '1.3.0', 'name': '柏宝书-月夜来信版', 'api': 'window.STBaiBaiBook.phone',
                        'events': ['st-baibai-book:phone-update', 'st-baibai-book:changed'], 'source': 'tsukiyo-phone',
                        'note': '仅读取柏宝书公开接口；手机数据仍只写入自己的命名空间'}
        p = out / f'臭小鬼_月夜来信_V3.5_小手机{ver}_柏宝书联动.json'
        p.write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding='utf-8')
        print('card ->', p, '| character_version =', cv)
    print('bundle md5', hashlib.md5(js.encode('utf-8')).hexdigest(), 'version', ver)
    return 0


if __name__ == '__main__':
    sys.exit(main())
