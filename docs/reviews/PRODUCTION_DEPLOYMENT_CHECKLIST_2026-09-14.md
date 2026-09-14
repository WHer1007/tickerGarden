# 最新合约生产部署检查清单

> 历史检查单（2026-09-14）：保留作为当日证据，不代表当前生产放行状态。最新准备工作见[生产发布准备报告](./PRODUCTION_RELEASE_PREPARATION_2026-09-15.md)和[RH 主网发布 Runbook](../runbooks/RH_MAINNET_RELEASE_2026-09-15.md)。

检查日期：2026-09-14。结论：**当前源码回归与主网 runtime 分阶段模拟通过，但 RH 4663 尚不满足生产广播及开放用户资金条件。** 状态保持 `NOT_PRODUCTION_READY / NOT_BROADCAST`。

本轮只读取源码、配置和主网状态，在本地 Fork 模拟部署，并新增本报告及证据。未改变合约、生产参数、历史计划或放行状态；未签名、广播、部署或开启 worker。没有读取生产私钥。已有用户确认继续有效，不要求重新选择 Treasury、治理 Safe 或资产范围。

## 1. 已核实的最新版本

- 当前工作区的 **70 个生产 Solidity 文件**逐项 SHA-256 与上一轮优化完成后的测试快照一致，没有新增源码漂移。上一轮该版本为 **1,062 项非 Fork 合约测试 + 4 项 Robinhood 主网 Fork 测试通过**；本轮没有重复执行这两套完整测试。
- 本轮重新核验 22 个构建产物、582 项来源哈希；额外核验 RH 主网部署脚本的 170 项源码来源和主网 Orchestrator 的 4 项来源，全部通过。
- runtime 预算检查通过：Factory **23,515 bytes**，项目预算余量 **485 bytes**；FeeVault **23,107 bytes**，余量 **393 bytes**。预算没有放宽；任何后续合约变更都需要重新编译、测体积和生成地址计划。
- 当前 Git HEAD 为 `8750d2788ab83fda725bed19c634ee6979608b85`，工作区有未提交及未跟踪文件，包括生产依赖 `StaticLPFee.sol`。**该 HEAD 不代表本次已验证的工作区源码。** 生产发布必须捕获完整版本，不能直接从旧 HEAD 构建后宣称是本候选。

证据：[本轮来源核验](./evidence/production-readiness-2026-09-14/source-verification.json)、[源码和配置哈希](./evidence/production-readiness-2026-09-14/source-sha256.json)、[体积检查](./evidence/production-readiness-2026-09-14/runtime-size.log)、[上一轮完整验证](./CONTRACT_OPTIMIZATIONS_IMPLEMENTED_2026-09-14.md)。

## 2. 已有确认，不需重新决定的配置

| 项目 | 当前已选择的值 | 本轮核验及适用边界 |
| --- | --- | --- |
| 网络 | Robinhood mainnet，chainId **4663**，Gas 使用 ETH | 主网 RPC 实读一致；不是测试网 46630 |
| Treasury / Pause Guardian | `0xB993fD249D997EfB3F4E2f7F2948FcC247e4BC7b` | 用户已确认；Safe 状态本轮复核 |
| Governance / Unpause | `0x9d24c6D24CaCCF9C5Fc03d566D3f2c4C42b77248` | 用户已确认；Safe 状态本轮复核 |
| Deployer / bootstrap admin | `0xaF8D8Ac7F359135f19aE6b6f63FC0e7053C7BA31` | EOA，nonce **2**，余额 **0.040912249720149734 ETH**；余额能否覆盖最终发布须按完整交易包计算 |
| Holder 发布者 / Keeper | `0x2cFb6cAa2042690fc928CE0ccE40F3828336dE44` | 用户指定共用；地址校验通过，尚未链上配置；2026-09-15 更正：部署初始化时配置 Keeper，链上复投可用，链下按需执行 |
| 权限延迟 | 治理 **48 小时**；Unpause **24 小时**；Guardian **0** | 已选定，尚不是链上授予完成的证明 |
| Quote 范围 | **196 = 194 Stock + ETH + USDG** | cbBTC、单列 WETH 不在本次范围；清单是选定状态，不是 ACTIVE 回执 |
| Stake 范围 | **194 Stock**，每项最低市场总分配量 **0.5 Token** | 当前均 18 decimals，`500000000000000000` raw；不是每次 deposit/追加的最低金额 |
| ETH 毕业 / 虚拟储备 | **3 ETH / 1.2 ETH** | 已批准 raw 值 |
| USDG 毕业 / 虚拟储备 | **7,000 / 2,800 USDG** | 6 decimals；已批准 raw 值 |
| Stock Quote 毕业 / 虚拟储备 | 2026-09-12 已批准的逐资产 raw 阈值 / 阈值的 **40%** | 阈值基于当期 7,000 USD 等价计算；196 项均有批准值，40%关系全部验证通过 |
| Holder / 领取 / 首买 | `wallet-snapshot-v1`；Quote/Meme 原资产领取；首买由调用者钱包提供所选 Quote | 当前代码规则；不恢复旧内部兑换参数 |

Stock 阈值默认沿用已批准清单，不自动随美元价格变化。若业务希望重新按部署日 7,000 USD 等价定价，需明确批准刷新后的逐项 raw 值并重新生成 economicsHash；这属于变更既有批准值，不应在部署脚本中偷偷重算。

Safe 与依赖观测固定在主网区块 **62,916,085**，hash `0xdb5de36320803e6353f9547bf5a73fc00bb3f23aa2d3c614a19826174853ff26`。读取开始时间 `2026-09-14T15:31:28.438Z`，结束前再次校验区块哈希。两组 Safe 均为 **1.4.1、2/3**，两组 owners 不重叠，Safe nonce 均为 0，未启用 module，guard 为零；owner 与 singleton/codehash 均与此前批准证据一致。这证明链上配置，不能证明所有签名人现在能完成签名。

PoolManager、PositionManager、Permit2、CREATE2 deployer 的代码哈希和 PositionManager 依赖绑定检查通过；Router/Quoter 也复查未漂移，但当前部署构造配置不再把它们作为内部奖励兑换依赖。地址与 [Uniswap 官方 Robinhood 部署清单](https://developers.uniswap.org/docs/protocols/v4/deployments)一致。网络标识与 [Robinhood 官方连接文档](https://docs.robinhood.com/chain/connecting/)一致。详见 [本轮主网读取](./evidence/production-readiness-2026-09-14/live-chain.json)。

## 3. 广播前必须完成的工程环节

### A. 更新生产配置模板并冻结正式候选

[`config/master.env.example`](../../config/master.env.example) 仍写 `V1_DEPLOYMENT_HOLDER_MODE=dual-asset-24h-v4`，而 [`V1HolderModeSelection`](../../contracts/script/v1/V1HolderModeSelection.sol) 只接受 `wallet-snapshot-v1`。照旧模板运行会直接失败。模板里旧 Holder stream/funding interval 预期也需按当前快照模式清理或隔离。这里检查的是公开模板，不推断未读取的生产秘密配置也有同样错误。

冻结完整源码、编译器/optimizer/EVM 设置、ABI、runtime/initcode、权限矩阵、经济参数和发布摘要。`spec/v1_execution_manifest.json` 的通用 `DEPLOYMENT_ELIGIBLE` 与日期较旧的门禁状态不构成本次 RH 生产放行；目标链 preparation 仍明确 `CONFIGURED_NOT_DEPLOYMENT_ELIGIBLE_NOT_BROADCAST`。

### B. 重新生成正式 4663 交易包，不能使用旧地址

本轮用当前源码、`wallet-snapshot-v1` 和上述新主网固定区块成功执行 `DeployV1RobinhoodMainnetStaged.simulate()`。它只在本地模拟，不产生可签名广播包。

| 候选标识 | 本轮模拟值 |
| --- | --- |
| releaseId | `0x0dd93098d90296b10c46c7c360a3a7771e1041b0c8078a238087f1f574e2d5fb` |
| Orchestrator | `0xeE3441B96545056256a8CC4a53E7428BE5070fd1` |
| Factory | `0xA709CbF0AfFBD5B80bC8db08078ddfBd205A2f4f` |
| payloadHash | `0xac396784c8224ff1b1bec7e287dc788bdba1dd081e746faea34289dd3dcb37d8` |

这些是模拟候选，**不是已部署地址或已批准生产地址**。preparation 引用的旧 Factory 为 `0xB5be9b532113A00fdc056d404Faa3b881edaCb79`，旧 payloadHash 也不同；旧计划不能继续用于签名。

runtime 安装路径为 **19 个操作：部署 Orchestrator、begin、16 个 component、finish**；不包含资产激活和权限交接。需要为每笔冻结 `chainId/from/to/value/data/nonce/gasLimit`、费用上限、initcode/runtime 哈希、预期回执，以及失败/中断后的继续规则。旧测试网 46630 的 unsigned pack 不能复用。

本轮链上 `getMaxTxGasLimit()` 与 `getMaxBlockGasLimit()` 均为 **32,000,000**。模拟最重的 finish 为 **15,162,717 执行 Gas**，16 个 component 中最大为 **5,212,535**。这表明分阶段 runtime 路径在本次局部执行量上有余量；**它们不是最终交易 Gas limit**：同一模拟内的账户预热、完整交易 intrinsic/calldata、L1 data fee、begin 开销和安全余量尚未逐笔验收。须使用最终交易包做独立逐笔模拟、费用预算和余额检查。

现有 [`tools/simulate-rh-mainnet-staged.mjs`](../../tools/simulate-rh-mainnet-staged.mjs) 默认输出到 preparation 引用的历史证据目录。本轮使用独立只读包装器，避免覆盖旧证据；正式流水线需明确不可覆盖的 release 输出目录。releaseId 当前由配置派生，最终放行还必须绑定源码/产物和 payloadHash。

证据：[模拟摘要](./evidence/production-readiness-2026-09-14/staged-simulation-summary.json)、[完整模拟日志](./evidence/production-readiness-2026-09-14/staged-simulation.log)、[本轮包装器](./evidence/production-readiness-2026-09-14/simulate-current.mjs)。日志有旧测试/临时 helper 产物的解析提示和第三方 source lookup 提示；当前发布产物的源码来源已另行逐项核验，模拟 exit code 为 0。

### C. 完成 194 Stock / 196 Quote 的真实激活计划

数量和经济参数已经批准，但仓库未找到绑定本次 4663 候选的最终 activation-plan、生产回执或 deployed catalog。必须生成：

1. 194 Stock 的最新 Token/UID/decimals/Beacon/implementation 指纹、精确转账和发行方权限审查证据，绑定本次实际 canonical UserStockVault 地址；不能把旧指纹当作实时确认。本轮没有重新探测全部 194 Token。
2. 对应 baseline、LaunchTemplate 和版本化哈希；各模块真实 runtime/依赖地址绑定。
3. 196 Quote 的 `configId/economicsHash`、raw 参数与明确调用路径，按依赖顺序生成登记交易；控制每批 Gas。
4. 登记后逐项回读 ACTIVE、Vault/UID、minimumAllocation、Quote 参数/指纹，保存回执并更新生产 manifest。

**准入政策已确定，不是新的待决策项：** [Quote 管理员审核白名单政策](../v1/V1_QUOTE_WHITELIST_POLICY.md) 已记录用户批准通过通用 `addQuoteConfig` 登记可升级 Stock proxy；2026-09-12 又明确批准本次全部 194 个 RH 官方 Stock Token 作为 Quote，机器清单对应 `ADMIN_REVIEWED_WHITELIST`。本候选按该既定政策生成注册交易，无需重新确认名单或准入方式。`addStockQuoteConfig` 是代码提供的可选、更严格的 Stock Registry/实现指纹承诺路径，不是本次必须额外选择的门禁；不能因为清单含 `expectedFingerprint` 就擅自将发布改为该路径。尚待完成的是部署前身份与参数核验、实际登记和 ACTIVE 回读。

更正：本报告初版把“具体准入路径”列为待产品决策，没有充分纳入已批准的白名单政策；本段及第 6 节现已纠正。生成器 `python3 tools/generate-v1-paired-assets.py --check` 再次通过，确认清单与所引用的官方目录及参数证据一致：194 个 Stock Quote，加 ETH/USDG 共 196 个 Quote；194 个 Stake。

见 [全资产生产流程](../runbooks/RH_MAINNET_ALL_ASSETS.md)、[Quote 注册实现](../../contracts/src/v1/modules/ApprovedQuoteRegistry.sol)。

### D. Safe 执行演练、selector 绑定与 bootstrap 退权

已有地址无需重选；还需验证所有必要签名人的实际控制权和可用执行流程，形成签名/执行演练记录。按最终目标地址生成完整 AccessManager target-selector-role-delay diff，并验收治理 48h、恢复 24h、即时 Guardian 的真实执行行为。

尤其注意 [`deriveV1AccessManagerPlan`](../../deployments/src/v1/access-manager-plan.ts) 的 `holderRewardsDistributor` 是可选输入：本候选必须传入，确保 `setSnapshotPublisher(address)` 在 bootstrap 结束前绑定到延迟治理角色。按用户更正的首发策略，完整激活计划必须包含 `GraduationExecutor.setCompoundKeeper(0x2cFb6cAa2042690fc928CE0ccE40F3828336dE44)`：在 bootstrap 的默认 ADMIN_ROLE(0) 权限仍有效、尚未将该 selector 绑定到延迟治理角色前执行，并回读 Keeper 为指定地址；随后绑定该 selector 的治理角色，保留后续轮换能力。**先验收这些配置，再让部署者放弃 ADMIN_ROLE(0)**；按现有冻结方案，退权后不能再靠临时补 selector 修正遗漏。仅完成 19 个 runtime 安装操作而未配置 Keeper，不满足本次完整部署验收。

确认治理角色 1、Guardian 角色 2、Unpause 角色 3 的成员/延迟及 role admin 关系，逐项证明部署者不再保留应移除的角色。不能把 Safe 地址存在或只读 `getOwners` 成功当作交接完成。暂停能力主要控制准入，不能当作既有市场交易总开关。

### E. 关闭当前发布校验与独立审查缺口

上一轮 `check:deployment-track` 中 68 项部署测试通过，但随后旧计划仍触发 `/configurationInputs must NOT have more than 21 items`，整条 track 未通过。应更换/生成与当前代码及目标链一致的合法计划并重新验收，不能放宽 schema 让旧计划过关。

本候选仍缺正式 staged deployer/交易包独立安全审查、完整版本安全签字及仓库要求的来源/许可批准。仓库中内部审查和历史报告不替代本版本签字。当前代码回归和只读模拟也不构成广播授权。

## 4. 开放生产业务前必须完成的运行环节

### Holder 发布账户和生产工具

**用户已指定生产 Holder 发布者为 `0x2cFb6cAa2042690fc928CE0ccE40F3828336dE44`，与 Keeper 共用。** 地址格式及 checksum 校验通过；这属于公开地址登记，不是控制权证明或链上配置回执。已记录到主网准备清单的 `holderSnapshots.publisher`，地址不再属于待确认项。

[`HolderRewardsDistributorV1`](../../contracts/src/v1/modules/HolderRewardsDistributorV1.sol) 构造后 `snapshotPublisher` 为零，不默认信任 deployer。生产启用前需将已指定地址配置到 Distributor，并明确负责人、签名保管方式、Gas 费用上限/补充方式、发布频率、快照 finality、数据集保存与核对流程，完成端到端发布/领取/紧急撤销演练。合约单批最多 **32** 个 Publication；不应继续套用旧 24h stream 模式参数。

发布者对链下余额计算和分配正确性是受信任主体，Merkle proof 只证明被包含在 root 中。Guardian 可撤销未来发布能力，不能改写已发布 root。因此发布者选择及数据审查责任需明确落到人/账户，而非把 root 发布视作普通无权限 cron。

**当前还存在工程缺口：** [`holder-publication-cli.ts`](../../services/backend-ts/scripts/holder-publication-cli.ts) 明确只允许 `TG_ENVIRONMENT=test`，身份和 deployment 固定 `46630`；[`holder-snapshot.ts`](../../services/backend-ts/scripts/holder-snapshot.ts) 的 prepare/preview/funding 同样为测试网。共享库可以接受 deployment identity，但仓库未找到可直接使用的 4663 生产入口。仅填写 `TG_SNAPSHOT_PUBLISHER_ADDRESS` 或把环境名改成 production 不能完成适配。

需要保留双 RPC、nonce/receipt reconciliation、journal、Gas cap、finality 和数据校验，新增经过验收的主网配置入口，绑定最终 releaseId/Distributor/activation block；完成后再开放 Holder 收益功能。链上资金到账而未发布 root 时，用户无法取得相应轮次的可领取证明。

### 前后端生产绑定与验收

当前 Read API 默认 deployment、Pipeline 多个入口、Content 签名域仍使用 `46630` 和测试 release。它们是现有测试发布的明确边界，不是已完成的主网部署配置。需要生产 4663 的地址 catalog、ABI、release digest、activation block、RPC/索引起点和数据库身份一致绑定；不能仅改前端 chainId。

在生产配置下完成创建、钱包 Quote 首买、交易、原子毕业、Stake/退出、Creator/Staker/Holder 原资产领取，以及暂停准入和紧急操作演练。建立监控/告警、故障 runbook 与仓库要求的 **72h canary soak**。这些运行验收可以在受控部署后完成，但必须在正式开放资金前闭合。若另行部署 Vercel 服务，按项目要求显式 `--regions sin1` 并验证每个运行函数区域。

### LP 复投的首发配置与链下执行

**2026-09-15 用户更正：部署初始化完成时，链上 LP 复投功能必须可用；链下暂不启用自动调度，后续根据运营情况按需复投。** 先前将“不自动执行”解释为“链上 Keeper 保持零地址”不符合用户意图，本节及准备清单已经修正。

部署激活流程必须把 [`GraduationExecutor`](../../contracts/src/v1/modules/GraduationExecutor.sol) 的 `compoundKeeper` 配置为 **`0x2cFb6cAa2042690fc928CE0ccE40F3828336dE44`**，并回读确认；该地址与 Holder 发布者共用。合约无独立的复投 enable 开关，配置非零 Keeper 后该钱包即可按规则调用复投。构造后的短暂未配置状态属于 bootstrap 中间状态，不能作为完成部署的最终验收状态。

[主网准备清单](../../deployments/manifests/robinhood-mainnet-4663.preparation.json) 分别记录 `onchainEnabledAtLaunch=true`、指定 `keeperAtLaunch`、`schedulerEnabled=false` 和 `executionPolicy=OFFCHAIN_ON_DEMAND`。这是待执行的部署要求，不是已完成链上配置的证明。本次没有执行广播或启用调度。

Keeper 就绪后，后续按需复投无需再走一次治理启用流程，也无需重部署合约；每次链下生成当前费用/流动性/投入限额和 deadline、模拟后由 Keeper 提交。更换或撤销 Keeper 才使用已有治理流程。后续如需周期调度，则按运营安排启用。

每次使用共用钱包时，必须按 chainId + 钱包统一串行分配 nonce、协调 Holder 与复投 pending 交易及重试；手动按需执行也不能与 Holder 签名并发。当前两套独立工具的锁和 journal 尚未实现跨任务协调，需在实际共同使用前落实外部互斥/协调。复投没有执行时不会自行发送交易。

## 5. 尚未关闭的仓库生产门禁

`spec/v1_execution_manifest.json` 当前 `productionReady=false`，仍有以下 8 项 open。它们不应凭本轮检查自动清除：

| Gate | 所需闭环证据 |
| --- | --- |
| `V1-G0-PONS-SECURITY-01` | 本项目采用的参考基线和差异实现的安全审查结论 |
| `V1-G0-LEGAL-01` | 项目要求的产品法律批准 |
| `V1-PROD-AUDIT-01` | 最终版本审计/安全签字，无未关闭 Critical/High |
| `V1-PROD-LICENSE-01` | 参考实现与源码许可批准 |
| `V1-PROD-ROLE-TRANSFER-01` | Safe 角色/延迟回读、部署者退权回执 |
| `V1-PROD-SOURCE-VERIFICATION-01` | 最终部署源码验证、可复现构建和链上代码匹配 |
| `V1-PROD-MONITORING-RUNBOOK-01` | 生产监控告警、应急 runbook 可执行 |
| `V1-PROD-SOAK-72H-01` | 绑定本生产候选的 72 小时受控运行验收 |

## 6. 需要决策与需要执行的区分

尚需落实 **Holder 发布运行策略**，在启用 Holder 收益前完成配置和验收。Holder 发布者及 Keeper 已指定共用 `0x2cFb6cAa2042690fc928CE0ccE40F3828336dE44`；Stock Quote 的管理员审核白名单政策及全部 194 个 RH 官方 Stock Token 的范围已确定；LP 复投的链上权限在部署初始化时配置好，链下按需执行且首发不启用自动调度。这些地址和首发策略不再列为待决策。已批准的 Treasury、治理地址、资产数量、0.5 Stake 门槛及 raw 毕业参数继续沿用；只有要改变这些值时才需重新批准。签名交易的 Gas 费用上限需在完整交易包估算后落实。

其余是必须完成的工程和验收工作：冻结完整版本 → 同步模板并生成新 4663 unsigned pack → 逐笔模拟/费用校验 → 生成并审查全资产与权限激活计划 → 完成安全签字及签名演练 → 获得具体广播授权 → 部署回执/源码验证/激活回读 → 生产服务适配和完整业务验收 → 关闭运行门禁后开放。

本报告是部署前检查结果，不是 release certificate，也不授予任何广播权限。
