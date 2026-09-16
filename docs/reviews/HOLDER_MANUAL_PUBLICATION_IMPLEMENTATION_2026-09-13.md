# Holder 手动发布与前端业务边界落地

日期：2026-09-13。完成代码、文档和本地验证；未部署、未向 RH 广播、未配置真实签名者、未启用周期任务。

## 用户确认的产品范围

| 业务 | 本次结果 |
| --- | --- |
| Creator 收益权交接 | 前端不提供入口；文档说明通过邮件或公开联系渠道申请。申请不绕过链上权限，原受益人提名、新受益人接受仍须完成。 |
| 紧急退出 | 前端不提供入口；文档说明用户通过外部已验证合约接口调用，并保留罚没规则说明。 |
| LP 复投 | 前端仅说明机制、Keeper 可选执行、无自动兑换以及尚未启用周期执行。 |
| Holder 快照发布 | 新增手动签名发布、持久化交易意图、无需私钥的回执对账和本地状态查询。 |

前端变更集中于 `apps/web/src/pages/docs.ts`，未增加上述操作按钮。此次没有改动生产合约：与上次 LP/Gas 实现的源码指纹比较，70 个 `contracts/src/v1` 文件完全一致。

## 使用与行为

完整配置与恢复步骤见 [操作手册](../operations/HOLDER_SNAPSHOT_BACKEND.md)。仓库根目录命令：

```sh
npm run holder:snapshot -- publish /absolute/path/dataset.json
npm run holder:snapshot -- reconcile /absolute/path/dataset.json
npm run holder:snapshot -- status
```

仅 `publish` 会加载受保护的 EOA 签名文件并广播；适用当前已绑定的 RH 测试 release、chain 46630。需要配置真实发布者、两个 RPC、数据库、持久状态目录和明确的单笔 Gas 成本上限后才能运行。工具不自动授权 publisher，也不自动切换至未部署的新合约。

发布重用既有数据集归档和双 RPC 预验，核对历史余额、预算、链身份、部署身份及当前轮次。签署后再次解码核对，先将完整签名意图原子写入私有 journal 并 fsync，再发送原文。同链同发布者串行执行；发送不确定时保留原文，重试不生成第二笔业务交易。专用 PublicationRpcTransport 允许签名原文广播，原索引器 RpcTransport 仍保持只读。

对账核对双 RPC 回执、规范区块、确认深度、时间阈值以及完整发布事件。当前测试 CLI 至少等待 2 个确认和 600 秒，未满足时返回 confirming，之后手动再次对账。成功只更新运维 journal；公开 API 仍由正常确认索引驱动，不能用广播成功代替已确认轮次。

合约没有发布 deadline。300 秒后停止主动重发不等于撤销已广播签名；未决 nonce 必须对账后处理，不能删除 journal 作为取消操作。当前锁适用于共用持久目录的单机操作者，不宣称多机或 Serverless signer 协调能力。

## 验证结果与边界

证据目录：[holder-manual-publication-2026-09-13](evidence/holder-manual-publication-2026-09-13/)。

- 后端完整检查通过：生成物检查、打包边界检查、API 合约测试 10 项、类型检查、单元测试 74 项；后端构建通过。
- 新发布工具专项测试 11 项通过，覆盖实际签名恢复、保存失败禁止发送、超时重试、nonce 冲突、成本上限、过期意图、重组、回执不一致、事件错误、状态锁、权限与广播 transport 边界。最后补充外部 pending nonce 场景后重跑专项测试与类型检查通过。
- 前端 390 项测试和构建通过；仅有既有构建体积警告。
- 真实本地 PostgreSQL 集成测试 11 项通过，临时 schema 清理完成。
- 专属本地 Anvil 完成真实 Distributor/Token/AccessManager 签名发布，首次返回 pending；重载磁盘 journal 后无需签名者对账得到 confirmed；领取预演得到预期 1 ETH 等值 Quote 测试单位。测试节点已停止。
- 本地交易：`0x24d1604e2098cec95fff500a11988abb9adb9e39ab5df0378c950abd0a618b6e`。该值仅是本地测试证据。
- 本地合约测试使用 Registry/Vault/Hook/时钟及 preflight 适配，两个 transport 指向同一个本地节点；不是独立公共 RPC 或 RH 全链路验收。生产 CLI 不暴露 preflight 替换入口。真实数据库和生产 preflight 的测试证据独立提供。
- `git diff --check` 通过。生产合约源码未变，因此本次不重新声称完成新的 RH Fork 或线上部署验收。

本次不包含旧审查中其他未获指示的功能扩展，也没有提交或覆盖工作区此前的改动。
