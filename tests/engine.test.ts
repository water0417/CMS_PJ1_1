import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDefinition,
  validateAnswer,
  advance,
  rewind,
  validateFinal,
  nextTarget,
  normalizeAttemptState,
  Definition,
  Question,
  AttemptState,
} from '../apps/api/src/domain';
const q = (type: any = 'single_choice', extra: Partial<Question> = {}): Question => ({
  id: 'q1',
  type,
  title: '测试题',
  description: '',
  required: true,
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  rows: [
    { id: 'r1', label: '行一' },
    { id: 'r2', label: '行二' },
  ],
  validation: {},
  jumpRules: [],
  ...extra,
});
const d = (questions: Question[]): Definition => ({
  title: '测试问卷',
  description: '',
  schemaVersion: 1,
  allowAnonymous: true,
  allowRepeatSubmissions: false,
  questions,
});
const initial = (id = 'q1'): AttemptState => ({
  currentQuestionId: id,
  answers: {},
  activePath: [id],
  transitionCount: 0,
  ready: false,
  revision: 0,
});
test('创建定义：拒绝空问卷、重复ID和非法跳转目标', () => {
  assert.throws(() => validateDefinition(d([])));
  assert.throws(() => validateDefinition(d([q(), q()])));
  assert.throws(() =>
    validateDefinition(
      d([
        q('single_choice', {
          jumpRules: [{ id: 'j', operator: 'eq', value: 'a', target: 'missing' }],
        }),
      ]),
    ),
  );
  validateDefinition(d([q()]));
});
test('添加题目：拒绝倒置范围与超过选项数的多选限制', () => {
  assert.throws(() => validateDefinition(d([q('number', { validation: { min: 20, max: 10 } })])));
  assert.throws(() =>
    validateDefinition(d([q('multiple_choice', { validation: { minSelections: 3 } })])),
  );
});
test('单选跳转、未命中顺序推进以及可选空值不触发规则', () => {
  const a = q('single_choice', {
      jumpRules: [{ id: 'j', operator: 'eq', value: 'a', target: 'q3' }],
    }),
    def = d([a, q('text', { id: 'q2' }), q('text', { id: 'q3' })]);
  assert.equal(advance(def, initial(), 'a').currentQuestionId, 'q3');
  assert.equal(advance(def, initial(), 'b').currentQuestionId, 'q2');
  assert.equal(nextTarget(def, { ...a, required: false }, undefined), 'q2');
});
test('多选规则：any/all/exact 与首条命中', () => {
  const a = q('multiple_choice', {
      jumpRules: [
        { id: 'j1', operator: 'any', value: ['a'], target: 'q2' },
        { id: 'j2', operator: 'all', value: ['a', 'b'], target: 'END' },
      ],
    }),
    def = d([a, q('text', { id: 'q2' })]);
  assert.equal(nextTarget(def, a, ['a', 'b']), 'q2');
  a.jumpRules = [{ id: 'j', operator: 'exact', value: ['a', 'b'], target: 'END' }];
  assert.equal(nextTarget(def, a, ['b', 'a']), 'END');
  assert.equal(nextTarget(def, a, ['a']), 'q2');
});
test('数字规则：闭区间端点和比较', () => {
  const a = q('number', {
      jumpRules: [{ id: 'j', operator: 'between', value: [0, 120], target: 'END' }],
    }),
    def = d([a, q('text', { id: 'q2' })]);
  assert.equal(nextTarget(def, a, 0), 'END');
  assert.equal(nextTarget(def, a, 120), 'END');
  assert.equal(nextTarget(def, a, 121), 'q2');
});
test('循环回跳：清除后续答案、保留目标题答案', () => {
  const def = d([
    q(),
    q('single_choice', {
      id: 'q2',
      jumpRules: [{ id: 'back', operator: 'eq', value: 'b', target: 'q1' }],
    }),
  ]);
  let s = advance(def, initial(), 'a');
  s = advance(def, s, 'b');
  assert.deepEqual(s.activePath, ['q1']);
  assert.deepEqual(s.answers, { q1: 'a' });
  assert.equal(s.transitionCount, 2);
  s = advance(def, s, 'b');
  s = advance(def, s, 'a');
  validateFinal(def, s);
  assert.deepEqual(s.answers, { q1: 'b', q2: 'a' });
});
test('返回修改清除旧分支；跳过必答题不阻止最终提交', () => {
  const def = d([
    q('single_choice', { jumpRules: [{ id: 'j', operator: 'eq', value: 'a', target: 'END' }] }),
    q('text', { id: 'q2' }),
  ]);
  let s = advance(def, initial(), 'b');
  s = advance(def, s, '旧内容');
  s = rewind(s, 'q1');
  assert.equal(s.answers.q2, '旧内容');
  assert.equal(s.ready, true);
  s = advance(def, s, 'a');
  assert.equal(s.answers.q2, undefined);
  validateFinal(def, s);
  assert.deepEqual(s.activePath, ['q1']);
});

const sequential = () => d([q('text'), ...['q2', 'q3', 'q4'].map((id) => q('text', { id }))]);
function complete(def: Definition, values: any[]): AttemptState {
  return values.reduce((s, value) => advance(def, s, value), initial());
}

test('主动返回仅移动查看位置，保留完整路径、答案、结束状态和推进次数', () => {
  const def = sequential(),
    original = complete(def, ['一', '二', '三', '四']);
  const snapshot = JSON.stringify(original),
    review = rewind(original, 'q1');
  assert.deepEqual(review.answers, original.answers);
  assert.deepEqual(review.activePath, original.activePath);
  assert.equal(review.ready, true);
  assert.equal(review.currentQuestionId, 'q1');
  assert.equal(review.navigationMode, 'review');
  assert.equal(review.transitionCount, 4);
  assert.equal(review.revision, original.revision + 1);
  assert.equal(JSON.stringify(original), snapshot);
  validateFinal(def, review);
});

test('普通顺序问卷改答前题，保留全部后续答案并直接恢复结束状态', () => {
  const def = sequential();
  let s = complete(def, ['一', '二', '三', '四']);
  s = advance(def, rewind(s, 'q1'), '改答');
  assert.deepEqual(s.answers, { q1: '改答', q2: '二', q3: '三', q4: '四' });
  assert.deepEqual(s.activePath, ['q1', 'q2', 'q3', 'q4']);
  assert.equal(s.ready, true);
  assert.equal(s.transitionCount, 5);
  validateFinal(def, s);
});

test('改答仍命中相同条件目标题，不误把已在路径中的后继当成循环', () => {
  const def = d([
    q('number', { jumpRules: [{ id: 'j', operator: 'gte', value: 10, target: 'q3' }] }),
    q('text', { id: 'q2' }),
    q('text', { id: 'q3' }),
    q('text', { id: 'q4' }),
  ]);
  let s = complete(def, [15, '三', '四']);
  s = advance(def, rewind(s, 'q1'), 20);
  assert.deepEqual(s.answers, { q1: 20, q3: '三', q4: '四' });
  assert.equal(s.ready, true);
  validateFinal(def, s);
});

test('Q1从顺序分支改成跳Q4：只清除Q2/Q3，保留Q4', () => {
  const def = d([
    q('single_choice', { jumpRules: [{ id: 'j', operator: 'eq', value: 'b', target: 'q4' }] }),
    ...['q2', 'q3', 'q4'].map((id) => q('text', { id })),
  ]);
  let s = complete(def, ['a', '二', '三', '四']);
  s = advance(def, rewind(s, 'q1'), 'b');
  assert.deepEqual(s.activePath, ['q1', 'q4']);
  assert.deepEqual(s.answers, { q1: 'b', q4: '四' });
  assert.deepEqual(s.pendingAnswers, {});
  validateFinal(def, s);
});

function newBranchDefinition() {
  return d([
    q('single_choice', { jumpRules: [{ id: 'j', operator: 'eq', value: 'a', target: 'q4' }] }),
    q('single_choice', {
      id: 'q2',
      jumpRules: [{ id: 'j2', operator: 'eq', value: 'b', target: 'END' }],
    }),
    q('text', { id: 'q3' }),
    q('text', { id: 'q4' }),
  ]);
}

test('改答进入未答分支，必须补答；重合尾部答案隔离保留并在汇合时恢复', () => {
  const def = newBranchDefinition();
  let s = complete(def, ['a', '四']);
  s = advance(def, rewind(s, 'q1'), 'b');
  assert.equal(s.currentQuestionId, 'q2');
  assert.equal(s.ready, false);
  assert.deepEqual(s.answers, { q1: 'b' });
  assert.deepEqual(s.pendingAnswers, { q4: '四' });
  assert.throws(() => validateFinal(def, s));
  assert.throws(() => advance(def, s, null));
  s = advance(def, s, 'a');
  assert.equal(s.currentQuestionId, 'q3');
  assert.equal(s.ready, false);
  assert.deepEqual(s.pendingAnswers, { q4: '四' });
  s = advance(def, s, '三');
  assert.equal(s.ready, true);
  assert.deepEqual(s.answers, { q1: 'b', q2: 'a', q3: '三', q4: '四' });
  validateFinal(def, s);
});

test('新分支选择直接结束后，清除未汇合的候选答案', () => {
  const def = newBranchDefinition();
  let s = complete(def, ['a', '四']);
  s = advance(def, rewind(s, 'q1'), 'b');
  s = advance(def, s, 'b');
  assert.deepEqual(s.answers, { q1: 'b', q2: 'b' });
  assert.deepEqual(s.pendingAnswers, {});
  assert.deepEqual(s.activePath, ['q1', 'q2']);
  validateFinal(def, s);
});

test('后续已保存答案继续决定分支，重算不会只看改答题的一个目标', () => {
  const def = d([
    q('single_choice', { jumpRules: [{ id: 'j', operator: 'eq', value: 'b', target: 'q3' }] }),
    q('text', { id: 'q2' }),
    q('single_choice', {
      id: 'q3',
      jumpRules: [{ id: 'j3', operator: 'eq', value: 'b', target: 'q5' }],
    }),
    q('text', { id: 'q4' }),
    q('text', { id: 'q5' }),
  ]);
  let s = complete(def, ['a', '二', 'b', '五']);
  s = advance(def, rewind(s, 'q1'), 'b');
  assert.deepEqual(s.activePath, ['q1', 'q3', 'q5']);
  assert.deepEqual(s.answers, { q1: 'b', q3: 'b', q5: '五' });
  validateFinal(def, s);
});

test('可选题已明确跳过与从未回答分开记录，改答不会丢失跳过确认', () => {
  const def = d([q('text'), q('text', { id: 'q2', required: false }), q('text', { id: 'q3' })]);
  let s = complete(def, ['一', null, '三']);
  s = advance(def, rewind(s, 'q1'), '改答');
  assert.equal(s.ready, true);
  assert.ok(s.confirmedQuestionIds!.includes('q2'));
  assert.equal(Object.hasOwn(s.answers, 'q2'), false);
  validateFinal(def, s);
});

test('旧记录无新增字段仍能恢复，返回和改答不破坏已跳过可选题', () => {
  const def = d([q('text'), q('text', { id: 'q2', required: false })]);
  const legacy: AttemptState = {
    currentQuestionId: 'END',
    answers: { q1: '一' },
    activePath: ['q1', 'q2'],
    transitionCount: 2,
    ready: true,
    revision: 2,
  };
  let s = advance(def, rewind(legacy, 'q1'), '新答案');
  assert.equal(s.ready, true);
  validateFinal(def, s);
  const partial = { ...legacy, currentQuestionId: 'q2', ready: false };
  assert.deepEqual(normalizeAttemptState(partial).confirmedQuestionIds, ['q1']);
});

test('进行中返回查看不损失末端；改答不变时继续停在未答题', () => {
  const def = sequential();
  let s = advance(def, initial(), '一');
  s = advance(def, s, '二');
  const view = rewind(s, 'q1');
  assert.equal(view.ready, false);
  assert.deepEqual(view.activePath, ['q1', 'q2', 'q3']);
  s = advance(def, view, '改答');
  assert.equal(s.currentQuestionId, 'q3');
  assert.deepEqual(s.answers, { q1: '改答', q2: '二' });
});

test('真正的条件回跳在主动改答后仍截断，目标题保留但必须重新确认', () => {
  const def = d([
    q('text'),
    q('text', { id: 'q2' }),
    q('single_choice', {
      id: 'q3',
      jumpRules: [{ id: 'loop', operator: 'eq', value: 'b', target: 'q2' }],
    }),
    q('text', { id: 'q4' }),
  ]);
  let s = complete(def, ['一', '二', 'a', '四']);
  s = advance(def, rewind(s, 'q3'), 'b');
  assert.deepEqual(s.activePath, ['q1', 'q2']);
  assert.deepEqual(s.answers, { q1: '一', q2: '二' });
  assert.equal(s.ready, false);
  assert.equal(s.navigationMode, 'answer');
  assert.deepEqual(s.confirmedQuestionIds, ['q1']);
  assert.deepEqual(s.pendingAnswers, {});
  assert.equal(s.currentQuestionId, 'q2');
  assert.equal(s.transitionCount, 5);
});

test('重放保留答案发现循环也截断，不能自动绕过循环生成结束状态', () => {
  const def = d([
    q('single_choice', { jumpRules: [{ id: 'j', operator: 'eq', value: 'a', target: 'q3' }] }),
    q('single_choice', {
      id: 'q2',
      jumpRules: [{ id: 'j2', operator: 'eq', value: 'b', target: 'q1' }],
    }),
    q('text', { id: 'q3' }),
  ]);
  let s = complete(def, ['a', '三']);
  s = advance(def, rewind(s, 'q1'), 'b');
  assert.equal(s.currentQuestionId, 'q2');
  s = advance(def, s, 'b');
  assert.deepEqual(s.activePath, ['q1']);
  assert.deepEqual(s.answers, { q1: 'b' });
  assert.deepEqual(s.pendingAnswers, {});
});

test('主动返回不重置200次计数，查看已完成路径仍可提交，改答确认仍受上限约束', () => {
  const def = sequential();
  const completed = { ...complete(def, ['一', '二', '三', '四']), transitionCount: 200 };
  const view = rewind(rewind(completed, 'q3'), 'q1');
  assert.equal(view.transitionCount, 200);
  assert.throws(() => advance(def, view, '改答'));
  validateFinal(def, view);
});

test('保留答案重新检查题型合法性，非法后续值不能自动完成', () => {
  const def = d([
    q('text'),
    q('number', { id: 'q2', validation: { min: 0, max: 10 } }),
    q('text', { id: 'q3' }),
  ]);
  let s = complete(def, ['一', 5, '三']);
  s = { ...s, answers: { ...s.answers, q2: 20 } };
  s = advance(def, rewind(s, 'q1'), '改答');
  assert.equal(s.ready, false);
  assert.equal(s.currentQuestionId, 'q2');
  assert.equal(s.answers.q2, undefined);
  assert.deepEqual(s.pendingAnswers, { q3: '三' });
  assert.throws(() => validateFinal(def, s));
});

test('最终校验拒绝伪造结束、未确认题目、隔离候选答案和错误查看位置', () => {
  const def = sequential(),
    s = complete(def, ['一', '二', '三', '四']);
  assert.throws(() => validateFinal(def, { ...s, confirmedQuestionIds: ['q1'] }));
  assert.throws(() => validateFinal(def, { ...s, pendingAnswers: { x: '候选' } }));
  assert.throws(() => validateFinal(def, { ...s, pendingConfirmedQuestionIds: ['x'] }));
  assert.throws(() =>
    validateFinal(def, { ...s, currentQuestionId: 'bad', navigationMode: 'review' }),
  );
  assert.throws(() => rewind(s, 'bad'));
});
test('第200次到达结束可提交；未结束则禁止第201次', () => {
  const def = d([q()]);
  let s = advance(def, { ...initial(), transitionCount: 199 }, 'a');
  assert.equal(s.transitionCount, 200);
  validateFinal(def, s);
  assert.throws(() => advance(def, { ...initial(), transitionCount: 200 }, 'a'));
  const loop = d([
    q('single_choice', { jumpRules: [{ id: 'j', operator: 'eq', value: 'a', target: 'q1' }] }),
  ]);
  s = advance(loop, { ...initial(), transitionCount: 199 }, 'a');
  assert.equal(s.ready, false);
  assert.throws(() => advance(loop, s, 'b'));
});
test('必答、多选重复和数量校验', () => {
  assert.throws(() => validateAnswer(q(), null));
  const a = q('multiple_choice', { validation: { minSelections: 2, maxSelections: 2 } });
  assert.throws(() => validateAnswer(a, ['a', 'a']));
  assert.throws(() => validateAnswer(a, ['a']));
  assert.deepEqual(validateAnswer(a, ['a', 'b']), ['a', 'b']);
  assert.equal(validateAnswer({ ...a, required: false }, []), undefined);
});
test('文本长度、Unicode码点和手机号', () => {
  assert.equal(
    validateAnswer(q('text', { validation: { minLength: 1, maxLength: 1 } }), ' 😀 '),
    '😀',
  );
  assert.throws(() => validateAnswer(q('text', { validation: { maxLength: 1 } }), '中文'));
  const a = q('text', { validation: { format: 'phone_cn_mobile' } });
  assert.equal(validateAnswer(a, '13800138000'), '13800138000');
  assert.throws(() => validateAnswer(a, '0123'));
});
test('数字范围、整数、非数字与非有限数', () => {
  const a = q('number', { validation: { min: 0, max: 120, integerOnly: true } });
  for (const value of [-1, 121, 1.5, NaN, Infinity, '12'])
    assert.throws(() => validateAnswer(a, value));
  assert.equal(validateAnswer(a, 0), 0);
  assert.equal(validateAnswer(a, 120), 120);
});
test('矩阵：必答各行、未知行、选项合法性', () => {
  const a = q('matrix');
  assert.throws(() => validateAnswer(a, { r1: 'a' }));
  assert.throws(() => validateAnswer(a, { r1: 'a', r2: 'b', bad: 'a' }));
  assert.deepEqual(validateAnswer(a, { r1: 'a', r2: 'b' }), { r1: 'a', r2: 'b' });
  assert.deepEqual(validateAnswer({ ...a, required: false }, { r1: 'a' }), { r1: 'a' });
});
test('排序：完整、唯一且不接受未确认默认值', () => {
  const a = q('ranking');
  assert.throws(() => validateAnswer(a, undefined));
  assert.throws(() => validateAnswer(a, ['a']));
  assert.throws(() => validateAnswer(a, ['a', 'a']));
  assert.deepEqual(validateAnswer(a, ['b', 'a']), ['b', 'a']);
});
test('时间：无效日期、时刻边界、UTC日期时间', () => {
  const a = q('time', {
    validation: { mode: 'date', earliest: '2024-01-01', latest: '2024-12-31' },
  });
  assert.equal(validateAnswer(a, '2024-02-29'), '2024-02-29');
  assert.throws(() => validateAnswer(a, '2024-02-30'));
  assert.throws(() => validateAnswer(a, '2023-01-01'));
  assert.throws(() => validateAnswer(q('time', { validation: { mode: 'time' } }), '24:00'));
  assert.equal(
    validateAnswer(q('time', { validation: { mode: 'datetime' } }), '2026-10-22T02:00:00.000Z'),
    '2026-10-22T02:00:00.000Z',
  );
});
test('滑动评分：未确认、步长、上下限', () => {
  const a = q('slider', { validation: { min: 0, max: 10, step: 2 } });
  assert.throws(() => validateAnswer(a, null));
  assert.throws(() => validateAnswer(a, 3));
  assert.throws(() => validateAnswer(a, 12));
  assert.equal(validateAnswer(a, 8), 8);
});
test('颜色标准化及格式拒绝', () => {
  assert.equal(validateAnswer(q('color'), '#aabbcc'), '#AABBCC');
  for (const value of ['red', '#abc', '#aabbccdd'])
    assert.throws(() => validateAnswer(q('color'), value));
});
test('最终校验拒绝客户端伪造路径与分支答案', () => {
  const def = d([q(), q('text', { id: 'q2' })]);
  assert.throws(() =>
    validateFinal(def, {
      ...initial(),
      ready: true,
      currentQuestionId: 'END',
      answers: { q1: 'a' },
    }),
  );
  let s = advance(def, initial(), 'a');
  s = advance(def, s, 'ok');
  assert.throws(() => validateFinal(def, { ...s, answers: { ...s.answers, bad: 'x' } }));
});
