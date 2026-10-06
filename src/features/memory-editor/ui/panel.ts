/**
 * 剧情剪辑台 · 宿主面板（零依赖，纯 DOM）
 *
 * 刻意不引用百宝月夜书现有的 UI 组件，方便直接挂进任何容器；
 * 想统一风格的话，把 panelStyles 换成你们自己的类名即可（结构见 render* 函数）。
 */
import { LEDGER_LABELS } from "../core/ledger";
import { DEFAULT_PROMPTS } from "../core/prompts";
import { coerceState } from "../core/state";
import { rangeLabel, trimText } from "../core/util";
import type { MemoryEditorService } from "../service";
import type { Draft, LedgerKind, PromptKind, RecallRecord, SummaryLevel, SummaryNode } from "../types";

export interface PanelOptions {
  title?: string;
  /** 面板内任何改动后回调（宿主用来广播镜像事件） */
  onChange?: () => void;
  /** 小手机等外部记录来源；返回 null 表示当前没有可用记录 */
  notesProvider?: () => Array<{ id: string; kind: string; title: string; text: string; floor?: number; pinned?: boolean }> | null;
  toast?: (message: string, level?: "info" | "warn" | "error") => void;
}

export interface PanelHandle {
  el: HTMLElement;
  render(): void;
  dispose(): void;
  activeTab(): TabKey;
}

export type TabKey = "tree" | "ledger" | "drafts" | "gaps" | "recall" | "settings";

const LEVEL_NAME: Record<SummaryLevel, string> = { 0: "剧情摘要", 1: "阶段总结", 2: "多次总结" };
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "tree", label: "摘要树" },
  { key: "ledger", label: "剧情状态" },
  { key: "drafts", label: "待确认" },
  { key: "gaps", label: "记忆缺口" },
  { key: "recall", label: "召回与审计" },
  { key: "settings", label: "设置与诊断" },
];

export const panelStyles = `
.bme-root{font-size:13px;line-height:1.5;color:inherit}
.bme-bar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.bme-tab{cursor:pointer;padding:4px 10px;border:1px solid rgba(128,128,128,.45);border-radius:999px;background:transparent;color:inherit;font-size:12px}
.bme-tab[data-on="1"]{background:rgba(128,128,128,.22);font-weight:600}
.bme-sec{border:1px solid rgba(128,128,128,.3);border-radius:10px;padding:8px 10px;margin-bottom:8px}
.bme-sec>h4{margin:0 0 6px;font-size:13px}
.bme-row{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;padding:6px 0;border-bottom:1px dashed rgba(128,128,128,.25)}
.bme-row:last-child{border-bottom:0}
.bme-grow{flex:1;min-width:0}
.bme-mut{opacity:.7;font-size:12px}
.bme-btns{display:inline-flex;gap:4px;flex-wrap:wrap}
.bme-btns>button{cursor:pointer;font-size:12px;padding:2px 8px;border-radius:6px;border:1px solid rgba(128,128,128,.45);background:transparent;color:inherit}
.bme-btns>button.bme-main{border-color:rgba(90,140,200,.8)}
.bme-btns>button.bme-bad{border-color:rgba(200,90,90,.8)}
.bme-btns>button:disabled{opacity:.45;cursor:not-allowed}
.bme-txt{width:100%;box-sizing:border-box;font:inherit;font-size:12px;min-height:64px;border-radius:8px;border:1px solid rgba(128,128,128,.4);background:rgba(0,0,0,.06);color:inherit;padding:6px}
.bme-in,.bme-num{font:inherit;font-size:12px;border-radius:6px;border:1px solid rgba(128,128,128,.4);background:rgba(0,0,0,.06);color:inherit;padding:3px 6px}
.bme-in{width:100%;box-sizing:border-box}
.bme-num{width:70px}
.bme-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px 12px}
.bme-chip{display:inline-block;padding:1px 7px;border-radius:999px;background:rgba(128,128,128,.2);font-size:11px;margin:0 4px 4px 0}
.bme-hit{border-left:3px solid rgba(90,140,200,.7);padding-left:8px;margin-bottom:6px}
.bme-warn{color:#c96a6a}
.bme-ok{color:#5aa87a}
.bme-details>summary{cursor:pointer;font-size:12px;opacity:.8}
`;

const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "text") el.textContent = String(value);
    else if (key === "html") el.innerHTML = String(value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value as EventListener);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
};

export const createPanel = (service: MemoryEditorService, options: PanelOptions = {}): PanelHandle => {
  const root = h("div", { class: "bme-root" });
  const style = h("style", { text: panelStyles });
  const bar = h("div", { class: "bme-bar" });
  const body = h("div", { class: "bme-body" });
  root.appendChild(style);
  root.appendChild(bar);
  root.appendChild(body);

  let tab: TabKey = "tree";
  let disposed = false;

  const say = (message: string, level: "info" | "warn" | "error" = "info"): void => {
    if (options.toast) options.toast(message, level);
  };

  const done = (): void => {
    service.commit();
    options.onChange?.();
    render();
  };

  const guard = (fn: () => void | Promise<unknown>): (() => void) => () => {
    try {
      const result = fn();
      if (result && typeof (result as Promise<unknown>).then === "function") {
        void (result as Promise<unknown>).catch((error) => {
          say(trimText(error instanceof Error ? error.message : String(error), 160), "error");
          render();
        });
      }
    } catch (error) {
      say(trimText(error instanceof Error ? error.message : String(error), 160), "error");
      render();
    }
  };

  const btn = (label: string, onClick: () => void, kind?: "main" | "bad", disabled = false): HTMLButtonElement =>
    h("button", { class: kind ? `bme-${kind}` : "", text: label, disabled, onclick: onClick });

  const numberInput = (value: number, onChange: (n: number) => void, min = 0, max = 1000000, step = 1): HTMLInputElement =>
    h("input", {
      class: "bme-num",
      type: "number",
      value: String(value),
      min: String(min),
      max: String(max),
      step: String(step),
      onchange: (event: Event) => {
        onChange(Number((event.target as HTMLInputElement).value));
        service.state = coerceState(service.state);
        done();
      },
    });

  const textInput = (value: string, onChange: (text: string) => void, placeholder = ""): HTMLInputElement =>
    h("input", {
      class: "bme-in",
      type: "text",
      value,
      placeholder,
      onchange: (event: Event) => {
        onChange((event.target as HTMLInputElement).value);
        done();
      },
    });

  const toggle = (label: string, on: boolean, onChange: (next: boolean) => void, hint = ""): HTMLElement =>
    h(
      "div",
      { class: "bme-row" },
      h(
        "div",
        { class: "bme-grow" },
        h("div", { text: label }),
        hint ? h("div", { class: "bme-mut", text: hint }) : null,
      ),
      h(
        "div",
        { class: "bme-btns" },
        btn(on ? "已开启" : "已关闭", () => {
          onChange(!on);
          done();
        }, on ? "main" : undefined),
      ),
    );

  const textarea = (value: string, rows: number, onSave: (text: string) => void): HTMLTextAreaElement =>
    h("textarea", {
      class: "bme-txt",
      rows: String(rows),
      onchange: (event: Event) => {
        onSave((event.target as HTMLTextAreaElement).value);
        say("已保存");
        done();
      },
      text: value,
    });

  /* ------------------------------ 摘要树 ------------------------------ */

  const renderTree = (): HTMLElement => {
    const info = service.info();
    const box = h("div");
    box.appendChild(
      h(
        "div",
        { class: "bme-sec" },
        h("h4", { text: "摘要在处理的楼层" }),
        h("div", {
          class: "bme-mut",
          text: `有效楼层 ${info.floors.valid}/${info.floors.total}（#${info.floors.from + 1}-#${info.floors.to + 1}）· 已覆盖到 #${info.coveredTo + 1} 楼 · 生效摘要 ${info.activeSummaries} 条`,
        }),
        h(
          "div",
          { class: "bme-btns", style: "margin-top:6px" },
          btn("生成下一段摘要", guard(() => service.generateNext()), "main", service.state.mode === "manual"),
          btn("阶段总结（最近 2-3 条摘要）", guard(() => service.generateStage({ from: Math.max(0, info.coveredTo - 24), to: info.coveredTo }))),
          btn("多次总结（再压一层）", guard(() => service.generateLong({ from: 0, to: Math.max(0, info.coveredTo) }))),
        ),
        h("div", { class: "bme-mut", style: "margin-top:4px", text: `模式：${service.state.mode === "extra" ? "额外生成（自动）" : "手动（自动已关）"} · 自动每 ${service.state.cfg.auto.every} 楼一段，间隔 ≥ ${Math.round(service.state.cfg.auto.minIntervalMs / 1000)}s` }),
      ),
    );

    const nodes = [...service.state.tree].sort((a, b) => (b.level - a.level) || (a.from - b.from));
    const list = h("div", { class: "bme-sec" }, h("h4", { text: `摘要树（${nodes.length}）` }));
    if (!nodes.length) list.appendChild(h("div", { class: "bme-mut", text: "还没有摘要。先「生成下一段摘要」，或者在下一段做「补课」。" }));
    for (const node of nodes) {
      list.appendChild(
        h(
          "div",
          { class: "bme-row" },
          h(
            "div",
            { class: "bme-grow" },
            h("div", {}, h("span", { class: "bme-chip", text: LEVEL_NAME[node.level] }), h("span", { class: "bme-chip", text: rangeLabel(node.from, node.to) }), node.kept === false ? h("span", { class: "bme-chip bme-warn", text: "已停用" }) : null, node.source !== "ai" ? h("span", { class: "bme-chip", text: node.source }) : null),
            h("div", { class: "bme-mut", text: trimText(node.text, 220) }),
          ),
          h(
            "div",
            { class: "bme-btns" },
            btn(node.kept === false ? "启用" : "停用", () => {
              service.toggleNode(node.id);
              done();
            }),
            btn("编辑", () => {
              editInline(node);
            }),
            btn("删除", () => {
              if (!window.confirm(`删除 ${LEVEL_NAME[node.level]}（${rangeLabel(node.from, node.to)}）？`)) return;
              service.deleteNode(node.id);
              done();
            }, "bad"),
          ),
        ),
      );
    }
    box.appendChild(list);
    return box;
  };

  const editInline = (node: SummaryNode): void => {
    const wrap = h(
      "div",
      { class: "bme-sec" },
      h("h4", { text: `编辑 ${LEVEL_NAME[node.level]} · ${rangeLabel(node.from, node.to)}` }),
      textarea(node.text, 8, (text) => {
        service.editNode(node.id, text);
        done();
      }),
      h("div", { class: "bme-mut", text: "离开输入框即保存；旧版本会留在历史里。" }),
    );
    body.insertBefore(wrap, body.firstChild);
  };

  /* ------------------------------ 状态账本 ------------------------------ */

  const renderLedger = (): HTMLElement => {
    const info = service.info();
    const box = h("div");
    box.appendChild(
      h(
        "div",
        { class: "bme-sec" },
        h("h4", { text: "剧情状态账本" }),
        h("div", { class: "bme-mut", text: `${info.ledger} 条。每条按「类型 / 对象 / 项目」唯一，更新时旧值自动压进历史，值没变则不会重复记。` }),
        h(
          "div",
          { class: "bme-btns", style: "margin-top:6px" },
          btn("核对最近一段（生成草稿）", guard(() => service.generateLedger([Math.max(0, info.coveredTo - 5), Math.max(0, info.coveredTo)]))),
          btn("从最近一楼核对", guard(() => info.floors.to >= 0 ? service.generateLedger([info.floors.to, info.floors.to]) : Promise.reject(new Error("没有楼层")))),
          btn("汇入小手机记录", () => {
            const notes = options.notesProvider ? options.notesProvider() : null;
            if (!notes || !notes.length) {
              say("没有可汇入的手机记录", "warn");
              return;
            }
            const stats = service.mergePhoneNotes(notes);
            say(`汇入 ${notes.length} 条：新增 ${stats.added} / 更新 ${stats.updated} / 未变 ${stats.unchanged}`);
            done();
          }),
        ),
        h("div", { class: "bme-mut", style: "margin-top:4px", text: "手机记录只会变成「外部记录」条目，和正文摘要分开标注，不会覆盖模型读到的正文。" }),
      ),
    );

    const list = h("div", { class: "bme-sec" }, h("h4", { text: `条目（${service.state.ledger.length}）` }));
    if (!service.state.ledger.length) list.appendChild(h("div", { class: "bme-mut", text: "还没有状态条目。" }));
    for (const row of service.state.ledger) {
      const toInput = textInput(row.to, (text) => {
        service.editLedger(row.id, { to: text });
      });
      const subjectInput = textInput(row.subject, (text) => {
        service.editLedger(row.id, { subject: text });
      });
      list.appendChild(
        h(
          "div",
          { class: "bme-row" },
          h(
            "div",
            { class: "bme-grow" },
            h(
              "div",
              {},
              h("span", { class: "bme-chip", text: LEDGER_LABELS[row.kind] }),
              h("span", { class: "bme-chip", text: row.floor >= 0 ? `#${row.floor + 1}楼` : "无楼层" }),
              h("span", { class: "bme-chip", text: row.source }),
            ),
            h("div", { class: "bme-mut", text: `项目：${row.key}｜原值：${row.from || "未知"}` }),
            toInput,
            subjectInput,
            row.evidence ? h("div", { class: "bme-mut", text: `依据：${row.evidence}` }) : null,
          ),
          h(
            "div",
            { class: "bme-btns" },
            btn("历史", () => {
              say(row.history.length ? row.history.slice(-3).map((item) => `${item.from}→${item.to}`).join("｜") : "没有历史");
            }),
            btn("改类型", () => {
              const kinds: LedgerKind[] = ["person", "relation", "promise", "item", "place", "time", "other"];
              const next = kinds[(kinds.indexOf(row.kind) + 1) % kinds.length];
              service.editLedger(row.id, { kind: next });
              done();
            }),
            btn("删除", () => {
              service.deleteLedger(row.id);
              done();
            }, "bad"),
          ),
        ),
      );
    }
    box.appendChild(list);
    return box;
  };

  /* ------------------------------ 待确认 ------------------------------ */

  const renderDrafts = (): HTMLElement => {
    const drafts = service.drafts();
    const box = h("div");
    box.appendChild(
      h(
        "div",
        { class: "bme-sec" },
        h("h4", { text: `待确认（${drafts.length}）` }),
        h("div", { class: "bme-mut", text: "模型生成的东西不会直接进记忆，先落到这里。你可以改完再确认，也可以整段丢弃——丢弃不留痕。" }),
        h(
          "div",
          { class: "bme-btns", style: "margin-top:6px" },
          btn("全部确认", () => {
            const n = service.confirmAll();
            say(`已确认 ${n} 条`);
            done();
          }, "main", !drafts.length),
          btn("全部丢弃", () => {
            const n = service.clearDrafts();
            say(`已丢弃 ${n} 条`, "warn");
            done();
          }, "bad", !drafts.length),
          btn("撤回上一步", () => {
            const label = service.undo();
            say(label ? `已撤回：${label}` : "没有可撤回的操作", label ? "info" : "warn");
            done();
          }, undefined, !service.state.undo.length),
        ),
      ),
    );
    for (const draft of drafts) box.appendChild(draftCard(draft));
    if (!drafts.length) box.appendChild(h("div", { class: "bme-sec bme-mut", text: "当前没有待确认内容。" }));
    return box;
  };

  const draftCard = (draft: Draft): HTMLElement => {
    const head =
      draft.kind === "ledger"
        ? `状态变化草稿 · ${rangeLabel(draft.from, draft.to)}（${draft.rows ? draft.rows.length : 0} 条）`
        : `${LEVEL_NAME[(draft.level ?? 0) as SummaryLevel]}草稿 · ${rangeLabel(draft.from, draft.to)}${draft.covers && draft.covers.length ? ` · 合并 ${draft.covers.length} 条` : ""}`;
    const card = h(
      "div",
      { class: "bme-sec" },
      h("h4", { text: head }),
      h(
        "div",
        { class: "bme-btns", style: "margin-bottom:6px" },
        btn("确认", () => {
          service.confirm(draft.id);
          say("已确认");
          done();
        }, "main"),
        btn("丢弃", () => {
          service.reject(draft.id);
          done();
        }, "bad"),
      ),
    );
    if (draft.kind === "summary") {
      card.appendChild(
        textarea(draft.text || "", 8, (text) => {
          service.editDraftText(draft.id, text);
          done();
        }),
      );
    } else {
      (draft.rows || []).forEach((row, index) => {
        card.appendChild(
          h(
            "div",
            { class: "bme-row" },
            h(
              "div",
              { class: "bme-grow" },
              h("div", {}, h("span", { class: "bme-chip", text: LEDGER_LABELS[row.kind] }), h("span", { class: "bme-chip", text: `${row.subject} / ${row.key}` })),
              h("div", { class: "bme-mut", text: `${row.from || "未知"} → ${row.to}${row.evidence ? `（依据：${row.evidence}）` : ""}` }),
              textInput(row.to, (text) => {
                service.editDraftRow(draft.id, index, { to: text });
                done();
              }),
            ),
          ),
        );
      });
    }
    return card;
  };

  /* ------------------------------ 记忆缺口 ------------------------------ */

  const renderGaps = (): HTMLElement => {
    const info = service.info();
    const report = info.coverage;
    const box = h("div");
    const sec = h(
      "div",
      { class: "bme-sec" },
      h("h4", { text: "记忆缺口" }),
      report
        ? h("div", { class: "bme-mut", text: `#${report.from + 1}-#${report.to + 1} 楼 · 按每 ${report.step} 楼一块切 · 覆盖率 ${Math.round(report.ratio * 100)}% · 缺口 ${report.missing.length} 段${report.extraMissing.length ? `（其中 ${report.extraMissing.length} 楼由宿主侧报告）` : ""}` })
        : h("div", { class: "bme-mut", text: "没有楼层" }),
      h(
        "div",
        { class: "bme-btns", style: "margin-top:6px" },
        btn("按块大小补课（逐段进待确认）", guard(async () => {
          const result = await service.backfill({});
          say(`补课 ${result.drafts}/${result.ranges} 段，已进待确认`);
          done();
        }), "main"),
        btn("只补最近 3 段", guard(async () => {
          const numbers = service.floors().map((floor) => floor.mesid);
          const from = Math.max(0, numbers.length ? numbers[numbers.length - 1] - service.state.cfg.auto.every * 3 + 1 : 0);
          const result = await service.backfill({ from });
          say(`补课 ${result.drafts}/${result.ranges} 段`);
          done();
        })),
        btn("指定范围补课", () => {
          const min = Number(window.prompt("从第几楼开始？", String(info.floors.from + 1)));
          if (!Number.isFinite(min)) return;
          const max = Number(window.prompt("到第几楼结束？", String(info.floors.to + 1)));
          if (!Number.isFinite(max)) return;
          guard(async () => {
            const result = await service.backfill({ from: min - 1, to: max - 1 });
            say(`补课 ${result.drafts}/${result.ranges} 段`);
            done();
          })();
        }),
      ),
      h("div", { class: "bme-mut", style: "margin-top:4px", text: "缺口本身不会阻塞生成；它只会让召回在注入块里标注「这段没有摘要，可能不连续」。" }),
    );
    box.appendChild(sec);
    const list = h("div", { class: "bme-sec" }, h("h4", { text: "缺口列表" }));
    if (!report || !report.missing.length) list.appendChild(h("div", { class: "bme-mut", text: "没有缺口。" }));
    for (const [a, b] of (report ? report.missing.slice(0, 40) : [])) {
      list.appendChild(
        h(
          "div",
          { class: "bme-row" },
          h("div", { class: "bme-grow", text: rangeLabel(a, b) }),
          h("div", { class: "bme-btns" }, btn("补这一段", guard(() => service.generateBlock([a, b])))),
        ),
      );
    }
    box.appendChild(list);
    return box;
  };

  /* ------------------------------ 召回与审计 ------------------------------ */

  const recallView = (record: RecallRecord | null): HTMLElement => {
    const sec = h("div", { class: "bme-sec" }, h("h4", { text: "上次召回" }));
    if (!record) sec.appendChild(h("div", { class: "bme-mut", text: "还没有召回记录。" }));
    else {
      sec.appendChild(
        h("div", {
          class: "bme-mut",
          text: `${new Date(record.at).toLocaleString()} · ${record.scope === "phone" ? "只召回手机资料" : "楼层记忆"} · #${record.floor + 1} 楼 · 注入 ${record.chars}/${record.budget} 字`,
        }),
      );
      if (record.keywords.length) {
        sec.appendChild(h("div", {}, ...record.keywords.map((word) => h("span", { class: "bme-chip", text: word }))));
      }
      for (const hit of record.picks) {
        sec.appendChild(
          h(
            "div",
            { class: "bme-hit" },
            h("div", {},
              h("span", { class: "bme-chip", text: hit.kind }),
              h("span", { class: "bme-chip", text: hit.score.toFixed(2) })),
            h("div", { class: "bme-mut", text: hit.label }),
            h("div", { class: "bme-mut", text: trimText(hit.text, 160) }),
            h("div", { class: "bme-mut", text: hit.why.join("｜") }),
          ),
        );
      }
      if (record.skipped.length) {
        const details = h("details", { class: "bme-details" }, h("summary", { text: `没进注入的 ${record.skipped.length} 条` }));
        for (const skip of record.skipped) {
          details.appendChild(h("div", { class: "bme-mut", text: `${skip.label} · ${skip.score} · ${skip.reason}` }));
        }
        sec.appendChild(details);
      }
      if (record.text) {
        sec.appendChild(h("details", { class: "bme-details" }, h("summary", { text: "注入原文" }), h("pre", { class: "bme-mut", style: "white-space:pre-wrap", text: record.text })));
      }
    }
    return sec;
  };

  const renderRecall = (): HTMLElement => {
    const cfg = service.state.cfg.recall;
    const box = h("div");
    box.appendChild(
      h(
        "div",
        { class: "bme-sec" },
        h("h4", { text: "召回动作" }),
        h(
          "div",
          { class: "bme-btns" },
          btn("现在召回并注入", () => {
            const record = service.recall({});
            say(record ? `注入 ${record.chars} 字 / ${record.picks.length} 条` : "召回已关闭", record ? "info" : "warn");
            done();
          }, "main"),
          btn("只召回手机资料", () => {
            const record = service.recall({ phoneOnly: true });
            say(record ? `注入 ${record.chars} 字` : "召回已关闭");
            done();
          }),
          btn("清空注入", () => {
            service.clearInject();
            done();
          }, "bad"),
          btn("刷新关键词", () => {
            const words = service.refreshKeywords();
            say(`关键词：${words.join("、") || "（无）"}`);
            done();
          }),
        ),
        h("div", { class: "bme-mut", style: "margin-top:4px", text: "生成前由宿主调用一次召回、生成结束后由宿主清空——剪辑台不会自己塞第二次。" }),
      ),
    );
    box.appendChild(
      h(
        "div",
        { class: "bme-sec" },
        h("h4", { text: "召回设置" }),
        toggle("允许召回注入", cfg.enabled, (next) => {
          cfg.enabled = next;
        }, "关掉后连手机资料也不会注入"),
        h(
          "div",
          { class: "bme-grid" },
          h("div", {}, h("div", { class: "bme-mut", text: "摘要/账本条数上限" }), numberInput(cfg.top, (n) => { cfg.top = n; }, 0, 20)),
          h("div", {}, h("div", { class: "bme-mut", text: "身体/生活/物品条数上限" }), numberInput(cfg.bodies, (n) => { cfg.bodies = n; }, 0, 10)),
          h("div", {}, h("div", { class: "bme-mut", text: "相似度下限（0~1）" }), numberInput(cfg.minScore, (n) => { cfg.minScore = n; }, 0, 1, 0.01)),
          h("div", {}, h("div", { class: "bme-mut", text: "注入字数预算" }), numberInput(cfg.maxChars, (n) => { cfg.maxChars = n; }, 600, 12000, 100)),
          h("div", {}, h("div", { class: "bme-mut", text: "注入深度（越小越靠近正文）" }), numberInput(cfg.depth, (n) => { cfg.depth = n; }, 0, 10)),
        ),
        h("div", { class: "bme-mut", text: "常驻关键词（逗号分隔，会额外加权重）" }),
        textInput(cfg.keywords.join("，"), (text) => {
          cfg.keywords = text.split(/[,，\s]+/).map((word) => word.trim()).filter(Boolean).slice(0, 20);
        }, "例如：婚约，掌门，灵根"),
        h("div", { class: "bme-grid" },
          ...[
            ["summary", "摘要树"],
            ["ledger", "状态账本"],
            ["memory", "长期记忆"],
            ["life", "生活细节"],
            ["item", "物品"],
            ["history", "历史正文"],
          ].map(([key, label]) =>
            toggle(label, (cfg.sources as unknown as Record<string, boolean>)[key], (next) => {
              (cfg.sources as unknown as Record<string, boolean>)[key] = next;
            }),
          ),
        ),
      ),
    );
    box.appendChild(recallView(service.info().lastRecall));
    return box;
  };

  /* ------------------------------ 设置与诊断 ------------------------------ */

  const renderSettings = (): HTMLElement => {
    const state = service.state;
    const cfg = state.cfg;
    const info = service.info();
    const box = h("div");
    box.appendChild(
      h(
        "div",
        { class: "bme-sec" },
        h("h4", { text: "运行" }),
        toggle("剪辑台总开关", state.enabled, (next) => {
          state.enabled = next;
        }, "关闭后不自动摘要、不召回、不注入"),
        toggle("额外生成（每轮回复后自动摘要）", cfg.auto.enabled && state.mode === "extra", (next) => {
          cfg.auto.enabled = next;
          state.mode = next ? "extra" : "manual";
        }, "关闭后只在你点按钮时生成"),
        h(
          "div",
          { class: "bme-grid" },
          h("div", {}, h("div", { class: "bme-mut", text: "每多少楼一段（块大小）" }), numberInput(cfg.auto.every, (n) => { cfg.auto.every = n; }, 1, 40)),
          h("div", {}, h("div", { class: "bme-mut", text: "两次自动摘要最小间隔（秒）" }), numberInput(Math.round(cfg.auto.minIntervalMs / 1000), (n) => { cfg.auto.minIntervalMs = n * 1000; }, 30, 3600, 10)),
        ),
        h("div", { class: "bme-mut", text: `宿主接口：楼层 ${info.floors.valid}/${info.floors.total} · 收纳${info.shelveSupported ? "可用" : "不可用"} · 状态：${info.running ? "正在生成" : info.status || "空闲"}${info.lastError ? ` · 上次错误：${info.lastError}` : ""}` }),
      ),
    );
    box.appendChild(
      h(
        "div",
        { class: "bme-sec" },
        h("h4", { text: "楼层收纳（只隐藏，不删除）" }),
        toggle("启用收纳", cfg.shelve.enabled, (next) => {
          cfg.shelve.enabled = next;
        }, "只收纳「已被阶段总结/多次总结覆盖」且超出保留数的楼层"),
        h("div", { class: "bme-grid" }, h("div", {}, h("div", { class: "bme-mut", text: "保留最近多少楼不收" }), numberInput(cfg.shelve.keepRecent, (n) => { cfg.shelve.keepRecent = n; }, 10, 2000, 10))),
        h(
          "div",
          { class: "bme-btns", style: "margin-top:6px" },
          btn("现在收纳", guard(async () => {
            const result = await service.shelve({});
            say(`已收纳 ${result.hidden} 楼（保留最近 ${result.keep} 楼）`);
            done();
          }), "main", !info.shelveSupported),
          btn("全部恢复", guard(async () => {
            const result = await service.unshelve();
            say(`已恢复 ${result.shown} 楼`);
            done();
          }), undefined, !info.shelveSupported || !state.hidden.length),
        ),
        h("div", { class: "bme-mut", text: `已收纳 ${info.hidden} 楼。隐藏只影响模型看到的内容，聊天记录本身不动。` }),
      ),
    );
    box.appendChild(
      h(
        "div",
        { class: "bme-sec" },
        h("h4", { text: "与小手机分工" }),
        toggle("向小手机暴露只读镜像", cfg.handoff.exposeMirror, (next) => {
          cfg.handoff.exposeMirror = next;
        }, "小手机只读摘要与账本，不再自己生成楼层摘要"),
        h("div", { class: "bme-mut", text: "两边都开自动摘要会各自建树、各自算缺口，同一段剧情会被注入两次；所以约定是：楼层记忆归引擎，手机只管手机内通信记忆。" }),
      ),
    );
    box.appendChild(
      h(
        "div",
        { class: "bme-sec" },
        h("h4", { text: "提示词（改了立刻生效）" }),
        ...[...Object.keys(DEFAULT_PROMPTS) as PromptKind[]].map((kind) =>
          h(
            "details",
            { class: "bme-details", style: "margin-bottom:6px" },
            h("summary", { text: `${kind} · ${trimText(state.presets[kind] || DEFAULT_PROMPTS[kind], 40)}…` }),
            textarea(state.presets[kind] || DEFAULT_PROMPTS[kind] || "", 8, (text) => {
              state.presets[kind] = text;
            }),
          ),
        ),
        h("div", { class: "bme-btns" }, btn("恢复默认提示词", () => {
          service.resetPrompts();
          done();
        })),
      ),
    );
    box.appendChild(
      h(
        "div",
        { class: "bme-sec" },
        h("h4", { text: "导出 / 导入" }),
        h(
          "div",
          { class: "bme-btns" },
          btn("导出记忆档案", () => download("重楼记忆档案.json", JSON.stringify(service.exportArchive(), null, 2))),
          btn("导出可读档案（Markdown）", () => {
            const digest = service.readableDigest();
            download(digest.filename, digest.text, "text/markdown");
          }),
          btn("导出配置", () => download("重楼剪辑台配置.json", JSON.stringify(service.exportConfig(), null, 2))),
          btn("导入配置", () => pickJson((data) => {
            const fields = service.importConfig(data);
            say(`已导入 ${fields} 项设置`);
            done();
          })),
          btn("导入记忆档案", () => pickJson((data) => {
            const result = service.importArchive(data);
            say(`已导入 摘要 +${result.nodes} / 状态 +${result.ledger}（跳过重复 ${result.skipped}）`);
            done();
          })),
          btn("导出诊断（脱敏）", () => download("重楼剪辑台诊断.json", JSON.stringify(service.diagnostics(), null, 2))),
        ),
        h("div", { class: "bme-mut", style: "margin-top:4px", text: "诊断文件只有版本、数量、开关与统计，不含正文、姓名、端点或密钥。" }),
      ),
    );
    box.appendChild(
      h(
        "div",
        { class: "bme-sec" },
        h("h4", { text: "统计" }),
        h("div", { class: "bme-mut", text: `摘要 ${info.stats.blocks}/${info.stats.stages}/${info.stats.longs}（0/1/2 级）· 确认 ${info.stats.confirmed} · 丢弃 ${info.stats.rejected} · 召回 ${info.stats.recalls} · 补课 ${info.stats.backfills} · 收纳 ${info.stats.shelved} · 生成 ${info.stats.runs}（失败 ${info.stats.failures}）` }),
        h("details", { class: "bme-details" }, h("summary", { text: `最近日志（${info.log.length}）` }), ...info.log.slice(-12).map((row) => h("div", { class: "bme-mut", text: `${new Date(row.at).toLocaleTimeString()} [${row.kind}] ${row.text}` }))),
        h("div", { class: "bme-btns", style: "margin-top:6px" }, btn("清空日志与历史", () => {
          service.state.log = [];
          service.state.history = [];
          done();
        }, "bad")),
      ),
    );
    return box;
  };

  const download = (filename: string, text: string, type = "application/json"): void => {
    try {
      const blob = new Blob([text], { type: `${type};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (error) {
      say(trimText(error instanceof Error ? error.message : String(error), 120), "error");
    }
  };

  const pickJson = (onData: (data: unknown) => void): void => {
    const input = h("input", { type: "file", accept: ".json,application/json", style: "display:none" });
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          onData(JSON.parse(String(reader.result)));
        } catch (error) {
          say(trimText(error instanceof Error ? error.message : String(error), 140), "error");
        }
      };
      reader.readAsText(file);
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 1000);
  };

  /* ------------------------------ 渲染 ------------------------------ */

  const render = (): void => {
    if (disposed) return;
    bar.textContent = "";
    for (const item of TABS) {
      const count =
        item.key === "drafts" ? service.state.drafts.length : item.key === "gaps" ? (service.info().coverage?.missing.length || 0) : 0;
      bar.appendChild(
        h("button", {
          class: "bme-tab",
          "data-on": item.key === tab ? "1" : "0",
          text: count ? `${item.label} (${count})` : item.label,
          onclick: () => {
            tab = item.key;
            render();
          },
        }),
      );
    }
    body.textContent = "";
    const head = h("div", { class: "bme-mut", style: "margin-bottom:6px" });
    const info = service.info();
    head.textContent = `剪辑台 ${info.editorVersion} · 引擎 ${info.pluginVersion} · ${info.enabled ? "已开启" : "已关闭"}${info.running ? " · 正在生成…" : ""}`;
    body.appendChild(head);
    if (tab === "tree") body.appendChild(renderTree());
    else if (tab === "ledger") body.appendChild(renderLedger());
    else if (tab === "drafts") body.appendChild(renderDrafts());
    else if (tab === "gaps") body.appendChild(renderGaps());
    else if (tab === "recall") body.appendChild(renderRecall());
    else body.appendChild(renderSettings());
  };

  render();

  return {
    el: root,
    render,
    activeTab: () => tab,
    dispose(): void {
      disposed = true;
      root.remove();
    },
  };
};
