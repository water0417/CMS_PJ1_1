# 本次发布验证证据

## 当前最终回归与人工汇总

- final-unit.txt：55/55项自动测试通过。
- final-build.txt：前后端构建通过，仅有已有的较大分包提示。
- final-integration.txt、integration.json：28/28组真实MongoDB API测试通过，较早26组新增2组删除问卷回归。
- manual-verification.json：用户5份人工答卷的只读汇总复核，不包含原始答卷或身份标识；错误输入的人工截图不在此证据范围。

下方release-*为先前发布记录，保留历史；最新结果以上述final-*为准。数据库迁移备份、真实答卷、私有诊断文件均不上传。

人工演示初始化的后续验证：manual-seed.json、manual-seed-test.txt。使用独立测试库验证6账号、9题定义、不生成答卷、重复执行保护和密码冲突保护；不代表用户人工填写测试已经通过。

2026-10-22 在现有安装环境中执行：

- release-unit.txt：npm.cmd test，55/55通过。
- release-build.txt：npm.cmd run build，前后端通过；Element Plus分包体积警告仍存在。
- release-integration.txt：npm.cmd run test:integration，26/26组通过。
- integration.json：真实MongoDB独立测试库及逐组结果。

首次受限环境的数据库连接失败后，允许本机连接并重跑成功；此目录保留最终日志。旧文档中其他日志指当时本机记录，不全部上传。正式草稿清单、会话信息和真实数据库不上传。
