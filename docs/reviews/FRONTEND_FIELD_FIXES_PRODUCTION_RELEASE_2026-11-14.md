# 前端字段修复生产发布 — 2026-11-14

根据用户“将以上优化发布到生产”的明确授权，于北京时间 **2026-11-14 00:42:22** 完成 Web 发布，随后通过线上验收。

## 版本与范围

- 已发布产品版本：`d94862514481c64f18ef95113819738fbc2d6a52`。
- 生产原产品版本：`75dc280b3ae797e674cac46ace8644043f4b8f3b`；Git 晋级基线为其后文档提交 `9b8ad10c89a1d1f7601c60cb29d4077c3894ae26`。
- 候选在隔离工作区完成测试，按 `test → master` 快进并推送。正式产物使用当时完全相同的两个分支、当前生产公开配置和 Node 24 重新构建，没有使用本地预览产物。
- 范围为 [字段修复报告](FRONTEND_FIELD_FIXES_2026-11-14.md) 中 D1–D8：链参数保留、图表周期失败处理、过期 USD 清除、分区状态及重试、BSC 文案与服务端 metadata、Holder 未开放提示、交易日期、供应量及成交单位。
- 仅更新 21 个 Web 运行源码文件及 359 个静态资产。合约、经济参数、资产开关、Holder 领取批准、数据库和 Worker 均未改变；未混入主工作区其他开发内容。

## 部署与隔离

沿用新加坡 VPS 托管，无 Vercel 上传、别名切换或域名调整。本轮 Vercel `sin1` 运行检查不适用，未借此修改既有地域要求。

只停止并启动 `tg-hosting-web.service`，存在短暂重启窗口。其余 **23 个相关 systemd 服务**的 PID、状态和重启次数前后完全一致。

生产唯一人工配置 `/etc/tickergarden/hosting.json` 只改变 Web 的 `TG_RELEASE_COMMIT` 和 `VITE_RELEASE_COMMIT`。仅重新生成 Web 私有运行投影，没有重写其他服务的配置。生产凭据只在服务器配置投影中使用，未输出到日志或纳入发布包。

旧哈希静态资源继续保留，供已打开的页面加载；CSS 字节指纹与原生产一致。上传 CSP 的 `https://storage.tickergarden.com` 仍有效。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| test / production 源码部署边界 | 通过 |
| 最终源码前端测试 | 834/834，无失败或跳过 |
| ABI/source、生成客户端、资产目录、TypeScript | 通过 |
| 正式配置构建 | 通过；主包 452.60 KB，小于 500 KB 门禁 |
| 分包、性能及 SEO | 通过；12 页 SEO 验证，既有禁止索引策略保留 |
| 生产源文件基线 | 发布前核对 614 个受版本管理文件；发布后核对修改指纹和未修改文件 |
| 产物读回 | 359 个静态文件及 21 个运行源码 SHA-256 全部匹配 |
| 线上浏览器 | 27 组检查通过，含 RH/BSC 桌面与手机、详情新标签页、链参数、单位、Holder 提示、图表及 Stats 失败重试 |
| 浏览器安全边界 | 只读页面；故障在独立浏览器中模拟，不改服务器、不发送钱包交易 |
| 公开服务端 metadata | TBULL 和 SEED 标题、canonical 链参数及入口 JS 指纹正确 |
| RH/BSC 后端 | Read、Pipeline、Content 共 6 个健康检查均 HTTP 200 |
| Web 状态 | active，NRestarts=0；新版短时日志未见 warn/error |

发布前 readiness 请求在旧版 `75dc280b3a` 上复现一次既有 `market_metadata_unavailable`，发生于 16:42:20 UTC、Web 重启之前。新版发布后 BSC 与 RH metadata 均通过，16:44:11 UTC 的核验窗口没有该错误。短时检查不代表长期无异常。

本次不包含链上交易、真实钱包签名或历史数据缺口修复；没有触发自主 RPC 扫块。BSC Holder 仍维持未开放提示和原执行限制。

## 证据与回滚

- 服务器 manifest：`/opt/tickergarden-hosting/releases/20261112/release-manifest.json` 的 `frontendFieldFixesRelease`。
- root 私有备份：`/opt/tickergarden-hosting/releases/20261112/backups/field-fixes-20261113T164220Z`。
- 备份包含旧运行源码、Web dist、权威配置、Web 运行投影、manifest、服务状态及发布结果。恢复时仅回滚本层 Web 文件和两个版本字段，重启 Web，不回滚数据库或其他服务。
- 本地证据：`/Users/dear/Documents/code/TickerGarden-frontend-fields-audit/.codex_tmp/field-release/`，包括构建及 834 项测试日志、冻结发布包、服务器检查、部署读回、27 组线上浏览器结果及截图。

该记录为发布后的文档补充；产品运行版本仍为 `d948625144`。
