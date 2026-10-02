#!/usr/bin/env python3
"""把打补丁后的小手机脚本写回 酒馆助手导入版 JSON 与 臭小鬼角色卡 JSON。

用法:
  python3 build_json.py <bundle.js> <输出目录> [--card 原角色卡.json] [--standalone 原导入版.json]

- 只替换脚本 content / 名称 / info,以及角色卡的 character_version 与 extensions.tsukiyo_phone.version;
  角色卡其它内容(其它脚本、世界书、正则、开场白)原样保留。
"""
import argparse, hashlib, json, pathlib, re, sys

PHONE_SCRIPT_ID = '40d8092b-4cf1-49b4-ae06-2217020db2f1'
NOTE = (' v1.6.3：可选实时读取百宝月夜书记忆，涵盖消息、主动来信、朋友圈与评论、日记、'
        '备忘、清单、日历、规划与记忆整理；读取与回写开关独立。公开动态/群聊不加入全局私密摘要。'
        '手机记忆页可切换读取和预览，无需额外服务器插件。导入副本默认仅玩家知情。'
        '本版同步事项取消、完成、停用与删除状态，撤销旧置顶；不清空窗口外消息历史。')


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
        st['name'] = f'月夜来信 · 小手机（独立版）v{ver}（百宝月夜书联动）'
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
                s['name'] = f'月夜来信 · 小手机 {ver}（百宝月夜书联动）'
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
        tp['baibai'] = {'minVersion': '1.3.0', 'name': '百宝月夜书', 'api': 'window.STBaiBaiBook.phone',
                        'events': ['st-baibai-book:phone-update', 'st-baibai-book:changed'], 'source': 'tsukiyo-phone',
                        'note': '仅读取柏宝书公开接口；手机数据仍只写入自己的命名空间'}
        p = out / f'臭小鬼_月夜来信_V3.5_小手机{ver}_柏宝书联动.json'
        p.write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding='utf-8')
        print('card ->', p, '| character_version =', cv)
    print('bundle md5', hashlib.md5(js.encode('utf-8')).hexdigest(), 'version', ver)
    return 0


if __name__ == '__main__':
    sys.exit(main())
