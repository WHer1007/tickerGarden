# 分支与集中环境配置

仓库根目录的两份忽略文件只用于本机运维和验证，不能作为 Vercel 的测试或生产环境来源：

- `.env.test.local`：本机控制 Robinhood Testnet 46630 工具与本地服务时使用。文件可以含 loopback 网关、本机数据库和工作目录，因此部署构建明确拒绝读取它。
- `.env.master.local`：Robinhood Mainnet 4663 的本机只读验证与发布准备。它不是生产 Vercel 配置，不能复制测试地址填充。

部署测试环境以 Vercel Preview 作用域为准；部署生产环境以 Vercel Production 作用域为准。四个服务分别维护环境变量，不从根目录 `.env.*.local` 上传、复制或推断。完整矩阵见 [`docs/operations/ENVIRONMENT_AND_BRANCH_POLICY.md`](../docs/operations/ENVIRONMENT_AND_BRANCH_POLICY.md)。

文件权限必须为 `0600`，均被 Git 忽略。`test.env.example` / `master.env.example` 是无凭证模板，不是第二套运行配置。旧的 `.env`、前后端局部配置和 IPFS 文件已归档到本机 `.codex_tmp/config-backup-2026-09-09/`，不再自动读取，也不需要继续维护。历史发布目录的 `*.public.env`、JSON、R6 overlay 是证据，不是当前启动入口。

`ALCHEMY_AUTH_TOKEN` 是 Alchemy Webhooks 管理 API 的凭据，保存在选定的根环境文件中；现有启动器仅通过 `tooling` 环境传递，不交给 web、read-api、pipeline、content 或 gateway。它与 RPC 使用的 API key、每份 Webhook 独立的 Signing Key 分开；接收通知的 HMAC 验签需使用该 Webhook 的 Signing Key。示例文件仅保留空值，真实值不写入文档或 `VITE_*`。保存管理 token 不代表已创建订阅或配置回调验签。[Alchemy Webhooks Quickstart](https://www.alchemy.com/docs/reference/notify-api-quickstart)。

## 当前分支职责

- `codex/*`：功能开发、本地联调和审查分支，禁止部署或绑定任何 Vercel 别名。
- `test`：唯一测试发布分支。功能分支经审查合入后，才可从这里发布 Robinhood Testnet 与 Vercel Preview 测试别名。
- `master`：唯一生产发布分支。只能晋级已经在 `test` 验收的同一产品源码；生产部署仍需明确批准。
- `codex/v1-testnet-release-candidate`：保留原开发起点，供回溯；不再作为日常开发入口。
- `archive/master-before-env-2026-09-09` 标签：整理前的 master 恢复点。

## 参数差异：不要将“环境差异”和“代码版本差异”混为一谈

| 参数 | 当前 test / 独立联调 | 原 master 源码 / 正式基线 | 旧 R6 快速包（禁作当前环境） |
| --- | --- | --- | --- |
| 网络 | 46630 | 4663（未配置正式部署） | 421614 |
| ETH phantomQuote | 0.168 ETH | 1.68 ETH 正式规范 | 0.00168 ETH |
| ETH graduationThreshold | 0.42 ETH | 4.2 ETH 正式规范 | 0.0042 ETH |
| Allocation / position 锁定 | 24h / 24h | 24h / 24h | 20min / 20min |
| 解除暂停等待 | 24h | 24h | 20min |
| Holder stream / funding | **24h / 4h，允许 1h–24h** | **24h / 4h，允许 1h–24h** | 旧 Treasury/Merkle 参数不属于当前 V4 |
| Anti-snipe | **5s，新版本** | **5s** | 历史快照，勿套用当前源码 |
| Finality | 600s + 2 blocks | 正式候选配置为 600s + 2 blocks | 600s + 2 blocks |
| Root publication / review | 24h / 1h | 正式候选配置为 24h / 1h | 20min / 5min |
| Claim window | 30d | 正式候选配置为 30d | 2h |

**24h Holder stream、4h 默认 funding interval 与 1h–24h 可配置范围属于当前 V4 policy。** 5s anti-snipe 与 test/master 经济参数仍按各分支源码和已保存部署断言校验；旧 Treasury epoch、raw-exit 和 root-window 环境键即使出现在遗留本地文件中，也不再参与当前 V4 判断。

金额按配对资产原始单位存储，不可把所有 Stock 的门槛当成 ETH 门槛。本次当前发布中 TSLA 为 2.6 TSLA；其余资产分别使用 `apps/web/tests/fixtures/integration/rh-5c2c656b.json` 中绑定的 quote 配置，公开地址/池信息保留在 `deployments/manifests/`。未为 master 杜撰或复制 Stock 的正式报价配置。

## 启动与检查

在 `test` 分支仓库根目录运行（每个长期服务一个终端）：

```sh
npm run env:check
npm run rpc:test
npm run api:test
npm run content:test
npm run pipeline:test
npm run dev:test
```

三条 TypeScript 服务命令要求当前 shell 使用 Node 24.x；版本不符时启动器直接拒绝，避免本地成功但 Vercel 运行时不同。默认监听 `127.0.0.1:8787`（read-api）、`:8788`（pipeline）和 `:8789`（content），可分别用 `TG_READ_API_PORT`、`TG_PIPELINE_PORT`、`TG_CONTENT_PORT` 调整。

等价的跨分支入口（master 当前会因未配置部署而拒绝启动）：

```sh
node tools/environment.mjs check master
node tools/environment.mjs run master web
```

普通 `npm --prefix apps/web run build` 是无环境的编译检查，不加载任何局部 `.env`。部署构建只能使用目标 Vercel 项目的 Preview 或 Production 作用域变量；不得通过 `environment.mjs run ... web build` 注入本机配置。

启动器先检查分支、chain ID、HolderRewardsDistributor V4 的 24h/4h/1h–24h policy、源码锁定时长/anti-snipe，并核对测试 bootstrap 的 release/factory/ETH economics。拒绝跨分支、旧 R6 短周期、测试主网混用和公开 VITE 凭证变量。Web 仅接收 `VITE_*`；read-api、pipeline、content 分别获得自己的数据库角色与运行凭据，Pinata/S3 凭证只交给 content，Alchemy Webhook/QStash chain 凭证只交给 pipeline；网关仅接收网关配置与 RPC 上游。`api` 和 `content-worker` 仅作为旧命令别名，实际分别启动 TypeScript `read-api` 和 `content`，不再调用 Go。Shell 中旧的 TG/VITE/凭证变量不会覆盖选定文件。

数据库使用 `TG_DATABASE_URL` 作为共享默认值；确需不同库时保留对应服务的 `TG_*_DATABASE_URL`。服务使用本地预算网关 `TG_RPC_URL`，上游 RPC 只在网关中配置。CU 限制最多 10000/s，仍然是按需查询、首次请求从最新区块起步；本轮没有启动历史回放或链上检查。

TypeScript pipeline/content 的 `TG_PIPELINE_GENERATION`、`TG_CONTENT_GENERATION` 初始为 `0`，必须与迁移后的数据库 active generation 一致。它们是切换 fencing 值，不得为了绕过 stale runtime 错误随意修改；先 drain，再通过受保护推进接口只增加一，最后切换到携带新值的部署。

## 能改什么

- RPC/数据库/端口/API/IPFS：改选定根配置后重启对应服务。
- `V1_DEPLOYMENT_HOLDER_MODE`：新候选必须明确选择 `dual-asset-24h-v4`（Quote/Meme 双资产、24 小时释放的 ContinuousHolders 脚本）或 `legacy-merkle-7d-v1`（旧 Merkle 脚本）；不匹配或未填写会在广播前拒绝。当前环境和既有市场模式不随示例文件改变。
- `V1_FINALITY_*`、root/claim 窗口：新部署构造参数；本轮没有执行部署，改文件不会更新既有合约。
- `V1_NATIVE_*`：当前环境经济值断言/新候选规划输入。当前已部署 quote 配置是独立不可变记录，变更必须走新 quote 配置及审核，不会随 env 自动改变。
- `TG_EXPECTED_*`：对编译期常量的防漂移断言，**不是 setter**。需要更改时必须同步源码与完整验证，不能通过改 env 缩短锁定时间。

旧的环境写入脚本 `prepare-robinhood-testnet-local-integration`、`activate-robinhood-atomic-business`、`start-continuous-web` 已明确禁用，避免重建分散配置或激活历史地址。历史证据与签名/部署记录未删除，不可通过重跑旧脚本“恢复配置”。

公开资产准入审查表及字段含义见 [docs/operations/ASSET_ADMISSION_REVIEW.md](../docs/operations/ASSET_ADMISSION_REVIEW.md)。表中的 pending 记录只约束未来 canonical asset admission 脚本，不影响既有市场和提现。
