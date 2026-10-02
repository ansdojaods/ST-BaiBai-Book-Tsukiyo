      case "baibai-preview-memory": {
        baibaiInvalidate();
        const brief = baibaiPlanningBrief();
        assert(brief, "记忆读取未开启或尚未连接，请检查手机设置和柏宝书联动页的读取开关");
        await ui.confirm("柏宝书记忆参考（只读）", JSON.stringify(brief, null, 2), "知道了");
        return;
      }
      case "baibai-enabled":
      case "baibai-brief":
      case "baibai-push":
      case "baibai-present": {
        const st = engine.settings, key = action.slice(7), cur = isObject(st.data.ui.baibai) ? st.data.ui.baibai : {};
        const turnOn = cur[key] === false;
        st.update({ ui: { ...st.data.ui, baibai: { ...cur, [key]: turnOn } } });
        baibaiInvalidate();
        if ((key === "push" || key === "enabled") && turnOn) engine.baibai.schedule(800);
        return;
      }
      case "baibai-push-now": {
        assert(ui.data, "先打开一个聊天");
        assert(baibaiApi(), "未检测到百宝月夜书（需 ≥1.3.0，并在其「联动」页开启小手机联动）");
        const r = await engine.baibai.push({ force: true });
        ui.notify(r && (r.added || r.updated) ? `已回写柏宝书：新增 ${r.added} 条，更新 ${r.updated} 条。` : "柏宝书里已是最新，没有需要回写的内容。");
        return;
      }
      case "baibai-import-memory": {
        assert(ui.data, "先打开一个聊天");
        assert(baibaiReadEnabled(), "请先开启柏宝书记忆读取");
        const brief = baibaiBrief(null, { maxAge: 0 });
        assert(brief, "未检测到柏宝书，或柏宝书关闭了小手机联动");
        const snapNow = snapshot(ui);
        const have = new Set(ui.data.memories.map((m) => m.id));
        const fresh = baibaiMemoryCandidates(brief, ui.data).filter((c) => !have.has(c.id));
        if (!fresh.length) {
          ui.notify("柏宝书里没有新的可导入记忆。");
          return;
        }
        if (!await ui.confirm("导入柏宝书记忆？", `将把 ${fresh.length} 条柏宝书的未了结计划 / 锚点日记 / 分层剧情摘要存为手机记忆（带“柏宝书”标记：不同步进记忆世界书，也不会再注入正文，避免与柏宝书自己的注入重复）。默认仅玩家知情；可在“记忆”里明确设置其他知情人、停用或删除。`)) return;
        let count = 0;
        await change(ui, (s) => {
          const ids = new Set(s.memories.map((m) => m.id));
          for (const c of fresh) {
            if (ids.has(c.id) || s.memories.length >= 1e3) continue;
            s.memories.push({ id: c.id, kind: c.kind, title: c.title, text: c.text, keys: [], enabled: true, audience: c.audience, visibility: "private", sources: [{ note: "柏宝书 · " + (c.bb.kind === "plan" ? "未了结计划" : c.bb.kind === "anchor" ? "锚点日记" : "分层摘要") }], resolved: false, ts: Date.now(), bb: c.bb });
            ids.add(c.id);
            count++;
          }
          log(s, "info", "从柏宝书导入 " + count + " 条记忆", "memory");
        }, "导入柏宝书记忆", snapNow);
        ui.notify("已从柏宝书导入 " + count + " 条记忆。");
        return;
      }
      case "baibai-import-api": {
        const api = baibaiApi();
        assert(api, "未检测到柏宝书");
        let list;
        try {
          list = api.listChannels();
        } catch (e2) {
          throw Error("读取柏宝书渠道失败：" + (e2?.message || e2));
        }
        assert(Array.isArray(list) && list.length, "柏宝书里还没有副 API 渠道");
        if (!await ui.confirm("导入柏宝书 API 方案？", list.map((c) => "· " + c.name + "（" + (c.model || "未填模型") + " @ " + (c.host || "?") + (c.hasKey ? "，含密钥" : "，无密钥") + "）").join("\n") + "\n\n密钥会随方案导入并在本机记住；同一渠道重复导入时按编号覆盖。导入的是副本，之后两边各自修改互不影响。")) return;
        let ok = 0;
        const fail = [];
        for (const c of list) {
          try {
            const ch = api.exportChannel(c.id);
            const core = String(ch.id || c.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
            const pid = "baibai-" + (core || fingerprint(String(c.name || c.id)));
            const prev = engine.settings.data.profiles.find((p) => p.id === pid);
            engine.settings.saveProfile({ id: pid, name: text("柏宝书·" + (ch.name || c.name || "渠道"), 40), type: "openai", transport: prev?.transport || "helper", url: baibaiNormalizeUrl(ch.url), model: text(ch.model, 120), temperature: Number.isFinite(ch.temperature) ? ch.temperature : 0.8, maxTokens: Number.isFinite(ch.maxTokens) ? ch.maxTokens : 1800, rememberKey: !!ch.key || !!prev?.rememberKey, key: ch.key || "", testPrompt: prev?.testPrompt || "" });
            ok++;
          } catch (e2) {
            fail.push((c.name || c.id) + "：" + text(e2?.message || e2, 80));
          }
        }
        ui.notify("已导入 " + ok + " 个柏宝书方案" + (fail.length ? "；失败：" + fail.join("；") : "。"), fail.length ? "error" : "info");
        return;
      }
      case "baibai-test": {
        const api = baibaiApi();
        assert(api, "未检测到柏宝书");
        const list = api.listChannels();
        assert(Array.isArray(list) && list.length, "柏宝书里还没有副 API 渠道");
        ui.notify("正在通过柏宝书测活 " + list.length + " 个渠道（密钥不经过手机）…");
        const results = [];
        for (const c of list) {
          try {
            const r = await api.testChannel(c.id);
            results.push((r?.ok ? "✓ " : "✗ ") + c.name + (r?.message ? "：" + text(r.message, 80) : ""));
          } catch (e2) {
            results.push("✗ " + c.name + "：" + text(e2?.message || e2, 80));
          }
        }
        baibaiInvalidate();
        await ui.confirm("柏宝书渠道测活结果", results.join("\n"), "知道了");
        return;
      }
      // ===== 恋爱心迹（每楼层角色心声 & 联动百宝书主要配角） =====
      case "diary-tab":
        ui.go("diary", "", { tab: value || "all", author: ui.route.author || "all", floor: ui.route.floor || "all", replace: true });
        return;
      case "diary-floor":
        ui.go("diary", "", { tab: ui.route.tab || "all", author: ui.route.author || "all", floor: value || "all", replace: true });
        return;
      case "heart-auto-toggle": {
        const st = engine.settings, cur = heartPrefs();
        const next = !cur.autoEveryFloor;
        st.update({ ui: { ...st.data.ui, heartTrace: { ...cur, autoEveryFloor: next } } });
        ui.notify(next ? "已开启：每当新楼层回复完成时，将自动生成主要配角的恋爱心迹。" : "已关闭每楼层自动生成恋爱心迹。");
        return;
      }
      case "heart-auto-mode": {
        const st = engine.settings, cur = heartPrefs();
        if (!["baibai_main", "present", "pinned"].includes(value)) return;
        st.update({ ui: { ...st.data.ui, heartTrace: { ...cur, autoMode: value } } });
        return;
      }
      case "heart-pick-pinned": {
        assert(ui.data, "先打开一个聊天");
        const snapNow = snapshot(ui);
        await change(ui, (s) => {
          syncBaibaiMainNpcsToContacts(s, null, { onlyImportantOrPresent: true });
        }, "同步百宝书角色", snapNow).catch(() => {});
        const cur = heartPrefs();
        const { list: bbMain } = baibaiMainNpcsForHeart(ui.data, snapNow);
        const bbMap = new Map(bbMain.map((n) => [nameKey(n.name), n]));
        const pool = ui.data.contacts.filter((c) => c.age === null || c.age >= 12).map((c) => {
          const b = bbMap.get(nameKey(c.name));
          return {
            id: c.id,
            name: c.name,
            note: [b?.important ? "★百宝书主配" : "", b?.present ? "在场" : "", b?.affinityText || b?.relation || c.status].filter(Boolean).join(" · ")
          };
        });
        const r = await ui.dialog("恋爱心迹 · 自动联动与关注设置", `${select("自动联动对象", "autoMode", [["baibai_main", "百宝书主要配角（核心/在场/有好感度的角色）"], ["present", "当前楼层在场角色"], ["pinned", "仅下方勾选的固定关注角色"]], cur.autoMode)}${field("每楼层自动生成最多人数（1—4）", "maxPerFloor", cur.maxPerFloor, { type: "number" })}${checkbox("将生成的恋爱心迹回写到百宝月夜书【小手机·恋爱心迹】", "syncToBaibai", cur.syncToBaibai)}<div class="section-label">固定关注的角色（勾选）</div>${pickTools()}${filterBox("搜索角色姓名…")}${peopleChecks(pool, { checked: cur.pinnedIds })}`, { submit: "保存设置" });
        if (!r) return;
        const st = engine.settings;
        st.update({
          ui: {
            ...st.data.ui,
            heartTrace: {
              ...cur,
              autoMode: ["baibai_main", "present", "pinned"].includes(r.autoMode) ? r.autoMode : cur.autoMode,
              maxPerFloor: Math.min(4, Math.max(1, Math.trunc(Number(r.maxPerFloor) || 2))),
              syncToBaibai: !!r.syncToBaibai,
              pinnedIds: Array.isArray(r.members) ? r.members : []
            }
          }
        });
        ui.notify("恋爱心迹联动设置已保存。");
        return;
      }
      case "heart-sync-baibai": {
        assert(ui.data, "先打开一个聊天");
        const brief = baibaiBrief(null, { maxAge: 0 });
        assert(brief, "未检测到百宝月夜书简报，请确认百宝月夜书已开启小手机联动");
        const snapNow = snapshot(ui);
        let res = { added: [], updated: 0 };
        await change(ui, (s) => {
          res = syncBaibaiMainNpcsToContacts(s, brief, { onlyImportantOrPresent: false });
        }, "同步百宝书主要配角", snapNow);
        ui.notify(res.added.length || res.updated
          ? `已同步百宝月夜书角色：新增 ${res.added.length} 位（${res.added.map((c) => c.name).join("、")}），更新 ${res.updated} 位资料。`
          : "通讯录已包含百宝月夜书中的全部主要配角。");
        return;
      }
      case "quick-heart-baibai": {
        assert(ui.data, "先打开一个聊天");
        const snapNow = snapshot(ui);
        await change(ui, (s) => {
          syncBaibaiMainNpcsToContacts(s, null, { onlyImportantOrPresent: true });
        }, "同步百宝书主要配角", snapNow).catch(() => {});
        const picked = pickAutoHeartContacts(ui.data, snapNow);
        assert(picked.length, "没有找到可生成心迹的角色，请先添加联系人或同步百宝书角色");
        await engine.actions.heartTraces(picked, { floor: snapNow.floor });
        ui.go("diary", "", { tab: "heart", replace: true });
        return;
      }
      case "quick-heart-npc": {
        assert(ui.data, "先打开一个聊天");
        const npcName = text(value, 40);
        assert(npcName, "未指定角色");
        const snapNow = snapshot(ui);
        let targetId = "";
        await change(ui, (s) => {
          syncBaibaiMainNpcsToContacts(s, null, { onlyImportantOrPresent: false });
          let c = s.contacts.find((x) => nameKey(x.name) === nameKey(npcName));
          if (!c) {
            c = addContact(s, { name: npcName, bio: "百宝月夜书联动角色", status: "百宝书主要配角", recognized: true, reachable: true, color: "rose" });
          }
          targetId = c.id;
        }, "准备角色心迹：" + npcName, snapNow);
        assert(targetId, "无法定位角色：" + npcName);
        await engine.actions.heartTraces([targetId], { floor: snapNow.floor });
        ui.go("diary", "", { tab: "heart", replace: true });
        return;
      }
      case "generate-heart-trace": {
        assert(ui.data, "先打开一个聊天");
        const snapNow = snapshot(ui);
        await change(ui, (s) => {
          syncBaibaiMainNpcsToContacts(s, null, { onlyImportantOrPresent: false });
        }, "同步百宝书角色", snapNow).catch(() => {});
        const fctx = collectFloorContext(engine.bridge, snapNow);
        const floorChoices = fctx.floors.length
          ? [...fctx.floors].reverse().map((f) => [String(f.floor), `#${f.floor + 1}楼 · ${f.name}：${text(f.text, 28)}`])
          : [[String(snapNow.floor ?? 0), `当前 #${(snapNow.floor ?? 0) + 1}楼`]];
        const { list: bbMain } = baibaiMainNpcsForHeart(ui.data, snapNow);
        const bbMap = new Map(bbMain.map((n) => [nameKey(n.name), n]));
        const people = ui.data.contacts.filter((c) => c.age === null || c.age >= 12);
        const pool = people.map((c) => {
          const b = bbMap.get(nameKey(c.name));
          return {
            id: c.id,
            name: c.name,
            note: [b?.important ? "★百宝书主配" : "", b?.present ? "在场" : "", b?.affinityText || b?.relation || c.status].filter(Boolean).join(" · ")
          };
        });
        const defaultChecked = pickAutoHeartContacts(ui.data, snapNow);
        const presentIds = people.filter((c) => (snapNow.present || []).some((p) => nameKey(p) === nameKey(c.name)) || bbMap.get(nameKey(c.name))?.present).map((c) => c.id);
        const r = await ui.dialog("生成恋爱心迹 · 选楼层与角色", `${hint("可针对任意楼层的正文互动，生成角色当下的表面伪装、心底对你的回应与第一人称恋爱心迹。已联动百宝月夜书的主要配角与好感状态。")}${select("目标正文楼层", "floor", floorChoices, String(fctx.targetFloor))}${select("选人方式", "mode", [["pick", "使用下方勾选的角色"], ["baibai", "自动选百宝书主要配角 / 在场角色"], ["random", "随机抽取角色"]], "pick")}${field("心迹侧重提示（可选，如：嘴硬吃醋 / 偷偷心动）", "focusHint", "", { max: 200, placeholder: "留空则按本楼层正文与好感度自然推演" })}<div class="section-label">选择角色（最多 4 位）</div>${pickTools(presentIds, "本楼在场/主配")}${filterBox("搜索角色…")}${peopleChecks(pool, { checked: defaultChecked })}`, { submit: "生成恋爱心迹" });
        if (!r) return;
        let picked = Array.isArray(r.members) ? r.members : [];
        if (r.mode === "baibai") picked = pickAutoHeartContacts(ui.data, snapNow);
        else if (r.mode === "random") picked = [...people].sort(() => Math.random() - 0.5).slice(0, 2).map((c) => c.id);
        picked = picked.slice(0, 4);
        assert(picked.length, "请至少选择一位角色");
        await engine.actions.heartTraces(picked, { floor: Number(r.floor), focusHint: text(r.focusHint || "", 200) });
        ui.go("diary", "", { tab: "heart", replace: true });
        return;
      }
      case "heart-followup": {
        assert(ui.data, "先打开一个聊天");
        const d = ui.data.diary.find((x) => x.id === value && x.kind === "heart");
        assert(d, "未找到该条恋爱心迹");
        const who = contactName(ui.data, d.author) !== "未知联系人" ? contactName(ui.data, d.author) : (d.authorName || "角色");
        const prompt = await askText(ui, `回应 / 追问 ${who} 的心迹（#${(d.floor ?? 0) + 1}楼）`, "你想对 ta 的这段心迹说什么、追问什么，或做出什么小动作？", { placeholder: "例如：凑近盯着ta微红的耳尖问：「刚才明明在偷偷看我吧？」", max: 400 });
        if (!prompt) return;
        await engine.actions.heartFollowup(d.id, prompt);
        return;
      }
      // ===== 全模块通用删除管理（多选删除 + 一键清空 + 单项删除） =====
      case "batch-delete-modal": {
        assert(ui.data, "先打开一个聊天");
        const meta = tpModuleMeta(ui, value);
        assert(meta && meta.items.length, "当前模块没有可删除的记录");
        const snapNow = snapshot(ui);
        const r = await ui.dialog(`多选删除 · ${meta.title}`, `${hint(meta.warn)}${pickTools()}${filterBox("搜索要删除的记录…")}${peopleChecks(meta.items, { name: "members", checked: [] })}`, { submit: "删除所选" });
        if (!r) return;
        const selected = Array.isArray(r.members) ? r.members : [];
        assert(selected.length, "请至少勾选一条要删除的记录");
        if (!await ui.confirm(`确认删除所选的 ${selected.length} 条${meta.title}？`, meta.warn + "此操作不可直接撤销。", "确认删除")) return;
        still(ui, snapNow);
        const idSet = new Set(selected);
        if (value === "album") {
          for (const p of ui.data.album.filter((x) => idSet.has(x.id))) {
            if (p.mediaId && !String(p.mediaId).startsWith("url:")) await engine.media.remove?.(p.mediaId).catch(() => {});
          }
        }
        let removedCount = 0;
        await change(ui, (s) => {
          const m2 = tpModuleMeta({ data: s }, value);
          if (m2) removedCount = m2.remove(s, idSet);
        }, `批量删除${meta.title}`, snapNow);
        ui.notify(`已删除 ${removedCount} 条${meta.title}。`);
        return;
      }
      case "clear-module": {
        assert(ui.data, "先打开一个聊天");
        const meta = tpModuleMeta(ui, value);
        assert(meta && meta.items.length, "当前模块已经是空的");
        const snapNow = snapshot(ui);
        if (!await ui.confirm(`一键清空全部${meta.title}（共 ${meta.items.length} 条）？`, meta.warn + "清空后无法直接恢复，建议重要内容先备份。", "确认清空")) return;
        still(ui, snapNow);
        if (value === "album") {
          for (const p of ui.data.album) {
            if (p.mediaId && !String(p.mediaId).startsWith("url:")) await engine.media.remove?.(p.mediaId).catch(() => {});
          }
        }
        let cleared = 0;
        await change(ui, (s) => {
          const m2 = tpModuleMeta({ data: s }, value);
          if (m2) cleared = m2.clear(s);
        }, `一键清空${meta.title}`, snapNow);
        ui.notify(`已清空 ${cleared} 条${meta.title}。`);
        return;
      }
      case "delete-diary": {
        const snapNow = snapshot(ui), d = ui.data?.diary.find((x) => x.id === value);
        assert(d, "记录不存在");
        const label = d.kind === "heart" ? "恋爱心迹" : "日记";
        if (await ui.confirm(`删除这篇${label}「${d.title}」？`, "删除后不可直接撤销。", "删除")) {
          await change(ui, (s) => {
            s.diary = s.diary.filter((x) => x.id !== value);
          }, "删除" + label, snapNow);
          ui.notify(`已删除${label}。`);
        }
        return;
      }
      case "delete-note": {
        const snapNow = snapshot(ui), n = ui.data?.notes.find((x) => x.id === value);
        assert(n, "便签不存在");
        if (await ui.confirm(`删除便签「${n.title || "无题"}」？`, "删除后不可直接撤销。", "删除")) {
          await change(ui, (s) => {
            s.notes = s.notes.filter((x) => x.id !== value);
          }, "删除便签", snapNow);
          ui.notify("已删除便签。");
        }
        return;
      }
      case "delete-photo": {
        const snapNow = snapshot(ui), p = ui.data?.album.find((x) => x.id === value);
        assert(p, "照片不存在");
        if (await ui.confirm(`移除照片「${p.title || "留影"}」？`, "将从手机相册中移除。", "移除")) {
          if (p.mediaId && !String(p.mediaId).startsWith("url:")) await engine.media.remove?.(p.mediaId).catch(() => {});
          await change(ui, (s) => {
            s.album = s.album.filter((x) => x.id !== value);
          }, "删除相册照片", snapNow);
          ui.notify("已移除照片。");
        }
        return;
      }
      case "delete-chat-msg": {
        const [tid, mid] = String(value).split("|");
        const snapNow = snapshot(ui), t = ui.data?.threads.find((x) => x.id === tid);
        const m = t?.messages.find((x) => x.id === mid);
        assert(t && m, "消息不存在");
        if (await ui.confirm("删除这条消息？", `「${text(m.text || "[图片]", 60)}」将被移除。`, "删除")) {
          await change(ui, (s) => {
            const th = s.threads.find((x) => x.id === tid);
            if (th) th.messages = th.messages.filter((x) => x.id !== mid);
          }, "删除单条消息", snapNow);
        }
        return;
      }
      case "delete-thread": {
        const snapNow = snapshot(ui), t = ui.data?.threads.find((x) => x.id === value);
        assert(t, "会话不存在");
        if (await ui.confirm(`删除会话「${t.title}」？`, `将移除该会话内的 ${t.messages.length} 条消息与待发草稿。`, "删除")) {
          await change(ui, (s) => {
            s.threads = s.threads.filter((x) => x.id !== value);
            s.summaries = s.summaries.filter((x) => x.threadId !== value);
          }, "删除会话", snapNow);
          ui.notify(`已删除会话「${t.title}」。`);
        }
        return;
      }
      case "delete-plan": {
        const snapNow = snapshot(ui), p = ui.data?.plans.find((x) => x.id === value);
        assert(p, "方向不存在");
        if (await ui.confirm(`删除方向「${p.title}」？`, "将从候选与方向档案中移除。", "删除")) {
          await change(ui, (s) => {
            s.plans = s.plans.filter((x) => x.id !== value);
            if (s.activePlan?.id === value) s.activePlan = null;
          }, "删除未来方向", snapNow);
          ui.notify("已删除该方向。");
        }
        return;
      }
