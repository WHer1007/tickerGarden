# 日志、未知错误捕获及 Lark 告警审查

日期：2026-09-18（Asia/Shanghai）。审查产品版本：test `5445419869574d438e6460178aa0e3e7c49a9990`，production `2c100f544a644bfdc1b5b392eabfa0df3d2e0669`，产品树一致。

## 结论

现有体系能看到部分请求失败、任务重试和同步状态，但**不能保证用户未知错误自动到达后台，也不能普遍定位根因**。不是完全没有日志：HTTP 请求有结构化日志和 requestId，任务有持久重试记录，部分 RPC 有计量，Launch 有本地诊断。不过这些尚未形成统一错误收集、跨服务关联、集中留存、主动通知的闭环。

本次仅审查、只读线上检查及本地故障注入；未修改业务代码、生产配置、部署、签名或发送 Lark 消息。旧 Go monitoring 目录不能作为当前 TypeScript 生产服务已启用监控的证据。

## 已有能力与缺口

| 链路 | 已有能力 | 关键缺口 |
| --- | --- | --- |
| 浏览器启动/路由 | 导入失败有用户重试提示 | 没有全局 error/unhandledrejection 上报，资源加载失败也没有统一采集 |
| Launch | 分类、阶段、operation、reference、fingerprint、是否可能待确认；本地最多20条 | 只写浏览器存储，后台收不到；没有代码版本、后端请求ID及统一远端错误事件 |
| Trade / Claim / Stake | 用户语言的错误映射、交易结果核验 | 被 catch 的异常通常只变成提示，缺少后台诊断事件 |
| 三个 Hono 服务 | requestId、请求路径/状态/耗时；未处理异常返回500 | 全局异常仅记录 Error.name；缺堆栈、cause、错误码和业务阶段；局部catch绕过异常日志 |
| Web 的 RPC / market-page 函数 | RPC失败返回502；SEO读取失败仍返回页面外壳 | 未接入Hono日志；降级原因无结构化记录。保持页面可访问是正确的，后台仍应记录 |
| Resident Worker / QStash | jobs/job_attempts/outbox 持久重试、dead及通用错误码 | processor_failed / resident_processor_failed 丢失原异常与阶段，无法根因定位 |
| 展示 Worker | 重试事件、healthz | 事件只留名称；准备任务、扫描异常无原因，warn/error也不统一 |
| Relay | 断线、重连、部分错误消息和投递状态 | 没有统一脱敏、等级、操作关联；部分catch静默；provider消息未经统一净化 |
| 运维与奖励脚本 | 签名/发布私有journal、退出码、有限安全错误文字 | 不能代替通用应用日志；Creator对账顶层异常只给通用提示 |
| 指标与告警 | /internal/metrics 含队列、冲突、价格、连接及alerts数组 | 没发现实际外部采集与通知闭环；指标存在不等于会通知 |

## 按优先级修复

### P1：浏览器未知错误没有送到后台

证据：`apps/web/src/entry.ts:6`；`apps/web/src/create/launch-diagnostics.ts:50`；`apps/web/src/controllers/create.ts:1053`；`apps/web/src/controllers/trade.ts:1143`；`apps/web/src/app.ts:4278`；`apps/web/src/ui/stake-error.ts:17`。

增加统一前端错误SDK；全局未处理异常加手动业务捕获。Launch/Trade/Claim/Stake 共享 flow/step/operationId/code。钱包主动拒绝、用户取消、输入校验失败归为预期结果，不作为未知系统错误报警。用户离线、关页、扩展拦截可能阻止上报，不能承诺100%捕获；使用有界缓冲与重试，不阻塞操作，不增加页面组件。

### P1：后台 catch 丢失根因

证据：`services/backend-ts/packages/http/src/index.ts:159`；`packages/chain-worker/src/resident.ts:64`；`packages/jobs/src/index.ts:395`；`scripts/confirmed-display-worker.ts:32,39`；`apps/content/src/index.ts:138`；`apps/read-api/src/index.ts:453`；`apps/pipeline/src/index.ts:80`；`apps/web/api/rpc.ts:124`；`apps/web/api/market-page.ts:20`（后端相对路径均以services/backend-ts为根）。

本地注入 TypeError：得到500和requestId，错误日志仅TypeError，未保存根因/stack。注入局部catch返回503：只有level=info的http_request，无异常事件。应在“转换为用户安全响应”之前记录一次脱敏异常；请求访问日志与异常事件分别保留，避免多层重复捕获。不要把完整原始SDK错误、RPC URL或请求体直接塞进logger。

### P1：缺少生产主动告警和异机错误留存

已通过 Vercel API 只读核验当前团队：`/v1/drains` 和 `/v1/log-drains` 均为空。VPS未发现常见collector/alertmanager服务，所检查的 `/etc/tickergarden/*.env` 没有Sentry/Lark/OTel等变量，仓库当前运行路径没有通知发送器。不能排除用户在外部另有未提供的独立监控账号。

关键异常应统一进入托管错误平台并驱动Lark；独立可用性监控检测VPS、数据库或应用无法报告的宕机。不能让告警发送完全依赖同一VPS或同一业务数据库。

### P1：缺少完整操作关联

HTTP ID已存在，但前端没有统一保留；Worker的operationId/jobId没有与用户操作统一串联。HTTP接受外部指定requestId，应将其视为不可信相关标记，不可当作身份认证；建议另建服务端请求ID，并使用有界客户端operationId/标准trace上下文进行关联。

统一字段：timestamp、level、environment、service、releaseCommit、chainId、event、code、flow、step、requestId、operationId、jobId、attempt、fingerprint、durationMs、retryable；市场/交易哈希仅在必要的受控诊断中加入。环境区分TG_ENVIRONMENT与Vercel preview/production作用域，不能混为同一字段。

### P2：现有指标存在盲点和误报条件

证据：`services/backend-ts/apps/pipeline/src/index.ts:270-312`。lag参照数据库内最高区块；整个采集链停止时，最高区块也会停止，lag可能仍为零。没有独立告警消费者。连接压力按totalCount计入空闲连接，可能把正常满额空闲池误报；也不能代表所有Vercel实例及VPS的全局预算。prices空结果不会触发 `some(expired)`，缺少报价数量覆盖检查。资金结算和展示应有不同进度目标，不能把固定“2+30 blocks”当作所有链路的时效指标。

应使用后台已有心跳/最近成功轮询/项目事件水位/任务最老年龄/持续失败次数，不因市场无成交而报警，也不要给前端增加RPC健康检查。共享价格应覆盖ETH+194 Stock，USDG固定1 USD不触发外部报价告警。监控静默缺失、连续失败、供应商失败比例、数据库整体连接及等待量。

Resident/display Worker实例化RpcTransport未接入Vercel Pipeline已有的observe计量回调，主要链工作迁到VPS后，原有RPC计量覆盖不足。统一回调，记录method/耗时/结果/重试，不记录params和带密钥URL。

### P2：日志留存、脱敏、轮转需统一

线上九个运行容器的LogConfig为json-file且Config为空，未配置容器级max-size/max-file；journald持久目录存在，当前总用量133.6MB，但没有核验到项目专门配置的留存策略。不能据此断言磁盘已满。应建立大小/时间上限和磁盘压力告警，另行核验daemon默认配置，集中保留关键事件，采样正常请求，不能采样掉财务一致性异常。

Launch现有字段白名单值得保留。共享日志模块须显式移除Authorization/Cookie、签名、私钥、RPC/数据库/Webhook URL、用户输入及完整SDK请求。Pino字段redact不能自动清洗嵌入message/stack/cause的URL，仍需净化器和脱敏测试。

## 实际线上样本

只读journal采样：过去24小时各unit最后3000条（不是全量历史统计），生产display Worker有247条confirmed_display_retry和15条display_preparation_unavailable；262条结构化事件均只有event字段，没有原因。最近1小时生产有1条confirmed_display_retry和5条display_preparation_unavailable。这个时间窗跨越本次发布，不能归因于最新Creator版本，也不能把重试次数当成受影响用户数。采样时四个Worker均active、NRestarts=0。

这说明目前能知道“发生过重试”，但无法从日志区分RPC超时、数据库问题、历史状态错误或短暂启动阶段。新监控应抑制短暂启动期提示，对持续异常升级。

## 推荐通用方案

优先采用 **Pino结构化日志 + Sentry错误追踪 + 独立健康监控 + 服务端Lark通知适配器**，通过一个项目级observability模块封装，避免各业务随意console输出。第一阶段不在现有2核4GB业务VPS上再自建大型日志集群。

- Pino：服务端JSON日志、统一字段、child context、字段脱敏；访问日志继续由Vercel/journald承接。
- Sentry：浏览器和Node/Hono异常、发布版本、问题聚合、私有source maps；被业务catch的失败必须显式capture，不能只安装SDK。保留自己的事件模型，降低供应商耦合。
- 集中全量日志如果需要跨Vercel/VPS检索，再接Vercel Drains与VPS日志collector到同一个托管日志存储。Sentry错误追踪不等于所有访问日志长期归档。供应商套餐、保留期、接入预算另行确认，不假定免费。
- Lark：通知出口，告警卡片给出环境、服务、版本、阶段、错误码、影响次数、首次/最近发生时间、是否重试、内部Issue链接。Webhook和签名密钥仅在服务端secret，不能放VITE变量或Git。
- 业务处理不等待日志平台/Lark，发送失败不能改变交易结果；Vercel通过受支持的flush/生命周期机制完成有界交付，避免响应结束后异步任务被丢弃。
- 告警接收器验证来源、去重并持久化投递状态；指数退避、最大重试、dead-letter、恢复通知，Webhook失败也应有独立可见信号。日志/告警不可阻塞财务账本提交，也不能把财务审计记录移到日志服务。
- 默认关闭session replay和个人信息采集；私有source maps上传后不公开发布。前端采集入口须限制长度/速率、校验release/origin（不是认证替代）、避免攻击者伪造错误造成群消息轰炸。

参考官方文档：
- Pino脱敏：https://github.com/pinojs/pino/blob/main/docs/redaction.md
- Sentry Hono：https://docs.sentry.io/platforms/javascript/guides/hono/
- Vercel Drains：https://vercel.com/docs/drains
- Lark自定义机器人：https://open.larksuite.com/document/client-docs/bot-v3/add-custom-bot （本次工具仅取得文档入口，签名/限额细节需接入时按官方当前说明验证，未作实测）

## Lark分级建议（待实施，不是当前配置）

| 等级 | 事件 | 建议通知策略 |
| --- | --- | --- |
| Critical | 资金/账本不一致、签名事务无法协调、关键服务不可用、链身份不一致 | 检测到后立即入队；首条即时通知，同一问题聚合并按严重性升级 |
| Error | 新的未知前端异常、意外5xx、用户关键流程系统失败、任务dead | 首次通知；相同指纹5分钟窗口合并，附新增次数；影响扩大时升级 |
| Warning | RPC短暂失败、展示准备重试、价格更新连续失败、队列积压、连接等待 | 首条记录；连续3次或持续60秒再通知。具体阈值按链路节奏校准 |
| Expected | 用户取消、拒签、余额不足、参数校验失败 | 业务统计，默认不即时刷屏；异常比例上升才告警 |
| Resolved | 故障恢复且连续检查通过 | 发送一次恢复通知，附持续时间 |

“实时”是接近实时的目标，受网络和平台影响，不承诺硬实时；建议Critical/Error在检测后数秒入队，告警端到端目标30秒以内，独立健康检查30–60秒，验收后再确定SLO。

## 实施顺序与验收门槛

1. 统一observability模块、错误分类和脱敏；补后台catch、Worker和RPC计量。保持现有安全校验和用户页面设计。
2. 接入浏览器全局与手动业务错误，统一request/operation关联；上传私有source maps。
3. 接入外部错误平台和独立健康监控、集中日志及轮转策略。
4. 接入Lark，做去重/重试/恢复/权限测试；仅在获得Webhook配置和发送测试通知授权后实发。

必测：未知浏览器错误、动态chunk失败、API意外500/业务503、交易拒签与revert、RPC超时/限流、DB故障、Worker retry/dead/崩溃、链水位静默停滞、价格覆盖缺失、VPS不可达、Lark429/超时、关页/离线、敏感字段脱敏、重复事件聚合、恢复通知、日志平台失效不影响用户交易。

本次验证：前端完整套件632/632通过（含生成检查与类型检查）；后端HTTP/jobs相关13/13通过；本地错误注入稳定复现“500仅类型无堆栈、503仅info访问日志”。未在生产制造故障或发送通知。证据存放`.codex_tmp/reviews/logging-2026-09-18/`。

接入时需要：错误平台项目/预算和保留周期；Lark目标告警群的自定义机器人Webhook及签名secret（通过本机忽略配置/服务端secret提供，不在聊天或Git贴明文）；Critical是否@指定人员。当前阶段无需修改合约或增加用户页面元素。
