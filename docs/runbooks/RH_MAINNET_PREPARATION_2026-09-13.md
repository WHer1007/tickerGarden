# RH 主网地址确认与分阶段准备

> 历史候选记录：本报告中的首买兑换参数和运行时地址计划已被后续 Quote-only Router 修改取代。最新状态见[首买职责边界与外部依赖审查](../reviews/QUOTE_ONLY_LAUNCH_AND_EXTERNALITY_REVIEW_2026-09-13.md)。

日期：2026-09-13。状态：**NOT_PRODUCTION_READY / NOT_BROADCAST**。已完成地址登记、只读链上配置核验、近期主网 Fork 和分阶段运行时模拟。未生成可签名交易包，未修改主网状态。

## 地址与用户确认的角色

| 用途 | 地址 | 当前准备配置 |
|---|---|---|
| Treasury + Guardian | `0xB993fD249D997EfB3F4E2f7F2948FcC247e4BC7b` | 平台收款；Guardian role 2，0延迟 |
| Governance + Unpause | `0x9d24c6D24CaCCF9C5Fc03d566D3f2c4C42b77248` | Governance role 1，48h；Unpause role 3，24h |
| 部署者 / bootstrap initialAdmin | `0xaF8D8Ac7F359135f19aE6b6f63FC0e7053C7BA31` | 临时初始化权限；激活和交接完成后撤销bootstrap ADMIN_ROLE |

这些是待执行的权限配置，不代表当前主网已授予协议角色。用户已明确同意 Treasury 兼任 Guardian、Governance 兼任 Unpause。整个流程不需要向代理提供私钥。

机器清单：[主网准备清单](../../deployments/manifests/robinhood-mainnet-4663.preparation.json)。此文件不是已经签署的发布证书，也不是旧测试网部署计划的替代历史记录。

## 本轮只读核验

使用公开 RPC `https://rpc.mainnet.chain.robinhood.com`，确认 chainId=4663。固定 L2 区块 `61326136`，hash `0x6f97ce05b0e6e33c7343b17a9c815124ced2a035e26a8c52b30358827b6db4e0`，L1 block `25963196`。

两个 Safe：接口返回 VERSION=1.4.1；各3个owner，threshold=2；两组owner无重叠；无启用module；Guard为空；fallback handler均为 `0xfd0732dc9e303f09fcef3a7388ad10a83459ec99`；singleton均为 `0x29fcb43b46531bca003ddc8fcb67ffe91900c762`。Safe交易nonce均为0，ETH余额均为0。

部署者：无合约代码，nonce=2，余额 `0.040912249720149734 ETH`。这是固定区块的观察，不是最终部署余额预算。无需现在转账；需在完整交易包和194/196资产激活成本确定后再测算。

原始返回、owner地址、代理/singleton codehash见 [账户证据](../reviews/evidence/rh-mainnet-preparation-2026-09-13/accounts.json)。本轮检查证明这些地址的链上状态，不证明操作者实际持有签名密钥；正式发布前仍需用户自行完成多签执行演练。没有要求更换或重新创建这两个Safe。

## 两项前置阻塞的进展

### 近期主网 Fork 已通过

新入口 `npm run check:fork-track:mainnet` 读取独立主网准备清单，在启动 Foundry 前核验 chainId 和固定 block hash，经只读兼容代理访问真实状态。派生测试复用既有完整业务断言，没有跳过外部代码哈希、Stock身份、毕业入池或退出检查。

结果：**2项通过，0失败**。涵盖真实Stock身份、创建与毕业、收益处理、Creator归属和本金优先rageQuit。Fork内测试资金和交易是本地合成/执行，不产生主网资产转移。

[完整Fork日志](../reviews/evidence/rh-mainnet-preparation-2026-09-13/recent-fork.log)。旧固定块及测试网计划原样保留；旧 `check:fork-track` 仍针对旧证据，不能把新入口成功解释为旧历史块恢复可用。公共RPC以后可能不再提供这个区块，届时要正规刷新整份pin/身份/依赖证据或使用archive服务，不能静默改为latest或伪造状态。

### RH 4663 分阶段运行时模拟已通过

新增仅允许4663的 `V1RobinhoodMainnetDeploymentOrchestrator`，沿用已测的阶段承诺机制：部署orchestrator → begin绑定全部initcode hashes与finalHash → 按序部署16组件 → finish部署helper/hook/executor/factory。共19笔运行时部署操作；Registry激活、权限交接和业务创建不包括在这19笔内。

授权部署者之外的调用拒绝；不能覆盖begin承诺、错序、提前finish、修改initcode或重复finish。部分图不能当成已完成协议或提前激活。独立主网脚本仅有 `preview()` 和本地 `simulate()`，没有读取私钥或发起广播的入口；其模拟使用prank，不生成钱包交易。

使用实际部署者、Treasury地址及已核对代码哈希的主网依赖完成模拟。PositionManager的PoolManager和Permit2绑定已对照。见 [外部依赖](../reviews/evidence/rh-mainnet-preparation-2026-09-13/dependencies.json)、[模拟输入](../reviews/evidence/rh-mainnet-preparation-2026-09-13/simulation-inputs.json)、[模拟日志](../reviews/evidence/rh-mainnet-preparation-2026-09-13/staged-simulation.log)、[生成运行时地址计划](../reviews/evidence/rh-mainnet-preparation-2026-09-13/runtime-plan.json)。地址计划附生产源和主网部署源码SHA256。

测得各组件内部调用执行Gas最高5,180,048；finish为14,617,164；orchestrator部署为1,179,560。组件及finish在模拟内强制小于28,000,000。

这些数据**不是最终签名交易gasLimit**：不包含独立交易intrinsic/calldata/L1收费，begin单独Gas未记入该表，预热访问与真正逐笔交易也有差异。它们证明分阶段方向可行，下一步仍需独立逐笔模拟和交易上限核验。

模拟暂用 `nativeQuotePoolFee=10000`、`nativeQuoteTickSpacing=200` 的显式候选值，沿用原测试配置；**不代表生产194个Stock的首买路由均有对应池**。输入明确 `routeCoverageVerified=false`，必须核验后才能冻结生产参数。拟定releaseId和预测地址也仅为候选，禁止提前往预测地址转账。

## 验证及剩余工作

- 全本地合约：1005项通过、0失败、0跳过；主网staged新增4项已包含其中。
- 新主网业务Fork：2项通过；分阶段真实依赖模拟通过。
- Execution spec：63项通过；CI/RPC工具：24项通过；fixture、产品artifact一致性通过。
- 本次修改文件的Forge fmt及git diff检查通过。全仓fmt检查另发现既有测试网/Arbitrum脚本空白和空合约格式问题，未改动这些历史文件；不声称全仓fmt通过。
- 未重跑前端/后端测试：本次未修改其运行时代码、ABI或生产业务Solidity；合约部署辅助代码和Fork测试有变动。

下一步：核验并冻结生产首买路由参数；生成每笔带to/value/data/nonce/chainId/Gas上限和initcode/runtime哈希的unsigned交易包；独立逐笔模拟及新部署器安全复核；生成194 Stock/196 Quote注册激活及角色交接计划；完成Safe签名执行演练和发布审核。以上完成前，不能调用旧原子部署脚本直接上线。

复现（在仓库根目录，不需要私钥）：

```sh
npm run check:mainnet-accounts
npm run check:fork-track:mainnet
npm run check:mainnet-staged-simulation
node tools/run-forge.mjs test --no-match-path 'test/v1/fork/**'
```

这里的账户检查重读记录的固定区块，验证可复现性；正式签名前还必须另取最新区块复核Safe、余额、nonce和依赖，不能用这份历史快照证明当前状态。
