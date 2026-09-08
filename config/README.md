# 分支与集中环境配置

日常只维护仓库根目录的两份文件：

- `.env.test.local`：当前独立联调，Robinhood Testnet 46630。RPC、数据库、前端地址、合约发布标识、IPFS/Dune 凭证均在这里。
- `.env.master.local`：正式环境，Robinhood 4663。当前没有正式部署配置，`TG_RUNTIME_CONFIGURED=false`，启动器会拒绝启动；不能复制测试地址填充。

文件权限必须为 `0600`，均被 Git 忽略。`test.env.example` / `master.env.example` 是无凭证模板，不是第二套运行配置。旧的 `.env`、前后端局部配置和 IPFS 文件已归档到本机 `.codex_tmp/config-backup-2026-09-09/`，不再自动读取，也不需要继续维护。历史发布目录的 `*.public.env`、JSON、R6 overlay 是证据，不是当前启动入口。

## 当前分支职责

- `test`：保存目前完整的开发与独立联调源码。本轮以 Git checkpoint 固化此前的未提交工作，不等于正式发布批准。
- `master`：保留既有业务源码；只增加集中配置入口和防误用规则。没有把开发分支的合约经济策略自动合入正式分支。
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
| Raw exit 等待 | 7d | 旧 master 尚无该实现 | 1h |
| Treasury epoch | **7d，新版本** | **30d，旧版本** | 1h |
| Anti-snipe | **5s，新版本** | **3s，旧版本** | 历史快照，勿套用当前源码 |
| Finality | 600s + 2 blocks | 正式候选配置为 600s + 2 blocks | 600s + 2 blocks |
| Root publication / review | 24h / 1h | 正式候选配置为 24h / 1h | 20min / 5min |
| Claim window | 30d | 正式候选配置为 30d | 2h |

**7d epoch 与 5s anti-snipe 是合约策略升级，不是测试加速。** 旧 master 也没有新版 Raw-exit 结算实现（配置明确标记 `not-implemented`，不是零等待）。 合并 test 到 master 前，必须明确审阅这两项及同步 ABI、参考模型、TWAB schema、后端结算，而不是只把环境名改成 master。上表的 master 金额/可配置时间是源码规范或候选基线，不代表已有主网合约部署事实。

金额按配对资产原始单位存储，不可把所有 Stock 的门槛当成 ETH 门槛。本次当前发布中 TSLA 为 2.6 TSLA；其余资产分别使用 `apps/web/public/integration/rh-f72a2cdf.json` 中绑定的 quote 配置，公开地址/池信息保留在 `deployments/manifests/`。未为 master 杜撰或复制 Stock 的正式报价配置。

## 启动与检查

在 `test` 分支仓库根目录运行（每个长期服务一个终端）：

```sh
npm run env:check
npm run rpc:test
npm run api:test
npm run content:test
npm run dev:test
```

等价的跨分支入口（master 当前会因未配置部署而拒绝启动）：

```sh
node tools/environment.mjs check master
node tools/environment.mjs run master web
```

测试打包需带测试配置时：`node tools/environment.mjs run test web build`。普通 `npm --prefix apps/web run build` 是无环境的编译检查，不加载任何局部 `.env`。

启动器先检查分支、chain ID、源码锁定时长/epoch/anti-snipe，并核对测试 bootstrap 的 release/factory/ETH economics。拒绝跨分支、旧 R6 短周期、测试主网混用和公开 VITE 凭证变量。Web 仅接收 `VITE_*`；IPFS 凭证仅交给 content-worker；网关仅接收网关配置与 RPC 上游。Shell 中旧的 TG/VITE/凭证变量不会覆盖选定文件。

数据库使用 `TG_DATABASE_URL` 作为共享默认值；确需不同库时保留对应服务的 `TG_*_DATABASE_URL`。服务使用本地预算网关 `TG_RPC_URL`，上游 RPC 只在网关中配置。CU 限制最多 10000/s，仍然是按需查询、首次请求从最新区块起步；本轮没有启动历史回放或链上检查。

## 能改什么

- RPC/数据库/端口/API/IPFS：改选定根配置后重启对应服务。
- `V1_FINALITY_*`、root/claim 窗口：新部署构造参数；本轮没有执行部署，改文件不会更新既有合约。
- `V1_NATIVE_*`：当前环境经济值断言/新候选规划输入。当前已部署 quote 配置是独立不可变记录，变更必须走新 quote 配置及审核，不会随 env 自动改变。
- `TG_EXPECTED_*`：对编译期常量的防漂移断言，**不是 setter**。需要更改时必须同步源码与完整验证，不能通过改 env 缩短锁定时间。

旧的环境写入脚本 `prepare-robinhood-testnet-local-integration`、`activate-robinhood-atomic-business`、`start-continuous-web` 已明确禁用，避免重建分散配置或激活历史地址。历史证据与签名/部署记录未删除，不可通过重跑旧脚本“恢复配置”。
