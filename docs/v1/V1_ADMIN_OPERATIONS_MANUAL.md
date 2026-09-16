> 2026-09-06 更新：R3 测试链版本已部署，使用 7 天持有人周期与 0.42 ETH 测试毕业门槛。此前重命名候选的 NOT_BROADCAST / 阻塞记录属于历史阶段；当前验证范围和时间限制以 [R3 测试报告](../../outputs/reviews/arbitrum-r3-scenarios/REPORT.md) 为准。RH 生产就绪仍未确认。

> 新源码领取路径已切换为用户选择兑换/原币，Holder 双资产分别释放，取消该路径额外 7 天等待。minimumQuote 继续为 0，保留有效期。新版本不支持 operator 集体兑换；以下旧阶段的批量兑换/等待期开关说明仅适用于旧部署。完整行为见 `docs/v1/V1_REWARD_CONVERSION.md`。本次未部署。


# TickerGarden 合约管理员人工操作手册

版本：2026-09-06，适用当前 `contracts/src/v1` 与 Arbitrum Sepolia R2。读者：协议管理员、收益接收器负责人、兑换执行者、持有人分配 Root 发布与复核人员。

品牌重命名说明：当前源码与 ABI 是未部署候选版本。本文的 R2 地址与链上快照属于重命名前版本，不能将新 ABI 用于旧 R2；后续新 release 必须重新部署并重新生成操作记录。本手册不写部署成功结论，也不修改历史链上事实。

本文是操作教程，不代表已执行权限移交或参数修改。编写时只读取链上状态，没有发送交易。RH（chainId 4663）是最终生产目标；本文具体地址全部属于 Arbitrum Sepolia（421614），不得直接用于 RH。

## 目录

1. [当前部署与权限边界](#1-当前部署与权限边界)
2. [操作环境与每次操作流程](#2-操作环境与每次操作流程)
3. [AccessManager 与延迟执行](#3-accessmanager-与延迟执行)
4. [权限移交和多签管理](#4-权限移交和多签管理)
5. [参数总览与不可修改项](#5-参数总览与不可修改项)
6. [配对资产白名单与毕业参数](#6-配对资产白名单与毕业参数)
7. [股票质押资产管理](#7-股票质押资产管理)
8. [基线和启动模板](#8-基线和启动模板)
9. [暂停、恢复、退役与事故处置](#9-暂停恢复退役与事故处置)
10. [内部奖励兑换执行者](#10-内部奖励兑换执行者)
11. [平台收益与持有人分配](#11-平台收益与持有人分配)
12. [排错、日常巡检与操作记录](#12-排错日常巡检与操作记录)
13. [ABI 调用与来源索引](#13-abi-调用与来源索引)

## 1. 当前部署与权限边界

### 1.1 地址与证据

当前 release：`0x52e3a1752759c8af00047af2b2e1d8b091cc4d7abab6d6f6cd2097e209c247d9`。

| 合约/账户 | Arbitrum Sepolia R2 地址 |
| --- | --- |
| 当前测试管理员 / receiver owner / 兑换执行者 | `0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea` |
| AccessManager | `0x17C18B196c17AD944e495CcCdbfFEADCe70a8424` |
| OfficialStockRegistryV1 | `0x8CC7a62AaB459A1284B5b7dB91C90Ab2FBe988A2` |
| ApprovedQuoteRegistry | `0xED127905e2D55F9cB33f8C5b20a4868EEe0E2Fde` |
| TickerGardenBaselineRegistry | `0x4f85c311220CD2C420Fea47DC842942908Fb489e` |
| LaunchTemplateRegistry | `0xEBb87a8ADeEC760D4DfbdA833279a1d2EE97a1B4` |
| TreasuryDistributorV1 | `0x3796f998A7BcF93131dF731A6226e738b99B0351` |
| ProtocolFeeVault | `0xA9B1e5C15286c689cC8Dca752484729fEB86B9E1` |
| ArbitrumTestTreasury（平台收益接收器） | `0xB39BD5e7BB13CF2C0EA513e8bE69b6DCa3a42dE9` |
| Factory | `0x53cbd5050e05901Ee0A3D7525e534a5A84e357F3` |
| LaunchAndBuyRouter | `0x363dDF1FFcDb5D57B0AbEc1e1F89F5D45FD7340B` |

其余组件地址从[已部署清单](../../deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json)读取；有效基线、Quote、模板 ID 从[激活清单](../../deployments/manifests/arbitrum-sepolia-421614.v1.activation.json)读取。不要使用旧 release 的地址或仅预测地址的 preview 作为交易依据。

本次只读核验固定在区块 `305779130`，hash `0x5c8344f49f9070febca90a2e21a9db777e14c5ea711a3316bf827f57b8a6fce7`，UTC `2026-09-05T18:56:56.188Z`。已核验上述管理员持有 role 0、执行延迟为 0，23 个业务管理员方法映射到 role 0，以及兑换执行者、平台接收器和 Root 参数。见[链上快照](../../outputs/reviews/admin-operations-manual/chain-snapshot.json)。这是时间点证据；操作当天必须重新读取，不是永久授权证明，也不是全历史角色成员枚举。

### 1.2 四类权限不能混为一谈

| 权限 | 如何鉴权 | 能做什么 | 转移方式 |
| --- | --- | --- | --- |
| 协议治理 | 五个管理模块使用不可变 `authority` 指向 AccessManager | 注册/暂停/恢复/退役配置、最低质押量、Root 服务费、Root 发布与取消 | AccessManager 授予新账户角色，再撤销旧账户角色 |
| 平台接收器 owner | `msg.sender == owner` | 接收器提款、配置 FeeVault 的兑换执行者 | **当前测试接收器 owner 为 immutable，无转移函数** |
| 兑换执行者 | `msg.sender == FeeVault.settlementOperator()` | 创作者/质押者奖励兑换、持有人奖励兑换 | receiver owner 调用 receiver 的 `configureSettlementOperator` |
| 创作者收益受益人 | CreatorRevenueRegistry 当前 epoch 的 beneficiary | 转移自己市场后续创作者收益权 | 当前 beneficiary 调用 `transferCreatorRevenueBeneficiary`，不是平台管理员操作 |

AccessManager 角色移交不改变 receiver owner、`platformTreasury`、`rootServiceTreasury` 或历史创作者收益。部署账户并不因为“部署过合约”而天然拥有所有后续能力；权限来自上述实际检查。

平台没有修改既有市场手续费分成、挪走用户质押本金、给任意用户改奖励收款地址或强制升级既有市场的通用管理员入口。Root 发布仍是重要的信任边界：链上验证承诺和总额，不能独立证明链下完整持仓历史正确。

## 2. 操作环境与每次操作流程

### 2.1 准备环境

需要项目当前源码、对应 release 的编译 ABI、Foundry 的 `cast`，以及可信 RPC。复杂 tuple 编码示例还需要 Node.js 和项目已安装的 `apps/web/node_modules/viem`。不要混用 legacy `contracts/src` ABI 与当前 `contracts/src/v1` ABI。

从项目根目录开始。下列初始化只设置公开变量：

```bash
cd /Users/dear/Documents/code/TickerGarden
export RPC_URL='https://sepolia-rollup.arbitrum.io/rpc'
export CHAIN_ID=421614
export ADMIN='0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea'
export ACCESS='0x17C18B196c17AD944e495CcCdbfFEADCe70a8424'
export QUOTE_REGISTRY='0xED127905e2D55F9cB33f8C5b20a4868EEe0E2Fde'
export STOCK_REGISTRY='0x8CC7a62AaB459A1284B5b7dB91C90Ab2FBe988A2'
export DISTRIBUTOR='0x3796f998A7BcF93131dF731A6226e738b99B0351'
export FEE_VAULT='0xA9B1e5C15286c689cC8Dca752484729fEB86B9E1'
export RECEIVER='0xB39BD5e7BB13CF2C0EA513e8bE69b6DCa3a42dE9'
cast chain-id --rpc-url "$RPC_URL"
cast code "$ACCESS" --rpc-url "$RPC_URL"
cast call "$ACCESS" 'hasRole(uint64,address)(bool,uint32)' 0 "$ADMIN" --rpc-url "$RPC_URL"
cast call "$FEE_VAULT" 'platformTreasury()(address)' --rpc-url "$RPC_URL"
cast call "$FEE_VAULT" 'settlementOperator()(address)' --rpc-url "$RPC_URL"
cast call "$RECEIVER" 'owner()(address)' --rpc-url "$RPC_URL"
```

链 ID 必须为 421614，代码必须非空，地址必须与已确认清单一致。代码非空只是第一层检查，还应计算 `cast keccak "$(cast code ... )"` 并与对应清单中的 runtimeCodeHash 比对。

私钥不要出现在命令参数、聊天、截图、文档或 Git。需要 EOA 人工签名时，可在本机使用加密 keystore：

```bash
# 仅在本机交互输入；不要把私钥追加在命令后面。
cast wallet import tg-admin --interactive
cast wallet address --account tg-admin
```

最后一行地址必须与实际操作者一致。`tg-admin` 是本地示例别名，不表示仓库已经提供此 keystore。现有部署工具使用的本地测试钱包文件也不等于已导入的 keystore。生产治理建议硬件签名、多签分权；不把测试钱包或测试专用 receiver 沿用为生产治理方案。

### 2.2 每一笔变更都执行这八步

1. 写明工单目的、链 ID、release、目标合约、方法、完整参数、金额单位、预期影响和恢复办法。
2. 读取当前值、对象状态、当前角色、角色延迟、目标是否 closed，并保存读取区块/hash。
3. 用该 release ABI 编码 calldata；第二名复核人独立解码比对地址和金额，不能只看四字节 selector。
4. 根据权限选择直接调用、AccessManager 延迟调用或 receiver owner 调用。不要互相替代。
5. 用真实操作者作为 `from` 做 `eth_call` 和 gas estimate；延迟操作在排队前进行 Fork 演练，到期后再次模拟。
6. 人工确认签名界面上的网络、`to`、`value`、calldata、nonce 和 gas。普通管理方法 `value=0`。
7. 广播一次，记录 hash，等待成功 receipt 和相应确认。RPC 超时先查 hash、nonce 和链上状态，不生成新 ID 重复操作。
8. 回读最终值与事件，并同步白名单发布文件、Read API/前端配置、监控和工单；改本地 JSON 不会自动改链上。

下面是**直接调用且无延迟**的通用模板。先准备 `$TARGET` 和 `$DATA`，只有完成复核才执行标记为广播的一行：

```bash
cast call "$TARGET" --data "$DATA" --from "$ADMIN" --rpc-url "$RPC_URL"
cast estimate "$TARGET" --data "$DATA" --from "$ADMIN" --rpc-url "$RPC_URL"
# 以下发送真实交易，消耗 gas：
cast send "$TARGET" --data "$DATA" --account tg-admin --chain "$CHAIN_ID" --rpc-url "$RPC_URL"
# 将返回的真实 hash 填入 TX_HASH 后检查：
cast receipt "$TX_HASH" --rpc-url "$RPC_URL"
```

`cast call` 成功不会持久保存任何状态。失败交易也可能消耗 gas。不要把模拟成功当成上链成功，也不要在公共链发送“预期回滚”探测来代替只读检查。

### 2.3 使用多签界面

先核验目标链上多签代码、owners、threshold，再用交易构建器输入 `to`、`value=0` 和本地 ABI/calldata。每个签名人核对**多签实际执行的内层调用**；多签提案 hash 与最终执行交易 hash 都保存。浏览器“连接了签名人钱包”不等于合约看到的调用者就是多签：必须由多签合约执行交易。

没有已验证源码的浏览器页面也不能成为改用不明 ABI 的理由。使用当前本地编译产物，并比对部署代码。多签工具在 RH 的实际可用性、部署地址和代码需生产准备阶段另行核验。

## 3. AccessManager 与延迟执行

### 3.1 读取权限，而不是猜角色

`ADMIN_ROLE=0`；`PUBLIC_ROLE=18446744073709551615`。PUBLIC_ROLE 代表任何人，不可误配给管理方法。

```bash
SELECTOR=$(cast sig 'pauseQuote(bytes32,bytes32)')
cast call "$ACCESS" 'getTargetFunctionRole(address,bytes4)(uint64)' "$QUOTE_REGISTRY" "$SELECTOR" --rpc-url "$RPC_URL"
cast call "$ACCESS" 'canCall(address,address,bytes4)(bool,uint32)' "$ADMIN" "$QUOTE_REGISTRY" "$SELECTOR" --rpc-url "$RPC_URL"
cast call "$ACCESS" 'isTargetClosed(address)(bool)' "$QUOTE_REGISTRY" --rpc-url "$RPC_URL"
cast call "$ACCESS" 'getTargetAdminDelay(address)(uint32)' "$QUOTE_REGISTRY" --rpc-url "$RPC_URL"
cast call "$ACCESS" 'getAccess(uint64,address)(uint48,uint32,uint32,uint48)' 0 "$ADMIN" --rpc-url "$RPC_URL"
```

业务目标 `canCall` 的结果：`true,0` 可直接调用；`false,非零` 需要延迟；`false,0` 表示当前不允许，不能靠 schedule 绕过。role 0 在业务 selector 改映射后，不会自动获得该自定义角色的直接调用权。

对于 AccessManager **自身**的 `grantRole/setTargetFunctionRole` 等方法，权限还依赖参数中的 role/target，其内部 `_getAdminRestrictions` 会计算完整约束。不要只用 `canCall(操作者,AccessManager,selector)` 判断这些操作；还要读取 `getRoleAdmin`、`hasRole`、`getTargetAdminDelay`，用完整 calldata 模拟。

### 3.2 正确的延迟调用

本项目 `ImmutableAccessManaged` 只接受即时授权，不实现 OpenZeppelin 可变 authority 或直接调用消耗排队的回调。**业务模块有延迟时，必须通过 `AccessManager.schedule → AccessManager.execute`。等待后直接调用业务合约仍会失败。**

准备同一份 `$TARGET`、`$DATA`，且 `$ADMIN` 是后续真正发起 manager 调用的账户。若使用多签，此变量应为多签地址。

```bash
# DATA 已经是目标业务方法的 calldata；when=0 表示使用最早合法执行时间。
SCHEDULE_DATA=$(cast calldata 'schedule(address,bytes,uint48)' "$TARGET" "$DATA" 0)
cast call "$ACCESS" --data "$SCHEDULE_DATA" --from "$ADMIN" --rpc-url "$RPC_URL"
# 人工审核后，按第 2 节广播模板把 TARGET 换为 ACCESS、DATA 换为 SCHEDULE_DATA。
OP_ID=$(cast call "$ACCESS" 'hashOperation(address,address,bytes)(bytes32)' "$ADMIN" "$TARGET" "$DATA" --rpc-url "$RPC_URL")
cast call "$ACCESS" 'getSchedule(bytes32)(uint48)' "$OP_ID" --rpc-url "$RPC_URL"
cast call "$ACCESS" 'getNonce(bytes32)(uint32)' "$OP_ID" --rpc-url "$RPC_URL"
EXEC_DATA=$(cast calldata 'execute(address,bytes)' "$TARGET" "$DATA")
# 到达 getSchedule 时间后，以相同 ADMIN 模拟、估算，再广播 ACCESS + EXEC_DATA。
cast call "$ACCESS" --data "$EXEC_DATA" --from "$ADMIN" --rpc-url "$RPC_URL"
```

排队前最好在本地 Fork 推进时间验证整条调用。普通 RPC 不能通过改本机时间让链上排队成熟。操作 ID 绑定 caller、target、data；改任一参数或改用另一个 Safe 都是另一项操作。当前依赖 `expiration()` 为 7 天：从计划执行时间开始计，超时必须重新排队。

取消排队：调用 manager 的 `cancel(originalCaller,target,data)`。原发起人、ADMIN_ROLE，以及相应 guardian/适用的角色管理员依赖实际规则可以取消。取消后必须验证 schedule 清零。它取消的是尚未执行的计划，不能撤销已完成交易。

### 3.3 可设置的权限参数

| 方法 | 参数含义 | 核验点 |
| --- | --- | --- |
| `grantRole(uint64,address,uint32)` | 角色、账户、该账户执行延迟（秒） | `getAccess` 的 since/currentDelay/pendingDelay/effect，`hasRole` |
| `revokeRole(uint64,address)` | 撤销某角色成员 | `hasRole=false`，并处理未完成排队 |
| `renounceRole(uint64,address)` | 本人放弃角色，第二参数必须是本人确认地址 | 不得提前移除最后一个有效治理入口 |
| `setTargetFunctionRole(address,bytes4[],uint64)` | 将指定目标的若干 selector 映射给角色 | 每个 selector 独立回读；配置并不能让不使用 authority 的函数受控 |
| `setRoleAdmin(uint64,uint64)` | 指定谁能授予/撤销目标角色 | role 0 的管理关系有锁定限制；业务角色管理员不等于全局配置管理员 |
| `setRoleGuardian(uint64,uint64)` | 指定取消排队的 guardian 角色 | 不自动授予 `pause*` 或 `cancelPendingRoot` 权限，必须另配 selector |
| `setGrantDelay(uint64,uint32)` | 新授予成员开始生效前的延迟 | 与成员 executionDelay 分开；已有成员并不会因此自动撤权 |
| `setTargetAdminDelay(address,uint32)` | 目标权限配置变更的延迟 | 不等于每个业务调用的延迟，也不覆盖外部 receiver 的 owner 权限 |
| `setTargetClosed(address,bool)` | 阻止目标通过 manager 授权的调用 | 只影响查询 manager 的受控入口，**不是全协议暂停** |

延迟调整不一定即时生效。当前 `minSetback()` 为 5 天；角色执行延迟减少、grant delay/target admin delay 更新各有生效规则。以 `getAccess`、相应 getter、事件 effect 时间为准，不能发送完就按新值操作。`updateAuthority` 虽然存在于 manager ABI，但本项目业务目标没有 `setAuthority`，不能用它替换现有 authority。

## 4. 权限移交和多签管理

### 4.1 推荐分工（尚未配置）

以下是未来配置建议，不是当前链上角色表。多签所有者应由不同人员、不同设备和备份控制，不能只是同一人三份私钥。

| 示例 role | 持有者 | 授权范围 | 延迟建议 |
| --- | --- | --- | --- |
| 0 ADMIN | 治理多签，例如 2/3 或 3/5 | 权限关系、目标 selector、治理恢复 | 常规变更 24–48 小时，需先演练 |
| 1 配置管理员 | 治理/运营多签 | add/register、最低质押量、服务费、retire | 24–48 小时 |
| 2 暂停人员 | 独立应急多签 | 四类 registry 的 pause 方法 | 0，便于响应 |
| 3 恢复人员 | 安全复核多签 | 四类 registry 的 unpause 方法 | 建议 24 小时，且链上暂停后 24 小时限制仍适用 |
| 4 Root 发布者 | 专门发布账户或多签 | 仅 `publishRoot` | 必须短于剩余发布窗口，不能机械套用 48 小时 |
| 5 Root 复核者 | 独立复核多签 | 仅 `cancelPendingRoot`，配套排队 guardian | 建议 0，避免错过 finalize 前的处理时间 |

保留受延迟和多签保护的 role 0 治理能力，便于以后调整 selector 和治理关系。不要照抄“撤销全部 role 0”示例：没有 role 0 后，角色自身可管理并不代表还可配置全局策略。

Root 审查期当前只有 1 小时，且是不可变参数。配置多签签署 SLA、发布延迟、监控和取消机制时必须用这个真实窗口计算；生产若要更长链上审查期，需要新 Distributor/release。

### 4.2 移交 AccessManager 的人工顺序

1. 在目标链部署并验证接收治理权的多签，读取 owners/threshold/code，完成一次真正由 Safe 发出的调用演练。
2. 导出所有 RoleGranted/RoleRevoked、目标 selector、角色 admin/guardian/delay、待执行计划。`hasRole` 检查一个地址不能证明没有其他管理员；成员清单需从部署起事件重建，并逐个回读。
3. 由现任 role 0 管理员提交 `grantRole(0,newGovernanceSafe,executionDelaySeconds)`。不要在同一步移除旧管理员。
4. 等待 grant delay 到期，确认新多签 `hasRole(0)=true` 和实际 executionDelay。让新多签完成一笔事先演练的实际管理操作，例如配置计划中的业务 selector；有延迟就完整走 schedule/execute。
5. 逐项授予业务角色、绑定 selector、配置 guardian 与 target admin delay。每项回读，复核暂停/恢复和 Root 发布/取消仍可执行。
6. 列出旧账户持有的**全部角色**和待执行操作，撤销不再需要的角色；取消不应继续执行的排队。撤销角色不等于删除排队记录，不应留下未来重新授予权限后可恢复执行的旧计划。
7. 新治理账户确认接管后，撤销旧账户 role 0，或由旧账户 `renounceRole(0,oldAccount)`。确认新多签仍持有 role 0，旧账户所有应移除角色均不再生效。
8. 归档授权、演练、撤销三阶段的回执与回读结果；更新监控签名人和应急联系人。

示例只生成授予/撤销 calldata，`NEW_SAFE` 必须替换为已验证的真实多签地址：

```bash
GRANT_DATA=$(cast calldata 'grantRole(uint64,address,uint32)' 0 "$NEW_SAFE" 86400)
REVOKE_DATA=$(cast calldata 'revokeRole(uint64,address)' 0 "$OLD_ADMIN")
```

不要一次性广播两笔来“快速移交”。新 Safe 的 86400 秒是每次执行延迟，不是授予后等待一次就永久无延迟。

### 4.3 无法通过上述步骤移交的内容

当前 `ArbitrumTestTreasury.owner` 是原测试 EOA 且不可变。即使 role 0 转给 Safe，原 EOA 仍能提款和轮换兑换执行者。仅轮换 operator 也无法消除原 owner 的控制权。

当前 FeeVault/Factory 的 `platformTreasury`、Distributor 的 `rootServiceTreasury` 也是不可变。不能调用不存在的 `transferOwnership`、`setPlatformTreasury` 或 `setRootServiceTreasury`。若要完整去除原 EOA 依赖，需设计并部署生产接收器（具有所需治理调用能力）、新关联 release，并另行制定旧资产/市场处理方案；不能仅改配置文件或声称旧市场已自动迁移。

多签可以作为未来收益接收合约，但必须实际支持调用 FeeVault 的 `setSettlementOperator` 及所需收益领取动作。不要再次部署“只能提款、不能发起所需调用”的接收合约。参考 [OpenZeppelin 权限管理说明](https://docs.openzeppelin.com/contracts/5.x/access-control) 和 [Safe 合约账户说明](https://docs.safe.global/advanced/smart-account-concepts)；本项目能否转移仍以本节源码边界为准。

## 5. 参数总览与不可修改项

### 5.1 当前值与修改途径

| 参数 | 当前 R2 / 限制 | 如何改变 | 对已有业务的影响 |
| --- | --- | --- | --- |
| ETH 毕业阈值 | `4200000000000000000` wei = 4.2 ETH | 新建 Quote config、新 ID | 不修改既有市场经济快照 |
| ETH phantomQuote | `1680000000000000000` wei = 1.68 ETH | 同上 | 是虚拟定价储备，不是另收用户 1.68 ETH |
| 曲线总供应量 | 当前激活基线 `10^27` raw = 10 亿枚（18 decimals） | 新基线，再配套 Quote 与创建验证 | 不增发既有市场代币 |
| 曲线基础手续费 | 当前基线 100 bps = 1%；基线编码上限 9900 bps | 新基线；还必须通过创建、Creator tax、毕业联合验证 | 不能覆盖旧基线、旧市场 |
| 毕业后基础手续费 | 固定 10000 pips / 1000000 = 1% | 无 setter，改代码、新 release | 不影响旧市场 |
| 原生 PoolKey fee / 协议 LP 分成 | 创建时选择 0/1000/2000/3000 pips / 0 | 创建后不可修改；新 release 生效 | 不可用注册模板绕过市场费率绑定 |
| 创建市场费 | 固定 `500000000000000` wei = 0.0005 ETH | 无 setter，新 Factory/release | 原生币支付，和配对资产不是一回事 |
| Creator tax | 创建时 0–500 bps，即 0–5% | 创建者在新市场选择 | 既有市场不可改，全部归创作者 |
| 创建者手续费分配给持有人 | 创建时 bool；开启固定分出创作者**基础份额**的 50% | 创建新市场选择 | 不包含 Creator tax，不可自定义比例 |
| 是否开放股票质押 | 创建时 `stakingEnabled` | 新市场选择 | 既有市场不可改 |
| 某股票最低质押量 | 登记值，最低 414 raw units | `setMinimumAllocation` | 后续开仓/增仓检查；不自动清算旧仓位 |
| 配置 ACTIVE/PAUSED/RETIRED | 四个 Registry 状态 | 各自 pause/unpause/retire | 详见第 9 节，不能理解成暂停旧市场交易 |
| 兑换执行者 | 当前测试钱包 | receiver `configureSettlementOperator` | 后续两类 settlement 的调用权限立即改变 |
| Root 服务费 | 当前 ETH `1000000000000000` wei = 0.001 ETH | `setRootServiceFee(asset,uint128 amount)`，amount 必须 >0 | 新请求使用新费用，已请求 epoch 保留费用快照 |
| Root epoch 长度 | 604800 秒 = 7 天 | 常量，无 setter | 仅新 release 生效；Arbitrum Sepolia R2 历史链上快照仍为 30 天 |
| finalityDelaySeconds / Blocks | 600 秒 / 2 块 | immutable，新 Distributor | 两个约束不能互相换算替代 |
| Root 发布窗口 / 审查时间 | 86400 秒 / 3600 秒 | immutable，新 Distributor | 当前分别为 24 小时 / 1 小时 |
| 领取窗口 | 2592000 秒 = 30 天 | immutable，新 Distributor；构造时要求至少一个 epoch | 已部署不可改 |
| 原币奖励退出等待 | 7 天 | 常量，无 setter | 用户申请，平台不能代其任意缩短 |
| 单批创作者/质押者兑换项数 | 1–32 | 常量，无 setter | 跨批逐次核验余额和成交 |

所有百分比先分清 `bps`（万分之一）、`pips`（百万分之一），所有金额先读取 decimals。不要用 JavaScript `Number` 保存大额 raw 金额，使用十进制字符串/BigInt。

### 5.2 固定分成备查

以下是**基础手续费内部的分配比例**，不是额外向用户收取的费率；整数舍入时创作者接收余数。

| 场景 | 创作者 | 有效质押者 | 平台 | 持有人（开启时） |
| --- | --- | --- | --- | --- |
| 曲线阶段，持有人分配关闭 | 70% | 0 | 30% | 0 |
| 曲线阶段，持有人分配开启 | 35% | 0 | 30% | 35% |
| 毕业后有有效质押，分配关闭 | 40% | 30% | 30% | 0 |
| 毕业后有有效质押，分配开启 | 20% | 30% | 30% | 20% |
| 毕业后无有效质押，分配关闭 | 70% | 0 | 30% | 0 |
| 毕业后无有效质押，分配开启 | 35% | 0 | 30% | 35% |

“开启了质押”不等于“当前存在有效质押”；实际 activeStock 决定质押者份额。Creator tax 始终另外计入创作者收益，不分给平台、质押者或持有人。当前没有卖出手续费销毁开关。管理员不能通过服务费、模板或白名单操作改写这些固定分配公式。

## 6. 配对资产白名单与毕业参数

### 6.1 Quote 的普通准入流程

业务规则是**管理员审核后加入白名单**，不是只允许“不可升级的普通 ERC-20”。USDG、cbBTC 等并不因类型被一概禁止；但“允许审核准入”不代表任意地址和转账行为都能正常执行交易。

1. 确认当前链上的真实 token 地址、decimals、runtime codehash，记录升级、冻结、黑名单、转账税、余额重基等风险与发行方信息。原生 ETH 使用零地址、18 decimals。
2. 普通 `addQuoteConfig` 对合约资产核验代码存在、decimals 与 runtime hash；**不会自动核验代理背后的 implementation 变化**。审核与持续监控不能被 codehash 一项取代。
3. 从 ACTIVE 基线选择 `tickerGardenBaselineId`，根据该配对资产最小单位计算 phantomQuote 和 graduationThreshold。不能把 ETH wei 数值原样填给 6/8 位资产，也不能把美元估值直接当 token 数量。
4. 生成经济哈希和 configId，准备完整 tuple（下一节）。登记 ID 必须从未使用过；不能覆盖、删除后重用或用旧 configId 保存新值。
5. 在 Fork/只读模拟中验证完整创建、经济域和毕业计划。`addQuoteConfig` 本身不代表所有 Factory 联合约束已通过。
6. 通过治理操作流程调用 `addQuoteConfig`，回读 `quoteConfig`、`quoteRuntimeCodeHash`、`quoteIdentityCurrent`，核对 status=1 与全部字段。
7. 更新对应网络 paired-assets 发布文件和 Read API/前端目录；重新获取 `previewMarketEconomics`，不要复用旧 expectedEconomics。

### 6.2 QuoteAssetConfig 字段

| 顺序 / 字段 | 类型、单位 | 限制 |
| --- | --- | --- |
| 1 tickerGardenBaselineId | bytes32 | 非零，创建时必须匹配有效基线 |
| 2 quoteAsset | address | 原生币零地址；否则目标链实际合约 |
| 3 quoteDecimals | uint8 | 6–18；原生币必须 18；ERC-20 读取值须一致 |
| 4 phantomQuote | uint256，Quote 最小单位 | >0 且 ≤ `2^127-1` |
| 5 graduationThreshold | uint256，同上 | >0 且 ≤ `2^127-1`，并通过联合毕业经济域验证 |
| 6 economicsHash | bytes32 | 必须等于普通/股票专用路径对应公式；不能手填随机值 |
| 7 status | uint8 | 新增必须为 1（ACTIVE） |

普通 Quote 的计算公式：

```text
domain = keccak256(UTF8("TICKERGARDEN_V1_QUOTE_ECONOMICS"))
economicsHash = keccak256(abi.encode(
  bytes32 domain, uint256 1, uint256 chainId, bytes32 tickerGardenBaselineId,
  address quoteAsset, uint8 quoteDecimals,
  uint256 phantomQuote, uint256 graduationThreshold
))
configId = economicsHash
```

必须是 `abi.encode`，不是拼字符串、JSON 哈希或 `abi.encodePacked`。第 13 节提供从 ABI 编码 tuple 的方法。

股票专用 Quote 使用 `addStockQuoteConfig(configId,config,binding)`，binding 为 `assetUid / stockTokenFingerprintHash / referenceEvidenceHash / generatorPolicyId` 四个 bytes32。还要求已登记股票 ACTIVE、地址/精度匹配、身份指纹有效、immutable-beacon 路径。专用经济哈希多包含身份和证据字段，**不能套用上面的普通 Quote 公式**；按 `ApprovedQuoteRegistry._stockQuoteEconomicsHash` 与 `_stockQuoteFingerprintHash` 精确编码复算。不得通过普通路径绕开已经决定采用的股票指纹风控。

### 6.3 修改“4.2 ETH 毕业”应该怎样操作

这不是一个能随时调用 `setGraduationThreshold` 改全站的全局变量。它属于 Quote 配置，创建市场时被冻结到经济快照中。

假设未来批准新市场改用另一阈值：先确定相应 phantomQuote 和供给曲线，生成**新 configId**，登记、模拟新市场，发布新目录；决定不再使用旧配置时将旧 Quote 暂停或退役。旧市场保留原值。新配置上线与前端展示切换要使用同一 release/配置记录。

解释计算时要区分净储备和用户累计支付：令 `S=原始供应量`、`P=phantomQuote`、`G=graduationThreshold`，全部用 raw integer：

```text
reservedTokens = floor(S * P / (P + G))
initialSellableTokens = S - reservedTokens
canonicalGraduationQuote = ceil(initialSellableTokens * P / reservedTokens)
```

这套整数计算来自 `TickerGardenSupplyMath`；终点净 Quote 受舍入影响，不能保证人类显示的阈值与每一笔总支付精确相同。用户累计买入还包含基础费、Creator tax，且中途卖出会改变净储备。页面不能把“还差净储备”直接当“下一笔交易包含所有费用的付款额”。修改 P/G 后要验证 `V1GraduationEconomicDomain` 中两种 token 排序的 v4 池计划，不能仅验证相加不溢出。

本手册没有修改当前 4.2 ETH / 1.68 ETH 配置，也不提供默认广播降低阈值的命令。

## 7. 股票质押资产管理

### 7.1 新登记

`registerAsset(assetUid,stockToken,tokenDecimals,userStockVault,minimumAllocation,expectedFingerprint)`：六个参数依次是 bytes32、address、uint8、address、uint256、StockTokenFingerprint tuple。最后一个 tuple 按顺序填写 `tokenRuntimeCodeHash(bytes32), beacon(address), beaconRuntimeCodeHash(bytes32), implementation(address), implementationRuntimeCodeHash(bytes32)`，须与现场观察完全一致。股票质押登记和 Quote 白名单是两件事；quote 已 ACTIVE 不会自动允许它作为质押股票。

先核对 token 自报资产 ID、精度与代码身份，Vault 的 authority/registry/allocationManager/schema/runtime 绑定；tokenDecimals 为 6–18，最低分配量至少 414 raw。直接资产的 fingerprint.beacon 为零；受支持的 immutable-beacon 股票必须绑定实际 beacon，并核对实现与指纹。不要为通过校验编造 token 标识、beacon 或 Vault 地址。资产 UID 和 stockToken 均不可重复登记。

直接资产指纹中 `implementation=stockToken`、`implementationRuntimeCodeHash=tokenRuntimeCodeHash`、beacon 与 beaconRuntimeCodeHash 均为零，不能把整份 fingerprint 填零。股票登记的直接/immutable-beacon 限制不应误套为普通 Quote 的准入规则。

登记后读取 `asset(assetUid)`、`assetFingerprint(assetUid)`、`assetIdentityCurrent(assetUid)`、`minimumAllocation(assetUid)`、`vaultIdentityCurrent(userStockVault)`。在开通相关前端选项前执行 deposit/allocate/exit 的测试验证。没有开放质押的市场不需要因此绑定股票。

### 7.2 调整最低质押量

```bash
# ASSET_UID 为已登记真实 ID，NEW_MINIMUM_RAW 为审核过的整数。
REASON_HASH=$(cast keccak 'TG-OPS: approved minimum allocation change; ticket reference')
DATA=$(cast calldata 'setMinimumAllocation(bytes32,uint256,bytes32)' "$ASSET_UID" "$NEW_MINIMUM_RAW" "$REASON_HASH")
TARGET="$STOCK_REGISTRY"
cast call "$STOCK_REGISTRY" 'minimumAllocation(bytes32)(uint256)' "$ASSET_UID" --rpc-url "$RPC_URL"
# 按第 2/3 节模拟、签名并回读相同 getter。
```

例如 6 位精度的 1 枚股票填 `1000000`，不是 `1` 或 `1e18`。合约只要求已登记且新值≥414，技术上未禁止给 PAUSED/RETIRED 资产改值；这不会恢复其状态。上调不会自动拆除旧仓位，但会改变后续开仓/增仓的最低仓位检查。恢复旧值也要另发一笔授权交易，并保留原值和变更理由。

### 7.3 外部股票实现升级后的接纳

1. 监控发现实现漂移，先核对变更来源并 `pauseAsset`，不要立即重新接纳未知代码。
2. 独立审核新实现、实际 `beacon.implementation()`、runtime codehash，检查基础 token/beacon 身份没有被换掉。
3. 对 PAUSED 股票调用 `acceptAssetImplementation(assetUid,expectedImplementation,expectedImplementationRuntimeCodeHash,reasonHash)`。
4. 回读新指纹。这个函数**只更新认可的实现指纹，不执行外部 token 升级，也不自动恢复 ACTIVE**。直接资产不支持此流程，新实现必须不同于已记录实现，且满足委托执行约束。
5. 等暂停至少 24 小时及治理延迟均满足，身份有效后调用 `unpauseAsset`。
6. 若该股票还用作专用 Stock Quote，旧 Quote 的固定 fingerprint/economicsHash 可能已失配；重新生成对应 Quote 配置并停用旧准入记录，不能认为接纳股票实现自动改写 Quote 哈希。

## 8. 基线和启动模板

### 8.1 TickerGardenBaseline 的完整字段

`addBaseline(bytes32 baselineId,TickerGardenBaseline value)` 是追加配置，非更新接口。

| 字段 | 类型 / 要求 |
| --- | --- |
| referenceChainId | uint256，非零；说明证据参考链 |
| referenceFactory | address，非零且**本次执行链上有代码** |
| referenceFactoryCodeHash | bytes32，等于该地址现场 codehash |
| launchConfigId | uint256，所选启动配置标识，不要把它当 chainId |
| supply | uint256，代币 raw 供应量，1 至 `2^127-1` |
| curveFeeBps | uint256，0–9900；极端值通过登记仍不代表市场可创建 |
| poolFee | uint24，当前必须 0 |
| tickSpacing | int24，1–32767；完整池数学仍须验证 |
| behaviorVectorRoot | bytes32，非零，绑定审查过的行为向量证据 |
| status | uint8，新增必须为 1 |

`referenceChainId` 是字段记录，合约不会跨链读取远端代码。Arbitrum R2 使用 `ArbitrumTestBaselineFixture` 作为明确标注的测试证据锚点，**不是 Pons 的真实 factory 或生产基线证明**。新生产基线需要重新准备证据，不能复制测试 fixture。

步骤：整理证据文件→计算代码与行为向量哈希→新 ID→模拟 add 和完整 Factory 创建/毕业→提交→回读全部字段→发布配套 Quote。要改任一内容就创建新 baselineId；旧 ID 只能调整状态。

### 8.2 LaunchTemplate 的完整字段

`addLaunchTemplate(bytes32 launchTemplateId,LaunchTemplate value)` 的 tuple 顺序：

1. memeTokenImplementation、memeTokenCodeHash；
2. curveImplementation、curveCodeHash；
3. gaugeImplementation、gaugeCodeHash；
4. graduatedHook、hookCodeHash；
5. graduationExecutor、graduationExecutorCodeHash；
6. feePolicyId、executionSpecId、status。

前五组分别为 address / bytes32；最后为 bytes32 / bytes32 / uint8。地址及哈希非零、实际代码匹配；executionSpecId 必须为当前 `keccak256("V1-EXEC-11")`，status=1。Hook 低位权限必须符合 `0x2044`，且 Hook/Executor 等组件的内部绑定必须一致。

**注册新模板不等于升级 Factory 或旧市场。** Factory 自己绑定了实现及费率策略，任意新实现即使进入 Registry 仍可能被创建时拒绝。新代码通常需要新关联 release 和新模板。操作步骤与基线类似，必须加上 `_validateBindingGraph` 和真实创建模拟；回读 `launchTemplateHash`，不能拿 input JSON 的哈希替代。

## 9. 暂停、恢复、退役与事故处置

状态统一为：0 UNSET，1 ACTIVE，2 PAUSED，3 RETIRED。

| 对象 | 暂停 / 恢复 / 退役方法 | 主要影响 |
| --- | --- | --- |
| Quote | pauseQuote / unpauseQuote / retireQuote | 新市场准入；不是旧市场交易总开关 |
| 基线 | pauseBaseline / unpauseBaseline / retireBaseline | 新市场准入 |
| 模板 | pauseLaunchTemplate / unpauseLaunchTemplate / retireLaunchTemplate | 新市场准入 |
| 股票资产 | pauseAsset / unpauseAsset / retireAsset | 新的相关市场与股票存入/分配/增仓；既有市场不会因此变成平台可暂停市场 |

允许 `ACTIVE→PAUSED`、`PAUSED→ACTIVE`、`ACTIVE/PAUSED→RETIRED`。RETIRED 无恢复接口，也不能复用该 ID。四类恢复都要求从真实暂停时间起至少 **86400 秒**；另外还要满足 AccessManager 延迟，执行时间取两个约束均成立的时点。暂停/退役的 reasonHash 合约未统一强制非零，但操作记录一律使用有工单依据的非零哈希。

暂停 Quote 示例，**它会关闭当前 ETH 配置的新建准入，仅在确实需要时广播**：

```bash
QUOTE_ID='0x41d476e0979928911c66eefb4cbfbf1dc35100f9667b7e7baaad17dd189aa20b'
REASON_HASH=$(cast keccak 'TG-INCIDENT: replace with reviewed incident reference')
TARGET="$QUOTE_REGISTRY"
DATA=$(cast calldata 'pauseQuote(bytes32,bytes32)' "$QUOTE_ID" "$REASON_HASH")
# 按第 2/3 节执行，回读必须为 status=2。
cast call "$QUOTE_REGISTRY" 'quoteConfig(bytes32)((bytes32,address,uint8,uint256,uint256,bytes32,uint8))' "$QUOTE_ID" --rpc-url "$RPC_URL"
```

恢复前排查原因、重验代码与身份，从暂停 receipt 所在块时间计算24小时，再生成 `unpauseQuote(bytes32)` calldata。股票/Quote 的恢复还会核验身份，不能只等时间。

`setTargetClosed(registry,true)` 会连恢复等受控操作一起挡住，适合明确定义的权限封锁，不能当作普通对象暂停的替代品。关闭 FeeVault/Factory 的 manager 目标不会让其未使用 `restricted` 的入口暂停。

发生事故时，先识别是白名单准入、股票身份、兑换执行者、错误 Root，还是外部 v4/token 故障，再使用对应入口。用户退出仍受其实际账本、解锁与 token 转账能力约束，不能承诺“暂停后所有外部资产一定可立即提取”。本协议没有管理员全局冻结旧市场或回滚链上交易的能力。

## 10. 内部奖励兑换执行者

### 10.1 配置或轮换 operator

执行者是操作角色，不能选择把用户奖励转入自己的钱包，但能决定何时兑换及接受的 minimumQuote，存在成交质量与可用性责任。生产应使用专用执行账户，治理账户负责轮换；设置成多签需要多签主动执行，普通签名人直接发交易不会通过 operator 检查。

```bash
cast call "$RECEIVER" 'owner()(address)' --rpc-url "$RPC_URL"
cast call "$FEE_VAULT" 'platformTreasury()(address)' --rpc-url "$RPC_URL"
cast call "$FEE_VAULT" 'settlementOperator()(address)' --rpc-url "$RPC_URL"
DATA=$(cast calldata 'configureSettlementOperator(address,address)' "$FEE_VAULT" "$NEW_OPERATOR")
TARGET="$RECEIVER"
# 仅 receiver owner 可签名，按第 2 节先模拟，再广播。
```

约束：FeeVault 有代码且 platformTreasury 等于 receiver；NEW_OPERATOR 非零且不等于 receiver 本身；设置后 getter 必须匹配，否则整笔回滚。EOA owner 不应直接调用 FeeVault 的 `setSettlementOperator`，它只接受 platformTreasury 作为调用者；AccessManager 的 role 0 也不能代替 receiver。

确认 receipt 的 `SettlementOperatorConfigured` / `SettlementOperatorUpdated`，回读新地址；分别用新旧账户对 settlement 做只读权限探测，新 operator 应通过权限检查，旧 operator 应被拒绝（新旧地址不同时）。不能只验证 setter 成功而不确认新账户具备发起实际调用的能力。

当前没有专用“暂停 settlement”函数。事故时先停机器人，再由 owner 轮换到可控应急账户，明确停用期间的恢复安排；不要填零地址、随机地址或没有执行能力的合约。

### 10.2 创作者和质押者兑换

方法：`settleRewards(bytes32 marketId,ConversionItem[] items,uint256 minimumQuote,uint256 deadline)`。

| 参数 | 填写方法 |
| --- | --- |
| marketId | 同一已毕业市场；`launchPhase=1` |
| items | 1–32 项，每项 `(address user,uint32 creatorEpoch,uint256 maximumMeme)` |
| creatorEpoch=0 | 质押者，市场必须开启质押，先核对 Gauge 中该用户可转换的奖励 |
| creatorEpoch>0 | 创作者收益 epoch；必须与该 epoch 的历史 beneficiary 匹配，不能只取当前 beneficiary |
| maximumMeme | 用户该项最多转换的 MEME raw 数量，>0；合约实际取不超过现有权益的数量 |
| minimumQuote | 项目统一填 0，不设置价格下限；池子报价只展示预计到账 |
| deadline | Unix 秒，不是毫秒；当前块时间至未来最多 300 秒 |

同批 `(user,creatorEpoch)` 不可重复；任一项可转换量为零、用户原币退出等待已经成熟、输出约束失败，都可能使整批回滚。先剔除无效项再重新报价，不能盲目重试同一批。

步骤：读取市场与权益→确认已毕业和 operator→核对原币退出申请时间→从实际池报价并限制批量冲击→生成不超过5分钟的 deadline→模拟→签名→检查 `RewardBatchConverted`、逐项 `RewardConverted`、conversionNonce 和原/配对资产负债变动。签名拖延就重新报价和生成 deadline，不能为方便审批把有效期改成一天。

转换后的 Quote 仍按原用户/创作者 epoch 记账，不是直接付给 operator；`claimCreator` 或 `claimStakerFor` 才按固定受益人付款。项目不自动设置最低到账，按池子实际输出结算。

### 10.3 持有人集体奖励兑换

`settleHolderRewards(bytes32 marketId,uint32 epochId,uint256 maximumMeme,uint256 minimumQuote,uint256 deadline)` 只允许相同 operator。市场必须开启持有人分配并已毕业，maximumMeme >0，项目 minimumQuote=0，deadline 同样最多未来5分钟。

先读 `holderLiability(marketId,epochId,memeToken)`，只兑换对应 epoch 的余额；输出仍记回同一 epoch。然后调用无需 operator 权限的 `fundHolderRewards(marketId,epochId)`，把该 epoch 的 Quote 转入固定 Distributor。回读 MEME/Quote holderLiability 和 Distributor 的 epochQuoteAmount，不能把旧收益放进新 epoch 来简化记账。

### 10.4 执行者故障与用户原币退出

创作者/质押者用户可自己调用 `requestRawRewardExit(marketId)`，等待 `rawRewardExitAt` 至少7天后领取原 MEME 奖励；取消申请使用 `cancelRawRewardExit`。退出成熟前仍可能正常转换；成熟后 settlement 对该用户拒绝。此机制不是平台把所有集体持有人 MEME 一键提走的出口。管理员应优先恢复可用 operator，不把用户等待退出当作正常运营方案。

## 11. 平台收益与持有人分配

### 11.1 平台收益：先领取到 receiver，再由 owner 提款

1. 从真实市场读取 meme/quote 地址和费用记录；曲线未扫入 FeeVault 时，先检查曲线 `accruedCurveFees()` 并按需调用 `sweepCurveFees()`。
2. 读取 FeeVault `liability(marketId,feeAsset,2)`。bucket 2 为平台收益；其他 bucket 不是可提平台收入。
3. 任意账户可调用 `claimPlatform(marketId,feeAsset)`；收款方固定是 platformTreasury，不是调用者。
4. 确认 `FeeClaimed`、receiver 对应资产余额和 FeeVault 负债变化。
5. receiver owner 调用 `withdraw(asset,amount)`，原生币 asset=零地址；提款固定进入 owner，不能指定第三方收款人。

```bash
cast call "$FEE_VAULT" 'liability(bytes32,address,uint8)(uint256)' "$MARKET_ID" "$FEE_ASSET" 2 --rpc-url "$RPC_URL"
CLAIM_DATA=$(cast calldata 'claimPlatform(bytes32,address)' "$MARKET_ID" "$FEE_ASSET")
WITHDRAW_DATA=$(cast calldata 'withdraw(address,uint256)' "$FEE_ASSET" "$WITHDRAW_AMOUNT_RAW")
```

两笔交易目标不同：第一笔 FeeVault，第二笔 receiver。金额需以实际已到 receiver 的余额为准；FeeVault 总资产还覆盖用户负债，不能把总余额当平台可提额。operator 没有因执行兑换自动获得提款权限。

### 11.2 修改 Root 服务费

```bash
cast call "$DISTRIBUTOR" 'rootServiceFee()((address,uint128))' --rpc-url "$RPC_URL"
DATA=$(cast calldata 'setRootServiceFee(address,uint128)' "$SERVICE_FEE_ASSET" "$SERVICE_FEE_RAW")
TARGET="$DISTRIBUTOR"
# 按第 2/3 节操作，再回读 rootServiceFee。
```

新资产为零地址或存在代码的 token，金额为 1 至 `2^128-1` 的原始单位。当前接口不能设置为 0 实现“免费服务”。更换 fee token 不改变市场 Quote。请求 Root 时服务费被记录在 epoch 内，已请求 epoch 不受后续费率变更影响。

`rootServiceTreasury` 接收的是服务费 credit，当前固定为测试钱包。完成 Root finalize 后，由该钱包调用 `withdrawServiceCredit(asset)` 领取自身 credit；取消/超时退款则记给原 requester，需 requester 领取。不要把服务费提款与平台基础手续费提款混在一起。若未来 rootServiceTreasury 是合约，部署前必须验证该合约能够发起这个领取调用。

### 11.3 持有人分配 Root 的人工完整流程

前端名称是“创建者手续费分配给持有人”，合约 `TreasuryDistributorV1` 的名字为历史技术标识。正常开启此功能的市场由 Factory 自动 `registerFeeSharingMarket`，管理员不应再次调用 `registerMarket`。后者虽然是受控入口，但只允许符合 canonical market、token/distributor 绑定的首次登记，不是给任意代币开通分红的后门。

1. 确认市场登记、已经毕业和 activatedAt；必要时调用无需管理员权限的 `activateMarket`。读取 `epochWindow(marketId,epochId)`，使用链上返回的窗口（R3 为 7 天；历史 R2 为 30 天），不按自然月或本机日期猜。
2. 对目标 epoch 完成第10节 holder MEME 转换、`fundHolderRewards`。`requestRoot` 发现 FeeVault 仍有该 epoch 的 Quote 或 MEME 持有人负债时会报 `HolderFeesAwaitingSettlement`。
3. 窗口结束且 finalityDelaySeconds 满足，epoch 有非零 Quote、status=UNREQUESTED 时申请 `requestRoot(marketId,epochId)`。开始阶段要求申请人当前持有 MEME；再过一个 rootPublicationWindow 后任何人可付费申请。原生服务费需精确 msg.value，ERC-20 服务费需余额与授权且 value=0。
4. 保存 `RootRequested` 的 sourceBlockNumber/hash、窗口、quoteAmount、publishBy、requester 和服务费。当前 finalityDelayBlocks=2 只是配置值，不是对任意 L2 经济最终性的保证；服务应额外验证 canonical 链和完整历史。
5. 拉取从初始 mint 起、截止指定 source block 的完整 canonical Transfer 历史，包括块时间和交易/log 顺序，核验 source block timestamp 覆盖整个窗口。读取 `feeSharingExcludedAccounts` 与固定 eligibilityPolicyHash。仅拿当前持仓快照不够。
6. 使用项目 Go `services/backend-go/cmd/treasury-worker` 离线生成数据；第二人用独立获取的数据复算 root、datasetHash、总 TWAB、叶子数及总分配金额。TWAB 在生成器中是 raw 余额×秒的积分，不要自行除以窗口秒数后填入。
7. 发布者调用 `publishRoot(marketId,epochId,merkleRoot,datasetHash,totalTwab,leafCount,totalAllocated)`，status 必须是 REQUESTED，且链上时间≤publishBy。非空 epoch 的 totalAllocated 必须精确等于请求冻结的 quoteAmount。
8. 发布后回读 ROOT_PENDING、finalizeAfter。复核者在实际 finalize 前检查数据与每个排除项。错误时调用 `cancelPendingRoot(marketId,epochId,reasonHash)`，reasonHash 必须非零；该操作退回请求费 credit 并重置请求，不是允许直接覆盖已发布 root。
9. 等 rootReviewDelay 后任何人可 `finalizeRoot`。非空 epoch 进入 CLAIMING，从 finalize 起计 claimWindow；发布 claim proofs，用户自行 claim。finalize 无管理权限限制，发现错误要及时取消，不能靠“不发前端按钮”阻止别人 finalize。
10. 超过 publishBy 未发布时任何人可 `expireRootRequest`；领取窗口过后按 `rolloverExpiredEpoch` 将余款结转同市场后续周期。两者都不是把本金退给平台。

离线生成命令（不广播；输入输出路径换成当次工单目录）：

```bash
# 从项目根目录构建 Go 服务；仅离线计算，不广播：
make -C services/backend-go build
services/backend-go/bin/treasury-worker --input /absolute/path/root-input.json > /absolute/path/root-candidate.json
```

输入字段以 [Go 输入夹具](../../services/backend-go/internal/treasury/testdata/golden.json) 中的单个 `input` 对象及 [Go 后端说明](../../services/backend-go/README.md) 为准：chainId、distributor、marketId、memeToken、quoteToken、eligibilityPolicyHash、excludedAccounts、epochId、windowStart/end、sourceBlockNumber/hash/timestamp、quoteAmount、transfers。chainId 和大整数使用规范十进制字符串；epochId、transactionIndex、logIndex 使用 JSON 整数，必须显式提供 transfers 和 excludedAccounts。输出是候选包装层，数据集位于 `dataset`，`historyVerified=false` 不能作为发布依据；transfers 每条包含 blockNumber、transactionIndex、logIndex、timestamp、from、to、value。

零 eligible TWAB 只有在完整历史与排除项经过审查后，才可使用 `emptyEpochPolicy: "reviewed-rollover"`。固定 empty root 也要经过发布/审查；finalize 将金额结转，不产生领取叶子。RPC 返回空结果或索引失败不是“没有持有人”的证据。

本次文档没有执行新市场 Root 发布、真实30天持仓回放或完整公开链分红测试。不能将测试合成 Root 用于实际分配。

### 11.4 创作者收益受益人变更

当前 beneficiary 调用 `transferCreatorRevenueBeneficiary(marketId,newBeneficiary)`。新地址不能为零或相同地址，操作创建新 epoch；旧 epoch 权益仍支付旧 beneficiary。曲线阶段会先 sweep 已累计费用，并要求没有未处理曲线费用。没有二次 accept 步骤，签名前必须确认新地址能执行后续操作。

管理员不能替任意创作者改此地址。Creator tax 跟随创作者收益记账，持有人账本继续独立；不应通过改 beneficiary 操作“取回”已分给持有人的费用。

## 12. 排错、日常巡检与操作记录

### 12.1 常见错误

| 错误 / 现象 | 优先检查 | 正确处理 |
| --- | --- | --- |
| AccessManagedUnauthorized | 真正 caller、selector role、closed、executionDelay | 有延迟用 manager.execute；不是增加 gas |
| AccessManagerNotReady / Expired | getSchedule、链上 timestamp、同 caller/data | 等待或重新审核排队，不换调用者重试 |
| UnauthorizedSettlementOperator | FeeVault operator、receiver owner | 经 receiver 配置，role 0 不能代替 operator |
| InvalidSettlementConfiguration | vault 代码、platformTreasury、operator、setter 后 getter | 修正目标或账户能力，不盲目重部署 |
| InvalidEconomicsHash | abi.encode 类型顺序、chainId、baselineId、金额 raw | 按普通/股票专用路径分别复算 |
| AlreadyExists / AlreadyRegistered | ID 和 token 是否已登记 | 相同已成功操作不重发；新内容使用新 ID |
| UnpauseStateDelayNotElapsed | 真实 pause 所在块时间 | 至少24小时，同时满足治理排队 |
| AssetIdentityDrift / QuoteIdentityDrift | 代码、beacon、implementation、decimals | 审查变更并走登记/接纳流程 |
| InvalidConversion | 已毕业、1–32项、非零权益、去重、deadline、原币退出 | 剔除失效项，重报价重模拟 |
| HolderFeesAwaitingSettlement | 该 epoch 的 MEME/Quote holderLiability | 转换 MEME 并 fund Quote 后再请求 |
| RootReviewPending | finalizeAfter | 等链上时间；没有管理员提前 finalize 后门 |
| RootPublicationExpired | publishBy 与发布角色延迟 | expire 请求后重走，不伪造时间 |
| InexactFeePayment / NonExactTokenTransfer | 转账税/冻结/重基/余额变化 | 复核 token 行为，不能减少负债掩盖差额 |
| 交易 pending / RPC 超时 | hash、pending nonce、receipt、链上实际状态 | 先确认是否已提交，禁止重复签发同一经济操作 |

### 12.2 日常人工巡检

- 每次登录：核对 chainId、release、关键代码哈希和钱包地址，检查非预期角色或 operator 变更。
- 每日：检查待执行 governance 操作、延迟变化、Root publishBy/finalizeAfter、operator gas 与兑换失败；只依赖人工轮询时需安排明确值守，尤其当前1小时 Root 审查窗。
- 白名单资产升级/发行方公告后：复核代理实现、精度及冻结风险；登记事件不是永久安全证明。
- 收益对账：按资产分别比对 FeeVault 总负债、各 bucket、已转换/已领取、Distributor epoch 余额；不能把不同 decimals 或不同币种相加当 ETH。
- 权限人员变动：重建成员事件清单，核对 Safe owners/threshold、业务角色与旧队列；不能只更换前端管理员名单。
- 每次 release：刷新本手册地址、ABI、固定参数、操作模拟和前端网络目录；旧记录保留为历史证据。

### 12.3 工单模板

```text
工单 ID / 目的：
网络 / chainId / releaseId：
操作者账户 / 实际合约 caller / 复核人：
目标合约 / runtimeCodeHash / ABI 来源：
函数完整签名 / selector：
参数原值 → 新值（raw 与可读值分别列）：
状态与权限读取区块 / blockHash：
角色 / grantDelay / executionDelay / targetAdminDelay：
calldata / value / 预期事件：
对新市场、旧市场、现有用户的影响：
模拟结果 / gas estimate / 模拟区块：
多签提案 ID / schedule tx / operationId / readyAt / expiry：
最终交易 hash / nonce / receipt status / 确认块及 hash：
回读字段与结果 / 对账：
发布目录、前端、索引服务更新记录：
失败处理 / 可逆方式 / 不可逆后果：
```

“恢复”往往是一笔新交易，不是撤销历史：最低质押量、服务费和 operator 可重新设回经确认的旧值；pause 需等恢复窗口；retire、不可变参数、已 finalize 的错误分配不能照此回滚。操作记录不得包含任何私钥、助记词或 keystore 密码。

## 13. ABI 调用与来源索引

### 13.1 复杂 tuple 的离线编码

不要在区块浏览器里凭记忆排列参数。使用 `contracts/out-v1/<Contract>.sol/<Contract>.json` 的 ABI；必要时从对应 release 源码运行 `node tools/run-forge.mjs build` 获取编译产物，并核对它是否与部署代码对应。

先在工单目录准备 `call.json`，字段是 `contract`、`functionName`、`args`。以下是无实际参数变更的编码示例，不代表要重新执行已完成配置：

```json
{
  "contract": "ArbitrumTestTreasury",
  "functionName": "configureSettlementOperator",
  "args": [
    "0xA9B1e5C15286c689cC8Dca752484729fEB86B9E1",
    "0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea"
  ]
}
```

在项目根目录执行下列代码，只生成 calldata 并解码复核，不连接钱包、不广播。tuple 用 ABI 字段名构成对象，uint/int 用十进制字符串（小整数也可用安全整数），bytes32/address 保持 `0x` 字符串：

```bash
node --input-type=module - /absolute/path/call.json <<'JS'
import fs from 'node:fs';
import {encodeFunctionData,decodeFunctionData} from './apps/web/node_modules/viem/_esm/index.js';
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!/^[A-Za-z][A-Za-z0-9]*$/.test(input.contract)) throw Error('Invalid contract name');
const {abi}=JSON.parse(fs.readFileSync(`contracts/out-v1/${input.contract}.sol/${input.contract}.json`,'utf8'));
const matches=abi.filter(x=>x.type==='function'&&x.name===input.functionName);
if(matches.length!==1) throw Error('Missing or overloaded function: use exact release ABI');
function convert(param,value){
  if(param.type.endsWith('[]')) return value.map(v=>convert({...param,type:param.type.slice(0,-2)},v));
  if(param.type==='tuple') return Object.fromEntries(param.components.map(p=>[p.name,convert(p,value[p.name])]));
  if(/^u?int[0-9]*$/.test(param.type)) {
    if(typeof value==='number'&&!Number.isSafeInteger(value)) throw Error('Unsafe integer');
    return BigInt(value);
  }
  return value;
}
if(input.args.length!==matches[0].inputs.length) throw Error('Argument count mismatch');
const args=matches[0].inputs.map((p,i)=>convert(p,input.args[i]));
const data=encodeFunctionData({abi,functionName:input.functionName,args});
console.log(data);
console.log(JSON.stringify(decodeFunctionData({abi,data}),(_,v)=>typeof v==='bigint'?v.toString():v,2));
JS
```

只将输出第一行 `0x...` 用作 DATA，后面的 JSON 是核对信息。目标地址从 release 清单选择，不能把合约名称或 ABI 内的部署地址当成目标。`value`、chainId、签名者不包含在 calldata 内，必须另行核对。

### 13.2 管理面完整覆盖清单

| 模块 | 需要授权的操作 |
| --- | --- |
| OfficialStockRegistryV1 | registerAsset、acceptAssetImplementation、setMinimumAllocation、pauseAsset、unpauseAsset、retireAsset |
| ApprovedQuoteRegistry | addQuoteConfig、addStockQuoteConfig、pauseQuote、unpauseQuote、retireQuote |
| TickerGardenBaselineRegistry | addBaseline、pauseBaseline、unpauseBaseline、retireBaseline |
| LaunchTemplateRegistry | addLaunchTemplate、pauseLaunchTemplate、unpauseLaunchTemplate、retireLaunchTemplate |
| TreasuryDistributorV1 | registerMarket、setRootServiceFee、publishRoot、cancelPendingRoot |
| ArbitrumTestTreasury | configureSettlementOperator、withdraw；走 owner，不走 AccessManager |
| ProtocolFeeVault | setSettlementOperator 仅平台 receiver；settleRewards/settleHolderRewards 仅 operator |
| CreatorRevenueRegistry | transferCreatorRevenueBeneficiary 仅当前 beneficiary |

前五行共23个 `restricted` 方法已对照编译 ABI 和链上 selector→role 映射核验。其他 Factory/Router/Curve/Gauge/Allocation/Locker 的协议间调用约束不能被当成日常治理接口；“ABI 显示 public/external”不意味着管理员应手动调用。

### 13.3 源码与配套文件

- [不可变 authority 适配器](../../contracts/src/v1/shared/ImmutableAccessManaged.sol)与[本地 AccessManager 实现](../../contracts/lib/openzeppelin-contracts/contracts/access/manager/AccessManager.sol)：本项目权限与延迟执行依据。
- [当前 ABI 接口](../../contracts/src/v1/interfaces/IV1Protocol.sol)：tuple 字段顺序和接口类型；文件为生成产物，不直接手改。
- [股票 Registry](../../contracts/src/v1/modules/OfficialStockRegistryV1.sol)、[Quote Registry](../../contracts/src/v1/modules/ApprovedQuoteRegistry.sol)、[Baseline Registry](../../contracts/src/v1/modules/TickerGardenBaselineRegistry.sol)、[Template Registry](../../contracts/src/v1/modules/LaunchTemplateRegistry.sol)。
- [24小时恢复限制](../../contracts/src/v1/shared/DelayedUnpause.sol)、[Factory 固定配置](../../contracts/src/v1/modules/TickerGardenFactoryV1.sol)、[毕业供应数学](../../contracts/src/v1/libraries/TickerGardenSupplyMath.sol)、[联合毕业经济域](../../contracts/src/v1/libraries/V1GraduationEconomicDomain.sol)。
- [奖励兑换实现](../../contracts/src/v1/shared/ProtocolFeeVaultRewardSettlement.sol)、[费用负债与领取](../../contracts/src/v1/shared/ProtocolFeeVaultLiabilities.sol)、[固定基础分成](../../contracts/src/v1/libraries/MarketFeeAccounting.sol)、[测试接收器](../../contracts/script/v1/ArbitrumTestTreasury.sol)。
- [持有人分配实现](../../contracts/src/v1/modules/TreasuryDistributorV1.sol)、[Go Root 生成器](../../services/backend-go/internal/treasury/root.go)、[创作者收益权转移](../../contracts/src/v1/modules/CreatorRevenueRegistry.sol)。
- [R2 修复记录](../testing/ARBITRUM_RECEIVER_FIX_R2.md)、[Arbitrum 部署说明](../../deployments/ARBITRUM_SEPOLIA.md)、[公开测试方案](../testing/ARBITRUM_SEPOLIA_FUNCTIONAL_TEST_PLAN.md)。

历史文档可能描述较早的权限分离或未广播状态。实际操作优先使用对应网络的已确认部署/激活清单、当前链上回读与匹配代码，不能用过期说明覆盖现场事实。
