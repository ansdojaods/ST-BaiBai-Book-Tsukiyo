/**
 * 假宿主：把百宝月夜书的 HostPort 用内存里的闲聊记录实现一遍，
 * 用来在没有浏览器、没有酒馆的情况下跑通整条链路（生成 → 草稿 → 确认 → 召回 → 收纳）。
 */
const makeHost = (options = {}) => {
  const floorCount = options.floors === undefined ? 24 : options.floors;
  const floors = [];
  for (let i = 0; i < floorCount; i += 1) {
    floors.push({
      mesid: i,
      role: i % 2 === 0 ? "user" : "assistant",
      valid: true,
      text: i % 2 === 0 ? `第${i + 1}楼：沈青梧问起婚约与灵根的事，提到宗门大比的日期。` : `第${i + 1}楼：主角回应，说掌门已经应下这门亲事，并取出旧玉佩。`,
    });
  }
  const host = {
    calls: [],
    injections: [],
    hidden: new Set(),
    busyFlag: false,
    saved: 0,
    pluginVersion: () => options.pluginVersion || "1.6.3",
    listFloors: () => floors.map((floor) => ({ ...floor })),
    listExtras: () =>
      (options.extras || []).map((item) => ({ ...item })).concat(
        options.noExtras
          ? []
          : [
              { id: "life:1", kind: "life", label: "手机·生活细节", text: "沈青梧最近在吃药，胸口有旧伤。", floor: 6 },
              { id: "memory:1", kind: "memory", label: "手机·长期记忆", text: "两人约定大比之后一起去山下的集市。", floor: 9 },
            ],
      ),
    missingFloors: () => options.missingFloors || [],
    loadState: () => (options.state ? JSON.parse(JSON.stringify(options.state)) : null),
    saveState: (state) => {
      host.saved += 1;
      host.lastState = JSON.parse(JSON.stringify(state));
    },
    generate: async (req) => {
      host.calls.push(req);
      if (options.failOn && options.failOn(req)) return { ok: false, text: "", error: "假宿主：这次故意失败" };
      let payload = {};
      try {
        payload = JSON.parse(req.user);
      } catch {
        payload = {};
      }
      const range = req.range || [0, 0];
      const wrapped = host.calls.length % 3 === 0; // 每三次夹一次 ```json 围栏，验证容错解析
      const pick = (body) => (wrapped ? "```json\n" + JSON.stringify(body) + "\n```" : JSON.stringify(body));
      if (req.kind === "keywords") return { ok: true, text: pick({ keywords: ["婚约", "掌门", "灵根", "玉佩"] }) };
      if (req.kind === "ledger") {
        return {
          ok: true,
          text: pick({
            rows: [
              { kind: "relation", subject: "沈青梧", key: "婚约", from: "未知", to: `已定亲（到第${range[1] + 1}楼）`, evidence: `第${range[0] + 1}楼` },
              { kind: "item", subject: "主角", key: "玉佩", from: "未知", to: "在怀里", evidence: `第${range[1] + 1}楼` },
            ],
          }),
        };
      }
      const task = payload["任务"] || "剧情摘要";
      return { ok: true, text: pick({ summary: `${task}：${range[0] + 1}-${range[1] + 1} 楼，沈青梧谈婚约与灵根。` }) };
    },
    busy: () => host.busyFlag,
    requestInject: (text) => host.injections.push(text),
    hideFloors: (mesids) => {
      for (const mesid of mesids) host.hidden.add(mesid);
      return mesids.length;
    },
    showFloors: (mesids) => {
      for (const mesid of mesids) host.hidden.delete(mesid);
      return mesids.length;
    },
    toast: () => {},
    log: () => {},
    onChatChanged: () => () => {},
    onGenerationEnded: (cb) => {
      host.genEnd = cb;
      return () => {
        host.genEnd = null;
      };
    },
  };
  host.floors = floors;
  return host;
};

module.exports = { makeHost };
