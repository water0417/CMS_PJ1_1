export const TYPES = [
  'single_choice',
  'multiple_choice',
  'text',
  'number',
  'matrix',
  'ranking',
  'time',
  'slider',
  'color',
] as const;
export type QuestionType = (typeof TYPES)[number];
export type Option = { id: string; label: string };
export type Rule = { id: string; operator: string; value: any; target: string };
export const LEGACY_ROUTING = 'legacy-v1' as const;
export const BRANCH_ROUTING = 'exclusive-branches-v1' as const;
export type RoutingMode = typeof LEGACY_ROUTING | typeof BRANCH_ROUTING;
export interface Question {
  id: string;
  type: QuestionType;
  title: string;
  description: string;
  required: boolean;
  options: Option[];
  rows: Option[];
  validation: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    minSelections?: number;
    maxSelections?: number;
    integerOnly?: boolean;
    format?: string;
    step?: number;
    mode?: string;
    earliest?: string;
    latest?: string;
    lowLabel?: string;
    highLabel?: string;
  };
  jumpRules: Rule[];
}
export interface Definition {
  title: string;
  description: string;
  allowAnonymous: boolean;
  allowRepeatSubmissions: boolean;
  questions: Question[];
  schemaVersion: number;
  routingMode?: RoutingMode;
}
export interface AttemptState {
  // Display cursor; independent of the path frontier while reviewing.
  currentQuestionId: string;
  answers: Record<string, any>;
  activePath: string[];
  transitionCount: number;
  ready: boolean;
  revision: number;
  navigationMode?: 'answer' | 'review';
  confirmedQuestionIds?: string[];
  pendingAnswers?: Record<string, any>;
  pendingConfirmedQuestionIds?: string[];
}
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function fail(code: string, message: string): never {
  throw new DomainError(code, message);
}
const finite = (v: any) => typeof v === 'number' && Number.isFinite(v);
const blank = (v: any) =>
  v === null ||
  v === undefined ||
  v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
const operators: Record<string, string[]> = {
  single_choice: ['eq'],
  multiple_choice: ['any', 'all', 'exact'],
  number: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'],
};
/** Primitive for configured condition rules; never executes supplied code. */
function matches(operator: string, answer: any, value: any): boolean {
  switch (operator) {
    case 'eq':
      return answer === value;
    case 'any':
      return Array.isArray(answer) && Array.isArray(value) && value.some((x) => answer.includes(x));
    case 'all':
      return (
        Array.isArray(answer) && Array.isArray(value) && value.every((x) => answer.includes(x))
      );
    case 'exact':
      return (
        Array.isArray(answer) &&
        Array.isArray(value) &&
        answer.length === value.length &&
        value.every((x) => answer.includes(x))
      );
    case 'gt':
      return answer > value;
    case 'gte':
      return answer >= value;
    case 'lt':
      return answer < value;
    case 'lte':
      return answer <= value;
    case 'between':
      return Array.isArray(value) && answer >= value[0] && answer <= value[1];
    default:
      return false;
  }
}

export function getRoutingMode(d: Pick<Definition, 'routingMode'>): RoutingMode {
  const mode = d.routingMode === undefined ? LEGACY_ROUTING : d.routingMode;
  if (mode !== LEGACY_ROUTING && mode !== BRANCH_ROUTING)
    fail('ROUTING_MODE', '不支持的规则语义模式');
  return mode;
}

/** Classification, entry, fallbacks and possible graph edges share the same frozen definition. */
export function createRoutingPlan(d: Definition) {
  const mode = getRoutingMode(d);
  const referencedBy = new Map<string, Array<{ questionId: string; ruleId: string }>>();
  for (const source of d.questions)
    for (const rule of source.jumpRules) {
      if (rule.target === 'END') continue;
      const refs = referencedBy.get(rule.target) ?? [];
      refs.push({ questionId: source.id, ruleId: rule.id });
      referencedBy.set(rule.target, refs);
    }
  const branches = new Set(mode === BRANCH_ROUTING ? [...referencedBy.keys()] : []);
  const general = d.questions.filter((q) => !branches.has(q.id));
  function defaultAfter(id: string): string {
    const index = d.questions.findIndex((q) => q.id === id);
    if (index < 0) fail('PATH', '当前题目不存在');
    return d.questions.slice(index + 1).find((q) => !branches.has(q.id))?.id ?? 'END';
  }
  function next(q: Question, answer: any): string {
    if (answer !== undefined)
      for (const rule of q.jumpRules)
        if (matches(rule.operator, answer, rule.value)) return rule.target;
    return defaultAfter(q.id);
  }
  return {
    mode,
    branches,
    entry: general[0]?.id ?? 'END',
    defaultAfter,
    next,
    possibleAfter: (q: Question) => [
      ...new Set([defaultAfter(q.id), ...q.jumpRules.map((r) => r.target)]),
    ],
    metadata: {
      routingMode: mode,
      entryQuestionId: general[0]?.id ?? null,
      branchQuestionIds: d.questions.filter((q) => branches.has(q.id)).map((q) => q.id),
      generalQuestionIds: general.map((q) => q.id),
      ruleTargetQuestionIds: d.questions.filter((q) => referencedBy.has(q.id)).map((q) => q.id),
      questions: d.questions.map((q) => ({
        questionId: q.id,
        title: q.title,
        kind: branches.has(q.id) ? 'branch' : 'general',
        canEnterSequentially: !branches.has(q.id),
        referencedBy: referencedBy.get(q.id) ?? [],
      })),
    },
  };
}

export const routingMetadata = (d: Definition) => createRoutingPlan(d).metadata;
export const effectiveNextQuestion = (d: Definition, q: Question, answer: any) =>
  createRoutingPlan(d).next(q, answer);
export function createInitialState(d: Definition): AttemptState {
  const entry = createRoutingPlan(d).entry;
  if (entry === 'END') fail('NO_ENTRY', '问卷缺少填写入口：至少需要一道未被跳转规则指向的通用题');
  return normalizeAttemptState({
    currentQuestionId: entry,
    answers: {},
    activePath: [entry],
    transitionCount: 0,
    ready: false,
    revision: 0,
  });
}

function validDate(v: string, mode: string): boolean {
  if (mode === 'time') return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  if (mode === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + 'T00:00:00Z');
    return !isNaN(+d) && d.toISOString().slice(0, 10) === v;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return false;
  return !isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
}
export function validateDefinition(d: Definition): void {
  if (!d || typeof d.title !== 'string' || !d.title.trim() || d.title.length > 120)
    fail('TITLE', '标题须为 1～120 字');
  if (typeof d.description !== 'string' || d.description.length > 5000)
    fail('DESCRIPTION', '问卷说明不能超过 5000 字');
  if (
    typeof d.allowAnonymous !== 'boolean' ||
    typeof d.allowRepeatSubmissions !== 'boolean' ||
    d.schemaVersion !== 1
  )
    fail('SETTINGS', '问卷设置不合法');
  if (!Array.isArray(d.questions) || d.questions.length < 1 || d.questions.length > 100)
    fail('QUESTIONS', '问卷须包含 1～100 道题');
  getRoutingMode(d);
  const ids = new Set<string>();
  const assertId = (id: any) => {
    if (
      typeof id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
      ['__proto__', 'constructor', 'prototype'].includes(id)
    )
      fail('ID', '题目或选项 ID 不合法');
  };
  for (const q of d.questions) {
    if (!q || typeof q !== 'object') fail('QUESTION', '题目结构不合法');
    if (Object.hasOwn(q, 'displayCondition'))
      fail(
        'UNSUPPORTED_FIELD',
        '独立显示条件方案已取消，请移除 displayCondition；分支资格由跳转规则自动推导',
      );
    assertId(q.id);
    if (ids.has(q.id)) fail('DUPLICATE_ID', '题目 ID 重复');
    ids.add(q.id);
    if (
      !TYPES.includes(q.type) ||
      typeof q.title !== 'string' ||
      !q.title.trim() ||
      q.title.length > 500 ||
      typeof q.required !== 'boolean' ||
      typeof q.description !== 'string' ||
      q.description.length > 2000
    )
      fail('QUESTION', '题目类型、标题或说明不合法');
    if (
      !q.validation ||
      typeof q.validation !== 'object' ||
      !Array.isArray(q.jumpRules) ||
      q.jumpRules.length > 30
    )
      fail('QUESTION', '缺少校验配置或规则过多');
    const v = q.validation;
    if (!Array.isArray(q.options) || !Array.isArray(q.rows))
      fail('QUESTION', '选项和矩阵行必须为数组');
    if (v.integerOnly !== undefined && typeof v.integerOnly !== 'boolean')
      fail('LIMIT', '整数限制必须为布尔值');
    for (const key of [
      'min',
      'max',
      'minLength',
      'maxLength',
      'minSelections',
      'maxSelections',
      'step',
    ] as const)
      if (v[key] !== undefined && !finite(v[key])) fail('LIMIT', '数值限制必须为有限数字');
    for (const key of ['minLength', 'maxLength', 'minSelections', 'maxSelections'] as const)
      if (v[key] !== undefined && (!Number.isInteger(v[key]) || v[key]! < 0))
        fail('LIMIT', '长度与数量限制须为非负整数');
    for (const [a, b] of [
      ['min', 'max'],
      ['minLength', 'maxLength'],
      ['minSelections', 'maxSelections'],
    ] as const)
      if (v[a] !== undefined && v[b] !== undefined && v[a]! > v[b]!)
        fail('LIMIT', '最小限制不能大于最大限制');
    if (['single_choice', 'multiple_choice', 'ranking', 'matrix'].includes(q.type)) {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 30)
        fail('OPTIONS', '选项数量须为 2～30');
      const set = new Set();
      for (const o of q.options) {
        assertId(o.id);
        if (set.has(o.id) || typeof o.label !== 'string' || !o.label.trim() || o.label.length > 200)
          fail('OPTIONS', '选项 ID 重复或文字不合法');
        set.add(o.id);
      }
      if (
        q.type === 'multiple_choice' &&
        ((v.maxSelections ?? q.options.length) > q.options.length ||
          (v.minSelections ?? 0) > q.options.length)
      )
        fail('LIMIT', '选择数量限制超过选项数');
    }
    if (q.type === 'matrix') {
      if (!Array.isArray(q.rows) || q.rows.length < 1 || q.rows.length > 30)
        fail('ROWS', '矩阵须包含 1～30 行');
      const set = new Set();
      for (const r of q.rows) {
        assertId(r.id);
        if (set.has(r.id) || typeof r.label !== 'string' || !r.label.trim() || r.label.length > 200)
          fail('ROWS', '矩阵行不合法');
        set.add(r.id);
      }
    }
    if (
      q.type === 'slider' &&
      (!Number.isInteger(v.min) ||
        !Number.isInteger(v.max) ||
        !Number.isInteger(v.step) ||
        v.step! <= 0 ||
        v.min! >= v.max! ||
        (v.max! - v.min!) % v.step! !== 0 ||
        (v.max! - v.min!) / v.step! > 100)
    )
      fail('SLIDER', '评分需整数上下限、正整数步长，最多 100 个间隔且步长须整除范围');
    if (q.type === 'text' && v.format && !['none', 'phone_cn_mobile'].includes(v.format))
      fail('FORMAT', '不支持的文本格式');
    if (q.type === 'time') {
      if (!['date', 'time', 'datetime'].includes(v.mode ?? '')) fail('TIME', '时间模式不合法');
      for (const t of [v.earliest, v.latest])
        if (t && !validDate(t, v.mode!)) fail('TIME', '时间限制格式不合法');
      if (v.earliest && v.latest && v.earliest > v.latest) fail('TIME', '最早时间不能晚于最晚时间');
    }
  }
  for (const q of d.questions) {
    const ruleIds = new Set();
    for (const r of q.jumpRules) {
      assertId(r.id);
      if (ruleIds.has(r.id)) fail('RULE', '规则 ID 重复');
      ruleIds.add(r.id);
      if (!operators[q.type]?.includes(r.operator)) fail('RULE', '该题型不支持此跳转条件');
      if (r.target !== 'END' && !ids.has(r.target)) fail('TARGET', '跳转目标题不存在');
      if (q.type === 'single_choice' && !q.options.some((o) => o.id === r.value))
        fail('RULE', '跳转选项不存在');
      if (
        q.type === 'multiple_choice' &&
        (!Array.isArray(r.value) ||
          !r.value.length ||
          new Set(r.value).size !== r.value.length ||
          r.value.some((x: any) => !q.options.some((o) => o.id === x)))
      )
        fail('RULE', '多选规则须引用非重复的有效选项');
      if (
        q.type === 'number' &&
        (r.operator === 'between'
          ? !Array.isArray(r.value) ||
            r.value.length !== 2 ||
            !r.value.every(finite) ||
            r.value[0] > r.value[1]
          : !finite(r.value))
      )
        fail('RULE', '数字条件不合法');
    }
  }
  // Structural reachability is conservative: conditions may still create answer-dependent loops.
  const plan = createRoutingPlan(d);
  if (plan.entry === 'END')
    fail('NO_ENTRY', '问卷缺少填写入口：所有题目都是分支题，至少需要一道通用题');
  const reachable = new Set(['END']);
  let changed = true;
  while (changed) {
    changed = false;
    d.questions.forEach((q) => {
      const targets = plan.possibleAfter(q);
      if (!reachable.has(q.id) && targets.some((t) => reachable.has(t))) {
        reachable.add(q.id);
        changed = true;
      }
    });
  }
  if (d.questions.some((q) => !reachable.has(q.id))) fail('NO_EXIT', '题目缺少通往结束的结构路径');
}
export function validateAnswer(q: Question, input: any): any {
  let a = input;
  const v = q.validation;
  if (typeof a === 'string') a = a.trim();
  if (blank(a)) {
    if (q.required) fail('REQUIRED', '请完成此必答题');
    return undefined;
  }
  const validOption = (x: any) => typeof x === 'string' && q.options.some((o) => o.id === x);
  switch (q.type) {
    case 'single_choice':
      if (!validOption(a)) fail('OPTION', '请选择有效选项');
      break;
    case 'multiple_choice':
    case 'ranking':
      if (!Array.isArray(a) || a.some((x) => !validOption(x)) || new Set(a).size !== a.length)
        fail('OPTION', '选项无效或重复');
      if (q.type === 'ranking' && a.length !== q.options.length)
        fail('RANKING', '排序必须包含全部选项');
      if (
        q.type === 'multiple_choice' &&
        (a.length < (v.minSelections ?? 0) || a.length > (v.maxSelections ?? q.options.length))
      )
        fail('COUNT', '选择数量不符合限制');
      break;
    case 'text':
      if (typeof a !== 'string') fail('TEXT', '请输入文字');
      if ([...a].length < (v.minLength ?? 0) || [...a].length > (v.maxLength ?? 10000))
        fail('LENGTH', '文字长度不符合限制');
      if (v.format === 'phone_cn_mobile' && !/^1[3-9]\d{9}$/.test(a))
        fail('PHONE', '请输入有效的中国大陆手机号');
      break;
    case 'number':
    case 'slider':
      if (!finite(a)) fail('NUMBER', '请输入有限数字');
      if ((v.min !== undefined && a < v.min) || (v.max !== undefined && a > v.max))
        fail('RANGE', '数值超出允许范围');
      if ((v.integerOnly || q.type === 'slider') && !Number.isSafeInteger(a))
        fail('INTEGER', '请输入安全范围内的整数');
      if (q.type === 'slider' && (a - v.min!) % v.step! !== 0) fail('STEP', '评分不符合步长');
      break;
    case 'matrix':
      if (
        typeof a !== 'object' ||
        Array.isArray(a) ||
        Object.keys(a).some((k) => !q.rows.some((r) => r.id === k)) ||
        Object.values(a).some((x) => !validOption(x))
      )
        fail('MATRIX', '矩阵答案不合法');
      if (q.required && q.rows.some((r) => !a[r.id])) fail('REQUIRED', '请回答矩阵的每一行');
      break;
    case 'time':
      if (typeof a !== 'string' || !validDate(a, v.mode!)) fail('TIME', '日期或时间格式不合法');
      if ((v.earliest && a < v.earliest) || (v.latest && a > v.latest))
        fail('TIME_RANGE', '日期或时间超出范围');
      break;
    case 'color':
      if (typeof a !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(a)) fail('COLOR', '颜色须为 #RRGGBB');
      a = a.toUpperCase();
      break;
  }
  return a;
}
export function nextTarget(d: Definition, q: Question, a: any): string {
  return effectiveNextQuestion(d, q, a);
}
export function rewind(s: AttemptState, id: string, _d?: Definition): AttemptState {
  const state = normalizeAttemptState(s);
  if (!state.activePath.includes(id)) fail('PATH', '只能返回已访问的题目');
  return {
    ...state,
    currentQuestionId: id,
    navigationMode: 'review',
    revision: s.revision + 1,
  };
}

/** Lazy compatibility for legacy attempts, including explicitly skipped optional questions. */
export function normalizeAttemptState(s: AttemptState): AttemptState {
  return {
    ...s,
    navigationMode: s.navigationMode ?? 'answer',
    confirmedQuestionIds:
      s.confirmedQuestionIds ?? (s.ready ? [...s.activePath] : s.activePath.slice(0, -1)),
    pendingAnswers: s.pendingAnswers ?? {},
    pendingConfirmedQuestionIds: s.pendingConfirmedQuestionIds ?? [],
  };
}

function pickAnswers(pool: Record<string, any>, ids: string[]): Record<string, any> {
  return Object.fromEntries(
    ids.filter((id) => Object.hasOwn(pool, id)).map((id) => [id, pool[id]]),
  );
}

/** Unresolved branches may rejoin old answers; keep candidates isolated until the route is known. */
function reachableCandidates(d: Definition, frontier: string, prefix: string[]): Set<string> {
  const plan = createRoutingPlan(d);
  const reachable = new Set<string>();
  const queue = [frontier];
  while (queue.length) {
    const id = queue.pop()!;
    if (id === 'END' || reachable.has(id) || prefix.includes(id)) continue;
    const i = d.questions.findIndex((q) => q.id === id);
    if (i < 0) continue;
    reachable.add(id);
    queue.push(...plan.possibleAfter(d.questions[i]));
  }
  return reachable;
}

/** Re-evaluate confirmed answers without consuming additional transitions or inventing answers. */
function rebuildPath(
  d: Definition,
  s: AttemptState,
  pool: Record<string, any>,
  confirmed: Set<string>,
): AttemptState {
  const path: string[] = [];
  const plan = createRoutingPlan(d);
  if (plan.entry === 'END') fail('NO_ENTRY', '问卷缺少填写入口');
  let id = plan.entry;
  while (id !== 'END') {
    const repeated = path.indexOf(id);
    if (repeated >= 0) {
      // An actual conditional cycle truncates, even if discovered while replaying retained answers.
      const activePath = path.slice(0, repeated + 1);
      return {
        ...s,
        currentQuestionId: id,
        navigationMode: 'answer',
        ready: false,
        activePath,
        answers: pickAnswers(pool, activePath),
        confirmedQuestionIds: activePath.slice(0, -1),
        pendingAnswers: {},
        pendingConfirmedQuestionIds: [],
      };
    }
    const q = d.questions.find((q) => q.id === id);
    if (!q) fail('PATH', '跳转目标题不存在');
    path.push(id);
    if (confirmed.has(id)) {
      try {
        const value = validateAnswer(q, pool[id]);
        if (value === undefined) delete pool[id];
        else pool[id] = value;
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        confirmed.delete(id);
        delete pool[id];
      }
    }
    if (!confirmed.has(id)) {
      const reachable = reachableCandidates(d, id, path.slice(0, -1));
      const pendingIds = [...confirmed].filter((key) => !path.includes(key) && reachable.has(key));
      return {
        ...s,
        currentQuestionId: id,
        navigationMode: 'answer',
        ready: false,
        activePath: path,
        answers: pickAnswers(pool, path),
        confirmedQuestionIds: path.filter((key) => confirmed.has(key)),
        pendingAnswers: pickAnswers(pool, pendingIds),
        pendingConfirmedQuestionIds: pendingIds,
      };
    }
    id = plan.next(q, pool[id]);
  }
  return {
    ...s,
    currentQuestionId: 'END',
    navigationMode: 'answer',
    ready: true,
    activePath: path,
    answers: pickAnswers(pool, path),
    confirmedQuestionIds: [...path],
    pendingAnswers: {},
    pendingConfirmedQuestionIds: [],
  };
}

export function advance(d: Definition, s: AttemptState, input: any): AttemptState {
  s = normalizeAttemptState(s);
  if (s.ready && s.navigationMode !== 'review') fail('FINISHED', '已到达结束，请提交或返回修改');
  if (s.transitionCount >= 200) fail('LOOP_LIMIT', '已达到 200 次推进上限，请重新开始');
  if (!s.activePath.includes(s.currentQuestionId)) fail('PATH', '当前题目不在有效路径内');
  const q = d.questions.find((q) => q.id === s.currentQuestionId);
  if (!q) fail('PATH', '当前题目不存在');
  const answer = validateAnswer(q, input);
  const answers = { ...s.pendingAnswers, ...s.answers };
  if (answer === undefined) delete answers[q.id];
  else answers[q.id] = answer;
  const confirmed = new Set([...s.pendingConfirmedQuestionIds!, ...s.confirmedQuestionIds!, q.id]);
  const result = { ...s, transitionCount: s.transitionCount + 1, revision: s.revision + 1 };
  return rebuildPath(d, result, answers, confirmed);
}
export function validateFinal(d: Definition, s: AttemptState): void {
  s = normalizeAttemptState(s);
  if (
    !s.ready ||
    !Number.isInteger(s.transitionCount) ||
    s.transitionCount < 1 ||
    s.transitionCount > 200
  )
    fail('NOT_FINISHED', '尚未完成问卷');
  if (
    s.currentQuestionId !== 'END' &&
    (s.navigationMode !== 'review' || !s.activePath.includes(s.currentQuestionId))
  )
    fail('PATH', '查看位置与有效路径不一致');
  if (Object.keys(s.pendingAnswers!).length || s.pendingConfirmedQuestionIds!.length)
    fail('PATH', '仍存在未确定分支');
  const plan = createRoutingPlan(d);
  const first = plan.entry;
  if ((s.activePath[0] ?? 'END') !== first || new Set(s.activePath).size !== s.activePath.length)
    fail('PATH', '答题路径不合法');
  if (
    new Set(s.confirmedQuestionIds).size !== s.activePath.length ||
    s.confirmedQuestionIds!.some((id) => !s.activePath.includes(id))
  )
    fail('PATH', '题目确认状态与有效路径不一致');
  s.activePath.forEach((id, i) => {
    if (!s.confirmedQuestionIds!.includes(id)) fail('NOT_FINISHED', '有效路径上存在未确认题目');
    const q = d.questions.find((q) => q.id === id);
    if (!q) fail('PATH', '题目不存在');
    const a = validateAnswer(q, s.answers[id]);
    if (plan.next(q, a) !== (s.activePath[i + 1] ?? 'END')) fail('PATH', '答案与最终路径不一致');
  });
  if (Object.keys(s.answers).some((id) => !s.activePath.includes(id)))
    fail('PATH', '存在失效分支答案');
}
