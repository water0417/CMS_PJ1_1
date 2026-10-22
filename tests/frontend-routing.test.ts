import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computed, ref } from 'vue';
import { previewRouting } from '../apps/web/src/routing';
import type { Definition } from '../apps/api/src/domain';

const sample = (): Definition =>
  JSON.parse(fs.readFileSync('docs/examples/branch-routing.json', 'utf8'));
test('编辑预览随目标修改和删除立即重算分类与入口', () => {
  const draft = ref(sample());
  const routing = computed(() => previewRouting(draft.value));
  assert.deepEqual(routing.value.branchQuestionIds, ['q3', 'q4']);
  draft.value.questions[1].jumpRules[0].target = 'q1';
  assert.equal(routing.value.entryQuestionId, 'q2');
  assert.deepEqual(routing.value.branchQuestionIds, ['q1', 'q4']);
  draft.value.questions[1].jumpRules.splice(0, 1);
  assert.equal(routing.value.entryQuestionId, 'q1');
  assert.deepEqual(routing.value.branchQuestionIds, ['q4']);
});
test('共享目标去重，END不成为分支；全部指向时明确无入口', () => {
  const d = sample();
  assert.deepEqual(
    previewRouting(d)
      .questions.find((q) => q.questionId === 'q4')
      ?.referencedBy.map((r) => r.ruleId),
    ['sad', 'dark'],
  );
  d.questions[1].jumpRules = d.questions.map((q) => ({
    id: q.id,
    target: q.id,
    operator: 'eq',
    value: 'a',
  }));
  assert.equal(previewRouting(d).entryQuestionId, null);
  d.questions[1].jumpRules.forEach((rule) => (rule.target = 'END'));
  assert.deepEqual(previewRouting(d).branchQuestionIds, []);
});
test('历史缺省和显式旧模式不会被前端分类成专属分支', () => {
  for (const mode of [undefined, 'legacy-v1'] as const) {
    const d = sample();
    d.routingMode = mode;
    const routing = previewRouting(d);
    assert.equal(routing.routingMode, 'legacy-v1');
    assert.deepEqual(routing.branchQuestionIds, []);
    assert.equal(
      routing.questions.every((q) => q.canEnterSequentially),
      true,
    );
    assert.deepEqual(routing.ruleTargetQuestionIds, ['q3', 'q4']);
  }
});
