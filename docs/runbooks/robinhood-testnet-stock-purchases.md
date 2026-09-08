# Robinhood 测试网 Stock 购买路径

2026-09-08 已实际成交并确认；仅适用 chain **46630**。

机器配置：[stock-swap-routes.json](../../deployments/manifests/robinhood-testnet-46630.stock-swap-routes.json)。下次优先读取这个文件，无需重新浏览网站、搜索地址、扫描历史或逐档探测池。

| Stock | 默认池 | fee |
|---|---|---|
| TSLA | `0x14768ae6e6c655e9df62256b18d7df85501c24fc` | 500 |
| AMZN | `0x52da6b2ea089d0fb2054b057a88d8aa516cb54c3` | 3000 |
| PLTR | `0x4dac9debe44d3aa104ab66f09debb40c59f4a283` | 3000 |
| NFLX | `0x3274d3092aa2e1a9321ab2cb04697c87c5a389b0` | 3000 |
| AMD | `0x51cc359a19dfd16217cd6c186e1476f78768588d` | 3000 |

fee 500 = 0.05%，3000 = 0.3%。以上是本次使用并成功成交的路径，不保证永远是最优价。

- Factory：`0x911b4000d3422f482f4062a913885f7b035382df`
- Quoter：`0x231606c321a99de81e28fe48b07a93f1ba49e713`
- Router：`0x3ce954107b1a675826b33bf23060dd655e3758fe`
- WETH：`0x33e4191705c386532ba27cbf171db86919200b94`

## 下次操作

1. 按配置中的 token 地址和默认 fee，查询本次所需精确输出数量的报价。默认池不可用才考虑配置内的候选池。
2. 使用新报价设置 `amountInMaximum`（本次为 1% 滑点），并检查 ETH 余额、gas、nonce。历史价格不复用。
3. 使用 `multicall(uint256 deadline, bytes[] data)` 包含 `exactOutputSingle` 和 `refundETH`；Router 的 exactOutputSingle 参数**没有 deadline 字段**，deadline 在外层 multicall。输入 ETH，由 Router 包装为 WETH，多余 ETH 自动退回。
4. 新交易先模拟；确认回执及实际 Stock 到账后，按当前授权转给购买者。不要重播旧计划、旧 nonce 或旧签名。
5. 所有 RPC 走 `http://127.0.0.1:18570`，共享 10,000 CU/s；临时精确交易授权在完成后关闭。

只读报价命令（不会签名、购买或转账）：

```sh
node tools/quote-robinhood-testnet-stock.mjs TSLA 1.86
```

合约和池的历史验证不重复执行。仅在路由失败、已知升级或明确要求时调查变更。测试网 V3 采购池与项目毕业使用的 V4 池是不同用途，不要互相替代。

成交证据：[result.json](../../outputs/reviews/stock-graduation-funding-2026-09-08/result.json)，包含五笔购买与五笔转账的真实 hash；机器配置为每个默认池保留购买回执的 block/hash。
