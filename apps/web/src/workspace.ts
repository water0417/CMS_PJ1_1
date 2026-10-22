import { reactive } from 'vue';
import type { Definition, Question } from '../../api/src/domain';
import { api, uid } from './api';
export interface SurveySummary {
  _id: string;
  publicId: string;
  status: 'draft' | 'published' | 'closed';
  draft: Omit<Definition, 'questions'>;
  questionCount: number;
  responseCount: number;
  createdAt: string;
  deadlineAt?: string;
}
export const workspace = reactive({
  surveys: [] as SurveySummary[],
  filter: 'all',
  search: '',
  templatesOpen: false,
});
export const templates = [
  {
    title: '活动体验反馈',
    description: '了解参与感受，收集下一次改进的方向。',
    cover: ['LIFE,', 'OBSERVED.'],
    prompts: [
      '你对本次活动的整体体验如何？',
      '你愿意再次参加类似的活动吗？',
      '你有什么建议或期待？',
    ],
  },
  {
    title: '用户需求调研',
    description: '听见用户的声音，让设计更贴近真实需求。',
    cover: ['LESS,', 'BUT BETTER.'],
    prompts: [
      '现有产品对你的帮助有多大？',
      '你愿意向朋友推荐这个产品吗？',
      '你最希望改进哪些地方？',
    ],
  },
  {
    title: '课程满意度调查',
    description: '记录学习体验，为更好的课堂提供参考。',
    cover: ['WHAT’S', 'NEXT?'],
    prompts: [
      '你对这门课程的整体感受如何？',
      '你愿意向同学推荐这门课程吗？',
      '关于课程，你还有什么想说的？',
    ],
  },
];
export async function refreshSurveys() {
  workspace.surveys = await api('/surveys');
}
export function statusName(s: SurveySummary) {
  if (s.status === 'published' && s.deadlineAt && Date.parse(s.deadlineAt) <= Date.now())
    return '已截止';
  return { draft: '草稿', published: '收集中', closed: '已关闭' }[s.status];
}
export function templateDefinition(index: number): Definition {
  const t = templates[index];
  const question = (type: Question['type'], title: string, extra: Partial<Question>): Question => ({
    id: uid(),
    type,
    title,
    description: '',
    required: true,
    options: [],
    rows: [],
    validation: {},
    jumpRules: [],
    ...extra,
  });
  return {
    title: t.title,
    description: t.description,
    schemaVersion: 1,
    allowAnonymous: true,
    allowRepeatSubmissions: false,
    questions: [
      question('slider', t.prompts[0], {
        validation: { min: 1, max: 5, step: 1, lowLabel: '不满意', highLabel: '非常满意' },
      }),
      question('single_choice', t.prompts[1], {
        options: ['愿意', '不确定', '不愿意'].map((label) => ({ id: uid(), label })),
      }),
      question('text', t.prompts[2], { required: false, validation: { maxLength: 1000 } }),
    ],
  };
}
