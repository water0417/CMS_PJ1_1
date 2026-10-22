import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  rewind,
  validateDefinition,
  validateFinal,
  createInitialState,
  createRoutingPlan,
  routingMetadata,
  effectiveNextQuestion,
  BRANCH_ROUTING,
  LEGACY_ROUTING,
  Definition,
  Question,
  AttemptState,
} from '../apps/api/src/domain';
const options = ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase() }));
const q = (
  id: string,
  type: Question['type'] = 'text',
  extra: Partial<Question> = {},
): Question => ({
  id,
  type,
  title: id,
  description: '',
  required: true,
  options,
  rows: [],
  validation: {},
  jumpRules: [],
  ...extra,
});
const rule = (id: string, value: any, target: string, operator = 'eq') => ({
  id,
  value,
  target,
  operator,
});
const def = (questions: Question[]): Definition => ({
  title: '专属分支',
  description: '',
  schemaVersion: 1,
  routingMode: BRANCH_ROUTING,
  allowAnonymous: true,
  allowRepeatSubmissions: true,
  questions,
});
const mood = () =>
  def([
    q('q1'),
    q('q2', 'single_choice', {
      jumpRules: [rule('a', 'a', 'q3'), rule('c', 'c', 'q4'), rule('d', 'd', 'q4')],
    }),
    q('q3'),
    q('q4'),
    q('q5'),
  ]);
function finish(
  d: Definition,
  values: Record<string, any>,
  s = createInitialState(d),
): AttemptState {
  for (let i = 0; !s.ready && i < 20; i++) s = advance(d, s, values[s.currentQuestionId]);
  assert.equal(s.ready, true);
  validateFinal(d, s);
  return s;
}
for (const [answer, path] of [
  ['a', ['q1', 'q2', 'q3', 'q5']],
  ['b', ['q1', 'q2', 'q5']],
  ['c', ['q1', 'q2', 'q4', 'q5']],
  ['d', ['q1', 'q2', 'q4', 'q5']],
] as const) {
  test(`专属分支${answer.toUpperCase()}路线，分支回答后自动寻找通用题`, () => {
    const d = mood();
    validateDefinition(d);
    const s = finish(d, { q1: '一', q2: answer, q3: '快乐', q4: '原因', q5: '五' });
    assert.deepEqual(s.activePath, path);
    assert.equal(s.transitionCount, path.length);
    assert.deepEqual(routingMetadata(d).branchQuestionIds, ['q3', 'q4']);
    for (const id of ['q3', 'q4'].filter((id) => !path.includes(id as never)))
      assert.equal(s.answers[id], undefined);
  });
}
test('分类按全部规则配置计算，与当前命中无关；多条规则可共享分支', () => {
  const d = def([
    q('q1', 'single_choice', { jumpRules: [rule('j1', 'a', 'q3')] }),
    q('q2', 'single_choice', { jumpRules: [rule('j2', 'a', 'q3')] }),
    q('q3'),
    q('q4'),
  ]);
  validateDefinition(d);
  const meta = routingMetadata(d);
  assert.deepEqual(meta.branchQuestionIds, ['q3']);
  assert.equal(meta.questions[2].referencedBy.length, 2);
  assert.equal(meta.questions[2].canEnterSequentially, false);
  assert.deepEqual(finish(d, { q1: 'b', q2: 'a', q3: '三', q4: '四' }).activePath, [
    'q1',
    'q2',
    'q3',
    'q4',
  ]);
  assert.deepEqual(finish(d, { q1: 'a', q3: '三', q4: '四' }).activePath, ['q1', 'q3', 'q4']);
});
test('连续分支不是题组；未配置显式跳转时跳过后面的分支', () => {
  const d = def([
    q('q1', 'single_choice', { jumpRules: [rule('j1', 'a', 'q2'), rule('j2', 'b', 'q3')] }),
    q('q2', 'single_choice'),
    q('q3'),
    q('q4'),
  ]);
  assert.deepEqual(finish(d, { q1: 'a', q2: 'a', q4: '四' }).activePath, ['q1', 'q2', 'q4']);
  d.questions[1].jumpRules = [rule('chain', 'a', 'q3')];
  validateDefinition(d);
  assert.deepEqual(finish(d, { q1: 'a', q2: 'a', q3: '三', q4: '四' }).activePath, [
    'q1',
    'q2',
    'q3',
    'q4',
  ]);
});
test('尾部全为分支：未命中或完成一个分支后直接结束，不额外计数', () => {
  const d = def([
    q('q1', 'single_choice', {
      jumpRules: [rule('j1', 'a', 'q2'), rule('j2', 'b', 'q3'), rule('j3', 'c', 'q4')],
    }),
    q('q2'),
    q('q3'),
    q('q4'),
  ]);
  validateDefinition(d);
  let s = finish(d, { q1: 'd' });
  assert.deepEqual(s.activePath, ['q1']);
  assert.equal(s.transitionCount, 1);
  s = finish(d, { q1: 'a', q2: '二' });
  assert.deepEqual(s.activePath, ['q1', 'q2']);
  assert.equal(s.transitionCount, 2);
});
test('首题被指向时寻找首道通用题，未访问分支的必答不检查', () => {
  const d = def([
    q('q1'),
    q('q2'),
    q('q3', 'single_choice', { jumpRules: [rule('j', 'a', 'q1')] }),
  ]);
  validateDefinition(d);
  assert.equal(createInitialState(d).currentQuestionId, 'q2');
  assert.equal(routingMetadata(d).entryQuestionId, 'q2');
  assert.deepEqual(finish(d, { q2: '二', q3: 'b' }).activePath, ['q2', 'q3']);
});
test('无通用题拒绝定义和开始，非法目标、模式及已取消的显示条件拒绝', () => {
  const d = def([q('q1', 'single_choice', { jumpRules: [rule('self', 'a', 'q1')] })]);
  assert.throws(
    () => validateDefinition(d),
    (e: any) => e.code === 'NO_ENTRY',
  );
  assert.throws(() => createInitialState(d));
  assert.throws(() => validateDefinition({ ...mood(), routingMode: 'unknown' } as any));
  assert.throws(() => validateDefinition({ ...mood(), routingMode: null } as any));
  const bad = mood();
  bad.questions[1].jumpRules[0].target = 'missing';
  assert.throws(() => validateDefinition(bad));
  assert.throws(() =>
    validateDefinition(def([q('q1', 'text', { displayCondition: null } as any)])),
  );
});
test('多选首条命中优先，所有目标均为分支；可选空值只进入通用题', () => {
  const d = def([
    q('q1', 'multiple_choice', {
      required: false,
      jumpRules: [rule('any', ['a'], 'q3', 'any'), rule('all', ['a', 'b'], 'q4', 'all')],
    }),
    q('q2'),
    q('q3'),
    q('q4'),
    q('q5'),
  ]);
  validateDefinition(d);
  assert.deepEqual(finish(d, { q1: ['a', 'b'], q3: '三', q5: '五' }).activePath, [
    'q1',
    'q3',
    'q5',
  ]);
  assert.deepEqual(finish(d, { q1: [], q2: '二', q5: '五' }).activePath, ['q1', 'q2', 'q5']);
});
test('数字比较、闭区间优先及单选可选空值遵循同一有效后继', () => {
  const d = def([
    q('q1', 'number', {
      jumpRules: [rule('range', [0, 10], 'q3', 'between'), rule('gte', 10, 'q4', 'gte')],
    }),
    q('q2'),
    q('q3'),
    q('q4'),
    q('q5'),
  ]);
  validateDefinition(d);
  assert.deepEqual(finish(d, { q1: 10, q3: '三', q5: '五' }).activePath, ['q1', 'q3', 'q5']);
  assert.deepEqual(finish(d, { q1: 20, q4: '四', q5: '五' }).activePath, ['q1', 'q4', 'q5']);
  d.questions[0].required = false;
  assert.deepEqual(finish(d, { q1: null, q2: '二', q5: '五' }).activePath, ['q1', 'q2', 'q5']);
  assert.deepEqual(finish(d, { q1: -1, q2: '二', q5: '五' }).activePath, ['q1', 'q2', 'q5']);
  const optional = mood();
  optional.questions[1].required = false;
  assert.deepEqual(finish(optional, { q1: '一', q2: null, q5: '五' }).activePath, [
    'q1',
    'q2',
    'q5',
  ]);
});
test('显式END优先于通用题；任意命中可直接进入分支', () => {
  const d = mood();
  d.questions[1].jumpRules.unshift(rule('end', 'b', 'END'));
  validateDefinition(d);
  assert.deepEqual(finish(d, { q1: '一', q2: 'b' }).activePath, ['q1', 'q2']);
  assert.equal(effectiveNextQuestion(d, d.questions[1], 'c'), 'q4');
});
test('主动查看不清空，同路改答保留全部有效答案', () => {
  const d = mood();
  let s = finish(d, { q1: '一', q2: 'c', q4: '原因', q5: '汇合' });
  const view = rewind(s, 'q1');
  assert.equal(view.ready, true);
  assert.deepEqual(view.answers, s.answers);
  assert.equal(view.transitionCount, s.transitionCount);
  validateFinal(d, view);
  s = advance(d, view, '改答一');
  assert.equal(s.answers.q4, '原因');
  assert.equal(s.ready, true);
  s = advance(d, rewind(s, 'q2'), 'd');
  assert.equal(s.answers.q4, '原因');
  assert.equal(s.ready, true);
  validateFinal(d, s);
});
test('A切C清理失效分支，先补答新题，再恢复汇合题；切B无需重填', () => {
  const d = mood();
  let s = finish(d, { q1: '一', q2: 'a', q3: '旧快乐', q5: '汇合' });
  s = advance(d, rewind(s, 'q2'), 'c');
  assert.equal(s.currentQuestionId, 'q4');
  assert.equal(s.answers.q3, undefined);
  assert.deepEqual(s.pendingAnswers, { q5: '汇合' });
  assert.throws(() => validateFinal(d, s));
  assert.throws(() => advance(d, s, null));
  s = advance(d, s, '新原因');
  assert.equal(s.answers.q5, '汇合');
  assert.deepEqual(s.activePath, ['q1', 'q2', 'q4', 'q5']);
  validateFinal(d, s);
  s = advance(d, rewind(s, 'q2'), 'b');
  assert.deepEqual(s.answers, { q1: '一', q2: 'b', q5: '汇合' });
  validateFinal(d, s);
});
test('新分支为可选题时也必须明确跳过，未处理不能提交', () => {
  const d = mood();
  d.questions[3].required = false;
  let s = finish(d, { q1: '一', q2: 'b', q5: '汇合' });
  s = advance(d, rewind(s, 'q2'), 'c');
  assert.equal(s.ready, false);
  assert.throws(() => validateFinal(d, s));
  s = advance(d, s, null);
  assert.equal(s.ready, true);
  assert.ok(s.confirmedQuestionIds!.includes('q4'));
  validateFinal(d, s);
});
test('隔离候选不能迫使顺序进入分支，只有显式命中才恢复候选答案', () => {
  for (const answer of ['a', 'b']) {
    const d = def([
      q('q1', 'single_choice', { jumpRules: [rule('j1', 'a', 'q3')] }),
      q('q2', 'single_choice', { jumpRules: [rule('j2', 'a', 'q3')] }),
      q('q3'),
      q('q4'),
    ]);
    let s = finish(d, { q1: 'a', q3: '候选', q4: '汇合' });
    s = advance(d, rewind(s, 'q1'), 'b');
    assert.equal(s.currentQuestionId, 'q2');
    assert.equal(s.pendingAnswers!.q3, '候选');
    s = advance(d, s, answer);
    assert.deepEqual(s.activePath, answer === 'a' ? ['q1', 'q2', 'q3', 'q4'] : ['q1', 'q2', 'q4']);
    assert.equal(s.answers.q3, answer === 'a' ? '候选' : undefined);
    validateFinal(d, s);
  }
});
const loop = () =>
  def([
    q('q0', 'single_choice', { jumpRules: [rule('entry', 'a', 'q1')] }),
    q('q1', 'single_choice', { jumpRules: [rule('out', 'a', 'q2')] }),
    q('q2', 'single_choice', { jumpRules: [rule('back', 'b', 'q1'), rule('self', 'c', 'q2')] }),
    q('q3'),
  ]);
test('真正回跳与自循环仍截断，但普通返回同路改答不是循环', () => {
  const d = loop();
  validateDefinition(d);
  let s = finish(d, { q0: 'a', q1: 'a', q2: 'a', q3: '三' });
  s = advance(d, rewind(s, 'q1'), 'a');
  assert.equal(s.ready, true);
  assert.equal(s.answers.q2, 'a');
  s = advance(d, rewind(s, 'q2'), 'b');
  assert.deepEqual(s.activePath, ['q0', 'q1']);
  assert.deepEqual(s.answers, { q0: 'a', q1: 'a' });
  assert.deepEqual(s.confirmedQuestionIds, ['q0']);
  assert.equal(s.ready, false);
  let t = advance(d, createInitialState(d), 'a');
  t = advance(d, t, 'a');
  t = advance(d, t, 'c');
  assert.deepEqual(t.activePath, ['q0', 'q1', 'q2']);
  assert.deepEqual(t.confirmedQuestionIds, ['q0', 'q1']);
  assert.equal(t.currentQuestionId, 'q2');
});
test('自动跳过不计数，第200次结束可提交，循环和返回均不能绕过上限', () => {
  const d = mood();
  let s = finish(d, { q1: '一', q2: 'b', q5: '五' });
  s = { ...s, transitionCount: 199 };
  s = advance(d, rewind(s, 'q2'), 'b');
  assert.equal(s.transitionCount, 200);
  assert.equal(s.ready, true);
  validateFinal(d, s);
  assert.throws(() => advance(d, rewind(s, 'q2'), 'a'));
  assert.equal(rewind(s, 'q1').transitionCount, 200);
  const cycle = loop();
  let t = advance(cycle, createInitialState(cycle), 'a');
  t = advance(cycle, t, 'a');
  t = advance(cycle, { ...t, transitionCount: 199 }, 'c');
  assert.equal(t.ready, false);
  assert.equal(t.transitionCount, 200);
  assert.throws(() => advance(cycle, t, 'a'));
});
test('结构图也跳过分支；未访问分支不能返回，旧顺序伪造路径和额外答案不能提交', () => {
  const d = mood(),
    plan = createRoutingPlan(d);
  assert.equal(plan.defaultAfter('q3'), 'q5');
  assert.deepEqual(plan.possibleAfter(d.questions[2]), ['q5']);
  const s = finish(d, { q1: '一', q2: 'b', q5: '五' });
  assert.throws(() => rewind(s, 'q3'));
  assert.throws(() => validateFinal(d, { ...s, answers: { ...s.answers, q3: '注入' } }));
  const forged = {
    ...s,
    activePath: ['q1', 'q2', 'q3', 'q4', 'q5'],
    confirmedQuestionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
    answers: { q1: '一', q2: 'b', q3: '三', q4: '四', q5: '五' },
  };
  assert.throws(() => validateFinal(d, forged));
  const first = def([
    q('q1'),
    q('q2'),
    q('q3', 'single_choice', { jumpRules: [rule('j', 'a', 'q1')] }),
  ]);
  assert.throws(() =>
    validateFinal(first, {
      ...forged,
      activePath: ['q1', 'q2', 'q3'],
      confirmedQuestionIds: ['q1', 'q2', 'q3'],
      answers: { q1: '一', q2: '二', q3: 'b' },
    }),
  );
});
test('同一规则定义的新旧模式有明确路线差异，缺标记等价旧模式，不改写定义', () => {
  const legacy = mood();
  delete legacy.routingMode;
  const original = JSON.stringify(legacy);
  validateDefinition(legacy);
  let old = finish(legacy, { q1: '一', q2: 'b', q3: '旧三', q4: '旧四', q5: '五' });
  assert.deepEqual(old.activePath, ['q1', 'q2', 'q3', 'q4', 'q5']);
  assert.equal(routingMetadata(legacy).routingMode, LEGACY_ROUTING);
  assert.deepEqual(routingMetadata(legacy).branchQuestionIds, []);
  assert.equal(JSON.stringify(legacy), original);
  old = advance(legacy, rewind(old, 'q2'), 'b');
  assert.equal(old.answers.q3, '旧三');
  validateFinal(legacy, old);
  assert.deepEqual(finish(mood(), { q1: '一', q2: 'b', q5: '五' }).activePath, ['q1', 'q2', 'q5']);
  validateDefinition({ ...legacy, routingMode: LEGACY_ROUTING });
  assert.equal(legacy.schemaVersion, 1);
});
