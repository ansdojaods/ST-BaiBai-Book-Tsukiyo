/**
 * 剧情剪辑台 · 编排层
 * 只通过 HostPort 与宿主交互：生成走 port.generate，注入走 port.requestInject，存档走 load/saveState。
 */
import { activeNodes, coverage, coveredTo, nextPendingRange, nodesInRange } from "./core/coverage";
import { clearDrafts, confirmAll, confirmDraft, dropDraft, editDraftRow, editDraftText, pendingDrafts, pushDraft, pushUndo, undo } from "./core/draft";
import { LEDGER_LABELS, applyRows, editEntry, removeEntry, rowsFromExternal } from "./core/ledger";
import { planBackfill, planLong, planShelve, planStage, levelLabel } from "./core/plan";
import { collectCandidates, rank, renderBlock } from "./core/recall";
import { DEFAULT_PROMPTS, JSON_TAIL, PROMPT_LABELS, promptOf } from "./core/prompts";
import { EDITOR_VERSION, coerceState, diagnostics, exportConfig, freshConfig, freshState, importConfig } from "./core/state";
import { dayStamp, mkId, parseJsonLoose, pickKeywords, rangeLabel, trimText } from "./core/util";
import type { CoverageReport, Draft, LedgerDeltaRow, LedgerKind, MemoryEditorMirror, MemoryEditorState, PromptKind, RecallRecord, SummaryLevel, SummaryNode } from "./types";
import type { FloorRef, GenerateRequest, HostPort } from "./ports";

const LEVEL_NAME: Record<SummaryLevel, string> = { 0: "剧情摘要", 1: "阶段总结", 2: "多次总结" };

export interface EditorInfo {
  enabled: boolean;
  editorVersion: string;
  pluginVersion: string;
  mode: MemoryEditorState["mode"];
  auto: MemoryEditorState["cfg"]["auto"];
  recallEnabled: boolean;
  floors: { total: number; valid: number; from: number; to: number };
  summaries: number;
  activeSummaries: number;
  coveredTo: number;
  drafts: number;
  ledger: number;
  coverage: CoverageReport | null;
  hidden: number;
  shelveSupported: boolean;
  running: boolean;
  status: string;
  lastError: string;
  lastRecall: RecallRecord | null;
  stats: MemoryEditorState["stats"];
  log: MemoryEditorState["log"];
}

export class MemoryEditorService {
  private port: HostPort;
  private disposers: Array<() => void> = [];
  private running = false;
  private abort: AbortController | null = null;
  private lastInjection: RecallRecord | null = null;
  private status = "";
  private lastError = "";
  private progress: { done: number; total: number; range: [number, number] | null } | null = null;
  state: MemoryEditorState;

  constructor(port: HostPort) {
    this.port = port;
    this.state = coerceState(port.loadState());
    this.lastInjection = this.state.inject.last || null;
  }

  /* ---------------- 生命周期 ---------------- */

  init(): this {
    if (this.port.onChatChanged) {
      const off = this.port.onChatChanged(() => {
        this.cancel("已切换聊天");
        this.state = coerceState(this.port.loadState());
        this.lastInjection = this.state.inject.last || null;
        this.status = "";
      });
      this.disposers.push(off);
    }
    if (this.port.onGenerationEnded) {
      const off = this.port.onGenerationEnded(() => this.onGenerationEnded());
      this.disposers.push(off);
    }
    return this;
  }

  dispose(): void {
    for (const off of this.disposers.splice(0)) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.cancel("剪辑台已关闭");
  }

  private cancel(reason: string): void {
    if (this.abort) {
      try {
        this.abort.abort();
      } catch {
        /* ignore */
      }
      this.abort = null;
    }
    if (this.running) this.status = reason;
    this.running = false;
    this.progress = null;
  }

  private save(): void {
    try {
      const result = this.port.saveState(this.state);
      if (result && typeof (result as Promise<void>).then === "function") {
        void (result as Promise<void>).catch((error) => this.fail(error));
      }
    } catch (error) {
      this.fail(error);
    }
  }

  /** 面板改完配置/提示词后调用：落盘并让宿主广播镜像 */
  commit(): void {
    this.save();
  }

  private fail(error: unknown): void {
    this.state.stats.failures += 1;
    this.lastError = trimText(error instanceof Error ? error.message : String(error), 200);
    this.log(this.lastError, "error");
  }

  private log(text: string, kind: "info" | "warn" | "error" = "info"): void {
    this.state.log = [...this.state.log, { at: Date.now(), kind, text: trimText(text, 300) }].slice(-200);
    if (this.port.log) this.port.log(`[memory-editor] ${text}`);
  }

  /* ---------------- 只读视图 ---------------- */

  floors(): FloorRef[] {
    return (this.port.listFloors() || []).filter((floor) => floor.valid !== false).sort((a, b) => a.mesid - b.mesid);
  }

  private floorNumbers(): number[] {
    return this.floors().map((floor) => floor.mesid);
  }

  private floorTexts(range: [number, number]): Array<{ floor: number; role: string; text: string }> {
    return this.floors()
      .filter((floor) => floor.mesid >= range[0] && floor.mesid <= range[1])
      .map((floor) => ({ floor: floor.mesid, role: floor.role, text: trimText(floor.text, 1200) }));
  }

  coverageReport(): CoverageReport | null {
    const numbers = this.floorNumbers();
    if (!numbers.length) return null;
    const extra = this.port.missingFloors ? this.port.missingFloors() || [] : [];
    return coverage(this.state.tree, Math.min(...numbers), Math.max(...numbers), this.state.cfg.auto.every, extra);
  }

  info(): EditorInfo {
    const numbers = this.floorNumbers();
    const all = this.port.listFloors() || [];
    return {
      enabled: this.state.enabled,
      editorVersion: EDITOR_VERSION,
      pluginVersion: this.port.pluginVersion(),
      mode: this.state.mode,
      auto: this.state.cfg.auto,
      recallEnabled: this.state.cfg.recall.enabled,
      floors: {
        total: all.length,
        valid: numbers.length,
        from: numbers.length ? Math.min(...numbers) : -1,
        to: numbers.length ? Math.max(...numbers) : -1,
      },
      summaries: this.state.tree.length,
      activeSummaries: activeNodes(this.state.tree).length,
      coveredTo: coveredTo(this.state.tree),
      drafts: pendingDrafts(this.state).length,
      ledger: this.state.ledger.length,
      coverage: this.coverageReport(),
      hidden: this.state.hidden.length,
      shelveSupported: typeof this.port.hideFloors === "function",
      running: this.running,
      status: this.progress ? `正在生成 ${this.progress.done + 1}/${this.progress.total}` : this.status,
      lastError: this.lastError,
      lastRecall: this.lastInjection,
      stats: this.state.stats,
      log: this.state.log.slice(-20),
    };
  }

  capability(): { available: true; apiVersion: number; pluginVersion: string } {
    return { available: true, apiVersion: 1, pluginVersion: this.port.pluginVersion() };
  }

  /** 给外部（例如小手机）看的只读镜像：给标签、分数与理由，不给正文全文之外的内部结构 */
  mirror(): MemoryEditorMirror {
    const report = this.coverageReport();
    const last = this.lastInjection;
    return {
      available: true,
      apiVersion: 1,
      pluginVersion: this.port.pluginVersion(),
      updatedAt: Date.now(),
      enabled: this.state.enabled,
      mode: this.state.mode,
      owner: "engine",
      coverage: report,
      summaries: activeNodes(this.state.tree).map((node) => ({
        id: node.id,
        level: node.level,
        from: node.from,
        to: node.to,
        text: trimText(node.text, 1200),
        covers: [...node.covers],
      })),
      ledger: this.state.ledger.map((row) => ({
        id: row.id,
        kind: row.kind,
        subject: row.subject,
        key: row.key,
        from: row.from,
        to: row.to,
        floor: row.floor,
      })),
      counts: {
        summaries: this.state.tree.length,
        active: activeNodes(this.state.tree).length,
        drafts: this.state.drafts.length,
        ledger: this.state.ledger.length,
        hidden: this.state.hidden.length,
      },
      lastRecall: last
        ? {
            at: last.at,
            floor: last.floor,
            chars: last.chars,
            budget: last.budget,
            hits: last.picks.map((hit) => ({ label: hit.label, score: Number(hit.score.toFixed(3)), why: [...hit.why] })),
          }
        : null,
    };
  }

  /* ---------------- 生成 ---------------- */

  private buildSystem(kind: PromptKind): string {
    return (
      "你是剧情记忆整理助手，为一部连续连载的中文剧情维护长期记忆。" +
      "只依据给出的材料，不补充材料里没有的事实，不写建议，不做文风润色。" +
      "\n" +
      promptOf(this.state.presets, kind) +
      JSON_TAIL
    );
  }

  private async call(kind: PromptKind | "summary" | "ledger", prompt: PromptKind, payload: unknown, range: [number, number]): Promise<unknown> {
    if (!this.state.enabled) throw new Error("剪辑台已关闭");
    if (this.running) throw new Error("已有任务在跑，等它结束");
    this.running = true;
    this.status = "正在生成…";
    this.abort = typeof AbortController === "function" ? new AbortController() : null;
    const request: GenerateRequest = {
      kind,
      system: this.buildSystem(prompt),
      user: JSON.stringify(payload),
      range,
      signal: this.abort ? this.abort.signal : undefined,
    };
    try {
      const result = await this.port.generate(request);
      this.state.stats.runs += 1;
      if (!result || result.ok === false) throw new Error(result && result.error ? result.error : "生成失败");
      const parsed = parseJsonLoose(result.text);
      if (parsed === null) throw new Error("模型没有返回可解析的 JSON");
      return parsed;
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.running = false;
      this.abort = null;
      this.status = "";
    }
  }

  /** 剧情摘要（0 级）：一个楼块一次调用 */
  async generateBlock(range: [number, number]): Promise<Draft> {
    const rows = this.floorTexts(range);
    if (!rows.length) throw new Error("这个范围没有正文");
    const parsed = (await this.call("summary", "block", {
      任务: "剧情摘要",
      楼层范围: [range[0] + 1, range[1] + 1],
      正文: rows,
      已有摘要: nodesInRange(this.state.tree, { level: 0, from: range[0], to: range[1] }).map((node) => trimText(node.text, 300)),
    }, range)) as { summary?: unknown };
    const text = trimText(parsed.summary, 2000);
    if (!text) throw new Error("模型没有给出摘要正文");
    const draft = pushDraft(this.state, { kind: "summary", level: 0, from: range[0], to: range[1], text, covers: [], source: "ai" });
    this.log(`剧情摘要草稿：${rangeLabel(range[0], range[1])}`);
    this.save();
    return draft;
  }

  /** 阶段总结（1 级）：合并多条剧情摘要 */
  async generateStage(range: { from: number; to: number }): Promise<Draft> {
    const plan = planStage(this.state, range);
    if (!plan.material.length) throw new Error("这个范围还没有剧情摘要，先补课或生成摘要");
    const parsed = (await this.call("summary", "stage", {
      任务: "阶段总结",
      楼层范围: [plan.from + 1, plan.to + 1],
      剧情摘要: plan.material.map((node) => ({ 覆盖: [node.from + 1, node.to + 1], 摘要: trimText(node.text, 900) })),
    }, [plan.from, plan.to])) as { summary?: unknown };
    const text = trimText(parsed.summary, 2500);
    if (!text) throw new Error("模型没有给出总结正文");
    const draft = pushDraft(this.state, { kind: "summary", level: 1, from: plan.from, to: plan.to, text, covers: plan.covers, source: "ai" });
    this.log(`阶段总结草稿：${rangeLabel(plan.from, plan.to)}（合并 ${plan.covers.length} 条）`);
    this.save();
    return draft;
  }

  /** 多次总结（2 级） */
  async generateLong(range: { from: number; to: number }): Promise<Draft> {
    const plan = planLong(this.state, range);
    if (plan.material.length < 2) throw new Error("至少要有两条阶段总结才能再压一层");
    const parsed = (await this.call("summary", "long", {
      任务: "多次总结",
      楼层范围: [plan.from + 1, plan.to + 1],
      阶段总结: plan.material.map((node) => ({ 覆盖: [node.from + 1, node.to + 1], 总结: trimText(node.text, 900) })),
    }, [plan.from, plan.to])) as { summary?: unknown };
    const text = trimText(parsed.summary, 3000);
    if (!text) throw new Error("模型没有给出总结正文");
    const draft = pushDraft(this.state, { kind: "summary", level: 2, from: plan.from, to: plan.to, text, covers: plan.covers, source: "ai" });
    this.log(`多次总结草稿：${rangeLabel(plan.from, plan.to)}`);
    this.save();
    return draft;
  }

  /** 状态核对：从楼层里抽取“明确发生的变化” */
  async generateLedger(range: [number, number]): Promise<Draft> {
    const rows = this.floorTexts(range);
    if (!rows.length) throw new Error("这个范围没有正文");
    const parsed = (await this.call("ledger", "ledger", {
      任务: "剧情状态核对",
      楼层范围: [range[0] + 1, range[1] + 1],
      正文: rows,
      已有状态: this.state.ledger.slice(0, 80).map((row) => ({ kind: row.kind, subject: row.subject, key: row.key, 现在是: row.to })),
    }, range)) as { rows?: unknown };
    const list = Array.isArray(parsed.rows) ? parsed.rows.slice(0, 40) : [];
    const mapped: LedgerDeltaRow[] = list
      .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
      .map((row) => ({
        kind: (["person", "relation", "promise", "item", "place", "time", "other"].includes(String(row.kind)) ? row.kind : "other") as LedgerKind,
        subject: trimText(row.subject, 40),
        key: trimText(row.key, 40),
        from: trimText(row.from, 200) || "未知",
        to: trimText(row.to, 200),
        evidence: trimText(row.evidence, 300),
        floor: range[0],
      }))
      .filter((row) => row.subject && row.key && row.to);
    if (!mapped.length) throw new Error("模型没有找到明确的状态变化");
    const draft = pushDraft(this.state, { kind: "ledger", from: range[0], to: range[1], rows: mapped, source: "ai" });
    this.log(`状态变化草稿：${rangeLabel(range[0], range[1])}（${mapped.length} 条）`);
    this.save();
    return draft;
  }

  /** 让模型挑检索关键词（可选） */
  async generateKeywords(): Promise<string[]> {
    const floors = this.floors();
    if (!floors.length) throw new Error("当前聊天没有正文");
    const tail = floors.slice(-6).map((floor) => ({ floor: floor.mesid, text: trimText(floor.text, 400) }));
    const parsed = (await this.call("keywords", "keywords", { 任务: "检索关键词", 最近正文: tail }, [tail[0].floor, tail[tail.length - 1].floor])) as { keywords?: unknown };
    const list = Array.isArray(parsed.keywords) ? parsed.keywords.map((x) => trimText(x, 20)).filter(Boolean).slice(0, 12) : [];
    if (!list.length) throw new Error("模型没有给出关键词");
    this.state.cfg.recall.keywords = list;
    this.save();
    return list;
  }

  /** 补课：只补缺口，逐段进「待确认」 */
  async backfill(options: { from?: number; to?: number; batch?: number; onProgress?: (p: { done: number; total: number; range: [number, number] | null }) => void } = {}): Promise<{ ranges: number; drafts: number }> {
    const numbers = this.floorNumbers();
    if (!numbers.length) throw new Error("当前聊天没有正文");
    const batch = Math.max(1, Math.min(40, Math.round(options.batch || this.state.cfg.auto.every || 6)));
    const plan = planBackfill(this.state, numbers, { from: options.from, to: options.to, step: batch });
    if (!plan.ranges.length) throw new Error("这个范围没有缺口");
    this.progress = { done: 0, total: plan.ranges.length, range: null };
    let drafts = 0;
    try {
      for (const range of plan.ranges) {
        if (!this.port.busy()) {
          this.progress = { done: drafts, total: plan.ranges.length, range };
          options.onProgress?.(this.progress);
          await this.generateBlock(range);
          drafts += 1;
        }
      }
      this.state.stats.backfills += 1;
      this.state.seen.lastBlockAt = Date.now();
      this.log(`补课完成：${drafts} 段`);
      this.save();
      return { ranges: plan.ranges.length, drafts };
    } finally {
      this.progress = null;
    }
  }

  /* ---------------- 草稿 / 树 / 账本 ---------------- */

  drafts(): Draft[] {
    return pendingDrafts(this.state);
  }

  confirm(id: string): ReturnType<typeof confirmDraft> {
    const result = confirmDraft(this.state, id);
    if (result) this.save();
    return result;
  }

  confirmAll(): number {
    const n = confirmAll(this.state);
    if (n) this.save();
    return n;
  }

  reject(id: string): boolean {
    const ok = dropDraft(this.state, id);
    if (ok) {
      this.state.stats.rejected += 1;
      this.save();
    }
    return ok;
  }

  clearDrafts(): number {
    const n = clearDrafts(this.state);
    if (n) this.save();
    return n;
  }

  editDraftText(id: string, text: string): boolean {
    const ok = editDraftText(this.state, id, text);
    if (ok) this.save();
    return ok;
  }

  editDraftRow(id: string, index: number, patch: { to?: string; from?: string; evidence?: string }): boolean {
    const ok = editDraftRow(this.state, id, index, patch);
    if (ok) this.save();
    return ok;
  }

  undo(): string {
    const frame = undo(this.state);
    if (frame) this.save();
    return frame ? frame.label : "";
  }

  toggleNode(id: string): boolean {
    const node = this.state.tree.find((row) => row.id === id);
    if (!node) return false;
    pushUndo(this.state, node.kept ? "停用摘要" : "启用摘要");
    node.kept = !node.kept;
    node.updatedAt = Date.now();
    this.save();
    return true;
  }

  editNode(id: string, text: string): boolean {
    const node = this.state.tree.find((row) => row.id === id);
    if (!node) return false;
    pushUndo(this.state, "编辑摘要");
    node.history = [...node.history, { at: node.updatedAt, text: node.text }].slice(-20);
    node.text = trimText(text, node.level === 0 ? 2000 : 3000);
    node.updatedAt = Date.now();
    this.save();
    return true;
  }

  deleteNode(id: string): boolean {
    const node = this.state.tree.find((row) => row.id === id);
    if (!node) return false;
    pushUndo(this.state, "删除摘要");
    this.state.tree = this.state.tree.filter((row) => row.id !== id);
    this.save();
    return true;
  }

  editLedger(id: string, patch: Partial<{ to: string; from: string; subject: string; key: string; evidence: string; kind: LedgerKind }>): boolean {
    pushUndo(this.state, "修改状态条目");
    const ok = editEntry(this.state.ledger, id, patch);
    if (ok) this.save();
    return ok;
  }

  deleteLedger(id: string): boolean {
    pushUndo(this.state, "删除状态条目");
    const ok = removeEntry(this.state.ledger, id);
    if (ok) this.save();
    return ok;
  }

  /** 把外部记录（例如小手机回写的行）汇进账本 */
  mergeExternal(records: Array<{ type: string; subject?: string; key?: string; to?: string; from?: string; evidence?: string; floor?: number }>): { added: number; updated: number; unchanged: number } {
    const rows = rowsFromExternal(records);
    pushUndo(this.state, "汇入外部记录");
    const stats = applyRows(this.state.ledger, rows, -1, "phone");
    this.state.history = [...this.state.history, { at: Date.now(), text: `汇入外部记录：+${stats.added} / ~${stats.updated}` }].slice(-60);
    this.save();
    return stats;
  }

  /** 按手机的 pushNotes 记录类型做一次映射（小手机 → 账本） */
  mergePhoneNotes(notes: Array<{ id: string; kind: string; title: string; text: string; floor?: number; pinned?: boolean }>): { added: number; updated: number; unchanged: number } {
    const records = notes.map((note) => {
      const type = note.kind === "phone_agenda" ? "agenda" : note.kind === "phone_promise" ? "promise" : note.kind === "phone_chat" ? "contact_status" : "other";
      return {
        type,
        subject: trimText(note.title, 40) || "手机记录",
        key: note.kind,
        from: "未知",
        to: trimText(note.text, 200),
        evidence: `小手机记录 ${note.id}`,
        floor: Number.isInteger(note.floor) ? (note.floor as number) : -1,
      };
    });
    return this.mergeExternal(records);
  }

  /* ---------------- 召回与注入 ---------------- */

  private buildQuery(floor: number): string {
    const floors = this.floors().slice(-4);
    const parts: string[] = [];
    for (const item of floors) parts.push(trimText(item.text, 500));
    const ledgerSubjects = this.state.ledger.slice(-6).map((row) => `${row.subject}${row.key}`);
    if (ledgerSubjects.length) parts.push(ledgerSubjects.join(" "));
    return `${parts.join("\n")}\n最近楼层：#${floor + 1}`;
  }

  /**
   * 生成这一轮的召回块并请求宿主注入。
   * phoneOnly = true 时只召回外部资料（小手机自己的手机记忆），楼层记忆交给别的模块。
   */
  recall(options: { query?: string; floor?: number; phoneOnly?: boolean; inject?: boolean } = {}): RecallRecord | null {
    const cfg = this.state.cfg.recall;
    if (!this.state.enabled || !cfg.enabled) {
      this.clearInject();
      return null;
    }
    const numbers = this.floorNumbers();
    const floor = Number.isInteger(options.floor) ? (options.floor as number) : numbers.length ? numbers[numbers.length - 1] : -1;
    const query = options.query || this.buildQuery(floor);
    const extras = (this.port.listExtras ? this.port.listExtras() || [] : []).slice(0, 200);
    const candidates = collectCandidates(this.state, options.phoneOnly ? extras.filter((item) => item.kind === "memory" || item.kind === "life") : extras);
    const sources = options.phoneOnly
      ? { summary: false, ledger: false, memory: true, life: true, item: true, history: true }
      : cfg.sources;
    const ranked = rank(candidates, query, { ...cfg, sources }, floor);
    const report = this.coverageReport();
    const text = renderBlock(ranked.hits, options.phoneOnly ? null : report, {
      title: options.phoneOnly ? "手机记忆 · 召回" : "剧情记忆 · 召回",
      note: cfg.keywords.length ? `常驻关键词：${cfg.keywords.join("、")}` : "",
    });
    const record: RecallRecord = {
      at: Date.now(),
      floor,
      scope: options.phoneOnly ? "phone" : "floor",
      budget: ranked.budget,
      chars: text.length,
      keywords: ranked.keywords,
      query: trimText(query, 400),
      picks: ranked.hits,
      skipped: ranked.skipped,
      text: trimText(text, 6000),
    };
    this.lastInjection = record;
    if (options.inject !== false) this.port.requestInject(text);
    return record;
  }

  clearInject(): void {
    this.lastInjection = null;
    this.port.requestInject("");
  }

  refreshKeywords(): string[] {
    const keywords = pickKeywords(this.buildQuery(this.info().floors.to), this.state.cfg.recall.keywords, 12);
    this.state.cfg.recall.keywords = keywords;
    this.save();
    return keywords;
  }

  /* ---------------- 楼层收纳 ---------------- */

  async shelve(options: { keepRecent?: number } = {}): Promise<{ hidden: number; limit: number; keep: number }> {
    if (typeof this.port.hideFloors !== "function") throw new Error("宿主没有提供隐藏楼层的接口，无法收纳（只做计划，不隐藏）");
    const numbers = this.floorNumbers();
    const plan = planShelve(this.state, numbers, options);
    if (!plan.hide.length) return { hidden: 0, limit: plan.limit, keep: plan.keep };
    const done = await Promise.resolve(this.port.hideFloors(plan.hide));
    const count = Number.isFinite(Number(done)) ? Number(done) : plan.hide.length;
    pushUndo(this.state, "收纳楼层");
    this.state.hidden = Array.from(new Set([...this.state.hidden, ...plan.hide])).sort((a, b) => a - b);
    this.state.stats.shelved += count;
    this.log(`收纳楼层 ${count} 个（保留最近 ${plan.keep} 楼）`);
    this.save();
    return { hidden: count, limit: plan.limit, keep: plan.keep };
  }

  async unshelve(): Promise<{ shown: number }> {
    if (typeof this.port.showFloors !== "function") throw new Error("宿主没有提供恢复楼层的接口");
    const list = [...this.state.hidden];
    if (!list.length) return { shown: 0 };
    const done = await Promise.resolve(this.port.showFloors(list));
    const count = Number.isFinite(Number(done)) ? Number(done) : list.length;
    pushUndo(this.state, "恢复楼层");
    this.state.hidden = [];
    this.log(`恢复楼层 ${count} 个`);
    this.save();
    return { shown: count };
  }

  /* ---------------- 自动维护 ---------------- */

  private onGenerationEnded(): void {
    if (!this.state.enabled) return;
    const numbers = this.floorNumbers();
    const floor = numbers.length ? numbers[numbers.length - 1] : -1;
    if (floor !== this.state.seen.lastFloor) {
      this.state.seen.lastFloor = floor;
      this.state.seen.lastRunsAt = Date.now();
    }
    if (this.lastInjection) {
      this.state.inject.last = this.lastInjection;
      this.state.stats.recalls += 1;
    }
    this.save();
    if (this.running || this.port.busy()) return;
    if (this.state.mode !== "extra" || !this.state.cfg.auto.enabled) return;
    if (Date.now() - (this.state.seen.lastBlockAt || 0) < this.state.cfg.auto.minIntervalMs) return;
    const pending = nextPendingRange(this.state.tree, numbers, this.state.cfg.auto.every);
    if (!pending) return;
    this.state.seen.lastBlockAt = Date.now();
    void this.generateBlock(pending).catch((error) => {
      this.log(`自动摘要跳过：${trimText(error instanceof Error ? error.message : String(error), 120)}`, "warn");
    });
  }

  /** 面板上的「现在生成」按钮：优先补下一块，否则总结最近一段 */
  async generateNext(): Promise<Draft> {
    const numbers = this.floorNumbers();
    if (!numbers.length) throw new Error("当前聊天没有正文");
    const pending = nextPendingRange(this.state.tree, numbers, this.state.cfg.auto.every);
    const range: [number, number] = pending || [Math.max(Math.min(...numbers), numbers[numbers.length - 1] - this.state.cfg.auto.every + 1), numbers[numbers.length - 1]];
    return this.generateBlock(range);
  }

  /* ---------------- 导出 ---------------- */

  diagnostics() {
    const all = this.port.listFloors() || [];
    return diagnostics(this.state, { pluginVersion: this.port.pluginVersion(), floors: all.length, validFloors: this.floorNumbers().length });
  }

  exportConfig() {
    return exportConfig(this.state);
  }

  importConfig(raw: unknown): number {
    const fields = importConfig(this.state, raw);
    this.save();
    return fields;
  }

  /** 记忆档案（摘要树 + 账本，不含正文原文） */
  exportArchive() {
    return {
      app: "st-baibai-book",
      kind: "memory-editor-archive",
      version: EDITOR_VERSION,
      exportedAt: new Date().toISOString(),
      pluginVersion: this.port.pluginVersion(),
      tree: JSON.parse(JSON.stringify(this.state.tree)) as SummaryNode[],
      ledger: JSON.parse(JSON.stringify(this.state.ledger)) as MemoryEditorState["ledger"],
      stats: { ...this.state.stats },
    };
  }

  importArchive(raw: unknown): { nodes: number; ledger: number; skipped: number } {
    if (!raw || typeof raw !== "object") throw new Error("档案格式不对");
    const data = raw as { tree?: unknown; ledger?: unknown };
    const incoming = coerceState({ tree: data.tree, ledger: data.ledger });
    pushUndo(this.state, "导入记忆档案");
    let nodes = 0;
    let skipped = 0;
    for (const node of incoming.tree) {
      const dup = this.state.tree.some((row) => row.level === node.level && row.from === node.from && row.to === node.to);
      if (dup) {
        skipped += 1;
        continue;
      }
      this.state.tree.push({ ...node, id: mkId("bme-node"), source: "import" });
      nodes += 1;
    }
    const stats = applyRows(this.state.ledger, incoming.ledger.map((row) => ({ kind: row.kind, subject: row.subject, key: row.key, from: row.from, to: row.to, evidence: row.evidence, floor: row.floor })), -1, "import");
    this.state.history = [...this.state.history, { at: Date.now(), text: `导入档案：+${nodes} 摘要 / +${stats.added} 状态` }].slice(-60);
    this.save();
    return { nodes, ledger: stats.added + stats.updated, skipped };
  }

  /** 一键恢复默认提示词 */
  resetPrompts(): void {
    this.state.presets = { ...DEFAULT_PROMPTS };
    this.save();
  }

  /** 生成一份“给人看”的可读导出（Markdown） */
  readableDigest(): { filename: string; text: string } {
    const report = this.coverageReport();
    const lines: string[] = [];
    lines.push(`# 剧情记忆档案（${dayStamp(Date.now())}）`);
    lines.push("");
    lines.push(`- 摘要 ${this.state.tree.length} 条 · 状态账本 ${this.state.ledger.length} 条 · 待确认 ${this.state.drafts.length} 条`);
    if (report) lines.push(`- 覆盖第 ${report.from + 1}-${report.to + 1} 楼 · 缺口 ${report.missing.length} 段 · 覆盖率 ${Math.round(report.ratio * 100)}%`);
    lines.push("");
    for (const level of [2, 1, 0] as SummaryLevel[]) {
      const rows = this.state.tree.filter((node) => node.level === level && node.kept !== false).sort((a, b) => a.from - b.from);
      if (!rows.length) continue;
      lines.push(`## ${LEVEL_NAME[level]}（${rows.length}）`);
      lines.push("");
      for (const node of rows) {
        lines.push(`- **${rangeLabel(node.from, node.to)}** ${node.text}`);
      }
      lines.push("");
    }
    if (this.state.ledger.length) {
      lines.push("## 剧情状态账本");
      lines.push("");
      for (const row of this.state.ledger) {
        lines.push(`- [${LEDGER_LABELS[row.kind]}] ${row.subject} / ${row.key}：${row.from === "未知" ? "" : row.from + " → "}${row.to}（#${row.floor + 1}楼）`);
      }
      lines.push("");
    }
    lines.push(`> 导出于 ${new Date().toISOString()} · 剪辑台 ${EDITOR_VERSION} · 插件 ${this.port.pluginVersion()}`);
    return { filename: `剧情记忆档案-${dayStamp(Date.now())}.md`, text: lines.join("\n") };
  }
}

/** 让面板拿到默认配置（避免面板里再 import 一次 state） */
export const defaultConfig = freshConfig;
export const defaultState = freshState;
export { PROMPT_LABELS, DEFAULT_PROMPTS, levelLabel };
