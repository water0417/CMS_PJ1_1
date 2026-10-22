import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { User, Survey, Version, Attempt, Response, Claim, Session, AuthThrottle } from './database';
import {
  Definition,
  DomainError,
  fail,
  validateDefinition,
  validateFinal,
  advance,
  rewind,
  normalizeAttemptState,
  createInitialState,
  BRANCH_ROUTING,
  getRoutingMode,
  routingMetadata,
} from './domain';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const objectId = (id: string) => {
  if (!mongoose.isValidObjectId(id)) throw new DomainError('NOT_FOUND', '记录不存在', 404);
  return id;
};
export async function authenticate(token?: string): Promise<string> {
  if (!token) throw new DomainError('UNAUTHORIZED', '请先登录', 401);
  const s = await Session.findOne({
    tokenHash: hash(token),
    purpose: 'login',
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!s) throw new DomainError('UNAUTHORIZED', '登录已过期，请重新登录', 401);
  return s.userId as string;
}
export async function register(username: any, password: any) {
  if (typeof username !== 'string' || !/^[\p{L}\p{N}_-]{3,24}$/u.test(username))
    fail('USERNAME', '用户名需 3～24 位中文、字母、数字、下划线或短横线');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128)
    fail('PASSWORD', '密码需 8～128 位');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = salt + ':' + scryptSync(password, salt, 64).toString('hex');
  try {
    const u = await User.create({
      username,
      usernameNormalized: username.toLowerCase(),
      passwordHash,
    });
    return { id: String(u._id), username: u.username };
  } catch (e: any) {
    if (e.code === 11000) fail('USERNAME_EXISTS', '用户名已被使用');
    throw e;
  }
}
export async function login(username: any, password: any, ip: string) {
  const key =
    hash(ip + ':' + String(username).toLowerCase()) + ':' + Math.floor(Date.now() / 900000);
  const throttle = await AuthThrottle.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 900000) } },
    { upsert: true, new: true },
  ).lean();
  if (throttle!.count! > 20) throw new DomainError('RATE_LIMIT', '尝试过多，请 15 分钟后重试', 429);
  const u =
    typeof username === 'string'
      ? await User.findOne({ usernameNormalized: username.toLowerCase() }).lean()
      : null;
  const [salt, expected] = String(u?.passwordHash ?? '0000000000000000:' + '00'.repeat(64)).split(
    ':',
  );
  const actual = scryptSync(
    typeof password === 'string' && password.length <= 128 ? password : '',
    salt,
    64,
  );
  if (!u || !timingSafeEqual(actual, Buffer.from(expected, 'hex')))
    throw new DomainError('LOGIN', '用户名或密码错误', 401);
  const token = randomBytes(32).toString('hex');
  await Session.create({
    tokenHash: hash(token),
    userId: String(u._id),
    expiresAt: new Date(Date.now() + 7 * 86400000),
  });
  return { token, user: { id: String(u._id), username: u.username } };
}
export async function logout(token: string) {
  await Session.deleteOne({ tokenHash: hash(token ?? '') });
  return { ok: true };
}
export async function me(id: string) {
  const u = await User.findById(id).lean();
  if (!u) throw new DomainError('UNAUTHORIZED', '账号不存在', 401);
  return { id: String(u._id), username: u.username };
}
export async function owned(id: string, userId: string) {
  const s = await Survey.findOne({ _id: objectId(id), ownerId: userId }).lean();
  if (!s) throw new DomainError('NOT_FOUND', '问卷不存在或无权访问', 404);
  return s;
}
export async function listSurveys(userId: string) {
  const surveys = await Survey.aggregate([
    { $match: { ownerId: userId } },
    { $sort: { createdAt: -1 } },
    { $limit: 500 },
    { $addFields: { questionCount: { $size: { $ifNull: ['$draft.questions', []] } } } },
    { $project: { 'draft.questions': 0 } },
  ]);
  const counts = await Response.aggregate([
    { $match: { surveyId: { $in: surveys.map((s) => String(s._id)) } } },
    { $group: { _id: '$surveyId', count: { $sum: 1 } } },
  ]);
  const responseCounts = new Map(counts.map((c) => [c._id, c.count]));
  return surveys.map((s) => ({ ...s, responseCount: responseCounts.get(String(s._id)) ?? 0 }));
}
export async function createSurvey(userId: string, title: any) {
  if (typeof title !== 'string' || !title.trim() || title.length > 120)
    fail('TITLE', '请输入 1～120 字的问卷标题');
  return Survey.create({
    ownerId: userId,
    publicId: randomBytes(12).toString('hex'),
    status: 'draft',
    draft: {
      title: title.trim(),
      description: '',
      allowAnonymous: true,
      allowRepeatSubmissions: false,
      questions: [],
      schemaVersion: 1,
      routingMode: BRANCH_ROUTING,
    },
    revision: 0,
  });
}
export async function saveDraft(id: string, userId: string, d: Definition, revision: number) {
  const previous = await owned(id, userId);
  if (!d || typeof d !== 'object') fail('SETTINGS', '问卷定义不合法');
  // Older editor clients omit the marker: preserve the stored mode rather than silently downgrade.
  const definition =
    d.routingMode === undefined && previous.draft.routingMode !== undefined
      ? { ...d, routingMode: previous.draft.routingMode }
      : d;
  if (getRoutingMode(definition) !== getRoutingMode(previous.draft))
    throw new DomainError(
      'ROUTING_UPGRADE_REQUIRED',
      '规则模式不能通过普通保存切换，请先预览并明确确认升级',
      409,
    );
  validateDefinition(definition);
  const s = await Survey.findOneAndUpdate(
    { _id: id, ownerId: userId, status: 'draft', revision },
    { $set: { draft: definition }, $inc: { revision: 1 } },
    { new: true },
  ).lean();
  if (!s) throw new DomainError('CONFLICT', '问卷已发布或已被其他页面修改，请重新加载', 409);
  return s;
}

export async function readRouting(id: string, userId: string) {
  const s = await owned(id, userId);
  if (s.publishedVersionId) {
    const v = await Version.findById(s.publishedVersionId).lean();
    if (!v) fail('VERSION', '发布版本不存在');
    return routingMetadata(v.definition as Definition);
  }
  return routingMetadata(s.draft as Definition);
}

export async function previewRoutingUpgrade(id: string, userId: string) {
  const s = await owned(id, userId);
  if (s.status !== 'draft')
    throw new DomainError('CONFLICT', '只允许升级未发布草稿，发布快照不可修改', 409);
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
    surveyId: id,
    revision: s.revision,
    before,
    after,
    canUpgrade: before.routingMode !== BRANCH_ROUTING && !errors.length,
    errors,
    newlyExclusiveQuestionIds: after.branchQuestionIds.filter(
      (id) => !before.branchQuestionIds.includes(id),
    ),
    warning:
      '升级后，所有规则指向的题目都只能命中跳转进入；不会自动形成连续题组。请确认这些题目和新入口。',
  };
}

export async function upgradeRouting(id: string, userId: string, body: any) {
  if (body?.targetMode !== BRANCH_ROUTING)
    fail('ROUTING_MODE', '必须明确指定 exclusive-branches-v1');
  const preview = await previewRoutingUpgrade(id, userId);
  if (preview.revision !== body.revision)
    throw new DomainError('CONFLICT', '草稿已变化，请重新预览', 409);
  if (!preview.canUpgrade)
    throw new DomainError(
      'ROUTING_UPGRADE_INVALID',
      preview.errors[0]?.message ?? '草稿已采用新机制，无需升级',
      409,
    );
  const ack = body.acknowledgedBranchQuestionIds;
  if (
    !Array.isArray(ack) ||
    new Set(ack).size !== ack.length ||
    ack.length !== preview.after.branchQuestionIds.length ||
    ack.some((id) => typeof id !== 'string' || !preview.after.branchQuestionIds.includes(id))
  )
    fail('ROUTING_ACK_REQUIRED', '请先预览，并明确确认完整的分支题目列表');
  const s = await Survey.findOneAndUpdate(
    { _id: objectId(id), ownerId: userId, status: 'draft', revision: body.revision },
    { $set: { 'draft.routingMode': BRANCH_ROUTING }, $inc: { revision: 1 } },
    { new: true },
  ).lean();
  if (!s) throw new DomainError('CONFLICT', '草稿已变化，请重新预览', 409);
  return {
    survey: s,
    routing: routingMetadata(s.draft as Definition),
    upgradedFrom: preview.before.routingMode,
  };
}
function deadline(value: any) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    fail('DEADLINE', '截止时间不合法');
  const d = new Date(value);
  if (+d <= Date.now()) fail('DEADLINE', '截止时间必须晚于当前时间');
  return d;
}
export async function publish(id: string, userId: string, rev: number, deadlineAt: any) {
  const end = deadline(deadlineAt ?? null);
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const s = await Survey.findOne({
        _id: objectId(id),
        ownerId: userId,
        status: 'draft',
        revision: rev,
      })
        .session(session)
        .lean();
      if (!s) throw new DomainError('CONFLICT', '问卷已变化，请重新加载', 409);
      validateDefinition(s.draft as Definition);
      const [v] = await Version.create(
        [{ surveyId: id, versionNumber: 1, definition: s.draft, schemaVersion: 1 }],
        { session },
      );
      return Survey.findOneAndUpdate(
        { _id: id, revision: rev, status: 'draft' },
        {
          $set: {
            status: 'published',
            publishedVersionId: String(v._id),
            publishedAt: new Date(),
            deadlineAt: end,
          },
          $inc: { revision: 1 },
        },
        { new: true, session },
      ).lean();
    });
  } finally {
    await session.endSession();
  }
}
export async function updateDeadline(id: string, userId: string, value: any) {
  await owned(id, userId);
  const s = await Survey.findOneAndUpdate(
    { _id: id, status: { $ne: 'closed' } },
    { $set: { deadlineAt: deadline(value) }, $inc: { revision: 1 } },
    { new: true },
  ).lean();
  if (!s) fail('CLOSED', '已关闭的问卷不能修改截止时间');
  return s;
}
export async function closeSurvey(id: string, userId: string) {
  await owned(id, userId);
  const s = await Survey.findOneAndUpdate(
    { _id: id, status: 'published' },
    { $set: { status: 'closed', closedAt: new Date() }, $inc: { revision: 1 } },
    { new: true },
  ).lean();
  if (!s) fail('STATUS', '只有已发布问卷可以关闭');
  return s;
}
function ensureOpen(s: any) {
  if (!s || s.status !== 'published') throw new DomainError('CLOSED', '问卷未发布或已关闭', 409);
  if (s.deadlineAt && +s.deadlineAt <= Date.now())
    throw new DomainError('EXPIRED', '问卷已截止', 409);
}
export async function publicSurvey(publicId: string, userId: string) {
  const s = await Survey.findOne({ publicId }).lean();
  if (!s) throw new DomainError('NOT_FOUND', '问卷不存在', 404);
  ensureOpen(s);
  const v = await Version.findById(s.publishedVersionId).lean();
  if (!v) fail('VERSION', '发布版本不存在');
  const claimed = await Claim.exists({ surveyId: String(s._id), userId });
  const active = await Attempt.findOne({
    surveyId: String(s._id),
    userId,
    status: 'in_progress',
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();
  return {
    id: String(s._id),
    publicId,
    definition: v.definition,
    routing: routingMetadata(v.definition as Definition),
    deadlineAt: s.deadlineAt,
    alreadySubmitted: !!claimed,
    activeAttemptId: active ? String(active._id) : null,
  };
}
export async function beginAttempt(publicId: string, userId: string, anonymous: any) {
  const info = await publicSurvey(publicId, userId);
  const d = info.definition as Definition;
  if (info.alreadySubmitted && !d.allowRepeatSubmissions)
    throw new DomainError('ALREADY_SUBMITTED', '每个账号只能提交一份', 409);
  if (typeof anonymous !== 'boolean') fail('ANONYMOUS', '匿名设置不合法');
  if (anonymous && !d.allowAnonymous) fail('ANONYMOUS', '此问卷不允许匿名');
  const s = await Survey.findById(info.id).lean();
  ensureOpen(s);
  const a = await Attempt.create({
    surveyId: info.id,
    surveyVersionId: s!.publishedVersionId,
    userId,
    anonymous,
    status: 'in_progress',
    state: createInitialState(d),
    expiresAt: new Date(Date.now() + 7 * 86400000),
  });
  return viewAttempt(a.toObject(), d);
}
function viewAttempt(a: any, d: Definition) {
  return {
    id: String(a._id),
    status: a.status,
    anonymous: a.anonymous,
    state: normalizeAttemptState(a.state),
    definition: d,
    routing: routingMetadata(d),
    responseId: a.responseId,
  };
}
export async function getAttempt(id: string, userId: string) {
  const a = await Attempt.findOne({
    _id: objectId(id),
    userId,
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!a) throw new DomainError('NOT_FOUND', '填写记录不存在或已过期', 404);
  const v = await Version.findById(a.surveyVersionId).lean();
  if (!v) fail('VERSION', '问卷版本不存在');
  return { a, d: v.definition as Definition };
}
export async function readAttempt(id: string, userId: string) {
  const { a, d } = await getAttempt(id, userId);
  return viewAttempt(a, d);
}
export async function changeAttempt(
  id: string,
  userId: string,
  revision: number,
  mode: 'advance' | 'back',
  value: any,
) {
  const { a, d } = await getAttempt(id, userId);
  if (a.status !== 'in_progress') fail('STATUS', '此填写已结束');
  ensureOpen(await Survey.findById(a.surveyId).lean());
  if (a.state.revision !== revision)
    throw new DomainError('CONFLICT', '填写已在其他页面修改，请刷新', 409);
  const state = mode === 'advance' ? advance(d, a.state, value) : rewind(a.state, value, d);
  const changed = await Attempt.findOneAndUpdate(
    { _id: id, userId, status: 'in_progress', 'state.revision': revision },
    { $set: { state } },
    { new: true },
  ).lean();
  if (!changed) throw new DomainError('CONFLICT', '填写状态冲突，请刷新', 409);
  return viewAttempt(changed, d);
}
export async function submit(id: string, userId: string, revision: number) {
  // Anonymous retries use an opaque attempt-specific receipt, not a respondent link on the answer.
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const a = await Attempt.findOne({ _id: objectId(id), expiresAt: { $gt: new Date() } })
        .session(session)
        .lean();
      if (!a) throw new DomainError('NOT_FOUND', '填写不存在或已过期', 404);
      if (a.status === 'submitted') {
        const receipt = await Session.exists({
          tokenHash: hash('receipt:' + id + ':' + userId),
          purpose: 'receipt',
          expiresAt: { $gt: new Date() },
        }).session(session);
        if (a.userId !== userId && !receipt) throw new DomainError('NOT_FOUND', '填写不存在', 404);
        return { id: a.responseId, alreadySubmitted: true };
      }
      if (a.userId !== userId) throw new DomainError('NOT_FOUND', '填写不存在', 404);
      if (a.state.revision !== revision)
        throw new DomainError('CONFLICT', '填写状态已变化，请刷新', 409);
      const s = await Survey.findById(a.surveyId).session(session).lean();
      ensureOpen(s);
      const v = await Version.findById(a.surveyVersionId).session(session).lean();
      const d = v!.definition as Definition;
      validateFinal(d, a.state);
      // Write the survey too: closing/changing a deadline and submission serialize on this document.
      const lock = await Survey.updateOne(
        {
          _id: a.surveyId,
          status: 'published',
          $or: [{ deadlineAt: null }, { deadlineAt: { $gt: new Date() } }],
        },
        { $inc: { submissionSerial: 1 } },
        { session },
      );
      if (lock.modifiedCount !== 1) fail('CLOSED', '问卷已关闭或截止');
      if (!d.allowRepeatSubmissions)
        await Claim.create([{ surveyId: a.surveyId, userId }], { session });
      const [r] = await Response.create(
        [
          {
            surveyId: a.surveyId,
            surveyVersionId: a.surveyVersionId,
            attemptId: id,
            anonymous: a.anonymous,
            ...(!a.anonymous ? { respondentId: userId } : {}),
            answers: a.state.answers,
            activePath: a.state.activePath,
            submittedAt: new Date(),
          },
        ],
        { session },
      );
      const update: any = { $set: { status: 'submitted', responseId: String(r._id) } };
      if (a.anonymous) update.$unset = { userId: 1 };
      await Attempt.updateOne({ _id: id }, update, { session });
      await Session.create(
        [
          {
            tokenHash: hash('receipt:' + id + ':' + userId),
            userId,
            purpose: 'receipt',
            expiresAt: a.expiresAt,
          },
        ],
        { session },
      );
      return { id: String(r._id), alreadySubmitted: false };
    });
  } catch (e: any) {
    if (e.code === 11000) throw new DomainError('ALREADY_SUBMITTED', '此账号已提交过问卷', 409);
    throw e;
  } finally {
    await session.endSession();
  }
}
export async function statistics(id: string, userId: string, questionId?: string) {
  const s = await owned(id, userId);
  if (!s.publishedVersionId) fail('NOT_PUBLISHED', '问卷尚未发布');
  const v = await Version.findById(s.publishedVersionId).lean();
  const d = v!.definition as Definition;
  if (questionId && !d.questions.some((q) => q.id === questionId))
    throw new DomainError('NOT_FOUND', '题目不存在', 404);
  const total = await Response.countDocuments({ surveyId: id });
  const questions = [];
  for (const q of d.questions.filter((q) => !questionId || q.id === questionId)) {
    const base: any[] = [
      { $match: { surveyId: id, [`answers.${q.id}`]: { $exists: true } } },
      { $project: { answer: `$answers.${q.id}` } },
    ];
    const count = (await Response.aggregate([...base, { $count: 'n' }]))[0]?.n ?? 0;
    const item: any = { question: q, answerCount: count };
    if (['single_choice', 'multiple_choice', 'color', 'time', 'slider'].includes(q.type))
      item.distribution = await Response.aggregate([
        ...base,
        ...(q.type === 'multiple_choice' ? [{ $unwind: '$answer' }] : []),
        { $group: { _id: '$answer', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]);
    if (['number', 'slider'].includes(q.type))
      item.numeric = (
        await Response.aggregate([
          ...base,
          {
            $group: {
              _id: null,
              average: { $avg: '$answer' },
              min: { $min: '$answer' },
              max: { $max: '$answer' },
            },
          },
        ])
      )[0] ?? { average: null, min: null, max: null };
    if (q.type === 'matrix')
      item.matrix = await Response.aggregate([
        ...base,
        { $project: { pairs: { $objectToArray: '$answer' } } },
        { $unwind: '$pairs' },
        { $group: { _id: { row: '$pairs.k', option: '$pairs.v' }, count: { $sum: 1 } } },
      ]);
    if (q.type === 'ranking')
      item.ranking = await Response.aggregate([
        ...base,
        { $unwind: { path: '$answer', includeArrayIndex: 'position' } },
        {
          $group: {
            _id: '$answer',
            averageRank: { $avg: { $add: ['$position', 1] } },
            firstCount: { $sum: { $cond: [{ $eq: ['$position', 0] }, 1, 0] } },
            positions: { $push: { $add: ['$position', 1] } },
          },
        },
        { $sort: { averageRank: 1, _id: 1 } },
      ]);
    questions.push(item);
  }
  return { title: d.title, total, questions };
}
export async function answerPage(id: string, userId: string, qid: string, page: number) {
  const s = await owned(id, userId);
  const v = await Version.findById(s.publishedVersionId).lean();
  const q = (v?.definition as Definition)?.questions.find((q) => q.id === qid);
  if (!q || !['text', 'number', 'time', 'color'].includes(q.type))
    fail('QUESTION', '此题不提供填写内容列表');
  page = Math.max(1, Math.min(Number.isInteger(page) ? page : 1, 100000));
  const match = { surveyId: id, [`answers.${qid}`]: { $exists: true } };
  const rows = await Response.find(match)
    .select({ [`answers.${qid}`]: 1, submittedAt: 1, _id: 0 })
    .sort({ submittedAt: -1, _id: -1 })
    .skip((page - 1) * 20)
    .limit(20)
    .lean();
  return {
    page,
    pageSize: 20,
    total: await Response.countDocuments(match),
    rows: rows.map((r) => ({ value: r.answers[qid], submittedAt: r.submittedAt })),
  };
}
