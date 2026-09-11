# V1 TypeScript Serverless 运行、成本与切换手册

状态：`LOCAL_IMPLEMENTATION_COMPLETE / EXTERNAL_VALIDATION_REQUIRED`

范围：Robinhood Testnet `46630`，release `0x5c2c656b1b23e895ea268c34b187cd267e0f4fdcc1759c726cbca7fafb7c9c12`，activation block `117032526` / `0x36065fb09f78a00f75c528cad0e81e2f1a7b9f59bea9577488f26f4fb611f806`。

## 发布单元与权威版本

四个 Vercel Project 分别部署 `apps/web`、`services/backend-ts/apps/read-api`、`pipeline` 和 `content`。后端运行时只使用 Node.js 24、Hono、PostgreSQL、Alchemy RPC/Webhook、QStash、S3 与 Pinata；Go 只作为历史参考，不在新服务构建、运行或前端客户端生成链中。

从仓库根目录导入 monorepo，并分别把三个后端 Project 的 Root Directory 设为 `services/backend-ts/apps/read-api`、`services/backend-ts/apps/pipeline` 和 `services/backend-ts/apps/content`。三个 Project 都必须在 Root Directory 设置中开启 **Include source files outside of the Root Directory in the Build Step**，使 app 能读取 `services/backend-ts/packages/*` 和该独立 workspace 的 lockfile；即使新建 Project 当前默认开启，也要在发布记录中截取或导出实际设置。各 app 和共享 package 必须保留唯一 `name`，直接依赖必须显式写入各自 `package.json`。根 workspace 与三个 app 均固定 `engines.node=24.x`；部署前使用 Node 24 执行 `npm --prefix services/backend-ts run check:vercel-packaging`，验证 lockfile、依赖图、Function 配置及三个入口。由于仓库顶层另有独立 `package-lock.json`，Preview 构建日志还必须确认安装实际采用 `services/backend-ts/package-lock.json`；若平台未选中该 lockfile，不得通过自定义 `../..` 绕过 Root Directory，而应在保持三个密钥隔离 Project 的前提下调整仓库 workspace 边界。该检查只证明上传前结构完整，不能代替 Preview 构建和运行验收。

发布时记录以下不可变值：Git commit、`openapi/v1.lock.json` fingerprint、数据库 migration digest、当前 release ABI fingerprint、当前 bootstrap source digest、deployment release ID、Alchemy query digest、四个 Vercel deployment ID。任何一项变化都生成新发布记录，不覆盖旧记录。源码中仍以 `f72` 命名的生成文件和 projector 函数只是冻结的内部兼容标识，运行身份必须由 `CURRENT_RELEASE_ID` 和 source-locked baseline 决定。

## 环境与存储准备

1. 创建 Neon pooled runtime URL 和 direct migration URL，并分别创建 read/content/pipeline 角色。先执行 `npm --prefix services/backend-ts run migrate`，应用启动时禁止迁移。
2. S3 bucket 开启 versioning、阻止公共访问和服务端加密。CORS 只允许正式 Web Origin 的 `PUT`，允许 `Content-Type` 与 `x-amz-meta-sha256`，并暴露 `x-amz-version-id`。生命周期规则清理未完成的临时对象；已经写入链上 metadata 的对象版本不得删除。
3. Pinata 使用独立 JWT 和固定 group。上传先校验对象 version、SHA-256、字节数、媒体类型与像素，再 pin 图片和 canonical JSON。
4. QStash 的 chain/content token 分开，回调 URL 固定；`CRON_SECRET` 和 `TG_REPAIR_TOKEN` 分开。Alchemy Auth Token 仅给部署工具，Webhook signing key 仅给 pipeline runtime。pipeline/content 初始分别设置 `TG_PIPELINE_GENERATION=0`、`TG_CONTENT_GENERATION=0`，并与数据库 `queue_generations.active_generation` 一致；缺失、非规范整数或落后代际均拒绝入队、领取、修复和派发。

## Preview 验收

按顺序部署数据库、pipeline、content、read-api、web。先通过根 `tooling` 环境执行 `npm --prefix services/backend-ts run alchemy:webhook:plan`；公开 HTTPS callback ready 后才执行 `alchemy:webhook:create`。创建响应必须明确为 inactive，返回的 webhook ID/signing key 会原子写回当前 mode-0600 的 `.env.<profile>.local`，控制台不显示 signing key。将两项运行值写入受保护的 pipeline Preview 环境后，验证真实签名 callback、重复 delivery、伪造签名、QStash 重投、Cron 修复、双 RPC 固定块一致性，再单独激活 webhook。至少记录：Node 冷启动与热请求 p50/p95、10 路并发、数据库连接峰值、单个链任务的 RPC method/CU/耗时、Webhook 字节数、outbox oldest age、checkpoint lag、内容上传重试。

三个后端 Preview ready 后，配置 `TG_PREVIEW_READ_API_URL`、`TG_PREVIEW_PIPELINE_URL`、`TG_PREVIEW_CONTENT_URL` 和 `TG_PREVIEW_ALLOWED_ORIGIN`，执行 `npm --prefix services/backend-ts run accept:preview`。保存其 JSON 输出；该输出只含 hostname、状态、request ID、延迟和 Vercel cache header。随后另行保存真实 Alchemy 签名 delivery、QStash 重投、迁移事务和页面浏览器证据，不能用伪造签名被拒绝替代真实签名被接受。

Web Preview 配置 `TG_PREVIEW_WEB_URL` 与 `TG_PREVIEW_READ_API_URL` 后，以 Node 24 执行 `npm --prefix apps/web run accept:preview:browser`。验收器要求无凭据 HTTPS origin，从真实 Read API 自动发现当前 market，使用受信 Chrome 验证桌面/移动正式页面、Create 草稿恢复、钱包账户/链事件和旧 Rewards 深链，并检查 CSP、安全响应头、HTML no-cache 及 `/api` 404 不落入 SPA。可用 `TG_BROWSER_EVIDENCE_FILE=<path>` 将单一 JSON 证据保存到固定路径；Preview 模式禁止测试 bootstrap。`TG_BROWSER_ACCEPT_LOCAL=1` 仅供本机 production build smoke，此模式跳过 Vercel 平台响应检查，也不能替代 Preview 验收。

部署前以 Node 24 执行 `verify:rpc`、`verify:current-bootstrap` 和 `verify:current-events`。2026-09-11 的双 RPC 只读结果已保存于 [`../backend/typescript-serverless-current-release-verification.json`](../backend/typescript-serverless-current-release-verification.json)：当前 chain/genesis/activation、17 个固定合约代码哈希和 13 个 bootstrap 来源区块一致。当前 release 没有冻结 QA 市场范围，所以该记录只证明 deployment/bootstrap 身份，不证明动态市场、Webhook 或流水线追平。

页面验收覆盖 Home → Explore → Trade、Create → metadata ready → 创建恢复、Stake、Claim、Stats，以及移动端、换钱包/链、刷新深链和旧 `/rewards` hash。关闭 `VITE_INTEGRATION_BOOTSTRAP` 后重复执行。缺覆盖、缺价格或来源冲突必须显示 unavailable；不得变成 `$0`。

## 观测与告警

所有函数输出脱敏 JSON request metric：service、environment、requestId、method、规范化 path、status、durationMs 和 requestBytes。RPC 逐 attempt 输出 provider label、method、请求/响应字节、耗时、成功/失败及是否可重试；不会输出 RPC URL、参数或响应。`alchemy-primary` 另外输出按 2026-09-11 官方 EVM 方法表锁定的 `nominalComputeUnits` 和版本号：`eth_chainId=0`、`eth_getBlockByNumber=20`、`eth_getLogs=60`、`eth_getTransactionReceipt=20`、`eth_getTransactionByHash=20`、`eth_call=26`、`eth_getCode=20`。它是方法标称值，错误请求的实际计费和总账单必须以 Alchemy Dashboard 为准；备用供应商不套用该映射。Alchemy callback 记录已验证 webhook ID、载荷字节与 duplicate，chain/content job 和 QStash dispatch 记录 outcome、耗时和计数。

pipeline/content 的受保护 `GET /internal/metrics` 返回各 job/outbox state、最老待投递秒数和 PostgreSQL pool 的 total/idle/waiting。pipeline 同时返回 ingestion/projection 的 next block、generation、checkpoint age、相对当前已存 canonical head 的 lag、未解决 source conflict，以及价格状态、年龄与最近过期秒数；content 返回各 upload 状态、年龄和 failed 总数。Alchemy 的账单 CU、Vercel CDN HIT 和平台冷启动仍以 Preview 平台计量为准，不能由本地估算冒充。

告警阈值：outbox age > 180 秒、checkpoint lag > finality delay + 30 blocks、任一 source conflict、连续 3 次 provider retry、内容 job dead、价格超过 expiresAt、数据库连接超过预算 80%。先降低历史/分析并发或暂停价格刷新；已经接收的 inbox/job 不得丢弃，覆盖与双源检查不得跳过。

## 成本模型（2026-09-11 价格快照）

实际月费必须由 Preview 计量代入，未部署前不填写伪精确总额。低流量测试环境可从 Vercel/Neon/Pinata/QStash 免费额度开始；生产建议至少按 Vercel Pro、Neon Launch 与 Pinata Picnic 预算固定底座。

| 项目 | 当前公开计价 | 本架构计量公式 |
| --- | --- | --- |
| Vercel Functions | 前 100 万 invocation；区域 CPU/内存按量，最低约 `$0.128/CPU-hour`、`$0.0106/GB-hour` | 四项目请求数 + active CPU + 请求存活期间内存 |
| Neon Launch | 典型 `$15/月`，`$0.106/CU-hour`，`$0.35/GB-month` | 实际 CU-hour + 存储 + PITR |
| QStash | 免费 1,000 messages/day；按量 `$1/100k messages` | chain delivery + content delivery + provider retry |
| Alchemy PAYG | `$0.45/百万 CU`（前 300M）；普通 webhook `0.04 CU/byte` | RPC method CU + webhook payload bytes × 0.04 |
| Pinata | Free 1GB/500 files；Picnic `$20/月` 含 1TB | 每次发布通常 2 files，加读取带宽 |
| S3 | 按区域的存储、PUT/GET、传输与保留版本计费 | 临时 image bytes × retained versions + PUT/GET |

价格来源：[Vercel Functions](https://vercel.com/docs/functions/usage-and-pricing)、[Neon](https://neon.com/pricing)、[QStash](https://upstash.com/pricing/qstash)、[Alchemy PAYG](https://www.alchemy.com/docs/reference/pay-as-you-go-pricing-faq)、[Alchemy Webhook CU](https://www.alchemy.com/docs/reference/compute-unit-costs)、[Pinata](https://pinata.cloud/pricing)、[Amazon S3](https://aws.amazon.com/s3/pricing/)。上线前重新核价。

## 切换与回滚

切换前冻结版本清单并跑 TypeScript unit/build、真实 PostgreSQL integration、前端 typecheck/client check。让新 pipeline 从 activation block 追平 finalized head，在独立 generation 下 shadow 比较市场、配置、账户、仓位、成交、holder、奖励历史与统计；差异必须解释或阻断。

切换顺序：先暂停 Alchemy webhook 与 content 新提交，等待当前 generation 的 job 全部为 `succeeded`、outbox 全部为 `sent`；任何 `dead` 都先调查并显式修复，不能借切换跳过。预部署带下一代环境值的新 pipeline/content，但暂不接流量。使用 `TG_REPAIR_TOKEN` 调用旧部署的 `POST /internal/generation/advance`，body 为字符串形式的 `{"expectedGeneration":"N","nextGeneration":"N+1"}`；数据库只允许加一且在同一事务中再次检查成功 drain。随后立即把 callback/alias 切到新部署，确认 `/internal/metrics` 的 `activeGeneration` 与环境一致，再恢复 webhook/content 写入。enqueue/claim/repair/dispatch 都持有 generation 行共享锁，推进使用排他锁，因此旧实例不能越过推进点写入或领取新任务。确认无 source conflict、outbox age 为零且所有必需 publication 同 revision后，原子更新前端 Read API/Content Origin、部署 Web并执行页面 smoke。

回滚顺序：立即把 Web origin 指回已记录的上一部署；暂停新 webhook；保留新 generation 和 orphan evidence；恢复上一 publication pointer/兼容数据库角色；检查未决交易 hash 和已经 ready 的 metadata URI。queue generation 只前进、不回退；若新代际必须废弃，先 drain/封存该代际再推进到下一代，并部署对应环境值。回滚不删除新数据、不把 orphan block 改回 canonical，也不重发 unknown 交易。

任何真实创建/激活 Alchemy webhook、写入 Vercel/Neon/Pinata/S3 配置或切换正式域名，都需要部署授权和对应凭据。当前本地成果不代表 `DEPLOYMENT_ELIGIBLE`。
