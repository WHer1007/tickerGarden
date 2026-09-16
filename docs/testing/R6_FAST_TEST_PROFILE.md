# R6 独立快速测试环境

用途：在 Arbitrum Sepolia（421614）缩短完整业务验收的反馈周期。RH（4663）仍为生产目标。本配置 **NOT_PRODUCTION_READY / TEST_ONLY**，不能用短周期结果替代 R5 自然周期证据。

R5 主源码、当前 manifest、现有市场及钱包头寸均保留。R6 使用隔离快照 `.codex_tmp/r6-fast-test`，独立 release `0xf2ab431cdae9144d0bd1b5f4f3c52c337e0b77a5aa8fd5504cff3d46bf2eec4f`，独立编译缓存和交易 journal。共享的只有只读依赖目录与用户已有测试账户；不复制私钥。

| 参数 | R5 | R6 快速版 |
|---|---|---|
| 股票整仓锁定 | 24h | 20min |
| 解暂停状态延迟及对应角色配置 | 24h | 20min |
| 原币奖励退出延迟 | 7d | 1h |
| 持有人 epoch | 7d | 1h |
| root publication window | 24h | 20min |
| root review delay | 1h | 5min |
| claim window | 30d | 2h |
| finality | 600s + 2 blocks | 保持 |
| 质押激活 | 30s | 保持 |
| ETH phantom quote | 0.168 | 0.00168 |
| ETH 毕业净门槛 | 0.42 | 0.0042 |

创建费、基础手续费、Creator tax 上限、持有人分配比例保持原规则。20min root publication window 是最长允许发布时间，不必等满；epoch结束后须满足finality再请求，发布后等5min才能finalize。

R6 TWAB schema 为 `TRANSFER_LOG_TWAB_1H_R6_TEST_ONLY`。Solidity、TypeScript root generator、Go root/proof 服务必须一致。Chain、release、distributor、market、epoch、window、source block/hash 仍绑定在证明中。前端隔离副本显示20分钟，主前端不切换至R6地址。

## 执行和恢复

所有部署/验收工具须在隔离目录运行。`run-arbitrum-deployment.mjs` 继续执行源码hash、22编译制品及16组件创建字节码检查、固定payload证书、模拟输入绑定和421614检查。没有绕过任何广播前门禁。

保留失败尝试。只有新源码本地测试、真实v4依赖Fork、完整部署模拟通过后，才能广播。部署后核验全部runtime和地址绑定，再激活新图；不可把R5证明复制为R6通过证据。

重复执行前先查同一交易hash与nonce；不得删除journal重跑。`prepare-r6-fast-overlay.py` 已设重复执行保护。修改快照后必须重新编译、重新生成产物、更新证书并重新模拟。

R6 公共链仍使用真实时间，禁止`vm.warp`或伪造区块。20min、1h和2h时间门禁记录真实receipt及到期前/后状态；2h领取窗口从实际finalize开始计时。服务root依据完整范围canonical日志生成，不能只用测试脚本的离散receipt列表代替全部持仓历史。

### 本轮自然时间执行器

`tools/run-r6-natural-cycle.mjs` 是本轮测试的有限时长执行进程，不是定时任务。它仅接受已完成生命周期准备、没有待排查错误的 R6 journal，按链上时间顺序执行正常退出、解暂停、原币退出、根发布、领取和过期结转，最长运行 6 小时。任一子步骤失败立即停止并保留记录，不自动更换 nonce 或重发未知交易。

本轮已经启动时，不要再启动第二个实例，也不要并行运行其他公共链测试 stage。以下路径都在隔离快照内：

- `outputs/reviews/r6-fast-test-2026-09-06/natural-cycle.json`：执行状态、下一到期时间、子步骤日志。
- `outputs/reviews/r6-fast-test-2026-09-06/public/results.json`：交易和断言的原始 journal。
- `outputs/reviews/r6-fast-test-2026-09-06/public/roots/`：完整 Transfer 扫描范围、canonical header、TS/Go 计算结果。
- `outputs/reviews/r6-fast-test-2026-09-06/public/receipt-audit.json` 与 `holder-audit.json`：独立费用、领取和偿付审计。

执行器会在等待目标变化、正常结束或失败时，把最新证据和报告刷新到主目录的同名 `outputs/reviews/r6-fast-test-2026-09-06/`。只有状态为 `NATURAL_STAGES_AND_RECEIPT_AUDIT_FINISHED`，才表示计划内自然时间步骤及两项独立审计全部完成；这仍不表示浏览器联调、持续服务故障恢复或 RH 生产验收完成。

若进程停止，先查看失败 stage 的日志并核对同一 journal 中的交易回执。修复后，在确认没有另一个写入进程运行的前提下，使用原 stage 命令恢复；该 stage 成功清除执行错误后，才能重新运行自然时间执行器。不要删除 journal 或手工把失败状态改成成功。

## 本轮额外发现：Nitro 区块编号域

部署前的真实RPC探测确认：Arbitrum Sepolia 的 Solidity `block.number` 返回parent-chain估计高度，RPC receipt/header则使用L2高度。旧Treasury `requestRoot`直接记录`block.number - finalityDelayBlocks`，与后端canonical L2历史核验不一致。因此R5持有人自然到期并不足以保证可领取，旧报告的等待项还存在此兼容性阻塞。

R6增加 `CanonicalBlockClock`，在已识别的Nitro链使用`ArbSys(100).arbBlockNumber()`与`arbBlockHash()`，原生EVM使用NUMBER/BLOCKHASH；Nitro预编译不可用时拒绝执行，禁止静默回退。实测Arbitrum Sepolia和RH原生接口的高度/hash均与同一固定RPC区块精确一致，证据见 `outputs/reviews/r6-fast-test-2026-09-06/l2-clock-evidence.json`。回归测试刻意让parent与L2高度不同，检查请求实际保存L2身份。

参考：[OffchainLabs ArbSys 源码](https://github.com/OffchainLabs/nitro/blob/master/precompiles/ArbSys.go)。本修复当前只位于R6隔离快照；R5已部署代码不可原位修改。RH生产发布之前必须将该修复纳入正式源码并独立完成生产周期验证。
