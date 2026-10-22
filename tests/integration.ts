import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
const dbName = 'survey_studio_test_' + Date.now(),
  port = 3101,
  base = `http://127.0.0.1:${port}/api`;
const uri = (
  process.env.TEST_MONGODB_URI ??
  'mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true'
).replace(/\/[^/?]+(?=\?|$)/, '/' + dbName);
const results: Array<{ name: string; result: string }> = [];
let logs = '';
const server = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.resolve('apps/api'),
  env: { ...process.env, PORT: String(port), MONGODB_URI: uri },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => (logs += d));
server.stderr.on('data', (d) => (logs += d));
class Client {
  cookie = '';
  async request(url: string, method = 'GET', body?: any, expected = 200) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    assert.equal(res.status, expected, `${method} ${url}: ${JSON.stringify(data)}`);
    const c = res.headers.get('set-cookie');
    if (c) this.cookie = c.split(';')[0];
    return data;
  }
}
const owner = new Client(),
  writer = new Client(),
  other = new Client();
const q = (id: string, type: string, validation: any = {}, extra: any = {}) => ({
  id,
  type,
  title: id + ' 测试题',
  description: '',
  required: true,
  options: [
    { id: 'a', label: '选项A' },
    { id: 'b', label: '选项B' },
  ],
  rows: [
    { id: 'r1', label: '行1' },
    { id: 'r2', label: '行2' },
  ],
  validation,
  jumpRules: [],
  ...extra,
});
const definition = (questions: any[], repeat = false) => ({
  title: '九题型验收',
  description: '自动测试专用',
  schemaVersion: 1,
  allowAnonymous: true,
  allowRepeatSubmissions: repeat,
  questions,
});
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  results.push({ name, result: 'PASS' });
  console.log('PASS ' + name);
}
async function account(c: Client, name: string) {
  await c.request('/auth/register', 'POST', { username: name, password: 'TestPass123!' }, 201);
  await c.request('/auth/login', 'POST', { username: name, password: 'TestPass123!' }, 201);
}
async function publish(def: any) {
  let s = await owner.request('/surveys', 'POST', { title: def.title }, 201);
  // Historical fixtures simulate drafts created before routingMode existed, only in this test DB.
  if (def.routingMode === undefined)
    await mongoose.connection
      .db!.collection('surveys')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(s._id) },
        { $unset: { 'draft.routingMode': 1 } },
      );
  s = await owner.request('/surveys/' + s._id + '/draft', 'PUT', { definition: def, revision: 0 });
  return owner.request(
    '/surveys/' + s._id + '/publish',
    'POST',
    { revision: s.revision, deadlineAt: null },
    201,
  );
}
async function begin(s: any, c = writer, anonymous = true) {
  return c.request('/public/surveys/' + s.publicId + '/attempts', 'POST', { anonymous }, 201);
}
async function advance(c: Client, a: any, answer: any, expected = 201) {
  return c.request(
    '/attempts/' + a.id + '/advance',
    'POST',
    { revision: a.state.revision, answer },
    expected,
  );
}
async function submit(c: Client, a: any, expected = 201) {
  return c.request(
    '/attempts/' + a.id + '/submit',
    'POST',
    { revision: a.state.revision },
    expected,
  );
}
async function back(c: Client, a: any, questionId: string, expected = 201) {
  return c.request(
    '/attempts/' + a.id + '/back',
    'POST',
    { revision: a.state.revision, questionId },
    expected,
  );
}
const BRANCH = 'exclusive-branches-v1';
const branchDefinition = (questions: any[]) => ({
  ...definition(questions, true),
  routingMode: BRANCH,
});
const jump = (id: string, value: any, target: string, operator = 'eq') => ({
  id,
  value,
  target,
  operator,
});
const branchMood = () => [
  q('q1', 'text'),
  q(
    'q2',
    'single_choice',
    {},
    {
      options: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase() })),
      jumpRules: [jump('a', 'a', 'q3'), jump('c', 'c', 'q4'), jump('d', 'd', 'q4')],
    },
  ),
  q('q3', 'text'),
  q('q4', 'text'),
  q('q5', 'number'),
];
async function fillSaved(a: any, values: Record<string, any>) {
  for (let i = 0; !a.state.ready && i < 20; i++)
    a = await advance(writer, a, values[a.state.currentQuestionId]);
  assert.equal(a.state.ready, true);
  return a;
}
async function main() {
  try {
    let ready = false;
    for (let i = 0; i < 300; i++) {
      try {
        const r = await fetch(base + '/health');
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!ready) throw new Error('API未启动：' + logs);
    await mongoose.connect(uri);
    const db = mongoose.connection.db!;
    await check('注册、登录、密码错误、匿名访问拦截', async () => {
      await account(owner, 'owner');
      await account(writer, 'writer');
      await account(other, 'other');
      await new Client().request('/surveys', 'GET', undefined, 401);
      await new Client().request(
        '/auth/login',
        'POST',
        { username: 'owner', password: 'bad' },
        401,
      );
      await owner.request(
        '/auth/register',
        'POST',
        { username: 'OWNER', password: 'TestPass123!' },
        400,
      );
    });
    let survey: any, attempt: any;
    const qs = [
      q('q1', 'single_choice'),
      q('q2', 'multiple_choice', { minSelections: 2, maxSelections: 2 }),
      q('q3', 'text', { format: 'phone_cn_mobile' }),
      q('q4', 'number', { min: 0, max: 120, integerOnly: true }),
      q('q5', 'matrix'),
      q('q6', 'ranking'),
      q('q7', 'time', { mode: 'datetime' }),
      q('q8', 'slider', { min: 0, max: 10, step: 2 }),
      q('q9', 'color'),
    ];
    await check('创建问卷、添加九种题型、发布和越权拦截', async () => {
      survey = await publish(definition(qs));
      assert.equal(survey.status, 'published');
      await writer.request('/surveys/' + survey._id, 'GET', undefined, 404);
      await writer.request('/surveys/' + survey._id + '/statistics', 'GET', undefined, 404);
      await owner.request(
        '/surveys/' + survey._id + '/draft',
        'PUT',
        { definition: definition(qs), revision: survey.revision },
        409,
      );
      const list = await writer.request('/surveys');
      assert.equal(list.length, 0);
    });
    await check('填写保存恢复、旧页面冲突及全部题型校验', async () => {
      attempt = await begin(survey);
      await advance(writer, attempt, 'unknown', 400);
      await other.request('/attempts/' + attempt.id, 'GET', undefined, 404);
      const old = attempt;
      attempt = await advance(writer, attempt, 'a');
      await advance(writer, old, 'a', 409);
      await advance(writer, attempt, ['a'], 400);
      attempt = await advance(writer, attempt, ['a', 'b']);
      await advance(writer, attempt, '123', 400);
      attempt = await advance(writer, attempt, '13800138000');
      await advance(writer, attempt, 121, 400);
      attempt = await advance(writer, attempt, 20);
      await advance(writer, attempt, { r1: 'a' }, 400);
      attempt = await advance(writer, attempt, { r1: 'a', r2: 'b' });
      await advance(writer, attempt, ['a'], 400);
      attempt = await advance(writer, attempt, ['b', 'a']);
      await advance(writer, attempt, 'not-time', 400);
      attempt = await advance(writer, attempt, '2026-10-22T02:00:00.000Z');
      await advance(writer, attempt, 3, 400);
      attempt = await advance(writer, attempt, 8);
      await advance(writer, attempt, 'red', 400);
      attempt = await advance(writer, attempt, '#aabbcc');
      assert.equal(attempt.state.ready, true);
      const restored = await writer.request('/attempts/' + attempt.id);
      assert.equal(restored.state.answers.q9, '#AABBCC');
    });
    await check('匿名事务提交、网络重试幂等、禁止重复填写', async () => {
      const r = await submit(writer, attempt);
      const again = await submit(writer, attempt);
      assert.equal(again.id, r.id);
      const identity = await writer.request('/auth/me');
      const forged = new Client();
      forged.cookie = 'survey_session=receipt:' + attempt.id + ':' + identity.id;
      await forged.request('/auth/me', 'GET', undefined, 401);
      await beginDenied();
      const stored = await db.collection('responses').findOne({ attemptId: attempt.id });
      assert.equal(stored!.respondentId, undefined);
      const a = await db
        .collection('response_attempts')
        .findOne({ _id: new mongoose.Types.ObjectId(attempt.id) });
      assert.equal(a!.userId, undefined);
      assert.equal(await db.collection('responses').countDocuments({ surveyId: survey._id }), 1);
    });
    async function beginDenied() {
      await writer.request(
        '/public/surveys/' + survey.publicId + '/attempts',
        'POST',
        { anonymous: true },
        409,
      );
    }
    await check('统计：选项计数、平均值、矩阵、排序和内容分页', async () => {
      const s = await owner.request('/surveys/' + survey._id + '/statistics');
      assert.equal(s.total, 1);
      assert.equal(s.questions[0].distribution[0].count, 1);
      assert.equal(s.questions[3].numeric.average, 20);
      assert.equal(s.questions[4].matrix.length, 2);
      assert.equal(s.questions[5].ranking[0]._id, 'b');
      assert.equal(s.questions[7].numeric.average, 8);
      const p = await owner.request(`/surveys/${survey._id}/questions/q3/answers?page=1`);
      assert.equal(p.rows[0].value, '13800138000');
      assert.equal(p.rows[0].respondentId, undefined);
      const single = await owner.request(`/surveys/${survey._id}/questions/q4/statistics`);
      assert.equal(single.questions.length, 1);
    });
    await check('向前循环清除答案、改答后退出、重复允许', async () => {
      const s = await publish(
        definition(
          [
            q('q1', 'single_choice'),
            q(
              'q2',
              'single_choice',
              {},
              { jumpRules: [{ id: 'j', operator: 'eq', value: 'b', target: 'q1' }] },
            ),
          ],
          true,
        ),
      );
      let a = await begin(s);
      a = await advance(writer, a, 'a');
      a = await advance(writer, a, 'b');
      assert.deepEqual(a.state.answers, { q1: 'a' });
      a = await advance(writer, a, 'b');
      a = await advance(writer, a, 'a');
      await submit(writer, a);
      a = await begin(s);
      a = await advance(writer, a, 'a');
      a = await advance(writer, a, 'a');
      await submit(writer, a);
      assert.equal((await owner.request('/surveys/' + s._id + '/statistics')).total, 2);
    });
    await check('单选、多选、数字配置跳转及首条优先', async () => {
      const s = await publish(
        definition(
          [
            q(
              'q1',
              'single_choice',
              {},
              { jumpRules: [{ id: 'j', operator: 'eq', value: 'a', target: 'q3' }] },
            ),
            q('q2', 'text'),
            q(
              'q3',
              'multiple_choice',
              {},
              {
                jumpRules: [
                  { id: 'j1', operator: 'any', value: ['a'], target: 'q5' },
                  { id: 'j2', operator: 'all', value: ['a', 'b'], target: 'END' },
                ],
              },
            ),
            q('q4', 'text'),
            q(
              'q5',
              'number',
              {},
              { jumpRules: [{ id: 'j', operator: 'gte', value: 18, target: 'END' }] },
            ),
            q('q6', 'text'),
          ],
          true,
        ),
      );
      let a = await begin(s);
      a = await advance(writer, a, 'a');
      assert.equal(a.state.currentQuestionId, 'q3');
      a = await advance(writer, a, ['a', 'b']);
      assert.equal(a.state.currentQuestionId, 'q5');
      a = await advance(writer, a, 18);
      assert.equal(a.state.ready, true);
      await submit(writer, a);
    });
    await check('主动返回保留完成状态，普通改答保留后续答案，权限及乐观锁不变', async () => {
      const s = await publish(
        definition(
          [q('q1', 'single_choice'), q('q2', 'text'), q('q3', 'text'), q('q4', 'number')],
          true,
        ),
      );
      let a = await begin(s);
      for (const answer of ['a', '二', '三', 20]) a = await advance(writer, a, answer);
      const before = structuredClone(a);
      a = await back(writer, a, 'q1');
      assert.equal(a.state.ready, true);
      assert.equal(a.state.currentQuestionId, 'q1');
      assert.equal(a.state.navigationMode, 'review');
      assert.deepEqual(a.state.answers, before.state.answers);
      assert.deepEqual(a.state.activePath, before.state.activePath);
      assert.equal(a.state.transitionCount, 4);
      await back(writer, before, 'q2', 409);
      await back(other, a, 'q2', 404);
      const read = await writer.request('/attempts/' + a.id);
      assert.deepEqual(read.state, a.state);
      a = await advance(writer, a, 'b');
      assert.equal(a.state.ready, true);
      assert.deepEqual(a.state.answers, { q1: 'b', q2: '二', q3: '三', q4: 20 });
      await submit(writer, a);
      const stats = await owner.request('/surveys/' + s._id + '/statistics');
      assert.equal(stats.questions[3].numeric.average, 20);
      assert.equal(stats.questions[1].answerCount, 1);
    });
    await check('分支改答只删除失效题，保留汇合题且统计排除旧分支', async () => {
      const s = await publish(
        definition(
          [
            q(
              'q1',
              'single_choice',
              {},
              { jumpRules: [{ id: 'j', operator: 'eq', value: 'b', target: 'q4' }] },
            ),
            q('q2', 'text'),
            q('q3', 'text'),
            q('q4', 'number'),
          ],
          true,
        ),
      );
      let a = await begin(s);
      for (const value of ['a', '失效二', '失效三', 30]) a = await advance(writer, a, value);
      a = await advance(writer, await back(writer, a, 'q1'), 'b');
      assert.deepEqual(a.state.activePath, ['q1', 'q4']);
      assert.deepEqual(a.state.answers, { q1: 'b', q4: 30 });
      await submit(writer, a);
      const stored = await db.collection('responses').findOne({ attemptId: a.id });
      assert.deepEqual(stored!.answers, { q1: 'b', q4: 30 });
      const stats = await owner.request('/surveys/' + s._id + '/statistics');
      assert.equal(stats.questions[1].answerCount, 0);
      assert.equal(stats.questions[2].answerCount, 0);
      assert.equal(stats.questions[3].numeric.average, 30);
    });
    await check('新分支未完成拒绝提交，候选尾部隔离，补答后恢复并提交', async () => {
      const s = await publish(
        definition(
          [
            q(
              'q1',
              'single_choice',
              {},
              { jumpRules: [{ id: 'j', operator: 'eq', value: 'a', target: 'q4' }] },
            ),
            q(
              'q2',
              'single_choice',
              {},
              { jumpRules: [{ id: 'j2', operator: 'eq', value: 'b', target: 'END' }] },
            ),
            q('q3', 'text'),
            q('q4', 'number'),
          ],
          true,
        ),
      );
      let a = await begin(s);
      a = await advance(writer, a, 'a');
      a = await advance(writer, a, 40);
      a = await advance(writer, await back(writer, a, 'q1'), 'b');
      assert.equal(a.state.currentQuestionId, 'q2');
      assert.equal(a.state.ready, false);
      assert.deepEqual(a.state.pendingAnswers, { q4: 40 });
      assert.equal(a.state.answers.q4, undefined);
      await submit(writer, a, 400);
      await advance(writer, a, null, 400);
      a = await advance(writer, a, 'a');
      await submit(writer, a, 400);
      a = await advance(writer, a, '新三');
      assert.equal(a.state.ready, true);
      assert.equal(a.state.answers.q4, 40);
      assert.deepEqual(a.state.pendingAnswers, {});
      await submit(writer, a);
      assert.equal(
        (await owner.request('/surveys/' + s._id + '/statistics')).questions[3].numeric.average,
        40,
      );
      let b = await begin(s);
      b = await advance(writer, b, 'a');
      b = await advance(writer, b, 99);
      b = await advance(writer, await back(writer, b, 'q1'), 'b');
      b = await advance(writer, b, 'b');
      assert.deepEqual(b.state.answers, { q1: 'b', q2: 'b' });
      assert.deepEqual(b.state.pendingAnswers, {});
      await submit(writer, b);
      const stats = await owner.request('/surveys/' + s._id + '/statistics');
      assert.equal(stats.total, 2);
      assert.equal(stats.questions[3].answerCount, 1);
    });
    await check('旧填写状态懒兼容、可选跳过保留、查看状态可以幂等提交', async () => {
      const s = await publish(
        definition([q('q1', 'text'), q('q2', 'text', {}, { required: false })], true),
      );
      let a = await begin(s);
      a = await advance(writer, a, '旧数据');
      a = await advance(writer, a, null);
      await db.collection('response_attempts').updateOne(
        { _id: new mongoose.Types.ObjectId(a.id) },
        {
          $unset: {
            'state.navigationMode': 1,
            'state.confirmedQuestionIds': 1,
            'state.pendingAnswers': 1,
            'state.pendingConfirmedQuestionIds': 1,
          },
        },
      );
      a = await writer.request('/attempts/' + a.id);
      assert.deepEqual(a.state.confirmedQuestionIds, ['q1', 'q2']);
      a = await back(writer, a, 'q1');
      assert.equal(a.state.ready, true);
      const r = await submit(writer, a);
      assert.equal((await submit(writer, a)).id, r.id);
    });
    await check('实际回跳仍截断，主动查看不能重置200次推进限制', async () => {
      const s = await publish(
        definition(
          [
            q('q1', 'text'),
            q('q2', 'text'),
            q(
              'q3',
              'single_choice',
              {},
              { jumpRules: [{ id: 'j', operator: 'eq', value: 'b', target: 'q2' }] },
            ),
            q('q4', 'text'),
          ],
          true,
        ),
      );
      let a = await begin(s);
      for (const value of ['一', '二', 'a', '四']) a = await advance(writer, a, value);
      a = await advance(writer, await back(writer, a, 'q3'), 'b');
      assert.deepEqual(a.state.activePath, ['q1', 'q2']);
      assert.deepEqual(a.state.answers, { q1: '一', q2: '二' });
      assert.equal(a.state.ready, false);
      assert.equal(a.state.transitionCount, 5);
      await db
        .collection('response_attempts')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(a.id) },
          { $set: { 'state.transitionCount': 200 } },
        );
      a = await writer.request('/attempts/' + a.id);
      a = await back(writer, a, 'q1');
      assert.equal(a.state.transitionCount, 200);
      await advance(writer, a, '改答', 400);
      await submit(writer, a, 400);
    });
    await check('并发独立填写仅一份提交成功，失败事务无残留', async () => {
      const s = await publish(definition([q('q1', 'single_choice')]));
      let a = await begin(s),
        b = await begin(s);
      a = await advance(writer, a, 'a');
      b = await advance(writer, b, 'b');
      const requests = [a, b].map((x) =>
        fetch(base + '/attempts/' + x.id + '/submit', {
          method: 'POST',
          headers: { Cookie: writer.cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: x.state.revision }),
        }),
      );
      const rs = await Promise.all(requests);
      assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
      assert.equal(await db.collection('responses').countDocuments({ surveyId: s._id }), 1);
      assert.equal(await db.collection('submission_claims').countDocuments({ surveyId: s._id }), 1);
    });
    await check('关闭和截止后拒绝提交，问卷归属保护', async () => {
      const s = await publish(definition([q('q1', 'single_choice')], true));
      let a = await begin(s);
      a = await advance(writer, a, 'a');
      await owner.request('/surveys/' + s._id + '/close', 'POST', {}, 201);
      await submit(writer, a, 409);
      const t = await publish(definition([q('q1', 'single_choice')], true));
      let b = await begin(t);
      b = await advance(writer, b, 'a');
      await db
        .collection('surveys')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(t._id) },
          { $set: { deadlineAt: new Date(Date.now() - 1000) } },
        );
      await submit(writer, b, 409);
    });
    await check('MongoDB集合验证拒绝绕过API的非法数据', async () => {
      await assert.rejects(db.collection('responses').insertOne({ surveyId: survey._id }));
      const indexes = await db.collection('submission_claims').indexes();
      assert.ok(indexes.some((i) => i.unique && i.key.surveyId && i.key.userId));
    });
    let branchSurvey: any;
    await check('新建默认分支模式，旧编辑器省略字段仍保留模式，分类按全部规则提供', async () => {
      const s = await owner.request('/surveys', 'POST', { title: '默认模式' }, 201);
      assert.equal(s.draft.routingMode, BRANCH);
      const saved = await owner.request('/surveys/' + s._id + '/draft', 'PUT', {
        definition: definition(branchMood(), true),
        revision: 0,
      });
      assert.equal(saved.draft.routingMode, BRANCH);
      branchSurvey = await owner.request(
        '/surveys/' + s._id + '/publish',
        'POST',
        { revision: saved.revision, deadlineAt: null },
        201,
      );
      const meta = await owner.request('/surveys/' + s._id + '/routing');
      assert.equal(meta.routingMode, BRANCH);
      assert.deepEqual(meta.branchQuestionIds, ['q3', 'q4']);
      assert.deepEqual(meta.generalQuestionIds, ['q1', 'q2', 'q5']);
      assert.equal(meta.entryQuestionId, 'q1');
      assert.equal(meta.questions[3].referencedBy.length, 2);
      assert.equal(meta.questions[2].canEnterSequentially, false);
      await writer.request('/surveys/' + s._id + '/routing', 'GET', undefined, 404);
      const pub = await writer.request('/public/surveys/' + branchSurvey.publicId);
      assert.deepEqual(pub.routing, meta);
    });
    await check('新机制A/B/C/D四路线、未访问分支必答不校验、答卷和统计排除分支', async () => {
      const before = await db
        .collection('survey_versions')
        .findOne({ _id: new mongoose.Types.ObjectId(branchSurvey.publishedVersionId) });
      for (const [choice, path, value] of [
        ['a', ['q1', 'q2', 'q3', 'q5'], 10],
        ['b', ['q1', 'q2', 'q5'], 20],
        ['c', ['q1', 'q2', 'q4', 'q5'], 30],
        ['d', ['q1', 'q2', 'q4', 'q5'], 40],
      ] as any[]) {
        let a = await begin(branchSurvey);
        assert.equal(a.routing.routingMode, BRANCH);
        assert.equal(a.state.currentQuestionId, 'q1');
        a = await fillSaved(a, { q1: '一', q2: choice, q3: '快乐', q4: '原因', q5: value });
        assert.deepEqual(a.state.activePath, path);
        assert.equal(a.state.transitionCount, path.length);
        await submit(writer, a);
        const stored = await db.collection('responses').findOne({ attemptId: a.id });
        for (const id of ['q3', 'q4'].filter((id) => !path.includes(id)))
          assert.equal(stored!.answers[id], undefined);
      }
      const stats = await owner.request('/surveys/' + branchSurvey._id + '/statistics');
      assert.equal(stats.total, 4);
      assert.equal(stats.questions[2].answerCount, 1);
      assert.equal(stats.questions[3].answerCount, 2);
      assert.equal(stats.questions[4].numeric.average, 25);
      assert.deepEqual(
        await db.collection('survey_versions').findOne({ _id: before!._id }),
        before,
      );
      assert.equal(before!.schemaVersion, 1);
    });
    await check('连续分支不成题组、尾部分支自动跳过、共享分支和显式连续跳转', async () => {
      for (const chain of [false, true]) {
        const s = await publish(
          branchDefinition([
            q(
              'q1',
              'single_choice',
              {},
              { jumpRules: [jump('a', 'a', 'q2'), jump('b', 'b', 'q3')] },
            ),
            q('q2', 'single_choice', {}, { jumpRules: chain ? [jump('chain', 'a', 'q3')] : [] }),
            q('q3', 'text'),
            q('q4', 'text'),
          ]),
        );
        let a = await fillSaved(await begin(s), { q1: 'a', q2: 'a', q3: '三', q4: '四' });
        assert.deepEqual(a.state.activePath, chain ? ['q1', 'q2', 'q3', 'q4'] : ['q1', 'q2', 'q4']);
        await submit(writer, a);
      }
      const tail = await publish(
        branchDefinition([
          q('q1', 'single_choice', {}, { jumpRules: [jump('a', 'a', 'q2'), jump('b', 'b', 'q3')] }),
          q('q2', 'text'),
          q('q3', 'text'),
        ]),
      );
      let a = await begin(tail);
      a = await advance(writer, a, 'a');
      a = await advance(writer, a, '二');
      assert.equal(a.state.ready, true);
      assert.equal(a.state.transitionCount, 2);
      await submit(writer, a);
      const shared = await publish(
        branchDefinition([
          q('q1', 'single_choice', {}, { jumpRules: [jump('j1', 'a', 'q3')] }),
          q('q2', 'single_choice', {}, { jumpRules: [jump('j2', 'a', 'q3')] }),
          q('q3', 'text'),
          q('q4', 'text'),
        ]),
      );
      a = await fillSaved(await begin(shared), { q1: 'b', q2: 'a', q3: '三', q4: '四' });
      assert.deepEqual(a.state.activePath, ['q1', 'q2', 'q3', 'q4']);
      await submit(writer, a);
    });
    await check('多选首条优先、数字比较、可选空值和显式END按统一逻辑推进', async () => {
      const s = await publish(
        branchDefinition([
          q(
            'q1',
            'multiple_choice',
            {},
            {
              required: false,
              jumpRules: [jump('any', ['a'], 'q3', 'any'), jump('all', ['a', 'b'], 'q4', 'all')],
            },
          ),
          q('q2', 'text'),
          q('q3', 'text'),
          q('q4', 'text'),
          q('q5', 'text'),
        ]),
      );
      for (const [value, path] of [
        [
          ['a', 'b'],
          ['q1', 'q3', 'q5'],
        ],
        [[], ['q1', 'q2', 'q5']],
      ] as any[]) {
        let a = await fillSaved(await begin(s), {
          q1: value,
          q2: '二',
          q3: '三',
          q4: '四',
          q5: '五',
        });
        assert.deepEqual(a.state.activePath, path);
        await submit(writer, a);
      }
      const n = await publish(
        branchDefinition([
          q(
            'q1',
            'number',
            {},
            { jumpRules: [jump('range', [0, 10], 'q3', 'between'), jump('gte', 10, 'q4', 'gte')] },
          ),
          q('q2', 'text'),
          q('q3', 'text'),
          q('q4', 'text'),
          q('q5', 'text'),
        ]),
      );
      for (const [value, target] of [
        [10, 'q3'],
        [20, 'q4'],
      ] as any[]) {
        let a = await begin(n);
        a = await advance(writer, a, value);
        assert.equal(a.state.currentQuestionId, target);
        a = await fillSaved(a, { q3: '三', q4: '四', q5: '五' });
        await submit(writer, a);
      }
      const end = await publish(
        branchDefinition([
          q(
            'q1',
            'single_choice',
            {},
            { required: false, jumpRules: [jump('end', 'a', 'END'), jump('branch', 'b', 'q2')] },
          ),
          q('q2', 'text'),
          q('q3', 'text'),
        ]),
      );
      let a = await begin(end);
      a = await advance(writer, a, 'a');
      assert.equal(a.state.ready, true);
      assert.equal(a.state.transitionCount, 1);
      await submit(writer, a);
      a = await fillSaved(await begin(end), { q1: null, q3: '三' });
      assert.deepEqual(a.state.activePath, ['q1', 'q3']);
      await submit(writer, a);
    });
    await check('首题为分支时定位实际入口，保存及发布均拒绝无通用题定义', async () => {
      const s = await publish(
        branchDefinition([
          q('q1', 'text'),
          q('q2', 'text'),
          q('q3', 'single_choice', {}, { jumpRules: [jump('back', 'a', 'q1')] }),
        ]),
      );
      let a = await begin(s);
      assert.equal(a.state.currentQuestionId, 'q2');
      a = await fillSaved(a, { q2: '二', q3: 'b' });
      assert.deepEqual(a.state.activePath, ['q2', 'q3']);
      await submit(writer, a);
      const invalid = branchDefinition([
        q('q1', 'single_choice', {}, { jumpRules: [jump('self', 'a', 'q1')] }),
      ]);
      const draft = await owner.request('/surveys', 'POST', { title: '无入口' }, 201);
      const err = await owner.request(
        '/surveys/' + draft._id + '/draft',
        'PUT',
        { definition: invalid, revision: 0 },
        400,
      );
      assert.equal(err.code, 'NO_ENTRY');
      await db
        .collection('surveys')
        .updateOne({ _id: new mongoose.Types.ObjectId(draft._id) }, { $set: { draft: invalid } });
      const err2 = await owner.request(
        '/surveys/' + draft._id + '/publish',
        'POST',
        { revision: 0, deadlineAt: null },
        400,
      );
      assert.equal(err2.code, 'NO_ENTRY');
      assert.equal(
        await db.collection('survey_versions').countDocuments({ surveyId: draft._id }),
        0,
      );
    });
    await check('新模式主动返回、同路改答、切换分支补答和汇合答案保留', async () => {
      let a = await fillSaved(await begin(branchSurvey), {
        q1: '一',
        q2: 'a',
        q3: '旧快乐',
        q5: 50,
      });
      const before = structuredClone(a.state);
      a = await back(writer, a, 'q1');
      assert.deepEqual(a.state.answers, before.answers);
      assert.equal(a.state.ready, true);
      a = await advance(writer, a, '改答一');
      assert.equal(a.state.answers.q3, '旧快乐');
      a = await advance(writer, await back(writer, a, 'q2'), 'c');
      assert.equal(a.state.currentQuestionId, 'q4');
      assert.equal(a.state.answers.q3, undefined);
      assert.equal(a.state.pendingAnswers.q5, 50);
      await submit(writer, a, 400);
      await back(writer, a, 'q3', 400);
      a = await advance(writer, a, '新原因');
      assert.equal(a.state.answers.q5, 50);
      a = await advance(writer, await back(writer, a, 'q2'), 'd');
      assert.equal(a.state.answers.q4, '新原因');
      assert.equal(a.state.ready, true);
      await submit(writer, a);
      let b = await fillSaved(await begin(branchSurvey), {
        q1: '一',
        q2: 'c',
        q4: '将失效',
        q5: 60,
      });
      b = await advance(writer, await back(writer, b, 'q2'), 'b');
      assert.deepEqual(b.state.answers, { q1: '一', q2: 'b', q5: 60 });
      await submit(writer, b);
      const stats = await owner.request('/surveys/' + branchSurvey._id + '/statistics');
      assert.equal(stats.total, 6);
      assert.equal(stats.questions[2].answerCount, 1);
      assert.equal(stats.questions[3].answerCount, 3);
    });
    await check('候选答案隔离不会迫使进入分支，新可选分支须明确跳过', async () => {
      const s = await publish(
        branchDefinition([
          q('q1', 'single_choice', {}, { jumpRules: [jump('a', 'a', 'q3')] }),
          q('q2', 'single_choice', {}, { jumpRules: [jump('a2', 'a', 'q3')] }),
          q('q3', 'text'),
          q('q4', 'text'),
        ]),
      );
      for (const choice of ['a', 'b']) {
        let a = await fillSaved(await begin(s), { q1: 'a', q3: '候选三', q4: '汇合' });
        a = await advance(writer, await back(writer, a, 'q1'), 'b');
        assert.equal(a.state.pendingAnswers.q3, '候选三');
        a = await advance(writer, a, choice);
        assert.equal(a.state.answers.q3, choice === 'a' ? '候选三' : undefined);
        await submit(writer, a);
      }
      assert.equal(
        (await owner.request('/surveys/' + s._id + '/statistics')).questions[2].answerCount,
        1,
      );
      const qs = branchMood();
      qs[3].required = false;
      const optional = await publish(branchDefinition(qs));
      let a = await fillSaved(await begin(optional), { q1: '一', q2: 'b', q5: 5 });
      a = await advance(writer, await back(writer, a, 'q2'), 'c');
      assert.equal(a.state.currentQuestionId, 'q4');
      await submit(writer, a, 400);
      a = await advance(writer, a, null);
      assert.equal(a.state.ready, true);
      await submit(writer, a);
    });
    await check('新模式真正回跳、自循环、200次边界及返回不重置', async () => {
      const s = await publish(
        branchDefinition([
          q('q0', 'single_choice', {}, { jumpRules: [jump('entry', 'a', 'q1')] }),
          q('q1', 'single_choice', {}, { jumpRules: [jump('out', 'a', 'q2')] }),
          q(
            'q2',
            'single_choice',
            {},
            { jumpRules: [jump('back', 'b', 'q1'), jump('self', 'a', 'q2')] },
          ),
          q('q3', 'text'),
        ]),
      );
      let a = await begin(s);
      a = await advance(writer, a, 'a');
      a = await advance(writer, a, 'a');
      a = await advance(writer, a, 'b');
      assert.deepEqual(a.state.activePath, ['q0', 'q1']);
      assert.deepEqual(a.state.confirmedQuestionIds, ['q0']);
      a = await advance(writer, a, 'a');
      await db
        .collection('response_attempts')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(a.id) },
          { $set: { 'state.transitionCount': 199 } },
        );
      a = await writer.request('/attempts/' + a.id);
      a = await advance(writer, a, 'a');
      assert.equal(a.state.transitionCount, 200);
      assert.equal(a.state.currentQuestionId, 'q2');
      assert.equal(a.state.ready, false);
      a = await back(writer, a, 'q0');
      assert.equal(a.state.transitionCount, 200);
      await advance(writer, a, 'a', 400);
      await submit(writer, a, 400);
      let b = await begin(branchSurvey);
      b = await fillSaved(b, { q1: '一', q2: 'b', q5: 5 });
      await db
        .collection('response_attempts')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(b.id) },
          { $set: { 'state.transitionCount': 199 } },
        );
      b = await writer.request('/attempts/' + b.id);
      b = await advance(writer, await back(writer, b, 'q2'), 'b');
      assert.equal(b.state.transitionCount, 200);
      assert.equal(b.state.ready, true);
      await submit(writer, b);
    });
    await check('篡改旧顺序路径、分支注入及绕过必答不能提交，也不能用请求覆盖模式', async () => {
      for (const kind of ['extra', 'sequential', 'missing']) {
        let a = await fillSaved(await begin(branchSurvey), { q1: '一', q2: 'b', q5: 5 });
        const update: any =
          kind === 'extra'
            ? { 'state.answers.q3': '注入' }
            : kind === 'missing'
              ? { 'state.answers.q2': 'a' }
              : {
                  'state.activePath': ['q1', 'q2', 'q3', 'q4', 'q5'],
                  'state.confirmedQuestionIds': ['q1', 'q2', 'q3', 'q4', 'q5'],
                  'state.answers.q3': '三',
                  'state.answers.q4': '四',
                };
        await db
          .collection('response_attempts')
          .updateOne({ _id: new mongoose.Types.ObjectId(a.id) }, { $set: update });
        a = await writer.request('/attempts/' + a.id);
        await writer.request(
          '/attempts/' + a.id + '/submit',
          'POST',
          { revision: a.state.revision, routingMode: 'legacy-v1' },
          400,
        );
        assert.equal(await db.collection('responses').countDocuments({ attemptId: a.id }), 0);
      }
    });
    await check('已有草稿预览并确认升级；旧快照、历史答卷与旧填写过程不变', async () => {
      const legacy = await publish(definition(branchMood(), true));
      const oldVersion = await db
        .collection('survey_versions')
        .findOne({ _id: new mongoose.Types.ObjectId(legacy.publishedVersionId) });
      assert.equal(oldVersion!.definition.routingMode, undefined);
      const historical = await fillSaved(await begin(legacy), {
        q1: '历史一',
        q2: 'b',
        q3: '历史三',
        q4: '历史四',
        q5: 15,
      });
      await submit(writer, historical);
      const historicalResponse = await db
        .collection('responses')
        .findOne({ attemptId: historical.id });
      let old = await begin(legacy);
      old = await advance(writer, old, '一');
      old = await advance(writer, old, 'b');
      assert.equal(old.state.currentQuestionId, 'q3');
      assert.equal(old.routing.routingMode, 'legacy-v1');
      const draft = await owner.request('/surveys', 'POST', { title: '既有人工测试草稿模拟' }, 201);
      await db
        .collection('surveys')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(draft._id) },
          { $unset: { 'draft.routingMode': 1 } },
        );
      let saved = await owner.request('/surveys/' + draft._id + '/draft', 'PUT', {
        definition: definition(branchMood(), true),
        revision: 0,
      });
      const before = await db
        .collection('surveys')
        .findOne({ _id: new mongoose.Types.ObjectId(draft._id) });
      let preview = await owner.request('/surveys/' + draft._id + '/routing/upgrade-preview');
      assert.equal(preview.canUpgrade, true);
      assert.deepEqual(preview.newlyExclusiveQuestionIds, ['q3', 'q4']);
      assert.equal(preview.before.routingMode, 'legacy-v1');
      assert.equal(preview.after.routingMode, BRANCH);
      assert.deepEqual(await db.collection('surveys').findOne({ _id: before!._id }), before);
      await writer.request(
        '/surveys/' + draft._id + '/routing/upgrade-preview',
        'GET',
        undefined,
        404,
      );
      const body = {
        revision: preview.revision,
        targetMode: BRANCH,
        acknowledgedBranchQuestionIds: preview.after.branchQuestionIds,
      };
      await writer.request('/surveys/' + draft._id + '/routing/upgrade', 'POST', body, 404);
      await owner.request(
        '/surveys/' + draft._id + '/routing/upgrade',
        'POST',
        { ...body, acknowledgedBranchQuestionIds: [] },
        400,
      );
      await owner.request(
        '/surveys/' + draft._id + '/draft',
        'PUT',
        { definition: branchDefinition(branchMood()), revision: saved.revision },
        409,
      );
      saved = await owner.request('/surveys/' + draft._id + '/draft', 'PUT', {
        definition: definition(branchMood(), true),
        revision: saved.revision,
      });
      await owner.request('/surveys/' + draft._id + '/routing/upgrade', 'POST', body, 409);
      preview = await owner.request('/surveys/' + draft._id + '/routing/upgrade-preview');
      const upgraded = await owner.request(
        '/surveys/' + draft._id + '/routing/upgrade',
        'POST',
        {
          revision: preview.revision,
          targetMode: BRANCH,
          acknowledgedBranchQuestionIds: preview.after.branchQuestionIds,
        },
        201,
      );
      assert.equal(upgraded.survey.draft.routingMode, BRANCH);
      await owner.request(
        '/surveys/' + draft._id + '/draft',
        'PUT',
        {
          definition: { ...definition(branchMood(), true), routingMode: 'legacy-v1' },
          revision: upgraded.survey.revision,
        },
        409,
      );
      const newer = await owner.request(
        '/surveys/' + draft._id + '/publish',
        'POST',
        { revision: upgraded.survey.revision, deadlineAt: null },
        201,
      );
      let a = await fillSaved(await begin(newer), { q1: '一', q2: 'b', q5: 10 });
      assert.deepEqual(a.state.activePath, ['q1', 'q2', 'q5']);
      await submit(writer, a);
      old = await fillSaved(old, { q3: '旧三', q4: '旧四', q5: 20 });
      assert.deepEqual(old.state.activePath, ['q1', 'q2', 'q3', 'q4', 'q5']);
      await submit(writer, old);
      assert.deepEqual(
        await db.collection('survey_versions').findOne({ _id: oldVersion!._id }),
        oldVersion,
      );
      const oldResponse = await db.collection('responses').findOne({ attemptId: old.id });
      assert.equal(oldResponse!.surveyVersionId, legacy.publishedVersionId);
      assert.equal(oldResponse!.answers.q4, '旧四');
      assert.deepEqual(
        await db.collection('responses').findOne({ attemptId: historical.id }),
        historicalResponse,
      );
      assert.equal(
        (await db
          .collection('survey_versions')
          .findOne({ _id: new mongoose.Types.ObjectId(newer.publishedVersionId) }))!.schemaVersion,
        1,
      );
      await owner.request(
        '/surveys/' + legacy._id + '/routing/upgrade-preview',
        'GET',
        undefined,
        409,
      );
      const impossible = await owner.request('/surveys', 'POST', { title: '旧草稿无新入口' }, 201);
      const impossibleDef = definition(
        [q('q1', 'single_choice', {}, { jumpRules: [jump('self', 'a', 'q1')] })],
        true,
      );
      await db
        .collection('surveys')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(impossible._id) },
          { $set: { draft: impossibleDef } },
        );
      const badPreview = await owner.request(
        '/surveys/' + impossible._id + '/routing/upgrade-preview',
      );
      assert.equal(badPreview.canUpgrade, false);
      assert.equal(badPreview.errors[0].code, 'NO_ENTRY');
      await owner.request(
        '/surveys/' + impossible._id + '/routing/upgrade',
        'POST',
        { revision: 0, targetMode: BRANCH, acknowledgedBranchQuestionIds: ['q1'] },
        409,
      );
    });
    await check('工作台返回真实题数和答卷数，保持账号隔离且不传输题目正文', async () => {
      const list = await owner.request('/surveys');
      assert.ok(list.length > 0);
      for (const item of list) {
        const stored = await db
          .collection('surveys')
          .findOne({ _id: new mongoose.Types.ObjectId(item._id) });
        assert.ok(stored);
        assert.equal(item.questionCount, stored.draft.questions.length);
        assert.equal(
          item.responseCount,
          await db.collection('responses').countDocuments({ surveyId: item._id }),
        );
        assert.equal(item.draft.questions, undefined);
      }
      const otherList = await other.request('/surveys');
      const ids = new Set(list.map((s: any) => s._id));
      assert.ok(otherList.every((s: any) => !ids.has(s._id)));
    });
    console.log(`集成测试 ${results.length}/${results.length} 通过，数据库 ${dbName}`);
  } finally {
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync(
      'test-results/integration.json',
      JSON.stringify({ time: new Date().toISOString(), database: dbName, results }, null, 2),
    );
    await mongoose.disconnect();
    server.kill();
  }
}
main().catch((e) => {
  console.error(e);
  console.error(logs.slice(-5000));
  process.exitCode = 1;
});
