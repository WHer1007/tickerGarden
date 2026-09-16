# RH 4663 合约生产发布准备

状态：`TECHNICALLY_PREPARED_EXTERNAL_GATES_PENDING_NOT_BROADCAST`。本报告对应当前工作区的生产候选：合约及部署技术验证已完成，外部签字和广播授权仍待完成。未签名、未广播、未部署主网、未启动运营任务。

## Gas 问题与修复

194 个 Robinhood Stock Token 已存在于主网，本项目登记它们的身份和准入参数，不重新部署这些 Stock Token。旧方案逐项登记 Stock、Quote 和权限，共有 19 笔 runtime 交易及 417 项独立激活操作，合计 436 笔交易。

高成本的主因是 `OfficialStockRegistryV1` 每次登记都重新扫描同一份 Beacon 和实现合约的全部字节码，检查可执行的 `DELEGATECALL` / `CALLCODE`。旧方案首次 Stock 登记实测 9,356,861 Gas，后续典型登记仍为 5,868,786 Gas；这不是单纯写入一个地址的费用。

本次新增按当前 runtime codehash 缓存的安全字节码扫描结果。每个 Stock 的 UID、decimals、当前实现地址、实际 codehash、预期 fingerprint 和 Vault 绑定继续独立检查；缓存不保存或替代资产身份。相同地址的代码变化会产生不同 key，必须重新扫描。外部 ABI 不变；Registry runtime 从 9,475 降至 9,425 bytes，新增私有 storage mapping 放在末尾。本次为新合约部署候选。

批处理使用现有 OpenZeppelin `AccessManager.multicall` 和 `execute`，不添加新的管理员合约：

| 阶段 | 交易数 | 本地主网 Fork 实测 EVM Gas | 按本次主网单价估计 ETH |
| --- | ---: | ---: | ---: |
| 安装 runtime | 19 | 51,540,876 | 0.0037390 |
| 登记 194 Stock，首批包含 baseline | 7 | 56,674,348 | 0.0041114 |
| 登记 196 Quote（194 Stock + ETH + USDG） | 7 | 35,969,794 | 0.0026094 |
| 模板、发布者、Keeper、权限及部署者退权 | 1 | 7,686,176 | 0.0005576 |
| **完整发布** | **34** | **151,871,194** | **0.0110173** |

每批最多 32 项 Stock 或 Quote。典型 32 Stock 批次约 7,801,608 Gas；首次批次因包含初次扫描和 baseline，实测 17,121,366 Gas。最高拟议单笔 Gas limit 为 22,247,582，低于本次主网查询到的 32,000,000 单笔/区块上限。

把现有登记调用移进构造函数也必须执行同样的校验和写入，不会免除这些 Gas；现有设计还需要验证已经部署的 Vault 等 runtime。完整初始化约 1.52 亿 Gas，无法放进本网络的单笔交易。34 笔可以由发布流程顺序执行，无须手工提交 194 次。规范中的 `NO_BATCH_ABI` 保持有效：内部仍逐项调用原 Registry 方法，本次仅以已有 AccessManager 组合部署期调用，未新增批量业务 ABI。

本次固定区块 `eth_gasPrice` 为 72,544,000 wei/Gas。对全部 34 份精确 calldata 查询原生 `NodeInterface.gasEstimateL1Component`，本次返回的 L1 Gas 均为 0；这只代表本次报价。费用候选采用估算 Gas 的 125% 加每笔 25,000 Gas，并采用观察单价的 2 倍作为 `maxFeePerGas`：

- 预计总费用：**0.011017343897536 ETH**。
- 拟议合计费用上限：**0.029110387258112 ETH**。
- 部署钱包观察余额：**0.040912249720149734 ETH**，高于费用上限约 **0.011801862462038 ETH**。
- 在上述费用上限外再留 0.005 ETH 并按 0.01 ETH 向上取整，建议余额为 **0.04 ETH**；本次无需给部署钱包补款。

这些是未授权的费用建议，签名前必须刷新 nonce、余额、Gas 和原生 L1 费用。最终计算由 `fee-budget.json` 与 `check:production-release` 交叉核对。

## 固定的发布身份和参数

| 项目 | 本次候选 |
| --- | --- |
| 网络 | Robinhood mainnet，chainId 4663 |
| finalized pin | 62,934,780；`0x21b58ec01746c22b3ef01bfe36c4d67f0f7060e1ceef164f09c9de5fa16c897b` |
| releaseId | `0xda13cee41cf89064426e10cd5b2f63cb8448fb5b4e8713f2d48d2f99b9570cd5` |
| 预计 Factory | `0x5eBC1c14Dc10AAC61A1d1E59b2618AB1f4c3dE9c`，尚未部署 |
| Deployer / bootstrap admin | `0xaF8D8Ac7F359135f19aE6b6f63FC0e7053C7BA31`；候选 nonce 2–35 |
| Treasury / Guardian | `0xB993fD249D997EfB3F4E2f7F2948FcC247e4BC7b` |
| Governance / Unpause | `0x9d24c6D24CaCCF9C5Fc03d566D3f2c4C42b77248` |
| Holder 发布者 / Keeper | `0x2cFb6cAa2042690fc928CE0ccE40F3828336dE44` |
| 权限 | 治理 48h，Unpause 24h，Guardian 即时；最后部署者退权 |
| LP 复投 | 初始化结束时链上 Keeper 非零、复投可用；链下调度关闭，后期按需执行 |
| Stock 准入 | 194 官方 Stock，最低市场总分配量 0.5 Token |
| Quote 准入 | 已批准的普通 `addQuoteConfig` 管理员白名单，共 196 项 |
| 经济参数 | 沿用 2026-09-12 已批准 raw 值；ETH 3/1.2 ETH，USDG 7,000/2,800；Stock 虚拟储备为各毕业阈值的 40% |

最后一批原子完成模板登记、Holder/Keeper 初始化和权限交接，避免模板开放后运营地址尚未配置的中间状态。共享钱包后续操作必须统一 nonce/pending 协调。当前该钱包主网 ETH 为 0，需在第一次发布 Holder 快照或执行复投前提供操作 Gas；这不影响将其登记为发布者与 Keeper。

两组 Safe 本次均核实为 1.4.1、2/3，owners 不重叠，nonce 为 0，module 列表为空、guard 为零。194 资产的 UID、decimals、token/Beacon/implementation 指纹全部与批准清单匹配。外部依赖及 Pons 参考 Factory 地址/codehash 亦已复核，未更改已批准参数。

## 已完成验证及证据

证据根目录：[production-release-2026-09-15](./evidence/production-release-2026-09-15/)。`before-registry-cache/` 为旧高 Gas 候选，`historical-diagnostics/` 为早期或不同 pin 的诊断资料，均不能用于签名。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 非 Fork 合约完整回归 | 1,066 passed，97 suites，0 failed/skipped | [contract-tests.log](./evidence/production-release-2026-09-15/contract-tests.log) |
| Registry 聚焦回归 | 35 passed；包括共用实现、身份/指纹错误、危险升级及同地址 codehash 变化 | [registry-tests.log](./evidence/production-release-2026-09-15/registry-tests.log) |
| 当前 pin 主网业务 Fork | 4 passed，0 failed/skipped | [candidate-fork.log](./evidence/production-release-2026-09-15/candidate-fork.log) |
| 规范与生成产物 | 67 项规范测试、fixtures、18 模块生成产物及 3 项 surface 测试通过 | [spec-gates.log](./evidence/production-release-2026-09-15/spec-gates.log) |
| 部署计划 | 71 项测试及 TypeScript build 通过 | [deployment-tests.log](./evidence/production-release-2026-09-15/deployment-tests.log) |
| 发布工具 | 22 passed；包括嵌套 calldata、nonce、批次、签名资格和挑战篡改拒绝 | [release-tests.log](./evidence/production-release-2026-09-15/release-tests.log) |
| 跨层兼容 | boundary、backend-contracts、environment 全部通过 | [cross-layer-gates.log](./evidence/production-release-2026-09-15/cross-layer-gates.log) |
| Fork/工件工具防护 | 24 passed，0 failed/skipped | [tooling-safety-tests.log](./evidence/production-release-2026-09-15/tooling-safety-tests.log) |
| 完整初始化 | 34 笔成功；194 Stock / 196 Quote 回读、22 runtime、角色及发布者/Keeper 正确 | [simulation-summary.json](./evidence/production-release-2026-09-15/simulation-summary.json) |
| 逐资产业务演练 | 194 项精确存取、196 项创建预览通过；实际创建 ETH、USDG、CRM 市场成功；治理延迟及 Guardian 边界通过 | [release-drills.json](./evidence/production-release-2026-09-15/release-drills.json) |
| 独立重建 | 170 份归档 Solidity 来源重编译，23/23 artifact 的 ABI、creation 和 runtime bytecode 精确一致 | [reproducible-build.json](./evidence/production-release-2026-09-15/reproducible-build.json) |
| 体积 | Factory 23,515/24,000；FeeVault 23,107/23,500 bytes；未放宽预算 | [runtime-code.json](./evidence/production-release-2026-09-15/runtime-code.json) |

当前 Git HEAD `8750d2788ab83fda725bed19c634ee6979608b85` 不能代表本候选的未提交工作区。最终包捕获合约发布相关输入的完整文件内容与 SHA-256，包括未跟踪的 `StaticLPFee.sol`；Solidity 编译依赖闭包另存于 `source-archive/contracts/`。不包含私有环境文件。本地模拟使用合成余额和 impersonation，不能当作 Safe owner 已签名或主网已有回执的证据。

本次没有宣称整个应用仓库发布门禁全部通过：旧 `check:deployment-track` 仍受历史测试网 manifest 的 schema/configInputs 不匹配影响，不能将其当作当前 4663 候选结果；该候选使用单独且保持拒绝未满足条件的 `check:production-release`。前后端生产绑定仍依赖未来真实部署回执。

最终交付入口：[未签名交易包](./evidence/production-release-2026-09-15/transactions.unsigned.json)、[费用预算](./evidence/production-release-2026-09-15/fee-budget.json)、[候选 runtime/ABI 目录](./evidence/production-release-2026-09-15/runtime-catalog.candidate.json)、[源码输入锁](./evidence/production-release-2026-09-15/input-lock.json)、[本地门禁结果](./evidence/production-release-2026-09-15/candidate-check.json)、[完整候选归档](./evidence/production-release-2026-09-15/tickergarden-4663-da13cee41cf8-candidate.tar.gz)。归档包含逐文件 `SHA256SUMS.json`，其外部摘要见 [BUNDLE.json](./evidence/production-release-2026-09-15/BUNDLE.json)。这些文件在最终演练通过后生成，不包含本地合成状态、旧候选或主网私钥。完整初始化已保存 34 笔成功回执与全部回读；后续附加演练曾因 RPC 读取问题中断，最终从经过摘要校验的本地初始化检查点恢复，全量演练独立进程以 exit 0 完成。不把早期中断进程标记为全程通过。

## 尚需提供或完成的事项

1. **最终独立安全审查/签字，以及法律和许可批准材料。** 当前仓库尚缺绑定本候选的有效文件或链接；内部回归不是外部签字。
2. **两组 Safe 签名人及操作钱包的控制证明。** 准备的 EIP-191 挑战仅证明签名可用性，绑定本候选和未签名交易包，不授权部署或转账。每组 Safe 至少两名有效 owner，操作钱包一份证明；实际 Safe 交易签名/执行流程演练另行留证。不需要提供私钥。
3. **明确批准具体广播包和费用上限**，并在签名前刷新主网 nonce、Gas、余额、代码指纹和 Safe 状态。当前 `broadcastAuthorized` 仍为 false。

真实广播之后，还须取得 canonical 回执、验证源码和 runtime、生成带真实 activation block/hash 的生产目录；完成前后端/Indexer/Holder 生产绑定、监控与 72h 受控运行验收，才能开放用户资金。现有 Holder CLI 仍限定测试环境，Holder/复投的统一 nonce journal 也属于运营启用前的工作。链上 Keeper 初始化已包含在本次发布包，无需为了首次按需复投再走一次治理开启。

执行顺序、失败前缀恢复与部署后验收见 [RH 主网发布 Runbook](../runbooks/RH_MAINNET_RELEASE_2026-09-15.md)。
