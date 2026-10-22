# 问达 · ASKWELL

首次使用请阅读 [运行与操作指南](docs/运行与操作指南.md)；开发者请阅读 [架构与文件导航](docs/架构与文件导航.md)。当前交付状态以 [交付清单](docs/交付清单.md)、[前端专属分支接入验收](docs/前端专属分支接入验收.md) 和本次 [发布检查记录](docs/发布检查记录.md) 为准。

基于 MongoDB 的问卷系统课程项目，第一阶段交付。原始要求保留在 `P1P1.md`。前端 Vue 3 / TypeScript / Element Plus，后端 NestJS / TypeScript / Mongoose，全部业务持久化数据保存在 MongoDB，未使用现成问卷系统框架。

## 已实现

- 注册、Cookie 会话登录和退出；只能管理自己的问卷。
- 草稿编辑、题目排序、发布快照、截止时间、关闭及独立分享链接。
- 九种题型：单选、多选、文本、数字、矩阵单选、完整排序、时间、滑动评分、色彩。
- 单选、多选、数字条件跳转；规则首条命中；支持向前、向后、自循环和结束。
- 新草稿采用专属分支模式：规则目标自动成为分支题，未命中只顺序进入通用题；旧发布版本保留原语义，旧草稿可预览后明确升级。
- 主动返回只查看、不清除答案；确认改答后重算路径，保留重合答案并清理失效分支。真正的条件循环仍截断后续路径。有效路径上的必答题才需要回答。
- 每次填写最多推进 200 次；第 200 次到达结束仍可提交。
- 必须登录，可按问卷配置选择匿名；默认每账号一份，可允许重复填写。
- 填写过程保存恢复、版本冲突检测、事务提交、并发防重复、提交幂等。
- 实时聚合统计、逐题筛选及填空内容分页。

## 快速运行（Windows PowerShell）

要求已安装 Node.js / npm、Docker Desktop（Linux containers）。项目依赖包含本地 Node.js 22 LTS，安装后 npm 脚本使用该运行时，不改动系统 Node，避免本机旧版 Node 24.3 的构建异常。依赖由 package-lock.json 固定；数据库在 Docker 29.7、MongoDB 7 环境验证。

在本目录依次执行：

```powershell
npm.cmd ci
docker compose up -d
npm.cmd run db:init
npm.cmd run build
npm.cmd run seed
npm.cmd start
```

打开 **http://127.0.0.1:3000**。`seed` 可选，会创建 2 个本地演示账号、一份包含九种题型和 8 份答卷的发布问卷，以及一份草稿：

也可以在 PowerShell 运行 `./启动项目.ps1 -Install -Demo` 完成安装、数据库初始化、构建和演示启动；已有3000端口应用运行时，请先停止旧实例再启动。

| 用途   | 用户名  | 密码          |
| ------ | ------- | ------------- |
| 创建者 | demo    | DemoPass2026! |
| 填写者 | visitor | DemoPass2026! |

演示密码仅用于本机课程展示。也可以在页面注册自己的账号。再次执行 seed 不重复创建同名演示问卷。

首次拉取镜像需要联网；数据库端口为 **27018**，不影响你已启动的本机 27017 实例。MongoDB 的数据在 Docker 命名卷中，停止或重建容器不清除数据。不要执行带 `-v` 的删除命令，除非明确需要清空项目数据。

## 开发与配置

```powershell
npm.cmd run dev
```

开发前端 http://127.0.0.1:5173，通过代理调用 3000 后端。`npm start` 使用构建后的前端和后端，单端口访问。不要同时启动两份后端占用 3000。

默认连接：`mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true`。

可通过 PowerShell 环境变量覆盖，或在 `apps/api/.env` 中配置（后端运行目录为 `apps/api`）：

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true'
$env:PORT='3000'
```

seed 从项目根目录运行，读取根目录 `.env` 或环境变量。`.env.example` 提供模板。连接其他 MongoDB 时必须是支持事务的副本集；不要连接现有独立实例后期待事务自动生效。

当前服务绑定本机，供课程演示。远程部署需要配置 HTTPS、数据库认证、反向代理及可信来源；生产模式 Cookie 需要 HTTPS。

## 测试

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:integration
```

集成测试自动在 3101 启动临时 API，创建 `survey_studio_test_<时间戳>` 独立数据库，测试完成关闭临时 API，保留测试数据库供核对。结果写入 `test-results/integration.json`，不会清空正式数据库。

## 目录与交付文档

- `apps/api/src/domain.ts`：题型、发布校验、答案校验、跳转与路径引擎。
- `apps/api/src/database.ts`：Mongoose schema、MongoDB 集合验证和索引。
- `apps/api/src/service.ts`：账号、问卷、事务提交、聚合统计。
- `apps/web/src/`：编辑、填写、工作台与统计界面。
- `tests/`：规则自动测试及真实数据库 API 测试。
- `docs/数据库与系统设计.md`：结构、字段、关键逻辑与演化策略。
- `docs/API说明.md`：请求、响应和错误码。
- `docs/测试用例与结果.md`：步骤、输入、输出、执行记录。
- `docs/第一阶段项目报告.md`：完整报告。
- `docs/AI使用日志.md`：真实 AI 协作及修正记录。

第一阶段作为后续扩展基础：保留稳定题目 ID、不可变发布版本和 `schemaVersion`；第二阶段在此结构上迁移和扩展。

2026-10-22 改答逻辑增量：接口地址保持不变，填写状态新增查看模式、确认题目及候选答案字段，旧记录按需兼容。历史改答说明见 [改答逻辑增量说明](docs/改答逻辑增量说明.md)。最新增加独立 routingMode 区分新旧规则语义，当前55项自动测试（含3项前端分类测试）与26组真实数据库测试通过；升级步骤、分类契约和路线差异见 [专属分支与模式升级说明](docs/专属分支与模式升级说明.md)。前端已接入题目分类、入口标识和升级确认，详见验收记录。不增加显示条件开关。生产模式需重启后端加载最新构建；开发模式由已有监听进程加载源码。

## 2026-10-22 · 已确认的杂志风前端

独立灰阶杂志原型迁移至 Vue 前端，统一登录/注册、工作台、编辑、填写与统计。主刊头为自绘 SVG，中文主标题为用户提供的三极花朝体·粗，小字号为微软雅黑。字体资源位于 apps/web/public/fonts/。

工作台每页三份问卷，保持一屏显示；编辑、填写和统计在窗口内滚动。已连接草稿箱、搜索、筛选、分页、真实模板草稿创建、保存、发布、分享、填写与统计。GET /api/surveys 新增 questionCount 和 responseCount，计数来自真实数据库，不使用展示样本替代。

运行方式不变：npm.cmd run build，然后 npm.cmd start，访问 http://127.0.0.1:3000。设计截图保留在 design-preview/；工作区外的独立原型不作为运行依赖或本仓库交付内容。
