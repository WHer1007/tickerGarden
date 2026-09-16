# 钱包快照后端

2026-09-13。面向当前 RH 测试 release `685b5c20`。用户选择先完成后端、暂不启用周期发布；本实现不启动定时器、不修改 publisher 权限。prepare/verify/preview/funding 保持不签名；新增 publish 显式加载本地受保护签名文件，保存已签交易意图并发送，reconcile 只读对账。

## 数据流程

1. Chain worker 在已确认批次中投影 Distributor 市场、资金桶、发布者、轮次及领取位图。重组时重建链上观察记录；已保存的分配数据不删除。
2. 操作者显式选取索引器已经确认的区块。生成器验证 release、链 ID、Distributor codehash、连续索引覆盖，重放 Meme Transfer，再以两个 RPC 核对该区块的供应量、排除名单及每个正余额账户。
3. `DIRECT_BALANCE_PRO_RATA_FLOOR_V1` 是可用的分配算法：直接钱包余额按比例计算 Quote/Meme，使用整数向下取整，剩余金额保留在未分配资金中。它不是已经启用的周期或随机取样政策。没有合格账户或可分配金额时不生成零预算 Root。烧毁模式必须 Meme 预算为零。
4. 数据集保存完整输入、账户金额、证明、root 和规范 JSON 的 Keccak dataHash。规范 JSON 按对象键排序、数组顺序固定，避免 PostgreSQL JSONB 键顺序影响摘要。每个 market/round 可以保存不同 dataHash 的候选，便于重组或预算变化后重新准备；原候选保留。Pipeline 只能读取、插入数据集，不能修改或删除。
5. 发布预览重新验证持久化、历史余额、历史资金桶、区块身份、最新轮次和预算，并由两个 RPC 模拟精确 calldata。匹配的已发布轮次返回 `already_published`；冲突拒绝。没有 publisher 返回 `publisher_unconfigured`。
6. `GET /v1/holder-snapshots` 只提供与已确认链上 root/dataHash/预算/区块匹配的证明，合并 Quote/Meme 独立领取位。数据库数据只用于展示；前端签名前仍检查链上 Root、预算和位图。

## 操作命令

从 `services/backend-ts` 运行，使用 Node 24。需要通过受保护环境提供 `TG_ENVIRONMENT=test`、`TG_PIPELINE_DATABASE_URL`、`TG_RPC_URL`、`TG_SECONDARY_RPC_URL`，可选 `TG_DATABASE_SCHEMA`。准备、验证及预演不需要私钥；publish 的私钥只能通过受保护文件提供，不能放在命令参数中。

```sh
node --experimental-strip-types scripts/holder-snapshot.ts prepare <marketId> <finalized-block> <output.json>
node --experimental-strip-types scripts/holder-snapshot.ts verify <output.json>
node --experimental-strip-types scripts/holder-snapshot.ts preview <output.json>
node --experimental-strip-types scripts/holder-snapshot.ts funding <sender-address> <marketId,marketId>
```

`prepare` 在数据库保存后以独占写方式导出文件；若文件写入失败，数据库中的候选仍保留，使用不同输出文件名重新执行同一输入即可。资金归集预览使用 `fundHolderRewardsBatch`，最多 32 个不同市场、默认每项 500000 Gas；它不把“已尝试所有项目”误报成“所有资产已归集”。实际提交后的结果由 `HolderFundingResult` 和新资金桶状态确认。归集和发布是两步；归集不会自动开放领取。

新增的手动发布与回执工具见下一节。资金归集命令仍只是预览，不自动归集；应先完成独立资金归集，再重新生成候选。发布工具每次重新核对及模拟，不能把旧预览 calldata 当成长期有效的待签交易。周期发布继续关闭。

## 手动签名发布与回执对账

从仓库根目录运行，加载根 `.env.test.local`，也可由安全的进程环境提供配置：

```sh
npm run holder:snapshot -- publish /absolute/path/dataset.json
npm run holder:snapshot -- reconcile /absolute/path/dataset.json
npm run holder:snapshot -- status
```

`publish` 是唯一会签名或广播的入口，单次执行后返回；没有定时器或循环。`reconcile` 不需要签名文件，不签名、不广播；`status` 只读本地 journal，不需要数据库或 RPC。现有 `prepare / verify / preview / funding` 参数保持不变。

必须配置：

- `TG_ENVIRONMENT=test`：仅限当前代码绑定的 RH test release / chain 46630；不自动切换部署、不授权主网发布。
- `TG_PIPELINE_DATABASE_URL`、`TG_RPC_URL`、`TG_SECONDARY_RPC_URL`：现有数据集与独立 RPC。发布预验仍检查链 ID、固定 Distributor codehash、数据库最终性锚点、历史钱包与预算、当前 root/round 等。
- `TG_SNAPSHOT_PUBLISHER_ADDRESS`：已由治理配置的 EOA publisher，必须与签名地址及链上地址一致。合约/Safe publisher 可继续使用 preview calldata 经其自己的签名执行流程，本工具不代替 Safe 签名。
- `TG_SNAPSHOT_SIGNER_FILE`：publish 使用的非符号链接、0600 JSON 文件，内容为 `{"privateKey":"..."}`；禁止提交到仓库。没有创建或使用真实发布者私钥。
- `TG_SNAPSHOT_PUBLICATION_STATE_DIR`：绝对路径、0700、非符号链接、持久本地磁盘。同链同 publisher 的所有市场、轮次必须共用该目录和独占锁，使用专用 publisher signer，不与其他程序并发发交易。
- `TG_SNAPSHOT_MAX_TX_GAS_WEI`：明确的单笔最大 `gasLimit × gasPrice`，正整数字符串；没有默认花费授权值。
- 可选 `TG_SNAPSHOT_CONFIRMATIONS`，默认 2、至少 2；`TG_SNAPSHOT_FINALITY_SECONDS`，默认 600、当前 CLI 不允许低于 600；可选 `TG_DATABASE_SCHEMA`。

流程：重新预验 → 两 RPC nonce 一致且无待处理外部交易 → 两 RPC 估 Gas、取较大值加 20% 余量，gasPrice 加 20% 余量并检查预算与余额 → 再次预验和精确模拟 → 本地签署 EIP-155 legacy 交易 → 解码签名并检查 chain/to/data/value/nonce/Gas/签名地址 → fsync 意图 → 发送原文。没有放宽原只读 RpcTransport；专用 PublicationRpcTransport 才允许费用估算和 `eth_sendRawTransaction`，且不会自动重试广播。

结果分为 `pending`、`confirming`、`confirmed`、`reverted`、`already_published` 和需人工对账。确认要求两个 RPC 的回执交易、区块、状态和日志一致，达到确认深度与时间阈值，精确匹配事件中的 market、round、snapshotBlock/hash、root、dataHash、Quote/Meme budget，再检查当前链上 round 仍与数据集一致。只有通过后才清除 pending；不直接把数据库 round 标记为已发布，仍由正常确认索引驱动 API。

### 重试与异常恢复

- 发送超时：已签原文保留。重新 publish 只对账或重发完全相同的原文，不生成第二笔业务交易；也可先运行无需私钥的 reconcile。
- 回执未达到 600 秒：返回 confirming，之后手动 reconcile；不能把它当成失败重新发布。
- RPC 不一致、回执重组、事件不匹配：保留 pending 并停止。已消耗 nonce 却查不到匹配回执，同样需要人工核对。
- 意图最多主动重发 300 秒。**publishSnapshots 没有链上 deadline；工具停止重发并不能让已广播的签名失效。** 未决意图不能仅靠删文件“取消”，需要核对 nonce/交易，必要时在外部完成 nonce 取消或替换后再归档处理。
- 如果同一数据集已经发布且没有未决意图，返回 already_published、不再签名。另一条路径已发布但原签名 nonce 仍未决时保留 pending_nonce_reconciliation，不能直接释放 nonce 队列。
- 独占锁异常残留时，先核对锁内 PID 已终止，才可移除 `.lock`；不要删除包含未决交易的 journal。一个 signer 不能通过不同 state 目录绕过串行约束。
- journal 的 status 输出隐藏原始签名，错误日志不输出 RPC URL、私钥或原始交易。它是运维状态，不是公开 HTTP 签名 API；多机/Serverless 使用前需单独实现数据库锁与 signer 协调。

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

每页扫描最多 10 个连续轮次，可能返回空权益列表及非空 cursor，调用者应继续分页。Cursor 绑定 release、合约、市场、账户和来源 revision；来源变化返回 409，应丢弃旧 cursor 重新读取。接口始终 `Cache-Control: no-store`。缺失轮次、缺失证明、数据损坏、重组或未建立有效投影返回 503，不返回虚构的零收益。

## 存储、限制和运维

迁移 `0004_holder_rewards` 新增 4 张表，不修改旧 release 数据。数据集应和数据库一起长期备份；Root 发布后不可撤回，不能删除已发布数据集来“修复”错误。

当前有界实现最多 10000 个余额账户、1000000 条代币事件、100000 条奖励事件、1000 个奖励市场；单数据集数据库上限 16 MiB，查询输入累计上限 32 MiB。超过边界失败关闭。奖励投影当前是有界全量重放，属于测试版本实现；高市场数发布前需完成增量投影与容量验收。不能用这次测试结论宣称生产容量或发布者去信任化。

## 验证范围

- 生成金额、排除名单、奇数 Merkle 树、预算舍入、数据损坏与 JSONB 规范化。
- 双 RPC 历史账户、链身份、预算及轮次预览门禁。
- 真实 PostgreSQL 临时 schema 中的迁移幂等、候选生成、持久化、证明查询、已领取位、重组及历史缺口。
- Solidity 验收使用后端生成的三账户测试向量，验证真实 Distributor 的发布和领取。该向量是本地 EVM 合约兼容性证据，不是 RH 上真实用户余额的资金操作。
