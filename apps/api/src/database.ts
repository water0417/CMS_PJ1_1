import mongoose, { Schema } from 'mongoose';
const opts = { timestamps: true, versionKey: false, minimize: false } as const;
interface DbRecord {
  _id: mongoose.Types.ObjectId;
  [key: string]: any;
}
const make = (name: string, fields: any, indexes: Array<[any, any?]> = []) => {
  const s = new Schema<DbRecord>(fields, opts);
  for (const [key, options] of indexes) s.index(key, options);
  return mongoose.model<DbRecord>(name, s, name);
};
const str = { type: String, required: true };
export const User = make('users', { username: str, usernameNormalized: str, passwordHash: str }, [
  [{ usernameNormalized: 1 }, { unique: true }],
]);
export const Survey = make(
  'surveys',
  {
    ownerId: str,
    publicId: str,
    status: { type: String, enum: ['draft', 'published', 'closed'], required: true },
    draft: Schema.Types.Mixed,
    publishedVersionId: String,
    deadlineAt: Date,
    revision: { type: Number, default: 0 },
    submissionSerial: { type: Number, default: 0 },
    publishedAt: Date,
    closedAt: Date,
    deletedAt: Date,
  },
  [[{ publicId: 1 }, { unique: true }], [{ ownerId: 1, createdAt: -1 }]],
);
export const Version = make(
  'survey_versions',
  {
    surveyId: str,
    versionNumber: { type: Number, required: true },
    definition: { type: Schema.Types.Mixed, required: true },
    schemaVersion: { type: Number, required: true },
  },
  [[{ surveyId: 1, versionNumber: 1 }, { unique: true }]],
);
export const Attempt = make(
  'response_attempts',
  {
    surveyId: str,
    surveyVersionId: str,
    userId: String,
    anonymous: { type: Boolean, required: true },
    status: { type: String, enum: ['in_progress', 'submitted', 'abandoned'], required: true },
    state: { type: Schema.Types.Mixed, required: true },
    responseId: String,
    expiresAt: { type: Date, required: true },
  },
  [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }], [{ userId: 1, surveyId: 1, status: 1 }]],
);
export const Response = make(
  'responses',
  {
    surveyId: str,
    surveyVersionId: str,
    attemptId: str,
    anonymous: { type: Boolean, required: true },
    respondentId: String,
    answers: { type: Schema.Types.Mixed, required: true },
    activePath: [String],
    submittedAt: { type: Date, required: true },
  },
  [[{ attemptId: 1 }, { unique: true }], [{ surveyId: 1, surveyVersionId: 1, submittedAt: -1 }]],
);
export const Claim = make('submission_claims', { surveyId: str, userId: str }, [
  [{ surveyId: 1, userId: 1 }, { unique: true }],
]);
export const Session = make(
  'sessions',
  {
    tokenHash: str,
    userId: str,
    purpose: { type: String, enum: ['login', 'receipt'], required: true, default: 'login' },
    expiresAt: { type: Date, required: true },
  },
  [
    [{ tokenHash: 1 }, { unique: true }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
);
export const AuthThrottle = make(
  'auth_throttles',
  { key: str, count: { type: Number, required: true }, expiresAt: { type: Date, required: true } },
  [
    [{ key: 1 }, { unique: true }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
);
export async function connectDatabase(uri: string) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const topology = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!topology.setName)
    throw new Error(
      '当前 MongoDB 是独立实例，不支持提交事务。请按 README 启动项目副本集并运行 db:init。',
    );
  await Promise.all(
    [User, Survey, Version, Attempt, Response, Claim, Session, AuthThrottle].map((m) => m.init()),
  );
  const schemas: Record<string, any> = {
    users: {
      required: ['username', 'usernameNormalized', 'passwordHash', 'createdAt'],
      properties: {
        username: { bsonType: 'string' },
        usernameNormalized: { bsonType: 'string' },
        passwordHash: { bsonType: 'string' },
      },
    },
    surveys: {
      required: ['ownerId', 'publicId', 'status', 'draft', 'revision'],
      properties: {
        ownerId: { bsonType: 'string' },
        publicId: { bsonType: 'string' },
        status: { enum: ['draft', 'published', 'closed'] },
        draft: { bsonType: 'object' },
        revision: { bsonType: 'number', minimum: 0 },
      },
    },
    survey_versions: {
      required: ['surveyId', 'versionNumber', 'schemaVersion', 'definition'],
      properties: {
        surveyId: { bsonType: 'string' },
        versionNumber: { bsonType: 'number' },
        schemaVersion: { enum: [1] },
        definition: { bsonType: 'object' },
      },
    },
    response_attempts: {
      required: ['surveyId', 'surveyVersionId', 'anonymous', 'status', 'state', 'expiresAt'],
      properties: {
        surveyId: { bsonType: 'string' },
        surveyVersionId: { bsonType: 'string' },
        anonymous: { bsonType: 'bool' },
        status: { enum: ['in_progress', 'submitted', 'abandoned'] },
        state: {
          bsonType: 'object',
          required: [
            'currentQuestionId',
            'answers',
            'activePath',
            'transitionCount',
            'ready',
            'revision',
          ],
          properties: {
            currentQuestionId: { bsonType: 'string' },
            navigationMode: { enum: ['answer', 'review'] },
            confirmedQuestionIds: {
              bsonType: 'array',
              uniqueItems: true,
              items: { bsonType: 'string' },
            },
            pendingAnswers: { bsonType: 'object' },
            pendingConfirmedQuestionIds: {
              bsonType: 'array',
              uniqueItems: true,
              items: { bsonType: 'string' },
            },
            answers: { bsonType: 'object' },
            activePath: { bsonType: 'array', items: { bsonType: 'string' } },
            transitionCount: { bsonType: 'number', minimum: 0, maximum: 200 },
            revision: { bsonType: 'number', minimum: 0 },
            ready: { bsonType: 'bool' },
          },
        },
        expiresAt: { bsonType: 'date' },
      },
    },
    responses: {
      required: [
        'surveyId',
        'surveyVersionId',
        'attemptId',
        'anonymous',
        'answers',
        'activePath',
        'submittedAt',
      ],
      properties: {
        surveyId: { bsonType: 'string' },
        surveyVersionId: { bsonType: 'string' },
        attemptId: { bsonType: 'string' },
        anonymous: { bsonType: 'bool' },
        answers: { bsonType: 'object' },
        activePath: { bsonType: 'array', items: { bsonType: 'string' } },
        submittedAt: { bsonType: 'date' },
      },
    },
    submission_claims: {
      required: ['surveyId', 'userId'],
      properties: { surveyId: { bsonType: 'string' }, userId: { bsonType: 'string' } },
    },
    sessions: {
      required: ['tokenHash', 'userId', 'purpose', 'expiresAt'],
      properties: {
        tokenHash: { bsonType: 'string' },
        purpose: { enum: ['login', 'receipt'] },
        userId: { bsonType: 'string' },
        expiresAt: { bsonType: 'date' },
      },
    },
    auth_throttles: {
      required: ['key', 'count', 'expiresAt'],
      properties: {
        key: { bsonType: 'string' },
        count: { bsonType: 'number' },
        expiresAt: { bsonType: 'date' },
      },
    },
  };
  for (const [name, shape] of Object.entries(schemas))
    await mongoose.connection.db!.command({
      collMod: name,
      validator: { $jsonSchema: { bsonType: 'object', ...shape } },
      validationLevel: 'strict',
      validationAction: 'error',
    });
}
