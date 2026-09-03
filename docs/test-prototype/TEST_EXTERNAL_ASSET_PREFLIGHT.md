# Test Prototype 外部资产与依赖 Preflight

> 历史归档：本文快照不属于当前 V1 的资产准入或部署证据。

> 状态：`P-004 IN_PROGRESS / BLOCKED`
>
> 点时快照：Robinhood Chain 主网区块 `51,897,839`，区块哈希 `0x8d641129ac45b2eb548fa91f28745839d3b8e34c793190639656235ccf886c58`，UTC 时间 `2026-09-01T17:28:54Z`。

## 1. 结论

RH 主网、NVDA、RH canonical-bridge USDC 和 Uniswap v4 canonical 部署已经完成官方来源与链上点时交叉核验。历史机器可读草案路径为 `deployments/manifests/robinhood-mainnet.draft.json`（当前仓库已不再保留）。

当前不能把 `P-004` 标记为完成，也不能据此直接部署生产合约，原因有五项：

1. Robinhood `/corporate-actions` 当前返回 NVDA 存在处理中现金分红，公司行动处理日为 `2026-10-01`；上线检查必须暂时 fail closed，完成后重新读取 token、multiplier、Feed 和 code hash。
2. TGARD canonical 合约、真实销毁接口、官方池、允许 Router 和完整路径尚未提供。
3. Stock Token/TGARD 实际成交路径、最小流动性、滑点和最大执行规模尚未冻结。
4. NVDA 与 USDC 都通过 Beacon 代理执行，必须明确允许的升级治理与 code-hash 漂移策略，不能只校验代理地址。
5. 官方文档公布的是节点使用的 WSS Sequencer Feed，而不是可供合约读取的 Chainlink Sequencer Uptime Feed；在 canonical onchain 地址确认前，`OfficialStockRegistry` 必须拒绝激活资产。

## 2. 已核验项目

| 项目 | 点时结果 | 状态 |
|---|---|---|
| RH 主网 | Chain ID `4663` / `0x1237` | 通过 |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC`；UID `0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5`；18 decimals；API 状态 ACTIVE | 资产身份通过，首发门禁暂时阻断 |
| NVDA multiplier | 当前与 pending 均为 `1e18`；`effectiveAt = 0`；`oraclePaused = false` | 点时通过 |
| NVDA/USD Feed | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`；描述 `RHNVDA / USD`；8 decimals；Heartbeat 86,400 秒 | 点时通过 |
| Sequencer Uptime Feed | 官方仅公布 `wss://feed.mainnet.chain.robinhood.com` 节点数据流，未找到 canonical onchain Aggregator 地址 | 阻断资产激活；WSS URL 不得冒充合约预言机 |
| RH USDC | `0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8`；6 decimals；`l1Address()` 为 Ethereum Circle USDC | 点时通过，保留代理升级风险 |
| v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | 通过 |
| v4 PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7`；绑定上述 PoolManager；`unsubscribeGasLimit = 300,000` | 通过 |
| v4 Quoter / StateView | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` / `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | 通过 |
| Universal Router / Permit2 | `0x8876789976decbfcbbbe364623c63652db8c0904` / `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 地址与代码通过；业务路径未批准 |
| TGARD | 无 canonical 信息 | 阻断 |

## 3. 代理与升级风险

NVDA 是 `ImmutableBeaconProxy`，Beacon 为 `0xe10b6f6b275de231345c20d14ab812db62151b00`，当前实现为 `0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2`。USDC 是 ERC-1967 Beacon Proxy，Beacon 为 `0x883d9f54f50c9d096b6b3823532fdc8fd8dfa293`，当前实现为 `0xef3b461697c6bd38c5458afa31e1250c98fd0f5f`。

因此生产 preflight 必须同时核验：代理 runtime code hash、Beacon 地址与 code hash、当前 implementation 地址与 code hash、关键 getter。只固定 token 地址不能防止实现升级改变语义。升级发生时应停止新市场创建和 Worker 兑换，但不能阻断用户取回 Stock Token、取消 LP 订阅或领取已归属奖励。

## 4. Feed 与公司行动门禁

Chainlink reference-data 目录给出的 NVDA Feed heartbeat 为 86,400 秒。快照时 `latestRoundData()` 的答案为 `21900465000`（8 decimals，即 `219.00465000 USD`），更新时间为 `2026-09-01T17:02:51Z`，距快照区块 1,563 秒。

但 Feed 新鲜且 `oraclePaused = false` 不足以覆盖公司行动风险。部署和 Stock 软门槛更新必须同时满足：

- RH 资产 API 状态为 ACTIVE；
- 无 `IN_PROGRESS` 公司行动；
- `oraclePaused = false`；
- Feed 答案为正且未超过官方 heartbeat 与协议额外安全余量；
- sequencer 正常并经过恢复宽限期；
- token UID、地址、decimals、multiplier、Beacon 与实现 code hash 均匹配批准 manifest。

## 5. 网站直连边界

这些信息不需要无意义地全部代理到 Backend API：

- Web 可以用 manifest 中的 chain ID 和 canonical 地址直连钱包 Provider、RH RPC、v4 Quoter、StateView、PositionManager 及只读合约 getter。
- Robinhood `/assets`、`/prices` 和 `/corporate-actions` 是公开只读服务，可由前端直连用于提示；但任何会影响资产准入、排放或 Worker 执行的判断必须由链上合约或受约束的服务端 preflight 再次验证，不能信任浏览器单方结果。
- Backend API 仍负责历史、聚合与内部元数据；Execution Worker 使用独立凭据和 allowlist，不接受前端提交任意 Router、Path 或目标合约。

## 6. 完成 P-004 仍需输入

- TGARD：chain ID、canonical 地址、decimals、总供应/铸造权限、真正减少供应的 burn ABI、官方池、允许 Router 与精确 Path。
- NVDA：公司行动完成后的新快照；是否接受 Beacon 升级及升级后的人工/多签审批流程。
- USDC：Beacon 升级治理接受标准、transfer/approve 行为测试和生产流动性下限。
- 执行路径：Stock Token 与 TGARD 各自允许的 Router/Pool/Path、报价源、最低流动性、最大滑点、单笔和每日上限。
- Sequencer：Robinhood 或 Chainlink 发布的 canonical onchain Uptime Feed 地址、runtime code hash、ABI 与至少 1 小时恢复宽限验证；若 RH 明确不提供，则需另行安全评审并重做 Registry 激活门禁，不能用浏览器/Backend 状态替代链上信号。

## 7. 官方来源

- [Robinhood Stock Token API](https://docs.robinhood.com/chain/stock-token-apis/)
- [Robinhood Stock Token 合约目录](https://docs.robinhood.com/chain/contracts/)
- [Robinhood Oracle 与 Price Feed](https://docs.robinhood.com/chain/oracles-and-price-feeds/)
- [Robinhood Protocol Contracts](https://docs.robinhood.com/chain/protocol-contracts/)
- [Uniswap v4 Deployments](https://developers.uniswap.org/docs/protocols/v4/deployments)
- [Chainlink Robinhood Mainnet Reference Data](https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json)
