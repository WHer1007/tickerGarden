# TickerGarden V1 市场 Registry 模型

> 版本：`V1-EXEC-9`；本地实现、接口和生成物已同步验证，目标链部署与外部审计仍开放。

## 1. 永久自治与三字段 runtime

`MarketConfig` 在创建时冻结市场组件、资产、Quote、模板和经济参数。可变化的 `MarketRuntime` 只包含三项事实：

```text
poolId         bytes32
sourceVersion  uint32
launchPhase    uint8
```

`launchPhase` 只允许 `NotGraduated -> PoolCreated`。它记录原子毕业结果，不是管理员控制状态；不存在持久中间态、回退边、部署后的市场暂停、退休或接管入口。

## 2. 唯一写入入口

| 函数 | 唯一调用方 | 变化 |
|---|---|---|
| `registerMarket(marketId, config)` | Factory | 初始化 `poolId=0`、`sourceVersion=1`、`launchPhase=NotGraduated` |
| `commitPoolCreated(marketId, poolId)` | immutable GraduationExecutor | 仅从 `NotGraduated` 校验 canonical PoolId；在同一最终买入中完成池、仓位、Locker、Hook 验证后写入 `PoolCreated` 并递增 `sourceVersion` |

Registry 只接受 immutable GraduationExecutor 提交成功结果。没有 retry、rescue、任意接收人、通用 setter 或回退边；提交前任一外部调用失败会使整笔最终买入回滚。

## 3. 交易来源与读取

- `NotGraduated` 的有效 fee source 是 Curve；`PoolCreated` 的有效 fee source 是 Hook。
- 不存在没有 ACTIVE fee source 的持久毕业中间态。
- `canonicalPoolKey`、`canonicalPoolId` 和 `canonicalRoute` 由冻结配置与 runtime 推导，客户端不得自行拼接安全关键路由。
- Curve、Hook、FeeVault 和 GraduationExecutor 只依据上述事实与 immutable 身份校验，不读取任何额外市场管理状态。

## 4. 配置状态边界

Asset、Quote、Pons baseline 和 Launch template Registry 仍支持对象级 `ACTIVE <-> PAUSED -> RETIRED`。这些状态限制新增准入或新增 STOCK 敞口，不改写既有市场 runtime，不暂停交易，也不阻止 `rageQuit`。

旧 V1-EXEC-5 的市场管理字段、Controller 与恢复权限已从源码、ABI、权限、部署 schema 和链下投影删除。
