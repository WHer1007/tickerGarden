# 生产配置与初始化验收（2026-09-16）

状态：基础设施与激活区块配置初始化已完成；尚未完成生产应用发布验收。Content 的生产 Pinata 凭据待提供，生产历史回填与持续消费尚未启动。

## 已完成

- VPS 生产 PostgreSQL、队列服务、MinIO 启动并通过健康检查；没有启动生产链 Worker、链事件 Relay 或 LP 自动复投任务。
- PostgreSQL 已应用全部 18 个迁移，业务角色为非超级用户。连接上限分别为 Read API 26、Pipeline 14、Content 4、Queue 8；总体预算 52，保留 20，余量 28（数据库最大连接数 100）。
- 三个应用角色均通过实际 TLS 连接测试。Vercel 使用加密变量 `TG_DB_CA_PEM` 提供可信 PEM 证书；对应数据库 URL 不携带 `ssl*` 参数。代码保持证书链与目标主机校验，不关闭 TLS 验证。证书有效期至 2028-12-14，届时需要更新可信证书。
- 测试与生产数据库密码、队列签名/发布凭据、对象存储凭据及 bucket 均核实不同。
- MinIO 签名上传返回 200，读取内容校验通过，有独立对象版本，匿名读取返回 403。保留一个无敏感信息的 `initialization/20260916-storage-check.txt` 验收对象。
- 四个 Vercel 项目的 Production 变量已分别写入并回读逐项校验：Web 14 项、Read API 12 项、Pipeline 24 项、Content 26 项。没有修改 Preview 变量、发布 Vercel deployment 或切换 alias。`sin1` 配置已准备；实际生产函数区域仍需在部署后验收。
- 生产配置为 Robinhood Mainnet 4663，显式信任单一 Alchemy RPC。USDG 固定 1 美元规则来自已验收源码，LP 复投继续由运营按需触发。
- 主网 genesis、激活区块及 17 个固定事件来源的字节码身份已通过 RPC 核验；已写入生产部署及事件来源记录。
- 使用既有 ingestion 和 projection 实现，核验并摄取激活区块 `63094312`（9 条事件），发布 392 条初始配置：194 个 Stock、196 个 Quote、1 个 Baseline、1 个 Template。此记录只证明激活区块状态，**不代表最新链高同步完成**。

## 备份与验证

启动前保留原有 PG/MinIO volume 的离线备份，未删除或重建原有 volume。初始化后生成逻辑备份，在独立临时数据库完整恢复并核实 18 个迁移，随后删除临时数据库。

- 备份目录：VPS `/var/backups/tickergarden/production/`，备份文件权限 0600。
- 最终逻辑备份：`post-init-20260916.dump`，SHA-256 `1a57ec5e49d8d8bb60434425c3be4193be0851aecaeacc08b7871846e6e12024`。
- 该验证是同机恢复演练；尚无异机存储资源，不能据此宣称具备 VPS 整机故障恢复能力。
- 后端完整 `npm test` 通过，包含生成物/接口检查、类型检查及 100 个单元测试；环境边界测试 20 个通过。
- 本次修复生产 backend 边界将 `TG_ENVIRONMENT=production` 误与分支名 `master` 比较的问题；仍要求生产源码来自 `master`。
- 本次补齐显式数据库 CA 支持，并实测修复 pg 对 IP 连接错误按 `localhost` 校验的问题。

## 发布前剩余条件

1. 提供生产专用 `PINATA_JWT`；如启用 group 限制，同时提供对应 `PINATA_GROUP_ID`。当前没有复用测试凭据。Content 的完整 ready 与 IPFS 上传验收仍未通过。
2. 将本次配置兼容修复纳入测试环境验收，然后将接受的产品树从 `test` 推进至 `master`。当前分支存在分歧，不应直接覆盖或跳过对齐。
3. 从合规源码版本完成生产应用部署与区域验收，再启动生产链 Worker/Relay，完成历史回填、价格刷新及各投影检查后切换入口。不得将当前激活区块初始化视为这一环节完成。
4. 执行生产用户业务验收。当前没有发送主网交易、使用签名私钥或广播合约变更。

无密钥验收记录在本地 `outputs/production-init-20260916/`。其中另有权限受限、被 Git 忽略的配置文件，整个目录不可直接分享或提交；仅分享已脱敏报告/验收结果。
