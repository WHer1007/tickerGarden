# Sentry 三项修复与生产交付 — 2026-11-13

根据用户授权，按 **P1 发币确认 → Worker 清理 → 监控补齐** 完成实现、回归及生产发布。生产应用版本于北京时间 **22:08:29** 完成切换；监控环境变量优先级补正于 **22:18:36** 完成。只更新这三项相关文件与运行配置，未改变页面样式、数据库结构、合约或链上状态。

## 固定版本与部署范围

| 项目 | 已验收生产版本 |
|---|---|
| 共用 Web、RH Display 修复 | `9f32286f4d5c237806bfdd5173a4d7052f76ff45` |
| BSC SDK/Display 修复 | `48881c452548f757bf95d3b7c7b79176844e36f3` |
| 监控配置生成器补正 | `0ff3dd16544305fe32e860252801228455de30b8` |

两个仓库均使用独立工作区，按 `test → master` 快进晋级。主仓库已推送 `test/master`；BSC 使用其实际生产仓库 `TickerGarden-BSC-production-hardening`，没有把旧 BSC 工作区的其他更新带入。主工作区的未提交修改未参与发布。

发布至当前新加坡 VPS 的主机运行环境；本轮没有 Vercel 部署、别名调整或函数区域变更。涉及 Web、BSC Read/Pipeline/Content、RH Display、BSC Display 共 6 个服务，其他服务的 PID、ActiveState、NRestarts 保持不变。监控补正只再次重启 Web 和 RH Display。

Web 构建保留线上既有 `evmTransport.ts` 的生产版本，避免顺带带入分支中不同的预览/测试链行为。冻结包记录了逐文件及产物 SHA-256；线上 15 个应用源码文件、完整候选静态资产及后续 2 个运维文件均逐项读回。全部候选 CSS 指纹与发布前一致；保留旧静态资源以支持已经打开的页面。应用 release 标签指向应用提交，运维生成器提交单独记录在 manifest。

## 1. P1：新市场登记先于新合约读取

现在先验证可信 Factory 回执、预测地址及可选初始买入事件，再等待有限时长的幂等后端登记，然后执行原有的新 Curve 和 Registry 参数检查。

- 确认前登记采用一次请求、8 秒上限，不在签名后等待长时间后台重试。
- 后端仍独立核验交易，浏览器只提交交易 hash。原有 RPC 地址允许列表保持生效。
- 登记请求失败时，仍可核验已由 Relay 独立登记的市场；新合约检查不能跳过。
- 保留交易 hash、刷新恢复和重复提交保护，失败不会自动重发创建交易。
- 正常成功路径去掉第二次重复登记，并重连展示快照更新。

生产验证采用页面读取、代码/配置指纹和健康检查，没有额外创建真实代币或发起钱包交易。登记延迟、错误 Factory、不同链、通知失败与新合约校验拒绝在本地测试中覆盖；不能将线上只读页面检查描述为新的真实发币验收。

## 2. Worker：监听连接只释放一次

RH/BSC 的数据库监听连接改为显式持有稳定引用的 `DisplayListener`。error、关闭与初始化失败通过同一所有权状态释放，跨 `await UNLISTEN` 不再依赖可能被清空的共享变量。并发/重复关闭幂等；旧监听器的回调不能修改新监听器就绪状态；最终确保 `pool.end()` 执行。

保持 push-only 边界。启动、空闲等待、重连、健康检查及价格通知均不授权扫链；RH/BSC 实进程测试分别覆盖启动、30 秒空闲、数据库断线重连、价格推送及恢复提示，RPC 请求均为 0。

## 3. 监控：来源、链和版本可核对

- 使用服务器唯一权威配置 `/etc/tickergarden/hosting.json` 中既有 Sentry DSN，配置 BSC Read/Pipeline/Content/Display 四个已接入 SDK 的服务。没有新增凭据文件作为配置来源。
- 运行日志/Sentry 增加链 ID 与准确应用 release；前端增加受限的错误分类、HTTP 状态、确认子步骤和允许列表内 RPC 拒绝原因，不发送原始 cause、请求正文、签名或 RPC 凭据。
- RH Display 的旧共享 `EnvironmentFile` 会覆盖普通 `Environment=`。已改为由权威配置生成排在后面的、仅含公开版本及链标识的专用环境投影，并在进程环境和启动日志中核实生效。
- Web 服务端运行配置补齐 production 环境与版本。浏览器版本继续使用原已冻结构建。

四条 `info` 级发布验证事件已经由 Sentry API 读回，均为 chainId=56、正确服务名与 BSC release：

| 服务 | Sentry event ID |
|---|---|
| bsc-read | `03c6cd9c16a8426ea18e9cfb1379d1ab` |
| bsc-pipeline | `51228e1bc0b147ea91f0f97c5a9942b2` |
| bsc-content | `978d0fd93790496aaa1367fef9e2b688` |
| bsc-display | `8cbec54e137640f09a3f0f20c0def293` |

验证标识 `54c33733-492b-4c3b-8ad8-91022f0c007e`。这些是明确标记的监控通道验证消息，不是用户业务错误；不触发业务异常、链上交易或 Lark 消息。原有 Sentry issue 未自动关闭。对比查询时，仅新增这 4 条 info 验证事件，原有错误的 lastSeen 未变化；这是短时观察，不代表未来不会复发。

## 回归与线上验收

| 检查 | 结果 |
|---|---|
| Web 全量测试 | 811/811 |
| RH 后端单元测试 | 266 通过，1 项主网条件测试在默认环境跳过；单独以主网配置执行相关文件 2/2 通过 |
| BSC 后端单元测试 | 274/274 |
| BSC Holder | 25/25 |
| RH/BSC Worker 实进程测试 | 各 1/1，均为 0 RPC |
| 运维配置测试 | 最终 5/5 |
| Web/RH 后端/BSC 类型检查 | 通过 |
| 主仓库生成文件、ABI/客户端/目录、包装与部署源门禁 | 通过 |
| BSC OpenAPI | 通过 |
| 生产前构建 | 边界、类型、性能和 SEO 检查通过 |
| 本地候选及线上浏览器 | RH/BSC 的 create、trade、explore，共 6 页，无页面 JS 异常或横向溢出 |
| 生产运行 | 6 服务 active、NRestarts=0；3 个 BSC 私有 readiness 和 2 个 Display health 返回 200 |
| 样式与上传配置 | CSS 指纹未变化，CSP 仍允许 `storage.tickergarden.com` |

BSC `npm test` 的历史生成器前置步骤需要完整工具/历史证据配置，最小本地 fixture 不满足；本轮直接执行实际单元测试、Holder、OpenAPI 和类型检查，未声称该旧前置生成器通过。没有修改 BSC 生成文件或合约。

浏览器验收只读取公开页面，禁止非 GET 请求，没有操作钱包。页面主体加载通过不等于所有服务端辅助数据都无错误，详见下列保留事项。

## 发布过程与回滚

前两次上线尝试触发自动回滚：第一次探针误用未认证 `/health`；第二次 BSC Display 冷启动超过原 10 秒探针时限。已改用实际私有地址和既有候选认证的 `/internal/ready`，启动等待上限调整为 60 秒，仍必须 HTTP 200。旧版回滚重启也需要约 14 秒，未发现这两次探针失败来自应用异常。

服务采用串行重启，期间存在短暂重启窗口，不能声称零停机。最终所有服务健康后才更新 Web；随后监控补正再次验证实际进程版本。回滚材料保存在服务器 root 私有目录：

- `/opt/tickergarden-hosting/releases/20261112/backups/sentry-fixes-20261113T140754Z`
- `/opt/tickergarden-hosting/releases/20261112/backups/observability-tags-20261113T141828Z`

材料含原始配置、逐文件版本、旧 Web dist、服务状态和结果清单。后续如需回滚，应先还原监控补正层，再还原应用层，重新生成服务投影并仅重启受影响服务；不要直接覆盖整棵线上源码或数据库。

## 保留事项与独立发现

1. **已有 Display 覆盖缺口仍为 `gap / synchronized=false`。** health 200 代表进程可工作，没有清除缺口或用扫块掩盖。缺口修复需单独基于具体事件处理。
2. **BSC 详情页服务端 metadata 仍读取 RH API。** 本次浏览器访问 TBULL 时，`market_metadata_unavailable` 在服务端出现；实际 `market-page.ts` 与发布前基线指纹完全一致，其查询只使用 `VITE_V1_READ_API_URL` 和 `VITE_V1_CHAIN_ID`。页面主体仍返回 200、客户端正常加载，但标题/分享 metadata 回落为通用值。这属于已存在的跨链页面辅助数据问题，未混入本轮三项修复；应另行修复并回归 RH/BSC metadata 路由。
3. 私有 sourcemap/source context 上传尚未补齐；本轮改善分类、来源及版本定位，没有声称 Sentry 已能还原所有源码行。
4. BSC Relay 未使用本轮这四个服务的 SDK 装配，没有新增其 Sentry 上报能力。

本地受限原始验证材料位于独立工作区 `.codex_tmp/sentry-review/`；不将生产凭据或未经筛选的原始配置加入 Git。
