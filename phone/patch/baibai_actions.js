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
        const brief = baibaiBrief(null, { maxAge: 0 });
        assert(brief, "未检测到柏宝书，或柏宝书关闭了小手机联动");
        const snapNow = snapshot(ui);
        const have = new Set(ui.data.memories.map((m) => m.id));
        const fresh = baibaiMemoryCandidates(brief, ui.data).filter((c) => !have.has(c.id));
        if (!fresh.length) {
          ui.notify("柏宝书里没有新的可导入记忆。");
          return;
        }
        if (!await ui.confirm("导入柏宝书记忆？", `将把 ${fresh.length} 条柏宝书的未了结计划 / 锚点日记 / 分层剧情摘要存为手机记忆（带“柏宝书”标记：不同步进记忆世界书，也不会再注入正文，避免与柏宝书自己的注入重复）。可在“记忆”里逐条停用或删除。`)) return;
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
