#!/usr/bin/env python3
"""Build v2.5.0 from original baseline. Upgrade a supplied v1.6.3/v2.0 customized card without replacing its adaptations."""
import argparse,hashlib,json,pathlib,re,subprocess,sys
from apply_visual_patch import upgrade as visual_upgrade
from apply_studio_patch import upgrade as studio_upgrade
ROOT=pathlib.Path(__file__).resolve().parent.parent
NOTE='v2.5：可编辑视觉资料库；候选事件池与分阶段导演；离场NPC侧写草稿；审核式世界状态；本存档亲历记忆。新推演仅手动调用，注入默认关闭。原AVS、事件导演、NPC后台请避免重复启用。'
def dump(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def upgrade_content(content):
    if 'name: "tsukiyo-phone", version: "1.6.3"' in content:content=visual_upgrade(content)
    assert 'name: "tsukiyo-phone", version: "2.0.0"' in content,'只支持已核对的1.6.3或2.0.0引擎；不覆盖未知定制版本'
    return studio_upgrade(content)
def card_build(path,out,js):
    card=json.loads(path.read_text(encoding='utf-8')); hits=0
    def walk(obj):
        nonlocal hits
        if isinstance(obj,list):
            for x in obj:walk(x)
        elif isinstance(obj,dict):
            content=obj.get('content')
            if isinstance(content,str) and 'var TsukiyoPhoneBundle = ' in content:
                obj['content']=upgrade_content(content)
                name=obj.get('name','月夜来信 · 小手机')
                if 'v2.0' in name:name=name.replace('v2.0','v2.5')
                elif '1.6.3' in name:name=name.replace('1.6.3','2.5')
                else:name+=' · 小手机v2.5'
                obj['name']=name.replace('（AVS视觉档案）','（视觉编辑 · 剧情工作台）')
                obj['info']=(obj.get('info') or '').replace('v2.0','v2.5').replace('1.6.3','2.5')+'\n'+NOTE
                hits+=1;return
            for x in obj.values():walk(x)
    walk(card);assert hits>=1,'卡内没有匹配的手机脚本'
    for container in [card,card.get('data',{})]:
        ext=container.get('extensions',{})
        if 'tsukiyo_phone' in ext:
            m=ext['tsukiyo_phone'];m.update(version='2.5.0',source_file='tsukiyo-phone-2.5.0.js',source_sha256=hashlib.sha256(js.encode()).hexdigest(),note=NOTE)
            m.setdefault('avs',{}).update(native=True,autoDefault=False,injectDefault=False,knowledgeEntries=290,editable=True,rulesScope='chat')
            m['studio']={'version':1,'auto':False,'crossWorldMemory':False,'reviewRequired':True}
    stem=re.sub(r'_小手机v2\.0.*$','',path.stem)
    dest=out/(stem+'_小手机v2.5_剧情工作台.json');dump(dest,card);print('card ->',dest,'scripts',hits)
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--outdir',type=pathlib.Path,default=ROOT/'releases');ap.add_argument('--card',type=pathlib.Path);ap.add_argument('--standalone',type=pathlib.Path,default=ROOT/'patch/standalone-template.json');a=ap.parse_args()
    subprocess.run([sys.executable,str(ROOT/'patch/apply_phone_patch.py'),str(ROOT/'base/tsukiyo-phone-1.5.2.js'),str(ROOT/'tsukiyo-phone-1.6.3.js')],check=True)
    js=upgrade_content((ROOT/'tsukiyo-phone-1.6.3.js').read_text(encoding='utf-8'))
    (ROOT/'tsukiyo-phone-2.5.0.js').write_text(js,encoding='utf-8')
    standalone=json.loads(a.standalone.read_text(encoding='utf-8'));standalone.update(content=js,name='月夜来信 · 小手机 v2.5（视觉编辑 · 剧情工作台 · 柏宝书联动）',info=NOTE)
    dump(a.outdir/'月夜来信小手机_酒馆助手导入版_v2.5_剧情工作台.json',standalone)
    if a.card:card_build(a.card,a.outdir,js)
    print('bundle sha256',hashlib.sha256(js.encode()).hexdigest())
if __name__=='__main__':main()
