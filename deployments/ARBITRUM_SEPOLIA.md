> R3 测试链更新（2026-09-06）：7 天持有人周期，0.42 ETH 测试毕业门槛，当前链上地址和测试边界见 [R3 报告](../outputs/reviews/arbitrum-r3-scenarios/REPORT.md)。下文 R2 和未部署候选记录保留为历史说明。

# Arbitrum Sepolia 集成环境（RH 仍为生产目标）

生产目标固定为 Robinhood Chain **4663**。Arbitrum Sepolia **421614** 仅用于公开测试和 Uniswap v4 集成；不代表 RH 的资产、权限、预言机或生产运行条件已验收。RH 主网真实股票 Fork 测试保留，默认前端网络仍是 RH。

## 本次账户决策

测试部署者、初始管理员和 root 服务收益接收方继续使用同一账户：`0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea`。平台收益接收方在每条链上必须是合约地址（由 Factory 强制校验），不再允许此前的 EOA 脚本例外。该测试地址由本地安全流程生成；`DEPLOYER_PRIVATE_KEY` 仅在本地安全配置，不进入配置模板或日志。该决策仅适用于测试环境。

当前状态：**DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY**。R2 已完成接收器 1 笔、核心部署 19 笔、配置/激活 5 笔交易；核心 21 个地址的 runtime、关键绑定及管理员角色已核验。核心部署区块为 **305774085–305774584**。执行者已配置为测试钱包，测试基线、ETH quote、模板均已激活；完整 public testnet E2E 与 RH 生产就绪仍未验收。

链上部署记录以 [`arbitrum-sepolia-421614.v1.deployed.json`](manifests/arbitrum-sepolia-421614.v1.deployed.json) 及 [`v1.transactions.json`](manifests/arbitrum-sepolia-421614.v1.transactions.json) 为准。原始 `.v1.plan.json` 的 OPEN 项保留为准备阶段清单，不代表本次广播没有发生，也不能作为生产就绪证明。

- Factory：`0x53cbd5050e05901Ee0A3D7525e534a5A84e357F3`
- LaunchAndBuyRouter：`0x363dDF1FFcDb5D57B0AbEc1e1F89F5D45FD7340B`
- Hook：`0xd97448Ecd13cD4ffef75EA53C2A9d3325c8A2044`
- 最终部署交易：[Arbiscan](https://sepolia.arbiscan.io/tx/0x662e12b5d577408b607319409c1c15416483b1ddb3f9dc3f69b60328949b53fd)

## 接收器阻塞已修复（R2，2026-09-06）

旧接收器无法设置奖励执行者的问题已通过 R2 修复：新接收器仅允许 owner 配置绑定的 FeeVault，拒绝错误目标/零执行者并核验设置结果。公开链配置回执、授权/越权探测及只读创建首购模拟均通过；24 项部署测试、使用真实接收器实现的 Arbitrum Fork 奖励兑换流程通过。

旧 release 保留在 `deployments/releases/0xf79d274aecd0403b355fb06a32b293caf10c14cce74f402d620572857bb1533e/`；旧合约仍在链上，不再作为当前集成目标。详细证据见 [R2 修复记录](../docs/testing/ARBITRUM_RECEIVER_FIX_R2.md) 与 [`activation.json`](manifests/arbitrum-sepolia-421614.v1.activation.json)。

## 网络与依赖

独立计划：`manifests/arbitrum-sepolia-421614.v1.plan.json`。地址来自 [Uniswap 官方部署表](https://developers.uniswap.org/docs/protocols/v4/deployments#arbitrum-sepolia-421614)，实际链 ID、区块哈希、七项依赖代码哈希和 PositionManager 的两项绑定已由 RPC 校验。区块快照过期或节点不再提供历史状态时，必须重新核验并显式更新 pin，不能静默回退 latest。

```sh
V1_TESTNET_TARGET=arbitrum-sepolia npm --prefix deployments run check:testnet-plan-live
npm run test:arbitrum-fork
```

第二个命令先校验网络和依赖，再运行单独的 Arbitrum Fork。RH 的 `check:fork-track` 仍运行 `V1ProductForkE2E.t.sol`，普通合约测试继续排除全部 live Fork。

## 已验证范围和模拟边界

Arbitrum Fork 使用真实 PoolManager、PositionManager、Permit2、Router、Quoter 和 StateView，覆盖：关闭股票质押的市场创建、LaunchAndBuyRouter 原子购买、Creator tax、持有人基础手续费分配、曲线毕业、v4 买入、持有人奖励内部兑换、注资及领取。合约图和测试账户仅存在 Fork 本地状态。

测试中 baseline 使用测试合约本身作为**模拟基线锚点**，持有人 TWAB 使用明确的测试证明。它不是 Arbitrum 上的 Pons 工厂，也不证明生产持有人数据服务就绪。PonsBaselineRegistry 会在本链检查 referenceFactory 代码；RH 工厂在 Arbitrum 无代码，不能直接复制。本次已部署仅测试链允许的 ArbitrumTestBaselineFixture，地址与代码哈希通过链上注册记录及 activation.json 核验。不得放宽生产注册校验或伪称官方 Pons 部署。

前端已按所选链切换至独立的 native ETH 测试配对资产目录，本次 native ETH 配置已在本链激活；签名仍须匹配实时注册表状态。首轮市场使用 `stakingEnabled=false`。RH 的股票地址和配对资产白名单不迁移到 Arbitrum。后续质押测试需要独立测试股票与完整 fingerprint/vault 注册，并标注模拟资产；RH 真股票行为继续由 RH Fork 验证。

## 配置与发布顺序

1. 使用 `config/arbitrum-sepolia.env.example`，将 `0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea` 填入部署者、初始管理员和 root 服务收益接收方字段，并填入已核验的平台收益接收合约。RPC 上核验账户余额及实际 codehash；不要仅凭地址格式假定 EOA。
2. 分配独立 releaseId、部署清单、经济配置哈希；用原有 `DeployV1Deterministic.preview()` 计算本链 CREATE2 计划。不得复用 RH orchestrator、factory 或 Hook 地址。
3. 独立完成部署门禁证据与有效期内、绑定 **421614 + deployer + releaseId + payloadHash** 的发布证书。原有 `V1ReleaseGate` 继续生效；本次生成了绑定此次 payload 的短期证书，并在完整模拟中通过该门禁；广播工具额外绑定模拟输入文件哈希。
4. 使用已有确定性发布入口，确认收据、runtime codehash、Hook 权限位、角色与余额；然后单独激活测试基线、ETH quote 和模板。发布和激活是两个步骤。
5. 将实际部署起始块和地址写入独立索引配置，完成 public testnet E2E 后才能称为“已发布并可测试”。

模板中的 root 服务费用和时间窗口仅为测试配置，仍需在部署 preview 中绑定；生产参数必须独立审核。

### Arbitrum 测试链分阶段发布路径

原有 RH 发布入口 `DeployV1Deterministic.s.sol` 继续保留其一次性原子路径。该路径生成的 248292 字节 calldata 超过 Nitro 默认 95000 字节限制，因此 Arbitrum `421614` 测试链使用测试专用 `DeployV1ArbitrumStaged.s.sol`、`V1ArbitrumDeploymentOrchestrator.sol` 及对应工具，将部署拆为 19 笔交易（最大约 73540 字节）。Nitro 限制依据 [OffchainLabs community-helm-charts Nitro 文档](https://github.com/OffchainLabs/community-helm-charts/blob/main/charts/nitro/README.md)。

分阶段路径先提交完整 init-code commitments，再按固定顺序部署 16 个普通组件，随后部署 helper、Hook、Executor 和 Factory。每笔交易自身是原子的，但整个组件图不是跨交易原子的；部分部署不能激活或对外宣称完成。提交后不可替换 immutable commitments，只能按完全相同的 release、payload 和 commitments 恢复执行。发送方必须在每笔前一笔收据确认后重新估算 gas，因为初始 Forge 估算时链上尚无 live orchestrator code。

24 项部署测试、完整 staged simulation、Arbitrum Fork、链上部署、执行者配置及测试配置激活均通过。public E2E、浏览器源码验证和 RH 生产发布仍属于后续步骤。

Arbitrum Sepolia 的测试专用平台收益接收合约为 `ArbitrumTestTreasury`：`0xB39BD5e7BB13CF2C0EA513e8bE69b6DCa3a42dE9`，部署交易为 `0xc4e1d028e6320ca3276175a054865a32e292f68e8ccbf9834d3f1353adf13822`。它是单一不可变 owner 的测试接收器，owner 为上述账户；native/ERC20 提取及绑定 FeeVault 的执行者配置仅 owner 可执行。该合约只部署在 `421614` 测试链，不能部署到 Robinhood Chain。`tools/prepare-arbitrum-test-deployment.mjs` 现在保留已核验的 treasury 记录并检查 live codehash。平台收益接收方在所有链上均须为合约；核心协议已完成广播及链上核验，仍不能据此声称生产就绪。

## 前后端隔离

- 前端：`VITE_V1_CHAIN_ID=421614`，Read API 必须使用对应链。示例 `apps/web/.env.arbitrum-sepolia.example`；也可用 `VITE_V1_CHAIN_ID=421614 npm --prefix apps/web run build`。默认构建保持 RH 4663。
- TypeScript API：`TICKERGARDEN_CHAIN_ID=421614`；独立 snapshot 文件。错误链快照继续拒绝。
- Go API/indexer：`TG_CHAIN_ID=421614`、`TG_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc`，使用独立数据库和本链部署 watchlist。先运行新增 `00004_arbitrum_sepolia.sql` 迁移；本次未连接或迁移用户数据库。回滚遇到已有 Arbitrum 数据会失败，不会删除数据。
- TypeScript indexer descriptor：`TICKERGARDEN_INDEXER_CHAIN_ID=421614`。实际 RPC 采集由既有运行服务负责，descriptor 不等于索引已启动。
- Maintenance：使用 `config/arbitrum-sepolia.env.example`，实际 settlement 请求中的 chainId、RPC、合约地址及根生成输入必须全部为421614。根生成器原本支持独立 chain domain，不复用 RH root/proof。

验证日志位于 `outputs/reviews/arbitrum-sepolia/`。生产合约业务规则、手续费比例及 RH 配对资产清单没有修改。

## 发布制品一致性防护（2026-09-06 修复）

Foundry 的增量缓存曾出现“模块已经更新，但部署脚本仍嵌入旧 creation code”的情况。单元测试通过、独立模块 ABI/源码哈希正确，都不足以证明广播脚本使用同一版本。发布候选必须完整重编译：

```sh
node tools/run-forge.mjs build --force
node tools/verify-v1-build-inputs.mjs
```

`tools/run-arbitrum-deployment.mjs` 现在在 preview / simulate / broadcast 前校验 22 个部署相关制品的全部源码哈希。simulate 成功后，以及 broadcast 签名前，还解码模拟批次中的 16 个 `deployComponent` 调用，逐一比对 init code 与当前编译的 creation code（允许其后的构造参数）。任何源码过期、缺少组件、重复索引或旧内嵌字节码都会停止。

完整重编译之后再运行普通合约全量测试及 RH / Arbitrum Fork；不要把修复前缓存对应的测试日志当成新制品证据。更新当前 release 证据、重新 preview / simulate；修改任何被绑定输入都必须重新模拟。新增防护的本地测试：

```sh
node --test tools/verify-v1-build-inputs.test.mjs
```

广播后的 runtime 和不可变参数绑定校验仍是必需步骤，不能因上述广播前校验通过而省略。若 runtime 不匹配：停止激活，归档该 release 为 `REJECTED_NOT_ACTIVATED`，使用新的 release ID 完成重建、测试、模拟及部署。不要通过放宽 runtime 比对或覆盖旧地址清单来继续。

本次修复、弃用候选与最终有效版本的完整记录：[无质押手续费修复与 R5 报告](../outputs/reviews/arbitrum-r4-fix/REPORT.md)。
