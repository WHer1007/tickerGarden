# RH 主链全量 Quote / Stake 生产清单

2026-09-12 用户明确批准全量官方 Stock 接入。本记录覆盖此前 53 Stock 的候选范围；历史研究报告保留原快照，不作为当前名单。

| 项目 | 已确认配置 |
| --- | --- |
| Quote 数量 | 196 = 194 官方 Stock + ETH + USDG |
| Stake 数量 | 194 官方 Stock，按 chainId + tokenAddress + assetUid 区分 |
| Stake 最低总仓位 | 每项 0.5 原始 Token；当前均为 18 位，即 `500000000000000000` raw |
| Stock Quote 毕业阈值 | 当期 7,000 USD 等价，按官方标的买卖中间价 × 股份乘数计算，四舍五入保留两位小数 |
| 所有 Quote 虚拟储备 | 毕业阈值的精确 40%；必要时保留四位小数 |
| ETH | 毕业 3 ETH / 虚拟储备 1.2 ETH |
| USDG | 毕业 7,000 USDG / 虚拟储备 2,800 USDG |
| cbBTC / 单列 WETH | 不在本次 196 种 Quote 范围 |
| 当前状态 | 名单与参数已选定；NOT_CHAIN_ACTIVATED / NOT_BROADCAST |

最低值指市场内最低总质押分配量，不是每次 deposit 或追加至少 0.5；既有合约会根据已分配与追加后总仓位检查。乘数变更不改写原始 Token 本金或 0.5 的门槛。

## 机器清单与界面

- [196 Quote 清单](../../deployments/manifests/robinhood-mainnet-4663.paired-assets.json)
- [194 Stake 清单](../../deployments/manifests/robinhood-mainnet-4663.staking-assets.json)
- [194 项价格、两位小数毕业阈值及精确储备](../references/RH_ALL_STOCK_QUOTE_THRESHOLDS_2026-09-12.md)

生成器 `tools/generate-v1-paired-assets.py` 同时生成两份清单；`--check` 检测漂移。前端主链 Stake 目录直接消费生产 Stake 清单，保留原测试网 5 项，不向测试网混入主网地址。Quote 目录从生产 Quote 清单加载；本地图标缺失时使用清单中的官方 CDN 图标，图片延迟加载，加载失败不阻断选择。

名单选中不自动绕过 Registry：Quote 必须与 ACTIVE 配置及批准经济参数匹配；Stake 必须与 ACTIVE 资产 UID / Token 地址匹配。页面数据通过后端数据库读取。

## 实际生产激活

1. 重新核对 194 项 Token、Beacon、实现指纹，完成精确转账、发行方销毁/冻结/升级边界及适用交易路径审核。当前快照指纹属于带时间的证据，不能替代部署前验证。
2. 将同一个规范 UserStockVault 的实际部署地址绑定到登记计划，对每项调用 `registerAsset(uid, token, 18, vault, 500000000000000000, fingerprint)`。不能使用占位地址广播；无需为每个 Token 部署独立 Vault。
3. 对 196 个 Quote 按相应 baseline 生成 configId / economicsHash，通过已选择的准入路径登记。Stock 显式指纹绑定路径需先完成 Stock 注册；不得用路径切换绕过已选风控。
4. 生产部署 manifest 的 `officialStocks` 每项应记录 `minimumAllocation`。`preflightProductionManifest` 检查 196 / 194 完整覆盖、唯一身份、每项 0.5 及批准的 Quote 参数；这些候选检查不代替登记交易或链上回读。
5. 治理交易按真实 AccessManager 权限与延迟排期，控制批量 Gas。登记后逐项回读 ACTIVE、`minimumAllocation(uid)`、Vault 绑定和指纹，保存回执；完成各路径 Fork 与生产检查后再开放。
6. 后端索引事件并更新数据库及前端目录。前端不因本地 `enabled=true` 就宣称链上资产已激活。任何另行授权的 Vercel 部署必须在 `sin1`。

本轮不部署、不广播、不修改已存在市场的资产绑定，也不宣称全量资产的交易流动性或发行方权限风险已经消除。
