<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { auth, api } from '../api';
import { workspace, refreshSurveys, statusName, type SurveySummary } from '../workspace';
import ArchiveTitle from '../components/ArchiveTitle.vue';
defineEmits<{ create: [] }>();
const router = useRouter(),
  loading = ref(true),
  error = ref(''),
  page = ref(1);
const deleting = ref<string | null>(null);
async function remove(s: SurveySummary) {
  if (deleting.value) return;
  deleting.value = s._id;
  try {
    await ElMessageBox.confirm(
      `确认从工作区删除“${s.draft.title}”？删除后原填写链接将失效，已有 ${s.responseCount} 份答卷将随问卷隐藏，数据不会永久清空。`,
      '删除问卷',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    );
    await api('/surveys/' + s._id, 'DELETE', { revision: s.revision });
    workspace.surveys = workspace.surveys.filter((item) => item._id !== s._id);
    ElMessage.success('问卷已从工作区删除');
  } catch (e: any) {
    if (e?.message) {
      ElMessage.error(e.message);
      if (e.code === 'CONFLICT' || e.code === 'NOT_FOUND') await load();
    }
  } finally {
    deleting.value = null;
  }
}
const filtered = computed(() =>
  workspace.surveys.filter(
    (s) =>
      (workspace.filter === 'all' || s.status === workspace.filter) &&
      s.draft.title.toLowerCase().includes(workspace.search.trim().toLowerCase()),
  ),
);
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 3)));
const visible = computed(() => filtered.value.slice((page.value - 1) * 3, page.value * 3));
const coverTitles = [
  ['LIFE,', 'OBSERVED.'],
  ['LESS,', 'BUT BETTER.'],
  ['WHAT’S', 'NEXT?'],
];
watch(
  () => [workspace.filter, workspace.search],
  () => (page.value = 1),
);
watch(pageCount, (n) => (page.value = Math.min(page.value, n)));
async function load() {
  loading.value = true;
  error.value = '';
  try {
    await refreshSurveys();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  if (!auth.user) {
    router.replace('/login');
    return;
  }
  load();
});
async function copy(s: SurveySummary) {
  const link = location.origin + '/survey/' + s.publicId;
  try {
    await navigator.clipboard.writeText(link);
    ElMessage.success('填写链接已复制');
  } catch {
    ElMessage.info(link);
  }
}
function setFilter(value: string) {
  workspace.filter = value;
}
</script>
<template>
  <div class="dashboard-view">
    <section class="hero">
      <div class="hero-kicker">
        <span class="volume">VOLUME 01</span>
        A JOURNAL OF QUESTIONS &amp; DISCOVERIES
      </div>
      <span class="editorial-mark" aria-hidden="true">ASKWELL STUDIO — EST. 2026</span>
      <ArchiveTitle />
      <h2 class="hero-chinese">让每个问题，都有回响。</h2>
      <p>从一个想法，到一份好问卷。在这里，收集声音，发现答案。</p>
      <div class="hero-footnote">DESIGN / COLLECT / DISCOVER</div>
      <span class="hero-number" aria-hidden="true">FIG. 01 — STAY CURIOUS</span>
    </section>
    <section class="library" aria-label="问卷列表" v-loading="loading">
      <div class="library-header">
        <div class="library-heading">
          <h2>{{ workspace.filter === 'draft' ? '我的草稿' : '最近的问卷' }}</h2>
          <span class="count">{{ String(filtered.length).padStart(2, '0') }}</span>
          <div class="filters" aria-label="筛选问卷">
            <button
              v-for="[v, n] in [
                ['all', '全部'],
                ['published', '收集中'],
                ['draft', '草稿'],
                ['closed', '已关闭'],
              ]"
              :key="v"
              :class="{ active: workspace.filter === v }"
              :aria-pressed="workspace.filter === v"
              @click="setFilter(v)"
            >
              {{ n }}
            </button>
          </div>
        </div>
        <label class="search">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="5" stroke="currentColor" />
            <path d="M12 12L17 17" stroke="currentColor" />
          </svg>
          <input v-model="workspace.search" placeholder="搜索问卷…" aria-label="搜索问卷标题" />
        </label>
      </div>
      <div v-if="error" class="dashboard-empty">
        <p>{{ error }}</p>
        <el-button @click="load">重新加载</el-button>
      </div>
      <div v-else-if="!loading && !filtered.length" class="dashboard-empty">
        <span class="empty-editorial">A NEW BEGINNING.</span>
        <p>
          {{
            workspace.search
              ? '没有找到匹配的问卷。'
              : workspace.filter === 'all'
                ? '好奇心的档案，等你写下第一篇。'
                : '这里暂时没有此状态的问卷。'
          }}
        </p>
        <el-button v-if="!workspace.search" @click="$emit('create')">创建第一份问卷 ↗</el-button>
      </div>
      <div v-else class="cards">
        <article v-for="(s, i) in visible" :key="s._id" :class="['card', 'issue-' + (i % 3)]">
          <router-link
            :to="'/editor/' + s._id"
            class="survey-cover-link"
            :aria-label="(s.status === 'draft' ? '编辑问卷：' : '查看问卷：') + s.draft.title"
          >
            <div class="issue-cover" aria-hidden="true">
              <div class="issue-top">
                <span>QUESTIONNAIRE / {{ String((page - 1) * 3 + i + 1).padStart(2, '0') }}</span>
                <span>
                  {{
                    statusName(s) === '收集中'
                      ? 'OPEN EDITION'
                      : s.status === 'draft'
                        ? 'IN PROGRESS'
                        : 'ARCHIVED'
                  }}
                </span>
              </div>
              <div class="cover-art"></div>
              <div class="cover-heading">
                <span v-for="line in coverTitles[i % 3]" :key="line">{{ line }}</span>
              </div>
              <span class="cover-bottom">
                {{ String(s.questionCount).padStart(2, '0') }} QUESTIONS
              </span>
            </div>
            <h3 :title="s.draft.title">{{ s.draft.title }}</h3>
          </router-link>
          <div class="issue-meta">
            <span>
              <span class="live-status">{{ statusName(s) }} ·</span>
              {{ s.questionCount }} 道题
              <span v-if="s.status !== 'draft'">· {{ s.responseCount }} 份答卷</span>
            </span>
            <div class="survey-links">
              <template v-if="s.status !== 'draft'">
                <button @click="copy(s)" aria-label="复制填写链接">分享</button>
                <router-link :to="'/statistics/' + s._id">统计 ↗</router-link>
              </template>
              <router-link v-else :to="'/editor/' + s._id">继续编辑 ↗</router-link>
              <button
                :disabled="!!deleting"
                :aria-label="'删除问卷：' + s.draft.title"
                @click="remove(s)"
              >
                删除
              </button>
            </div>
          </div>
        </article>
        <button
          v-if="visible.length < 3 && !loading && !workspace.search && workspace.filter === 'all'"
          class="new-edition"
          @click="$emit('create')"
        >
          <span>＋</span>
          <strong>
            YOUR NEXT
            <br />
            QUESTION.
          </strong>
          <small>开启下一次探索 ↗</small>
        </button>
      </div>
      <div class="library-pagination">
        <span>共 {{ workspace.surveys.length }} 份问卷</span>
        <nav v-if="pageCount > 1" aria-label="问卷分页">
          <button :disabled="page === 1" @click="page--" aria-label="上一页">←</button>
          <span>{{ page }} / {{ pageCount }}</span>
          <button :disabled="page === pageCount" @click="page++" aria-label="下一页">→</button>
        </nav>
        <button v-else class="refresh-list" @click="load" :disabled="loading">刷新 ↻</button>
      </div>
    </section>
  </div>
</template>
