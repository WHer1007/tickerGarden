# RH 测试网 ETH 自动兑换原子首买：部署与验收报告

日期：2026-09-08。网络：Robinhood Chain Testnet，Chain ID 46630。生产目标仍为 RH 主网（4663）。

## 结论与范围

**新 release 已部署，10 项公开链原子首买测试通过，链上测试配置已启用，前端及后端配置文件已切换。** 状态为 `ACTIVE_TEST_BUSINESS_ATOMIC_BUY_VERIFIED`；不是生产批准，也不是完整前端/奖励结算 E2E 通过。

本次检查发现本地 Read API `/health` 的 `sync.status=unavailable`（切换前即如此）。后端环境已更新，运行中的服务还需加载新配置并完成可信快照发布，页面交易入口才具备完整就绪条件。未绕过前端的 finalized/sync 校验；不能将本文解读为浏览器钱包联调全部完成。

## 新版本与绑定

- releaseId：`0x985650b4d3758a5345be196182d2945b9c2df3f828fdb4dbd1a94e4b6def2b64`。
- Factory：`0xE74162027c477E1c591Fac1d36e219C28DAd1522`。
- LaunchAndBuyRouter：`0x76cb1dcb45bbc003ae4aa433e936a678cd4c2388`。
- PoolManager：`0x8366a39cc670b4001a1121b8f6a443a643e40951`。
- Stock 兑换池形状：原生 ETH / Stock、fee 10000（1%）、tickSpacing 200、hooks 零地址。
- 官方 Quote：ETH、USDG、TSLA、AMZN、PLTR、NFLX、AMD。
- Stock 质押白名单：TSLA、AMZN、PLTR、NFLX、AMD。
- 原生 Quote 毕业阈值：0.42 ETH；其他 Quote 使用各自单位的阈值。24 小时持有人释放、5 秒防抢跑、创建者税上限 5% 等既有规则保留。
- 独立测试账户：`0xeFc48ef27bb113a907cc0dD96e71291ddBeB3B4D`。仅使用测试币；密钥存于本地受限配置，不进入报告或仓库。

19 笔部署交易均成功；部署 Gas 费用合计 **0.00057034271 ETH**。结算执行者已单独配置并验证，随后完成基础配置与官方资产计划审核、注册和状态核对。公开首买需要先启用新 release 的链上配置；前端清单在公开测试通过后才切换，旧 release 记录和原配置备份保留。

## 验收结果

| 场景 | 结果 | 实际 Gas used | 链上证据 |
| --- | --- | --- | --- |
| zero-TSLA | 通过（成功） | 12820796 | [交易](https://explorer.testnet.chain.robinhood.com/tx/0xc440c0f5bb3bd8d67b76a92256c9f94c016a4e0218b0a9f42bea09f40c27e4bb) |
| zero-AMZN | 通过（成功） | 12820100 | [交易](https://explorer.testnet.chain.robinhood.com/tx/0x43a64e812f9026771169ab44936e10bc74c2c05feb0eba4378698049347e5a82) |
| zero-PLTR | 通过（成功） | 12820953 | [交易](https://explorer.testnet.chain.robinhood.com/tx/0x9a80a0310ad7c84e3df07064ccd7707213770640dc3c9094c0497fc3bd79ad53) |
| zero-NFLX | 通过（成功） | 12820795 | [交易](https://explorer.testnet.chain.robinhood.com/tx/0x1ded81adf3abfaddb19cc9bc0391cba18ac79db852c318853034dac23b884433) |
| zero-AMD | 通过（成功） | 12820466 | [交易](https://explorer.testnet.chain.robinhood.com/tx/0xe10d77d0cef469619cb46ff5525e74b7e13fb0fb67ec4eda6302f25db1bad922) |
| revert-max-eth | 通过（按预期回滚） | 152542 | [交易](https://explorer.testnet.chain.robinhood.com/tx/0x6256343f2013218683fc8803f2f4adb625392514b4522c3438ae8233be20bf70) |
| revert-min-output | 通过（按预期回滚） | 13057520 | [交易](https://explorer.testnet.chain.robinhood.com/tx/0xa1705478bcde37491e3e8942ae15cf04099e4092816d8bf34e03ba504fdae252) |
| partial-TSLA | 通过（成功） | 12820410 | [交易](https://explorer.testnet.chain.robinhood.com/tx/0x2282b8eec4aa9697956755f71d13c0f09df75877939ffcdca31a631be87ab473) |
| direct-TSLA | 通过（成功） | 12754250 | [交易](https://explorer.testnet.chain.robinhood.com/tx/0x0678d777d3c9035a79243329e253eda2a18f1d3fb9d716b1f97632145a6e6364) |
| native-ETH | 通过（成功） | 5880631 | [交易](https://explorer.testnet.chain.robinhood.com/tx/0x6de1793c5cdff27bcf424ca1e3b9411af62af8f4babf0a4757e220dfa38b0e00) |

五种 Stock 零余额测试中，每次 Developer buy 为 0.001 Stock。测试账户在该项开始时对应 Stock 余额为 0，同笔交易完成 v4 Swap、Factory 创建和 Curve 首买，最终获得 Meme，钱包 Stock 余额仍为 0。

部分余额测试先转入 0.0001 TSLA，再执行 0.001 TSLA 首买；整笔 Quote 自动用 ETH 兑换，已有 0.0001 TSLA 保留。直接 Quote 测试使用既有 TSLA 和授权，核对扣款为 0.001 TSLA。直接 ETH 测试使用 0.0001 ETH 首买。

退款和失败校验：

- Router 在各笔交易前后的 ETH 和 Quote 余额相等，无新增资金残留。
- 成功首买收到 Meme 不低于签署的最小输出；真实 ETH 扣款不超过交易 value，Gas 单独计算。
- ETH 上限不足与不可能满足的 Meme 最低输出，均在公开链按预期回滚；预测 Token 地址没有部署代码，Quote 余额未变，扣款仅为 Gas。
- 每笔回执核对发送者、目标、nonce、value、calldata 哈希、区块哈希与规范链一致性；成功兑换路径保留 PoolManager Swap 和 Factory MarketCreated 日志。

详细原始数值、退款、余额与事件见 [机器可读测试记录](./atomic-buy-public-test.json)。本次公开测试交易 Gas 费用合计 0.0011679588 ETH，包含首笔 Gas 上限不足的失败尝试和测试资金转账/授权 Gas；不含可退还本金、留在测试钱包的 ETH 或首买支出。测试账户最初获资 0.012 ETH。

## 发现并处理的问题

1. 初版测试脚本的 economics 预览没有显式传 creator，触发 `InvalidCreator(0)`；这是只读脚本参数问题，已修正，未造成发布交易。
2. 首次 TSLA 交易 Gas 上限 8,000,000，实际回滚。交易：[失败尝试](https://explorer.testnet.chain.robinhood.com/tx/0xb3aefff875a0073e4ac84b775a51a5b3e2b65b86b6509c77dc92be6837b523b0)。同一失败区块重放中，8M 失败，16M、30M 成功；16M 上限的真实重试成功。成功 Stock 首买实际约 **12.82M Gas**。标准 callTracer 请求被 RPC 拒绝，因此诊断依据为原交易回执与同区块、同 calldata 的 Gas 对照重放，不宣称取得完整执行 trace。
3. 前端此前只用 3M Gas 预算。本次 RH 测试网下限调整为 16M；签名前再估算，取估算值加 20% 与下限的较大值，核对 ETH 余额并显式传给钱包。Gas limit 是上限，实际只按使用量计费。
4. 前端原本把 ETH 退款与 Stock raw amount 比较，现改为与 ETH 兑换上限比较；新增 Router 与 Quoter 的 PoolManager 一致性检查。

8M 失败记录保留在 `priorAttempts`，没有删除或计入成功样本。Gas 下限仅针对 RH 测试网验证结果，不构成主网 Gas 承诺；主网仍需独立估算与回归。

## 本地检查

- 合约：83 套件，889 项通过，0 失败，0 跳过（普通本地测试，排除独立 live Fork track）。
- 前端：151 项通过，新增显式 Gas 预算传递回归；TypeScript 与生产构建通过。构建仍有既有 chunk 大小提示。
- boundary、spec、interfaces、product artifacts：通过。
- 部署：新 release 预演、19 笔 unsigned batch 校验、证书、临广播 nonce/余额/外部代码检查、部署后运行码和绑定验证通过。
- 公开链测试直接使用 RH 官方资产及实际 v4 池，不以 mock、历史余额截图或静态报价替代。

## 本地证据索引与复查

- [部署及代码指纹](./robinhood-testnet-46630.v1.deployed.json)
- [部署交易日志](./robinhood-testnet-continuous-transactions.json)
- [结算执行者配置](./settlement-operator-configuration.json)
- [基础激活计划](./activation-plan.json)、[审核](./activation-audit.json)、[执行](./activation.json)
- [官方资产激活证据](./canonical-asset-activation.json)
- [业务配置切换记录](./business-activation.json)
- [当前 release Quote 清单](./paired-assets.json)、[Stock 清单](./stock-assets.json)
- [Gas 对照重放](./first-atomic-gas-replay.json)
- [本地校验日志目录](../../../outputs/reviews/robinhood-testnet-atomic-buy-2026-09-08/)

复查脚本：`tools/test-robinhood-atomic-buy.mjs` 使用 `TG_RH_RELEASE_ID` 指向本 release。该脚本会使用测试签名账户；不要为“查看结果”重复运行，日常直接阅读 JSON。脚本保存签名意图和交易哈希，已有交易先查回执，出现未知状态必须核实后再处理，不能另开 nonce 重复发送。

仍未覆盖：浏览器实际签名联调、毕业尾部 Quote 剩余退款、多跳兑换、USDG 自动 ETH 路由、主网 Gas/流动性、完整持有人结算与质押退出周期。本次不会自动启用这些功能的验收标记。
