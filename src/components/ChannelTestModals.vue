<script setup lang="ts">
/**
 * API 渠道自定义测试弹窗(单独测试 + 批量测试)。
 *
 * 对齐「月夜来信 · 小手机」的自定义测试体验:
 *  - 单独自定义测试:配置渠道专属测试用语、可选附带破限提示词,测试后直接展示耗时与模型返回的完整回复;
 *  - 批量自定义测试:勾选要测试的渠道、填写统一测试语句、可选「优先使用各渠道自己的测试用语」,
 *    并发请求全部所选渠道,汇总展示「X/Y 可用」及每个渠道返回的回复。
 */
import { computed, ref } from 'vue';
import Icon from './Icon.vue';
import ModalMask from './ModalMask.vue';
import {
  apiSettings,
  DEFAULT_TEST_PROMPT,
  type ApiChannel,
  type ChannelLastTest,
} from '@/api/settings';
import {
  batchTestChannels,
  testChannel,
  type BatchChannelTestItem,
  type ChannelTestResult,
} from '@/api/client';

/* ================= 单独自定义测试 ================= */
const singleOpen = ref(false);
const singleTopLayer = ref(false);
const singleChannel = ref<ApiChannel | null>(null);
const singlePhrase = ref('');
const singleWithJailbreak = ref(false);
const singleRunning = ref(false);
const singleResult = ref<(ChannelLastTest & { isFresh?: boolean }) | null>(null);
let singleOnTested: ((res: ChannelTestResult) => void) | undefined;

function fmtSec(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function openSingle(
  ch: ApiChannel,
  opts: { topLayer?: boolean; onTested?: (res: ChannelTestResult) => void } = {},
) {
  singleChannel.value = ch;
  singleTopLayer.value = !!opts.topLayer;
  singleOnTested = opts.onTested;
  singlePhrase.value = ch.testPrompt || apiSettings.ui.testPrompt || DEFAULT_TEST_PROMPT;
  singleWithJailbreak.value = !!apiSettings.ui.testWithJailbreak;
  singleResult.value = ch.lastTest ? { ...ch.lastTest, isFresh: false } : null;
  singleOpen.value = true;
}

function closeSingle() {
  if (singleRunning.value) return;
  singleOpen.value = false;
  singleChannel.value = null;
  singleOnTested = undefined;
}

async function runSingleTest() {
  const ch = singleChannel.value;
  if (!ch || singleRunning.value) return;
  const phrase = singlePhrase.value.trim() || '请回复 OK。';
  ch.testPrompt = singlePhrase.value.trim();
  // 若当前是在「编辑渠道」草稿上发起测试,同步回已保存的同名 id 渠道
  const saved = apiSettings.channels.find(x => x.id === ch.id);
  if (saved && saved !== ch) {
    saved.testPrompt = ch.testPrompt;
  }
  if (singleWithJailbreak.value !== !!apiSettings.ui.testWithJailbreak) {
    apiSettings.ui.testWithJailbreak = singleWithJailbreak.value;
  }

  singleRunning.value = true;
  try {
    const res = await testChannel(ch, {
      phrase,
      withJailbreak: singleWithJailbreak.value,
    });
    if (saved && saved !== ch) {
      saved.lastTest = ch.lastTest ? { ...ch.lastTest } : undefined;
      if (ch.url) saved.url = ch.url;
    }
    singleResult.value = {
      at: ch.lastTest?.at ?? Date.now(),
      ok: res.ok,
      ms: res.ms,
      reply: res.reply,
      prompt: res.prompt,
      withJailbreak: res.withJailbreak,
      message: res.message,
      isFresh: true,
    };
    singleOnTested?.(res);
  } finally {
    singleRunning.value = false;
  }
}

/* ================= 批量自定义测试 ================= */
const batchOpen = ref(false);
const batchTopLayer = ref(false);
const batchStep = ref<'config' | 'result'>('config');
const batchSelectedIds = ref<string[]>([]);
const batchPhrase = ref('');
const batchPerChannel = ref(true);
const batchWithJailbreak = ref(false);
const batchRunning = ref(false);
const batchResults = ref<BatchChannelTestItem[]>([]);

const batchOkCount = computed(() => batchResults.value.filter(r => r.ok).length);

function openBatch(opts: { topLayer?: boolean } = {}) {
  batchTopLayer.value = !!opts.topLayer;
  batchSelectedIds.value = apiSettings.channels.map(c => c.id);
  batchPhrase.value = apiSettings.ui.testPrompt || DEFAULT_TEST_PROMPT;
  batchPerChannel.value = true;
  batchWithJailbreak.value = !!apiSettings.ui.testWithJailbreak;
  batchStep.value = 'config';
  batchOpen.value = true;
}

function closeBatch() {
  if (batchRunning.value) return;
  batchOpen.value = false;
}

function selectAllBatch() {
  batchSelectedIds.value = apiSettings.channels.map(c => c.id);
}

function selectNoneBatch() {
  batchSelectedIds.value = [];
}

async function runBatchTest() {
  if (batchRunning.value || !batchSelectedIds.value.length) return;
  const phrase = batchPhrase.value.trim() || '请回复 OK。';
  apiSettings.ui.testPrompt = phrase.slice(0, 2000);
  apiSettings.ui.testWithJailbreak = batchWithJailbreak.value;
  const targets = apiSettings.channels.filter(c => batchSelectedIds.value.includes(c.id));
  if (!targets.length) return;

  batchRunning.value = true;
  try {
    batchResults.value = await batchTestChannels(targets, {
      phrase,
      perChannel: batchPerChannel.value,
      withJailbreak: batchWithJailbreak.value,
    });
    batchStep.value = 'result';
  } finally {
    batchRunning.value = false;
  }
}

defineExpose({
  openSingle,
  openBatch,
  singleRunning,
  batchRunning,
});
</script>

<template>
  <!-- ===== 单独自定义测试弹窗 ===== -->
  <ModalMask :open="singleOpen" :top-layer="singleTopLayer" @close="closeSingle">
    <div
      v-if="singleChannel"
      class="bbs-modal bbs-ct-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="`自定义测试 · ${singleChannel.name || '未命名渠道'}`"
    >
      <header class="bbs-modal-head">
        <span class="bbs-modal-title">自定义测试 · {{ singleChannel.name || '未命名渠道' }}</span>
        <button class="bbs-icon-mini" type="button" title="关闭" :disabled="singleRunning" @click="closeSingle">
          <Icon name="close" />
        </button>
      </header>

      <p class="bbs-ct-hint">
        只用此渠道配置的模型发一次短请求（可能计费）；不发送人物资料或聊天记录。写成「只回答你的模型名」可顺带核对中转站有没有偷换模型。
      </p>

      <div class="bbs-ct-info-card">
        <strong>{{ singleChannel.model || '未设模型' }}</strong>
        <span v-if="singleChannel.url" class="bbs-ct-url">{{ singleChannel.url }}</span>
      </div>

      <label class="bbs-modal-field">
        <span class="bbs-modal-label">此渠道专属的测试用语（保存在渠道里）</span>
        <textarea
          v-model="singlePhrase"
          class="bbs-input bbs-ct-textarea"
          rows="3"
          maxlength="2000"
          placeholder="请回复 OK。"
          :disabled="singleRunning"
        />
      </label>

      <label class="bbs-ct-check-line">
        <input v-model="singleWithJailbreak" type="checkbox" class="bbs-checkbox" :disabled="singleRunning" />
        <span>同时附带破限提示词（检查破限是否生效）</span>
      </label>

      <!-- 测试结果卡片:显示状态、耗时与返回的完整回复 -->
      <div
        v-if="singleResult"
        class="bbs-ct-result-card"
        :class="singleResult.ok ? 'is-ok' : 'is-bad'"
      >
        <div class="bbs-ct-result-head">
          <span class="bbs-ct-result-title">
            {{ singleResult.isFresh ? '测试结果' : '上次测试结果' }} · {{ singleChannel.name || '未命名渠道' }}
          </span>
          <span class="bbs-ct-badge" :class="singleResult.ok ? 'is-ok' : 'is-bad'">
            {{ singleResult.ok ? `✓ 可用${singleResult.ms ? ` · ${fmtSec(singleResult.ms)}` : ''}` : `✗ 失败${singleResult.ms ? ` · ${fmtSec(singleResult.ms)}` : ''}` }}
          </span>
        </div>
        <div class="bbs-ct-result-meta">
          <span>{{ singleChannel.model || '未设模型' }}</span>
          <span v-if="singleResult.withJailbreak">· 已附带破限提示词</span>
          <span v-if="singleResult.at">· {{ fmtTime(singleResult.at) }}</span>
        </div>
        <div v-if="singleResult.prompt" class="bbs-ct-result-prompt">
          发送：{{ singleResult.prompt }}
        </div>
        <div class="bbs-ct-reply-wrap">
          <div class="bbs-ct-reply-label">{{ singleResult.ok ? '返回回复：' : '失败原因：' }}</div>
          <pre class="bbs-ct-reply">{{ singleResult.reply || singleResult.message || '(无返回内容)' }}</pre>
        </div>
      </div>

      <footer class="bbs-modal-foot">
        <button class="bbs-btn" type="button" :disabled="singleRunning" @click="closeSingle">关闭</button>
        <button
          class="bbs-btn bbs-btn-primary"
          type="button"
          :disabled="singleRunning"
          @click="runSingleTest"
        >
          <Icon name="plug" /> {{ singleRunning ? '正在测试…' : singleResult?.isFresh ? '重新测试' : '开始测试' }}
        </button>
      </footer>
    </div>
  </ModalMask>

  <!-- ===== 批量自定义测试弹窗 ===== -->
  <ModalMask :open="batchOpen" :top-layer="batchTopLayer" @close="closeBatch">
    <div
      v-if="batchOpen"
      class="bbs-modal bbs-ct-modal bbs-ct-modal-wide"
      role="dialog"
      aria-modal="true"
      :aria-label="batchStep === 'result' ? `测试结果 · ${batchOkCount}/${batchResults.length} 可用` : '批量自定义测试'"
    >
      <header class="bbs-modal-head">
        <span class="bbs-modal-title">
          {{ batchStep === 'result' ? `测试结果 · ${batchOkCount}/${batchResults.length} 可用` : '批量自定义测试' }}
        </span>
        <button class="bbs-icon-mini" type="button" title="关闭" :disabled="batchRunning" @click="closeBatch">
          <Icon name="close" />
        </button>
      </header>

      <!-- 步骤 1:配置要测试的渠道与测试语句 -->
      <template v-if="batchStep === 'config'">
        <p class="bbs-ct-hint">
          每个渠道只用它自己配置的模型发一次请求（可能计费）。不附带人物资料或聊天记录。
        </p>

        <div class="bbs-ct-pick-bar">
          <span class="bbs-modal-label">选择渠道（已选 {{ batchSelectedIds.length }}/{{ apiSettings.channels.length }}）</span>
          <span class="bbs-ct-pick-acts">
            <button class="bbs-btn bbs-ct-btn-xs" type="button" :disabled="batchRunning" @click="selectAllBatch">全选</button>
            <button class="bbs-btn bbs-ct-btn-xs" type="button" :disabled="batchRunning" @click="selectNoneBatch">全不选</button>
          </span>
        </div>

        <div class="bbs-ct-channel-box">
          <label
            v-for="ch in apiSettings.channels"
            :key="ch.id"
            class="bbs-ct-channel-row"
          >
            <input
              v-model="batchSelectedIds"
              type="checkbox"
              :value="ch.id"
              class="bbs-checkbox"
              :disabled="batchRunning"
            />
            <div class="bbs-ct-channel-main">
              <div class="bbs-ct-channel-line">
                <strong>{{ ch.name || '未命名渠道' }}</strong>
                <span class="bbs-ct-channel-model">{{ ch.model || '未设模型' }}</span>
                <span
                  v-if="ch.lastTest"
                  class="bbs-ct-mini-tag"
                  :class="ch.lastTest.ok ? 'is-ok' : 'is-bad'"
                >
                  {{ ch.lastTest.ok ? `✓${ch.lastTest.ms ? ` ${fmtSec(ch.lastTest.ms)}` : ''}` : '✗' }}
                </span>
              </div>
              <div v-if="ch.testPrompt" class="bbs-ct-channel-prompt">
                专属用语：{{ ch.testPrompt }}
              </div>
            </div>
          </label>
        </div>

        <label class="bbs-modal-field">
          <span class="bbs-modal-label">统一测试语句</span>
          <textarea
            v-model="batchPhrase"
            class="bbs-input bbs-ct-textarea"
            rows="3"
            maxlength="2000"
            placeholder="请回复 OK。"
            :disabled="batchRunning"
          />
        </label>

        <label class="bbs-ct-check-line">
          <input v-model="batchPerChannel" type="checkbox" class="bbs-checkbox" :disabled="batchRunning" />
          <span>优先使用各渠道自己的测试用语</span>
        </label>

        <label class="bbs-ct-check-line">
          <input v-model="batchWithJailbreak" type="checkbox" class="bbs-checkbox" :disabled="batchRunning" />
          <span>同时附带破限提示词（检查破限是否生效）</span>
        </label>

        <footer class="bbs-modal-foot">
          <button
            v-if="batchResults.length"
            class="bbs-btn"
            type="button"
            :disabled="batchRunning"
            @click="batchStep = 'result'"
          >
            上次结果 ({{ batchOkCount }}/{{ batchResults.length }})
          </button>
          <span class="bbs-ct-spacer" />
          <button class="bbs-btn" type="button" :disabled="batchRunning" @click="closeBatch">取消</button>
          <button
            class="bbs-btn bbs-btn-primary"
            type="button"
            :disabled="!batchSelectedIds.length || batchRunning"
            @click="runBatchTest"
          >
            <Icon name="plug" />
            {{ batchRunning ? `正在测试 ${batchSelectedIds.length} 个渠道…` : `开始测试 (${batchSelectedIds.length})` }}
          </button>
        </footer>
      </template>

      <!-- 步骤 2:展示所有渠道的测试结果与返回回复 -->
      <template v-else>
        <div class="bbs-ct-batch-results">
          <div
            v-for="item in batchResults"
            :key="item.channelId"
            class="bbs-ct-result-card"
            :class="item.ok ? 'is-ok' : 'is-bad'"
          >
            <div class="bbs-ct-result-head">
              <span class="bbs-ct-result-title">{{ item.channelName }}</span>
              <span class="bbs-ct-badge" :class="item.ok ? 'is-ok' : 'is-bad'">
                {{ item.ok ? `✓ ${fmtSec(item.ms)}` : `✗ 失败 (${fmtSec(item.ms)})` }}
              </span>
            </div>
            <div class="bbs-ct-result-meta">
              <span>{{ item.model }}</span>
              <span v-if="item.url">· {{ item.url }}</span>
              <span v-if="item.withJailbreak">· 已附带破限提示词</span>
            </div>
            <div class="bbs-ct-result-prompt">发送：{{ item.prompt }}</div>
            <div class="bbs-ct-reply-wrap">
              <div class="bbs-ct-reply-label">{{ item.ok ? '返回回复：' : '失败原因：' }}</div>
              <pre class="bbs-ct-reply">{{ item.reply || item.message || '(无返回内容)' }}</pre>
            </div>
          </div>
        </div>

        <footer class="bbs-modal-foot">
          <button class="bbs-btn" type="button" :disabled="batchRunning" @click="batchStep = 'config'">
            修改测试设置
          </button>
          <span class="bbs-ct-spacer" />
          <button class="bbs-btn" type="button" :disabled="batchRunning" @click="runBatchTest">
            <Icon name="refresh" /> {{ batchRunning ? '正在重测…' : '重新测试' }}
          </button>
          <button class="bbs-btn bbs-btn-primary" type="button" :disabled="batchRunning" @click="closeBatch">
            关闭
          </button>
        </footer>
      </template>
    </div>
  </ModalMask>
</template>

<style scoped>
.bbs-ct-modal {
  max-width: 540px;
}
.bbs-ct-modal-wide {
  max-width: 600px;
}
.bbs-ct-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--bbs-ink-muted);
}
.bbs-ct-info-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--bbs-line);
  border-radius: var(--bbs-radius-sm);
  background: var(--bbs-surface-2);
  font-size: 13px;
}
.bbs-ct-url {
  font-size: 12px;
  color: var(--bbs-ink-muted);
  word-break: break-all;
}
.bbs-ct-textarea {
  resize: vertical;
  min-height: 68px;
  line-height: 1.5;
}
.bbs-ct-check-line {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--bbs-ink-soft);
  cursor: pointer;
  user-select: none;
}
.bbs-ct-pick-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.bbs-ct-pick-acts {
  display: inline-flex;
  gap: 6px;
}
.bbs-ct-btn-xs {
  padding: 4px 10px;
  font-size: 12px;
}
.bbs-ct-channel-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--bbs-line);
  border-radius: var(--bbs-radius);
  background: var(--bbs-surface-2);
}
.bbs-ct-channel-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--bbs-line);
  border-radius: var(--bbs-radius-sm);
  background: var(--bbs-surface);
  cursor: pointer;
}
.bbs-ct-channel-row:hover {
  border-color: var(--bbs-accent);
}
.bbs-ct-channel-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bbs-ct-channel-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}
.bbs-ct-channel-model {
  font-size: 12px;
  color: var(--bbs-ink-muted);
}
.bbs-ct-channel-prompt {
  font-size: 12px;
  color: var(--bbs-ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bbs-ct-mini-tag {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--bbs-radius-sm);
}
.bbs-ct-mini-tag.is-ok {
  color: var(--bbs-accent);
  background: var(--bbs-accent-soft);
}
.bbs-ct-mini-tag.is-bad {
  color: var(--bbs-danger, #c0392b);
  background: var(--bbs-danger-soft);
}
.bbs-ct-batch-results {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 60vh;
  overflow-y: auto;
}
.bbs-ct-result-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--bbs-line);
  border-radius: var(--bbs-radius);
  background: var(--bbs-surface);
}
.bbs-ct-result-card.is-ok {
  border-left: 3px solid var(--bbs-accent);
}
.bbs-ct-result-card.is-bad {
  border-left: 3px solid var(--bbs-danger, #c0392b);
}
.bbs-ct-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.bbs-ct-result-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--bbs-ink);
}
.bbs-ct-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--bbs-radius-sm);
}
.bbs-ct-badge.is-ok {
  color: var(--bbs-accent);
  background: var(--bbs-accent-soft);
}
.bbs-ct-badge.is-bad {
  color: var(--bbs-danger, #c0392b);
  background: var(--bbs-danger-soft);
}
.bbs-ct-result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--bbs-ink-muted);
}
.bbs-ct-result-prompt {
  font-size: 12px;
  color: var(--bbs-ink-soft);
  word-break: break-word;
}
.bbs-ct-reply-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
}
.bbs-ct-reply-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--bbs-ink-soft);
}
.bbs-ct-reply {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--bbs-line);
  border-radius: var(--bbs-radius-sm);
  background: var(--bbs-surface-2);
  color: var(--bbs-ink);
  font-family: var(--bbs-font-sans);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
  user-select: text;
}
.bbs-ct-spacer {
  flex: 1 1 auto;
}
</style>
