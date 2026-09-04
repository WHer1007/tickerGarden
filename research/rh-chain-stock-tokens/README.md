# Robinhood Chain 官方 Stock Token 资料库

> 首次建库：2026-09-04
>
> 当前快照：[`snapshots/2026-09-04`](./snapshots/2026-09-04/)
>
> 网络：Robinhood Chain Mainnet，chainId `4663`
>
> 用途：产品、合约准入、前端资产展示、Indexer 与运维监控的研究输入

## 1. 当前结论

截至本次快照：

- Robinhood 官方 [`/rhj/assets`](https://api.robinhood.com/rhj/assets) 返回 **194** 个资产；194 个 UID、symbol 和 chain `4663` Token 地址均唯一，全部为 `ASSET_STATUS_ACTIVE`、18 decimals。
- 当前官方响应只给出了 chainId `4663` deployment；没有给出 chainId `46630` 的 Stock Token deployment。这只能解释为“当前官方目录未发布测试链地址”，不能推断测试链永远不会发布。
- 与仓库 2026-09-02 快照相比，194 个资产的身份集合没有增删或变更；动态 `currentMultiplier` 有两项变化：`UPS = 1.002208724969205741`、`F = 1.000145502866134027`。Multiplier 会继续变化，不能当作静态准入身份。
- 194 个 Token 共享同一个 Beacon 与同一个 `Stock` implementation，而不是 194 套独立实现。共享架构及对 TickerGarden Stock Vault 的风险见 [`CONTRACT_ARCHITECTURE.md`](./CONTRACT_ARCHITECTURE.md)。
- 在固定且随后确认已 finalized 的区块 **54,350,641**，对 194 个官方 Token × USDG/WETH 执行了 **1,940** 次 canonical Uniswap V2/V3 Factory 查询，0 查询错误：
  - Uniswap V2：14 个非零池，覆盖 11 个 Stock Token；
  - Uniswap V3：346 个非零池，覆盖 192/194 个 Stock Token；在限定查询范围内未发现 `CRWV`、`ORCL` 的 V3 USDG/WETH 标准费率池。
- DexScreener 地址发现获得 1,230 条 Stock/USDG、Stock/WETH 或 Stock/ETH 索引记录，其中 1,047 条标记为 Uniswap V4；但 81/194 个地址请求受到 HTTP 429 限流。除与 canonical V2/V3 Factory 结果交叉匹配的记录和两个回链验证的 V4 示例外，这些都只是第三方线索。

完整 194 项目录见 [`stock-tokens.csv`](./snapshots/2026-09-04/stock-tokens.csv)，机器主表见 [`stock-token-reference.json`](./snapshots/2026-09-04/stock-token-reference.json)。

## 2. 事实等级

资料库不把不同来源混成一个“池清单”。后续代码使用时必须保留以下等级：

| 等级 | 来源 | 可用于什么 | 不能推出什么 |
|---|---|---|---|
| A | Robinhood 官方 API/文档 + 固定区块链上 getter | canonical Stock 身份、UID、地址、decimals、合约指纹 | 不能证明某池有流动性或可成交 |
| A | Uniswap 官方 chain `4663` deployment manifest + canonical Factory `getPair/getPool` | 在固定区块确认 V2/V3 pool address 存在 | 不能证明 Robinhood 背书、当前有流动性或滑点可接受 |
| B | Robinhood Chain Blockscout 已验证源码 | 理解 implementation、Beacon、角色与暂停/销毁能力 | 不能确认角色实际持有人与运营流程 |
| C | DexScreener 地址 API | 发现 V4 poolId 与非 Uniswap DEX 线索、保存点时流动性/成交快照 | 不能充当官方地址、完备枚举或路由安全证明 |

TickerGarden 的 Stock 准入只能依赖 A 级身份和运行时指纹，不得依赖“是否有池”、DexScreener、symbol、name、logo 或价格。

## 3. 官方资产的法律与技术属性

Robinhood 官方说明，Stock Token 是 Robinhood Assets (Jersey) Limited 发行的 tokenized debt securities，提供对股票/ETF 的经济敞口，但不授予持有人对底层证券的法律或受益权。它们是 ERC-20、18 decimals，并通过 ERC-8056 `uiMultiplier()` 表达公司行动后的 shares-per-token；raw ERC-20 balance 不随 multiplier 自动变化。相关司法辖区和投资者限制也必须在产品层单独处理，不能因为 Token 可在链上转移就假设任何用户都可合法使用。

权威入口：

- [Stock Tokens overview](https://docs.robinhood.com/chain/stock-tokens/)
- [Stock Token API](https://docs.robinhood.com/chain/stock-token-apis/)
- [Canonical Token Contracts](https://docs.robinhood.com/chain/contracts/)
- [Building with Stock Tokens](https://docs.robinhood.com/chain/building-with-stock-tokens/)
- [Oracles & Price Feeds](https://docs.robinhood.com/chain/oracles-and-price-feeds/)

### 身份字段

| 字段 | 用法 |
|---|---|
| `id` / `uid()` | 资产主身份，跨链部署可共享同一 UID |
| `deployments[].chainId + contractAddress` | 某条链上的 canonical Token 身份 |
| `tokenDecimals` | 当前 live API 字段；本轮 194 项均为 18。生产仍要调用链上 `decimals()` 复核 |
| `tokenSymbol`、`tokenName`、`isin` | 展示和检索；不能单独作为链上身份 |
| `status` | 官方目录状态；当前 194 项全部 ACTIVE，但它是动态门禁输入 |
| `currentMultiplier`、pending 字段 | 动态公司行动数据；用于 UI 股数/估值，不属于准入身份 |
| `tradingCapabilities` | 底层资产的动态交易能力提示，不代表某个链上池可成交 |

注意：Robinhood API 文档 schema 明确列出了 UID、symbol/name、deployments、multiplier、status 等字段；`tokenDecimals` 和 `isin` 存在于当前 live payload，但当前 schema 表没有明确列出。解析器应容忍文档与 live payload 演进，并始终用链上 getter 复核安全关键字段。

## 4. 网络与固定观测块

| 项 | 值 |
|---|---|
| Mainnet chainId | `4663` |
| Testnet chainId | `46630` |
| Mainnet public RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Testnet public RPC | `https://rpc.testnet.chain.robinhood.com` |
| Mainnet explorer | `https://robinhoodchain.blockscout.com` |
| 池查询区块 | `54350641` / `0x33d5331` |
| 区块 hash | `0xebced3f2166eed9fbe1a14a473e962a0e16354e65fff5923f35c4d91b53ef289` |
| 区块时间 | `2026-09-04T14:52:33Z` |
| finalized 复核 | 捕获后 `finalized = 54352232`，高于池查询区块 |

Robinhood 官方明确标注 public RPC 有 rate limit、不可作为生产端点，并建议历史读取/indexing 使用 archive provider。此次公共 RPC 也实际出现 429、EOF 和历史日志超时。生产重放本资料库时应使用 Alchemy 或另一家支持 Robinhood Chain 的 archive RPC。

## 5. 合约架构摘要

| 组件 | 地址 | 角色 |
|---|---|---|
| 194 个 Stock Token Proxy | 见 `stock-tokens.csv` | 每个资产的独立 canonical ERC-20 地址；共同 delegatecall 到共享 implementation |
| AccessControlsRegistry / IBeacon | `0xe10b6f6b275de231345c20d14ab812db62151b00` | 角色、全局 pause、全局地址 blocklist、`implementation()` 与升级入口 |
| Stock implementation | `0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2` | ERC-20/permit、UID、multiplier、metadata、mint/burn/adminBurn、Token/oracle pause |

最重要的外部风险不是常见 transfer fee，而是共享 Beacon、全局 blocklist 与 `adminBurn`。详情和上线控制见 [`CONTRACT_ARCHITECTURE.md`](./CONTRACT_ARCHITECTURE.md)。

## 6. 对应交易池

### 6.1 Canonical Uniswap V2/V3 固定范围查询

Uniswap 官方 chain `4663` manifest 给出：

| 组件 | 地址 |
|---|---|
| V2 Factory | `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f` |
| V2 Router02 | `0x89e5db8b5aa49aa85ac63f691524311aeb649eba` |
| V3 Factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` |
| V4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| V4 PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` |
| V4 Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` |
| V4 StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` |
| WETH | `0x0bd7d308f8e1639fab988df18a8011f41eacad73` |
| USDG | `0x5fc5360d0400a0fd4f2af552add042d716f1d168` |

来源：[Uniswap 官方 deployments/4663.md](https://github.com/Uniswap/contracts/blob/main/deployments/4663.md)。池是 permissionless 创建的；使用官方 Factory 只能证明地址来源，不代表 Robinhood 或 Uniswap 对某个池的资产质量、流动性作背书。

本轮范围为每个 Stock 分别查询：

```text
V2: getPair(stock, USDG), getPair(stock, WETH)
V3: getPool(stock, USDG/WETH, fee)
fee ∈ {100, 500, 3000, 10000}
```

V2 的 14 个池覆盖 `AAPL, AMZN, DJT, GLD, GME, INTC, MSFT, NVDA, SPCX, SPY, TSLA`；其中 USDG 池 8 个、WETH 池 6 个。完整地址见 [`uniswap-standard-pools.csv`](./snapshots/2026-09-04/uniswap-standard-pools.csv)。

V3 的 346 个池分布：

| Fee | Tick spacing | 池数 |
|---:|---:|---:|
| 100 | 1 | 16 |
| 500 | 10 | 34 |
| 3000 | 60 | 84 |
| 10000 | 200 | 212 |

示例：`CRM/USDG` fee 10000 为 `0xda68fba2d1bca00e3754937b5608ba61aee6e827`；`SPCX/USDG` fee 100 为 `0x87c58b43537005189cfc7b512d818dc9125e94fc`；`DELL/USDG` fee 3000 为 `0xa0f5ef20f49db62bb20e0f2b51257ca897a01a5f`。

本轮没有把“非零 pool address”解释为“有流动性”。部署前的路由选择还必须读取实时 reserves/liquidity、当前 tick、报价、price impact、Token 状态和交易模拟。

### 6.2 V4 与其他 DEX

Uniswap V4 不为每个池部署独立合约；DexScreener 对 V4 返回的 `pairAddress` 是 `bytes32 poolId`，实际资产与状态在共享 PoolManager 中。后续程序不得把 32-byte poolId 当 20-byte 合约地址调用。

本次对两个示例回查了 PoolManager `Initialize` 日志：

- `CRM/USDG` poolId `0x054c27d231f83af8891157d238dfed61a02c2d15daa3854c4e0355c3ea3f0c28`，fee 48730，tickSpacing 1，Initialize block 53,700,392；
- `CRM/ETH` poolId `0x5bfea5c46dd6576f995517ae8b349e6d5a0f7e248f2b8dcb4c150e43ec83b246`，fee 49000，tickSpacing 490，Initialize block 54,111,519。

DexScreener 原始成功响应包含 2,033 条 Robinhood pair 记录；111 个地址返回非空结果、2 个为空、81 个因 429 失败。原始记录有 16 条没有 `labels`，该字段必须按可选处理；还有一个 Stock/Stock V4 poolId 同时出现在 SPY 与 TSM 的地址查询结果中，不能误判成数据损坏。过滤成 USDG/WETH/ETH 标准 Quote 后为 1,230 条，按标签为 V4 1,047、V3 167、V2 2、无标签 14；按 DEX 还出现 Ramses、Up、Giga、Alandale、Sheriff、Parity、PancakeSwap 等线索。当前第三方覆盖不是全集。PancakeSwap 只发现 `QQQ/USDG` 一条 v3 索引线索，在获得权威 Factory 地址前不计入已验证池。

机器数据：[`dexscreener-standard-quote-discovery.csv`](./snapshots/2026-09-04/dexscreener-standard-quote-discovery.csv)。其中 `evidence` 必须保持原值，只有 `MATCHED_CANONICAL_UNISWAP_FACTORY_RESULT` 或 `V4_INITIALIZE_LOG_EXAMPLE_VERIFIED` 可以视为已交叉验证。

### 6.3 “池”不是全部流动性

Robinhood 当前集成文档还列出 RFQ、Uniswap AMM、Rialto proprietary AMM、只向 Authorized Participants 开放的 direct mint/burn，以及 Lighter spot/perps。因而“没有标准 USDG/WETH Factory 池”不能等价为“该 Stock Token 无交易渠道”。同样，链上存在很多池也不等价于用户可以获得可靠成交。

## 7. 文件结构

| 文件 | 内容 |
|---|---|
| [`stock-token-reference.json`](./snapshots/2026-09-04/stock-token-reference.json) | 194 项规范化主表、来源、区块、统计、旧快照 diff、每资产池计数 |
| [`stock-tokens.csv`](./snapshots/2026-09-04/stock-tokens.csv) | 供产品/前端/人工核对的 194 行资产表 |
| [`contract-architecture.json`](./snapshots/2026-09-04/contract-architecture.json) | Proxy/Beacon/implementation 指纹、源码信息、角色能力 |
| [`uniswap-standard-factory-calls.source.json`](./snapshots/2026-09-04/uniswap-standard-factory-calls.source.json) | 本轮 1,940 个 Multicall 查询的原始结构化结果 |
| [`uniswap-v3-details.source.json`](./snapshots/2026-09-04/uniswap-v3-details.source.json) | 346 个非零 V3 pool 的链上 getter 结果 |
| [`uniswap-standard-queries.json`](./snapshots/2026-09-04/uniswap-standard-queries.json) | 全部 1,940 个 Factory 查询，包括 1,580 个零地址结果 |
| [`uniswap-standard-pools.json`](./snapshots/2026-09-04/uniswap-standard-pools.json) | 360 个非零 canonical V2/V3 结果 |
| [`uniswap-standard-pools.csv`](./snapshots/2026-09-04/uniswap-standard-pools.csv) | 易检索的 V2/V3 池表 |
| [`dexscreener-address-scan.source.json`](./snapshots/2026-09-04/dexscreener-address-scan.source.json) | 第三方地址扫描原始响应/错误归档 |
| [`dexscreener-standard-quote-discovery.json`](./snapshots/2026-09-04/dexscreener-standard-quote-discovery.json) | 过滤并标注证据等级后的第三方记录 |
| [`manifest.json`](./snapshots/2026-09-04/manifest.json) | 文件大小、SHA-256、输入时间与完整性检查 |

`official-assets.source.json` 是点时原始官方响应；不要手改。快照主表和 CSV 都由脚本生成。

## 8. 更新与复核

已提供两个层次的工具：

- [`capture_snapshot.py`](./capture_snapshot.py)：尝试在一个 finalized 区块完成官方目录、194 个合约 getter/指纹、canonical Uniswap V2/V3/V4 创建日志与池状态的完整采集。历史日志扫描需要 archive RPC；公共 RPC 可能无法完成。
- [`capture_standard_pools.mjs`](./capture_standard_pools.mjs)：使用仓库已有 viem，在同一区块批量读取当前官方目录的全部 Token × USDG/WETH × V2/V3 标准组合；优先使用 Multicall3，公开 RPC 不支持嵌套历史调用时自动回退到直接 JSON-RPC batch。可选抓取 DexScreener，HTTP 错误会保留为错误而不是“无池”。该脚本不把 194 写成未来资产上限；`--symbols CRM,SPCX` 仅用于快速验收/调试，不能生成全量资料库。
- [`build_observed_snapshot.py`](./build_observed_snapshot.py)：严格校验固定区块 Factory capture、V3 detail capture 与 DexScreener capture，并重建规范化快照和 manifest。

新一轮标准池捕获示例：

```bash
node research/rh-chain-stock-tokens/capture_standard_pools.mjs \
  --block finalized \
  --rpc "$RH_ARCHIVE_RPC_URL" \
  --with-dexscreener \
  --output-dir /tmp/rh-stock-capture-YYYY-MM-DD
```

当前 2026-09-04 快照可从已归档输入重新校验并重建核心数据；由于早期 capture 没有把 block hash 写入源文件，需要显式传入本页记录的 block 证据：

```bash
python3 research/rh-chain-stock-tokens/build_observed_snapshot.py \
  --official-assets research/rh-chain-stock-tokens/snapshots/2026-09-04/official-assets.source.json \
  --factory-calls research/rh-chain-stock-tokens/snapshots/2026-09-04/uniswap-standard-factory-calls.source.json \
  --v3-details research/rh-chain-stock-tokens/snapshots/2026-09-04/uniswap-v3-details.source.json \
  --dexscreener research/rh-chain-stock-tokens/snapshots/2026-09-04/dexscreener-address-scan.source.json \
  --observation-block-hash 0xebced3f2166eed9fbe1a14a473e962a0e16354e65fff5923f35c4d91b53ef289 \
  --observation-block-timestamp 2026-09-04T14:52:33+00:00 \
  --finalized-proof-block 54352232 \
  --output-dir /tmp/rh-stock-rebuild-2026-09-04
```

每次更新至少检查：资产 UID/address 增删、status、decimals、proxy/Beacon/implementation codehash、角色成员、pause/blocklist、multiplier、标准池集合和实时可成交性。新快照只能新增日期目录，不能覆盖历史日期后伪装成同一观测。

## 9. 当前未闭合范围

- 没有完成全链所有 Quote 的池枚举；
- 没有完成全历史 V4 `Initialize` 日志闭合；
- 非 Uniswap DEX 缺少一组来源可信、完整的 Factory/PoolManager 清单；
- 81 个 DexScreener 地址请求被限流；
- 没有把实时流动性、价格、滑点和可执行 route 当作静态资料；
- Robinhood 角色实际成员、治理延迟、`ADMIN_BURNER_ROLE` 运营条件和 Vault 地址合规政策仍需外部确认。

这些缺口已在数据中显式标记。任何后续报告都不得把当前资料库描述成“RH 链所有交易池的完整全集”。
