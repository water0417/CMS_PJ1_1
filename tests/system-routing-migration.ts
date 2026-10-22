import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';
import {
  connectDatabase,
  Survey,
  Version,
  Attempt,
  Response,
  Claim,
} from '../apps/api/src/database';
import { createInitialState } from '../apps/api/src/domain';

async function main() {
  const database = 'survey_studio_test_migration_' + Date.now();
  const uri = 'mongodb://127.0.0.1:27018/' + database + '?replicaSet=rs0&directConnection=true';
  await connectDatabase(uri);
  const sample = JSON.parse(fs.readFileSync('docs/examples/branch-routing.json', 'utf8'));
  delete sample.routingMode;
  const ownerId = new mongoose.Types.ObjectId().toString();
  async function fixture(branches: boolean) {
    const definition = structuredClone(sample);
    if (!branches) definition.questions.forEach((q: any) => (q.jumpRules = []));
    const s = await Survey.create({
      ownerId,
      publicId: new mongoose.Types.ObjectId().toString(),
      status: 'published',
      revision: 3,
      draft: definition,
    });
    const surveyId = String(s._id);
    const v = await Version.create({ surveyId, versionNumber: 1, schemaVersion: 1, definition });
    await Survey.updateOne({ _id: s._id }, { $set: { publishedVersionId: String(v._id) } });
    const attemptId = new mongoose.Types.ObjectId();
    await Attempt.create({
      _id: attemptId,
      surveyId,
      surveyVersionId: String(v._id),
      userId: ownerId,
      anonymous: false,
      status: 'submitted',
      state: createInitialState(definition),
      expiresAt: new Date(Date.now() + 86400000),
    });
    const response = await Response.create({
      surveyId,
      surveyVersionId: String(v._id),
      attemptId: String(attemptId),
      anonymous: false,
      respondentId: ownerId,
      answers: { q1: '介绍', q2: 'a', q3: '快乐', q4: '原因', q5: '补充' },
      activePath: ['q1', 'q2', 'q3', 'q4', 'q5'],
      submittedAt: new Date(),
    });
    await Claim.create({ surveyId, userId: ownerId });
    await Attempt.create({
      surveyId,
      surveyVersionId: String(v._id),
      userId: ownerId,
      anonymous: false,
      status: 'in_progress',
      state: createInitialState(definition),
      expiresAt: new Date(Date.now() + 86400000),
    });
    return { s, v, response };
  }
  try {
    const safe = await fixture(false),
      conflict = await fixture(true);
    const run = (apply: boolean) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            path.resolve('node_modules/tsx/dist/cli.mjs'),
            'scripts/migrate-system-routing.ts',
            ...(apply ? ['--apply'] : []),
          ],
          { env: { ...process.env, MONGODB_URI: uri }, encoding: 'utf8' },
        ),
      );
    const preview = run(false);
    assert.equal(
      preview.plans.find((p: any) => p.surveyId === String(conflict.s._id)).conflictingResponses,
      1,
    );
    assert.equal(await Response.countDocuments(), 2);
    const migrated = run(true);
    assert.ok(migrated.backup && fs.existsSync('test-results/' + migrated.backup));
    assert.equal(await Response.countDocuments({ surveyId: String(safe.s._id) }), 1);
    assert.equal(await Response.countDocuments({ surveyId: String(conflict.s._id) }), 0);
    assert.equal(await Claim.countDocuments({ surveyId: String(conflict.s._id) }), 0);
    assert.equal(await Attempt.countDocuments({ surveyId: String(conflict.s._id) }), 0);
    const updated = await Survey.findById(safe.s._id).lean();
    assert.equal(updated!.draft.routingMode, 'exclusive-branches-v1');
    assert.notEqual(updated!.publishedVersionId, String(safe.v._id));
    assert.equal((await Version.findById(safe.v._id).lean())!.definition.routingMode, undefined);
    assert.equal(
      (await Version.findById(updated!.publishedVersionId).lean())!.definition.routingMode,
      'exclusive-branches-v1',
    );
    assert.equal(
      (await Attempt.findOne({ surveyId: String(safe.s._id), status: 'in_progress' }).lean())!
        .surveyVersionId,
      updated!.publishedVersionId,
    );
    assert.equal(
      (await Response.findById(safe.response._id).lean())!.surveyVersionId,
      String(safe.v._id),
    );
    assert.equal(run(true).plans.length, 0);
    const result = {
      database,
      result: 'PASS',
      checks: [
        '只读预演',
        '新发布快照与旧快照保留',
        '兼容答卷保留',
        '冲突问卷填写及限次占位清理',
        '兼容填写续接',
        '幂等重复执行',
        'BSON备份',
      ],
    };
    fs.writeFileSync(
      'test-results/system-routing-migration-test.json',
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await mongoose.disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
