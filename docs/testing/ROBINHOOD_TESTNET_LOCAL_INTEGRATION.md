# Robinhood 测试网本地联调

本环境固定到 release `0xf7024d03f3844c5b40abfeda80cb4e8c6edc307ba60a17c8c6d2bc9296e26e41`，chain ID 为 `46630`。该 release 已完成 21 个合约的运行时代码验证，并激活测试专用 Baseline、原生 ETH Quote 和 Launch Template。生产目标仍为 Robinhood Chain Mainnet `4663`。

## 已生成配置

- 后端链身份清单：release 目录内的 `backend-deployment-manifest.json`。清单包含 16 个协议运行时与测试网 PoolManager，固定创世块和运行时代码哈希。
- 后端模板：`services/backend-go/.env.robinhood-testnet.example`。
- 前端模板：`apps/web/.env.robinhood-testnet.example`。
- 本机实际配置：`services/backend-go/.env` 和 `apps/web/.env.local`。两者被 Git 忽略且权限为 `0600`；Alchemy key 只写入后端配置，不会暴露给 Vite。
- 索引起点：`115020097`，即首笔激活交易所在区块。它覆盖 Baseline、Quote、Template 的全部激活事件及后续业务交易；不能直接从最后一笔激活交易开始，否则本地投影会缺少此前的有效配置。

如果 release、合约源码或地址发生变化，重新运行：

```sh
node tools/prepare-robinhood-testnet-local-integration.mjs
```

## 启动顺序

本机 Docker Compose 当前不可用，可使用已安装的 PostgreSQL 14：

```sh
tools/local-integration-db.sh start
make -C services/backend-go migrate-up
make -C services/backend-go index-run
```

Indexer 追到目标业务块后，在独立终端依次运行：

```sh
make -C services/backend-go discover-run
make -C services/backend-go project-run
cd services/backend-go && go run ./cmd/content-worker --run
make -C services/backend-go run
cd apps/web && npm run dev -- --host 127.0.0.1 --port 5176
```

本机端口为：前端 `5176`、Read API `8790`、内容上传 `8791`、PostgreSQL `54329`。`GET /livez` 应立即返回 200；`GET /readyz` 在首个可信快照发布前应返回 503，这是财务数据 fail-closed 的预期行为。

Discovery 的空区块回放使用最多 8 路有界 RPC 并发，但仍按区块顺序与 receipt-verified journal 核对并一次性提交 checkpoint。任何 RPC、回执、日志、父块或边界运行时校验失败都不会留下部分进度。

## 当前功能门

前端已配置 Factory、Launch Router、Allocation Manager、Fee Vault、Creator Revenue Registry 和 Holder Rewards Distributor。持有人持续奖励写入和 Treasury proof 写入仍保持关闭，直到对应的公开测试链 E2E 完成并记录 approval token。当前激活只执行了只读 `launchAndBuy` 模拟，没有创建市场或转移 AccessManager 权限。

停止本地数据库：

```sh
tools/local-integration-db.sh stop
```
