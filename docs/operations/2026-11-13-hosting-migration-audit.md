# 托管迁移完整性复查 — 2026-11-13

## 结论及范围

上一轮迁移存在遗漏，本次复查发现并修复了下列七组问题。修复后，原 Vercel 的前端、动态页面、RPC 代理、统一网关、Read API、Pipeline、Content、队列回调及定时任务均已由新加坡服务器承接。在部署清单、依赖检查和无资金动作的线上验证范围内，未发现剩余的 Vercel 执行依赖。

这不等于已经执行每一种真实业务交易。未签署钱包交易、创建市场、质押、领取、交易或发布新 IPFS 内容，也未做整机重启、故障注入或压力测试。BSC 原有分阶段开放限制保持不变；关闭的业务能力没有为本次验证而开启。

Vercel 计费关闭仍未完成：账户此前因欠费拒绝 Pro 降级。用户已明确要求先保持暂停、稍后处理账单。本次没有付款、恢复项目或修改订阅。项目停用不能证明订阅费、历史欠费或延迟出账为零。

## 本次发现与修复

| 问题 | 原因及修复 | 验证 |
| --- | --- | --- |
| BSC 有界 RPC 读取失败 | Web 对统一 API 的私网映射误入 RH Read API，绕过链路由。Web 改走私网网关；内部 RPC 配额接口保留直达 RH Read API 的独立路径 | RH/BSC 已知合约 `eth_getCode` 均返回 200；未知 BSC 地址正确返回 403 |
| BSC 价格接口返回 500 | Read API 缺少按请求触发价格刷新的目标和鉴权配置。补齐现有 Pipeline 的私网映射及匹配凭据 | 返回 200；81 条参考价格中 80 条可用，1 条因 `book_spread_exceeded` 明确不可用 |
| BSC 队列 SDK 可能调用外部 Upstash | 应用注入的配置未同步至 SDK 读取的 `process.env`，导致忽略私网 `QSTASH_URL`。统一注入，未设置的值删除而非写成字符串 `undefined` | 生产、测试、BSC 的 Pipeline/Content 共六条路径均用实际 SDK 投递并得到回调 200 |
| `www` 前端跨域请求被 API 拒绝 | `www` 页面来源不在 API 允许列表。入口改为保留路径和查询参数的主域名 301 跳转 | `www/explore?chain=bsc` 正确跳转至主域名 |
| 测试前端仍含旧 BSC Vercel 地址 | 旧测试构建未完整接受统一入口变更。增加可配置网关来源及测试链选择器，只在旧测试产品基线上重建路由变更 | 新构建无旧 Vercel/Alchemy 主机；测试链 46630 使用独立测试网关；不会回退至生产 BSC |
| 测试上传存储 CORS 仍允许旧 Vercel 来源 | MinIO 仅允许旧测试域名。更新声明配置与线上容器为 `https://test.tickergarden.com` | 签名 PUT 的预检 204，允许来源正确；签名读取不存在对象返回正确的 404 `NoSuchKey` |
| 迁出 Vercel 后请求代理信任语义不完整 | 补齐 Cloudflare 来源网段信任、可信客户端 IP，并覆盖 Web 转发的 Host/Proto，防止客户端伪造同源和限流身份 | 伪造转发 Host 请求返回 403；更换伪造客户端 IP 的无效地址批量请求仍触发 429，未进入链 RPC |

价格修复未给 BSC 新增定时刷新，也未修改展示 Worker。展示 Worker 继续使用原有持久化事件收件箱及事件/主动请求边界，没有新增扫块、补历史、追赶链头或价格触发链推进路径。生产 RPC 仍为 QuickNode，测试 RPC 供应商未改变。日志抽样没有发现展示 Worker 的 RPC 事件，但这只是有限时间窗口的观测。

## 功能验收清单

| 范围 | 实际检查及结果 |
| --- | --- |
| 前端及动态页面 | 首页、Explore、已有市场 Trade、Create、Stats、Stock Stats、Claim、Stake、Docs、Privacy、Terms、robots、sitemap 返回 200；不存在页面返回 404；生产/测试当前 JS/CSS 均可加载 |
| 三条链的 Read API | 4663、56、46630 的 health、市场、Explore bootstrap、展示统计、配置、更新与价格接口通过 |
| RPC 代理 | 三条链的 `eth_chainId` 正确；RH/BSC 范围内合约读取成功，范围外地址被拒绝；未广播交易 |
| 实时事件流 | 三条链收到 SSE ready；生产连接持续 35 秒并收到两次心跳，主动截断后的 curl 超时属于预期 |
| 内容鉴权 | 三个环境以合成地址申请上传 challenge，均返回 201，链 ID 和消息域名匹配；未签名上传请求被拒绝 |
| 存储及 IPFS 凭据 | 三环境的 S3 签名读取与 PUT 预检符合预期；Pinata 身份验证均 200。没有实际 PUT 或 IPFS 发布 |
| 持久队列及签名回调 | 六个真实 SDK 探针均经各自服务器队列送达并返回 200。探针使用不存在的 operationId，处理器在业务租约前退出，无业务执行 |
| 后台任务 | 13 个托管 systemd 服务均 enabled/active；9 个后端 `/internal/ready` 返回 200；6 个既有 Worker 及 5 个队列/事件中继容器保留私网 fetch 映射 |
| 定时任务 | 原外部十秒派发器及重复派发/价格定时器关闭；本地派发器先检查数据库到期任务；RH 每环境保留一个五分钟价格刷新所有者 |
| Vercel 停用 | API 枚举覆盖全部 8 个项目且无下一页：均 paused、Git 自动部署禁用、deny-all 防火墙生效；原 Pipeline/Content Cron 已禁用 |
| 源码依赖 | 精确部署源未发现 Vercel Blob/KV/Edge Config 存储依赖；保留的 Vercel SDK 辅助代码受运行时标志约束，服务器不启用这些标志；未映射的 Vercel fetch 失败关闭 |

队列中另有迁移前的失败记录：测试 26 条（最后发生于 9 月 15 日），BSC 2 条（11 月 1 日）。本次探针没有新死信。未擅自重放或清除历史记录。

## DNS、运行状态及边界

- 当前入口：`https://tickergarden.com`、`https://api.tickergarden.com`、`https://test.tickergarden.com`。DNS 继续由 Cloudflare 代理至 `159.89.207.161`，无需新增记录。
- 复查早期本地路由器仍返回旧 Vercel IP，公网 1.1.1.1/8.8.8.8 已正确。最后复测本地 DNS 也已更新；不指定 IP 的普通访问得到生产/测试/API 200、www 301。没有为解决缓存而恢复 Vercel。
- 服务器抽样：13 个托管服务运行，systemd failed 为 0；数据库、MinIO、事件中继健康；约 1.38 GB 可用内存、546 MB swap 占用，负载 0.63/0.66/0.81。不是容量保证。
- 新测试页面加载新的入口和应用 chunk。为兼容已经打开的页面，旧的不可变哈希资源暂时保留；这些旧文件的存在不代表当前新构建仍引用它们。
- 部分签名回调配置保留旧 HTTPS URL 身份，但连接由精确映射在服务器私网完成；不能仅搜索配置中的 `vercel.app` 字符串判断发生了外部请求。
- Web 诊断中的环境/发布标签仍可能沿用默认值；精确部署来源以服务器 release manifest 为准。该观测标签问题不影响功能路由，未来应补齐自动化发布元数据。

## 源码、验证与恢复材料

修复经独立工作树提交，再由 `test` 晋升到 `master`。没有上传主开发工作树或 BSC 工作树的其他未完成变更。原应用源码基线继续以 [上一轮迁移清单](2026-11-12-server-hosting-migration.md) 为准。

| 生产分支提交 | 内容 |
| --- | --- |
| `2c214910a3` | Web 私网链路由、BSC SDK 配置与配置校验 |
| `05a2808e5c` | 未设置环境值的处理 |
| `b6fcf1f432` | 可配置测试网关来源及 46630 选择器 |
| `907819c396` | 测试 MinIO CORS |
| `e909485bb4` | 将实际迁移后的 Caddy 路由及代理信任配置纳入版本控制 |

完成验证：799 个 Web 测试通过、Web typecheck 通过；6 个托管适配器测试通过；测试前端构建、资源预算、禁止索引 SEO、部署来源边界通过；13 服务配置校验通过；Caddy 校验通过；运行中的适配器、渲染器和 Caddy 内容与对应生产提交 SHA-256 匹配。Caddy 对显式转发头给出冗余提示，但这里有意覆盖来自受信代理的外部输入；安全探针确认了行为。

测试前端没有直接部署当前完整开发树：保持 `c74bc3b66fe844a511af46676d98638ed3b1f9de` 产品基线，只应用 `b6fcf1f432` 的路由代码和两个生成配置中的来源字面值，合约地址与 ABI 不变。服务器 `sources/test-web/hosting-audit-source.json` 记录了这一组合及构建验证。

权威托管配置仍是 `/etc/tickergarden/hosting.json`（root，0600）。生成的运行配置不是第二个手工配置源。活动部署根为 `/opt/tickergarden-hosting/releases/20261112`，其中 `release-manifest.json` 记录本次补丁、测试构建来源及运行文件校验和。

回滚材料保存在 `/etc/tickergarden/hosting-audit-backup-20261113`，包括修改前配置/适配器/Caddy，以及测试 MinIO 重建前的容器快照。旧测试 MinIO 容器已停止并保留，数据卷未更换。

本次完整托管备份为 `/var/backups/tickergarden-hosting/hosting-20261113-migration-audit.tar.gz`（root，0600），包含当前配置、应用源码/构建、适配器、manifest、Caddy、systemd/drop-in、Compose 覆盖配置及容器重建信息；不包含 node_modules 和日志。它是服务器本地恢复包，不是异地备份；数据库继续沿用已有备份任务。不得并行启动新旧派发器，也不得把回滚理解为自动恢复 Vercel。

代理 IP 配置依据 [Caddy trusted proxies 文档](https://caddyserver.com/docs/caddyfile/options#trusted-proxies) 及 [Cloudflare IPv4](https://www.cloudflare.com/ips-v4)、[IPv6](https://www.cloudflare.com/ips-v6) 官方列表；以后更新网段时需验证并同步版本库与活动配置。
