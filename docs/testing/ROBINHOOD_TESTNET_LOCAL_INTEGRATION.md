# Robinhood 测试网 TypeScript Serverless 本地联调

当前前端服务范围固定到 chain ID `46630`、release `0xf72a2cdf41ec88936213a0325a396df1a286a7a0254f649263f8ec624cb9c0bf` 和 activation block `115580290`。权威身份、ABI 与 bootstrap 由 `docs/backend/typescript-serverless-baseline.json` 及 `services/backend-ts` 的生成检查锁定。旧 Go release、Go `.env`、`make index-run/discover-run/project-run` 和 `go run ./cmd/content-worker` 不属于当前联调链。

## 准备

1. 使用 Node 24.x，并在仓库根安装前端依赖、在 `services/backend-ts` 安装后端锁定依赖。
2. 从 `config/test.env.example` 创建根 `.env.test.local`，权限设为 `0600`。凭据不得使用 `VITE_*`；Alchemy 管理 Auth Token 只允许进入 `tooling`，不进入三个运行服务。
3. 准备 PostgreSQL，并为 migration、read-api、pipeline、content 使用文档要求的独立连接或角色。应用启动不会自动迁移。
4. 本地仅需验证数据库实现时，使用仓库隔离数据库运行器执行集成和恢复测试，无需连接 Alchemy/QStash/S3。

```sh
node --version
npm --prefix services/backend-ts ci
node tools/environment.mjs run test tooling npm --prefix services/backend-ts run migrate
node tools/environment.mjs run test tooling npm --prefix services/backend-ts run test:integration
node tools/environment.mjs run test tooling npm --prefix services/backend-ts run test:recovery
```

## 启动

每个长期服务使用独立终端：

```sh
npm run api:test
npm run pipeline:test
npm run content:test
npm run dev:test
```

旧的 `api:test` 与 `content:test` 命令名只作兼容入口，实际分别启动 TypeScript `read-api` 与 `content`。三个后端进程统一由 `services/backend-ts/scripts/serve.ts` 将 Hono Fetch handler 接到本机 Node HTTP；非 Node 24 直接拒绝。

默认端口：Web `5178`、Read API `8787`、pipeline `8788`、content `8789`。对应环境变量为 `TG_WEB_PORT`、`TG_READ_API_PORT`、`TG_PIPELINE_PORT`、`TG_CONTENT_PORT`。

```sh
curl -i http://127.0.0.1:8787/internal/live
curl -i http://127.0.0.1:8787/internal/ready
curl -i http://127.0.0.1:8788/internal/live
curl -i http://127.0.0.1:8789/internal/live
```

`/internal/live` 只证明进程可响应。`/internal/ready` 只有在该服务的全部环境配置存在时返回 200；缺数据库、签名 key、队列或存储配置必须返回 503 并列出缺项。

## 数据推进边界

真实链推进必须由已验签的 Alchemy Custom Webhook 或已验证的 QStash job 进入事务 inbox/job/outbox。不得为方便本地联调新增无认证的“开始索引”入口。没有真实外部凭据时，只运行 PostgreSQL fixture；不能把 fixture 标为测试网追平。

pipeline 每个任务最多处理 10 个区块，并用主备 RPC 对固定块身份、日志和运行时代码进行一致性检查。空块、动态地址出生块补采、重组 rewind、publication 和 generation fencing 都由相同持久化路径处理。

## 前端

前端正式数据来源由 `VITE_V1_READ_API_URL` 和 `VITE_LAUNCH_METADATA_ORIGIN` 指向本地 read-api/content。保留 `VITE_INTEGRATION_BOOTSTRAP` 时只能视为测试 fixture；正式验收需要关闭它，并确认 Home、Explore、Trade、Create、Stake、Claim、Stats 从同一 finalized revision 工作。缺 publication、价格或覆盖必须显示 `Unavailable`，不能伪装为 `$0`。

真实 Preview、Alchemy/QStash 重投、对象存储、冷启动和浏览器流程的验收步骤见 [`V1_TYPESCRIPT_SERVERLESS_OPERATIONS.md`](../v1/V1_TYPESCRIPT_SERVERLESS_OPERATIONS.md)。
