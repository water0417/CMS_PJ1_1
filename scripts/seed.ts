import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase, User, Survey } from '../apps/api/src/database';
import * as svc from '../apps/api/src/service';
import type { Definition, Question } from '../apps/api/src/domain';
const make = (
  id: string,
  type: any,
  title: string,
  validation: any = {},
  extra: any = {},
): Question => ({
  id,
  type,
  title,
  description: '',
  required: true,
  options: [
    { id: 'a', label: '非常满意' },
    { id: 'b', label: '比较满意' },
    { id: 'c', label: '有待改进' },
  ],
  rows: [
    { id: 'r1', label: '环境舒适度' },
    { id: 'r2', label: '服务便利性' },
    { id: 'r3', label: '信息获取' },
  ],
  validation,
  jumpRules: [],
  ...extra,
});
async function account(username: string) {
  let u = await User.findOne({ usernameNormalized: username.toLowerCase() }).lean();
  if (!u) {
    const created = await svc.register(username, 'DemoPass2026!');
    return created.id;
  }
  return String(u._id);
}
async function main() {
  await connectDatabase(
    process.env.MONGODB_URI ??
      'mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true',
  );
  const owner = await account('demo'),
    writer = await account('visitor');
  let s = await Survey.findOne({ ownerId: owner, 'draft.title': '校园生活体验调查' }).lean();
  if (!s) {
    const def: Definition = {
      title: '校园生活体验调查',
      description:
        '你好！我们希望了解你对校园生活的真实感受。本问卷用于课程项目演示，答案仅用于汇总分析。感谢每一个认真作答的你。',
      schemaVersion: 1,
      allowAnonymous: true,
      allowRepeatSubmissions: true,
      questions: [
        make('q1', 'single_choice', '你对目前的校园生活满意吗？'),
        make(
          'q2',
          'multiple_choice',
          '哪些方面最值得改善？',
          { minSelections: 1, maxSelections: 3 },
          {
            options: [
              { id: 'a', label: '学习空间' },
              { id: 'b', label: '餐饮服务' },
              { id: 'c', label: '运动设施' },
            ],
          },
        ),
        make('q3', 'text', '用一句话描述你理想的校园生活。', { minLength: 2, maxLength: 200 }),
        make('q4', 'number', '你每周在图书馆学习多少小时？', {
          min: 0,
          max: 100,
          integerOnly: true,
        }),
        make('q5', 'matrix', '请评价以下校园体验。'),
        make(
          'q6',
          'ranking',
          '请按你心中的重要程度排序。',
          {},
          {
            options: [
              { id: 'a', label: '学术资源' },
              { id: 'b', label: '社交活动' },
              { id: 'c', label: '生活便利' },
            ],
          },
        ),
        make('q7', 'time', '你希望校园交流活动安排在几点？', { mode: 'time' }),
        make('q8', 'slider', '你愿意向朋友推荐我们的校园吗？', {
          min: 0,
          max: 10,
          step: 1,
          lowLabel: '完全不愿意',
          highLabel: '非常愿意',
        }),
        make('q9', 'color', '用一种颜色代表你的校园生活。'),
      ],
    };
    const created = await svc.createSurvey(owner, def.title);
    const saved = await svc.saveDraft(String(created._id), owner, def, 0);
    s = (await svc.publish(String(created._id), owner, saved!.revision, null)) as any;
    for (let i = 0; i < 8; i++) {
      let a = await svc.beginAttempt(s!.publicId, writer, i % 2 === 0);
      const answers = [
        ['a', 'b', 'c'][i % 3],
        i % 2 ? ['a', 'b'] : ['b', 'c'],
        [
          '更安静的学习空间，更多元的社团活动。',
          '希望有更多跨专业交流机会。',
          '校园餐饮选择更加丰富。',
        ][i % 3],
        8 + i * 2,
        { r1: 'a', r2: i % 2 ? 'b' : 'a', r3: 'b' },
        i % 2 ? ['b', 'a', 'c'] : ['a', 'c', 'b'],
        '18:30',
        6 + (i % 5),
        ['#167E70', '#D8B577', '#7296B8'][i % 3],
      ];
      for (const answer of answers)
        a = await svc.changeAttempt(a.id, writer, a.state.revision, 'advance', answer);
      await svc.submit(a.id, writer, a.state.revision);
    }
  }
  const draft = await Survey.exists({ ownerId: owner, 'draft.title': '新学期学习计划 · 草稿' });
  if (!draft) {
    const created = await svc.createSurvey(owner, '新学期学习计划 · 草稿');
    await svc.saveDraft(
      String(created._id),
      owner,
      {
        title: '新学期学习计划 · 草稿',
        description: '记录目标，让每一步都有方向。',
        allowAnonymous: true,
        allowRepeatSubmissions: false,
        schemaVersion: 1,
        questions: [make('p1', 'text', '这个学期你最想完成什么？', { maxLength: 300 })],
      },
      0,
    );
  }
  console.log('演示数据已就绪（重复执行不会重复生成）。');
  console.log('创建者 demo / DemoPass2026!；填写者 visitor / DemoPass2026!');
  console.log('填写链接：http://127.0.0.1:3000/survey/' + s!.publicId);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
