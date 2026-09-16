# 前后端生产发布准备

日期：2026-09-16（北京时间）。状态：`NOT_PRODUCTION_READY`，本轮未发布生产、未发送链上交易、未启动生产 Worker。

沿用现有 VPS PostgreSQL、持久队列和 MinIO，不迁移托管服务。生产与测试使用独立数据库、存储卷、队列、凭据和服务配置。LP 链上复投能力保留；链下暂不安排自动复投。

## 本轮完成

- 后端增加独立部署配置：生产进程绑定 Robinhood 主网 4663；测试进程仍绑定 46630。事件、配置、本金与统计投影、Content 签名域、Holder 操作工具和 Relay 随部署选择地址与链身份；环境不一致时报错。
- 通过已有 Alchemy 主网 RPC 重新读取 34 笔部署回执、22 个模块激活区块代码，以及 392 条配置（194 个 Stock、196 个 Quote、1 个 Baseline、1 个 Template）。激活区块为 63094312，Factory 为 `0x5ebc1c14dc10aac61a1d1e59b2618ab1f4c3de9c`。生产模板将 `TG_RPC_VERIFICATION_MODE=single`，由 `TG_RPC_URL` 作为唯一端点；同一提供商的重复读取仍保留作为一致性检查，不构成独立共识来源。
- 冻结公开主网配置到 `services/backend-ts/packages/runtime-deployment/src/production.generated.ts`，提供前端地址模板和生产 resident Worker 模板。
- 主网价格路径按最多 64 项分批读取 Stock 参考价格，不使用测试网池子。报价异常保留缺失状态；不构造零值；USDG 后续按用户确认改为固定 1 美元展示估值。
- 修复无 Origin 请求污染允许来源的 CDN 响应缓存风险；补齐 Stats 失败状态；改善 Create 同步提示；Stake 统计按当前链校验并隔离缓存。

## 验证证据

本地证据目录：`outputs/production-prep-20260916/`（忽略提交，包含内部验收日志）。

| 验证 | 结果 |
| --- | --- |
| 前端完整测试 | 471/471，通过，含主网统计隔离用例 |
| 后端完整测试 | 99/99，通过，含类型、生成物和打包检查 |
| PostgreSQL 集成测试 | 27/27，通过，无跳过；本地临时数据库已停止 |
| Relay 测试 | 7/7，通过，含主网/测试网交叉身份拒绝 |
| 前后端构建 | 通过，另以主网地址配置构建前端，资源预算通过 |
| Stats 浏览器组件状态 | 空数据、失败、正常数据与筛选切换通过 |
| 主网冻结配置对照 | 与本次回执、代码和配置快照一致 |

这些是源码、本地构建和只读链验证结果。新增改动尚未部署到测试别名，也未完成真实钱包交易端到端验收，不代表线上已验收。

## 发布前尚需完成

1. **异机备份与恢复演练。** 用户尚无独立备份资源。现有备份/恢复脚本不能替代异机存储；在同一 VPS 复制数据无法覆盖整机故障。生产数据库/对象存储继续留在 VPS，不妨碍另行接入独立备份。备份目的地、保留周期、恢复时间与可接受数据损失仍待落实。
2. **报价部署环境验收待完成。** Stock 两项过滤问题已修复，194/194 最新样本可用。按用户确认，USDG 采用固定 1 美元展示估值，来源标记为 fixed_usd，不再请求 Coinbase/Kraken 的 USDG 报价；不是实时市场价，也不用于链上成交或结算。ETH 仍使用外部报价。Vercel 的刷新、存储、API 和页面显示全链路仍需验收。
3. **测试环境回归。** 将本轮变更提交到 test，再发布四个测试服务及匹配的 VPS 程序。清理/等待旧价格缓存后，验证浏览器 CORS、Create 同步恢复、Stats 异常与恢复。此前测试环境缺少 Stock/Growing/Bloomed 业务样本，真实 Create、买卖、Stake/退出、Claim 交易闭环仍需专用测试钱包和资产。未验收时不得填写 Holder 的 deployed-E2E approval 标志。
4. **生产部署配置与运维验收。** 生产容器和 Worker 尚未运行。需要受保护的生产 RPC/数据库/队列/存储配置、生产域名允许列表、实际连接预算与角色硬上限、迁移版本及镜像摘要验收。现有 VPS 为 4 GB 内存且无 swap，不能将本地 20,000 项目测试当作同机生产容量证明。

不重新索取用户已确认的管理员地址或自验材料。当前应补充的是独立备份资源；真实交易验收仍需专用测试条件。第二套 RPC 资源本轮不请求。

## 发布顺序与回滚

1. 冻结本轮 test commit，完成测试别名与真实业务回归；将验收过的相同产品树提升到 master。禁止从 codex/* 或 test 发布生产。
2. 在启用生产服务前生成并恢复验证数据库/对象存储备份，记录数据库迁移版本、服务 commit、镜像 digest 和现有部署 ID。迁移先在隔离副本验证；不得默认反向执行数据库迁移。
3. 生产配置只注入目标服务；数据库、队列和存储先就绪，再迁移、初始化。用 Alchemy 单 RPC 完成历史覆盖、链/代码/回执/资金投影一致性及 fail-closed 检查后，才允许生产 Worker/Relay 消费任务；同一提供商的重复读取只作为一致性检查。
4. 每个组件发布前运行 `node tools/deployment-boundary.mjs production <web|read-api|pipeline|content> --source-only`；Vercel 构建第一步运行相同命令但不带 `--source-only`。
5. 所有 Vercel 部署显式传 `--regions sin1`。每个部署先运行 `node services/backend-ts/scripts/check-vercel-region.mjs <deployment-url-or-id>`；全部运行函数确认 sin1 后才能绑定/提升域名。
6. 先验证后端健康、链/合约身份、数据新鲜度、对象上传、队列积压、数据库连接和价格更新，再切换前端。价格刷新应短于 300 秒 TTL（建议每分钟），告警覆盖过期和持续失败。LP 不配置自动定时器。
7. 发布后验证六个页面、钱包网络切换、交易回执与最终性、刷新与异常态。异常时暂停新增任务/入口，恢复上一已验收 Web/API 部署；只有数据库兼容性确认后才回退后台程序。保留任务去重与链上回执，不重放已成功交易，不自动回滚链上状态。

## 重现主网只读核验

使用 Node 24，从受保护的现有环境加载 `ROBINHOOD_RPC_URL`，不要打印 URL：

```sh
node tools/prepare-production-runtime.mjs <已有生产执行证据目录> <新的快照输出路径>
node tools/check-production-runtime.mjs <新的快照输出路径>
```

第一步只读链并拒绝覆盖输出；第二步将新的链上配置与冻结源码比较。RPC 超时、历史状态缺失、部署回执或配置差异均需处理后再验收，不应通过修改冻结结果掩盖差异。

## Chainstack 历史记录

用户提供的端点仅保存在本地忽略目录的 0600 凭据文件，没有写入源码或配置到生产服务。本地与现有 VPS 只读探测结果一致：最新状态可用，归档请求被套餐权限拒绝。该 Chainstack Archive 权限问题属于历史验证记录，按用户决定不再作为当前生产准备阻塞项；本轮不请求第二套 RPC 资源。VPS 样本中最新区块/代码读取约 11–20 ms，仅为少量探测，不代表 SLA 或压力测试。Alchemy 是生产唯一 RPC；其重复读取仍必须保留链 ID、区块、代码、回执、最终性和资金安全检查，并在缺失或不一致时 fail closed。证据：`outputs/production-prep-20260916/chainstack-vps.json`、`chainstack-local.json`。

## Alchemy 单源策略验收

已实现 `TG_RPC_VERIFICATION_MODE=single`，仅允许显式 production/4663 使用。单源模式拒绝同时配置第二 RPC，避免混用；测试默认 dual 不变。Pipeline、resident Worker、Read API、Holder 快照与发布工具均使用同一策略。资金对账、区块和代码检查仍执行，同源重复读取不宣称独立核验。

`single-rpc-live.json` 确认 Alchemy 返回正确主网身份及激活区块哈希，输出 `verificationMode=single`、`providers=1`。新增测试覆盖配置冲突、错误链、读数变化、RPC 错误和无第二 RPC 的 Pipeline 就绪状态。后端 96 项与 PostgreSQL 集成 27 项通过；第二源不再是发布阻塞项。
