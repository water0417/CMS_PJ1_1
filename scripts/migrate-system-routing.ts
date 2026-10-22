import 'dotenv/config';
import mongoose from 'mongoose';
import { mkdirSync, writeFileSync } from 'node:fs';
import { EJSON } from 'bson';
import {
  BRANCH_ROUTING,
  getRoutingMode,
  routingMetadata,
  validateDefinition,
  validateFinal,
  type Definition,
} from '../apps/api/src/domain';

// Maintenance migration: run with the API stopped. Defaults to a read-only preview.
const apply = process.argv.includes('--apply');
const uri =
  process.env.MONGODB_URI ??
  'mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true';
async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const session = await mongoose.startSession();
  const stamp = Date.now();
  mkdirSync('test-results', { recursive: true });
  try {
    const result = await session.withTransaction(async () => {
      const plans: any[] = [];
      const backup: Record<string, any[]> = {};
      for (const name of [
        'surveys',
        'survey_versions',
        'response_attempts',
        'responses',
        'submission_claims',
      ])
        backup[name] = await db.collection(name).find({}, { session }).toArray();
      // Receipt sessions are the only session data involved; login sessions stay untouched.
      backup.sessions = await db
        .collection('sessions')
        .find({ purpose: 'receipt' }, { session })
        .toArray();
      for (const survey of backup.surveys) {
        const oldVersion = backup.survey_versions.find(
          (v) => String(v._id) === survey.publishedVersionId,
        );
        const updateDraft = getRoutingMode(survey.draft) !== BRANCH_ROUTING;
        const updateVersion =
          oldVersion && getRoutingMode(oldVersion.definition) !== BRANCH_ROUTING;
        if (!updateDraft && !updateVersion) continue;
        const definition: Definition | null = updateVersion
          ? { ...oldVersion.definition, routingMode: BRANCH_ROUTING }
          : null;
        if (definition) validateDefinition(definition); // Never install a published version with no entry.
        const surveyId = String(survey._id);
        const responses = backup.responses.filter((r) => r.surveyId === surveyId);
        const conflicts = definition
          ? responses.filter((r) => {
              try {
                validateFinal(definition, {
                  currentQuestionId: 'END',
                  answers: r.answers,
                  activePath: r.activePath,
                  transitionCount: r.activePath.length,
                  ready: true,
                  revision: 0,
                  confirmedQuestionIds: r.activePath,
                  navigationMode: 'answer',
                  pendingAnswers: {},
                  pendingConfirmedQuestionIds: [],
                });
                return false;
              } catch {
                return true;
              }
            })
          : [];
        const active = backup.response_attempts.filter(
          (a) => a.surveyId === surveyId && a.status === 'in_progress',
        );
        const resetActive =
          !!definition && routingMetadata(definition).branchQuestionIds.length > 0;
        const plan = {
          surveyId,
          updateDraft,
          updateVersion: !!updateVersion,
          conflictingResponses: conflicts.length,
          clearedResponses: conflicts.length ? responses.length : 0,
          clearedAttempts: conflicts.length
            ? backup.response_attempts.filter((a) => a.surveyId === surveyId).length
            : resetActive
              ? active.length
              : 0,
          preservedResponses: conflicts.length ? 0 : responses.length,
        };
        plans.push(plan);
        if (!apply) continue;
        // Save a BSON-preserving rollback copy before the first mutation.
        if (plans.length === 1)
          writeFileSync(
            `test-results/system-routing-backup-${stamp}.json`,
            EJSON.stringify(backup, null, 2),
          );
        let publishedVersionId = survey.publishedVersionId;
        if (definition) {
          const versionNumber =
            Math.max(
              0,
              ...backup.survey_versions
                .filter((v) => v.surveyId === surveyId)
                .map((v) => v.versionNumber),
            ) + 1;
          const now = new Date();
          const inserted = await db
            .collection('survey_versions')
            .insertOne(
              {
                surveyId,
                versionNumber,
                definition,
                schemaVersion: definition.schemaVersion,
                createdAt: now,
                updatedAt: now,
              },
              { session },
            );
          publishedVersionId = String(inserted.insertedId);
        }
        const fields: any = { updatedAt: new Date() };
        if (updateDraft) fields['draft.routingMode'] = BRANCH_ROUTING;
        if (definition) fields.publishedVersionId = publishedVersionId;
        await db
          .collection('surveys')
          .updateOne(
            { _id: survey._id, revision: survey.revision },
            { $set: fields, $inc: { revision: 1 } },
            { session },
          );
        if (conflicts.length) {
          // A survey-level reset also releases duplicate-submission claims consistently.
          await db.collection('responses').deleteMany({ surveyId }, { session });
          await db.collection('response_attempts').deleteMany({ surveyId }, { session });
          await db.collection('submission_claims').deleteMany({ surveyId }, { session });
          // Receipts expire naturally; no submitted attempt remains for them to authorize.
        } else if (definition && resetActive) {
          await db
            .collection('response_attempts')
            .deleteMany({ surveyId, status: 'in_progress' }, { session });
        } else if (definition) {
          await db
            .collection('response_attempts')
            .updateMany(
              { surveyId, status: 'in_progress' },
              { $set: { surveyVersionId: publishedVersionId }, $inc: { 'state.revision': 1 } },
              { session },
            );
        }
      }
      return {
        applied: apply,
        database: db.databaseName,
        backup: apply && plans.length ? `system-routing-backup-${stamp}.json` : null,
        plans,
      };
    });
    writeFileSync('test-results/system-routing-migration.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
