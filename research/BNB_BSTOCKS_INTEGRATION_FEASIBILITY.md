# BNB Chain bStocks 质押发射台接入结论

记录日期：2026-09-08。用途：后续产品与开发设计参考。

状态：`RESEARCH_REFERENCE / NOT_IMPLEMENTED / NOT_PRODUCTION_READY / NOT_BROADCAST`。

本文记录本轮官方资料与现有代码检查形成的可行性结论。用户已要求保存为开发参考；这不等于冻结 BNB 产品参数、批准资产准入、授权部署或确认发行方合作。本文不替代 `spec/`、当前执行规格与生产发布门禁，也不改变现有 Robinhood 部署目标或既有市场配置。

## 1. 结论与推荐范围

**产品与架构上可行：可以在 BNB Chain 独立部署 TickerGarden，以 bStocks 为 STOCK 质押 Base，形成股票代币持有人参与 Meme 市场手续费分成的发射台。**

这不是直接增加 token 地址即可上线的配置变更。仍需验证真实 bStocks 合约行为，并适配资产身份、代理升级检查、链配置、索引、前端与部署证据。

第一阶段推荐方案（尚未作为正式执行规格冻结）：

- 链：BNB Smart Chain 主网，chain ID 56；采用独立合约部署与链级数据隔离。
- 质押 Base：通过逐资产验证的 bStocks；先用 NVDAB 完成验证闭环，再扩大目录。
- 交易 Quote：优先评估原生 BNB，重新生成并验证本链 Quote 配置和经济参数；不得照搬 ETH 参数。
- 毕业池：优先沿用 Uniswap v4 架构，对 BNB 官方部署重新取证。
- 第一期不自动开放 bStocks Quote，不新增跨链本金或共享跨链权重，不自行发行或 mint bStocks。

## 2. 对应的产品流程

以 NVDAB 市场为例：

1. 创建者发行 Meme，并在创建时启用质押、绑定 NVDAB 的 canonical 资产身份；绑定不可更改。
2. Meme 以批准的 Quote 进行曲线交易，达到本市场冻结的毕业条件后建立交易池。
3. 市场毕业后，NVDAB 持有人把代币存入 Vault，再自主分配到匹配市场。
4. Gauge 记录已激活权重，用户按比例获得该市场协议手续费。
5. 用户按现有规则整仓退出；正常退出与放弃收益的 rageQuit 保留各自条件。

Vault 托管 STOCK 本金，Gauge 只记权重。STOCK 本金不投入 Meme 初始 LP，不构成 Meme 的抵押担保、股价锚定或股票赎回权。

**现有机制是毕业后质押。**“必须先质押股票才能创建/发射”“质押量决定毕业”“用股票本金建池”均属于另行设计的产品变更，不能从本结论推导为已批准。

未启用额外持有者分成选项时，现有基础手续费路由可作为复用基线：

| 毕业后状态 | Creator | Staker | Platform |
| --- | ---: | ---: | ---: |
| 有有效 Active stake | 40% | 30% | 30% |
| 无有效 Active stake | 70% | 0% | 30% |

比例针对协议手续费，不针对交易本金或股票分红。Holder 分成选项与 Creator tax 仍需遵循各自冻结规则；手续费按实际收费资产结算，不自动兑换成 bStocks。

参考：[可选 STOCK 质押](../docs/v1/V1_OPTIONAL_STOCK_STAKING.md)、[STOCK Base 规则](../docs/v1/V1_OFFICIAL_STOCK_ADMISSION.md)、[费用计算](../contracts/src/v1/libraries/MarketFeeAccounting.sol)、[整仓退出](../contracts/src/v1/shared/AllocationManagerExits.sol)。

## 3. bStocks 发行与合约语义

据 Binance 官方 FAQ，bStocks 法律发行主体为 ADGM 注册的 **BTech Holdings Limited**。合资格用户通过 Binance 转换股票持仓的流程涉及 **Nest Trading Limited**；一级发行与赎回由发行方及其授权流程完成。TickerGarden 作为第三方协议接收用户持有的 bStocks，不取得发行权，也不能宣称获得 Binance 或 BNB Chain 官方背书。

bStocks 提供底层证券经济敞口，不等同于直接股东身份。发行方维护底层托管、抵押对账、公司行动和相关控制；实际托管机构、每个产品条款及最新权限需在实施前核对。

官方说明中的分红再投资、拆股和反向拆股主要通过倍率反映。原始 token 余额可以不变，显示份额发生变化：

```text
显示数量 = 归一化后的 raw 数量 × UI multiplier
同一资产 Gauge 内的个人权重 = 个人 Active raw 数量 / 总 Active raw 数量
```

同一资产的统一倍率在相对权重中抵消，因此仅作为 Base 时无需以股价或倍率重算链上手续费权重。这与现有 Vault 的 raw 本金记账和精确转账检查具有兼容潜力，**但不构成真实部署合约已经兼容的证明**。

实施时必须核对实际 `balanceOf`、`transfer`、`transferFrom`、返回值、decimals、倍率接口和生效时点。前端按股份数量接收输入时，需使用固定点换算、明确舍入、重验预览与提交间的倍率变化；不得重复乘倍率，也不得把 UI 余额作为 raw 本金入账。

如果真实合约改变 raw 余额、扣转账费或无法满足精确到账约束，应停止准入并重新评估，不能通过关闭现有检查强行兼容。股票分红经济权益与 TickerGarden 手续费奖励是两个来源，前端不得合并为保证收益。

参考：[Vault 存款](../contracts/src/v1/shared/UserStockVaultDeposits.sol)、[Vault 提款](../contracts/src/v1/shared/UserStockVaultExits.sol)。

## 4. 现有工程差异与建议改动

| 范围 | 本轮检查发现 | 后续处理 |
| --- | --- | --- |
| Asset Registry | 强制调用 token 的 `uid()`，识别特定 immutable-beacon 结构，并验证 runtime / implementation 指纹 | 先识别 bStocks 实际接口与代理结构，再设计发行方专用准入路径；不能假定支持现有 UID/代理模型 |
| 身份命名空间 | 市场通过 Asset UID 绑定 canonical token | BNB 资产身份需明确绑定链、发行方、canonical 地址；symbol/name 只用于展示；ID 编码另行冻结 |
| Vault / Gauge / Allocation | raw 本金、相对权重、逐资产账本与整仓退出已存在 | 尽量复用，先完成真实 token 的账本及转账兼容验证 |
| 链配置 | Web 与 Go backend 当前只接受 4663、46630、421614，Web 原生币为 ETH | 增加 chain 56、BNB、RPC/explorer、交易校验及网络切换配置 |
| 部署与 v4 | 依赖 PoolManager、PositionManager、StateView、Permit2 等链级身份 | 使用 BNB 官方地址及固定区块代码证据；重新验证 Hook 地址权限位、毕业、LP 锁定与费用归集 |
| Backend / Indexer | 多处 chain ID 枚举、schema 与快照校验限定现有网络 | 扩展 schema 和生成客户端，确保事件、余额、市场、统计按链隔离并验证 BNB finality/reorg 行为 |
| 运营监控 | 现有准入与升级流程依赖已支持的资产模型 | 补充发行方升级、暂停、黑名单、公司行动和倍率变更监控；恢复新增敞口需复核 |

代码入口：[Registry](../contracts/src/v1/modules/OfficialStockRegistryV1.sol)、[Web chain](../apps/web/src/v1/chain.ts)、[Go config](../services/backend-go/internal/config/config.go)、[部署 schema](../deployments/schemas/v1-deployment-manifest.schema.json)、[OpenAPI 生成器](../services/backend-go/scripts/generate-openapi.mjs)。这些是 2026-09-08 工作区观察，实施前需按届时版本复查。

## 5. 必须保留的风险与产品边界

### Base 资格与 Quote 资格独立

Base 主要依赖资产身份、托管语义、精确转账与本金账本，不要求以美元比较不同股票。每个 Gauge 只计算同一种资产的比例。

若未来把 NVDAB 等用作 Quote，还需独立验证曲线 raw 参数、毕业建池、公司行动影响、交易暂停和真实可执行深度。发行方市值、底层股票成交量、链上池 TVL 均不能替代买卖双向报价和滑点模拟。

前序研究中的流动性排序是 2026-09-08 点时、有限 API 覆盖的池 TVL 观察，不是完整深度榜或生产 allowlist。本文件不将该排序固化为准入条件。

### 发行方转账控制与共享 Vault 风险

Binance 官方 FAQ 保留黑名单和转账限制。TickerGarden 的 rageQuit 可降低自身奖励系统故障对退出的影响，但无法绕过底层 token 对用户或 Vault 的冻结。Vault 被某个 token 冻结时，可能影响该 Vault 中所有用户的该资产退出；实施前需要评估这一共同风险及资产隔离方案。

准入暂停应阻止新增敞口，不应因 Registry 状态本身阻止历史本金退出；退出能否成功仍取决于底层 token 精确转账。不得承诺“无论任何情况都可即时取回本金”。

### 第三方集成条件

Binance 官方要求第三方集成实施适用地域限制，并提供资格查询机制。生产前需确认 Vault 合约持有、用户准入、质押及费用分成用途的适用条件，以及相关产品条款和法律评估。公开可转账不等于该发射台用途已获发行方认可。本文不包含对外联系或法律批准记录。

## 6. 后续验证与交付顺序

1. **NVDAB 固定区块取证**：归档官方 canonical 地址、链 ID、区块 hash、代码、代理/实现、mint/admin/升级/暂停/黑名单权限，以及倍率与公司行动接口。官方标准参考实现不等于已部署 bStocks 实现。
2. **准入与记账设计**：冻结 BNB 资产身份方案和可验证的升级检查；证明 raw 本金与倍率展示分离、同资产权重与费用守恒。
3. **真实 BNB 主网 Fork 闭环**：真实 NVDAB 存入、市场毕业后分配、激活、费用分成、普通退出、rageQuit；验证失败回滚、不同用户/资产隔离与退出独立性。
4. **异常验证**：覆盖倍率变化与生效边界、暂停、黑名单、实现升级、非精确转账；需要模拟发行方权限的场景须标为模拟，不宣称真实生产事件已发生。
5. **跨层集成**：链配置、部署 manifest、ABI/spec、后端、索引、Web、统计及监控一致；缺失或陈旧数据保持 Unavailable。
6. **评审与发布门禁**：完成适用测试、审计、发行方条件和法律核查，再独立形成部署与生产就绪结论；实际广播仍遵循既有授权要求。

完成单个 token Fork、标准参考合约测试或前端展示，不代表完整 BNB 版本完成。bStocks Quote 与“发射前质押”若进入范围，必须单独形成产品与执行规格。

## 7. 官方参考资料与证据等级

以下资料在本轮研究中查阅，引用日期为 2026-09-08。它们证明官方产品说明或标准意图；没有替代本项目的部署合约审计。

- [Binance bStocks FAQ](https://www.binance.com/en-AU/support/faq/detail/f0c03cd6509a4085b4cce1636f16be38)：发行实体、倍率、公司行动、第三方集成与限制。
- [BNB Chain bStocks 介绍](https://www.bnbchain.org/en/blog/introducing-bstocks-on-bnb-chain-trade-24-7-with-zero-fees-deploy-across-defi-protocols-with-full-self-custody)：BNB 生态产品及 DeFi 集成方向。
- [BNB Scaled UI Amount 开发文档](https://docs.bnbchain.org/developer-kit/scaled-ui-amount/)：raw 与显示数量的分离。
- [BEP-677](https://github.com/bnb-chain/BEPs/blob/master/BEPs/BEP-677.md)：参考接口与倍率调度；本轮页面状态为 Draft，不应据此推定所有部署实现相同。
- [Uniswap 官方部署目录](https://developers.uniswap.org/deployments)：BNB Chain 已有 v4 部署；正式实施时重新核对依赖映射与代码。

本轮完成的是官方资料研究和只读代码检查，没有实现 BNB 接入、运行 bStocks 主网 Fork、确认发行方许可或部署合约。
