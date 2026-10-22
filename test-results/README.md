# 本次发布验证证据

2026-10-22 在现有安装环境中执行：

- release-unit.txt：npm.cmd test，55/55通过。
- release-build.txt：npm.cmd run build，前后端通过；Element Plus分包体积警告仍存在。
- release-integration.txt：npm.cmd run test:integration，26/26组通过。
- integration.json：真实MongoDB独立测试库及逐组结果。

首次受限环境的数据库连接失败后，允许本机连接并重跑成功；此目录保留最终日志。旧文档中其他日志指当时本机记录，不全部上传。正式草稿清单、会话信息和真实数据库不上传。
