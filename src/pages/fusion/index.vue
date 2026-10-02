<script setup lang="ts">
/**
 * 「联动」页(融合版新增):三块——锚点日记 / 备份·恢复·回收站 / 小手机联动。
 * 只做展示与调用,逻辑全部在 src/anchor、src/backend、src/bridge 里。
 */
import Icon from '@/components/Icon.vue';
import ModalMask from '@/components/ModalMask.vue';
import Collapsible from '@/components/Collapsible.vue';
import { apiSettings } from '@/api/settings';
import { toast } from '@/st/toast';
import { getContext } from '@/st/context';
import { PLUGIN_VERSION } from '@/version';
import { anchorState, currentAnchor, setAnchorExcluded, updateAnchorText, addAnchor, type AnchorEntry } from '@/anchor/store';
import { deleteAnchorToTrash, generateAnchorSilently, insertTriggerIntoInput, extractAnchorBlock, effectiveInstruction } from '@/anchor/engine';
import { DEFAULT_ANCHOR_INSTRUCTION } from '@/anchor/prompts';
import { refreshInjection } from '@/memory/inject';
import { backendState, probeBackend } from '@/backend/bainiao';
import { syncState, backupSnapshotToBackend, restoreSnapshotFromBackend, listRemoteSnapshots, deleteRemoteSnapshot, pullTrashMirror, type RemoteSnapshotInfo } from '@/backend/sync';
import { restoreState, createRestorePoint, restoreFromPoint, deleteRestorePoint, buildSnapshot, parseSnapshot, applySnapshot, restoreTrashEntry } from '@/backend/restore';
import { trashState, trashRemove, trashClear, trashPush } from '@/backend/trash';
import { buildDiagnostics, downloadJson, copyText } from '@/backend/diagnostics';
import { externalState, removeExternalNote, clearExternal, setExternalPinned, pushExternalNotes } from '@/bridge/external';
import { getBrief, listChannels, testChannel as testPhoneChannel, listPhoneProfiles, importPhoneProfile } from '@/bridge/phone';
import { newChannel } from '@/api/settings';
import { computed, onMounted, ref } from 'vue';

type Tab = 'anchor' | 'backup' | 'phone';
const tab = ref<Tab>('anchor');
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'anchor', label: '锚点日记' },
  { id: 'backup', label: '备份恢复' },
  { id: 'phone', label: '小手机联动' },
];

const a = computed(() => apiSettings.anchor);
const b = computed(() => apiSettings.backend);
const p = computed(() => apiSettings.phoneBridge);

function fmtTime(ts: number | string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ================= 锚点日记 ================= */
const current = computed(() => currentAnchor());
const anchorsDesc = computed(() => [...anchorState.anchors].reverse());
const SOURCE_LABEL: Record<string, string> = { chat: '正文解析', api: '副 API 生成', manual: '手动粘贴' };
const expanded = ref<Record<string, boolean>>({});
const editingAnchor = ref<{ id: string; text: string; note: string } | null>(null);
const pasteOpen = ref(false);
const pasteText = ref('');
const pasteFloor = ref<number | ''>('');
const instructionOpen = ref(false);
const instructionDraft = ref('');

function triggerNow() {
  if (insertTriggerIntoInput()) toast('已把触发词填入输入框,发送后 AI 会在本回合末尾附上锚点日记', 'success');
  else toast('没找到聊天输入框,请手动输入触发词', 'warning');
}
async function silentGen() {
  const r = await generateAnchorSilently();
  if (r) toast(`锚点日记 第${r.version}版 已生成(覆盖到 #${r.floor})`, 'success');
  else toast(anchorState.lastError || '生成失败', 'error');
}
function openEditAnchor(e: AnchorEntry) {
  editingAnchor.value = { id: e.id, text: e.text, note: e.note ?? '' };
}
function saveEditAnchor() {
  const e = editingAnchor.value;
  if (!e) return;
  if (!e.text.trim()) {
    toast('锚点内容不能为空', 'warning');
    return;
  }
  updateAnchorText(e.id, e.text, e.note);
  refreshInjection();
  editingAnchor.value = null;
  toast('已保存', 'success');
}
function toggleExcluded(e: AnchorEntry) {
  setAnchorExcluded(e.id, !e.excluded);
  refreshInjection();
}
function delAnchor(e: AnchorEntry) {
  deleteAnchorToTrash(e.id);
  toast(`第${e.version}版已移入回收站`, 'info');
}
function openPaste() {
  pasteText.value = '';
  const chat = getContext()?.chat ?? [];
  pasteFloor.value = chat.length ? chat.length - 1 : '';
  pasteOpen.value = true;
}
function savePaste() {
  const raw = pasteText.value.trim();
  if (!raw) {
    toast('请先粘贴锚点内容', 'warning');
    return;
  }
  const text = extractAnchorBlock(raw) || raw;
  const floor = pasteFloor.value === '' ? -1 : Number(pasteFloor.value);
  const e = addAnchor(text, floor, 'manual');
  refreshInjection();
  pasteOpen.value = false;
  toast(`已保存为第${e.version}版`, 'success');
}
function openInstruction() {
  instructionDraft.value = apiSettings.anchor.instruction || DEFAULT_ANCHOR_INSTRUCTION;
  instructionOpen.value = true;
}
function saveInstruction() {
  const t = instructionDraft.value.trim();
  apiSettings.anchor.instruction = t === DEFAULT_ANCHOR_INSTRUCTION.trim() ? '' : t;
  instructionOpen.value = false;
  toast(apiSettings.anchor.instruction ? '已保存自定义指令' : '已恢复内置指令', 'success');
}
function resetInstruction() {
  instructionDraft.value = DEFAULT_ANCHOR_INSTRUCTION;
}
async function copyAnchor(e: AnchorEntry) {
  toast((await copyText(e.text)) ? '已复制' : '复制失败', 'info');
}

/* ================= 备份恢复 ================= */
const remote = ref<RemoteSnapshotInfo[]>([]);
const remoteLoading = ref(false);
const confirm = ref<{ title: string; body: string; action: () => void | Promise<void> } | null>(null);
const importOpen = ref(false);
const importText = ref('');

function ask(title: string, body: string, action: () => void | Promise<void>) {
  confirm.value = { title, body, action };
}
async function runConfirm() {
  const c = confirm.value;
  confirm.value = null;
  if (!c) return;
  try {
    await c.action();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}
async function reprobe() {
  await probeBackend(true);
  toast(backendState.available ? `白鸟数据后端可用(v${backendState.health?.version || '?'})` : `后端不可用:${backendState.lastError || '未知'}`, backendState.available ? 'success' : 'warning');
}
async function doBackup() {
  try {
    await backupSnapshotToBackend(true);
    toast(`已备份到后端(revision ${syncState.lastBackupRevision})`, 'success');
    void loadRemote();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}
function doRestoreRemote(recordId?: string) {
  ask('从后端恢复', '将用后端快照整份覆盖当前聊天的记忆(摘要/叶子/锚点/外部记录)。恢复前会自动保存一个恢复点。继续?', async () => {
    const r = await restoreSnapshotFromBackend(recordId);
    toast(`已恢复:${r.snapshot.summaries.length} 个总结节点、${r.snapshot.leaves.length} 条叶子${r.skippedLeaves ? `(${r.skippedLeaves} 条叶子因楼层不存在跳过)` : ''}`, 'success');
  });
}
async function loadRemote() {
  if (!backendState.available) return;
  remoteLoading.value = true;
  try {
    remote.value = await listRemoteSnapshots();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  } finally {
    remoteLoading.value = false;
  }
}
function delRemote(r: RemoteSnapshotInfo) {
  ask('删除后端快照', `删除「${r.charName || r.recordId}」的快照?它会进入后端回收站(30 天内可在服务器目录找回)。`, async () => {
    await deleteRemoteSnapshot(r.recordId);
    toast('已删除', 'info');
    void loadRemote();
  });
}
function makePoint() {
  const pt = createRestorePoint('手动保存');
  toast(pt ? '恢复点已保存' : '当前没有记忆数据,未建恢复点', pt ? 'success' : 'warning');
}
function doRestorePoint(id: string) {
  ask('回滚到恢复点', '将用该恢复点整份覆盖当前记忆。回滚前会自动再保存一个恢复点。继续?', () => {
    const r = restoreFromPoint(id);
    toast(r.ok ? `已回滚${r.skippedLeaves ? `(${r.skippedLeaves} 条叶子因楼层不存在跳过)` : ''}` : '恢复点不存在', r.ok ? 'success' : 'error');
  });
}
function exportFile() {
  const s = buildSnapshot();
  const name = `柏宝书记忆_${s.charName || 'chat'}_${new Date().toISOString().slice(0, 10)}.json`;
  downloadJson(name, s);
}
function openImport() {
  importText.value = '';
  importOpen.value = true;
}
function doImport() {
  let parsed: unknown;
  try {
    parsed = JSON.parse(importText.value);
  } catch {
    toast('不是合法的 JSON', 'error');
    return;
  }
  const snap = parseSnapshot(parsed);
  if (!snap) {
    toast('不是柏宝书记忆快照文件', 'error');
    return;
  }
  importOpen.value = false;
  ask('导入快照', `将用文件中的快照(${snap.charName || '未知角色'},${snap.summaries.length} 个总结节点、${snap.leaves.length} 条叶子)整份覆盖当前记忆。导入前会自动保存恢复点。继续?`, () => {
    const r = applySnapshot(snap);
    toast(`已导入${r.skippedLeaves ? `(${r.skippedLeaves} 条叶子因楼层不存在跳过)` : ''}`, 'success');
  });
}
function restoreTrash(id: string) {
  const r = restoreTrashEntry(id);
  toast(r.message, r.ok ? 'success' : 'warning');
}
function dropTrash(id: string) {
  trashRemove(id);
}
function clearAllTrash() {
  ask('清空回收站', '彻底删除回收站里的全部条目?', () => trashClear());
}
async function pullTrash() {
  try {
    const n = await pullTrashMirror();
    toast(`已从后端取回 ${n} 条回收站记录`, 'success');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}
async function diagCopy() {
  const ok = await copyText(JSON.stringify(buildDiagnostics(PLUGIN_VERSION), null, 2));
  toast(ok ? '诊断信息已复制(不含密钥与正文)' : '复制失败', ok ? 'success' : 'error');
}
function diagDownload() {
  downloadJson(`柏宝书诊断_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, buildDiagnostics(PLUGIN_VERSION));
}
const KIND_LABEL: Record<string, string> = { summary: '总结节点', subtree: '批量删除', leaf: '叶子摘要', anchor: '锚点日记', external: '外部记录', plan: '计划' };

/* ================= 小手机联动 ================= */
const briefPreview = ref('');
const channels = computed(() => listChannels());
const testing = ref<Record<string, boolean>>({});
const EXT_KIND: Record<string, string> = { phone_chat: '手机聊天', phone_promise: '约定', phone_moment: '朋友圈', agenda: '日程', fact: '事实' };
const extNotesDesc = computed(() => [...externalState.notes].sort((x, y) => y.ts - x.ts));
const manualNote = ref('');

function previewBrief() {
  try {
    briefPreview.value = JSON.stringify(getBrief(), null, 2);
  } catch (e) {
    briefPreview.value = `生成失败:${e instanceof Error ? e.message : String(e)}`;
  }
}
async function testOne(id: string) {
  testing.value = { ...testing.value, [id]: true };
  try {
    const r = await testPhoneChannel(id);
    toast(r.message, r.ok ? 'success' : 'error');
  } finally {
    testing.value = { ...testing.value, [id]: false };
  }
}
async function testAll() {
  for (const c of channels.value) await testOne(c.id);
}
function delNote(id: string) {
  const n = removeExternalNote(id);
  if (n) {
    trashPush({ kind: 'external', title: `外部记录:${(n.title || n.text).slice(0, 40)}`, payload: n });
    refreshInjection();
  }
}
function clearNotes() {
  ask('清空外部记录', '删除当前聊天全部外部记录(小手机推送的内容)?', () => {
    clearExternal();
    refreshInjection();
  });
}
function addManualNote() {
  const t = manualNote.value.trim();
  if (!t) return;
  pushExternalNotes('manual', [{ kind: 'fact', text: t }]);
  refreshInjection();
  manualNote.value = '';
  toast('已添加', 'success');
}
const phoneProfiles = ref(listPhoneProfiles());
function refreshPhoneProfiles() {
  phoneProfiles.value = listPhoneProfiles();
}
function importProfile(id: string) {
  try {
    const r = importPhoneProfile(id, newChannel);
    toast(r.created ? `已导入为渠道「${r.channel.name}」` : `已更新渠道「${r.channel.name}」`, 'success');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}
const phoneDetected = computed(() => {
  const es = getContext()?.extensionSettings as Record<string, unknown> | undefined;
  return !!es?.tsukiyo_phone;
});

onMounted(() => {
  void probeBackend().then(() => loadRemote());
});
</script>

<template>
  <section class="bbs-page">
    <h2 class="bbs-title bbs-title-sub">联动</h2>
    <div class="bbs-fu-tabs" role="tablist">
      <button v-for="t in TABS" :key="t.id" class="bbs-fu-tab" :class="{ 'bbs-fu-tab-on': tab === t.id }" type="button" role="tab" :aria-selected="tab === t.id" @click="tab = t.id">{{ t.label }}</button>
    </div>

    <!-- ===================== 锚点日记 ===================== -->
    <div v-if="tab === 'anchor'">
      <p class="bbs-fu-hint">锚点日记是"手动挡"的阶段性全面总结:关系、人物、道具与内部梗、关键细节、里程碑事件、待办伏笔。想存档时点一下即可;每次生成都保留为新版本,可回看、排除、回退。思路参考 AnchorNote,月夜来信版独立实现。</p>
      <label class="bbs-fu-switch"><span>启用锚点日记</span><input v-model="a.enabled" type="checkbox" class="bbs-fu-check" /></label>
      <div class="bbs-fu-actions">
        <button class="bbs-btn bbs-btn-primary" type="button" :disabled="!a.enabled" @click="triggerNow">生成锚点日记(写入正文)</button>
        <button class="bbs-btn" type="button" :disabled="!a.enabled || anchorState.busy" @click="silentGen">{{ anchorState.busy ? '生成中…' : '静默生成(副 API)' }}</button>
        <button class="bbs-btn" type="button" @click="openPaste">手动粘贴</button>
        <button class="bbs-btn" type="button" @click="openInstruction">编辑指令</button>
      </div>
      <p v-if="anchorState.lastError" class="bbs-fu-err">{{ anchorState.lastError }}</p>

      <Collapsible title="锚点设置" :open="false">
        <label class="bbs-fu-field"><span class="bbs-fu-label">触发词(用户发言含此句即在本回合生成)</span><input v-model="a.triggerPhrase" class="bbs-input" type="text" /></label>
        <label class="bbs-fu-switch"><span>按需注入指令(仅催更回合;关=每回合都要求写锚点)</span><input v-model="a.onDemand" type="checkbox" class="bbs-fu-check" /></label>
        <label class="bbs-fu-switch"><span>在聊天里隐藏 &lt;anchor&gt; 块(只影响显示)</span><input v-model="a.hideTagInChat" type="checkbox" class="bbs-fu-check" /></label>
        <label class="bbs-fu-switch"><span>锚点覆盖范围内的历史摘要不再注入(省 token)</span><input v-model="a.supersedeHistory" type="checkbox" class="bbs-fu-check" /></label>
        <div class="bbs-fu-grid2">
          <label class="bbs-fu-field"><span class="bbs-fu-label">注入深度</span><input v-model.number="a.injectDepth" class="bbs-input" type="number" min="0" max="200" /></label>
          <label class="bbs-fu-field"><span class="bbs-fu-label">注入最大字符</span><input v-model.number="a.maxChars" class="bbs-input" type="number" min="500" max="60000" step="500" /></label>
        </div>
      </Collapsible>

      <h3 class="bbs-fu-sub">当前生效:{{ current ? `第${current.version}版 · 覆盖到 #${current.floor >= 0 ? current.floor : '?'}` : '无' }}</h3>
      <div v-if="!anchorsDesc.length" class="bbs-empty">还没有锚点日记。点「生成锚点日记」后发送一条消息,或用副 API 静默生成。</div>
      <div v-for="e in anchorsDesc" :key="e.id" class="bbs-fu-card" :class="{ 'bbs-fu-card-off': e.excluded, 'bbs-fu-card-on': current && current.id === e.id }">
        <div class="bbs-fu-card-head">
          <div class="bbs-fu-card-meta">
            <strong>第{{ e.version }}版</strong>
            <span>#{{ e.floor >= 0 ? e.floor : '?' }}</span>
            <span>{{ SOURCE_LABEL[e.source] }}</span>
            <span>{{ fmtTime(e.createdAt) }}</span>
            <span v-if="e.excluded" class="bbs-fu-badge">已排除</span>
            <span v-else-if="current && current.id === e.id" class="bbs-fu-badge bbs-fu-badge-on">生效中</span>
          </div>
          <div class="bbs-fu-card-acts">
            <button class="bbs-fu-act" type="button" :title="expanded[e.id] ? '收起' : '展开'" @click="expanded[e.id] = !expanded[e.id]"><Icon :name="expanded[e.id] ? 'chevron-up' : 'chevron-down'" /></button>
            <button class="bbs-fu-act" type="button" title="复制" @click="copyAnchor(e)"><Icon name="copy" /></button>
            <button class="bbs-fu-act" type="button" title="编辑" @click="openEditAnchor(e)"><Icon name="edit" /></button>
            <button class="bbs-fu-act" type="button" :title="e.excluded ? '恢复生效' : '排除(回退到上一版)'" @click="toggleExcluded(e)"><Icon :name="e.excluded ? 'eye' : 'eye-off'" /></button>
            <button class="bbs-fu-act bbs-fu-act-del" type="button" title="移入回收站" @click="delAnchor(e)"><Icon name="trash" /></button>
          </div>
        </div>
        <p v-if="e.note" class="bbs-fu-note">备注:{{ e.note }}</p>
        <pre class="bbs-fu-pre" :class="{ 'bbs-fu-pre-clamp': !expanded[e.id] }">{{ e.text }}</pre>
      </div>
    </div>

    <!-- ===================== 备份恢复 ===================== -->
    <div v-else-if="tab === 'backup'">
      <p class="bbs-fu-hint">柏宝书仍是纯前端扩展。装了「白鸟数据」服务端插件时,这里可以把整份记忆备份到服务器目录并随时恢复;没装也能用本地恢复点、回收站、导出/导入文件。</p>
      <div class="bbs-fu-status" :class="backendState.available ? 'bbs-fu-status-ok' : 'bbs-fu-status-off'">
        <span>白鸟数据后端:{{ backendState.checking ? '检测中…' : backendState.available ? `可用(v${backendState.health?.version || '?'})` : '不可用' }}</span>
        <button class="bbs-btn" type="button" @click="reprobe">重新检测</button>
      </div>
      <p v-if="!backendState.available && backendState.lastError" class="bbs-fu-note">{{ backendState.lastError }}。安装方法:把 ST-BaiNiaoData 克隆到 SillyTavern 的 plugins/ 目录,并在 config.yaml 打开 enableServerPlugins。</p>

      <Collapsible title="后端设置" :open="false">
        <label class="bbs-fu-switch"><span>允许使用白鸟后端</span><input v-model="b.enabled" type="checkbox" class="bbs-fu-check" /></label>
        <label class="bbs-fu-switch"><span>每次摘要后自动备份快照(安静 20 秒后执行)</span><input v-model="b.autoBackup" type="checkbox" class="bbs-fu-check" /></label>
        <div class="bbs-fu-grid2">
          <label class="bbs-fu-field"><span class="bbs-fu-label">命名空间</span><input v-model="b.namespace" class="bbs-input" type="text" /></label>
          <label class="bbs-fu-field"><span class="bbs-fu-label">本地恢复点上限</span><input v-model.number="b.restorePoints" class="bbs-input" type="number" min="1" max="10" /></label>
          <label class="bbs-fu-field"><span class="bbs-fu-label">回收站条数上限</span><input v-model.number="b.trashKeep" class="bbs-input" type="number" min="5" max="200" /></label>
        </div>
      </Collapsible>

      <h3 class="bbs-fu-sub">后端快照</h3>
      <div class="bbs-fu-actions">
        <button class="bbs-btn bbs-btn-primary" type="button" :disabled="!backendState.available || syncState.busy" @click="doBackup">{{ syncState.busy ? '备份中…' : '立即备份当前聊天' }}</button>
        <button class="bbs-btn" type="button" :disabled="!backendState.available" @click="doRestoreRemote()">从后端恢复当前聊天</button>
        <button class="bbs-btn" type="button" :disabled="!backendState.available || remoteLoading" @click="loadRemote">{{ remoteLoading ? '读取中…' : '刷新列表' }}</button>
      </div>
      <p v-if="syncState.lastBackupAt" class="bbs-fu-note">上次备份:{{ fmtTime(syncState.lastBackupAt) }}(revision {{ syncState.lastBackupRevision }})</p>
      <p v-if="syncState.lastError" class="bbs-fu-err">{{ syncState.lastError }}</p>
      <div v-if="backendState.available && !remote.length" class="bbs-empty">后端上还没有快照。</div>
      <div v-for="r in remote" :key="r.recordId" class="bbs-fu-row">
        <div class="bbs-fu-row-main">
          <strong>{{ r.charName || '(未知角色)' }}</strong>
          <span class="bbs-fu-badge bbs-fu-badge-on" v-if="r.isCurrent">当前聊天</span>
          <div class="bbs-fu-row-sub">{{ r.chatId }} · {{ r.floors }} 楼 · {{ r.summaries }} 个总结节点 · {{ r.anchors }} 版锚点 · rev {{ r.revision }} · {{ fmtTime(r.updatedAt) }}</div>
        </div>
        <div class="bbs-fu-card-acts">
          <button class="bbs-fu-act" type="button" title="恢复到当前聊天" @click="doRestoreRemote(r.recordId)"><Icon name="download" /></button>
          <button class="bbs-fu-act bbs-fu-act-del" type="button" title="删除" @click="delRemote(r)"><Icon name="trash" /></button>
        </div>
      </div>

      <div class="bbs-rule" />
      <h3 class="bbs-fu-sub">本地恢复点(批量补摘 / 导入 / 恢复前自动保存)</h3>
      <div class="bbs-fu-actions">
        <button class="bbs-btn bbs-btn-primary" type="button" @click="makePoint">现在保存一个恢复点</button>
        <button class="bbs-btn" type="button" @click="exportFile">导出为文件</button>
        <button class="bbs-btn" type="button" @click="openImport">从文件导入</button>
      </div>
      <div v-if="!restoreState.points.length" class="bbs-empty">暂无恢复点。</div>
      <div v-for="pt in restoreState.points" :key="pt.id" class="bbs-fu-row">
        <div class="bbs-fu-row-main">
          <strong>{{ pt.reason }}</strong>
          <div class="bbs-fu-row-sub">{{ fmtTime(pt.createdAt) }} · {{ pt.snapshot.floors }} 楼 · {{ pt.snapshot.summaries.length }} 个总结节点 · {{ pt.snapshot.leaves.length }} 条叶子 · {{ pt.snapshot.anchors.length }} 版锚点</div>
        </div>
        <div class="bbs-fu-card-acts">
          <button class="bbs-fu-act" type="button" title="回滚到此" @click="doRestorePoint(pt.id)"><Icon name="rotate" /></button>
          <button class="bbs-fu-act bbs-fu-act-del" type="button" title="删除恢复点" @click="deleteRestorePoint(pt.id)"><Icon name="trash" /></button>
        </div>
      </div>

      <div class="bbs-rule" />
      <h3 class="bbs-fu-sub">回收站({{ trashState.items.length }})</h3>
      <div class="bbs-fu-actions">
        <button class="bbs-btn" type="button" :disabled="!trashState.items.length" @click="clearAllTrash">清空</button>
        <button class="bbs-btn" type="button" :disabled="!backendState.available" @click="pullTrash">从后端镜像取回</button>
      </div>
      <div v-if="!trashState.items.length" class="bbs-empty">回收站是空的。删除摘要/总结/锚点/外部记录时会先进这里。</div>
      <div v-for="it in trashState.items" :key="it.id" class="bbs-fu-row">
        <div class="bbs-fu-row-main">
          <strong>{{ KIND_LABEL[it.kind] ?? it.kind }}</strong> <span class="bbs-fu-row-text">{{ it.title }}</span>
          <div class="bbs-fu-row-sub">{{ fmtTime(it.deletedAt) }}</div>
        </div>
        <div class="bbs-fu-card-acts">
          <button class="bbs-fu-act" type="button" title="恢复" @click="restoreTrash(it.id)"><Icon name="rotate" /></button>
          <button class="bbs-fu-act bbs-fu-act-del" type="button" title="彻底删除" @click="dropTrash(it.id)"><Icon name="close" /></button>
        </div>
      </div>

      <div class="bbs-rule" />
      <h3 class="bbs-fu-sub">诊断</h3>
      <p class="bbs-fu-hint">导出插件版本、关键设置(密钥脱敏)、后端健康、记忆统计与最近错误,不含聊天正文。反馈问题时附上即可。</p>
      <div class="bbs-fu-actions">
        <button class="bbs-btn" type="button" @click="diagCopy">复制诊断信息</button>
        <button class="bbs-btn" type="button" @click="diagDownload">下载诊断文件</button>
      </div>
    </div>

    <!-- ===================== 小手机联动 ===================== -->
    <div v-else>
      <p class="bbs-fu-hint">与「月夜来信小手机」等酒馆助手脚本互通:柏宝书把时间/地点/在场人物/好感/计划/历史摘要/锚点打包成"剧情简报"供手机读取;手机把聊天要点、约定、动态推回来,作为"外部记录"注入主模型并进入摘要。API 渠道可互相借用、互相测活。</p>
      <div class="bbs-fu-status" :class="phoneDetected ? 'bbs-fu-status-ok' : 'bbs-fu-status-off'">
        <span>小手机脚本:{{ phoneDetected ? '已检测到(tsukiyo_phone 设置存在)' : '未检测到(需安装 1.6 联动版脚本并打开过一次手机)' }}</span>
      </div>
      <label class="bbs-fu-switch"><span>启用小手机联动(关闭后 STBaiBaiBook.phone 的写入与借用渠道都会拒绝)</span><input v-model="p.enabled" type="checkbox" class="bbs-fu-check" /></label>
      <Collapsible title="联动设置" :open="false">
        <label class="bbs-fu-switch"><span>把外部记录注入主模型</span><input v-model="p.injectExternal" type="checkbox" class="bbs-fu-check" /></label>
        <label class="bbs-fu-switch"><span>外部记录作为摘要/总结材料</span><input v-model="p.includeInSummary" type="checkbox" class="bbs-fu-check" /></label>
        <div class="bbs-fu-grid2">
          <label class="bbs-fu-field"><span class="bbs-fu-label">外部记录注入预算(字符)</span><input v-model.number="p.externalMaxChars" class="bbs-input" type="number" min="200" max="20000" step="100" /></label>
          <label class="bbs-fu-field"><span class="bbs-fu-label">简报历史预算(字符)</span><input v-model.number="p.briefHistoryChars" class="bbs-input" type="number" min="200" max="20000" step="100" /></label>
        </div>
      </Collapsible>

      <h3 class="bbs-fu-sub">剧情简报预览(手机读到的内容)</h3>
      <div class="bbs-fu-actions">
        <button class="bbs-btn" type="button" @click="previewBrief">生成预览</button>
        <button v-if="briefPreview" class="bbs-btn" type="button" @click="copyText(briefPreview).then(ok => toast(ok ? '已复制' : '复制失败', 'info'))">复制</button>
      </div>
      <pre v-if="briefPreview" class="bbs-fu-pre bbs-fu-pre-scroll">{{ briefPreview }}</pre>

      <div class="bbs-rule" />
      <h3 class="bbs-fu-sub">外部记录({{ externalState.notes.length }})</h3>
      <div class="bbs-fu-actions">
        <input v-model="manualNote" class="bbs-input bbs-fu-grow" type="text" placeholder="手动补一条正文之外的事实(回车添加)" @keydown.enter.prevent="addManualNote" />
        <button class="bbs-btn" type="button" @click="addManualNote">添加</button>
        <button class="bbs-btn" type="button" :disabled="!externalState.notes.length" @click="clearNotes">清空</button>
      </div>
      <p v-if="externalState.lastPushAt" class="bbs-fu-note">最近一次推送:{{ fmtTime(externalState.lastPushAt) }}(来源 {{ externalState.lastSource }})</p>
      <div v-if="!extNotesDesc.length" class="bbs-empty">还没有外部记录。小手机 1.6 联动版会在手机聊天/约定变化后自动推送。</div>
      <div v-for="n in extNotesDesc" :key="n.source + n.id" class="bbs-fu-row">
        <div class="bbs-fu-row-main">
          <span class="bbs-fu-badge">{{ EXT_KIND[n.kind] ?? n.kind }}</span>
          <span v-if="n.pinned" class="bbs-fu-badge bbs-fu-badge-on">置顶</span>
          <strong v-if="n.title">{{ n.title }}</strong>
          <span class="bbs-fu-row-text">{{ n.text }}</span>
          <div class="bbs-fu-row-sub">{{ n.source }}{{ n.time ? ` · ${n.time}` : '' }}{{ typeof n.floor === 'number' ? ` · #${n.floor}` : '' }} · {{ fmtTime(n.ts) }}</div>
        </div>
        <div class="bbs-fu-card-acts">
          <button class="bbs-fu-act" type="button" :title="n.pinned ? '取消置顶' : '置顶'" @click="setExternalPinned(n.id, !n.pinned); refreshInjection()"><Icon name="pin" /></button>
          <button class="bbs-fu-act bbs-fu-act-del" type="button" title="移入回收站" @click="delNote(n.id)"><Icon name="trash" /></button>
        </div>
      </div>

      <div class="bbs-rule" />
      <h3 class="bbs-fu-sub">API 渠道测活(柏宝书副 API,手机可借用)</h3>
      <div class="bbs-fu-actions">
        <button class="bbs-btn" type="button" :disabled="!channels.length" @click="testAll">全部测活</button>
        <button class="bbs-btn" type="button" @click="refreshPhoneProfiles">读取小手机 API 方案</button>
      </div>
      <div v-if="phoneProfiles.length" class="bbs-fu-note">小手机里的自定义方案(可一键导入为柏宝书渠道;手机端也可反向导入柏宝书渠道):</div>
      <div v-for="pp in phoneProfiles" :key="pp.id" class="bbs-fu-row">
        <div class="bbs-fu-row-main">
          <strong>{{ pp.name }}</strong> <span class="bbs-fu-row-text">{{ pp.model || '(未设模型)' }}</span>
          <div class="bbs-fu-row-sub">{{ pp.url }} · {{ pp.hasKey ? '含密钥' : '无密钥(手机未开启密钥同步)' }}</div>
        </div>
        <div class="bbs-fu-card-acts">
          <button class="bbs-btn" type="button" @click="importProfile(pp.id)">导入为渠道</button>
        </div>
      </div>
      <div v-if="!channels.length" class="bbs-empty">还没有副 API 渠道。到「设置 → 副 API」添加。</div>
      <div v-for="c in channels" :key="c.id" class="bbs-fu-row">
        <div class="bbs-fu-row-main">
          <strong>{{ c.name }}</strong> <span class="bbs-fu-row-text">{{ c.model }} @ {{ c.host || '(未填地址)' }}</span>
          <div class="bbs-fu-row-sub">
            <span v-if="c.lastTest" :class="c.lastTest.ok ? 'bbs-fu-ok' : 'bbs-fu-bad'">{{ c.lastTest.ok ? '✓' : '✗' }} {{ fmtTime(c.lastTest.at) }} · {{ c.lastTest.message }}</span>
            <span v-else>尚未测活</span>
          </div>
        </div>
        <div class="bbs-fu-card-acts">
          <button class="bbs-btn" type="button" :disabled="testing[c.id]" @click="testOne(c.id)">{{ testing[c.id] ? '测试中…' : '测活' }}</button>
        </div>
      </div>
    </div>

    <!-- ===================== 弹窗 ===================== -->
    <ModalMask :open="!!editingAnchor" @close="editingAnchor = null">
      <div v-if="editingAnchor" class="bbs-modal bbs-fu-modal-wide" role="dialog" aria-modal="true" aria-label="编辑锚点">
        <header class="bbs-modal-head"><span class="bbs-modal-title">编辑锚点日记</span><button class="bbs-fu-act" type="button" title="关闭" @click="editingAnchor = null"><Icon name="close" /></button></header>
        <label class="bbs-modal-field"><span class="bbs-modal-label">备注(仅自己看)</span><input v-model="editingAnchor.note" class="bbs-input" type="text" /></label>
        <label class="bbs-modal-field"><span class="bbs-modal-label">内容</span><textarea v-model="editingAnchor.text" class="bbs-input bbs-fu-ta" rows="14" /></label>
        <footer class="bbs-modal-foot"><button class="bbs-btn" type="button" @click="editingAnchor = null">取消</button><button class="bbs-btn bbs-btn-primary" type="button" @click="saveEditAnchor">保存</button></footer>
      </div>
    </ModalMask>

    <ModalMask :open="pasteOpen" @close="pasteOpen = false">
      <div v-if="pasteOpen" class="bbs-modal bbs-fu-modal-wide" role="dialog" aria-modal="true" aria-label="粘贴锚点">
        <header class="bbs-modal-head"><span class="bbs-modal-title">手动粘贴锚点日记</span><button class="bbs-fu-act" type="button" title="关闭" @click="pasteOpen = false"><Icon name="close" /></button></header>
        <p class="bbs-fu-hint">可直接粘贴含 &lt;anchor&gt; 标签的整段,也可粘贴纯文本;旧版 AnchorNote 的锚点可原样迁移。</p>
        <label class="bbs-modal-field"><span class="bbs-modal-label">覆盖到楼层(可留空)</span><input v-model="pasteFloor" class="bbs-input" type="number" min="0" /></label>
        <label class="bbs-modal-field"><span class="bbs-modal-label">内容</span><textarea v-model="pasteText" class="bbs-input bbs-fu-ta" rows="14" /></label>
        <footer class="bbs-modal-foot"><button class="bbs-btn" type="button" @click="pasteOpen = false">取消</button><button class="bbs-btn bbs-btn-primary" type="button" @click="savePaste">保存为新版本</button></footer>
      </div>
    </ModalMask>

    <ModalMask :open="instructionOpen" @close="instructionOpen = false">
      <div v-if="instructionOpen" class="bbs-modal bbs-fu-modal-wide" role="dialog" aria-modal="true" aria-label="锚点指令">
        <header class="bbs-modal-head"><span class="bbs-modal-title">锚点指令(注入主模型)</span><button class="bbs-fu-act" type="button" title="关闭" @click="instructionOpen = false"><Icon name="close" /></button></header>
        <p class="bbs-fu-hint">当前生效:{{ apiSettings.anchor.instruction ? '自定义' : '内置' }}。保存为与内置完全相同的内容即视为恢复内置。</p>
        <label class="bbs-modal-field"><textarea v-model="instructionDraft" class="bbs-input bbs-fu-ta" rows="16" /></label>
        <footer class="bbs-modal-foot"><button class="bbs-btn" type="button" @click="resetInstruction">恢复内置</button><button class="bbs-btn" type="button" @click="instructionOpen = false">取消</button><button class="bbs-btn bbs-btn-primary" type="button" @click="saveInstruction">保存</button></footer>
      </div>
    </ModalMask>

    <ModalMask :open="importOpen" @close="importOpen = false">
      <div v-if="importOpen" class="bbs-modal bbs-fu-modal-wide" role="dialog" aria-modal="true" aria-label="导入快照">
        <header class="bbs-modal-head"><span class="bbs-modal-title">从文件导入记忆快照</span><button class="bbs-fu-act" type="button" title="关闭" @click="importOpen = false"><Icon name="close" /></button></header>
        <p class="bbs-fu-hint">粘贴「导出为文件」得到的 JSON 内容。</p>
        <label class="bbs-modal-field"><textarea v-model="importText" class="bbs-input bbs-fu-ta" rows="12" placeholder='{"snapshotVersion":1,...}' /></label>
        <footer class="bbs-modal-foot"><button class="bbs-btn" type="button" @click="importOpen = false">取消</button><button class="bbs-btn bbs-btn-primary" type="button" @click="doImport">导入</button></footer>
      </div>
    </ModalMask>

    <ModalMask :open="!!confirm" top-layer @close="confirm = null">
      <div v-if="confirm" class="bbs-modal" role="alertdialog" aria-modal="true" :aria-label="confirm.title">
        <header class="bbs-modal-head"><span class="bbs-modal-title">{{ confirm.title }}</span></header>
        <p class="bbs-fu-hint">{{ confirm.body }}</p>
        <footer class="bbs-modal-foot"><button class="bbs-btn" type="button" @click="confirm = null">取消</button><button class="bbs-btn bbs-btn-primary" type="button" @click="runConfirm">继续</button></footer>
      </div>
    </ModalMask>
  </section>
</template>

<style scoped>
.bbs-fu-tabs {
  display: flex;
  gap: 6px;
  margin: 0 0 14px;
  padding: 4px;
  border-radius: var(--bbs-radius-pill, 999px);
  background: var(--bbs-surface-2);
}
.bbs-fu-tab {
  flex: 1;
  padding: 7px 10px;
  border: 0;
  border-radius: var(--bbs-radius-pill, 999px);
  background: transparent;
  color: var(--bbs-ink-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.bbs-fu-tab-on {
  background: var(--bbs-surface);
  color: var(--bbs-ink);
  font-weight: 600;
  box-shadow: 0 1px 3px oklch(0 0 0 / 0.12);
}
.bbs-fu-hint {
  margin: 0 0 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--bbs-ink-muted);
}
.bbs-fu-note {
  margin: 4px 0 10px;
  font-size: 12px;
  color: var(--bbs-ink-muted);
}
.bbs-fu-err {
  margin: 4px 0 10px;
  font-size: 12px;
  color: var(--bbs-danger, #c0392b);
}
.bbs-fu-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  font-size: 13.5px;
  color: var(--bbs-ink);
}
.bbs-fu-check {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  accent-color: var(--bbs-accent);
  cursor: pointer;
}
.bbs-fu-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 8px 0 12px;
}
.bbs-fu-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--bbs-ink);
}
.bbs-fu-grid2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0 14px;
}
.bbs-fu-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0 12px;
}
.bbs-fu-grow {
  flex: 1 1 200px;
}
.bbs-fu-sub {
  margin: 16px 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--bbs-ink);
}
.bbs-fu-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  margin: 0 0 10px;
  border-radius: var(--bbs-radius, 12px);
  font-size: 13px;
  background: var(--bbs-surface-2);
  color: var(--bbs-ink);
}
.bbs-fu-status-ok {
  border-left: 3px solid var(--bbs-accent);
}
.bbs-fu-status-off {
  border-left: 3px solid var(--bbs-ink-muted);
}
.bbs-fu-card {
  padding: 10px 12px;
  margin: 0 0 10px;
  border-radius: var(--bbs-radius, 12px);
  background: var(--bbs-surface-2);
  border: 1px solid transparent;
}
.bbs-fu-card-on {
  border-color: var(--bbs-accent);
}
.bbs-fu-card-off {
  opacity: 0.6;
}
.bbs-fu-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.bbs-fu-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 12px;
  color: var(--bbs-ink-muted);
}
.bbs-fu-card-meta strong {
  color: var(--bbs-ink);
}
.bbs-fu-card-acts {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
}
.bbs-fu-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--bbs-ink-muted);
  cursor: pointer;
}
.bbs-fu-act:hover {
  background: var(--bbs-surface);
  color: var(--bbs-ink);
}
.bbs-fu-act-del:hover {
  color: var(--bbs-danger, #c0392b);
}
.bbs-fu-act :deep(svg) {
  width: 16px;
  height: 16px;
}
.bbs-fu-badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--bbs-surface);
  color: var(--bbs-ink-muted);
}
.bbs-fu-badge-on {
  background: var(--bbs-accent);
  color: var(--bbs-on-accent, #fff);
}
.bbs-fu-pre {
  margin: 8px 0 0;
  padding: 0;
  font: inherit;
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--bbs-ink);
}
.bbs-fu-pre-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.bbs-fu-pre-scroll {
  max-height: 320px;
  overflow: auto;
  padding: 10px;
  border-radius: var(--bbs-radius, 12px);
  background: var(--bbs-surface-2);
}
.bbs-fu-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  margin: 0 0 6px;
  border-radius: var(--bbs-radius, 12px);
  background: var(--bbs-surface-2);
}
.bbs-fu-row-main {
  min-width: 0;
  font-size: 13px;
  color: var(--bbs-ink);
}
.bbs-fu-row-text {
  color: var(--bbs-ink);
  word-break: break-word;
}
.bbs-fu-row-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--bbs-ink-muted);
  word-break: break-word;
}
.bbs-fu-ok {
  color: var(--bbs-accent);
}
.bbs-fu-bad {
  color: var(--bbs-danger, #c0392b);
}
.bbs-fu-ta {
  width: 100%;
  min-height: 160px;
  resize: vertical;
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
}
.bbs-fu-modal-wide {
  width: min(680px, 94vw);
}
</style>
