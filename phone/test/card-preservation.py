#!/usr/bin/env python3
"""Usage: python3 test/card-preservation.py original.json upgraded.json. No private card in repository."""
import copy, hashlib, json, pathlib, re, sys
old, new = [json.loads(pathlib.Path(p).read_text(encoding='utf-8')) for p in sys.argv[1:3]]
a, b = copy.deepcopy(old), copy.deepcopy(new)
allowed = []
def compare(x, y, path=''):
    if isinstance(x, dict) and isinstance(y, dict):
        if isinstance(x.get('content'), str) and 'var TsukiyoPhoneBundle = ' in x['content']:
            assert x['id'] == y['id'] and x.get('enabled') == y.get('enabled')
            assert 'version: "2.5.0"' in y['content'] and 'v2.5' in y['name']
            def preset(s):
                start=s.index('/*@@PRESET@@*/')+len('/*@@PRESET@@*/')
                return json.JSONDecoder().raw_decode(s[start:])[0]
            assert preset(x['content']) == preset(y['content']), 'Embedded preset changed'
            for k in ['content','name','info']: x.pop(k,None); y.pop(k,None)
            allowed.append(path)
        if path.endswith('/extensions/tsukiyo_phone'):
            assert y['version'] == '2.5.0'
            for k in ['version','source_file','note','source_sha256','avs','studio']: x.pop(k,None); y.pop(k,None)
        assert set(x)==set(y),(path,set(x)^set(y))
        for k in x: compare(x[k],y[k],path+'/'+k)
    elif isinstance(x,list) and isinstance(y,list):
        assert len(x)==len(y),path
        for i,(v,w) in enumerate(zip(x,y)): compare(v,w,path+'/'+str(i))
    else: assert x==y,path
compare(a,b)
p = new['data']['extensions']['tsukiyo_preset']
assert len(p['contacts'])==96 and all(c['reachable'] and c['recognized'] for c in p['contacts'])
print('CARD_PRESERVATION_OK: only phone code/name/info and phone metadata changed')
print('customized scripts:',len(allowed),'contacts:',len(p['contacts']),'places:',len(p['places']),'openings:',len(p['openings']))
print('worldbook entries:',len(new['data']['character_book']['entries']))
print('embedded preset identical; character title/version, greetings, worldbook, other scripts, regex unchanged')
