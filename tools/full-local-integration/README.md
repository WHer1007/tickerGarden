# 本地三端与容量复现

报告：`docs/reviews/FULL_LOCAL_INTEGRATION_AND_CAPACITY_REPORT_2026-09-13.md`。人口为 10,001 未毕业 + 1,000 已毕业的合成读模型，不是 11,001 个链上部署。本工具不部署、不加载真实密钥、不启用周期任务。

## 准备与回归

仓库根目录运行，使用已有依赖。后端需要 Node 24；浏览器使用本机 macOS Chrome。性能命令顺序执行，避免与合约测试或其他高负载程序重叠。

```sh
export PATH="/Users/dear/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
node --version
sh tools/local-integration-db.sh start
npm run test:contracts
npm --prefix services/backend-ts test
TG_DATABASE_URL=postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden npm --prefix services/backend-ts run test:integration
npm --prefix apps/web test
npm --prefix deployments test
node --test tools/locker-compounding/*.test.mjs tools/holder-rewards/*.test.mjs tools/current-rewards-surface.test.mjs tools/environment.test.mjs
npm --prefix services/backend-ts run build
```

根 `npm test` 会进入外部 live Fork 门禁，本地成功不代表整个根命令通过。不要为执行本工具加载 `.env.test.local` 或公共 RPC。

## 容量与浏览器

终端 A：

```sh
node tools/full-local-integration/capacity.mjs --serve
```

先完成数分钟人口/边界/并发测试，等到 `LOCAL_API_READY`，保留进程。省略 `--serve` 则测试结束自动清理人口。终端 B：

```sh
node tools/full-local-integration/diagnostics.mjs
node tools/full-local-integration/http-load.mjs
node tools/full-local-integration/query-errors.mjs
VITE_V1_READ_API_URL=http://127.0.0.1:18770 node apps/web/node_modules/vite/bin/vite.js build --config tools/full-local-integration/vite.local.mjs
node apps/web/node_modules/vite/bin/vite.js preview --config tools/full-local-integration/vite.local.mjs --host 127.0.0.1 --port 18771 --strictPort
```

终端 C，在查询基准完成后刷新 fixture 时间，避免超过页面新鲜度门槛，再执行：

```sh
node tools/full-local-integration/refresh-fixture.mjs
node tools/full-local-integration/browser.mjs
node tools/full-local-integration/browser-flows.mjs
```

刷新通过新增合成 publication 保留旧不可变记录，会增加历史行数，不代表实际链上发布。浏览器禁止外部请求，构建配置 `envDir:false`，没有钱包写入绑定。18 个页面/尺寸和 8 项交互分别写入 JSON，截图按页面保存。此独立构建未使用正常站点全部分包优化，不把其 bundle 大小作为生产基准。

容量脚本调用真实 publisher/projector 验证超限拒绝；该检查通过意味着成功复现问题。为继续测试下游 API/页面，专用 SQL 批量构造读模型绕过发布入口，不能据此声明正常全链摄取成功。

## Relay 压力与恢复

以下逐条运行，固定使用 localhost 18781–18784，自行创建/清理临时 TLS 证书和独立 schema：

```sh
node tools/full-local-integration/relay-load.mjs
node tools/full-local-integration/relay-load.mjs --recovery-only
node tools/full-local-integration/relay-load.mjs --burst-only
```

完整轨测 0/50/200 ms 队列延迟与恢复；恢复轨测重复、removed、503、跨区块及同区块断线；burst 测 100 条/秒 × 10 秒积压。使用生产 Relay 进程，模拟传输形状日志不代表全部业务 ABI 结算验证。2026-09-13 历史证据中的同区块补偿 `pass:false` 是当时的缺陷复现，2026-09-14 修复结果见下方新证据目录；完整压力轨若先超出路由刷新观察时限，不能报告其余恢复通过。burst 测量后终止测试进程，待发数据仅属于隔离测试库。

## 实际本地签名测试

分别使用全新独占 Anvil；导入会修改 fixture code/storage，不能复用其他任务节点。只使用公开本地测试账户。

```sh
node tools/holder-rewards/prepare-publication-local.mjs
anvil --host 127.0.0.1 --port 18677 --chain-id 46630 --hardfork cancun --silent
# 新终端执行：
TG_LOCAL_PUBLICATION_EVIDENCE=docs/reviews/evidence/full-local-integration-2026-09-13/holder-local.json node services/backend-ts/scripts/test-holder-publication-local.ts
```

```sh
node tools/locker-compounding/prepare-local-test.mjs
anvil --host 127.0.0.1 --port 18676 --hardfork cancun --timestamp 1800000000 --silent
# 新终端执行：
TG_LOCAL_LOCKER_EVIDENCE=docs/reviews/evidence/full-local-integration-2026-09-13/locker-local.json node tools/locker-compounding/local-integration.mjs
```

这些不能代替 RH Stock 路由、独立提供商或钱包插件三端闭环。周期发布保持禁用。

## 证据与清理

输出固定到 `docs/reviews/evidence/full-local-integration-2026-09-13/`；复跑会覆盖同名文件，需要保留时先复制证据目录。上述命令未附日志重定向，可保存 stdout/stderr。后续复跑应更新校验清单、测试时间、硬件和源码版本。

完成后只对本次容量 API、Vite preview、专用 Anvil 发送 Ctrl-C / SIGTERM。容量服务正常退出删除自己创建的 schema。已有 PostgreSQL 保留；不使用广泛 pkill，不删除来源不明 schema，不删除历史 pending journal。

## 2026-09-14 日常规模优化验收

新报告：`docs/reviews/CAPACITY_OPTIMIZATION_REPORT_2026-09-14.md`；运行约束：`docs/operations/CAPACITY_INDEXING.md`。以下独立输出到 `capacity-optimization-2026-09-14`，保留上面的历史失败证据。

按顺序运行，避免把并行 DDL 回归与性能测试叠在同一台本地 PostgreSQL 上：

```sh
export PATH="/Users/dear/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export TG_TEST_DATABASE_URL=postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden
export TG_DATABASE_URL="$TG_TEST_DATABASE_URL"
npm --prefix services/backend-ts test
node --test --test-concurrency=1 services/backend-ts/tests/integration/*.test.ts
npm --prefix apps/web test
npm --prefix infra/vps/chain-event-relay test
node tools/full-local-integration/daily-capacity.mjs --serve
```

`daily-capacity.mjs` 通过正常 Market/Holder 投影器、ABI 事件和无网络的双 RPC 模拟器构造 20,000 未毕业 + 1,500 已毕业市场；首轮分批初始化需要数分钟。215,000 笔交易与 43,000 条余额另行 SQL 构造，仅用于下游查询容量，不伪称链上部署或交易摄取。

等 `LOCAL_API_READY` 后，在另一终端按顺序执行：

```sh
node tools/full-local-integration/daily-read-retest.mjs
# 等 CURRENT_API_READY，继续使用另一个终端：
export TG_CAPACITY_EVIDENCE_DIR=../../docs/reviews/evidence/capacity-optimization-2026-09-14/
export TG_CAPACITY_API_META=current-api.json
node tools/full-local-integration/http-load.mjs
node tools/full-local-integration/daily-stats-load.mjs
node tools/full-local-integration/daily-incremental.mjs
node tools/full-local-integration/daily-publish-retest.mjs
VITE_V1_CHAIN_ID=46630 VITE_V1_READ_API_URL=http://127.0.0.1:18772 node apps/web/node_modules/vite/bin/vite.js build --config tools/full-local-integration/vite.local.mjs
node apps/web/node_modules/vite/bin/vite.js preview --config tools/full-local-integration/vite.local.mjs --host 127.0.0.1 --port 18771 --strictPort
# 新终端，保留上面的 evidence/meta 环境变量：
node tools/full-local-integration/browser.mjs
node tools/full-local-integration/browser-flows.mjs
```

两个增量脚本会推进这个专用 fixture，不能重复执行到任意既有数据库。`daily-incremental` 把 SQL 余额替换为 43,000 条真实 ABI Transfer 的正常回放，逐市场核对 supply，再验证单市场变动与 Holder 空区间。`daily-publish-retest` 验证另一个新 anchor 下仅新增一条 market version，以及相同 anchor 重试不增加 RPC。配置/账户/仓位仍为测试 fixture，不表示全部钱包交易联调。浏览器需在新 anchor 产生后 20 分钟内执行，否则会正确拒绝过期数据显示。需要延长本地验收窗口时运行 `node tools/full-local-integration/daily-refresh-quiet.mjs`，通过正常投影器产生无新事件的下一合成区块；不会改写旧 publication。

```sh
TG_CAPACITY_EVIDENCE_DIR=../../docs/reviews/evidence/capacity-optimization-2026-09-14/ node tools/full-local-integration/relay-load.mjs
TG_CAPACITY_EVIDENCE_DIR=../../docs/reviews/evidence/capacity-optimization-2026-09-14/ node tools/full-local-integration/relay-load.mjs --burst-only
```

当前 Relay 工具使用 43,000 个动态地址、1,500 个池子；补偿测试包括同块断线与仅终止本测试自有数据库连接的恢复。对比旧 Relay 报告时应看报告内人口值。burst 会等 1,000 条全部排空后再清理，不将短暂 pending 宣称为丢失。

最后先结束当前 Read API 与 Vite，再结束最初 `daily-capacity --serve`（它清理自己创建的 schema）。原有 PostgreSQL 继续保留。本地 PostgreSQL 在本轮并行 DDL 回归期间曾发生 PANIC 并自动恢复，相关失败日志保留；后续验收使用串行数据库回归。连接断开恢复测试只终止自有连接，不重启共享数据库服务。

最终分阶段汇总可执行 `node tools/full-local-integration/finalize-capacity-evidence.mjs`；该脚本要求当前证据中的检查数量与通过状态相符，并显式记录旧 Holder/统计失败的替代证据，不会把旧的 `capacity.json` 改成通过。修改用例后需同步更新汇总要求。

### 第二阶段验证输出

在仓库根目录设置（路径相对于本目录的脚本）：

```sh
export TG_CAPACITY_EVIDENCE_DIR=../../docs/reviews/evidence/capacity-phase2-2026-09-14/
```

数据库迁移回归、Relay 测试及市场规模测试串行运行，避免本机并发 DDL 干扰性能。`daily-capacity.mjs --serve` 完成后依次运行 `daily-incremental.mjs`、`daily-publish-retest.mjs`、`daily-refresh-quiet.mjs`，随后用 `daily-read-retest.mjs` 启动第二个 API。数据夹具服务保留在 18770；当前读 API 使用 18772，再以 `TG_CAPACITY_API_PORT=18773` 和 `--serve-only` 启动独立实例。`daily-multi-instance.mjs` 默认进行 120 秒持续读负载；它不发送交易、不发布快照。

执行实际 HTTP 压测和浏览器脚本时另设 `TG_CAPACITY_API_META=current-api.json`。预览构建显式设置 `VITE_V1_CHAIN_ID=46630` 与 `VITE_V1_READ_API_URL=http://127.0.0.1:18772`，使用本目录 `vite.local.mjs`。浏览器脚本拦截所有非本地网络请求。

Relay 验证增加封装批次进程重启重试：每条日志保留在 inbox，重启前后沿用同一队列幂等键。容量耗时包括测试脚本明确的等待时间，不以单个样本推导生产峰值吞吐。


## 2026-09-14 常驻运行与写入优化

报告：`docs/reviews/RUNTIME_OPTIMIZATION_2026-09-14.md`。使用独立证据目录：

```sh
export TG_CAPACITY_EVIDENCE_DIR=../../docs/reviews/evidence/runtime-optimization-2026-09-14/
node tools/full-local-integration/daily-capacity.mjs --serve
```

待 `LOCAL_API_READY` 后，在另一终端依次执行 `daily-incremental.mjs`、`daily-refresh-quiet.mjs`、`daily-read-retest.mjs`。新断言要求单市场变化只写一条 Holder snapshot、安静区块所有 snapshot xmin 不变，并验证 covered view 覆盖 21,500 市场。`runtime-holder-browser.mjs` 使用 18771 的本地 Vite 和 18772 的实际 Read API 验证组件；它不加载钱包或公开 RPC。该目录中的历史超时和浏览器夹具失败保留，不覆盖成成功。

Worker 的 SQL 故障/租约/模式切换及批量计数回归位于 backend-ts 的 `resident-worker.test.ts`、`holder-shared-coverage.test.ts`、`holder-balance-batches.test.ts`；使用独立本地 schema，串行执行。

## Explore 定向验收

使用 Node 24 和专用本机 PostgreSQL，运行：

```sh
TG_TEST_DATABASE_URL='<专用 loopback PostgreSQL URL>' node --experimental-strip-types tools/full-local-integration/explore.mjs
```

脚本创建并清理独立 schema，构造 120 个合成市场，通过真实 Read API 验证桌面与移动端的双阶段 Stock 筛选、筹资比例、全量市值/最近买入排序、独立分页、价格更新后的稳定市值分页、事件更新置顶、搜索、数据延迟提示、Bloom 阶段转换和配置复用。输出位于 `outputs/explore-browser.json` 与 `outputs/explore-browser/`。这项验收没有链上交易，不能替代测试链真实资金流程验证。

排名规模验证：

```sh
TG_TEST_DATABASE_URL='<专用 loopback PostgreSQL URL>' node --experimental-strip-types tools/full-local-integration/ranking-capacity.mjs
```

构造 20,000/50,000 项目，每项目 20 笔历史买入（最终 1,000,000 笔），检验第 100 页无重复、Stock 筛选、搜索、16/64 并发及排名生成耗时，结果写入 `outputs/ranking-capacity.json`。这是本机数据库基准，不代表线上容量；正常运行结束会删除独立 schema。
