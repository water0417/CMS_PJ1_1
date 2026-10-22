<script setup lang="ts">
import { computed, ref } from 'vue';
import { labels, uid } from '../api';
import type { Definition, Question } from '../../../api/src/domain';
import type { Routing } from '../routing';
const props = defineProps<{
  question: Question;
  index: number;
  definition: Definition;
  locked: boolean;
  routingInfo?: Routing['questions'][number];
}>();
const emit = defineEmits<{ move: [index: number, delta: number]; remove: [index: number] }>();
const q = computed(() => props.question),
  selected = computed(() => props.index);
const logicOpen = ref(props.question.jumpRules.length > 0);
function move(delta: number) {
  emit('move', props.index, delta);
}
function remove() {
  emit('remove', props.index);
}
const ops: Record<string, string> = {
  eq: '等于',
  any: '包含任一',
  all: '包含全部',
  exact: '选项完全相同',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  between: '闭区间内',
};

function timeDisplay(value?: string) {
  if (!value) return '';
  return q.value?.validation.mode === 'datetime'
    ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16)
    : value;
}
function timeLimit(key: 'earliest' | 'latest', value: string) {
  if (!q.value) return;
  q.value.validation[key] = !value
    ? undefined
    : q.value.validation.mode === 'datetime'
      ? new Date(value + ':00+08:00').toISOString()
      : value;
}
function newRule() {
  if (!q.value) return;
  q.value.jumpRules.push({
    id: uid(),
    operator: q.value.type === 'multiple_choice' ? 'any' : 'eq',
    value:
      q.value.type === 'number'
        ? 0
        : q.value.type === 'multiple_choice'
          ? []
          : q.value.options[0]?.id,
    target: 'END',
  });
}
function changeOperator(r: any) {
  r.value =
    r.operator === 'between'
      ? [0, 100]
      : q.value?.type === 'number'
        ? 0
        : q.value?.type === 'multiple_choice'
          ? []
          : q.value?.options[0]?.id;
}
</script>
<template>
  <section
    class="panel question-editor"
    :aria-label="`第 ${index + 1} 题：${q.title || labels[q.type]}`"
  >
    <div class="question-editor-heading">
      <div class="question-identity">
        <span class="question-index">
          第
          <strong>{{ String(selected + 1).padStart(2, '0') }}</strong>
          题
        </span>
        <span class="question-type">{{ labels[q.type] }}</span>
        <span
          v-if="routingInfo"
          class="routing-badge"
          :title="
            routingInfo.kind === 'branch'
              ? '仅通过条件跳转进入，普通顺序答题会跳过。'
              : '允许顺序进入'
          "
        >
          {{ routingInfo.kind === 'branch' ? '分支题' : '通用题' }}
        </span>
      </div>
      <div class="question-heading-actions">
        <label class="required-control">
          <el-switch
            v-model="q.required"
            :disabled="locked"
            :aria-label="`第 ${index + 1} 题是否必答`"
          />
          必答
        </label>
        <template v-if="!locked">
          <el-button text @click="move(-1)" :disabled="selected === 0">上移</el-button>
          <el-button text @click="move(1)" :disabled="selected === definition.questions.length - 1">
            下移
          </el-button>
          <el-button text type="danger" @click="remove">删除</el-button>
        </template>
      </div>
    </div>
    <p v-if="routingInfo?.kind === 'branch'" class="branch-explanation">
      仅通过条件跳转进入，普通顺序答题会跳过。
      <span v-if="routingInfo.referencedBy.length">
        来源：{{
          routingInfo.referencedBy
            .map(
              (ref) =>
                `第 ${definition.questions.findIndex((item) => item.id === ref.questionId) + 1} 题（规则 ${ref.ruleId}）`,
            )
            .join('、')
        }}
      </span>
    </p>
    <el-form label-position="top" :disabled="locked">
      <div class="question-basics">
        <el-form-item label="题目标题">
          <el-input
            v-model="q.title"
            :aria-label="`第 ${index + 1} 题标题`"
            placeholder="你想了解什么？"
            maxlength="500"
          />
        </el-form-item>
        <el-form-item label="补充说明">
          <el-input
            v-model="q.description"
            placeholder="选填，帮助填写者理解问题"
            maxlength="2000"
          />
        </el-form-item>
      </div>
      <div
        v-if="['single_choice', 'multiple_choice', 'ranking', 'matrix'].includes(q.type)"
        :class="['question-options-grid', { 'has-matrix': q.type === 'matrix' }]"
      >
        <section class="option-list">
          <label class="field-label">{{ q.type === 'matrix' ? '列选项' : '选项' }}</label>
          <div v-for="(o, i) in q.options" :key="o.id" class="option-row">
            <span>{{ i < 26 ? String.fromCharCode(65 + i) : i + 1 }}</span>
            <el-input
              v-model="o.label"
              placeholder="输入选项内容"
              :aria-label="`第 ${index + 1} 题选项 ${i + 1}`"
              maxlength="200"
            />
            <el-button text type="danger" @click="q.options.splice(i, 1)">移除</el-button>
          </div>
          <el-button
            text
            type="primary"
            :disabled="locked || q.options.length >= 30"
            @click="q.options.push({ id: uid(), label: '' })"
          >
            ＋ 添加选项
          </el-button>
        </section>
        <section v-if="q.type === 'matrix'" class="matrix-row-list">
          <label class="field-label">矩阵行</label>
          <div v-for="(row, i) in q.rows" :key="row.id" class="option-row">
            <span>{{ i + 1 }}</span>
            <el-input
              v-model="row.label"
              placeholder="输入评价项目"
              :aria-label="`第 ${index + 1} 题评价项目 ${i + 1}`"
              maxlength="200"
            />
            <el-button text type="danger" @click="q.rows.splice(i, 1)">移除</el-button>
          </div>
          <el-button
            text
            type="primary"
            :disabled="locked || q.rows.length >= 30"
            @click="q.rows.push({ id: uid(), label: '' })"
          >
            ＋ 添加行
          </el-button>
        </section>
      </div>
      <div class="validation-fields">
        <template v-if="q.type === 'multiple_choice'">
          <label>
            至少选择
            <el-input-number v-model="q.validation.minSelections" :min="0" :max="30" />
          </label>
          <label>
            最多选择
            <el-input-number v-model="q.validation.maxSelections" :min="0" :max="30" />
          </label>
          <small>两者相同即固定数量；可选题允许整题留空。</small>
        </template>
        <template v-if="q.type === 'text'">
          <label>
            最少字数
            <el-input-number v-model="q.validation.minLength" :min="0" />
          </label>
          <label>
            最多字数
            <el-input-number v-model="q.validation.maxLength" :min="0" :max="10000" />
          </label>
          <label>
            格式
            <el-select v-model="q.validation.format" clearable>
              <el-option label="普通文本" value="none" />
              <el-option label="中国大陆手机号" value="phone_cn_mobile" />
            </el-select>
          </label>
        </template>
        <template v-if="['number', 'slider'].includes(q.type)">
          <label>
            最小值
            <el-input-number v-model="q.validation.min" />
          </label>
          <label>
            最大值
            <el-input-number v-model="q.validation.max" />
          </label>
          <label v-if="q.type === 'number'">
            仅整数
            <el-switch v-model="q.validation.integerOnly" />
          </label>
          <template v-else>
            <label>
              步长
              <el-input-number v-model="q.validation.step" :min="1" />
            </label>
            <label>
              左端说明
              <el-input v-model="q.validation.lowLabel" />
            </label>
            <label>
              右端说明
              <el-input v-model="q.validation.highLabel" />
            </label>
          </template>
        </template>
        <template v-if="q.type === 'time'">
          <label>
            时间模式
            <el-select
              v-model="q.validation.mode"
              @change="
                q.validation.earliest = undefined;
                q.validation.latest = undefined;
              "
            >
              <el-option label="日期" value="date" />
              <el-option label="时刻" value="time" />
              <el-option label="日期时间（上海时区）" value="datetime" />
            </el-select>
          </label>
          <label>
            最早允许值
            <input
              :type="
                q.validation.mode === 'datetime'
                  ? 'datetime-local'
                  : q.validation.mode === 'time'
                    ? 'time'
                    : 'date'
              "
              :value="timeDisplay(q.validation.earliest)"
              @input="timeLimit('earliest', ($event.target as HTMLInputElement).value)"
              class="native-input"
              :disabled="locked"
            />
          </label>
          <label>
            最晚允许值
            <input
              :type="
                q.validation.mode === 'datetime'
                  ? 'datetime-local'
                  : q.validation.mode === 'time'
                    ? 'time'
                    : 'date'
              "
              :value="timeDisplay(q.validation.latest)"
              @input="timeLimit('latest', ($event.target as HTMLInputElement).value)"
              class="native-input"
              :disabled="locked"
            />
          </label>
          <small>日期时间按北京时间设置；留空表示不限制。</small>
        </template>
      </div>
      <p v-if="q.type === 'ranking'" class="hint">
        完整排序：填写时须确认全部选项的顺序，统计平均名次、首选次数及名次分布。
      </p>
      <p v-if="q.type === 'color'" class="hint">选择一个不透明颜色，统一保存为 #RRGGBB。</p>
      <details
        v-if="['single_choice', 'multiple_choice', 'number'].includes(q.type)"
        class="logic-panel"
        :open="logicOpen"
        @toggle="logicOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary class="logic-summary">
          <span>
            条件跳转
            <small>{{ q.jumpRules.length ? q.jumpRules.length + ' 条规则' : '按需配置' }}</small>
          </span>
          <span>{{ logicOpen ? '收起 −' : '展开 ＋' }}</span>
        </summary>
        <div class="logic-content">
          <div class="section-heading">
            <h3>规则设置</h3>
            <el-button text type="primary" @click="newRule">＋ 添加规则</el-button>
          </div>
          <p class="muted">
            按以下顺序判断，首条命中生效；{{
              definition.routingMode === 'exclusive-branches-v1'
                ? '未命中则跳过分支题，进入后续下一道通用题。分支不自动成组，进入另一分支须明确跳转。'
                : '未命中则按原题序进入下一题（旧版机制）。'
            }}可选题留空不触发跳转。
          </p>
          <div v-for="(r, i) in q.jumpRules" :key="r.id" class="rule-card">
            <div class="rule-title">
              规则 {{ i + 1 }}
              <div>
                <el-button
                  text
                  size="small"
                  :disabled="i === 0"
                  @click="
                    [q!.jumpRules[i - 1], q!.jumpRules[i]] = [q!.jumpRules[i], q!.jumpRules[i - 1]]
                  "
                >
                  上移
                </el-button>
                <el-button text size="small" type="danger" @click="q!.jumpRules.splice(i, 1)">
                  删除
                </el-button>
              </div>
            </div>
            <div class="rule-fields">
              <el-select v-model="r.operator" @change="changeOperator(r)">
                <el-option
                  v-for="op in q.type === 'number'
                    ? ['eq', 'gt', 'gte', 'lt', 'lte', 'between']
                    : q.type === 'multiple_choice'
                      ? ['any', 'all', 'exact']
                      : ['eq']"
                  :key="op"
                  :label="ops[op]"
                  :value="op"
                />
              </el-select>
              <template v-if="q.type === 'number'">
                <template v-if="r.operator === 'between'">
                  <el-input-number v-model="r.value[0]" />
                  <el-input-number v-model="r.value[1]" />
                </template>
                <el-input-number v-else v-model="r.value" />
              </template>
              <el-select v-else v-model="r.value" :multiple="q.type === 'multiple_choice'">
                <el-option
                  v-for="o in q.options"
                  :key="o.id"
                  :label="o.label || '未填写选项'"
                  :value="o.id"
                />
              </el-select>
              <span>跳至</span>
              <el-select v-model="r.target">
                <el-option label="结束问卷" value="END" />
                <el-option
                  v-for="(t, ti) in definition.questions"
                  :key="t.id"
                  :label="`${ti + 1}. ${t.title || '未命名题目'}`"
                  :value="t.id"
                />
              </el-select>
            </div>
          </div>
        </div>
      </details>
    </el-form>
  </section>
</template>
