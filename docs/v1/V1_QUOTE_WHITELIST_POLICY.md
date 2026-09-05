# Quote 管理员审核白名单

2026-09-05 用户明确决定：不再使用普通 ERC-20 的类型准入规则。管理员审核每个资产的风险后加入 Quote 白名单；任意 Token（包括 USDG、cbBTC 与可升级 Stock proxy）均可通过通用 `addQuoteConfig` 登记。

本次实现：

- Registry 移除 CALLCODE / DELEGATECALL / SELFDESTRUCT opcode 类型拦截。保留受限管理员权限、配置内容哈希、追加式配置、原生 ETH 精度、支持精度范围、金额域、代码存在性、decimals 一致、ACTIVE/pause/retire 和转账记账校验。
- 通用 ERC20 Quote 的发布 schema / preflight 不再要求零 EIP-1967 slots 或 implementation 与 token 相同。提供的代码/slot 证据仍会核对，但代理身份本身不构成拒绝原因。
- `addStockQuoteConfig` 是可选的更严格 fingerprint commitment 路径，不是 Stock Token 的必经准入路径；Rewards stock / OfficialStockRegistry 的 STOCK 基础资产规则未改变。
- USDG 与 cbBTC 均为 `REGISTRY_ACTIVATION_REQUIRED`、`ADMIN_REVIEWED_WHITELIST`，保留代理 slot 观测供管理员审核，不再标为不支持。
- 未签名、未广播、未声称链上 ACTIVE。管理员风险审核和实际登记回执仍是生效步骤。

验证：103 项相关 Registry/Factory/Curve 合约测试通过（含未授权拒绝、6/8 decimals ERC1967 proxy 正向准入）；62 项规格测试、45 项前端测试和3项发布白名单测试通过，前端及部署工具构建通过。完整部署套件52/53，旧 deployment-gate evidence SHA-256 与当前构建不一致，未更新旧证据以冒充重验通过。
