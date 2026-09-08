# 连续持有人奖励 release：剩余测试台账

日期：2026-09-07。本文只登记当前连续奖励 release 的测试缺口和可沿用证据，不构成部署、广播或生产批准。新 release 已完成测试链部署与激活；全部业务和服务验收尚未完成。

## 当前有效证据

| 证据 | 环境 | 已覆盖且可沿用 | 边界 |
|---|---|---|---|
| `outputs/reviews/protocol-optimization-2026-09-07/REPORT.md` | 本地、产品轨道 | Python 63/63、Web 111/111、API 39/39、Indexer 32/32、部署工具 60/60、Maintenance 33/33、Go/contract-check、CI product 316/316；连续奖励接线、Creator 两步交接、维护队列和产物绑定 | 不等于公共链、真实钱包、真实 v4 池或线上服务；854 项初跑的 manifest 失败已刷新产物后定向复测通过 |
| `outputs/reviews/rh-alchemy-fork-2026-09-07/REPORT.md` | RH 4663 本地 Fork，固定区块 55747994 | 4/4 Fork、6/6 夹具；真实 Stock/v4、质押开关、Creator tax、连续奖励真实 v4 兑换、12h/24h领取、两步收益地址交接 | Foundry deal/warp；不等于公共链或生产广播 |
| `outputs/reviews/arbitrum-continuous-simulation-2026-09-07/REPORT.md` | Arbitrum Sepolia RPC Fork 模拟 | 19/19 部署模拟、17/17 校验器、payload/绑定/证书重算 | 此模拟证据本身不证明真实部署或业务执行；真实执行另见当前 acceptance 报告；模拟 gasLimits 不可直接签名重放 |
| `outputs/reviews/r6-fast-test-2026-09-06/REPORT.md` | R6 测试 release，Arbitrum Sepolia | 16 组合、8/8 root、8/8领取、8/8结转及自然阶段可作为旧 R6 历史证据 | R6 参数和旧 Root/TWAB 语义；不能替代连续奖励 release |
| `outputs/reviews/continuous-release-acceptance-2026-09-07/{REPORT.md,case-results.json}` | Arbitrum Sepolia 421614，新 release `0xc822…d057f` | DEPLOY、ACTIVATE、NATURAL-EARLY、V4、CREATOR-HANDOVER 已 PASS；STREAM-EDGE 为部分通过并等待链上时间；NATURAL-END 等待链上时间；SERVICE 进行中；BROWSER 等待用户钱包连接 | 报告明确为 `IN_PROGRESS_NOT_FINAL_ACCEPTANCE`；不构成全量验收、生产批准或 RH 广播 |
| `outputs/reviews/continuous-edge-public-2026-09-07/{receipt-audit.json,results.json}` | Arbitrum Sepolia 421614，新 release | 78 笔来源交易回执已核对（77 成功、1 个预期回退）；idle 恢复、历史收益隔离和 64 流满容量回退/继续领取已有证据 | 仅回执、交易、区块及运行器会计证据；容量到期重试未完成；隔离检查另见 isolation-audit.json，且不是完整业务验收 |
| `outputs/reviews/continuous-v4-public-2026-09-07/{receipt-audit.json,results.json}` | Arbitrum Sepolia 421614，新 release | 68 笔来源交易回执、曲线/费用/受益人/偿付观察审计；两个 ERC20 市场和 Creator handover 已有通过记录 | `RECEIPTS_AND_OBSERVED_ACCOUNTING_VERIFIED` 仅覆盖快照中的交易，不是完整业务验收或独立重算 |
| `outputs/reviews/continuous-service-2026-09-07/pipeline-progress.json` | Arbitrum Sepolia 421614，真实服务观察 | finalized journal 已建立并推进；manifest/start block 已修正，discovery 已恢复 | projection 已从检查点恢复至 306128262，后因历史 RPC 限制退出；测试 transport 的报价/签名/lease/recovery 已通过，完整 Go 投影/API 仍未验收 |

## 连续奖励 release 的剩余测试

| 项目 | 验收证据/环境 | 当前状态 | 可沿用证据 |
|---|---|---|---|
| 新 release 逐笔部署与 runtime/权限/绑定核验 | Arbitrum Sepolia 真实 receipt；新 release manifest、codehash、Factory/Registry/Hook/FeeVault/Distributor 绑定 | 已完成（19 笔交易、21 项核验 PASS；仅限 421614 快照） | `REPORT.md`/`case-results.json`；不等于 RH 或生产广播 |
| 部署后激活与 settlementOperator 配置 | Arbitrum Sepolia 真实交易和前后状态 | 已完成（5 笔激活及越权探测 PASS） | 当前 release activation.json；不替代生产权限批准 |
| 连续奖励真实 v4 全链路 | Arbitrum Sepolia：创建、首买、曲线买卖、毕业、Hook 归集、Meme→Quote兑换、Token callback | 已完成当前快照主路径（V4 PASS；68 笔回执/观察审计） | 仅来源快照交易；不宣称完整业务验收或 RH |
| 24 小时释放与领取 | Arbitrum Sepolia 真实时间：资金到账、到期释放、余额和负债独立核对 | 前半程已完成；末尾释放/最终领取等待链上时间 `1788808343` | 必须到期后按链上 timestamp 执行；不能用 warp/模拟替代自然时间 |
| 持仓变化规则 | Arbitrum Sepolia：新买入者不继承先前已累计收益，但参与买入后的剩余释放；卖出者保留已赚收益 | 早期转账/领取及 idle 恢复路径已有通过证据；跨市场/资产隔离已补充历史 RPC 审计 | edge receipt audit 只覆盖来源快照，不能代替剩余跨市场/资产审计 |
| 无有效供应与多流容量 | Arbitrum Sepolia：无有效持有人时暂存；恢复后重新释放；64 流上限只回滚本次 funding且可重试 | idle/恢复及满容量回退通过；容量到期重试等待 `1788809739` | 78 笔回执含 1 个预期回退；重试尚未完成 |
| 跨市场、资产和 Creator epoch 隔离 | Arbitrum Sepolia 多市场、多资产、收益地址交接后的余额/负债审计 | Creator 两 epoch 交接及两个 ERC20 市场已有通过证据；成功注资与回退两路径的跨市场/资产隔离审计已通过 | v4 audit 为观察性快照，不是完整业务验收或独立账本重算 |
| 真实维护服务闭环 | 独立 PostgreSQL、Indexer、discovery、持久 lease、quote/simulate/signer、receipt reconciliation、重启恢复 | 进行中；finalized journal/discovery 已恢复，projection 恢复后受历史 RPC 限制；测试 transport 恢复通过，完整 Go 闭环未验收 | `pipeline-progress.json` 明确不是 full service acceptance |
| 浏览器钱包联调 | Chrome + MetaMask：创建、质押、领取、拒签、替换交易、实时刷新、截图和 receipt | 等待用户手动 MetaMask 连接；未宣称浏览器交易验收 | API/CORS 已配置/验证；扩展访问受浏览器策略阻断 |
| 独立安全与白名单审查 | 当前 release 的代码、Quote/Stock 白名单和权限矩阵；独立审查记录 | 未完成 | 当前本地审计/产物校验不能代替独立审查 |

## 不应重复的旧测试

连续模式取消 Root、TWAB、固定 7 天 epoch、Merkle proof 和 30 天 claim window。旧 `R5/R6-HOLDER-02/03/04/05`、`R5/R6-REWARD-03` 只在旧 Treasury release 仍需验收时保留；不能在新 Distributor 上照搬。R6 的 16 组合和自然阶段已完成，不重复执行无源码变化的旧 R6 测试。

旧 R5 的 7 个 ETH GRAD 阻塞项仍只属于旧 R5 release 的公共资金缺口：`R5-MATRIX-ETH-{S0-H0-T0,S0-H0-T500,S0-H1-T0,S0-H1-T500,S1-H0-T0,S1-H0-T500,S1-H1-T0}-GRAD`。它们不自动转化为连续奖励 release 的缺口。

## 生产边界

生产治理、密钥恢复、RH 生产广播和经济参数批准属于独立发布门禁，不作为当前测试链测试的前置完成项，也不能因测试链通过而宣称完成。当前结论为：新 release 测试链部署和业务验证仍在进行，未形成生产就绪结论。

## 检查与不确定性

本台账由只读检查生成：`sed` 阅读上述报告，`rg` 检索测试 case/status，`nl` 核对报告行号。未读取 `.env` 或钱包，未执行链上写入，未修改其他文件。报告和测试目录当前存在未跟踪文件；模拟证书有有效期，真实部署前必须刷新链上快照、codehash、nonce、余额和 gas 预算。

新增维护队列时间边界修复、37 项测试及真实 PostgreSQL transport 的两笔兑换恢复证据，见 acceptance REPORT 的后续更新和 continuous-service/conversion/{audit.json,recovery-result.json}。测试 transport 通过不能替代完整 Go 服务验收。


### 2026-09-07 12:24 CST 更新

RPC 缺失与投影版本冲突已解除；以 `outputs/reviews/continuous-service-2026-09-07/v25-progress.json` 为当前服务进度。独立 v25 数据库已回放至 306128259，剩余 13,212 个区块存在历史状态逐块读取效率问题；需处理效率后再完成服务验收，不能直接发布未经对账的快照。回放进程已正常停止，下一次可续跑，不必重建或重复已验收的链上操作。自然时间三组测试与人工 MetaMask 联调仍未结束。
