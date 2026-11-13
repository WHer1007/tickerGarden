# Sentry 近期错误排查 — 2026-11-13

本次为只读调查，没有修改生产配置、重启服务、广播交易或更改 Sentry issue 状态。代码基线为 `f231db9d3fb957c407dff4ed24b48f5c724da8ae`，独立工作区 `TickerGarden-sentry-review`。所有时间除特别标注外均为北京时间（UTC+8）。

## 结论

最近 24 小时查询到 **8 类、31 次事件**；14 天窗口为 **14 类、45 次事件**。这些是 Sentry 收到的事件数，不等于独立故障数或受影响用户数。BSC 后端存在上报缺口，不能仅凭 Sentry 没有新增事件判断其运行正常。

应优先处理三项：

1. **P1：发币成功后的新合约校验与后端地址登记存在竞态。** 现场 403、登记时间及同版本本地复现一致。交易已成功，前端却可能进入确认失败/恢复状态。RH 共用此逻辑。
2. **P2：Display Worker 关闭数据库监听连接时存在释放竞态。** RH/BSC 现场日志均有同类异常；当前生产脚本仍保留该逻辑，本地三份生产/测试脚本模式均复现。
3. **P2：BSC Sentry 装配和诊断上下文不完整。** Read/Pipeline/Content 与 Display Worker 未配置上报，部分服务缺少版本标识；前端包装错误没有保留可定位的内部原因。

上传失败对应今天已修复的 CSP 配置。数据库连接和队列占用的旧事件集中在迁移/服务变更窗口；本次未发现它们仍持续发生的证据。

## 24 小时事件清单

| Sentry | 次数 | 时间 | 调查结果 |
|---|---:|---|---|
| [R：confirmation_failed](https://tg-one.sentry.io/issues/160886693/) | 1 | 11-13 20:28:33 | TBULL 创建后校验受阻，详见下文；业务登记随后成功 |
| [Q：Failed to fetch](https://tg-one.sentry.io/issues/160880345/) | 1 | 11-13 20:09:51 | 与用户上传错误 reference 完全一致；20:24 CSP 配置修复后，当前响应已允许存储域名 |
| [P：undefined.release](https://tg-one.sentry.io/issues/160696757/) | 1 | 11-13 03:14:28 | RH Display 停机异常；服务器同时记录了 BSC 同类异常，代码问题尚在 |
| [N：another resident worker owns this chain queue](https://tg-one.sentry.io/issues/160671670/) | 22 | 11-13 01:19–01:24 | 队列独占锁冲突触发进程退出/重试；不代表执行了 22 次业务交易 |
| [M：Connection terminated unexpectedly](https://tg-one.sentry.io/issues/160671589/) | 1 | 11-13 01:19:11 | Resident 控制连接中断，随后发生上述锁冲突 |
| [K：resident control heartbeat failed](https://tg-one.sentry.io/issues/160632847/) | 1 | 11-12 22:58:05 | 迁移窗口内数据库控制心跳失败 |
| [J：Content connection timeout](https://tg-one.sentry.io/issues/160632430/) | 2 | 11-12 22:56–22:57 | 旧 Vercel Content `/internal/dispatch` 超时，带旧部署 ID |
| [H：Pipeline connection timeout](https://tg-one.sentry.io/issues/160632416/) | 2 | 11-12 22:56–22:57 | 旧 Vercel Pipeline `/internal/dispatch` 超时，带旧部署 ID |

这些 issue 的 Sentry 状态仍是 unresolved；本次没有自动关闭。用户信息不采集，因此 userCount 不能用于判断影响人数。

## P1：发币后确认与地址登记先后顺序

### 现场证据

发币交易：`0xb14537c7e583d23810e4560fb6e524f7a907b39c900e41b8442d4a75f60c974b`；TBULL 创建区块 `133351787`。Sentry reference：`dc89b8e4-9a69-4092-a471-aaf8f0d82e0d`。

| 时间 | 现场证据 |
|---|---|
| 20:28:30.820 | Web RPC `eth_getTransactionReceipt` 返回 HTTP 200 |
| 20:28:31.667 | 再次读取回执返回 HTTP 200 |
| 20:28:31.953、32.339、32.850、33.689 | Web RPC 代理连续 4 次 HTTP 403 |
| 20:28:33.650 | Sentry 记录 `verify_launch / confirmation_failed` |
| 20:28:34 起 | 合约读取恢复，之后 `eth_getCode` 也成功 |
| 20:28:36.465 | `recent_markets.observed_at`：TBULL 正式写入最近发币记录，canonical=true |
| 20:28:36.478 | BSC `POST /v1/launches` 返回 200 |

因此这次不是“创建交易回滚”。数据库已保存真实 Factory 创建信息，当前 token/curve/gauge 均为 active source，市场 `launch_missing=[]`、`refresh_error=null`。本次没有再发交易。

### 代码与复现

- `apps/web/src/controllers/create.ts:1023–1050`：回执事件核验后立刻读取新 Curve 的 code、quoteAsset、Registry 市场配置。
- 同文件 `:1068`：正常流程的 `notifyLaunchDatabase` 位于确认完成之后。
- `apps/web/api/rpc.ts:117–131`：新地址须已存在于 `/v1/rpc-scope` 结果，否则返回 `rpc_target_not_allowed`，HTTP 403。
- BSC 线上 `rpc-scope.ts` 只从正式配置及数据库的 `contract_sources`、`confirmed_display_markets`、`recent_markets` 获取动态地址；当前逻辑不会凭浏览器提供的地址直接放行。
- 线上 Web `api/rpc.ts`、`controllers/create.ts`、`observability.ts` 的 SHA-256 与本工作区逐一相符。
- 本地调用真实 `proxyReadRpc`，仅模拟“后端尚未登记/已经登记”两种状态：BSC、RH 均先返回 403 且不请求 RPC，登记后相同请求返回 200。没有连接生产 RPC。

**判断：** 新合约登记慢于前端校验，是与现象高度一致且可复现的业务竞态。现场代理日志只记录 HTTP 状态，Sentry 只有外层错误，未记录这四次拒绝的具体 code/target；不能声称已经恢复了原始内部异常全文。即使本次随后恢复，此先后顺序问题仍应修复。

### 修复边界和验收建议

在可信 Factory 回执验证后，完成幂等的交易登记/范围准备，再进行新地址读取；或者建立基于已验证回执的短期、有限范围读取授权。不能简单允许任意地址或信任浏览器自报的合约地址。等待期间展示“交易成功，正在同步确认”，保存交易 hash 并支持刷新恢复，不重新提交创建交易。

验收应覆盖：BSC/RH 登记延迟、通知暂时失败、重复通知、刷新恢复、错误 Factory/伪造日志/跨链地址拒绝、确认成功只发生一次。

## P2：Display Worker listener 释放竞态

线上 RH 当前脚本 `scripts/confirmed-display-worker.ts:47,87`，BSC 对应 `:49,89`：

```ts
client.once('error', () => {
  if (listener === client) listener = undefined;
  client.release(true);
});
// shutdown
if (listener) {
  await listener.query('UNLISTEN *').catch(() => {});
  listener.release();
}
```

在 `await UNLISTEN` 期间连接 error 回调可把 `listener` 设为 undefined；恢复执行后调用 `.release()` 即抛错。异常还会中断后续 `pool.end()`。

11-13 03:14:27–29 的生产日志明确记录：服务正在停止时，RH 与 BSC 均触发 `Cannot read properties of undefined (reading 'release')`，随后被 systemd 重新启动。Sentry 只有 RH 这一条，BSC 同类日志没有对应上报。

对三份线上脚本（RH production、RH test、BSC production）的相关模式进行了受控本地复现，**3/3 均重现相同异常**。测试没有中断服务器数据库。

建议由一个清理入口管理连接所有权：跨 await 使用稳定引用，停止时摘除共享引用，error/shutdown 路径只释放一次，同时确保 pool.end 总能执行。仅改成可选链会隐藏问题；仅保存局部变量又可能重复 release。验收应同时覆盖正常停机、UNLISTEN 期间断线、监听建立失败、连接重建和重复停止。

## P2：上报与定位缺口

1. 服务器统一配置中 BSC Read、Pipeline、Content 均未配置 `TG_SENTRY_DSN`、`TG_RELEASE_COMMIT`；BSC Display/Relay 运行配置也未配置 DSN。Backend SDK 在缺少 `TG_SENTRY_DSN` 时不启动。此次 BSC Pipeline 实际存在两次失败日志，Sentry 中并无对应事件。
2. 前端 SDK 使用 `defaultIntegrations:false`；本次 `V1TransactionError` 只有包装异常，没有内部 cause。安全上下文也没有链标识及确认子步骤。Web RPC 拒绝日志只有 status，没有拒绝 code，增加了跨层定位成本。
3. Backend stack 路径被脱敏后，Sentry 显示 `Source code was not found`；当前部分服务版本标签仍为旧值，BSC Pipeline 日志是 `unconfigured`。不能仅按 release tag 推断当前运行源码，本次使用线上文件指纹复核。

建议继续使用统一配置文件补齐 BSC 上报及准确服务/链/版本标识；上报受控的内部错误分类、子步骤和关联 ID，不扩大到钱包签名、密钥、RPC 凭据、用户请求正文等敏感数据。源码定位应采用发布构建对应的私有映射/清单；无需公开 sourcemap。

## 旧事件与当前运行核验

- Resident production 自 11-13 01:25:05 起持续运行，当前 `NRestarts=0`、health 200；数据库采样中该 advisory lock 只有一个 granted holder。现场旧日志无法进一步唯一确定当时旧连接/另一个进程的身份，不臆测为业务重复执行。
- 11-13 21:32 的 RH、BSC Display health 均为 200、`lastFailure=null`，采样计数中没有 SQL/连接超时。但两者仍报告 `coverage=gap, synchronized=false`。这是已有上游事件覆盖缺口，health 200 只代表进程可工作，不能解释为历史同步完整。
- BSC 任务 `25763`：先 RPC 失败，再 sparse checkpoint 不匹配，20:29:30 第 3 次尝试成功。检查时当天 20:00 后的 38 个 chain job、1 个 content job 全为 succeeded，无 pending/retry/dead 遗留；不是当前索引卡死。
- 所查 8 个相关服务均 active，未发现 failed systemd unit。数据库采样为 13 个 client connection，其中唯一 active 是本次只读查询，其余 idle，无 idle-in-transaction。这个采样不构成长期连接泄漏或完整数据库健康评估。
- Web 当前 CSP 已包含 `https://storage.tickergarden.com`，发币页面 HTTP 200；Sentry Q 最后一次仍为修复前 20:09:51。
- 14 天内较旧的 `/docs` 资源失败和动态 import 失败在 11-08 23:11:20 相隔约 5ms，可能是同一次页面加载的两种报告，不能当作两个独立用户故障。旧 RPC 错误最后发生于 11-01/11-06，未据此认定现在仍在失败。

## 本次验证和交付边界

- 原有 `apps/web/tests/rpc-proxy.test.ts`：**17/17 通过**。
- 新地址登记前后模拟：**RH/BSC 2/2 复现**。
- Display listener 关闭竞态：**3/3 复现**。
- Sentry 使用只读 API，服务器仅查询 journal、运行配置、服务状态及只读数据库事务；未扫链、未修改队列或 issue 状态。
- 已有上传配置修复与本次调查区分记录。此报告不是“上述三项已修复”或“可发布”的声明。

本地证据摘要（遵守仓库规则，不入 Git）见 [evidence](evidence/2026-11-13-sentry/summary.json)。受限原始证据保存在独立工作区 `.codex_tmp/sentry-review/`，未提交凭据或未经筛选的 Sentry 请求数据。
