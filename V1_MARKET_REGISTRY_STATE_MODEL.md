# TickerGarden V1 市场 Registry 模型

> 版本：`V1-EXEC-8`；本地实现、接口和生成物已同步验证，目标链部署与外部审计仍开放。

## 1. 永久自治与四字段 runtime

`MarketConfig` 在创建时冻结市场组件、资产、Quote、模板和经济参数。可变化的 `MarketRuntime` 只包含四项事实：

```text
poolId         bytes32
sourceVersion  uint32
sweptAt        uint64
launchPhase    uint8
```

`launchPhase` 只允许 `NotGraduated -> Swept -> PoolCreated`，或 `Swept -> Rescued`。它记录发行执行结果，不是管理员控制状态；不存在部署后的市场暂停、退休或接管入口。

## 2. 唯一写入入口

| 函数 | 唯一调用方 | 变化 |
|---|---|---|
| `registerMarket(marketId, config)` | Factory | 初始化 `poolId=0`、`sourceVersion=1`、`sweptAt=0`、`launchPhase=NotGraduated` |
| `markSwept(marketId)` | 该市场的 canonical Curve | 写入 `Swept` 与一次性的 `sweptAt` |
| `commitPoolCreated(marketId, poolId)` | immutable GraduationExecutor | 校验 canonical PoolId，写入 `PoolCreated` 并递增 `sourceVersion` |
| `markRescued(marketId)` | immutable GraduationExecutor | 仅在 `Swept` 满七日后写入终态 `Rescued` |

GraduationExecutor 的 retry/rescue 对外是 permissionless，但 Registry 只接受该 immutable Executor 调用。没有通用 setter，也没有回退边。

## 3. 交易来源与读取

- `NotGraduated` 的有效 fee source 是 Curve；`PoolCreated` 的有效 fee source 是 Hook。
- `Swept` 与 `Rescued` 没有交易 fee source。
- `canonicalPoolKey`、`canonicalPoolId` 和 `canonicalRoute` 由冻结配置与 runtime 推导，客户端不得自行拼接安全关键路由。
- Curve、Hook、FeeVault 和 GraduationExecutor 只依据上述事实与 immutable 身份校验，不读取任何额外市场管理状态。

## 4. 配置状态边界

Asset、Quote、Pons baseline 和 Launch template Registry 仍支持对象级 `ACTIVE <-> PAUSED -> RETIRED`。这些状态限制新增准入或新增 STOCK 敞口，不改写既有市场 runtime，不暂停交易，也不阻止 `rageQuit`。

旧 V1-EXEC-5 的市场管理字段、Controller 与恢复权限已从源码、ABI、权限、部署 schema 和链下投影删除。
