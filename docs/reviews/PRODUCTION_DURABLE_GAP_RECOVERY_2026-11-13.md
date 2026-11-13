# 生产持久化事件缺口恢复 — 2026-11-13

已修复可由现有持久化记录证明的投递缺口，并完成生产验证。**这不等于证明断线期间的链上事件完整：两条链均保留 `unverified`、`synchronized=false`。**

恢复执行时间：2026-11-13 12:06:35–12:06:39 北京时间。验证完成于 12:07:36。测试环境、前端和 Vercel 没有发布变更。

## 发现与恢复结果

| 项目 | Robinhood 4663 | BSC 56 |
|---|---:|---:|
| Relay 持久化事件 | 8 | 1 |
| 恢复前展示 inbox | 0 | 1 |
| 恢复前已处理确认 | 0 | 1 |
| 本次恢复 inbox | 8 | 0 |
| 本次补齐处理确认 | 8 | 0 |
| 恢复后 inbox / 已确认 | 8 / 8 | 1 / 1 |
| 恢复后待处理 | 0 | 0 |
| 恢复审计记录 | 1 | 1 |
| 链游标变化 | 无 | 无 |
| 覆盖状态 | unverified | unverified |

RH 的 8 条旧事件已经存在于 Relay，也已包含在数据库 canonical、finalized 日志和持久化 analytics 基线中，展示 inbox 尚未保存对应记录。BSC 的 1 条记录已确认处理，没有可重放的积压。原 `gap` 原因均为 `upstream-recovery-required`，由重连记录触发，不能单独证明具体链上事件丢失。

本次逐条匹配 environment、chain ID、deployment digest、block number/hash、transaction hash/index、log index、address、data 和 topics。只恢复事件记录及其已被最终基线包含的确认，不重新执行财务事件、不推进游标、不重建历史。RH 的原展示游标保持 `103624520`；analytics 基线保持 `109907167`。BSC 两者保持 `131638020`。

## 发布的修复

1. RH Relay 在交付已封装的持久化批次前，必须先确保该批次的展示 inbox 已写入。跨库写入失败会阻止该次交付并沿既有重试路径恢复，不依赖再次收到 WebSocket 通知。最多处理该具体批次的 256 条记录，完整验证后才开始写入。重复投递由原事件主键去重。
2. 增加显式运维恢复命令 `scripts/reconcile-display-events.ts`：默认只读生成计划；写入必须提供与当前证据匹配的计划摘要。只读取既有 Relay 记录，单次最多 1000 条，不接受 RPC 客户端或链头参数，不运行定时任务。
3. 写入前重新核对来源摘要、inbox 状态、缺口状态与基线，使用事务、锁和最终化证据保护。内容冲突、事务位置不符或计划漂移会拒绝执行。移除事件、未处理事件或其他具体处理故障仍保留 `gap`，不能被本工具清除。
4. `0038_display_recovery` 增加恢复审计记录，并允许明确的 `unverified` 状态，仍不允许写入 `synced`。审计记录保留原缺口原因、时间、来源摘要、计划摘要、恢复数量和执行结果。
5. 恢复工具复用现有数据库连接实现及权威配置中的 CA/客户端证书，保留 TLS 证书和主机验证。每个数据库池最多 1 个连接；凭据只通过服务器内存和 stdin 传递。

API 与 Worker 现均表达 `reason=recorded-events-reconciled-upstream-unverified`。这表示“截至本次快照，已保存的事件记录已核对完成”，不表示“订阅未收到的事件不存在”。原缺口记录已进入审计结果，没有无证据删除。

## 生产验收

- 两条链 Read API、Display Worker 与 Relay 健康接口正常；Relay pending/dead 为 0，快照可读取，展示待处理事件为 0，无当前错误。
- 额外检查未发现超过现有 analytics 基线的 canonical 区块或日志，两条链也没有活跃业务作业；现有数据库中没有另一批超过该基线的日志可继续恢复。
- 12:01:31–12:07:36 发布和恢复观察窗口，两条展示 Worker 的实际 RPC 请求和 `rpc_call` 日志均为 0；恢复工具本身没有 RPC 路径。
- 恢复前后 projection checkpoints、confirmed display cursor、display event coverage 的快照逐项相等。
- 两次恢复分别原子写入审计记录；没有重新提交 Relay 回调、修改结算账本或广播交易。
- 测试容器 ID、测试服务 PID 和配置保持不变。没有 failed systemd units。

## 回归验证

- RH 后端：261 项单元测试通过，1 项不适用默认 testnet fixture 的 mainnet 价格用例跳过；已有打包/生成检查通过。完整集成集共 71 项：首次 69 通过、1 跳过、1 因并行数据库负载触发语句超时；该 analytics 用例随后单独重跑通过，未修改超时设置或产品代码。
- BSC：262 项单元测试、25 项 Holder 测试通过；完整集成 24 通过、1 项 opt-in 容量用例跳过。
- RH Relay 15 项通过。新增真实数据库恢复测试覆盖幂等、计划漂移、证据冲突、事务位置、inbox 列与 payload 不一致、移除事件及保持未同步状态。
- 两条 Worker 的真实进程测试验证：空闲、价格通知、断线、gap 持久化及恢复后重启，均为零 RPC。恢复后的状态为 `unverified`，并非 `synced`。
- TLS 运维入口修正后两套后端 TypeScript 检查通过，生产只读计划及实际事务均成功。

## 来源、备份与边界

主仓库运行时提交 `382e46a397b69995e44bec6f7c1262ccff695268`；恢复工具 TLS 补丁 `4ef171db17`。
BSC 运行时提交 `df8a1501e3b36193b307507c9b2d955a9a708db2`；TLS 补丁 `83d3a40`。
所有产品提交均通过 `test → master` 晋升并检查生产来源边界。只替换核对过摘要的相关文件和 RH Relay 镜像；未发布 codex 分支。

备份：`/opt/tickergarden-hosting/releases/20261112/backups/durable-gap-recovery-20261113T040131Z`。其中包含变更前事件表数据、配置、相关源文件、镜像信息及恢复计划/结果。回滚程序代码时保留已恢复事件和审计证据；不要自动删除这些记录。

初次只读预检暴露容器 DNS 与数据库 TLS 适配问题，均在恢复数据写入之前修正，没有放宽数据库认证或关闭证书校验。

**仍未解决的证据边界：**断线期间从未进入任何持久化存储的事件，无法仅靠现有记录证明是否存在或恢复。没有逐区块完整性证明、可重放上游日志或明确缺失事件身份时，必须继续保持未核验状态。本次没有给展示 Worker 增加扫块、补历史、追赶链头或自主 RPC 恢复逻辑。未来若再次断线，系统仍会保守记录新 gap，不能用本次审计覆盖未来断线。

证据：[恢复计划](evidence/2026-11-13-durable-gap-recovery/production-plan.json)、[执行结果](evidence/2026-11-13-durable-gap-recovery/production-applied.json)、[生产验收](evidence/2026-11-13-durable-gap-recovery/verification.json)、[日志逐条匹配](evidence/2026-11-13-durable-gap-recovery/matches.json)。
