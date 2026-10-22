import 'dotenv/config';
import mongoose from 'mongoose';
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  BRANCH_ROUTING,
  routingMetadata,
  validateDefinition,
  DomainError,
  Definition,
} from '../apps/api/src/domain';

/** Read-only inventory for the local project. Upgrades must use the authenticated preview/confirm API. */
async function main() {
  await mongoose.connect(
    process.env.MONGODB_URI ??
      'mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true',
  );
  const rows = await mongoose.connection
    .db!.collection('surveys')
    .find({ status: 'draft' }, { projection: { draft: 1, revision: 1 } })
    .sort({ updatedAt: -1 })
    .toArray();
  const previews = rows.map((s) => {
    const proposed = { ...s.draft, routingMode: BRANCH_ROUTING } as Definition;
    const errors: Array<{ code: string; message: string }> = [];
    try {
      validateDefinition(proposed);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      errors.push({ code: e.code, message: e.message });
    }
    const before = routingMetadata(s.draft as Definition),
      after = routingMetadata(proposed);
    return {
      surveyId: String(s._id),
      title: s.draft.title,
      revision: s.revision,
      before,
      after,
      canUpgrade: before.routingMode !== BRANCH_ROUTING && !errors.length,
      errors,
      warning: '仅预览，未修改数据库。请通过登录后的升级接口确认完整分支列表和最新 revision。',
    };
  });
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    'test-results/routing-draft-previews.json',
    JSON.stringify(
      {
        time: new Date().toISOString(),
        database: mongoose.connection.name,
        readOnly: true,
        previews,
      },
      null,
      2,
    ),
  );
  for (const p of previews)
    console.log(
      JSON.stringify({
        id: p.surveyId,
        title: p.title,
        revision: p.revision,
        mode: p.before.routingMode,
        canUpgrade: p.canUpgrade,
        newEntry: p.after.entryQuestionId,
        branches: p.after.questions
          .filter((q) => q.kind === 'branch')
          .map((q) => ({ id: q.questionId, title: q.title })),
        errors: p.errors,
      }),
    );
  console.log(`预览 ${previews.length} 份草稿，没有升级或改写任何数据。`);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
