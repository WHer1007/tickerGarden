# Links 与待发布版本核对 — 2026-11-13

用户授权检查此前修改的生产状态并发布尚未上线的相关代码。本轮于北京时间 **2026-11-13 22:34:19** 完成 Web 生产发布；应用版本为 `2546d863bfde3f0b53275b930f791b38cf1e202a`。

## 核对结果

| 项目 | 核对前状态 | 本轮结果 |
|---|---|---|
| Links：缺少 Website/X 时显示原按钮但禁止点击 | 修复 `29ba5c6` 仅存在独立本地分支，生产仍隐藏空链接 | 已晋级并发布 |
| 共用 EVM 传输层版本一致性 | 已接受源码支持显式测试 Gateway，线上仍是旧硬编码版本 | 已同步接受版本；生产继续使用原 `https://api.tickergarden.com`，RH/BSC 路由及批准开关不变 |
| TBULL 图表、BNB 成交量单位、Market cap/Holders 读取 | BSC `8d4d726` 已发布 | 线上两个修复文件与记录 SHA-256 一致，无重复发布或后端重启 |
| 发币后登记/校验顺序、Worker listener 清理、Sentry 装配 | 主应用 `9f32286`、BSC `48881c4`、运维 `0ff3dd1` 已发布 | 线上记录涉及的文件指纹全部复核一致 |
| 上传 CSP 的存储域名许可 | 已发布 | 本轮 Web 就绪检查再次确认 `storage.tickergarden.com` 仍被允许 |
| 前端审查 F1–F5、Holder 入口说明等 | 审查发现与建议，尚非已实现候选代码 | 未作为“已修复、待发布”处理；仍待实施 |
| RPC 预算贯通、重复区块读取/缓存等优化 | 调研建议与本地复现，尚未实现 | 本轮未修改 RPC 预算、缓存、签名校验或运行策略 |

F1–F5 包括可传播市场链接遗漏链身份、图表切换周期失败时误用旧数据、详情/Stats 数据新鲜度提示、Explore 地址规范化、按链显示帮助文案。此前另发现的 BSC 服务端 metadata 读取 RH 来源也仍待修复。本轮不将上述待开发功能宣称为已上线。

## 发布范围与隔离

基于 `master` 建立独立工作区 `TickerGarden-links-release`，只 cherry-pick 已完成的 Links 修复。候选按 `test → master` 快进，两个分支均已推送。

发布前对照 **311 个前端源码、脚本、配置及依赖描述文件**，生产与接受源码仅有以下两处差异；本轮也仅更新这两个运行源码文件和对应的 Web 构建产物：

- `apps/web/src/controllers/trade.ts`
- `apps/web/src/v1/evmTransport.ts`

未改变 CSS、页面布局、生产合约、资产准入、Holder 批准开关或后台签名器。Links 使用页面已有的图标与禁用样式。

部署目标为现有新加坡 VPS 主机运行环境，未使用 Vercel。只重启 `tg-hosting-web.service`；其他应用服务 PID、ActiveState 和 NRestarts 均保持不变。权威配置仍为 `/etc/tickergarden/hosting.json`，仅更新 Web 的浏览器/服务端 release 标识。原有静态资源保留，避免已经打开的页面丢失旧资源。

## 验收

- Web 单元测试 **811/811**；TypeScript、ABI 源码一致性、生成客户端及资产目录检查通过。
- 独立 worktree 的常规 `npm test` 前置步骤要求未生成的 Foundry `contracts/out-v1`，因此该命令本身未通过；本轮使用正式前端生产构建所采用的 `check:abis:source`，并分别运行全部前端测试与类型检查。没有改 ABI 或重新部署合约。
- 正式构建的性能、模块边界及 SEO 检查通过；`test/production` 源分支部署门禁通过。
- 对最终构建执行 **5 种 Links 场景**：均缺失、仅 Website、仅 X、两者均有、content 缺失。验证两个按钮始终可见；缺少地址时 disabled 且无 URL/title；有地址时以 `noopener,noreferrer` 打开正确 URL。
- 生产浏览器检查 RH/BSC 的 Trade、Create、Explore，共 **6 页**：无未捕获 JavaScript 错误、无横向溢出；未签名或提交交易，禁止非 GET 请求。
- TBULL 真实生产页面的 Website、X Account 均 `hidden=false, disabled=true`，符合未填写链接时的预期。桌面及手机截图已检查。
- 线上全部 **357 个候选静态资产**、两个更改文件及 311 文件整体前端基线核对通过，CSS 指纹与发布前一致。
- 发布后 Web 为 active、NRestarts=0，无进程崩溃或 failed systemd unit；其他服务状态保持不变。已有页面辅助 metadata 问题未冒充为新版本无错误的证明。

## 记录与回滚

线上 `/opt/tickergarden-hosting/releases/20261112/release-manifest.json` 的 `detailLinksRelease` 保存固定提交、文件指纹、发布时刻及隔离验证结果。

服务器 root 私有备份：

`/opt/tickergarden-hosting/releases/20261112/backups/detail-links-20261113T143417Z`

包含原两个源码文件、权威配置、manifest、完整旧 Web dist 及服务状态。回滚应只恢复这一层 Web 发布、重新生成运行投影并重启 Web；不要回滚 BSC 图表或 Sentry/Worker 的既有修复。

受限本地验证资料位于 `.codex_tmp/links-release/`，生产截图和摘要副本位于被 Git 忽略的 `docs/reviews/evidence/2026-11-13-links-release/`；未提交凭据或私钥。
