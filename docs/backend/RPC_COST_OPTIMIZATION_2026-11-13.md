# RPC 成本优化实施与验收（2026-11-13）

状态：代码和本地验收完成，未发布生产。没有改变页面样式、生产配置、合约、签名器、开关或 RPC 扫描范围。

## 固定范围

- 共用 Web / RH：隔离工作目录 `TickerGarden-rpc-optimization`，基线 `1f1e20718a0ba1e3e17bfd67cab84fb74c234f85`。
- BSC 独立后端：隔离工作目录 `TickerGarden-BSC-rpc-optimization`，基线 `48881c452548f757bf95d3b7c7b79176844e36f3`。
- 两个开发分支均为 `codex/rpc-cost-optimization-20261113`。原开发目录未混入本次改动；开发分支不作为部署来源。

## 实现

1. **BSC 预算贯通**：Web 的 BSC 分支投影独立预算 URL、token、私有 Read API access token 和日志范围上限。预算拒绝或凭据缺失时不调用上游 RPC；全局预算启用时不能用 BSC `false` 绕过。RH 预算凭据不作为 BSC 的默认值。策略或凭据变更后不复用旧的并发请求状态。
2. **区块读取归因与合并**：物理 RPC 日志增加用途和区块 tag，区分身份、读取前后 canonical 校验、bootstrap、投影提交锚点和最终性。`summarize-rpc-usage.ts` 增加 `blockReads` 分类表。BSC 注册状态按事件区块分组，组内最多四并发；RH/BSC 市场观察每批最多八并发，共用哈希绑定读取上下文。发布前的锚点检查保留，失败时等待本批读取结束并整体拒绝。
3. **静态信息缓存**：Pipeline 的已验证 chain ID / genesis 组合限时复用 60 秒，缓存按 transport 和预期身份隔离；错误不缓存，显式审计默认强制新读取，审计失败清空成功记录。市场／资产分组复用现有固定 blockHash 的代码和合约读取缓存，扩大其实际覆盖范围。没有把最新代理权限、倍率、价格或余额当成静态数据。
4. **页面只读查询合并**：真正接入 `app.ts` 的 viem transport，在请求进行期间合并相同参数的只读调用；账户切换清空协调器，之后的读取不复用已完成结果。保留 HTTP batch，但不将减少 HTTP 包数量等同于减少计费方法数。含 `from` 的模拟、状态覆盖、nonce、gas、发送交易和自定义取消／重试策略不进入该协调器。
5. **交易状态查询收敛**：前台 receipt polling 从 1 秒改为 2 秒，20 秒前台截止时间和替换／取消处理保留。保存的交易恢复检查逐步退避，上限 60 秒，手动检查仍立即执行；页面隐藏、上下文变化及结束时沿用原有停止条件。已观察到 pending 的重复提交保护窗口为 65 秒，覆盖最长查询间隔；证据过期仍会退出保护，不无限锁定。底层合并 raw recovery 与 viem receipt 的同哈希并发读取，不缓存空 receipt，不把后端展示状态用于结算。

## 受控调用量对比

| 场景 | 原方式 | 新方式 | 说明 |
| --- | ---: | ---: | --- |
| 78 个同区块资产，原四并发分组边界 | 40 次区块头 | 2 次区块头 | 156 次资产状态与最低质押量调用均保留；该场景总方法数 196 → 158 |
| 60 秒内 10 次同 transport 链身份验证 | 20 次 | 2 次 | 仅静态身份部分；新 head / finality 仍实时读取 |
| 20 个并发同参数页面余额查询 | 20 次浏览器 transport 请求 | 1 次 | 服务端原本也可能去重，因此不能直接认定节省 19 次 QuickNode 计费 |
| 5 分钟未解决交易，原 5 秒检查 | 61 次检查机会 | 8 次 | 虚拟时间测试；单次检查可能含多个 RPC，实际数量取决于交易状态 |

这些是相同输入的本地计数，不是生产账单或全站节省比例。上线后应按相同 UTC 窗口比较物理方法数、预算拒绝、延迟、失败率和 provider 账单。

## 验收

- Web 全套：820 项；覆盖实际 viem client、预算耗尽／缺配置／跨链凭据、并发读取、失败重试、账户清理、空 receipt、交易退避与保护窗口。
- RH 后端：269 项，268 通过，1 项主网环境专属跳过；该文件另以主网身份离线执行 2/2 通过，无主网 RPC。后续受影响模块定向回归通过。
- BSC 后端：279/279；Holder：25/25。最后的资产观察和缓存变更再次定向回归通过。
- PostgreSQL：RH 共享缓存／预算／市场 delta 三项通过；BSC 配置投影两项和加权共享预算一项通过。均为本机独立随机 schema，结束后清理。
- RH 与 BSC 真进程 Display Worker：各一项通过。启动、30 秒空闲、监听重连、价格通知、恢复提示、健康查询和重启均为零 RPC，不新增扫块恢复路径。
- TypeScript 检查、Web 生产构建、ABI source／客户端／catalog 生成校验、性能与 SEO 门禁、RH backend 固定源码基线通过。部署边界和代理／预算 39 项通过，Python 配置检查 7 项通过。
- 首轮并行运行中 RH Worker 启动测试受本机负载影响超时，降低并行负载后真实进程复测通过；没有放宽启动断言。BSC 的空本地配置导致五项价格目录测试失败，补入权威目录的 81 个公开资产字段后全套通过；未复制生产 URL、凭据或生产启用状态。

本地日志：本工作目录 `.codex_tmp/rpc-optimization/`；BSC 定向与数据库日志为本机 `/tmp/tg-bsc-*.log`。合约源码及 ABI 未修改，未重编译或部署合约。

## 后续发布装配

生产唯一人工配置仍为 `/etc/tickergarden/hosting.json`。新 `infra/server/web_rpc_config.py` 由已有 `render-config.py` 调用，从 `services.bsc-read.bscProfile.backend.runtime` 派生以下私有 Web 字段，不建立另一个人工配置源：

- `TG_BSC_RPC_CONTROL_ENABLED=true`
- `TG_BSC_RPC_BUDGET_URL`：经现有私网映射到 BSC Read API；内部 permit 路径不经过统一公开 Gateway。
- `TG_BSC_RPC_BUDGET_TOKEN` 与 `TG_BSC_RPC_BUDGET_ACCESS_TOKEN`：只在服务端投影，不进入 `VITE_*` 或浏览器。

发布时必须同时携带该 Python helper，先用 `render-config.py --check` 校验当前权威配置并复核 Web 私网映射，再按授权执行配置投影与服务发布。缺少私有预算装配会使新版 BSC Web RPC 拒绝请求，这是预期的关闭行为。此次未运行生产 renderer。

接受后按 `test → master` 晋级，先发布独立后端，再发布预算配置完整的 Web；仅重启受影响服务。若使用 Vercel，所有部署显式指定 `--regions sin1`，逐函数验证 region 后才能 promotion。生产发布、运行成本观察和回滚验收仍属于下一次授权发布工作。
