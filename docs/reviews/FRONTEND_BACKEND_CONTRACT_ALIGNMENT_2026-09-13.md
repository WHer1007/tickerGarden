# 前后端与最新合约业务对齐检查

日期：2026-09-13。检查对象为当前工作区源码，包含可选 LP 费率、Locker 复投和空 Staking Gas 优化。本轮是功能与集成审查，不修改生产逻辑，不部署或启用周期任务。没有读取线上 Vercel 实例或重新核验在线合约。

## 本轮用户确认后的边界更新

以下确认优先于下方原始审查中的功能补齐建议：

- Creator 收益权交接不放前端入口；Creator 通过邮件等项目联系渠道申请，实际操作仍受当前受益人提名与新受益人接受的链上权限约束。
- 紧急退出不放前端入口；用户通过已验证的外部合约调用自行处理。
- LP 复投在前端仅作文档说明，不要求复投按钮、状态卡片或为这些页面新增 API；手动后台执行工具保留。
- Holder 手动签名发布与回执对账工具已补齐，见 [操作说明](../operations/HOLDER_SNAPSHOT_BACKEND.md)。周期任务仍关闭。

因此以上三类页面入口缺失不再作为待修复项，下方为用户决策前的审查记录。最新部署统一接入、实际端到端联调，以及未在本次指定的其他事项不在此次实现范围内。

## 结论

**尚未全面对齐。** 创建、交易、正常 Stake/退出与奖励领取已有实际页面，但 Creator 交接、延迟奖励清理只有处理逻辑没有页面控件，紧急退出也未在 Stake 页面开放。另外仍需补齐最新部署身份接入、Locker 的索引/API/网站状态链路、Holder 快照的手动签名发布与回执对账。不能因 ABI 或事件分支中存在方法就宣称产品支持。

本轮纠正此前业务审查中将 Creator 交接、延迟清理和紧急退出判为“前端入口齐全”的结论：此前确认了 `app.ts` 处理分支，本轮核对实际 HTML/DOM 控件后发现入口未挂载。

## 需要补齐的环节

### 优先：普通用户有三个合约业务无法从当前页面完成

1. **Creator 收益权交接。** `app.ts:5340-5373` 实现提名/接受/取消交易、权限及回执验证，`4008,5054-5060` 查询对应输入和按钮；但 `pages/rewards.ts:9-18` 的 Creator 面板只有领取按钮，页面源码没有 `data-creator-new-beneficiary` 输入，也没有三种交接 action 控件。现有 Creator 不能从正常页面提名，新受益人也不能在页面接受。应补齐输入、待接受状态、当前/待接受地址与三步权限控制；新受益人还要能找到对应市场，不能只查询已经归其所有的 Creator 列表。
2. **延迟奖励清理。** `app.ts:5263-5274` 有 `executeSettlement` 处理、`5047-5048` 查找账户输入和按钮；但页面没有 `data-settle-user` 或 `settleRageQuitRewards` 控件。发生 deferred settlement 后，用户不能从网站清理 tombstone，可能继续无法在同市场重新 Stake 或领取被限制的旧权益。本金已退出不等于维护流程完成。应在实际 pending 状态下提供清理入口和回执后的状态刷新。
3. **紧急本金退出。** `app.ts:5141,5195,5540,5563` 有 AllocationManager / direct Vault 的处理与罚没确认文案，但当前 Stake 页面只有 Stake、Claim、Unstake all。`pages/docs.ts:29` 明确说明当前页面不开放 rageQuit、需使用已验证的其他界面或 canonical route。这是已记录的产品覆盖边界，未确认是最近引入的回归；若要求网站覆盖合约退出能力，应补充高级紧急退出流程，并保持全部奖励罚没的明确确认，不能把它混成普通 Unstake。

### A. 最新合约候选尚未成为前后端共同的运行版本

后端 `packages/events/src/index.ts:6,162-183` 固定 release `0x685b5c20e826f4ddd076b61216c7529a967322082925c4741469b0fda837a7f2`、合约地址、codehash 和起始块。`packages/chain-worker/src/index.ts:40-46` 固定 chainId=46630、genesis 和 release；快照工具也固定同一身份（`holder-snapshots.ts:22`、`scripts/holder-snapshot.ts:16-19`）。不能仅通过把 RPC 指向本地 Anvil 或新链，就让所有 worker 自动处理最新部署。

前端 `tests/latest-release.test.ts:9-30` 核对的是该已保存 release 的 frontend bootstrap 与 integration catalog 相互一致；第二个测试证明最新 ABI 可以编码创建参数。这两项不证明已保存的链上实例具有最新 LP/Gas 功能。前端的 `resolveLpLaunchConfig` 会探测 `lpFeeMode()`，旧实例不支持非零费率时明确拒绝（`features/launch.ts:399-405`），属于正确保护，不能删掉以伪装切换成功。

这是**版本切换/联调准入未完成**，不是旧测试网绑定本身导致的资金漏洞。处理方式：从验证后的目标部署资料统一生成前后端身份、事件源、codehash、起始块和 capability；保留旧 release 归档。若要本地端到端测试，也要提供隔离的本地部署身份，保留严格校验，而非直接绕过 chain/codehash 检查。

### B. Locker 后台执行已存在，但索引、API 与网站状态尚未接通

上一轮新增 `tools/locker-compounding/` 已支持 preview/execute/status、持久化交易和回执核对，不能再说完全没有复投执行器。但它是本地运维 CLI。

当前 `discoverF72MarketSources`（`packages/events/src/index.ts:186-204`）只发现 Token、Curve、Gauge，没有发现毕业后的 Locker。程序化事件清单检查确认 `LaunchLocker` 不在后端事件目录，虽能识别 Executor 的 `CompoundKeeperChanged`，仍没有各 Locker 的 `LockedFeesCollected/LockedFeesCompounded` 事件链路。Read API 无 Locker 状态路由；前端有生成 ABI，但没有真实的复投状态卡片/操作入口。

结果：网站无法完整展示待复投费用、最近成功回执、累计投入、失败原因及 Keeper 是否停用。建议按 `PoolGraduated` 发现 canonical Locker 并核对身份，补入事件索引、状态投影与只读 API，再接网站展示。写操作应继续受 Keeper 权限约束，不能给普通用户展示会必然权限失败的复投按钮；permissionless collect 可按产品需要提供。

### C. Holder 快照有生成与领取，但没有配套手动发布执行器

`services/backend-ts/scripts/holder-snapshot.ts:1-27` 提供 prepare、verify、preview、funding；明确不能签名或广播。`previewSnapshotPublication` 完成持久化资料、历史余额/总量、双 RPC、轮次/预算重查后，只输出 `publishSnapshots` calldata 和 `simulated_not_broadcast` 状态。

因此当前流程为：数据生成 → 发布预演 → **人工使用其他签名工具发送** → 后端索引 → 前端领取。没有像 Locker 工具一样配套的“持久化发布意图 → 签名 → 广播 → 确认回执 → 对账”入口。发布者直接通过钱包或 Safe 调用合约在技术上可行，但不能据此称后台发布闭环已经完成。

建议补齐手动单次发布执行器，绑定已验证的 dataset/dataHash/精确 calldata；网络超时保留原意图，确认根与预算后才标记 published。**不启用周期发布**，这与用户要求兼容。前端 `runtimeConfig.ts:118-121` 另有 snapshot claim release gate，部署与真实领取验收后才应开启，不能将 gate 当成缺陷直接取消。

### D. 治理/平台运维与文档尚未形成统一操作视图

合约存在 `claimPlatform`、`assetCoverage/coverAssetDeficit`、publisher 撤销、Keeper 轮换等入口；普通前端没有对应管理界面。这些不必都变成普通用户页面，但上线运行应明确对应 Safe/运维工具、状态监测和恢复步骤。当前没有发现一套覆盖上述操作的统一前端管理链路，不能将 ABI 覆盖视为业务覆盖。

`docs/backend/frontend-api-scope.md` 的“目标 release”段仍使用 2026-09-10 的 `0x5c2c...` 和旧 Holder stream 说明；代码已转为 `0x685b...` 并补充 wallet snapshot。该文件仍使用“当前”措辞，容易误导运行配置。应在下次版本切换时更新或明确标记历史记录，不用旧文档指导新部署。

## 逐项功能矩阵

| 合约业务 | 前端 | 后端/执行层 | 结论 |
| --- | --- | --- | --- |
| 创建、metadata、首次买入 | 上传/签名、配置、预演、创建后检查 | Content 流程、创建恢复、配置投影 | 源码基本对齐，仍受版本身份限制 |
| LP 0/0.1/0.2/0.3% | 开关、档位、确认页、lpFeeMode 探测与创建后核对 | 市场解码、canonical PoolKey、分析模块支持四档 | 已实现，不等同旧部署支持 |
| Base / Creator tax / LP 区分 | 交易与创建显示、协议费用检查 | 交易分析按 pool LP 配置验证 | 源码已对齐 |
| Curve 买卖与毕业 | Curve/Pool 路由切换、报价、最小到账、失败处理 | phase/source 投影、交易与 K 线 | 基本对齐 |
| V4 交易和空 Stake Gas | 先模拟，交给钱包发送，没有硬编码旧 4M Gas 下限 | 按事件与链上状态读取 | ABI 未变化，无需新增前端 Gas 常量 |
| Stake、正常退出 | 有实际 Stake/Claim/Unstake all 控件 | 本金/仓位投影读取实际状态 | 基本对齐 |
| 紧急退出 | 有交易处理，正常页面无控件 | 本金/仓位有读取 | 文档已说明不开放，产品覆盖尚缺 |
| 延迟奖励清理 | 有 `settleRageQuitRewards` 处理，无页面控件 | pending/cutoff 状态有读取 | 用户入口缺失 |
| Creator / Staker 领取 | 支持资产选择、验证和回执处理 | 领取/销毁历史、链上状态读取 | 基本对齐 |
| Creator 收益权交接 | propose/accept/cancel 处理均有，页面只有 claim | beneficiary/epoch 事件与投影 | 用户入口缺失 |
| Holder 数据及领取 | 轮次、proof、部分领取、分页、状态保护 | 数据生成、存储、投影、API 与预演 | 数据/领取齐，发布执行见 C |
| Locker 收费复投 | ABI 存在；无产品状态页 | 手动执行 CLI 已有，索引/API 未接 | 部分对齐，见 B |
| 销毁政策 | 创建时使用当前代币文案；领取/罚没按既定设计 | Meme burn / claim 事件处理 | 用户已接受政策，不重新列为缺陷 |
| 周期快照 | 无需按固定周期展示即将发布的承诺 | 未启用 | 用户要求，不计缺失 |
| 旧版本归档 | 保留兼容读取与 release 路由 | 当前 worker 固定 release | 新旧切换需一致的发布资料，见 A |

## 验证结果与边界

- 前端：**390 passed、0 failed/skipped**，包括生成 ABI/client、类型检查和业务测试。
- 后端：接口覆盖/生成产物/类型检查通过，**63 项 unit 通过**；test:contract 内 **10 项通过**。
- 连接本地 PostgreSQL 的集成测试：**11 passed、0 failed/skipped**，覆盖队列/数据库权限、索引与重组、内容、本金、历史、分析和 Holder snapshot worker。
- 事件与前端 ABI 的程序化清单保存在 `evidence/frontend-backend-alignment-2026-09-13/capability-inventory.json`，确认 Locker 是“有 ABI、无后端事件模块”。
- 数据库集成测试使用测试构造的 RPC/事件，不能当成浏览器钱包、真实最新部署、生产 API 同时运行的端到端联调。本轮没有声称已完成该类联调或验证 Vercel 在线实例。

建议顺序：先补普通用户操作控件并统一最新部署身份及本地联调配置，再补 Locker 索引/API/页面与 Holder 手动发布执行器，最后跑从浏览器签名到事件入库、API、页面更新的完整验收。治理工具、文档和告警作为运行配套补齐。现有单元/集成测试没有验证这些页面控件的可达性，测试通过不抵消上述缺口。
