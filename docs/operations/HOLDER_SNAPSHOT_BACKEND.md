# 钱包快照后端

2026-09-18。Holder 快照 CLI 必须显式设置 `TG_ENVIRONMENT=test` 或 `production`，并匹配该进程绑定的 runtime release、链 ID、数据库和 RPC。代码不会因选择环境而切换部署或放宽 publisher 权限。prepare/verify/preview/funding/audit/repair 不签名；只有 publish 会读取本地受保护签名文件并发送，reconcile 只读对账。

## 数据流程

1. Chain worker 在已确认批次中投影 Distributor 市场、资金桶、发布者、轮次及领取位图。重组时重建链上观察记录；已保存的分配数据不删除。
2. 操作者显式选取索引器已经确认的区块。生成器验证 release、链 ID、Distributor codehash 和连续索引覆盖，重放 Meme Transfer，再按 `rpcPolicy` 使用独立双 RPC，或在明确允许的生产单 RPC 模式下信任主 RPC，核对该区块的供应量、排除名单及受影响账户（包括变成零余额的账户）。
3. `DIRECT_BALANCE_PRO_RATA_FLOOR_V1` 是可用的分配算法：直接钱包余额按比例计算 Quote/Meme，使用整数向下取整，剩余金额保留在未分配资金中。它不是已经启用的周期或随机取样政策。没有合格账户或可分配金额时不生成零预算 Root。烧毁模式必须 Meme 预算为零。
4. 默认准备 V2 manifest。完整输入、分片余额、Merkle 节点、wallet proof pages 和验证证据写入持久数据库；文件只携带 manifest、Root、预算和摘要。每个 market/round 可以保存不同 dataHash 的候选，原候选保留。完整 V1 dataset 仍可验证和发布，其兼容构建器保留原有 100,000 账户输入上限；默认 V2 流程不受此旧格式限制。
5. 发布预览验证持久归档、历史余额、历史资金桶、区块身份、最新轮次和预算，并按 `rpcPolicy` 模拟精确 calldata。已有匹配证据时复用已验证的余额检查，避免重复读取整份余额列表。匹配的已发布轮次返回 `already_published`；冲突拒绝。没有 publisher 返回 `publisher_unconfigured`。
6. `GET /v1/holder-snapshots` 只提供与已确认链上 root/dataHash/预算/区块匹配的证明，合并 Quote/Meme 独立领取位。数据库数据只用于展示；前端签名前仍检查链上 Root、预算和位图。

## 操作命令

从 `services/backend-ts` 运行，使用 Node 24。必须先应用 `0024_holder_recovery` 数据库迁移并配置对应的 Pipeline 表权限；旧 schema 缺少快照 work、balance、tree 和 evidence 表时，准备与修复不能使用。环境变量需通过受保护环境提供：`TG_ENVIRONMENT=test|production`、匹配当前 runtime 的 `TG_PIPELINE_DATABASE_URL` 和 `TG_RPC_URL`，可选 `TG_DATABASE_SCHEMA`。

RPC 验证默认使用 `TG_RPC_VERIFICATION_MODE=dual`，并配置独立 `TG_SECONDARY_RPC_URL`。`single` 模式只允许显式的 production chain `4663`，不能同时配置 secondary endpoint；它信任 primary provider，验证路径复用同一 provider 的结果，不代表独立双源验证。不要为 test/46630 使用 single 模式。

```sh
node --experimental-strip-types scripts/holder-snapshot.ts prepare <marketId> <finalized-block> <output.json>
node --experimental-strip-types scripts/holder-snapshot.ts verify <output.json>
node --experimental-strip-types scripts/holder-snapshot.ts preview <output.json>
node --experimental-strip-types scripts/holder-snapshot.ts funding <sender-address> <marketId,marketId>
node --experimental-strip-types scripts/holder-snapshot.ts audit <manifest.json> [afterAccount]
node --experimental-strip-types scripts/holder-snapshot.ts repair <manifest.json>
```

`prepare` 默认以每页 500 条推进可恢复的余额账本、Merkle tree 和 proofs，每次最多执行 20 个 work steps。未完成时输出 `preparation_pending` 并以退出码 2 结束；修复暂时错误或资源问题后，重复完全相同的 `prepare` 命令以续跑同一份数据库 work。新轮次可从同一 generation 下较早的 canonical、finalized 余额基线复制，只重新核对之后有变化的账户。`prepare` 在完成后以独占写方式导出 V2 manifest；若文件写入失败，manifest 和已验证数据库归档仍保留，换一个输出路径导出即可。

`verify` 对 V2 返回 `manifest_verified_database_evidence_required`，只表示文件承诺自洽；发布仍必须具备数据库中的余额验证证据。

V2 manifest 文件本身不足以重建钱包 proof archive。必须备份并保留与之对应的 `holder_snapshot_work`、`holder_snapshot_balances`、`holder_snapshot_nodes`、`holder_reward_wallet_proofs` 和 `holder_snapshot_evidence` 数据。

`audit` 每次检查最多 500 个 proof，响应中的 `nextAccount` 是下一页游标；把它作为可选 `afterAccount` 参数重复运行，直到 `nextAccount` 为 `null`。检测到问题时输出 `needs_repair`、退出码 1。`repair` 只修复本地 proof index，不改链上 round，也不发送交易；成功返回 `index_repaired`。V2 repair 需要保留的数据库 work/tree；每次最多继续 20 个 steps，未完成返回 `repair_pending` 和退出码 2，重复同一 repair 命令直到完成。V1 完整 dataset 可用来重建本地 proof index。

资金归集预览使用 `fundHolderRewardsBatch`，最多 32 个不同市场、默认每项 500000 Gas；它不把“已尝试所有项目”误报成“所有资产已归集”。实际提交后的结果由 `HolderFundingResult` 和新资金桶状态确认。归集和发布是两步；归集不会自动开放领取。

新增的手动发布与回执工具见下一节。资金归集命令仍只是预览，不自动归集；应先完成独立资金归集，再重新生成候选。发布工具每次重新核对及模拟，不能把旧预览 calldata 当成长期有效的待签交易。周期发布继续关闭。

## 手动签名发布与回执对账

从仓库根目录运行。npm script 会加载根 `.env.test.local` 作为本地/test 默认值；用于 production 时必须由受保护的进程环境显式提供 production `TG_ENVIRONMENT`、数据库及 RPC 配置，不能依赖 test dotenv 文件：

```sh
npm run holder:snapshot -- publish /absolute/path/dataset.json
npm run holder:snapshot -- reconcile /absolute/path/dataset.json
npm run holder:snapshot -- status
```

`publish` 是唯一会签名或广播的入口，单次执行后返回；没有定时器或循环。`reconcile` 不需要签名文件，不签名、不广播；`status` 只读本地 journal，不需要数据库或 RPC。publish/reconcile 可接收 1–32 个 artifact 文件，文件必须属于相同 runtime deployment、Distributor，且 market 各不相同：

```sh
npm run holder:snapshot -- publish /absolute/path/market-a.json /absolute/path/market-b.json
npm run holder:snapshot -- reconcile /absolute/path/market-a.json /absolute/path/market-b.json
```

必须配置：

- `TG_ENVIRONMENT=test|production`：必须与当前进程的 runtime deployment、数据库和 RPC 相符。运行时链与 release 由进程绑定；环境变量不会自动切换部署，也不代表主网广播授权。
- `TG_PIPELINE_DATABASE_URL`、`TG_RPC_URL` 和由 `rpcPolicy` 选择的验证 RPC：发布预验仍检查链 ID、固定 Distributor codehash、数据库最终性锚点、历史钱包与预算、当前 root/round 等。dual 模式需独立 secondary RPC；single 模式仅用于 production/4663，并信任 primary。
- `TG_SNAPSHOT_PUBLISHER_ADDRESS`：已由治理配置的 EOA publisher，必须与签名地址及链上地址一致。合约/Safe publisher 可继续使用 preview calldata 经其自己的签名执行流程，本工具不代替 Safe 签名。
- `TG_SNAPSHOT_SIGNER_FILE`：publish 使用的非符号链接、0600 JSON 文件，内容为 `{"privateKey":"..."}`；禁止提交到仓库。没有创建或使用真实发布者私钥。
- `TG_SNAPSHOT_PUBLICATION_STATE_DIR`：绝对路径、0700、非符号链接、持久本地磁盘。同链同 publisher 的所有市场、轮次必须共用该目录和独占锁，共享 publisher/keeper 地址时，通过下述公共协调目录串行执行，不与未接入协调的程序并发发交易。
- `TG_SIGNER_COORDINATION_DIR`：Holder publisher 与 Locker Keeper 必须共用的同主机、权限为 0700 的私有持久目录。启用共享协调前，先对账既有 Holder publication journal 与 Locker pending operation；解决所有未决 nonce/交易，再让两个服务使用同一 signer lane。设置变量不会自动启用发布或 Keeper 操作。
- `TG_SNAPSHOT_MAX_TX_GAS_WEI`：明确的单笔最大 `gasLimit × gasPrice`，正整数字符串；没有默认花费授权值。
- 可选 `TG_SNAPSHOT_CONFIRMATIONS`，默认 2、至少 2；`TG_SETTLEMENT_FINALITY` 默认 `finalized`。只有配置为 `delay` 时才以时间延迟代替 finalized-tag；`TG_SNAPSHOT_FINALITY_SECONDS`/`TG_FINALITY_SECONDS` 默认 60 秒且不得低于 60 秒，不会在 finalized RPC 不可用时静默回退。可选 `TG_DATABASE_SCHEMA`。

流程：逐 artifact 预验 → 验证同一 publisher lane 没有外部待处理 nonce → 按 `rpcPolicy` 选择的验证 transport 估 Gas、取较大值加 20% 余量，gasPrice 加 20% 余量并检查预算与余额 → 再次预验和精确模拟 → 刷新 latest/pending nonce，变化时停止签名 → 本地签署 EIP-155 legacy 交易 → 解码签名并检查 chain/to/data/value/nonce/Gas/签名地址 → fsync 意图 → 发送原文。dual 模式使用独立 provider；single 模式的验证 transport 指向受信任的 primary。没有放宽原只读 RpcTransport；专用 PublicationRpcTransport 才允许费用估算和 `eth_sendRawTransaction`，且不会自动重试广播。

结果分为 `pending`、`confirming`、`confirmed`、`reverted`、`already_published` 和需人工对账。确认要求所选验证 transport 返回的回执交易、区块、状态和日志一致：dual 模式比较独立两个 RPC，single 模式使用受信任 primary 的结果；达到确认深度与 configured finality 条件，精确匹配事件中的 market、round、snapshotBlock/hash、root、dataHash、Quote/Meme budget，再检查当前链上 round 仍与数据集一致。只有通过后才清除 pending；不直接把数据库 round 标记为已发布，仍由正常确认索引驱动 API。

### 重试与异常恢复

- 发送超时：已签原文保留。重新 publish 只对账或重发完全相同的原文，不生成第二笔业务交易；也可先运行无需私钥的 reconcile。
- 回执尚未达到确认数及选定 finality 条件：返回 confirming，之后手动 reconcile；不能把它当成失败重新发布。
- RPC 不一致、回执重组、事件不匹配：保留 pending 并停止。已消耗 nonce 却查不到匹配回执，同样需要人工核对。
- 意图最多主动重发 300 秒。**publishSnapshots 没有链上 deadline；工具停止重发并不能让已广播的签名失效。** 未决意图不能仅靠删文件“取消”，需要核对 nonce/交易，必要时在外部完成 nonce 取消或替换后再归档处理。
- 如果同一数据集已经发布且没有未决意图，返回 already_published、不再签名。另一条路径已发布但原签名 nonce 仍未决时保留 pending_nonce_reconciliation，不能直接释放 nonce 队列。
- 共享 signer 独占锁异常残留时，只有确认 owner 是本机且 PID 已终止后，才可使用精确 token 恢复。禁止按锁龄自动删除，也禁止删除 pending publication journal。一个 signer 不能通过不同 state/coordination 目录绕过串行约束。
- journal 的 status 输出隐藏原始签名，错误日志不输出 RPC URL、私钥或原始交易。它是运维状态，不是公开 HTTP 签名 API；多机/Serverless 使用前需单独实现数据库锁与 signer 协调。

恢复命令格式如下；`publication` 使用 `TG_SNAPSHOT_PUBLICATION_STATE_DIR`，`signer` 使用 `TG_SIGNER_COORDINATION_DIR`。命令要求 operator 提供锁文件内的精确 token，并拒绝 live PID 或 foreign host；只移除确认死亡的本地 lock，不删除 journal：

```sh
npm run holder:snapshot -- recover-lock publication <exact-token>
npm run holder:snapshot -- recover-lock signer <exact-token>
```

这两个命令仍需加载匹配的 `TG_ENVIRONMENT`、`TG_SNAPSHOT_PUBLISHER_ADDRESS` 和 `TG_SNAPSHOT_PUBLICATION_STATE_DIR`，以确定 chain/publisher 身份；signer lock 的路径另由 `TG_SIGNER_COORDINATION_DIR` 提供。

### 本地真实合约复现

```sh
node tools/holder-rewards/prepare-publication-local.mjs
anvil --port 18677 --chain-id 46630 --hardfork cancun --timestamp 1800000000 --silent
# 另一个终端，在仓库根目录：
node --experimental-strip-types services/backend-ts/scripts/test-holder-publication-local.ts
```

仅可使用专属空白 localhost:18677 节点，导入工具会写入测试账户代码/storage。真实 Distributor、Token、AccessManager，Registry/Vault/Hook/时钟及 preflight 是明确的测试适配；两个 transport 指向同一个本地节点，不是独立提供商证据。独立 preflight 和数据库链路另由单元/数据库集成测试验证。该测试签名本地交易、重载 journal 对账，并验证领取预演，不向 RH 广播。导出使用独立临时配置、out/cache，不改生产合约或正式编译参数。

## API

```text
GET /v1/holder-snapshots?chainId=46630&distributor=0x...&marketId=0x...&account=0x...&cursor=...
```

响应 `schema=TICKERGARDEN_HOLDER_WALLET_SNAPSHOTS_V1`，包含 `quote/meme`、已确认来源、`status`、`rounds` 和 `nextCursor`。状态区分 `publisher_unconfigured`、`awaiting_funding`、`awaiting_publication` 和 `ready`。`ready` 不表示当前钱包一定有权益；没有其账户的合格轮次时列表为空。

每页最多返回 10 条该钱包有 proof 的轮次，按 round 从新到旧排列；没有任何权益时返回空列表。Cursor 绑定 release、合约、市场、账户，以及 generation、latest round 和其 root/dataHash/snapshot-block commitments。领取观察或市场来源区块更新不会改变该 revision；新轮次或 generation/commitment 变化返回 409，调用者应丢弃旧 cursor 重新读取。`complete=false` 表示 archive/history 不完整，或当前可见 proof 有损坏；坏轮次列在 `unavailableRounds`，同页健康轮次仍可返回。无法建立 finalized market anchor 时返回 503。接口始终 `Cache-Control: no-store`，不伪造零收益。

## 存储、限制和运维

`0024_holder_recovery` 是 V2 durable ledger/tree/proof/evidence 流程的前置迁移；同步更新 Pipeline 权限。与 `0004_holder_rewards` 的已有表一起长期备份 dataset、proof index 和 V2 work/balance/tree/evidence。Root 发布后不可撤回，不能删除已发布数据集来“修复”错误。V2 manifest 单独保存不足以修复或重建 archive。

余额重放、复制、tree 和 proofs 都使用 500 行默认分页；一次 prepare 最多 20 个 work steps，超限保留进度并退出 2。发布最多 32 个 distinct markets。不能把这些有界执行参数当作生产容量验收，也不能据此宣称 publisher 去信任化。

## 验证范围

- 生成金额、排除名单、奇数 Merkle 树、预算舍入、数据损坏与 JSONB 规范化。
- 按 `rpcPolicy` 配置的历史账户、链身份、预算及轮次预览门禁；dual 模式由独立双 RPC 验证，single 模式只用于 production/4663 并信任 primary。
- 真实 PostgreSQL 临时 schema 中的迁移幂等、候选生成、持久化、证明查询、已领取位、重组及历史缺口。
- Solidity 验收使用后端生成的三账户测试向量，验证真实 Distributor 的发布和领取。该向量是本地 EVM 合约兼容性证据，不是 RH 上真实用户余额的资金操作。

本说明记录当前 CLI、数据库和 runtime policy；它不代表已验证 production 部署，也不声称本次更新执行过真实广播。
