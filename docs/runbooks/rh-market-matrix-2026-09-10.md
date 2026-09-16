# Robinhood 测试网多钱包市场测试 · 2026-09-10

## 结果与边界

- 链：46630；仅 test 环境，未重新部署合约、未修改 master 参数。
- 新建 12 个市场，4 个独立钱包参与，3 个市场完成毕业、9 个保持 Growing。
- 170 笔已上链成功交易：51 笔 Curve 买卖、9 笔外部池交易，其余为资金准备、创建、授权、质押、结算与领取。交易金额和参与钱包采用可复现的差异化组合。
- 手续费精确分账 279 项通过；链上状态 100 项通过；统计对账 53 项通过；8 项只读负向模拟返回预期错误。
- 即时用例完成；4 笔质押奖励领取需等待真实的 24 小时锁定结束。未验证解锁后的领取与普通退出，不将其计为通过。
- 这是一轮真实测试网回归，不构成全面合约安全审计。创建通过测试脚本发起，未覆盖浏览器签名交互和 IPFS 上传端到端流程。

## 钱包

| 角色 | 地址 |
|---|---|
| main | `0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea` |
| alice | `0xFE2D0220154Ad72429E7f19270C296CfC3110E82` |
| bob | `0x7eecDAB4494D68858734Fd53D205Ff6be45f0821` |
| carol | `0xF5dec59111503B27a94B1CF031eD440eA5433eB1` |
| dave | `0xF6Cb37c223f3ab1A45256aD74F9752c539ae518b` |

主钱包本轮提供 1.98 ETH；检查时剩余 0.855594478949483815 ETH。其余测试资金保留在新钱包、市场和质押头寸中以便继续联调。私钥仅在仓库外受限目录保存，本清单不包含私钥。

## 市场参数

每个代币最大发行量为 1,000,000,000；前三个 ETH 市场毕业目标为 0.42 ETH。完整地址、配置 ID、Curve、Gauge、PoolKey 见复用清单。

| Symbol | 创建者 | 配对资产 | Creator Tax | Holder 分成 | Staking | 状态 |
|---|---|---|---|---|---|---|
| GQA01 | alice | ETH | 0% | 开 | 开 | Bloomed |
| GQA02 | bob | ETH | 0.25% | 关 | 关 | Bloomed |
| GQA03 | carol | ETH | 1% | 开 | 开 | Bloomed |
| GQA04 | dave | ETH | 2.5% | 关 | 开 | Growing |
| GQA05 | alice | ETH | 5% | 开 | 关 | Growing |
| GQA06 | bob | ETH | 1.25% | 关 | 开 | Growing |
| GQA07 | carol | ETH | 0% | 开 | 开 | Growing |
| GQA08 | dave | TSLA | 0.25% | 关 | 关 | Growing |
| GQA09 | alice | AMZN | 1% | 开 | 开 | Growing |
| GQA10 | bob | PLTR | 2.5% | 关 | 开 | Growing |
| GQA11 | carol | NFLX | 5% | 开 | 关 | Growing |
| GQA12 | dave | AMD | 1.25% | 关 | 开 | Growing |

## 复用入口

- [GQA01](http://127.0.0.1:5178/trade?marketId=0x19e9160ee7035f0afaae3e1d1bdf3cb4aa6891dcb978cec516fb9af5b3da9e6f) — Token `0x8447a2992a2A21d0Bc073B83E485e6bD9Ae100FA`；Market `0x19e9160ee7035f0afaae3e1d1bdf3cb4aa6891dcb978cec516fb9af5b3da9e6f`。
- [GQA02](http://127.0.0.1:5178/trade?marketId=0x1857a0362a7693a68d442271c6e46443084ea140f7fff30b0324d1c660b122aa) — Token `0xece136De02432E62D72663BccF629400F8F123d2`；Market `0x1857a0362a7693a68d442271c6e46443084ea140f7fff30b0324d1c660b122aa`。
- [GQA03](http://127.0.0.1:5178/trade?marketId=0x379c310b391b353da445723906ef6814d152cad67d3f1e1bf308286cc2f1039b) — Token `0x9783EE8935d483fEfC8d39d6B6b371FA1019A460`；Market `0x379c310b391b353da445723906ef6814d152cad67d3f1e1bf308286cc2f1039b`。
- [GQA04](http://127.0.0.1:5178/trade?marketId=0xe6f9935c58cc127fc4bcca4f0d839b2664b2dadcfcfa37858ef5bb2dedcc3674) — Token `0x19407A07e531Ae9e8AE567F572069324E1D84eD0`；Market `0xe6f9935c58cc127fc4bcca4f0d839b2664b2dadcfcfa37858ef5bb2dedcc3674`。
- [GQA05](http://127.0.0.1:5178/trade?marketId=0xf74d2e98bb5dd4ff95d68619a267a5ffd850b5e4f636976e70a94e49c4025d0a) — Token `0x5Ec84Afd7f9DBbc5C5f5E73A0F713E9D96273B3d`；Market `0xf74d2e98bb5dd4ff95d68619a267a5ffd850b5e4f636976e70a94e49c4025d0a`。
- [GQA06](http://127.0.0.1:5178/trade?marketId=0xd3bdab4db73421d3d0b6bce2da6b14ad71fc628006c8bac5379f2585afe5bb41) — Token `0xcd0a5d80E1912f3286116dD29a304106C2497e55`；Market `0xd3bdab4db73421d3d0b6bce2da6b14ad71fc628006c8bac5379f2585afe5bb41`。
- [GQA07](http://127.0.0.1:5178/trade?marketId=0xf9b5562e54ab1adf4ff7b221bd8a0e8c6ba1c0eef061626c6f6fa9ac493ccfd8) — Token `0x39148cFac131Ba037e9Df41e9d3D78941fbA316f`；Market `0xf9b5562e54ab1adf4ff7b221bd8a0e8c6ba1c0eef061626c6f6fa9ac493ccfd8`。
- [GQA08](http://127.0.0.1:5178/trade?marketId=0x0046847f99de3caae0743cc0ef1158ddce5b87b01c49ea733f1e940bd568b128) — Token `0xdDa439414CB57dbc6F11dc92074D0495fBb1357e`；Market `0x0046847f99de3caae0743cc0ef1158ddce5b87b01c49ea733f1e940bd568b128`。
- [GQA09](http://127.0.0.1:5178/trade?marketId=0x9c2a8b805b1fc88a32947505756af9fffc1a4b4efaff9af03244917f26f83a06) — Token `0x1cdC269127FBeEdddA24A54381201F335d4F8b0B`；Market `0x9c2a8b805b1fc88a32947505756af9fffc1a4b4efaff9af03244917f26f83a06`。
- [GQA10](http://127.0.0.1:5178/trade?marketId=0xc6da5571cab5e884da3ab33172a259298c08a8d0ee99a317cf56ba25b5d13cac) — Token `0x1b45606074a7C46f1a20F38c64CB61Cb990104af`；Market `0xc6da5571cab5e884da3ab33172a259298c08a8d0ee99a317cf56ba25b5d13cac`。
- [GQA11](http://127.0.0.1:5178/trade?marketId=0xef2ac78a86037b20bce4451af1bdbb6fd0aed928be78bb6594087eb98c789dbc) — Token `0x856b6b75FB50F2f8400CaB205C3569c19C5F143b`；Market `0xef2ac78a86037b20bce4451af1bdbb6fd0aed928be78bb6594087eb98c789dbc`。
- [GQA12](http://127.0.0.1:5178/trade?marketId=0xf9b40d99dc0992e6a8f4dfd17fafaf88cc0d5be48da6d5c4a7696e44e47c79ad) — Token `0xEf1419dA09e8DF4c47a2C5E1a2a4D80f3542Ee15`；Market `0xf9b40d99dc0992e6a8f4dfd17fafaf88cc0d5be48da6d5c4a7696e44e47c79ad`。

## 本轮修复

1. 市场目录改为独立、分页读取创建记录，避免交易增多后创建事件被最近 100 条事件窗口挤出，导致市场消失。
2. 补齐实际项目 Router、Permit2 和保存的 Stock 池只读访问范围，修复毕业后报价模拟与 Stock 估值依赖缺失。
3. RPC 保留合约 revert 信息，允许钱包确认所需的区块高度、指定交易查询；默认仍禁止广播。临时精确签名交易许可现已关闭并过期。
4. 补齐按项目事件计算的 24H 成交量、实际手续费分配、质押钱包去重与质押 USD 价值；采用后端缓存和异步更新，普通统计 20 分钟缓存。
5. 修复浏览器区块索引返回尾部空 topic 引发成交量解码失败；页面初次加载短期读取后端缓存，不阻塞交易。

## 统计与分账口径

- Curve 手续费及毕业扫款按逐笔回执重建：基础手续费、Creator Tax、Holder 分成分别核对，使用整数与链上舍入规则。
- 外部池逐笔检查有无活跃 Staker 时的分配；检查 FeeVault 各资产余额不低于负债。
- 每个新市场成交量与本轮确认回执匹配；非原生资产手续费桶与后端匹配。原生 ETH 全局桶包含原有市场，不将其误当作仅本轮数据。
- USD 使用当前测试网池价格估值，不是股票交易所报价，也不是交易当时历史 USD 价格。所有本轮资产为 18 位精度。
- 成交量来源为按本项目创建区块、Curve 地址或 Pool ID 限定的浏览器索引；每类日志最多 1000 条，达到上限视为覆盖不足，显示缺失而非不完整总数。更大规模仍需分页/持久增量聚合。
- 本轮通过不代表任意链、任意 token 精度、超限历史覆盖已验证。

## 待解锁用例

Bob、Dave 各在 GQA01 质押 1 TSLA、GQA03 质押 1 PLTR。领取前模拟正确返回 `PositionLockedUntil`。

| 市场 | 钱包 | 解锁时间（北京时间） |
|---|---|---|
| GQA01 | bob | 2026-09-11 01:22:50 |
| GQA01 | dave | 2026-09-11 01:23:01 |
| GQA03 | bob | 2026-09-11 01:23:19 |
| GQA03 | dave | 2026-09-11 01:23:30 |

全部头寸最晚于 2026-09-11 01:23:30 解锁。后续只需恢复这些待测头寸的领取/退出验证并核对余额与负债，不再创建市场、不重复发已完成交易。未创建自动任务。不要直接重跑 rewards 阶段，其阶段性断言早于后续池交易。

## 证据与只读复核

- 复用清单：`deployments/manifests/robinhood-testnet-46630.qa-markets-2026-09-10.json`
- 完整回执：`outputs/reviews/rh-multiwallet-2026-09-10/results.json`
- 手续费：`outputs/reviews/rh-multiwallet-2026-09-10/fee-split-audit.json`
- 链上状态：`outputs/reviews/rh-multiwallet-2026-09-10/chain-state-audit.json`
- 统计：`outputs/reviews/rh-multiwallet-2026-09-10/statistics-audit.json`

```sh
node tools/audit-rh-matrix-fee-splits.mjs
# 以下为只读的当时状态断言；后续交易/领取会改变预期：
node tools/verify-rh-matrix-state.mjs
node tools/verify-rh-matrix-statistics.mjs
```

验证：前端 build 与 17 项定向测试通过；Go marketstats、demandevents、eventfeed、httpapi、chainrpc、displayprice 包测试通过；RPC 范围/缓存/临时许可测试通过。未配置隔离数据库时会跳过的数据库集成测试不计作已执行，使用了本次真实 API/数据库/回执对账补充验证。

提供方曾拒绝一笔未上链的 21000 gas ETH 转账（intrinsic gas too low）；已确认未广播成功后以 100000 gas 重新构建，原意图单独归档。没有已上链失败交易。
