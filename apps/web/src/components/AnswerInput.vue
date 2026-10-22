<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Question } from '../../../api/src/domain';
const props = defineProps<{ question: Question; modelValue: any }>();
const emit = defineEmits(['update:modelValue']);
const order = ref<string[]>([]),
  score = ref(0),
  color = ref('#14B8A6');
watch(
  () => props.question.id,
  () => {
    order.value = Array.isArray(props.modelValue)
      ? [...props.modelValue]
      : props.question.options.map((o) => o.id);
    score.value = props.modelValue ?? props.question.validation.min ?? 0;
    color.value = props.modelValue ?? '#14B8A6';
  },
  { immediate: true },
);
function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= order.value.length) return;
  [order.value[i], order.value[j]] = [order.value[j], order.value[i]];
  emit('update:modelValue', [...order.value]);
}
function matrix(row: string, value: any) {
  emit('update:modelValue', { ...(props.modelValue ?? {}), [row]: value });
}
function dateTime(value: string) {
  if (!value) {
    emit('update:modelValue', undefined);
    return;
  }
  const d = new Date(value + ':00+08:00');
  emit('update:modelValue', Number.isNaN(+d) ? undefined : d.toISOString());
}
function shanghai(value: any) {
  if (!value) return '';
  const d = new Date(Date.parse(value) + 8 * 3600000);
  return d.toISOString().slice(0, 16);
}
const update = (value: any) => emit('update:modelValue', value);
</script>
<template>
  <div class="answer-input">
    <el-radio-group
      v-if="question.type === 'single_choice'"
      :model-value="modelValue"
      @update:model-value="update"
      class="choice-list"
    >
      <el-radio v-for="o in question.options" :key="o.id" :value="o.id" border>
        {{ o.label }}
      </el-radio>
    </el-radio-group>
    <el-checkbox-group
      v-else-if="question.type === 'multiple_choice'"
      :model-value="modelValue ?? []"
      @update:model-value="update"
      class="choice-list"
    >
      <el-checkbox v-for="o in question.options" :key="o.id" :value="o.id" border>
        {{ o.label }}
      </el-checkbox>
    </el-checkbox-group>
    <el-input
      v-else-if="question.type === 'text'"
      :model-value="modelValue ?? ''"
      @update:model-value="update"
      type="textarea"
      :rows="4"
      placeholder="在这里写下你的答案"
      :maxlength="question.validation.maxLength ?? 10000"
      show-word-limit
    />
    <el-input-number
      v-else-if="question.type === 'number'"
      :model-value="modelValue"
      @update:model-value="update"
      :controls="false"
      placeholder="请输入数字"
    />
    <div v-else-if="question.type === 'matrix'" class="matrix-wrap">
      <div class="matrix-desktop table-scroll">
        <table class="data-table matrix-table">
          <thead>
            <tr>
              <th scope="col">评价项目</th>
              <th v-for="o in question.options" :key="o.id" scope="col">{{ o.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in question.rows" :key="row.id">
              <th scope="row">{{ row.label }}</th>
              <td v-for="o in question.options" :key="o.id">
                <input
                  type="radio"
                  :name="`matrix-${question.id}-${row.id}`"
                  :value="o.id"
                  :checked="modelValue?.[row.id] === o.id"
                  :aria-label="row.label + '：' + o.label"
                  @change="matrix(row.id, o.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="matrix-mobile">
        <div v-for="row in question.rows" :key="row.id" class="matrix-row">
          <strong>{{ row.label }}</strong>
          <el-radio-group
            :model-value="modelValue?.[row.id]"
            @update:model-value="(v: any) => matrix(row.id, v)"
          >
            <el-radio v-for="o in question.options" :key="o.id" :value="o.id">
              {{ o.label }}
            </el-radio>
          </el-radio-group>
        </div>
      </div>
    </div>
    <div v-else-if="question.type === 'ranking'" class="ranking">
      <p class="muted">使用上移、下移调整顺序，再确认排序。</p>
      <div v-for="(id, i) in order" :key="id" class="rank-row">
        <span class="rank-number">{{ i + 1 }}</span>
        <strong>{{ question.options.find((o) => o.id === id)?.label }}</strong>
        <el-button :disabled="i === 0" @click="move(i, -1)" aria-label="上移">↑</el-button>
        <el-button :disabled="i === order.length - 1" @click="move(i, 1)" aria-label="下移">
          ↓
        </el-button>
      </div>
      <el-button @click="update([...order])" :type="modelValue ? 'success' : 'default'">
        {{ modelValue ? '已确认排序' : '确认此排序' }}
      </el-button>
    </div>
    <div v-else-if="question.type === 'time'">
      <label v-if="question.validation.mode === 'datetime'" class="muted">
        北京时间（Asia/Shanghai）
      </label>
      <input
        v-if="question.validation.mode === 'datetime'"
        type="datetime-local"
        class="native-input"
        :value="shanghai(modelValue)"
        @input="dateTime(($event.target as HTMLInputElement).value)"
      />
      <input
        v-else
        :type="question.validation.mode === 'date' ? 'date' : 'time'"
        class="native-input"
        :value="modelValue ?? ''"
        @input="update(($event.target as HTMLInputElement).value)"
      />
    </div>
    <div v-else-if="question.type === 'slider'" class="slider-answer">
      <div class="score-value">
        {{ modelValue === undefined ? '—' : modelValue }}
        <small>分</small>
      </div>
      <el-slider
        v-model="score"
        :min="question.validation.min"
        :max="question.validation.max"
        :step="question.validation.step"
        show-input
        @change="update"
      />
      <div class="slider-labels">
        <span>{{ question.validation.lowLabel || question.validation.min }}</span>
        <span>{{ question.validation.highLabel || question.validation.max }}</span>
      </div>
      <el-button @click="update(score)">
        {{ modelValue === undefined ? '确认当前评分' : '更新评分' }}
      </el-button>
    </div>
    <div v-else-if="question.type === 'color'" class="color-answer">
      <el-color-picker v-model="color" color-format="hex" @change="update" />
      <el-input
        :model-value="modelValue ?? ''"
        @update:model-value="update"
        placeholder="#RRGGBB"
        maxlength="7"
      />
      <el-button @click="update(color)">确认颜色</el-button>
      <span v-if="modelValue" :style="{ background: modelValue }" class="color-swatch"></span>
    </div>
  </div>
</template>
