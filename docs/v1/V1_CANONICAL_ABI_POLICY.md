# TickerGarden V1 Canonical ABI 与权限词汇

> **当前 ABI 边界（2026-09-04）：** 市场级状态迁移、MarketController 和管理型 Recovery ABI 已删除；保留资产/配置 Registry 的 pause/retire ABI，以及用户无状态依赖的即时 `rageQuit`。旧 Emergency 签名只作为已移除记录，不能视为当前 ABI。

> 规格任务：`V1-P-002`
> 状态：`FROZEN / IMPLEMENTATION_ALLOWED`  
> 适用基线：`V1-EXEC-10`
> 更新时间：2026-09-03

## 1. 单一机器来源

- 人类可读函数与结构体边界：`spec/v1_abi_surface.json`。
- target、caller、执行延迟、状态等待、前置条件和 recipient：`spec/v1_permissions_matrix.json`。
- 展开 tuple 后的规范期望清单：`spec/v1_canonical_abi.json`，只能由 `spec/generate_v1_canonical_abi.py` 生成，不手工维护。
- 正式编译接口：`contracts/src/v1/interfaces/IV1Protocol.sol`，只能由 `spec/generate_v1_interfaces.py` 从 machine surface 生成。
- 编译事实清单：`spec/v1_compiled_interface_manifest.json`，只能由 `spec/generate_v1_artifact_manifest.py` 从 solc 0.8.26 artifact 生成，并反向精确校验 surface、canonical ABI 与权限矩阵；实现与链下消费者不得直接信任别名字符串或 draft interface。

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
- `stateDelaySeconds` 是业务状态从某个链上时间锚点开始的等待；不能伪装成角色延迟。当前 V1-EXEC-10 全部为0。
- 当前 ABI 不得出现 graduation retry、terminal rescue、`sweptAt` 锚点或市场资产接收人。
- `PUBLIC_SELF_ONLY` 不是 caller。caller 使用 `PUBLIC`，本人收款约束写入 `recipient/precondition`。
- `*_DELAYED` 不是 caller。caller 与延迟必须拆成两个字段。

canonical caller 词汇仅允许：

```text
PUBLIC
PROTOCOL_ADMIN_ROLE
PAUSE_GUARDIAN_ROLE
UNPAUSE_ROLE
FACTORY_MODULE
LAUNCH_ROUTER_MODULE
GRADUATION_MODULE
ALLOCATION_MODULE
POOL_MANAGER
ACTIVE_FEE_SOURCE
EXACT_REGISTERED_CURVE
EXACT_REGISTERED_GAUGE
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
- 任一 mutation 的 `stateDelaySeconds` 非0，或重新出现 graduation retry/terminal rescue；
- 新增 mutation 未同步 recipient、precondition 和 delay；
- 出现 `PUBLIC_SELF_ONLY`、`*_DELAYED` 等混合词汇。
- Markdown 冻结签名与机器 ABI 的参数或返回值不同；任何已删除的市场管理或 recovery selector 再次出现。
- 同一语义事件由多个模块重复定义；当前 Curve 只以 `CurveCompleted` 表示最终成交完成，GraduationExecutor 只以 `PoolGraduated` 表示原子成功，已删除的 `LaunchSwept`、`AutoGraduationFailed`、`LaunchRescued` 不得回流。Curve 的手续费转账证明与 FeeVault 的分桶证明继续使用不同事件名。
