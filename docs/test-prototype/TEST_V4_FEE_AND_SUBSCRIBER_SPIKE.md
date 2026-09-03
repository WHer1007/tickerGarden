# Test Prototype Uniswap v4 手续费与 Subscriber Spike（P-003）

> 历史归档：本文仅记录 Test Prototype 技术验证，不是当前 V1 费用规范或部署证据。

> 状态：`REVIEW / BLOCKED`  
> 日期：2026-09-02  
> 范围：一次性 Foundry 技术验证，不是生产合约实现。

## 1. 结论

Robinhood Chain 主网 canonical Uniswap v4 `PositionManager` 支持 Test Prototype 所需的 NFT Subscriber 生命周期。使用主网真实未订阅仓位进行 live fork 验证后，订阅、取消订阅、调用者校验和“取消订阅回调失败仍不锁 NFT”均通过；完整 canonical `PositionManager.unsubscribe` 路径实测为 `68,528 Gas`，低于 G0-10 的 `150,000 Gas` 目标，也明显低于链上 `unsubscribeGasLimit = 300,000`。

手续费方面发现一项必须在生产 Hook 开工前关闭的口径矛盾：

```text
gross input = G
Hook 先收协议费 0.40% × G
v4 原生 LP fee 再对剩余的 99.60% × G 收 0.60%

组合总费率 = 0.40% + 99.60% × 0.60%
           = 0.9976%
```

因此，“协议费严格等于 gross input 的 0.40%”、“原生 LP fee 为 0.60%”和“总费率严格等于 gross input 的 1.00%”三项不能同时成立。P-003 在此项完成产品与安全签字前不得标记 `DONE`。

## 2. 推荐的 Test Prototype 决策

推荐保留 exact-input-only 和 v4 原生 `0.60%` LP fee，同时将协议费定义为“补足 gross input 总手续费到精确 1.00% 的 remainder”：

```text
TargetTotalFee = ceil(G × 1.00%)
ProtocolFee + ceil((G - ProtocolFee) × 0.60%) = TargetTotalFee
```

连续近似下：

```text
ProtocolFee / G = (1.00% - 0.60%) / (1 - 0.60%)
                ≈ 0.4024144869%
```

实现时使用全精度整数数学和有界舍入修正，使 `ProtocolFee + LPFee == TargetTotalFee`。这保留原生 LP fee 会计、输入资产单边收费和精确 1% 总费率，复杂度最低。代价是协议份额不再能对外描述为 gross input 的严格 0.40%，而应描述为总手续费的约 40%。

不建议 Test Prototype 为同时追求严格 `0.40% + 0.60% = 1.00%` 而实现自定义全额收费后再向 LP donation 的方案。该方案会引入额外 transient accounting、donation/JIT 捕获、边界 tick 和结算风险，明显违背 Test Prototype 不过度复杂化的原则。

## 3. 已验证内容

### 3.1 RH canonical 部署与 ABI

live fork 验证：

- Chain ID 为 `4663`。
- `PositionManager = 0x58daec3116aae6d93017baaea7749052e8a04fa7`。
- runtime code hash 为 `0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2`。
- `name() = Uniswap v4 Positions NFT`。
- `unsubscribeGasLimit() = 300,000`。
- canonical `ISubscriber.notifySubscribe(uint256,bytes)` 和 `notifyUnsubscribe(uint256)` selector 与 pinned 源码一致。

### 3.2 真实 NFT 生命周期

测试在 RH 主网 live fork 中动态寻找最近的非零流动性、未订阅仓位，并 impersonate 当前 NFT owner：

1. owner 调用 canonical `PositionManager.subscribe`，Probe 收到 `notifySubscribe`。
2. owner 调用 `unsubscribe`，canonical subscriber mapping 被清空，Probe 收到 `notifyUnsubscribe`。
3. 完整 unsubscribe 路径使用 `68,528 Gas`。
4. Probe 强制在 `notifyUnsubscribe` revert 时，PositionManager 仍清空订阅；用户 NFT 不会因 Gauge 回调失败而被锁定。
5. 非 canonical PositionManager 直接调用回调会被拒绝。

### 3.3 手续费与 exact-input

- exact-output 被明确拒绝，避免 hook delta、最大输入和输出不足时产生第二套收费语义。
- `G = 1,000,000` 时，严格 gross `0.40%` 协议费为 `4,000`；剩余 `996,000` 的原生 `0.60%` LP fee 为 `5,976`；总费仅 `9,976`。
- 调整协议 remainder 后，协议费为 `4,024`、LP fee 为 `5,976`、总费精确为 `10,000`。
- 256 组 fuzz 向量验证精确总费方案满足金额守恒。

## 4. 可复现资产

历史隔离工程路径为 `spikes/v4-subscriber`（当前仓库已不再保留）：

- Foundry `v1.8.1`。
- `Uniswap/v4-periphery` commit `dce236d4e2057422d0791d9a973a58765eb46f65`。
- nested `Uniswap/v4-core` commit `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc`。
- `forge-std` `v1.14.0` commit `1801b0541f4fda118a10798fd3486bb7051c5dd6`。

执行：

```bash
cd spikes/v4-subscriber
RH_RPC_URL=https://rpc.mainnet.chain.robinhood.com /Users/dear/.foundry/bin/forge test -vv
```

当前结果为 `9 passed, 0 failed`，其中手续费 5 项、RH live-fork Subscriber 4 项。

## 5. 未关闭项

1. 产品与安全负责人需在以下两种口径中选择并签字：
   - 推荐：总费严格 1.00%，LP 原生 0.60%，协议费为补足 remainder（约 gross 0.402414%）。
   - 备选：协议费严格 gross 0.40%，LP 原生 0.60%，接受组合总费率约 0.9976%。
2. 公共 RH RPC 只能用于 latest live smoke，无法提供旧块 `51,897,839` 所需的历史 metadata。CI 必须配置 archive RPC，才能固定区块长期复现。
3. 本 spike 尚未实现生产 `TickerGardenFeeHook`；生产 Hook 必须等待 G0-07 口径关闭，并补充真实 pool 的 currency delta、极小额、部分成交、`minAmountOut`、两方向和 Router 集成测试。
4. live fork 只能证明当前 canonical ABI/行为；部署前仍须按 manifest 重验地址、code hash 和关键 getter。

## 6. 官方依据

- [Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments)
- [Uniswap v4 PositionManager](https://github.com/Uniswap/v4-periphery/blob/main/src/PositionManager.sol)
- [Uniswap v4 Notifier](https://github.com/Uniswap/v4-periphery/blob/main/src/base/Notifier.sol)
- [Uniswap v4 Hooks accounting](https://github.com/Uniswap/v4-core/blob/main/src/libraries/Hooks.sol)
- [Robinhood Chain connecting and RPC endpoints](https://docs.robinhood.com/chain/connecting/)
