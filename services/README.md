# Services

当前前端后端方案是 [TypeScript + Node.js 24 + Hono Serverless](../docs/v1/V1_TYPESCRIPT_SERVERLESS_DEVELOPMENT_TASKS.md)，仅实现正式前端所需功能；实现位于 [backend-ts](./backend-ts/README.md)。Go 目录保留为冻结的行为与历史实现参考，不属于当前 API、索引、内容服务、契约生成或默认 CI 路径。

| 路径 | 职责 |
| --- | --- |
| `backend-ts/apps/` | Read API、链流水线、内容服务三个 Hono 应用 |
| `backend-ts/packages/` | 数据库、链采集、投影、队列、内容与只读查询模块 |
| `backend-ts/openapi/` | 当前 Read/Content API 契约及 TypeScript 生成客户端 |
| `backend-go/` | 历史实现和对照 fixture；只允许手工参考 workflow，不作为当前 runtime |

在 `services/backend-ts` 执行 `npm test` / `npm run build` 验证当前后端；根 CI 的 `typescript-serverless-backend` job 还会运行真实 PostgreSQL 集成与恢复测试。`npm run check:backend-contracts` 读取 TypeScript OpenAPI 和 ABI 生成物，不从 Go 契约生成前端客户端。

历史 Go workflow 仅保留 `workflow_dispatch`，便于在需要对照旧行为时手工运行。TypeScript 服务仍须完成 Preview、外部服务和目标环境验收后才能上线；本地构建通过不代表生产就绪。
