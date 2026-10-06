  // src/studio/ui.js — editable AVS library + event/NPC/state workbench.
  function studioRuleView(ui) {
    const q=ui.avsRuleQuery||"", rows=studioRules(ui.data), all=rows.filter(r=>!q||(r.title+" "+r.keys.join(" ")+" "+r.text).includes(q));
    const page=Math.max(0,Math.min(ui.avsRulePage||0,Math.ceil(all.length/12)-1)), prompt=studioRulePrompt(ui.data);
    return `<div class="pad"><div class="overline">VISUAL LIBRARY · 2.5</div><h2>视觉资料库 · 可编辑</h2>${hint("本聊天独立保存修改，不改原世界书或其他卡。启用表示保留资料；“参与分析”才送入视觉API。适龄与事实规则仍优先。")}
      <div class="buttons">${button("新增条目","st-rule-new")}${button("搜索","st-rule-search")}${button("清除搜索","st-rule-clear")}${button("导入JSON","st-rule-import")}${button("导出JSON","st-rule-export")}</div>
      <p>${all.length} / ${rows.length} 条 · 第${page+1}/${Math.max(1,Math.ceil(all.length/12))}页</p><p class="tiny muted">本次分析规则预算 ${prompt.text.length}/6000 字符；实际采用 ${prompt.used.length} 条，超预算跳过 ${prompt.omitted.length} 条。${q?"搜索："+e(q):""}</p>
      ${all.slice(page*12,page*12+12).map(r=>`<details class="card"><summary>${e(r.title)} ${!r.enabled?"〔停用〕":""}${r.edited?"〔已修改〕":""}</summary><small>${r.builtin?"内置资料的本聊天副本":"自建资料"} · ${r.use?"已选参与分析":"仅资料库阅读"}${prompt.omitted.includes(r.id)?" · 超预算未送入模型":""}</small><p>${e(r.keys.join(" · "))}</p><p style="white-space:pre-wrap;overflow-wrap:anywhere">${e(r.text)}</p><div class="buttons">${button("编辑","st-rule-edit",r.id)}${button(r.enabled?"停用":"启用","st-rule-toggle",r.id)}${button(r.use?"移出分析":"加入分析","st-rule-use",r.id)}${button(r.builtin?"恢复原条目":"删除","st-rule-reset",r.id)}</div></details>`).join("")}
      <div class="buttons">${button("上一页","st-rule-page",String(Math.max(0,page-1)))}${button("下一页","st-rule-page",String(Math.min(Math.max(0,Math.ceil(all.length/12)-1),page+1)))}${button("恢复全部默认","st-rule-reset-all")}</div></div>`;
  }
  function studioWho(s,id2){return s.contacts.find(c=>c.id===id2)?.name||"已移除人物";}
  function studioView(ui) {
    const eng=ui.engine,s=ui.data,st=studioData(s),snap=ui.snapshot,tab=ui.studioTab||"events";
    let body="";
    if(tab==="events"){
      const a=st.active,valid=studioValid(a,snap);
      body=`${hint("事件池一次生成、分阶段使用；只向主模型提供当前钩子，不泄露后续阶段或后台备注。没有自动连环调用，候选不等于已发生。")}
        <div class="buttons">${button("生成候选池 · 1次API","st-generate","director")}${button("手写事件","st-event-new")}${button("按概率抽取","st-roll")}${button("导演注入："+(st.config.directorInject?"开":"关"),"st-toggle","directorInject")}</div>
        <p>触发概率 ${st.config.probability}% · 冷却 ${st.config.cooldown} 条消息；每个正文前缀最多抽一次。候选有效期40条消息。</p>
        ${a?`<div class="card"><h3>${e(a.event.title)} · ${a.index+1}/${a.event.stages.length}</h3>${!valid?hint("来源分支已失效：当前不注入，请取消后重建",true):""}<p>${e(a.event.stages[a.index].hook)}</p><small>推进依据：${e(a.event.stages[a.index].condition||"由你核对实际正文")}</small><div class="buttons">${button(a.index+1===a.event.stages.length?"确认已收束":"核实正文后下一阶段","st-next")}${button("取消当前事件","st-event-stop")}</div><details><summary>作者后台（剧透）</summary><p>${e(a.event.secret||"无")}</p>${a.event.stages.map((t,i)=>`<p>${i+1}. ${e(t.hook)}</p>`).join("")}</details></div>`:empty("没有执行中的事件","可以先查看候选，再选择启用；抽取未命中也不会改写剧情。","compass")}
        ${[...st.pool].reverse().map(r=>`<details class="card"><summary>${e(r.title)} · ${e(r.status)}${studioValid(r,snap)?"":" · 旧分支"}</summary><p>权重 ${r.weight} · ${r.stages.length} 阶段</p><p>${e(r.secret)}</p>${r.stages.map((t,i)=>`<p>${i+1}. ${e(t.hook)}<br><small>${e(t.condition)}</small></p>`).join("")}<div class="buttons">${r.status==="candidate"?button("启用此事件","st-event-start",r.id):""}${button("删除候选","st-event-delete",r.id)}</div></details>`).join("")}`;
    } else if(tab==="parallel"){
      const eligible=new Set(studioEligible(s,snap).map(r=>r.id));
      body=`${hint("借鉴众生侧写：仅本轮明确确认离场的人可生成，现场/被正文点名者保守跳过。确认离场随新正文失效；未知不当作离场。每次最多3人、1次API，无自动补漏。")}
        <div class="buttons">${button("从联系人加入名单","st-roster-add")}${button("生成本轮离场侧写","st-generate","parallel")}</div>
        ${st.roster.map(r=>`<div class="card"><h3>${e(studioWho(s,r.contactId))} ${eligible.has(r.id)?"· 可生成":"· 待确认/现场保护"}</h3><p>${e(r.note)}</p><div class="buttons">${button("确认本轮离场","st-roster-absent",r.id)}${button("编辑参考","st-roster-edit",r.id)}${button("移出名单","st-roster-delete",r.id)}</div></div>`).join("")}
        ${st.drafts.filter(r=>r.kind==="parallel").slice().reverse().map(r=>`<details class="card"><summary>${e(studioWho(s,r.contactId))} · ${r.status==="pending"?"侧写草稿":"已收藏草稿"}${studioValid(r,snap)?"":" · 来源分支失效"}</summary><p style="white-space:pre-wrap">${e(r.text)}</p><small>不自动进入正文、不自动变为记忆或世界事实。</small><div class="buttons">${r.status==="pending"?button("收藏草稿（不注入）","st-portrait-keep",r.id):""}${button("删除","st-draft-delete",r.id)}</div></details>`).join("")}`;
    } else if(tab==="world"){
      body=`${hint("借鉴世界引擎的增量与审核机制。只更新手机里的位置/状态/有效期，不修改联系人性格、关系基线或MVU，不新增人物。现场角色不做场外演化。时间取剧情而非电脑日期。")}
        <div class="buttons">${button("从正文提取状态建议","st-generate","world")}${button("手动设置状态","st-state-edit")}${button("场外状态注入："+(st.config.worldInject?"开":"关"),"st-toggle","worldInject")}</div>
        ${st.states.map(r=>`<div class="card"><h3>${e(studioWho(s,r.contactId))}</h3><p>${e(r.location)} · ${e(r.status)}</p><small>${r.until?"有效至 "+e(r.until):"未设截止"} · ${studioStateCurrent(r,s,snap)?"当前分支有效":"已过期/分支失效/剧情时钟未知"}</small><div class="buttons">${button("编辑","st-state-edit",r.contactId)}${button("移除","st-state-delete",r.id)}</div></div>`).join("")}
        <h3>待审核状态建议</h3>${st.drafts.filter(r=>r.kind==="world"&&r.status==="pending").map(r=>`<div class="card"><b>${e(studioWho(s,r.contactId))}</b><p>${e(r.location)} · ${e(r.text)}</p><details><summary>正文依据</summary><p>${e(r.evidence)}</p></details>${!studioValid(r,snap)?hint("来源分支失效，不可采用"):""}<div class="buttons">${button("核准采用","st-state-approve",r.id)}${button("忽略/删除","st-draft-delete",r.id)}</div></div>`).join("")}`;
    } else if(tab==="memories"){
      body=`${hint("采用CMCC的亲历与存档隔离原则，不自动跨卡迁移、不强行添加同伴。这里的记忆必须由你核准，只给明确列出的亲历人；其他NPC不能读到。")}
        <div class="buttons">${button("登记本人共同经历","st-memory-new")}${button("亲历记忆注入："+(st.config.memoryInject?"开":"关"),"st-toggle","memoryInject")}</div>
        ${st.memories.slice().reverse().map(m=>`<div class="card"><b>${e(m.witnesses.map(i=>studioWho(s,i)).join("、"))}</b><p>${e(m.text)}</p><small>${studioValid(m,snap)?"当前存档有效":"旧分支失效"}</small><details><summary>依据</summary><p>${e(m.evidence)}</p></details><div class="buttons">${button("编辑","st-memory-edit",m.id)}${button("删除","st-memory-delete",m.id)}</div></div>`).join("")}`;
    } else {
      body=`${hint("新工作台只有手动模型调用，合计上限12次/小时，失败也计数。所有注入默认关闭。与其他事件/NPC插件同时开启时可能重复消费，请自行停用重复功能。")}
        <div class="buttons">${button("输入与节奏配置","st-config")}${button("API分配","go","api")}${button("预览下次事件请求","st-preview","director")}${button("预览下次侧写请求","st-preview","parallel")}${button("预览下次状态请求","st-preview","world")}${button("查看上次实际输入","st-last-request")}${button("导出工作台数据","st-export")}${button("清理已处理草稿","st-clean")}</div>
        <p>正文输入 ${st.config.context?"开":"关"} · 人物资料 ${st.config.contacts?"开":"关"} · 本人亲历记忆 ${st.config.memories?"开":"关"}</p><p>世界补充：${e(st.config.notes||"无")}</p><p>侧写不会收到主角正文、全局私聊或未授权记忆；多人同一模型批次仍需要你审核是否串人。</p>
        <details class="card"><summary>近期操作记录</summary>${st.logs.slice().reverse().map(r=>`<p>${e(new Date(r.at).toLocaleString())} · ${e(r.message)}</p>`).join("")}</details>`;
    }
    return `<div class="pad"><div class="overline">STORY STUDIO · 2.5</div><h2>剧情工作台</h2><div class="buttons">${[["events","事件导演"],["parallel","众生侧写"],["world","世界状态"],["memories","亲历记忆"],["settings","输入与日志"]].map(([k,label])=>button(label,"st-tab",k,tab===k?"primary":"")).join("")}${button("原点线面规划","go","planner")}</div>${eng.studio.status?hint(eng.studio.status):""}${body}</div>`;
  }
  async function studioAction(ui,action,value) {
    const eng=ui.engine,origin=eng.bridge.capture(),initial=fingerprint(studioData(ui.data)),st=studioData(ui.data);
    assert(eng.repo.snapshot?.owner===origin.owner && eng.repo.snapshot?.signature===origin.signature,"聊天/正文正在刷新，请稍后再操作");
    const valid=()=>{try{return eng.bridge.same(origin)&&eng.bridge.capture().signature===origin.signature;}catch{return false;}};
    const save=(fn,label)=>eng.repo.mutate(s=>{fn(s,s.studio ||= studioFresh());},{snapshot:origin,guard:s=>valid()&&fingerprint(studioData(s))===initial,label});
    const dialog=async(title,body,options={})=>{const v=await ui.dialog(title,body,options);assert(valid(),"聊天或正文已变化，请重新操作");return v;};
    const confirm=async(title,copy)=>{const yes=await ui.confirm(title,copy);assert(valid(),"聊天或正文已变化，请重新操作");return yes;};
    const contactChoices=ui.data.contacts.map(c=>[c.id,c.name]);
    if(action==="st-tab"){ui.studioTab=value;ui.render();return;}
    if(action==="st-rule-page"){ui.avsRulePage=Number(value)||0;ui.render();return;}
    if(action==="st-rule-search") {const r=await dialog("搜索视觉资料",field("关键词","q",ui.avsRuleQuery||"",{max:100}));if(r){ui.avsRuleQuery=studioText(r.q,100);ui.avsRulePage=0;}}
    else if(action==="st-rule-clear"){ui.avsRuleQuery="";ui.avsRulePage=0;}
    else if(action==="st-rule-new"||action==="st-rule-edit"){
      const old=studioRules(ui.data).find(r=>r.id===value),row=old||{id:id("rule"),title:"",keys:[],text:"",enabled:true,use:false};
      const r=await dialog(old?"编辑视觉资料":"新增视觉资料",field("标题","title",row.title,{required:true,max:160})+field("关键词（用逗号分隔）","keys",row.keys.join(", "),{max:2000})+field("正文","text",row.text,{textarea:true,max:12000})+checkbox("启用条目","enabled",row.enabled)+checkbox("参与视觉分析（受6000字符总预算限制）","use",row.use));
      if(r)await save(s=>studioPutRule(s,{id:row.id,title:r.title,keys:String(r.keys||"").split(/[,，\n]/).map(x=>x.trim()).filter(Boolean),text:r.text||"",enabled:r.enabled===true||r.enabled==="on",use:r.use===true||r.use==="on"}),"保存视觉规则");
    } else if(["st-rule-toggle","st-rule-use"].includes(action)){
      const row=studioRules(ui.data).find(r=>r.id===value);assert(row,"规则不存在");
      await save(s=>studioPutRule(s,{...row,...action==="st-rule-toggle"?{enabled:!row.enabled}:{use:!row.use}}),"切换视觉资料配置");
    } else if(action==="st-rule-reset"){
      const row=studioRules(ui.data).find(r=>r.id===value);assert(row,"规则不存在");
      if(await confirm(row.builtin?"恢复原条目":"删除自建条目","只影响本聊天；建议先导出自己的修改。"))await save((s,x)=>{x.rules=x.rules.filter(r=>r.id!==value);},"恢复/删除视觉规则");
    } else if(action==="st-rule-reset-all"){
      if(await confirm("恢复本聊天默认资料库","将丢弃所有修改和自建条目；原290条仍在。此操作不能单独撤销，请先导出。"))await save((s,x)=>{x.rules=[];},"恢复视觉资料库");
    } else if(action==="st-rule-export")download(ui,"视觉资料库-v2.5.json",{format:"tsukiyo-visual-rules-1",rules:studioRules(ui.data).map(studioRule)});
    else if(action==="st-rule-import"){
      const f=await ui.pickFile(".json,application/json",6*1024*1024);if(!f)return;const rows=studioImportRules(JSON.parse(await f.text()));
      if(await confirm("导入视觉资料库",`验证通过，导入${rows.length}条修改/自建记录并替换本聊天规则覆盖层。建议先导出；不修改原世界书。`))await save((s,x)=>{x.rules=rows;},"导入视觉规则");
    } else if(action==="st-generate"){
      if(await confirm("额外调用一次模型","结果只进入候选/待审核区；每小时最多12次，失败也计入预算。是否继续？"))await eng.studio.generate(value);
    } else if(action==="st-preview"||action==="st-last-request"){
      let request;
      if(action==="st-preview")request=eng.studio.requestFor(value,ui.data,origin);
      else{request=eng.studio.lastRequest;assert(request?.owner===origin.owner,"本聊天尚无本次加载期间的实际请求记录");}
      const txt=JSON.stringify(request,null,2);
      await dialog("请求预览 · "+txt.length+"字符",`<p>仅在手机内显示；不含API密钥，但可能包含角色私有设定，请勿随意公开。</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${e(txt)}</pre>`,{choices:[["ok","关闭","primary"]]});
    } else if(action==="st-config"){
      const c=st.config,r=await dialog("工作台配置",field("事件触发概率 0—100","probability",c.probability,{type:"number"})+field("两次事件的最少消息间隔 0—30","cooldown",c.cooldown,{type:"number"})+checkbox("事件/状态提取读取近期正文","context",c.context)+checkbox("读取相关联系人档案","contacts",c.contacts)+checkbox("侧写读取本人亲历记忆","memories",c.memories)+field("世界观补充与边界","notes",c.notes,{textarea:true,max:4000}));
      if(r)await save((s,x)=>{x.config={...x.config,probability:Math.round(clamp(r.probability,0,100,25)),cooldown:Math.round(clamp(r.cooldown,0,30,2)),context:!!r.context,contacts:!!r.contacts,memories:!!r.memories,notes:studioText(r.notes,4000)};},"修改工作台输入");
    } else if(action==="st-toggle"){
      assert(["directorInject","worldInject","memoryInject"].includes(value),"未知开关");
      if(st.config[value]||await confirm("开启正文参考注入","资料将发送给正文模型；事件只注入当前阶段，场外状态与私有记忆不可被所有角色自动知晓。导演生效时暂停旧点线面自动规划和规划注入。"))await save((s,x)=>{x.config[value]=!x.config[value];},"切换工作台注入");
    } else if(action==="st-event-new"){
      const r=await dialog("手写候选事件",field("标题","title","",{required:true,max:100})+field("阶段钩子：每行一个（1—6行）","stages","",{required:true,textarea:true,max:6000})+field("后台备忘（不注入正文）","secret","",{textarea:true,max:1800})+field("抽取权重 1—100","weight",10,{type:"number"}));
      if(r){const ev=studioCheckEvent({id:id("event"),title:studioText(r.title,100),secret:studioText(r.secret,1800),weight:Math.round(clamp(r.weight,1,100,10)),status:"candidate",stages:String(r.stages).split("\n").map(x=>x.trim()).filter(Boolean).map(hook=>({hook,condition:"由玩家核实当前阶段已在正文发生"})),...studioStamp(origin)});await save((s,x)=>{assert(x.pool.length<40,"事件池已满");x.pool.push(ev);},"新增候选事件");}
    } else if(action==="st-roll"){
      let result;await save((s,x)=>{result=studioSelect(x,origin,()=>studioRandom(eng.win));studioLog(x,result.repeat?"本轮已抽取，不重复掷骰":result.cooldown?"事件尚在冷却":result.eventId?"抽中候选，等待正文演绎":"本轮未抽中事件");},"事件抽取");
      eng.studio.status=result.repeat?"同一正文前缀已经抽过，不重新抽取。":result.cooldown?"尚在冷却。":result.eventId?"已选定事件；开启导演注入后才能影响正文。":"本轮未触发事件。";
    } else if(action==="st-event-start"){
      const ev=st.pool.find(r=>r.id===value);assert(ev&&ev.status==="candidate"&&studioValid(ev,origin),"候选不存在/已使用/分支失效");
      if(await confirm("采用此候选","只启用当前阶段，不代表事件已经发生；其他阶段与后台备注不注入。"))await save((s,x)=>{assert(!x.active,"已有当前事件，请先取消");x.active={event:clone(ev),index:0,...studioStamp(origin)};x.pool.find(r=>r.id===value).status="selected";studioLog(x,"手动采用事件："+ev.title);},"采用候选事件");
    } else if(action==="st-next"){
      assert(st.active&&studioValid(st.active,origin),"当前事件已失效");
      assert(origin.floor > st.active.floor,"需要一条新的角色正文作为本阶段发生依据，不能在同一楼层连续推进");
      const r=await dialog("核实当前阶段已发生",field("粘贴近期正文中的原句（不能为空）","evidence","",{required:true,textarea:true,max:1000}));
      if(r){const quote=studioText(r.evidence,1000);assert(quote&&origin.history.some(m=>m.role==="assistant"&&m.text.includes(quote)),"没有找到这段角色正文原句");await save((s,x)=>{const a=x.active;studioLog(x,"核实阶段："+quote);if(a.index+1>=a.event.stages.length){const ev=x.pool.find(r=>r.id===a.event.id);if(ev)ev.status="completed";x.active=null;}else { a.index++; Object.assign(a,studioStamp(origin)); }},"确认事件阶段");}
    } else if(action==="st-event-stop"){
      if(await confirm("取消当前事件","立即移除本工作台的事件注入，不改写已发生正文。"))await save((s,x)=>{if(x.active){const ev=x.pool.find(r=>r.id===x.active.event.id);if(ev)ev.status="cancelled";}x.active=null;},"取消当前事件");
    } else if(action==="st-event-delete"){
      assert(st.active?.event.id!==value,"请先取消当前事件再删除");if(await confirm("删除候选","不会删除正文。"))await save((s,x)=>{x.pool=x.pool.filter(r=>r.id!==value);},"删除事件候选");
    } else if(action==="st-roster-add"||action==="st-roster-edit"){
      const old=st.roster.find(r=>r.id===value),r=await dialog("侧写人物",old?`<h3>${e(studioWho(ui.data,old.contactId))}</h3>`+field("本人可知的场外参考","note",old.note,{textarea:true,max:2000}):select("选择已有联系人","contactId",contactChoices,contactChoices[0]?.[0]||"")+field("本人可知的场外参考","note","",{textarea:true,max:2000}));
      if(r)await save((s,x)=>{const contactId=old?.contactId||r.contactId;assert(s.contacts.some(c=>c.id===contactId),"联系人不存在");if(old){x.roster.find(r=>r.id===old.id).note=studioText(r.note,2000);}else{assert(!x.roster.some(r=>r.contactId===contactId),"已经在名单中");x.roster.push({id:id("npc"),contactId,note:studioText(r.note,2000),absent:null});}},"编辑侧写名单");
    } else if(action==="st-roster-absent"){
      if(await confirm("确认本轮确实离场","此确认仅对当前角色正文有效。下一轮需重新确认；现场名单或正文点名冲突时仍跳过。"))await save((s,x)=>{const r=x.roster.find(r=>r.id===value);assert(r,"人物已移除");r.absent=studioStamp(origin);},"确认侧写人物离场");
    } else if(action==="st-roster-delete")await save((s,x)=>{x.roster=x.roster.filter(r=>r.id!==value);},"移出侧写名单");
    else if(action==="st-portrait-keep")await save((s,x)=>{const d=x.drafts.find(r=>r.id===value&&r.kind==="parallel");assert(d&&studioValid(d,origin),"草稿失效");d.status="kept";},"收藏侧写（不注入）");
    else if(action==="st-draft-delete")await save((s,x)=>{x.drafts=x.drafts.filter(r=>r.id!==value);},"删除工作台草稿");
    else if(action==="st-state-approve"){
      if(await confirm("核准状态增量","请先核对原文依据。只修改手机世界状态，不修改角色性格/关系/MVU；需另外开启注入才影响正文。"))await save(s=>studioApproveState(s,origin,value),"核准状态更新");
    } else if(action==="st-state-edit"){
      const old=st.states.find(r=>r.contactId===value),r=await dialog("手动确认人物状态",select("人物","contactId",contactChoices,value||contactChoices[0]?.[0]||"")+field("位置","location",old?.location||"",{max:160})+field("已知状态（不是未来计划）","status",old?.status||"",{required:true,textarea:true,max:800})+field("有效至剧情时间，可留空，例如1604-09-03T18:00","until",old?.until||"",{max:16}));
      if(r){const until=studioText(r.until,16);assert(!until||studioDateValid(until),"日期时间格式错误");await save((s,x)=>{assert(s.contacts.some(c=>c.id===r.contactId),"联系人不存在");const row={id:r.contactId,contactId:r.contactId,location:studioText(r.location,160),status:studioText(r.status,800),until,evidence:"用户手动确认",...studioStamp(origin)};const i=x.states.findIndex(r=>r.id===row.id);if(i<0)x.states.push(row);else x.states[i]=row;},"手动核实世界状态");}
    } else if(action==="st-state-delete")await save((s,x)=>{x.states=x.states.filter(r=>r.id!==value);},"删除世界状态");
    else if(action==="st-memory-new"||action==="st-memory-edit"){
      const old=st.memories.find(r=>r.id===value),r=await dialog("登记亲历记忆",select("确实参与并知情的联系人","contactId",contactChoices,old?.witnesses[0]||contactChoices[0]?.[0]||"")+field("共同经历内容","text",old?.text||"",{required:true,textarea:true,max:1500})+field("依据：正文原句或明确说明为作者核定","evidence",old?.evidence||"",{required:true,textarea:true,max:1000}));
      if(r)await save((s,x)=>{assert(s.contacts.some(c=>c.id===r.contactId),"联系人不存在");const row={id:old?.id||id("witness"),witnesses:[r.contactId],text:studioText(r.text,1500),evidence:studioText(r.evidence,1000),...studioStamp(origin)};if(old)x.memories[x.memories.findIndex(m=>m.id===old.id)]=row;else x.memories.push(row);},"登记本人亲历记忆");
    } else if(action==="st-memory-delete")await save((s,x)=>{x.memories=x.memories.filter(m=>m.id!==value);},"删除亲历记忆");
    else if(action==="st-clean"){
      if(await confirm("清理已处理草稿","只删除已收藏/已核准草稿，待审核草稿和正式世界状态、记忆不动。请先导出需要保留的侧写。"))await save((s,x)=>{x.drafts=x.drafts.filter(r=>r.status==="pending");},"清理已处理草稿");
    } else if(action==="st-export")download(ui,"剧情工作台-v2.5.json",{format:"tsukiyo-studio-1",owner:origin.owner,studio:st,notice:"含作者后台与私有记忆，请勿公开；恢复使用手机完整备份。"});
    if(eng.settings.isEnabled("director") && studioDirectorOn(eng.repo.data,eng.repo.snapshot))eng.runner.cancel("事件导演生效，旧规划让行",{module:"planner"});
    eng.updatePrompt();ui.render();
  }
