# 钱包快照后端

2026-09-13。面向当前 RH 测试 release `685b5c20`。用户选择先完成后端、暂不启用周期发布；本实现不启动定时器、不保存私钥、不修改 publisher 权限、不发送交易。

## 数据流程

1. Chain worker 在已确认批次中投影 Distributor 市场、资金桶、发布者、轮次及领取位图。重组时重建链上观察记录；已保存的分配数据不删除。
2. 操作者显式选取索引器已经确认的区块。生成器验证 release、链 ID、Distributor codehash、连续索引覆盖，重放 Meme Transfer，再以两个 RPC 核对该区块的供应量、排除名单及每个正余额账户。
3. `DIRECT_BALANCE_PRO_RATA_FLOOR_V1` 是可用的分配算法：直接钱包余额按比例计算 Quote/Meme，使用整数向下取整，剩余金额保留在未分配资金中。它不是已经启用的周期或随机取样政策。没有合格账户或可分配金额时不生成零预算 Root。烧毁模式必须 Meme 预算为零。
4. 数据集保存完整输入、账户金额、证明、root 和规范 JSON 的 Keccak dataHash。规范 JSON 按对象键排序、数组顺序固定，避免 PostgreSQL JSONB 键顺序影响摘要。每个 market/round 可以保存不同 dataHash 的候选，便于重组或预算变化后重新准备；原候选保留。Pipeline 只能读取、插入数据集，不能修改或删除。
5. 发布预览重新验证持久化、历史余额、历史资金桶、区块身份、最新轮次和预算，并由两个 RPC 模拟精确 calldata。匹配的已发布轮次返回 `already_published`；冲突拒绝。没有 publisher 返回 `publisher_unconfigured`。
6. `GET /v1/holder-snapshots` 只提供与已确认链上 root/dataHash/预算/区块匹配的证明，合并 Quote/Meme 独立领取位。数据库数据只用于展示；前端签名前仍检查链上 Root、预算和位图。

## 操作命令

从 `services/backend-ts` 运行，使用 Node 24。需要通过受保护环境提供 `TG_ENVIRONMENT=test`、`TG_PIPELINE_DATABASE_URL`、`TG_RPC_URL`、`TG_SECONDARY_RPC_URL`，可选 `TG_DATABASE_SCHEMA`。不得把私钥传给这些命令。

```sh
node --experimental-strip-types scripts/holder-snapshot.ts prepare <marketId> <finalized-block> <output.json>
node --experimental-strip-types scripts/holder-snapshot.ts verify <output.json>
node --experimental-strip-types scripts/holder-snapshot.ts preview <output.json>
node --experimental-strip-types scripts/holder-snapshot.ts funding <sender-address> <marketId,marketId>
```

`prepare` 在数据库保存后以独占写方式导出文件；若文件写入失败，数据库中的候选仍保留，使用不同输出文件名重新执行同一输入即可。资金归集预览使用 `fundHolderRewardsBatch`，最多 32 个不同市场、默认每项 500000 Gas；它不把“已尝试所有项目”误报成“所有资产已归集”。实际提交后的结果由 `HolderFundingResult` 和新资金桶状态确认。归集和发布是两步；归集不会自动开放领取。

当前 CLI 只提供准备、校验、资金归集预览和发布预览，没有广播开关。未来启用发送需要独立的签名/nonce/回执恢复方案及公开 publisher 地址；启用周期还需另行确认周期及取样政策。不能把预览 calldata 当成长期有效的待签交易，提交前必须再次核对并模拟。

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
