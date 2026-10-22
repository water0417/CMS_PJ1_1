import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';
import { connectDatabase, User, Survey } from '../apps/api/src/database';
import * as svc from '../apps/api/src/service';
import { validateDefinition, type Definition } from '../apps/api/src/domain';

const accounts = [
  ['user', 'ecnu1234'],
  ['aaa', 'aaa12345'],
  ['bbb', 'bbb12345'],
  ['ccc', 'ccc12345'],
  ['ddd', 'ddd12345'],
  ['eee', 'eee12345'],
] as const;

async function main() {
  const definition: Definition = JSON.parse(
    fs.readFileSync(path.resolve('docs/examples/manual-color-survey.json'), 'utf8'),
  );
  validateDefinition(definition);
  await connectDatabase(
    process.env.MONGODB_URI ??
      'mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true',
  );
  // Check all existing passwords before creating anything; never reset an existing account.
  for (const [username, password] of accounts) {
    const existing = await User.findOne({ usernameNormalized: username }).lean();
    if (!existing) continue;
    const [salt, expected] = String(existing.passwordHash).split(':');
    const actual = scryptSync(password, salt, 64);
    const stored = Buffer.from(expected ?? '', 'hex');
    if (stored.length !== actual.length || !timingSafeEqual(stored, actual))
      throw new Error(
        `账号 ${username} 已存在但密码与演示配置不同；未修改密码，请使用独立演示数据库。`,
      );
  }
  for (const [username, password] of accounts) {
    if (!(await User.exists({ usernameNormalized: username })))
      await svc.register(username, password);
  }
  const owner = await User.findOne({ usernameNormalized: 'user' }).lean();
  const ownerId = String(owner!._id);
  // Existing manual work always wins: do not publish, reopen, replace, or add responses.
  const existing = await Survey.find({ ownerId, 'draft.title': definition.title }).lean();
  if (existing.length) {
    console.log('发现已有同名人工问卷，保留其全部草稿、发布状态和答卷，不重复生成：');
    for (const survey of existing)
      console.log(
        JSON.stringify({
          id: String(survey._id),
          status: survey.status,
          questionCount: survey.draft.questions.length,
          path: survey.status === 'draft' ? '/editor/' + survey._id : '/survey/' + survey.publicId,
        }),
      );
  } else {
    const created = await svc.createSurvey(ownerId, definition.title);
    const saved = await svc.saveDraft(String(created._id), ownerId, definition, created.revision);
    const published = await svc.publish(String(created._id), ownerId, saved!.revision, null);
    console.log('已从确认的9题定义创建独立演示问卷：/survey/' + published!.publicId);
  }
  console.log('人工演示账号就绪：user；填写者 aaa、bbb、ccc、ddd、eee。密码见 README。');
  console.log('未生成答卷，未把任何人工测试标记为通过。');
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
