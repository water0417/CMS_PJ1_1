<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, labels } from '../api';
import AnswerInput from '../components/AnswerInput.vue';
import { modeLabel } from '../routing';
const route = useRoute(),
  info = ref<any>(null),
  attempt = ref<any>(null),
  answer = ref<any>(),
  anonymous = ref(true),
  busy = ref(false),
  infoLoading = ref(true),
  error = ref(''),
  done = ref(false);
const showSummary = ref(false);
const conflict = ref(false);
const routing = computed(() => attempt.value?.routing ?? info.value?.routing);
const missingEntry = computed(() => routing.value && !routing.value.entryQuestionId);
function requestError(e: any) {
  conflict.value = e.code === 'CONFLICT';
  error.value = e.message;
}
async function reloadAttempt() {
  if (busy.value || !attempt.value) return;
  busy.value = true;
  try {
    apply(await api('/attempts/' + attempt.value.id));
  } catch (e: any) {
    requestError(e);
  } finally {
    busy.value = false;
  }
}
const currentPathIndex = computed(
  () => attempt.value?.state.activePath.indexOf(attempt.value.state.currentQuestionId) ?? -1,
);
const question = computed(() =>
  attempt.value?.definition.questions.find(
    (q: any) => q.id === attempt.value.state.currentQuestionId,
  ),
);
onMounted(async () => {
  try {
    info.value = await api('/public/surveys/' + route.params.publicId);
    anonymous.value = info.value.definition.allowAnonymous;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    infoLoading.value = false;
  }
});
function apply(a: any) {
  conflict.value = false;
  showSummary.value = false;
  attempt.value = a;
  answer.value = structuredClone(a.state.answers[a.state.currentQuestionId]);
  error.value = '';
}
async function start(resume = false) {
  if (busy.value) return;
  busy.value = true;
  try {
    apply(
      resume
        ? await api('/attempts/' + info.value.activeAttemptId)
        : await api('/public/surveys/' + route.params.publicId + '/attempts', 'POST', {
            anonymous: anonymous.value,
          }),
    );
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function next() {
  if (busy.value || attempt.value.state.transitionCount >= 200) return;
  busy.value = true;
  try {
    apply(
      await api('/attempts/' + attempt.value.id + '/advance', 'POST', {
        revision: attempt.value.state.revision,
        answer: answer.value ?? null,
      }),
    );
  } catch (e: any) {
    requestError(e);
  } finally {
    busy.value = false;
  }
}
async function back(questionId?: string) {
  if (busy.value) return;
  busy.value = true;
  const path = attempt.value.state.activePath;
  const target =
    typeof questionId === 'string'
      ? questionId
      : attempt.value.state.currentQuestionId === 'END'
        ? path[path.length - 1]
        : path[currentPathIndex.value - 1];
  if (!target || !path.includes(target)) {
    busy.value = false;
    error.value = '只能返回当前有效路径中已访问的题目';
    return;
  }
  try {
    apply(
      await api('/attempts/' + attempt.value.id + '/back', 'POST', {
        revision: attempt.value.state.revision,
        questionId: target,
      }),
    );
  } catch (e: any) {
    requestError(e);
  } finally {
    busy.value = false;
  }
}
async function submit() {
  if (busy.value) return;
  busy.value = true;
  try {
    await api('/attempts/' + attempt.value.id + '/submit', 'POST', {
      revision: attempt.value.state.revision,
    });
    done.value = true;
    ElMessage.success('提交成功');
  } catch (e: any) {
    requestError(e);
  } finally {
    busy.value = false;
  }
}
async function restart() {
  try {
    await ElMessageBox.confirm('重新开始会建立一次新的填写，原记录不计入统计。', '重新填写', {
      confirmButtonText: '重新开始',
      cancelButtonText: '取消',
    });
    await start();
  } catch {}
}
</script>
<template>
  <div class="fill-page" :class="{ 'has-attempt': !!attempt && !done }">
    <div class="fill-brand">
      <span class="eyebrow">POWERED BY ASKWELL</span>
      <span>认真提问 · 真诚作答</span>
    </div>
    <div v-if="infoLoading" class="empty">正在读取问卷…</div>
    <section v-if="done" class="panel completion">
      <span class="success-icon">✓</span>
      <h1>感谢你的回答。</h1>
      <p>你的答卷已经成功保存，每一个声音都很重要。</p>
      <router-link to="/">返回工作台 →</router-link>
    </section>
    <template v-else-if="info">
      <p v-if="routing" class="fill-routing-note">
        {{ modeLabel(routing.routingMode) }} · 题目按已发布版本的规则呈现
      </p>
      <el-alert
        v-if="missingEntry"
        title="缺少填写入口（NO_ENTRY）：此问卷没有通用题，请联系创建者。"
        type="error"
        :closable="false"
      />
      <section class="fill-heading">
        <span class="eyebrow">SURVEY / {{ attempt ? 'IN PROGRESS' : 'WELCOME' }}</span>
        <h1>{{ info.definition.title }}</h1>
        <p>{{ info.definition.description || '感谢你抽出时间参与本次问卷。' }}</p>
      </section>
      <section v-if="!attempt" class="panel fill-intro">
        <h3>开始之前</h3>
        <p>本问卷包含 {{ info.definition.questions.length }} 道题，实际题目由你的回答决定。</p>
        <p>
          {{
            info.definition.allowRepeatSubmissions
              ? '允许重复填写，每次提交独立统计。'
              : '每个账号只能成功提交一份。'
          }}
          {{
            info.deadlineAt
              ? '截止于 ' + new Date(info.deadlineAt).toLocaleString('zh-CN')
              : '暂未设置截止时间。'
          }}
        </p>
        <label v-if="info.definition.allowAnonymous">
          <el-switch v-model="anonymous" />
          匿名填写（创建者看不到你的身份）
        </label>
        <p v-else class="hint">此问卷不允许匿名，提交时记录账号身份。</p>
        <div class="fill-actions">
          <el-button v-if="info.activeAttemptId" size="large" @click="start(true)" :loading="busy">
            继续上次填写
          </el-button>
          <el-button
            type="primary"
            size="large"
            @click="start()"
            :disabled="
              missingEntry || (info.alreadySubmitted && !info.definition.allowRepeatSubmissions)
            "
            :loading="busy"
          >
            {{
              info.alreadySubmitted && !info.definition.allowRepeatSubmissions
                ? '你已经提交过'
                : '开始填写 →'
            }}
          </el-button>
        </div>
      </section>
      <template v-else>
        <div class="fill-progress">
          <span>
            {{
              question && !showSummary
                ? (attempt.state.navigationMode === 'review' ? '返回查看 · ' : '') +
                  labels[question.type]
                : '已到达结束'
            }}
          </span>
          <span>已推进 {{ attempt.state.transitionCount }} / 200 次</span>
        </div>
        <section
          v-if="attempt.state.ready && (attempt.state.currentQuestionId === 'END' || showSummary)"
          class="panel fill-question"
        >
          <h2>一切就绪，准备提交。</h2>
          <p>本次有效路径包含 {{ attempt.state.activePath.length }} 道题。提交后不能修改。</p>
          <div class="answer-review" v-for="id in attempt.state.activePath" :key="id">
            <strong>{{ attempt.definition.questions.find((q: any) => q.id === id)?.title }}</strong>
            <span>
              {{
                !attempt.state.confirmedQuestionIds?.includes(id)
                  ? '待确认'
                  : Object.hasOwn(attempt.state.answers, id)
                    ? '已回答'
                    : '选填 · 已跳过'
              }}
            </span>
            <el-button text @click="back(id)" :disabled="busy">查看 / 修改</el-button>
          </div>
          <div class="fill-actions">
            <el-button @click="back()">返回查看</el-button>
            <el-button type="primary" :loading="busy" @click="submit">提交答卷</el-button>
          </div>
          <p v-if="attempt.state.transitionCount >= 180" class="hint">
            已确认 {{ attempt.state.transitionCount }} / 200
            次；返回查看不会重置次数。达到上限后仍可提交已完成的有效答案。
          </p>
        </section>
        <section v-else-if="question" class="panel fill-question">
          <div class="question-number">
            {{
              String(
                attempt.definition.questions.findIndex((q: any) => q.id === question.id) + 1,
              ).padStart(2, '0')
            }}
            <span>{{ question.required ? '必答' : '选填' }}</span>
          </div>
          <h2>{{ question.title }}</h2>
          <p v-if="question.description" class="muted">{{ question.description }}</p>
          <p v-if="question.type === 'multiple_choice'" class="hint">
            选择数量：{{ question.validation.minSelections ?? 0 }}～{{
              question.validation.maxSelections ?? question.options.length
            }}
            项
          </p>
          <AnswerInput
            :key="question.id + ':' + attempt.state.revision"
            :question="question"
            v-model="answer"
          />
          <el-alert
            v-if="attempt.state.transitionCount >= 180"
            :closable="false"
            type="warning"
            :title="`剩余 ${200 - attempt.state.transitionCount} 次推进机会；达到上限仍未结束时需重新开始。`"
          />
          <div class="fill-actions">
            <el-button v-if="currentPathIndex > 0" @click="back()">← 返回前题</el-button>
            <el-button v-if="attempt.state.ready" @click="showSummary = true" :disabled="busy">
              返回提交确认
            </el-button>
            <el-button
              v-if="!question.required"
              @click="
                answer = undefined;
                next();
              "
              :disabled="attempt.state.transitionCount >= 200"
            >
              跳过
            </el-button>
            <el-button
              type="primary"
              :loading="busy"
              @click="next"
              :disabled="attempt.state.transitionCount >= 200"
            >
              {{ attempt.state.navigationMode === 'review' ? '确认答案并继续 →' : '下一题 →' }}
            </el-button>
            <el-button v-if="attempt.state.transitionCount >= 200" type="warning" @click="restart">
              重新开始
            </el-button>
          </div>
          <p class="muted small">
            返回查看不会清除答案。确认答案后重算路径，仅清除失效分支；未确认的输入不会保存。
          </p>
        </section>
      </template>
    </template>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      show-icon
      class="error-alert"
    />
    <el-button v-if="conflict" :loading="busy" @click="reloadAttempt">
      读取最新填写状态（替换未确认输入）
    </el-button>
  </div>
</template>
