# TickerGarden V1 测试网回滚与事件处置清单

适用执行规范：`V1-EXEC-11`
目标网络：Robinhood Chain Testnet（chain ID `46630`）
配套部署手册：[`V1_TESTNET_DEPLOYMENT_RUNBOOK.md`](./V1_TESTNET_DEPLOYMENT_RUNBOOK.md)

V1 的“回滚”不是升级旧合约。runtime、市场和毕业后的 v4 仓位均不可升级或回收，因此处置方式是：在原子边界内重试、在激活前废弃 release、暂停/退休可配置入口、保护用户退出，并用新的 release/config ID 修正。

## 1. 全局停止条件

出现以下任一情况，立即停止后续阶段：

- chain ID、block hash、依赖地址、runtime codehash 或 PositionManager 绑定不一致；
- preview 地址、salt、Hook mask、payload hash 与签署包不一致；
- 模拟与广播 calldata 不一致；
- Foundry 输出未知交易、nonce 跳变或 gas 超过批准上限；
- runtime graph 任一地址没有代码或构造绑定错误；
- AccessManager selector、角色、成员、延迟或 receipt diff 不一致；
- Safe、Treasury、Root service、fee policy 或时间参数未签署；
- 测试 Stock 被误描述为官方 Stock，或身份/proxy/codehash 证据不完整；
- 私钥、RPC 凭证或签署文件疑似泄漏。

立即动作：停止广播或 Safe 执行、锁住前端资金入口、保存原始回执与日志、`unset DEPLOYER_PRIVATE_KEY`，并记录最后一个已确认区块和交易。

## 2. 分阶段处置矩阵

| 阶段 | 链上状态 | 可恢复动作 | 禁止动作 |
| --- | --- | --- | --- |
| 广播前 | 无交易 | 修正输入，重新 preview、模拟、签署 | 沿用旧签署或旧 payload hash |
| Orchestrator 已部署，graph 交易失败 | 只有已验证的 Orchestrator；第二笔原子回滚，无部分 graph | 输入完全不变时，可用同一 release 重试 graph；先确认 Orchestrator authorizer/release ID | 将部分地址手工补齐；修改配置后复用 release ID |
| runtime graph 成功、未激活 | immutable graph 已存在 | 标记 release `ABANDONED_BEFORE_ACTIVATION`，关闭前端，使用新 release ID 重新部署 | selfdestruct、upgrade、覆盖地址、把旧 release 宣称为有效 |
| AccessManager 部分配置、未放弃 bootstrap admin | 部分 selector/role 已写入 | 停止，按已确认 receipts 重建 exact state diff；只执行缺失且确定幂等/可验证的动作 | 盲目重放整个计划；提前 renounce deployer |
| bootstrap admin 已放弃 | 全局 admin surface 永久冻结 | 仅按既定 role admin/guardian 和延迟规则治理；必要时废弃 release | 恢复 deployer admin；绕过 AccessManager |
| Registry 已配置、尚无市场 | 追加式配置存在 | guardian pause；治理 retire；创建新 ID 修正后再延迟 unpause | 删除或原位覆盖旧配置；伪造原 evidence hash |
| 市场已创建 | 自主市场永久存在 | pause/retire 上游配置以阻止新增市场/敞口；保留正常退出和 rageQuit | owner 终止、冻结、救援、转移市场资产或指定接收人 |
| v4 graduation 已完成 | Pool、Locker、永久 LP custody 已形成 | 只观察和按协议结算；对新配置止损 | 撤销池、取回 LP、collect/compound LP fee、救援 Locker 资产 |
| Treasury Root/claim 异常 | 可能有 pending root 或 claim liability | 停止 Root worker/前端；Reviewer 在 review delay 内 cancel；使用 timeout/refund/rollover 路径 | 任意抽走用户负债；绕过 committed root |

## 3. Orchestrator 与原子 graph

### 3.1 第一笔交易失败

- 没有 Orchestrator 时，不存在 release graph 状态。
- 修复 RPC、gas 或 nonce 后必须重新运行无密钥 preview 和无广播模拟。
- 地址、salt、payload hash 任一变化都需要新签署。

### 3.2 Orchestrator 成功、第二笔 graph 失败

第二笔 `orchestrator.deploy(payload, payloadHash)` 是原子交易。交易 revert 时，16 个普通组件、helper、Hook、Executor、Factory 不会留下部分成功状态。

重试前检查：

- Orchestrator 地址有代码；
- `authorizer == V1_EXPECTED_DEPLOYER`；
- `releaseId == V1_RELEASE_ID`；
- `completed == false`；
- 外部依赖和所有输入与原签署完全一致。

全部满足时可重试同一 graph，预测地址保持不变。任何输入改变时，旧 release 记为 `ABANDONED`，使用新的 `V1_RELEASE_ID`。

### 3.3 graph 已成功

`completed=true` 后不允许第二次部署。若地址、codehash、binding 或 source verification 有误：

1. 不激活 Registry；
2. 不执行角色移交；
3. 不创建市场；
4. 标记 release `ABANDONED_BEFORE_ACTIVATION`；
5. 记录原因、交易、区块、代码哈希和影响面；
6. 修复后用新 release ID 完整重走七个技术 gate 与部署流程。

## 4. AccessManager 部分失败

AccessManager 计划必须按五个 phase 顺序执行。某笔失败时：

1. 从最后 finalized block 读取每个 target selector 的 role、每个角色 admin/guardian、成员和 execution delay；
2. 用实际成功 receipt 重建差异，不依赖 Safe UI 的 pending 状态；
3. 保留 bootstrap deployer 的 `ADMIN_ROLE`，直到全部 exact diff 验证完成；
4. 只提交缺失动作，并再次模拟；
5. 最后单独执行 `RENOUNCE_DEPLOYER`。

若部署者已经 renounce，则不存在恢复全局 admin 的回滚路径。只能使用冻结后的 `PROTOCOL_ADMIN_ROLE`、`PAUSE_GUARDIAN_ROLE`、`UNPAUSE_ROLE`、`ROOT_PUBLISHER_ROLE`、`ROOT_REVIEW_ROLE` 及其延迟/guardian 关系；无法通过这些角色安全修复时，废弃 release。

## 5. Registry、Quote 与 Stock 身份异常

配置是追加式的，不能删除或原位重写：

- `pauseAsset`、Quote pause、Pons baseline pause、Launch template pause：阻止新增敞口；
- `retire`：永久停止对应配置的新使用；
- 修正参数使用新的 typed config ID 和 evidence hash；
- 已存在市场保持自主，不受 owner 级市场终止或救援。

Robinhood Stock Beacon implementation 漂移时：

1. Guardian 立即 `pauseAsset`；
2. 固定新 implementation 地址、codehash、beacon 证据和行为审计；
3. 通过 48 小时治理 `acceptAssetImplementation`；
4. 等待规定的 unpause 延迟并重新 live preflight；
5. 由授权角色 `unpauseAsset`。

token 地址、beacon 地址或 beacon runtime codehash 漂移不能原位接受；必须 retire 旧准入并创建新的 Asset/Quote 配置。

## 6. 市场、用户退出与手续费

已发布市场没有 owner-only pause、termination、rescue 或市场资产接收人。即使市场异常，也不得增加临时后门。

- 正常退出：遵循 24 小时和收益结算规则。
- `rageQuit`：任意用户可立即取回全部可归属质押本金，放弃所有未领取收益；放弃收益全部进入 platform forfeiture reserve，不重新分配给 Active staker。
- 任何用户的 `rageQuit` 不会终止市场，也不会影响其他用户的正常业务。
- Stock allocation 只允许增加或完整提取，不提供 allocation 减仓操作。

若发现资金或会计异常：暂停对应 Asset/Quote/Template 的新增入口，停用前端相关操作，保留链上正常退出与 rageQuit；不要冻结既有市场。

## 7. Graduation、Pool 与 Locker

Graduation 在满足阈值的最后一笔 buy 中原子完成。建池、添加流动性、永久锁定 Position NFT 任一步失败，整笔 final buy 回滚，不存在需要 owner 人工补建的半毕业状态。

成功毕业后：

- PoolKey、PoolId、Hook、Position NFT custody 永久确定；
- LP fee 必须为 `0`；
- Locker 无 collect、compound、withdraw、rescue 或 owner beneficiary；
- 不存在 rollback 到 bonding curve 的路径。

处置只能针对新市场的 Registry 配置和前端入口；已毕业池保持链上自主。

## 8. Treasury 处置

Treasury 异常时先停止链下 Root publisher worker 和资金敏感前端入口。链上使用既定状态机：

- pending root 在 review delay 内由独立 Reviewer cancel；
- 已 committed liability 按 claim、timeout、refund 或 rollover 规则处理；
- Root Publisher 与 Root Reviewer 不得由同一 Safe 或核心治理 Safe 兼任；
- 不得增加“紧急提走所有资产”的任意救援方法。

若 Root signing key 或服务信任根失陷，停止发布、取消仍可取消的 root、轮换对应 Safe/服务密钥，并为无法在既定权限内修复的情况发布新的 execution spec；不得把服务端补丁当成链上责任回滚。

## 9. 密钥或角色事件

### 部署者私钥疑似泄漏

- 立即停止部署；清除 shell 环境并轮换账户。
- 若尚未部署：废弃预期 deployer 和所有预测地址，生成新 release ID。
- 若 Orchestrator 已部署但 graph 未完成：不得让新账户接管旧 authorizer；废弃 release。
- 若角色移交完成且 deployer 已 renounce：确认其没有 V1 role 或 admin 权限，并撤销前端/服务端残余凭证。

### Safe 或长期角色疑似泄漏

- 使用已冻结的 guardian/admin 关系和执行延迟进行轮换；先模拟，再提交 Safe 交易。
- Guardian 可暂停 Registry 新增入口，但不能冻结既有市场。
- 记录旧/新成员、proposal、签名人、execution block 与 exact permission diff。

## 10. 证据与恢复完成条件

每次异常都必须产生不可变事件记录，至少包含：

- release ID、commit、execution spec；
- chain ID、最后确认 block number/hash；
- 成功、失败和 replacement 交易哈希；
- preview 与实际地址/payload hash；
- 受影响的 module/config/market/user 范围；
- 已执行的 pause/retire/cancel/rageQuit 支持动作；
- 是否废弃 release，以及 replacement release ID；
- 私钥/RPC 凭证未进入记录的确认；
- Reviewer 和 Governance 的签署结论。

只有以下条件全部满足，事件才可关闭：

- 没有未知的链上部分状态；
- 所有资金敏感前端和 worker 状态与链上状态一致；
- 用户本金退出路径仍可用，或已明确记录不可恢复的链上原因；
- 旧 release/config 被明确标记为 active、paused、retired 或 abandoned，不能含糊；
- replacement release/config 重新通过适用的生成物、ABI、permission、Fork/E2E 和 live preflight；
- 对外状态仍准确区分 `DEPLOYMENT_ELIGIBLE`、实际 testnet deployment 与 `PRODUCTION_READY`。
