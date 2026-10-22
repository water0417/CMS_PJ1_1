<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api, labels } from '../api';
const route = useRoute(),
  data = ref<any>(null),
  loading = ref(false),
  filter = ref('all'),
  loadError = ref(''),
  details = ref<Record<string, any>>({});
async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    data.value = await api('/surveys/' + route.params.id + '/statistics');
  } catch (e: any) {
    loadError.value = e.message;
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
async function contents(qid: string, page = 1) {
  try {
    details.value[qid] = await api(
      `/surveys/${route.params.id}/questions/${qid}/answers?page=${page}`,
    );
  } catch (e: any) {
    ElMessage.error(e.message);
  }
}
const count = (s: any, id: string) => s.distribution?.find((d: any) => d._id === id)?.count ?? 0;
const matrixCount = (s: any, r: string, o: string) =>
  s.matrix?.find((d: any) => d._id.row === r && d._id.option === o)?.count ?? 0;
const number = (v: any) =>
  v === null || v === undefined
    ? '暂无数据'
    : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const format = (s: any, value: any) =>
  s.question.type === 'time' && s.question.validation.mode === 'datetime'
    ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '（上海）'
    : String(value);
</script>
<template>
  <div class="page stats-page" v-loading="loading">
    <router-link :to="'/editor/' + route.params.id" class="muted">← 返回问卷</router-link>
    <div v-if="loadError" class="empty">
      <p>{{ loadError }}</p>
      <el-button @click="load">重新加载</el-button>
    </div>
    <template v-else-if="data">
      <div class="section-heading stats-heading">
        <div>
          <span class="eyebrow">TURN RESPONSES INTO INSIGHTS</span>
          <h1>{{ data.title }}</h1>
          <p class="muted">结果概览 · 仅统计成功提交的有效答案</p>
        </div>
        <el-button @click="load" :loading="loading">刷新统计 ↻</el-button>
      </div>
      <div class="metric-grid">
        <div>
          <span>成功提交</span>
          <strong>
            {{ data.total }}
            <small>份答卷</small>
          </strong>
        </div>
        <div>
          <span>问卷题目</span>
          <strong>
            {{ data.questions.length }}
            <small>道题</small>
          </strong>
        </div>
        <div>
          <span>统计方式</span>
          <strong class="metric-text">实时聚合</strong>
        </div>
      </div>
      <div class="section-heading">
        <h2>逐题分析</h2>
        <el-select v-model="filter" class="stats-filter">
          <el-option label="全部题目" value="all" />
          <el-option
            v-for="s in data.questions"
            :key="s.question.id"
            :label="s.question.title"
            :value="s.question.id"
          />
        </el-select>
      </div>
      <article
        v-for="(s, i) in data.questions.filter(
          (s: any) => filter === 'all' || s.question.id === filter,
        )"
        :key="s.question.id"
        class="panel stat-card"
      >
        <div class="stat-title">
          <span class="question-number">
            {{
              String(
                data.questions.findIndex((item: any) => item.question.id === s.question.id) + 1,
              ).padStart(2, '0')
            }}
          </span>
          <div>
            <span class="eyebrow">
              {{ labels[s.question.type] }} · {{ s.answerCount }} 份有效回答
            </span>
            <h3>{{ s.question.title }}</h3>
          </div>
        </div>
        <template v-if="['single_choice', 'multiple_choice'].includes(s.question.type)">
          <div v-for="o in s.question.options" :key="o.id" class="distribution-row">
            <div>
              <span>{{ o.label }}</span>
              <strong>
                {{ count(s, o.id) }}
                <small>
                  次 · {{ s.answerCount ? Math.round((count(s, o.id) / s.answerCount) * 100) : 0 }}%
                </small>
              </strong>
            </div>
            <el-progress
              :percentage="s.answerCount ? Math.round((count(s, o.id) / s.answerCount) * 100) : 0"
              :show-text="false"
              :stroke-width="9"
            />
          </div>
          <p v-if="s.question.type === 'multiple_choice'" class="muted small">
            多选比例以回答人数为分母，合计可能超过 100%。
          </p>
        </template>
        <div v-if="s.numeric" class="numeric-summary">
          <div>
            <span>平均值</span>
            <strong>{{ number(s.numeric.average) }}</strong>
          </div>
          <div>
            <span>最小值</span>
            <strong>{{ number(s.numeric.min) }}</strong>
          </div>
          <div>
            <span>最大值</span>
            <strong>{{ number(s.numeric.max) }}</strong>
          </div>
        </div>
        <div v-if="s.question.type === 'slider'" class="score-distribution">
          <div v-for="d in s.distribution" :key="d._id">
            <b>{{ d._id }} 分</b>
            <span>{{ d.count }} 次</span>
            <el-progress
              :percentage="s.answerCount ? Math.round((d.count / s.answerCount) * 100) : 0"
              :show-text="false"
            />
          </div>
        </div>
        <div v-if="s.question.type === 'matrix'" class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>评价项目</th>
                <th v-for="o in s.question.options" :key="o.id">{{ o.label }}</th>
                <th>回答数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in s.question.rows" :key="r.id">
                <th>{{ r.label }}</th>
                <td v-for="o in s.question.options" :key="o.id">
                  {{ matrixCount(s, r.id, o.id) }}
                </td>
                <td>
                  {{
                    s.question.options.reduce(
                      (n: number, o: any) => n + matrixCount(s, r.id, o.id),
                      0,
                    )
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="s.question.type === 'ranking'" class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>选项</th>
                <th>平均名次 ↓</th>
                <th>首选次数</th>
                <th>名次分布</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in s.ranking" :key="r._id">
                <th>{{ s.question.options.find((o: any) => o.id === r._id)?.label }}</th>
                <td>{{ number(r.averageRank) }}</td>
                <td>{{ r.firstCount }}</td>
                <td>
                  {{
                    s.question.options
                      .map(
                        (_: any, i: number) =>
                          `${i + 1}名：${r.positions.filter((p: number) => p === i + 1).length}`,
                      )
                      .join(' / ')
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="['time', 'color'].includes(s.question.type)" class="value-distribution">
          <div v-for="d in s.distribution" :key="d._id">
            <span
              v-if="s.question.type === 'color'"
              class="color-swatch"
              :style="{ background: d._id }"
            ></span>
            <span>{{ format(s, d._id) }}</span>
            <strong>{{ d.count }} 次</strong>
          </div>
        </div>
        <template v-if="['text', 'number', 'time', 'color'].includes(s.question.type)">
          <el-button text type="primary" @click="contents(s.question.id)">查看填写内容 ↓</el-button>
          <div v-if="details[s.question.id]" class="answer-details">
            <div v-for="(r, ri) in details[s.question.id].rows" :key="ri">
              <span class="answer-text">{{ format(s, r.value) }}</span>
              <small>{{ new Date(r.submittedAt).toLocaleString('zh-CN') }}</small>
            </div>
            <p v-if="!details[s.question.id].rows.length" class="muted">暂无填写内容</p>
            <el-pagination
              layout="prev,pager,next"
              :total="details[s.question.id].total"
              :page-size="20"
              :current-page="details[s.question.id].page"
              @current-change="(p: number) => contents(s.question.id, p)"
            />
          </div>
        </template>
        <p v-if="!s.answerCount" class="muted">此题还没有有效回答。</p>
      </article>
    </template>
  </div>
</template>
