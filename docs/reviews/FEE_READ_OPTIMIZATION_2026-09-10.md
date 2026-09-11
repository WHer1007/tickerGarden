# 交易收费重复读取优化

范围：当前源码；本地 Foundry EVM；没有 RPC、部署或广播。保持外部 ABI、存储布局、收费比例及收益归属不变。

## 改动

- Hook `afterSwap` 读取一次 PoolManager slot0，使用其中的 LP fee 校验，并将同一次读取的 tick 传给奖励价格观察更新。独立奖励兑换完成后仍重新读取价格，不能复用兑换前的 tick。
- FeeVault `finalizeV4Credit` 的来源校验返回已验证 MarketView，内部传递给费率/nonce 校验及收益分配。Holder 开关、Meme 地址使用该快照，避免再次读取完整市场。
- 保留 begin 与 finalize 两次来源校验：两者之间存在外部转账。未增加跨调用的持久或瞬态市场缓存。
- 保留实际到账余额差、偿付能力校验、feeId/nonce 防重放、finalizing 状态防重入、Gauge 激活权重和 Creator epoch 归属检查。
- Curve 分账复用该内部接口，仍自行读取当前市场；不改变 Curve 的外部入账流程。

## Gas 对照

同一个 `HolderPoolFlowTest` fixture、相同编译配置，真实本地 PoolManager、Token、Hook、FeeVault、Holder distributor，仅配置 registry 模拟。测量 `router.swap` 调用范围，非测试函数整体，也不是线上交易 receipt gas。场景开启 Holder 分成和底层方向性协议费，未启用 Staker 仓位。

| 场景 | 优化前 | 优化后 | 减少 |
|---|---:|---:|---:|
| 买入，精确输入 | 584660 | 569419 | 15241 |
| 买入，精确输出 | 573830 | 558589 | 15241 |
| 卖出，精确输入 | 569569 | 554328 | 15241 |
| 卖出，精确输出 | 579943 | 564702 | 15241 |
| 已完成 Holder checkpoint 后卖出 | 488447 | 473206 | 15241 |
| 6 批 Holder 奖励到期时卖出 | 585429 | 570188 | 15241 |

前四项降低约 2.6–2.7%。结果取决于存储冷热、资产和奖励配置，不保证所有线上交易减少相同 Gas。

`test_swapReusesSlot0AndFinalizedMarketSnapshot` 精确校验整个买卖路径中 pool slot0 外部读取一次，`market(id)` 三次（Hook binding、FeeVault begin、FeeVault finalize）；并确认 Holder 入账与资产负债守恒。

## 验证

- 初始对照 24 项测试通过；收费、回滚、重入与完整池路径专项 59 项通过。
- 全量非 Fork 回归：88 个测试套件，939 项通过，0 失败。规范测试 63 项通过。
- 生成产品制品、接口及 fixture 一致性检查通过。
- 已部署合约不因此改变；新 runtime 需要重新走部署验证，不能沿用旧 runtime 的部署证据。
