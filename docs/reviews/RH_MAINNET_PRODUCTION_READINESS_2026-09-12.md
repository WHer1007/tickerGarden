# RH 主链生产部署就绪复核、参数清单与 ETH 预算

日期：2026-09-12。结论：**NOT_PRODUCTION_READY / NOT_BROADCAST**。

## 1. 是否已经可以生产部署

不能直接部署投产。业务合约近期修复已经通过本地回归，但本轮发现通用原子部署路径超过 RH 主链单笔 Gas 上限；还缺最终主链候选包、独立审计签字、多签交接和运行验收。

本轮基于此前完整链路审查及两轮补丁复核，校验全部 72 个当前 Solidity 源文件与审计及补丁指纹一致，无漂移。复用同一源码状态的 986 个本地测试通过结果；本轮没有重复跑相同完整测试，也没有伪称重新完成第三方审计。重跑产品产物、接口/接口产物、部署门禁，并只读查询 RH 主链依赖、绑定、Gas 和执行上限。

### 硬阻塞：通用部署器单笔 Gas 不可行

- `V1DeterministicDeploymentOrchestrator.deploy` 一次部署 16 个 ordinary components、Helper、Hook、Executor 和 Factory；整个图在一笔交易中完成。
- 在主链区块 **61,132,547**，ArbGasInfo `getMaxTxGasLimit()` 和 `getMaxBlockGasLimit()` 都返回 **32,000,000**。
- 当前对应 20 个运行时产物合计 **223,174 bytes**。仅按 EVM 每字节 200 Gas 的代码存储成本就需 **44,634,800 Gas**，已超过上限；尚未包含 constructor、CREATE、初始化存储、内存和数据费用。
- 所以提高钱包 Gas limit 不能解决。应复用经审查的分阶段设计，制作 RH **4663** 的候选方案，核验阶段顺序、唯一授权、payload/hash 绑定、Hook 地址权限位、CREATE2 预测和中断续跑。
- RH 专用现有分阶段脚本/Orchestrator 固定 **46630**，不能当主链脚本直接运行。通用脚本虽接受 4663，但其原子部署结构存在上述上限问题。

这里的上限来自预编译合约，不采用 RPC block header 的超大占位 gasLimit。

依据：`contracts/script/v1/V1DeterministicDeploymentOrchestrator.sol:67`、`contracts/script/v1/DeployV1Deterministic.s.sol:84`、`contracts/script/v1/V1RobinhoodTestnetDeploymentOrchestrator.sol:56`。ArbGasInfo 接口语义：[Offchain Labs](https://github.com/OffchainLabs/nitro-precompile-interfaces/blob/main/ArbGasInfo.sol)。

### 其他发布阻塞

1. `spec/v1_execution_manifest.json` 仍有八个 production gate：Pons/差异安全签字、产品法律范围、独立审计、许可确认、多签角色交接、源码验证、监控/处置 runbook、72 小时 canary soak。历史 `DEPLOYMENT_ELIGIBLE` 不是当前主链生产证书。
2. 本轮重跑 deployment track：本地部署模块 **62 tests passed**，随后默认历史测试网 plan 因 `Invalid V1 deterministic ordinary component order` 被拒绝，尚未进入该计划的 live 核验。应生成新候选，不能修改历史证据或放松校验。
3. 当前没有最终 RH 主链部署地址、releaseId、payload/initCode hash、权限回执和逐笔模拟预算。修改后的合约需要新的 Fork/E2E 和最终区块 preflight，测试网通过不能替代主链依赖验证。
4. 候选资产清单不是白名单激活。主链 paired-assets manifest 记录 56 个候选资产，状态为 `RELEASE_ASSET_UNIVERSE_SELECTED_NOT_CHAIN_ACTIVATED`；须逐项冻结 Stock 指纹、发行方权限风险、Quote 数值、最低总仓位与登记证据。
5. 全部运行合约须可复现构建与浏览器源码验证；当前工作区有未提交修改，先冻结最终版本。监控包括本金/手续费偿付缺口、代理升级/冻结、事件漏入库、RPC/索引延迟和收款异常。

### 剩余风险处置

本金缺口拒绝新存款、重复 Vault 扫描、领取余额复用、兑换 Gas 储备已在当前本地版本修复，不能继续列为未修漏洞。没有本轮新复现无权限盗取资金的路径。

当前 Factory runtime 为 23,830 bytes，距 EIP-170 的 24,576 bytes 上限仅剩 746 bytes；现版本未超限，后续修改必须继续校验体积。

收款合约拒收 ETH 而无法重定向旧收益的问题仍存在；上线前确认 Treasury/治理及产品支持的合约受益人收款能力，或实现经过审查的 owner-authorized recipient。Stock/Quote 发行方冻结、扣款、rebase 和代理升级是外部资产信任风险；普通 Quote codehash 不锁定代理实现。无运行时全局暂停、无兑换最低输出是既有设计，不擅自恢复旧功能；需要在正式审计及用户说明中准确体现。

## 2. 钱包与权限：纠正此前两个多签的简化说明

当前 `access-manager-plan.ts:101–120` 明确要求 guardian 独立于 governance 和 unpause；governance 与 unpause **可以共用**。部署 EOA 不得保留任何这三个协议角色。

| 地址 | 用途与设置 |
| --- | --- |
| Deployment EOA | 临时部署/激活；`V1_EXPECTED_DEPLOYER` 与 `V1_INITIAL_ADMIN` 相同。完成授权交接后撤销 bootstrap ADMIN_ROLE。不能简单将 INITIAL_ADMIN 改成另一个多签而继续使用现有脚本。 |
| Treasury Safe | `V1_PLATFORM_TREASURY`，直接接收创建费和平台收入；地址在 Factory/FeeVault 中不可变，部署前验证链、Safe 实例、owners、threshold、modules/guards、ETH/ERC20 收款和执行。 |
| Governance Safe | `governanceSafe`，PROTOCOL_ADMIN_ROLE，48 小时执行延迟；可同时担任 `securityOrGovernanceSafe` 的 UNPAUSE_ROLE，24 小时延迟。 |
| Guardian Safe | `guardianSafe`，PAUSE_GUARDIAN_ROLE，无执行延迟；必须与前两种协议角色地址独立。暂停主要影响准入，不能误认为现有交易总开关。 |

资金与治理分离时，清晰的配置是 **三个多签 + 一个临时部署 EOA**。工具未强制 Treasury 与 Guardian 不同，所以两个钱包理论上可把资金与 Guardian 合并；这不等同于一个治理钱包包办所有角色。Signer 人员是否独立需要额外核验，地址不同不保证签名人独立。2/3 或 3/5 等门槛需由团队正式确定，代码不会替团队决定。

## 3. 必须准备的参数

### A. 网络、依赖与不可变部署参数

- RH mainnet chain ID：**4663**；至少主/备只读 RPC、最终性策略及最终区块 number/hash。公开 RPC 本次返回 403，配置的备用提供商完成了读取。
- `V1_DEPLOYMENT_HOLDER_MODE=dual-asset-24h-v4`。
- `V1_RELEASE_ID`、`V1_EXPECTED_DEPLOYER`、`V1_INITIAL_ADMIN`、`V1_EXPECTED_ORCHESTRATOR`；最终编译器/优化配置、源码提交、initCode hash、runtime hash、payload hash、CREATE2 salts 与 Hook permission mask **0x2044**。
- `V1_POOL_MANAGER`、`V1_POSITION_MANAGER`、`V1_PERMIT2`、`V1_SWAP_ROUTER`、`V1_QUOTER` 及各自 `_CODEHASH`；读取并核验 PositionManager 的 PoolManager/Permit2 绑定。StateView 是读取基础设施依赖，也应固定地址/代码证据。
- `V1_PLATFORM_TREASURY` 及 `_CODEHASH`；Safe owner/threshold/modules 等代理状态不能只靠外层 codehash 核验。
- `V1_FEE_POLICY_ID`：由批准的参数生成，不随意填哈希。
- `V1_NATIVE_QUOTE_POOL_FEE`、`V1_NATIVE_QUOTE_TICK_SPACING`：用于原生币到非原生 Quote 的购入路径，须对应真实可用池。不要与毕业池 `PoolKey.fee=0` 混淆；每个非原生 Quote 是否有适用路径须逐项核验。

主链官方依赖本轮查到代码并固定区块核验：

| 合约 | 主链地址 |
| --- | --- |
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` |
| Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` |
| StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` |
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

PositionManager.poolManager/permit2、Quoter.poolManager、StateView.poolManager 与上表一致。只证明本次区块观测，不是完整安全验证或未来不变承诺。官方地址出处：[Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments)。RH 网络出处：[Robinhood connecting](https://docs.robinhood.com/chain/connecting/)。

### B. 经济与资产准入

| 配置 | 要准备的字段 / 当前参考 |
| --- | --- |
| Baseline | referenceChainId、referenceFactory/codehash、launchConfigId、supply、curveFeeBps、poolFee、tickSpacing、behaviorVectorRoot；匹配经济域与两种 token 排序的毕业验证。 |
| Quote | token、decimals、phantomQuote、graduationThreshold、baselineId、economicsHash；ACTIVE 登记与回执。 |
| Native Quote 参考 | 用户已确认生产 ETH 毕业阈值 **3 ETH**；phantomQuote 已同步确认为 **1.2 ETH**。USDG 已批准毕业阈值 **7,000**、虚拟储备 **2,800**。所有生产 Quote 虚拟储备统一为毕业阈值的 **40%**；194 个官方 Stock Quote 已按当期参考价完成 7,000 USD 等价、两位小数阈值计算（见 `docs/references/RH_ALL_STOCK_QUOTE_THRESHOLDS_2026-09-12.md`）；生产共 196 种 Quote，cbBTC 不在本次生产范围。194 个 Stock 全部进入 Stake 名单，最低总仓位均为 0.5 Token。参数确认不等于资产审核或链上激活。phantomQuote 是虚拟储备，不需存入 1.2 ETH。 |
| Supply 参考 | 主链资产清单 supplyReferenceRaw = **10^27**，18 decimals 时为 **10 亿枚**，非 10^30。 |
| Stock Base | token、UID、decimals、Vault、minimumAllocation、token/beacon/implementation 指纹；逐项验证发行方权限和精确转账。minimumAllocation 是新增后最低总仓位，不是每笔最小增量，也不是每笔 Vault 存款门槛。 |
| Stock Quote 可选绑定 | assetUid、stockTokenFingerprintHash、referenceEvidenceHash、generatorPolicyId；普通代理准入和显式绑定准入的信任差异需要明确选择。 |
| LaunchTemplate | Meme/Curve/Gauge implementation 与 codehash、Hook/Executor 与 codehash、feePolicyId、executionSpecId。 |
| 单市场创建 | creatorRevenueBeneficiary、creatorTaxBps、creatorFeesToHolders、stakingEnabled/assetUid、上述配置 ID 和预期 economics；不是协议部署时固定全部市场配置。 |

### C. 当前硬编码 / 配置边界

- Launch fee：**0.0005 ETH/市场**，Factory 常量；不是任意环境变量可调的生产参数。
- 现有 master 模板：Holder 释放 24h；资金注入间隔默认 4h、允许范围 1h–24h；仓位锁 24h；解除暂停最早间隔 24h；anti-snipe 5s。哪些是硬编码、哪些是受控可调需按最终源码与权限映射核验，不能通过改 `TG_EXPECTED_*` 改变合约行为。
- finality 示例为 600s / 2 blocks，属于服务侧确认策略，不是用户需要等待入库的理由。新创建数据仍应立即以已确认创建证据入库，统计由后端事件/定期任务更新，前端遵守数据库读取边界。
- 核心参数必须在链上注册并交叉验证；`.env` 与数据库仅作对应配置，不能代替链上状态。

## 4. 准备多少 ETH

**建议先准备 0.03–0.05 ETH 在 RH 主链作为部署、初始化和权限配置 Gas 预算；按 0.05 ETH 准备更从容。这是预算建议，不是最终精确报价。**

观测时间 2026-09-12 21:12:47（北京时间），主链 chainId 4663，区块 61,132,547，Gas price **91,132,000 wei = 0.091132 gwei**。当时 base fee 为 0.09069 gwei；Gas price 可能在部署前变化。

| 项目 | 依据 | ETH |
| --- | --- | --- |
| 历史测试网核心部署实付 | 19 笔，57,858,847 Gas，0.01 gwei | 0.00057858847，仅为历史测试网事实 |
| 同 Gas 用量按本次主链价外推 | 57,858,847 × 91,132,000 / 10^18 | **0.005272792444804** |
| 主链完整初始化规划区间 | 暂按 100–150 million Gas，含核心、资产注册、配置/多签操作的预留 | **0.0091132–0.0136698** |
| 约两倍成本余量 | 覆盖价格上涨、重试、额外配置 | **0.0182264–0.0273396** |
| 建议钱包准备 | 向上留余量 | **0.03–0.05 ETH** |

100–150 million Gas 是暂定规划区间，不是已模拟的完整交易集；资产数量、多签部署方式、Safe 门槛/签名数据、分阶段方案与调用批次数会改变总量。最终必须在批准的地址与 payload 下逐笔执行 `estimateGas`/模拟，计入 RH poster/data 费用，并设置单笔/总费用上限。历史外推不能直接复用旧交易的 gasLimit；当前合约也有小幅代码变化。

预算不含：

- 自己买币、做毕业验收或提供经济流动性的资金；如要用 ETH Quote 主动推动市场毕业，需要另备数 ETH 级交易资本，3 ETH 是当前批准的 ETH 阈值，不是部署费。
- Stock 购买与质押本金；这些通常是 token 资产需求。
- 将 ETH 跨链到 RH 时源链费用、第三方基础设施与审计费用。
- 每次创建的 0.0005 ETH 是发送创建交易时需带上的 value，并进入平台 Treasury；即便是平台自建市场，也需部署/测试钱包先有这笔余额。

## 5. 下一阶段应交付

1. 确定资金、治理、守护者 Safe 与最终资产/经济参数。
2. 建立 RH 4663 分阶段候选计划，每笔低于主链上限，完成中断恢复与无权限续跑攻击测试。
3. 使用最终代码和主链固定区块完成创建→交易→毕业→LP 锁定→三类领取→Stake/退出→平台收款的 Fork/E2E，并复核资产指纹。
4. 生成可审阅的逐笔 unsigned calldata、预计 Gas/ETH、预计合约地址及角色交接计划。
5. 满足仓库生产门禁；受控部署后的源码验证、权限回执、监控和 72h 验收完成后才开放生产业务。

本轮只读检查与报告，无私钥加载、签名、资金转移或部署广播。证据目录：`outputs/reviews/rh-mainnet-readiness-2026-09-12/`。
