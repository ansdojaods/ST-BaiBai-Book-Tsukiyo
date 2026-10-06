// Test user-supplied customized card engine without adding private card content to this repository.
const fs=require('fs'),{JSDOM}=require('jsdom'),A=require('node:assert/strict');
const card=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const script=card.data.extensions.tavern_helper.scripts.find(s=>s.content?.includes('var TsukiyoPhoneBundle = '));
let js=script.content.slice(0,script.content.lastIndexOf('TsukiyoPhoneBundle.start('));
js=js.replace('    VERSION: () => VERSION,','    CardTest: () => ({ seedFromHost, normalizePhone, contactAvailable }),\n    VERSION: () => VERSION,');
const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',url:'https://card.test/'});
dom.window.eval(js+'\nwindow.B=TsukiyoPhoneBundle;');
const B=dom.window.B,T=B.CardTest, preset=card.data.extensions.tsukiyo_preset;
for(const [id,state] of Object.entries(preset.openings)){
 const snap={owner:'card-test',floor:0,tail:0,lineage:['seed'],signature:'seed',stat:state,present:state.在场||[],history:[{floor:0,role:'assistant',text:`<df-opening id="${id}"/>`}],character:{name:card.data.name,avatar:'card.png'},story:{date:state.世界?.日期||'',time:state.世界?.时刻||'',place:state.世界?.地点||''},userName:'许七安'};
 const s=T.normalizePhone(T.seedFromHost(snap));
 A.equal(s.contacts.length,96,id);
 A.ok(s.contacts.every(T.contactAvailable),id+' contacts must remain reachable');
 A.equal(s.visual.auto,false);A.equal(s.visual.inject,false);A.equal(s.studio.config.directorInject,false);A.equal(s.studio.config.worldInject,false);
}
A.equal(B.VERSION,'2.5.0');
console.log('CARD_ENGINE_OK: all '+Object.keys(preset.openings).length+' openings; 96/96 contacts available; AVS defaults OFF');
dom.window.close();
