# API 说明

基础路径 `/api`，JSON 请求与响应。同源 Cookie 身份验证，除 health/register/login 外接口要求登录。GET 成功 200；POST 成功默认 201；PUT/PATCH 成功 200。错误统一为 `{ "code":"REQUIRED", "message":"请完成此必答题" }`。

## 账号

| 方法与路径          | 输入               | 输出                                     |
| ------------------- | ------------------ | ---------------------------------------- |
| GET /health         | 无                 | ok、database、schemaVersion              |
| POST /auth/register | username、password | id、username                             |
| POST /auth/login    | username、password | id、username；设置 survey_session Cookie |
| POST /auth/logout   | 无                 | ok；清除 Cookie                          |
| GET /auth/me        | 无                 | id、username                             |

用户名 3～24 位 Unicode 字母、数字、下划线、短横线；大小写不区分。密码 8～128 位。每账号/IP 组合每固定 15 分钟窗口最多 20 次登录尝试，超出返回 429。

## 问卷管理（创建者）

`DELETE /surveys/:id`：传入 `{ revision }`，仅创建者可操作，返回 `{ ok: true }`。软删除后从工作区、编辑和统计入口隐藏，原填写链接及未完成填写不可继续；问卷、版本和答卷保留在数据库。数据变化返回 409/CONFLICT，缺少合法版本号返回 400/REVISION。他人问卷、重复删除返回 404。

| 方法与路径                  | 输入                                | 输出/限制                                                                                                             |
| --------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| GET /surveys                | 无                                  | 自己的问卷数组，按创建时间倒序，最多 500 条；列表不带题目数组；含 questionCount（题数）和 responseCount（成功答卷数） |
| POST /surveys               | title                               | 新问卷对象，draft 状态、revision=0                                                                                    |
| GET /surveys/:id            | 无                                  | 自己的问卷含草稿；其他用户 404                                                                                        |
| PUT /surveys/:id/draft      | definition、revision                | 保存后的问卷，revision+1；已发布或旧版本 409                                                                          |
| POST /surveys/:id/publish   | revision、deadlineAt（ISO 或 null） | 发布后问卷；事务生成发布快照                                                                                          |
| PATCH /surveys/:id/deadline | deadlineAt（未来 ISO 或 null）      | 更新问卷；已关闭拒绝                                                                                                  |
| POST /surveys/:id/close     | 无                                  | 关闭后的问卷；仅 published 可关闭                                                                                     |

definition 完整字段及九种题型见《数据库与系统设计》。保存时提交完整定义，不能改 ownerId、publicId 或状态。题目编辑器本地增删和调整后，一次保存草稿。保存草稿须有至少一道合法题目。

新增 `Definition.routingMode`：新建草稿由服务端设为 exclusive-branches-v1；旧版本缺标记按 legacy-v1。普通保存省略字段时保留当前模式，显式切换模式被拒绝；发布将当前模式固定在定义快照。schemaVersion保持1。新模式把全部规则的非END目标作为专属分支，未命中只进入后续通用题，没有通用题返回400/NO_ENTRY。详细示例见《专属分支与模式升级说明》和examples/branch-routing.json。

### 题目分类与旧草稿升级

当前部署已改为维护脚本统一迁移，前端不再提供逐问卷升级操作。以下升级接口仅保留历史兼容用途；新旧数据解释规则未被前端擅自覆盖。部署步骤见《系统统一分支机制迁移》。

| 方法与路径                               | 输入                                                | 输出/限制                                                                                               |
| ---------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET /surveys/:id/routing                 | 无                                                  | 固定模式的分类、入口、通用/分支ID、逐题kind和referencedBy；仅创建者                                     |
| GET /surveys/:id/routing/upgrade-preview | 无                                                  | surveyId、revision、before、after、canUpgrade、errors、newlyExclusiveQuestionIds、warning；只读、仅草稿 |
| POST /surveys/:id/routing/upgrade        | revision、targetMode、acknowledgedBranchQuestionIds | survey、routing、upgradedFrom；只能明确升级为exclusive-branches-v1；revision+1                          |

升级确认必须使用审阅后的最新revision及完整分支ID列表（允许空列表，不允许遗漏或重复）。列表不匹配返回400/ROUTING_ACK_REQUIRED；旧revision返回409/CONFLICT；无法升级或已经是新模式返回409/ROUTING_UPGRADE_INVALID；尝试用普通保存切换返回409/ROUTING_UPGRADE_REQUIRED。已发布问卷不能升级，不改写旧快照。预览中的errors保留原校验错误码，例如NO_ENTRY。

routing包含routingMode、entryQuestionId（无入口为null）、branchQuestionIds、generalQuestionIds、ruleTargetQuestionIds及questions。逐题字段为questionId、title、kind（general/branch）、canEnterSequentially、referencedBy（questionId/ruleId）。旧模式下题均可顺序进入，ruleTargetQuestionIds仅说明配置目标。

## 填写

| 方法与路径                              | 输入                 | 输出                                                                    |
| --------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| GET /public/surveys/:publicId           | 无                   | id、publicId、definition、deadlineAt、alreadySubmitted、activeAttemptId |
| POST /public/surveys/:publicId/attempts | anonymous/bool       | 新 attempt；超出限次 409                                                |
| GET /attempts/:id                       | 无                   | 当前用户的 attempt；过期或他人记录 404                                  |
| POST /attempts/:id/advance              | revision、answer     | 更新后 attempt；不接受客户端目标或完整路径                              |
| POST /attempts/:id/back                 | revision、questionId | 只能返回 activePath 内题目；仅移动查看位置，不清理答案，revision+1      |
| POST /attempts/:id/submit               | revision             | id（答卷 ID）、alreadySubmitted                                         |

attempt 响应：id、status、anonymous、definition、state、responseId?，并增加由固定发布版本推导的routing分类。公开问卷响应也增加routing。state 含 currentQuestionId（显示游标）、answers（有效答案）、activePath（已确定路径前缀）、transitionCount、ready（全局完成状态）、revision，以及 navigationMode、confirmedQuestionIds、pendingAnswers、pendingConfirmedQuestionIds。旧记录返回时自动补齐新增字段。

navigationMode=review 表示主动返回；ready 可以仍为 true，不能只靠 ready 切换到完成页，否则将无法显示返回题。应以 currentQuestionId 展示当前题，currentQuestionId=END 时显示提交确认，也可另设仅供展示的“返回提交确认”操作。answers 存在不等于已确认：循环目标题可以保留旧值但需要再次确认，选填题可以已确认跳过而没有答案键。pendingAnswers 只是后端隔离的候选，不得作为已完成题、有效答卷或统计数据。

确认当前题仍调用原 advance 接口，成功后只使用服务端返回的新状态；后端会复用保留的合法答案，可能直接返回 END，也可能引导到新分支的首个待补答题。不得由前端假设下一题一定是数组下一项、截断答案或重置次数。返回请求、改答请求和提交请求都必须携带最新 revision，旧版本仍返回409。

典型请求（题目为单选）：

```json
{ "revision": 0, "answer": "option_a" }
```

可选题跳过发送 `answer:null`。复合答案结构见设计文档。推进校验并保存当前题，并重算保留答案的后续路径；当前页面未确认的输入暂不保存。每次成功确认计一次，内部重算不额外计数。第200次进入END仍可提交；到达200次后只可查看，不能再确认改答。已完成路径查看时仍允许提交后端已保存答案。

提交时不接收客户端填写者 ID、匿名替换、答案集合或统计值。匿名成功后 GET attempt 不再提供身份恢复，但同账号可以通过 submit 的短期收据幂等重试。关闭/截止后，即使已经开始填写，也拒绝继续推进和提交。

## 统计

| 方法与路径                                     | 输出                                |
| ---------------------------------------------- | ----------------------------------- |
| GET /surveys/:id/statistics                    | title、total、questions（每题统计） |
| GET /surveys/:id/questions/:qid/statistics     | 同上，questions 仅包含指定题        |
| GET /surveys/:id/questions/:qid/answers?page=1 | page、pageSize=20、total、rows      |

每题包含 question 和 answerCount；按类型附带 distribution、numeric、matrix 或 ranking。distribution 项为 `_id`（选项 ID 或答案值）和 count。numeric 包含 average/min/max，无回答时均为 null。matrix 的 `_id` 包含 row 和 option；ranking 包含选项 `_id`、averageRank、firstCount、positions（名次数组）。

内容分页适用于 text/number/time/color，rows 只返回 value 和 submittedAt，不返回账号身份。

## 主要错误码

| 状态 | 代码                                                                                                  | 场景                             |
| ---- | ----------------------------------------------------------------------------------------------------- | -------------------------------- |
| 400  | TITLE / QUESTION / OPTIONS / RULE / TARGET / LIMIT                                                    | 问卷定义不合法                   |
| 400  | REQUIRED / OPTION / COUNT / LENGTH / PHONE / RANGE / INTEGER / MATRIX / RANKING / TIME / STEP / COLOR | 答案校验失败                     |
| 400  | LOOP_LIMIT / NOT_FINISHED / PATH                                                                      | 上限、未完成、非法路径           |
| 401  | UNAUTHORIZED / LOGIN                                                                                  | 未登录或登录失败                 |
| 403  | ORIGIN                                                                                                | 写请求来源主机不合法             |
| 404  | NOT_FOUND                                                                                             | 资源不存在或无权访问             |
| 409  | CONFLICT / CLOSED / EXPIRED / ALREADY_SUBMITTED                                                       | 并发冲突、关闭、截止、重复提交   |
| 429  | RATE_LIMIT                                                                                            | 登录尝试过多                     |
| 500  | INTERNAL                                                                                              | 未预期服务器错误，详情仅记录后端 |
