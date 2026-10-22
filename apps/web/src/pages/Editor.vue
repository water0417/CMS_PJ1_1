<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, labels, typeMarks, uid } from '../api';
import QuestionEditor from '../components/QuestionEditor.vue';
import { previewRouting, modeLabel, type Routing, type UpgradePreview } from '../routing';
import type { Definition, QuestionType } from '../../../api/src/domain';
const route = useRoute(),
  router = useRouter();
const survey = ref<any>(null),
  definition = ref<Definition | null>(null),
  selected = ref(0),
  busy = ref(false),
  loadError = ref(''),
  deadline = ref('');
const locked = computed(() => survey.value?.status !== 'draft');
const serverRouting = ref<Routing | null>(null);
const savedDefinition = ref('');
const dirty = computed(() => JSON.stringify(definition.value) !== savedDefinition.value);
const routing = computed(() =>
  definition.value
    ? !dirty.value && serverRouting.value
      ? serverRouting.value
      : previewRouting(definition.value)
    : null,
);
const routingById = computed(() => new Map(routing.value?.questions.map((q) => [q.questionId, q])));
const upgradePreview = ref<UpgradePreview | null>(null);
const upgradeOpen = ref(false),
  upgradeAcknowledged = ref(false),
  upgradeError = ref('');
function questionName(id: string | null) {
  const index = definition.value?.questions.findIndex((q) => q.id === id) ?? -1;
  return index < 0
    ? '缺少入口'
    : `第 ${String(index + 1).padStart(2, '0')} 题 · ${definition.value!.questions[index].title || '未命名题目'}`;
}
function planQuestionName(plan: Routing, id: string | null) {
  const index = plan.questions.findIndex((q) => q.questionId === id);
  return index < 0
    ? '缺少入口'
    : `第 ${String(index + 1).padStart(2, '0')} 题 · ${plan.questions[index].title || '未命名题目'}`;
}
async function refreshRouting() {
  serverRouting.value = await api('/surveys/' + route.params.id + '/routing');
}
async function previewUpgrade() {
  if (busy.value || locked.value) return;
  if (dirty.value) {
    ElMessage.warning('请先保存草稿，再预览升级；预览仅针对已保存的规则。');
    return;
  }
  busy.value = true;
  upgradeAcknowledged.value = false;
  upgradePreview.value = null;
  upgradeError.value = '';
  try {
    upgradePreview.value = await api('/surveys/' + route.params.id + '/routing/upgrade-preview');
    upgradeOpen.value = true;
  } catch (e: any) {
    ElMessage.error(e.message);
  } finally {
    busy.value = false;
  }
}
async function confirmUpgrade() {
  const preview = upgradePreview.value;
  if (busy.value || !preview?.canUpgrade || !upgradeAcknowledged.value || dirty.value) return;
  busy.value = true;
  upgradeError.value = '';
  try {
    const result = await api('/surveys/' + route.params.id + '/routing/upgrade', 'POST', {
      revision: preview.revision,
      targetMode: 'exclusive-branches-v1',
      acknowledgedBranchQuestionIds: [...new Set(preview.after.branchQuestionIds)],
    });
    survey.value = result.survey;
    definition.value = structuredClone(result.survey.draft);
    serverRouting.value = result.routing;
    savedDefinition.value = JSON.stringify(definition.value);
    upgradeOpen.value = false;
    ElMessage.success('跳转机制已升级，请检查分支与入口后再发布');
  } catch (e: any) {
    upgradeError.value = e.message;
    upgradeAcknowledged.value = false;
    if (e.code === 'CONFLICT' || e.code === 'ROUTING_ACK_REQUIRED') {
      upgradePreview.value = null;
      try {
        upgradePreview.value = await api(
          '/surveys/' + route.params.id + '/routing/upgrade-preview',
        );
        ElMessage.warning(
          e.code === 'CONFLICT'
            ? '数据已变化，已重新获取预览，请重新审阅并确认。'
            : '分支确认集合已变化，请重新审阅完整分支列表。',
        );
      } catch (refreshError: any) {
        ElMessage.error(refreshError.message);
      }
    } else ElMessage.error(e.message);
  } finally {
    busy.value = false;
  }
}
const settingsOpen = ref(false),
  canvas = ref<HTMLElement | null>(null),
  outline = ref<HTMLElement | null>(null);
const questionElements = new Map<string, HTMLElement>();
let scrollFrame = 0;
watch(selected, async () => {
  await nextTick();
  const list = outline.value;
  const item = list?.querySelector<HTMLElement>('[aria-current]');
  if (!list || !item) return;
  const root = list.getBoundingClientRect(),
    rect = item.getBoundingClientRect();
  if (rect.top < root.top) list.scrollTop += rect.top - root.top;
  else if (rect.bottom > root.bottom) list.scrollTop += rect.bottom - root.bottom;
  if (rect.left < root.left) list.scrollLeft += rect.left - root.left;
  else if (rect.right > root.right) list.scrollLeft += rect.right - root.right;
});
onMounted(load);
onBeforeUnmount(() => {
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
});
function setQuestionElement(id: string, element: unknown) {
  if (element instanceof HTMLElement) questionElements.set(id, element);
  else questionElements.delete(id);
}
async function load() {
  loadError.value = '';
  try {
    survey.value = await api('/surveys/' + route.params.id);
    definition.value = JSON.parse(JSON.stringify(survey.value.draft));
    savedDefinition.value = JSON.stringify(definition.value);
    await refreshRouting();
    deadline.value = survey.value.deadlineAt ?? '';
    settingsOpen.value = !definition.value?.questions.length;
    selected.value = 0;
    await nextTick();
    if (canvas.value) canvas.value.scrollTop = 0;
  } catch (e: any) {
    loadError.value = e.message;
    ElMessage.error(e.message);
  }
}
async function goToQuestion(index: number) {
  const question = definition.value?.questions[index];
  if (!question) return;
  selected.value = index;
  settingsOpen.value = false;
  await nextTick();
  const node = questionElements.get(question.id),
    root = canvas.value;
  if (node && root)
    root.scrollTo({
      top:
        root.scrollTop + node.getBoundingClientRect().top - root.getBoundingClientRect().top - 10,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
}
function onCanvasScroll() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const root = canvas.value,
      questions = definition.value?.questions;
    if (!root || !questions?.length) return;
    if (root.scrollHeight - root.scrollTop - root.clientHeight <= 2) {
      selected.value = questions.length - 1;
      return;
    }
    const target = root.getBoundingClientRect().top + Math.min(70, root.clientHeight * 0.16);
    let current = 0;
    for (let i = 0; i < questions.length; i++) {
      const node = questionElements.get(questions[i].id);
      if (node && node.getBoundingClientRect().top <= target) current = i;
    }
    selected.value = current;
  });
}
function add(type: string) {
  if (!definition.value || locked.value) return;
  if (definition.value.questions.length >= 100) {
    ElMessage.warning('每份问卷最多 100 道题');
    return;
  }
  const choices = ['single_choice', 'multiple_choice', 'matrix', 'ranking'].includes(type);
  definition.value.questions.push({
    id: uid(),
    type: type as QuestionType,
    title: '',
    description: '',
    required: true,
    options: choices ? Array.from({ length: 3 }, () => ({ id: uid(), label: '' })) : [],
    rows: type === 'matrix' ? Array.from({ length: 2 }, () => ({ id: uid(), label: '' })) : [],
    validation:
      type === 'slider' ? { min: 0, max: 10, step: 1 } : type === 'time' ? { mode: 'date' } : {},
    jumpRules: [],
  });
  goToQuestion(definition.value.questions.length - 1);
}
async function remove(index: number) {
  const question = definition.value?.questions[index];
  if (!definition.value || !question || locked.value) return;
  if (
    definition.value.questions.some(
      (x) => x.id !== question.id && x.jumpRules.some((r) => r.target === question.id),
    )
  ) {
    ElMessage.warning('有规则引用此题，请先修改相关跳转目标');
    return;
  }
  try {
    await ElMessageBox.confirm('删除后无法撤销，确定删除这道题？', '删除题目', { type: 'warning' });
    const current = definition.value.questions.findIndex((q) => q.id === question.id);
    if (current < 0) return;
    definition.value.questions.splice(current, 1);
    selected.value = Math.max(0, Math.min(current, definition.value.questions.length - 1));
    if (definition.value.questions.length) goToQuestion(selected.value);
    else settingsOpen.value = true;
  } catch {}
}
function move(index: number, delta: number) {
  const questions = definition.value?.questions;
  if (!questions || locked.value) return;
  const target = index + delta;
  if (target < 0 || target >= questions.length) return;
  [questions[index], questions[target]] = [questions[target], questions[index]];
  goToQuestion(target);
}
async function save() {
  if (!definition.value) return false;
  busy.value = true;
  try {
    survey.value = await api('/surveys/' + route.params.id + '/draft', 'PUT', {
      definition: definition.value,
      revision: survey.value.revision,
    });
    definition.value = JSON.parse(JSON.stringify(survey.value.draft));
    savedDefinition.value = JSON.stringify(definition.value);
    await refreshRouting();
    ElMessage.success('草稿已保存');
    return true;
  } catch (e: any) {
    ElMessage.error(e.message);
    return false;
  } finally {
    busy.value = false;
  }
}
async function publish() {
  if (!(await save())) return;
  try {
    await ElMessageBox.confirm(
      '发布后题目、逻辑和填写设置将锁定。' +
        (routing.value?.routingMode === 'exclusive-branches-v1'
          ? '分支题仅通过条件跳转进入，连续分支必须明确配置跳转。'
          : '当前保留旧版顺序跳转机制。') +
        '请确认已检查所有题目。',
      '发布问卷',
      { confirmButtonText: '确认发布', cancelButtonText: '再检查一下', type: 'warning' },
    );
    busy.value = true;
    survey.value = await api('/surveys/' + route.params.id + '/publish', 'POST', {
      revision: survey.value.revision,
      deadlineAt: deadline.value || null,
    });
    await refreshRouting();
    ElMessage.success('发布成功，现在可以分享填写链接');
  } catch (e: any) {
    if (e instanceof Error) ElMessage.error(e.message);
  } finally {
    busy.value = false;
  }
}
async function close() {
  try {
    await ElMessageBox.confirm('关闭后将停止接收答卷，第一阶段不支持重新开放。', '关闭问卷', {
      type: 'warning',
    });
    survey.value = await api('/surveys/' + route.params.id + '/close', 'POST');
    ElMessage.success('问卷已关闭');
  } catch (e: any) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function saveDeadline() {
  try {
    survey.value = await api('/surveys/' + route.params.id + '/deadline', 'PATCH', {
      deadlineAt: deadline.value || null,
    });
    ElMessage.success('截止时间已更新');
  } catch (e: any) {
    ElMessage.error(e.message);
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(location.origin + '/survey/' + survey.value.publicId);
    ElMessage.success('链接已复制');
  } catch {
    ElMessage.info(location.origin + '/survey/' + survey.value.publicId);
  }
}
</script>
<template>
  <div v-if="definition" class="editor-page continuous-editor">
    <header class="editor-toolbar">
      <div class="editor-title-row">
        <router-link to="/" class="editor-back" aria-label="返回我的问卷">←</router-link>
        <h2 :title="definition.title">
          {{ definition.title }}
          <span class="status" :class="survey.status">
            {{ locked ? '已锁定发布内容' : '草稿' }}
          </span>
        </h2>
        <span class="editor-question-count">{{ definition.questions.length }} 道题</span>
      </div>
      <div class="toolbar-actions">
        <template v-if="!locked">
          <el-button :loading="busy" @click="save">保存草稿</el-button>
          <el-button type="primary" :loading="busy" @click="publish">发布问卷 ↗</el-button>
        </template>
        <template v-else>
          <el-button @click="router.push('/survey/' + survey.publicId)">打开填写页</el-button>
          <el-button @click="copy">复制填写链接</el-button>
          <el-button type="primary" @click="router.push('/statistics/' + survey._id)">
            查看统计
          </el-button>
          <el-button v-if="survey.status === 'published'" type="danger" plain @click="close">
            关闭
          </el-button>
        </template>
      </div>
    </header>
    <div class="editor-layout">
      <aside class="panel question-palette">
        <div class="palette-types">
          <span class="eyebrow">QUESTION LIBRARY</span>
          <h3>添加题目</h3>
          <div class="palette-grid">
            <button
              v-for="(label, type) in labels"
              :key="type"
              :disabled="locked"
              @click="add(type)"
            >
              <b>{{ typeMarks[type] }}</b>
              {{ label }}
            </button>
          </div>
        </div>
        <div class="outline-heading">
          <h3>题目目录</h3>
          <small>{{ definition.questions.length }} / 100</small>
        </div>
        <nav ref="outline" class="question-outline" aria-label="题目目录">
          <button
            v-for="(item, i) in definition.questions"
            :key="item.id"
            :class="['outline-item', { selected: selected === i }]"
            :aria-current="selected === i ? 'true' : undefined"
            @click="goToQuestion(i)"
          >
            <span>{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="outline-title">{{ item.title || '未命名题目' }}</span>
            <small class="routing-badge">
              {{ routingById.get(item.id)?.kind === 'branch' ? '分支' : '通用' }}
            </small>
          </button>
          <p v-if="!definition.questions.length" class="outline-empty">
            从上方选择题型，开始第一题。
          </p>
        </nav>
        <div class="palette-footnote">
          上下滚动可连续编辑题目
          <br />
          点击目录可直接定位
        </div>
      </aside>
      <div class="editor-main">
        <div
          v-if="routing"
          class="routing-overview"
          :class="{ 'routing-invalid': !routing.entryQuestionId }"
          role="status"
        >
          <span>
            <b>{{ modeLabel(routing.routingMode) }}</b>
            <small>{{ routing.routingMode }}</small>
          </span>
          <span>
            {{
              routing.entryQuestionId
                ? '入口：' + questionName(routing.entryQuestionId)
                : '缺少填写入口：请至少保留一道通用题（NO_ENTRY）'
            }}
          </span>
          <small>{{ dirty ? '未保存规则的即时预览' : '服务端分类' }}</small>
          <el-button
            v-if="!locked && routing.routingMode === 'legacy-v1'"
            text
            :disabled="busy"
            @click="previewUpgrade"
          >
            升级跳转机制
          </el-button>
        </div>
        <section :class="['editor-survey-settings', { 'is-expanded': settingsOpen }]">
          <button
            class="settings-toggle"
            :aria-expanded="settingsOpen"
            aria-controls="survey-settings-body"
            @click="settingsOpen = !settingsOpen"
          >
            <span>
              <b>问卷设置</b>
              <small>标题 · 说明 · 填写权限 · 截止时间</small>
            </span>
            <span>{{ settingsOpen ? '收起 −' : '展开 ＋' }}</span>
          </button>
          <div v-if="settingsOpen" id="survey-settings-body" class="settings-body">
            <el-form label-position="top" :disabled="locked">
              <div class="survey-definition-fields">
                <el-form-item label="问卷标题">
                  <el-input v-model="definition.title" maxlength="120" show-word-limit />
                </el-form-item>
                <el-form-item label="问卷说明">
                  <el-input
                    v-model="definition.description"
                    type="textarea"
                    :rows="1"
                    maxlength="5000"
                    placeholder="向填写者介绍本次调查的目的"
                  />
                </el-form-item>
              </div>
              <div class="setting-switches">
                <label>
                  <el-switch v-model="definition.allowAnonymous" />
                  允许选择匿名
                </label>
                <label>
                  <el-switch v-model="definition.allowRepeatSubmissions" />
                  允许重复提交
                </label>
              </div>
            </el-form>
            <div class="deadline-row">
              <label>截止时间</label>
              <el-date-picker
                v-model="deadline"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm:ssZ"
                placeholder="不设置则长期有效"
                :disabled="survey.status === 'closed'"
              />
              <el-button v-if="locked && survey.status !== 'closed'" @click="saveDeadline">
                更新
              </el-button>
            </div>
            <p v-if="locked" class="muted">
              发布内容已锁定；截止时间仍可更新。时间按浏览器本地时区显示。
            </p>
          </div>
        </section>
        <div
          ref="canvas"
          class="question-canvas"
          tabindex="0"
          aria-label="连续题目编辑画布"
          @scroll.passive="onCanvasScroll"
        >
          <div
            v-for="(item, i) in definition.questions"
            :key="item.id"
            :ref="(el) => setQuestionElement(item.id, el)"
            :data-question-id="item.id"
            :class="['question-anchor', { 'is-selected': selected === i }]"
            @focusin="selected = i"
            @pointerdown="selected = i"
          >
            <QuestionEditor
              :question="item"
              :index="i"
              :definition="definition"
              :locked="locked"
              :routing-info="routingById.get(item.id)"
              @move="move"
              @remove="remove"
            />
            <div class="question-divider" aria-hidden="true">
              <span>
                {{
                  i + 1 < definition.questions.length
                    ? '下一题 / ' + String(i + 2).padStart(2, '0')
                    : '问卷题目到这里结束'
                }}
              </span>
            </div>
          </div>
          <section v-if="!definition.questions.length" class="editor-canvas-empty">
            <span>YOUR FIRST QUESTION.</span>
            <h3>从一个好问题开始。</h3>
            <p>点击左侧题型，添加你的第一道题。</p>
          </section>
          <button
            v-else-if="!locked && definition.questions.length < 100"
            class="append-question"
            @click="add('single_choice')"
          >
            ＋ 添加下一道单选题
            <span>也可从左侧选择其他题型</span>
          </button>
        </div>
      </div>
    </div>
    <el-dialog
      v-model="upgradeOpen"
      title="升级跳转机制"
      width="620px"
      :close-on-click-modal="false"
      :close-on-press-escape="!busy"
      :show-close="!busy"
    >
      <template v-if="upgradePreview">
        <p>
          {{ modeLabel(upgradePreview.before.routingMode) }}（{{
            upgradePreview.before.routingMode
          }}） → {{ modeLabel(upgradePreview.after.routingMode) }}（{{
            upgradePreview.after.routingMode
          }}）
        </p>
        <p>
          升级后入口：{{
            planQuestionName(upgradePreview.after, upgradePreview.after.entryQuestionId)
          }}
        </p>
        <p>{{ upgradePreview.warning }}</p>
        <p>
          <strong>
            以下为升级后的完整分支列表。这些题不能再顺序进入，只能通过条件跳转进入；分支不会自动组成连续题组。
          </strong>
        </p>
        <ul class="upgrade-branches">
          <li v-for="id in upgradePreview.after.branchQuestionIds" :key="id">
            {{ planQuestionName(upgradePreview.after, id) }}
            <small v-if="upgradePreview.newlyExclusiveQuestionIds.includes(id)">
              · 将变为专属分支
            </small>
          </li>
          <li v-if="!upgradePreview.after.branchQuestionIds.length">
            无分支题，所有题仍为通用题。
          </li>
        </ul>
        <el-alert
          v-for="(issue, i) in upgradePreview.errors"
          :key="i"
          type="error"
          :closable="false"
          :title="issue.code + '：' + issue.message"
        />
        <p v-if="!upgradePreview.canUpgrade">当前草稿无法升级，请根据以上原因修改后重新预览。</p>
        <el-checkbox v-model="upgradeAcknowledged" :disabled="!upgradePreview.canUpgrade || busy">
          我已审阅入口与完整分支列表，确认升级
        </el-checkbox>
      </template>
      <p v-else>预览不可用，请关闭后重新获取。</p>
      <el-alert v-if="upgradeError" :title="upgradeError" type="error" :closable="false" />
      <template #footer>
        <el-button :disabled="busy" @click="upgradeOpen = false">取消</el-button>
        <el-button
          type="primary"
          :loading="busy"
          :disabled="!upgradePreview?.canUpgrade || !upgradeAcknowledged || dirty"
          @click="confirmUpgrade"
        >
          确认升级
        </el-button>
      </template>
    </el-dialog>
  </div>
  <div v-else-if="loadError" class="empty">
    <p>{{ loadError }}</p>
    <el-button @click="load">重新加载</el-button>
  </div>
  <div v-else class="empty">正在读取问卷…</div>
</template>
