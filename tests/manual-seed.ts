import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import mongoose from 'mongoose';
import { scryptSync } from 'node:crypto';

async function main() {
  const database = 'survey_studio_test_manual_seed_' + Date.now();
  const uri = 'mongodb://127.0.0.1:27018/' + database + '?replicaSet=rs0&directConnection=true';
  const run = () =>
    spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/seed-manual.ts'], {
      env: { ...process.env, MONGODB_URI: uri },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
    });
  const first = run();
  assert.equal(first.status, 0, first.stderr + first.stdout);
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  assert.equal(await db.collection('users').countDocuments(), 6);
  assert.equal(await db.collection('surveys').countDocuments(), 1);
  assert.equal(await db.collection('responses').countDocuments(), 0);
  let survey = await db.collection('surveys').findOne({});
  assert.equal(survey!.draft.questions.length, 9);
  assert.equal(survey!.status, 'published');
  const snapshot = await db.collection('survey_versions').findOne({});
  const fixture = JSON.parse(fs.readFileSync('docs/examples/manual-color-survey.json', 'utf8'));
  assert.deepEqual(snapshot!.definition, fixture);
  // Simulate existing user work: seed must preserve an unpublished, edited draft exactly.
  await db
    .collection('surveys')
    .updateOne(
      { _id: survey!._id },
      { $set: { status: 'draft', 'draft.description': '人工修改必须保留' } },
    );
  survey = await db.collection('surveys').findOne({});
  const second = run();
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.deepEqual(await db.collection('surveys').findOne({}), survey);
  assert.equal(await db.collection('users').countDocuments(), 6);
  assert.equal(await db.collection('survey_versions').countDocuments(), 1);
  assert.equal(await db.collection('responses').countDocuments(), 0);
  const hash = 'test-salt:' + scryptSync('DifferentPass123!', 'test-salt', 64).toString('hex');
  await db.collection('users').updateOne({ username: 'aaa' }, { $set: { passwordHash: hash } });
  const conflict = run();
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /密码与演示配置不同/);
  assert.equal((await db.collection('users').findOne({ username: 'aaa' }))!.passwordHash, hash);
  const result = {
    time: new Date().toISOString(),
    database,
    result: 'PASS',
    checks: [
      '6个账号及密码可复现',
      '9题定义与快照一致',
      '无虚构答卷',
      '重复执行不覆盖已有草稿或重复生成',
      '密码冲突拒绝且不重置',
    ],
  };
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/manual-seed.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
