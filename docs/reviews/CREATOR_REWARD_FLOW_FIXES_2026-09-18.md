# Creator 奖励审查修复

日期：2026-09-18。开发分支 `codex/creator-reward-hardening`，基线 `461f0b16c655135478c5842f46a0c49964791473`。本次为本地代码与测试验收，未执行远程迁移、部署或真实交易；合约不变。

## 对照审查报告

| 项目 | 实现 |
| --- | --- |
| C1 Growing 归集缺口 | 数据库分别保存 Curve 待归集费用和 Vault 余额。待归集 Creator 收益为正也允许领取；交易前核验受益人、当前 epoch 和 Curve，必要时先 sweep，再按最新 Vault 余额领取。归集失败不发起后续领取，归集成功后取消领取不会丢失已入账收益。补充独立的有预算归集命令，默认不自动运行。 |
| C2 全局状态耦合 | `/v1/creator-rewards` 为数据库读取，按钱包、市场、轮次分页。浏览器展示不再扫描链上 epoch/余额，不要求市场详情聚合或全局健康状态。Claim 不参加全局快照轮询。签名前仍核验钱包、市场合约、受益人与规范区块，领取使用最新链上负债。 |
| C3 目录延迟及 N+1 | 目录直接携带市场信息；单条缺失不阻塞其余条目。移除 600 秒缓存，事件按相关钱包使目录失效；已有低频轮询作为断线恢复，保留当前选中且已归属的钱包市场。 |
| C4 异步污染 | 成功清除该请求错误；余额及历史轮次请求使用 AbortController、generation、钱包、路由及市场选择约束。阻止并发的归集与领取。 |
| C5 结构化账本 | 新增 `0025_creator_rewards`：轮次、受益人、资产索引；入账、领取、销毁、剩余守恒；Curve 费用与税分离；同一事件入口增量更新，利用既有历史贡献记录进行重组撤销。后端读事务保持一致快照；补充只读链上对账命令。 |
| C6 收益交接 | 记录 proposed/cancelled/accepted；pending 钱包没有旧 epoch 也可通过接口发现提名。移除不可达的网页交接操作代码，明确当前网页未开放交接入口，不增加按钮。 |
| C7 规范 | 更新两步交接、历史收益归属、本人领取原资产和 Meme 销毁规则；删除旧单步交接与 permissionless 领取描述。 |

Creator 基础费、Creator tax、Holder 分成的比例未修改。LP fee 与上述收益分账保持区分。页面保留原有资产分隔样式及待销毁标识；本次没有增加页面组件。

## 数据与发布顺序

1. 测试环境先应用 `0025_creator_rewards` 及 `permissionsSql`：Read API 对新表只读，Pipeline 写入；Content 不授予权限。
2. 更新 Worker。历史算法版本为 `history-incremental-v3-creator`，首次有界回填，每次最多处理 256 个有事件的区块；后续增量推进。回填完成前不要切换新 Creator 前端。
3. 检查 history checkpoint 到达目标确认区块；验证已存在市场的 epoch、pendingQuote 和双资产余额。Creator 页面统计采用既有奖励历史确认规则，进入页面不等待全站统计。
4. 对有实际负债的测试市场运行只读对账，完成测试网 sweep→claim 回执验收，再发布 Read API 和 Web。Vercel 仍须执行源分支边界和 `sin1` runtime 核验。
5. 生产发布按同一顺序；此次未执行。已归属历史收益和当前收益分开，回填期间旧版本应用可继续使用。

## 后台归集与对账

命令从 `services/backend-ts` 执行，配置仅通过私有环境注入；不要提交密钥。

- `npm run creator:sweep -- preview`：只列数据库候选及阈值，不签名。
- `npm run creator:sweep -- run`：每次最多查看 20 个市场，至多提交一个新交易。游标持久化、尾部回绕；单市场校验失败不阻塞其余市场，已有未决交易则停止新签名。
- `npm run creator:sweep -- reconcile`：只核验原交易回执、区块和最终确认状态。
- `npm run creator:sweep -- retry-signed`：仅重发持久记录中已验证的原始签名字节；不替换 nonce、不提高费用。nonce 已消耗但没有匹配回执时停止并要求人工核对。
- `npm run creator:reconcile -- [cursor]`：按 history checkpoint 对账最多 20 个资产余额及受益人，返回续作游标；同区块比较并复核区块哈希。差异只报告，不覆盖数据库或改动资金。

必需环境：`TG_ENVIRONMENT`、`TG_RPC_URL`、相应只读/ Pipeline 数据库连接及 schema。归集另需：

| 变量 | 含义 |
| --- | --- |
| `TG_CREATOR_SWEEP_ADDRESS` | 专用或与既有服务共用的归集钱包 |
| `TG_CREATOR_SWEEP_SIGNER_FILE` | 私有 JSON 文件，含 privateKey；只有 run 读取 |
| `TG_CREATOR_SWEEP_STATE_DIR` | 绝对路径、0700 的持久状态目录；文件0600 |
| `TG_SIGNER_COORDINATION_DIR` | 必须与 Holder/Locker 共用的 signer lane 目录 |
| `TG_CREATOR_SWEEP_MIN_BY_ASSET` | JSON：小写 Quote 地址→最小原始单位字符串；未列资产不归集。ETH 使用零地址 |
| `TG_CREATOR_SWEEP_MAX_TX_GAS_WEI` | 正整数，单笔最大 Gas 成本 |
| `TG_CREATOR_SWEEP_DAILY_GAS_WEI` | 正整数，UTC 每日最大预留 Gas 成本；按最坏成本保守扣减 |
| `TG_SETTLEMENT_FINALITY` | 优先 finalized；显式 delay 时采用 `TG_FINALITY_SECONDS`，不得低于60秒 |

**自动归集尚未启用。** 上线前必须配置资产阈值、Gas 预算、持久私有目录并完成测试网真实回执验收；本次没有花费授权，未设置新的定时签名服务。用户领取前的按需归集不依赖该服务。

## 本地验证

- Web：632 项测试通过；生产构建、资源预算和生成客户端检查通过。
- Backend：188 项单元测试通过；类型检查、构建、OpenAPI/覆盖校验通过。
- PostgreSQL 全集：43 项通过、0失败；100,001 Holder 压力场景默认未启用而跳过1项。本次 Creator 容量场景实际运行：20,001市场、60,003轮次、60,003余额记录，按钱包及市场读取使用索引。
- Creator 专项：原资产余额守恒、税与 Holder 分享精度、提名/取消/接受、旧轮次领取归属、跨区块增量、重组替换分支、无历史 epoch 的 pending 钱包、23轮分页、游标钱包隔离。
- 归集签名专项：预算、错误链、部署绑定、签名原文篡改、目标/金额/calldata/nonce/签名者/费用上限，以及与 Holder/Locker 的 signer lane 互斥。
- Foundry：相关 Registry、Curve、Vault、User/Selected claims、ClaimAvailability、Meme burn 套件100项通过。未修改合约。

边界：未测试真实钱包交互、生产进程或自动归集完整 RPC 回执流程；本地模拟不等于生产发布验收。归集模块原始签名核验已测试，真实节点下的首次提交、超时恢复与 finalized 回执仍属于上线前测试网验收。
