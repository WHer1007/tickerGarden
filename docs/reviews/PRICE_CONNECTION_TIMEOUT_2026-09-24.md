# 生产共享报价连接超时排查

## 结论

本次是 Read API 新建 PostgreSQL 连接超出 5 秒预算，SQL 尚未执行；不是历史报价表扫描，也不是昨晚数据库重启产生的错误。更底层是网络、TLS/auth 握手还是 Vercel 实例暂停/调度抖动，现有日志无法唯一确认，不应把推断写成已确认根因。

Sentry issue: https://tg-one.sentry.io/issues/149040305/ （TG-INONE-7）。查询时累计 1 次。

## 时间与证据

北京时间 2026-09-24 11:33:40，GET `/v1/prices/references`：

- requestId `ecbc3bb5-0f78-4a62-ba54-ecadf42503df`。
- `database_connection_timeout` 记录 5000.8756 ms。
- `http_unhandled_error` 被 Sentry 捕获；HTTP 500，总耗时 5244.02 ms。
- 11:33:42.154 同接口恢复 200，服务处理耗时 22.12 ms。
- 同窗口 Explore bootstrap 获取连接 2774 ms，health 数据库往返 3469 ms，说明不只价格路径短暂变慢。
- pg-pool 锁定依赖源码 `index.js:275–276` 仅在新客户端连接计时器触发时包装该错误；池等待超时使用不同错误 `timeout exceeded when trying to connect`。
- 应用 SQL 计时是驱动往返，包含网络和回调调度；PostgreSQL 全局统计才是服务端执行时间。不能将 health 的 3469 ms 直接认定为慢 SQL。

生产数据库在事件附近没有重启、OOM、连接数耗尽、认证拒绝或慢 SQL 记录。数据库容器自昨晚 15:17:22 UTC 启动，restart=0。当前业务连接少于各角色额度。启用统计以来 read-api 最大 SQL 24.03 ms、pipeline 93.11 ms，所有业务角色临时块写入为 0。主机当前可用内存约 2.3 GiB，负载低；这不能代替事发时的完整资源曲线。

再次连续 6 次读取公开价格接口均返回 200，客户端总耗时约 0.43–0.87 秒（包含本地网络/代理）。没有人为提交交易。

## 代码缺口及建议

1. 价格读取接口绕过 `shareRead`，同一实例的并发读取没有合并。应共享正在执行的同环境/链/部署报价请求，结束即释放，不引入前端过期规则或独立价格源。
2. `connectionTimeoutMillis=5000`，价格只读路径没有短暂连接失败恢复。建议在明确“未取得连接、未执行 SQL”时做最多一次重连，并设总耗时预算和小退避；不要对写入或结果未知的交易普遍重试，不要单纯放大连接池。
3. 补充连接阶段、pool total/idle/waiting、重试次数和部署 ID。现有日志已经能关联 Sentry 与 requestId，但不能定位 TCP/TLS/auth/实例调度中的具体阶段。
4. 发布版本标签存在问题：Sentry/应用日志 `releaseCommit` 仍为 `2c4e8034…`；实际触发事件的 Vercel deployment `dpl_x6rPSBVD9DKbNMzQ911T6gzc7vvg` 对应昨晚发布的 `tickergarden-read-bfsa8vrs5-garden24.vercel.app`，区域 sin1，源代码为 `7f5e530f…`。应用优先读 `TG_RELEASE_COMMIT`，固定旧配置没有随新发布更新。后续应从发布源提交注入 runtime/build release，前端同步 VITE_RELEASE_COMMIT，避免误判旧代码仍在线。

本次为只读排查，没有修改生产参数、重启或发布服务，也没有将 Sentry issue 标为已修复。建议按以上次序修复并在测试环境验证断连恢复、并发合并和重试边界后发布。

证据目录：原工作区 `.codex_tmp/connection-timeout-2026-09-24/`，含 Sentry 事件、Vercel 请求日志、数据库窗口日志及当前探测结果。

## 改进实现与本地验收

已在 `codex/production-health-fixes` 完成；后续已按测试 → 生产发布，部署验收见末节：

- `/v1/prices/references` 与 `/v1/statistics-prices` 使用同一实例、同一部署范围的单路在途查询；结果完成即释放，不增加报价缓存或新报价源。
- 报价读取显式获得数据库连接后才执行 SELECT。只有明确的临时建连错误允许一次 150 ms 退避重试；权限拒绝、池排队超时、连接数耗尽、所有 SQL 失败均不重试。默认总预算 12 秒，单次获取连接保护 5.25 秒（驱动自身仍为 5 秒），查询超过总预算销毁连接；迟到连接也销毁，不遗留占用。
- 连接日志包含 pool total/idle/waiting、失败阶段，价格恢复日志包含 attempt/retryCount、是否重试与累计耗时；请求级 task 统计分开显示连接等待和 SQL 往返。
- 源码导出自动生成不含配置/密钥的 `source-release.json`。Vercel 构建检查提交、环境、分支和服务，后端函数显式打包该文件。日志、Sentry、前端编译版本优先采用源码提交号，保留本地/Worker 无产物时的原有回退。记录安全的 deployment ID。
- 后端完整 npm test 通过：252 项单元测试，类型/接口契约/生成锁/打包检查通过；build 通过。
- 8 项价格恢复测试包括真实 pg 客户端连接本地假服务器的握手超时，确认最多两次连接、SQL 零执行、客户端清理；并覆盖 12 个并发请求合并、不同应用实例隔离、SQL 不重放及总预算。
- 17 项发布边界与实际 logger 子进程测试通过；Vite 实际配置验证源码提交覆盖旧环境标签；前端 build:vercel、SEO 和资源预算检查通过。

下一次发布仍须遵循 test 验收后再从 master 发布生产，并在 sin1 验证运行函数。无需数据库迁移或数据库重启。部署后需核对实际日志的 releaseCommit/deploymentId，再观察自然流量；不以本地验证冒充线上修复完成。


## 测试与生产发布验收

2026-09-24，产品提交 `b5da19a8bee9ea5272d9d63e17f1688bc615c507` 已经由 test 验收后推进 master，两个分支均已推送。Web、Read API、Pipeline、Content 与相关 VPS Worker 已更新；不涉及数据库迁移或数据库重启，原 PostgreSQL 容器启动时间保持不变。

- 全部 Vercel 命令显式使用 sin1，发布前再次核验 Web 2、Read API 3、Pipeline 2、Content 2 个函数均位于 sin1。
- 测试环境 12 项 API 读取、两个报价接口、6 个并发报价请求通过。首页/Explore/Stats/详情浏览器读取均 HTTP 200，无 pageerror。
- 生产同样完成 12 项 API 读取、两个报价接口及四个浏览器页面验收，SEED 供应量、价格等正常显示。
- 测试和生产实际 Read API 日志均报告上述新提交号与 deploymentId；生产样本 `prices.read` 成功，连接等待 0.15 ms、SQL 往返 8.98 ms、任务总耗时 25.86 ms，无连接/SQL 超时。
- 生产前端构建完成 Sentry source-map 上传。测试没有人为上报错误，生产也没有通过制造故障验证。
- 更新后的展示 Worker/resident active、NRestarts=0；健康采样无任务失败、连接超时或 SQL 超时。
- 发布复核中 Relay 曾短暂 health=false。日志显示 04:28:53/55 UTC shared RPC budget denied，04:28:58 恢复 WS 请求响应；再次核验 health=true、lastError=null、pending=0、dead=0。该容器及代码未在此次更换，记录此瞬时现象，不将短期验收表述为已消除所有网络抖动。

| 环境 | Web | Read API | Pipeline | Content |
|---|---|---|---|---|
| 测试 | tickergarden-jqx38oocv-garden24.vercel.app | tickergarden-read-prwzbcj7u-garden24.vercel.app | tickergarden-chain-pipeline-3p0wpahek-garden24.vercel.app | tickergarden-content-etat6n23x-garden24.vercel.app |
| 生产 | tickergarden-cdrcxk3aw-garden24.vercel.app | tickergarden-read-6ysxsxjvi-garden24.vercel.app | tickergarden-chain-pipeline-mibvoj51m-garden24.vercel.app | tickergarden-content-2byjlqpeb-garden24.vercel.app |

生产 Read API deployment ID: `dpl_9ZuVqihfb1LdVsWmLKRZ7vjC4FxZ`。证据保存在 alignment 工作区 `.codex_tmp/releases/price-recovery-2026-09-24/`。后续仅文档提交不改变运行产品代码。
