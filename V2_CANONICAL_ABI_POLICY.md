# TickerGarden V2 Canonical ABI 与权限词汇

> 规格任务：`V2-P-002`  
> 状态：`FROZEN / IMPLEMENTATION_ALLOWED`  
> 适用基线：`V2-EXEC-5`
> 更新时间：2026-09-03

## 1. 单一机器来源

- 人类可读函数与结构体边界：`spec/v2_abi_surface.json`。
- target、caller、执行延迟、状态等待、前置条件和 recipient：`spec/v2_permissions_matrix.json`。
- 展开 tuple 后的规范期望清单：`spec/v2_canonical_abi.json`，只能由 `spec/generate_v2_canonical_abi.py` 生成，不手工维护。
- 正式编译接口：`contracts/src/v2/interfaces/IV2Protocol.sol`，只能由 `spec/generate_v2_interfaces.py` 从 machine surface 生成。
- 编译事实清单：`spec/v2_compiled_interface_manifest.json`，只能由 `spec/generate_v2_artifact_manifest.py` 从 solc 0.8.26 artifact 生成，并反向精确校验 surface、canonical ABI 与权限矩阵；实现与链下消费者不得直接信任别名字符串或 draft interface。

## 2. Canonical signature

函数的 `displaySignature` 可以引用规范结构体名，`canonicalSignature` 必须递归展开成 ABI tuple。例如：

```text
addQuoteConfig(bytes32,QuoteAssetConfig)
-> addQuoteConfig(bytes32,(bytes32,address,uint8,uint256,uint256,bytes32,uint8))
```

value type 必须展开为底层 ABI 类型；当前 `BalanceDelta -> int256`。`PoolKey` 中 `Currency` 与 `IHooks` 在 ABI 上均为 `address`。selector 只按以下公式计算：

```text
bytes4(keccak256(bytes(canonicalSignature)))
```

禁止直接对 Solidity 别名、带参数名的字符串、returns、空格或文档签名计算 selector。

## 3. 权限字段

每个 mutation 派生行必须恰有：

```text
module
displaySignature
canonicalSignature
caller
executionDelaySeconds
stateDelaySeconds
stateDelayAnchor
precondition
recipient
```

- `executionDelaySeconds` 是 AccessManager/角色执行延迟。
- `stateDelaySeconds` 是业务状态从某个链上时间锚点开始的等待；不能伪装成角色延迟。
- 七日 rescue 固定为 `stateDelaySeconds = 604800`、`stateDelayAnchor = MARKET_RUNTIME_SWEPT_AT`，其 public 调用没有 AccessManager 延迟。
- `PUBLIC_SELF_ONLY` 不是 caller。caller 使用 `PUBLIC`，本人收款约束写入 `recipient/precondition`。
- `*_DELAYED` 不是 caller。caller 与延迟必须拆成两个字段。

canonical caller 词汇仅允许：

```text
PUBLIC
PROTOCOL_ADMIN_ROLE
PAUSE_GUARDIAN_ROLE
UNPAUSE_ROLE
RECOVERY_ROLE
FACTORY_MODULE
LAUNCH_ROUTER_MODULE
GRADUATION_MODULE
ALLOCATION_MODULE
POOL_MANAGER
ACTIVE_FEE_SOURCE
EXACT_REGISTERED_CURVE
MARKET_CONTROLLER
ALLOCATION_MODULE_OR_FEE_VAULT
FEE_VAULT
CURRENT_CREATOR_BENEFICIARY
```

AccessManager 自身的管理函数使用其官方 caller 语义，单独保留在权限矩阵，不进入协议模块 ABI 派生清单。

## 4. 一致性门禁

规格测试必须失败于以下任一情况：

- mutation 缺少权限行或出现多行；
- ABI caller 与权限 caller 不完全相等；
- 存在未定义或递归 ABI 类型；
- tuple 展开结果与已提交派生文件不同；
- rescue 的七日等待被删除、改成角色延迟或锚点不是 `sweptAt`；
- 新增 mutation 未同步 recipient、precondition 和 delay；
- 出现 `PUBLIC_SELF_ONLY`、`*_DELAYED` 等混合词汇。
- Markdown 冻结签名与机器 ABI 的参数或返回值不同；尤其禁止 Emergency caller 提交 snapshot/hash/cap。
- 同一语义事件由多个模块重复定义；`LaunchSwept/AutoGraduationFailed` 只属于 Curve，`PoolGraduated/LaunchRescued` 只属于 GraduationExecutor，Curve 的转账证明与 FeeVault 的分桶证明使用不同事件名。
