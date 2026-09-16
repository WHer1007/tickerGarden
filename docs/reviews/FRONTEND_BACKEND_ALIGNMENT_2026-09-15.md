# 前端优先的前后端对齐验收（2026-09-15）

状态：`TEST_PREVIEW_PUBLISHED / LIVE_FUNDS_E2E_PENDING / NOT_PRODUCTION_READY`。本地功能验收、后台线上验收及前端空态/钱包流程通过；真实资金业务闭环尚未验收；未发布生产。

## 基准与分支

最新正式前端是本地 `codex/production-treasury-audit` 的 `apps/web`，不是演示原型 `apps/web-v3`。刷新远端后确认 `origin/codex/production-treasury-audit` 的 `2faf71ace6` 与原本地开发分支的产品代码一致。远端已清理历史证据和截图，整合从清理后的历史继续，保留原生产部署工作区。

对齐方向：当前 `apps/web` → 实际 API caller → 后端实现/生成契约 → `test`。主网必须另行配置真实生产 release，不能将测试网事件目录直接发布生产。

## 修复与一致性

- 浏览器生命周期 fixture 更新为当前 Claim 标签、断开钱包按钮；两轮页面切换验证持续计时器不增长。新增 `npm --prefix apps/web run test:browser:lifecycle` 独立执行三个浏览器 fixture。
- 手动 Web 部署允许必要的 `TG_SOURCE_BRANCH`，同时拒绝与实际部署分支冲突的值；`codex/*` 禁止部署的规则保留。
- 新增从真实编译产物生成的 ABI 构建输入。普通 ABI 检查及上传前 Web source gate 仍验证真实编译产物；Vercel 验证提交的输入、接口源码、manifest 和生成桥接文件，不依赖未上传的 Foundry 缓存。重新编译仅更新产物摘要，ABI 数组与候选基准逐字一致。
- 更新前端 API 清单中的测试 release、activation block、OpenAPI 5.1.0、Holder 钱包快照及 `POST /v1/launches`。未发现当前正式 caller 缺少对应的后端路由或 DTO。

## 当前测试身份

- Chain：46630。
- Release：`0x685b5c20e826f4ddd076b61216c7529a967322082925c4741469b0fda837a7f2`。
- Factory：`0xf11839c3566c8b3345ed81e4a0e26cc38aa2866a`。
- Activation block：118689839。
- Vercel Preview Web 的公开配置与上述身份一致，release catalog 指定 `wallet-snapshot-v1`。

## 已执行验证

- 固定依赖的 Foundry 编译和合约体积检查通过；未修改合约代码。
- 前端 440 项测试通过；其中 4 项验证无编译缓存的 ABI 输入校验及损坏/过期输入拒绝。
- 三个浏览器 fixture 通过：Router 13 项、App 69 项、History 停止/恢复和迟到响应隔离。
- 前端普通构建和 Vercel 专用构建通过。仍有已有的主 bundle 大小提示。
- 后端 86 项单元测试及 23 项 PostgreSQL 集成测试通过，无跳过；类型检查、构建、生成契约、服务打包检查通过。
- 接口覆盖检查：26 个生成 Read 路由、3 个保留手写 Read 路由、4 个 Content 路由；另核对 Pipeline 创建交易通知。
- 本地真实 Hono API + 隔离 PostgreSQL 合成读模型：桌面/手机 18 个页面与 8 个交互检查通过，浏览器无未捕获错误。包括分页、搜索失败恢复、图表快速切换保留输入与无关页面状态。

本地证据在本工作区 `outputs/` 以及 `docs/reviews/evidence/full-local-integration-2026-09-13/`（历史工具的固定输出目录，本次新生成）。合成读模型不是链上市场，不代表真实钱包买卖或领奖。历史容量脚本仍有三项期待旧版规模上限拒绝的断言失败；当前实现已移除这些旧上限，因此本次仅使用其隔离数据和 API 服务，不将该历史脚本列为通过的容量验收。

## 发布门槛

部署只能从 `test` 上传，四个项目均显式使用 `--regions sin1`；逐个验证部署函数区域之后才能设置测试别名。完成线上前后端验收后，才能讨论生产提升；主网目录/索引和独立资源不能使用本测试 release 替代。


## 测试发布结果

四个服务均由 `test` 提交 `fd82f9af8c7fdcb38ff03e74b3b4f2c7616be343` 导出干净源码包部署，未上传本地环境文件、数据库、依赖缓存或部署钱包工具。源码导出命令为 `node tools/stage-vercel-source.mjs test <service>`；上传仍显式指定 `--regions sin1`、`--build-env TG_SOURCE_BRANCH=test`。后端 Vercel 项目根目录已改为仓库内的 `services/backend-ts/apps/<service>`，按锁文件安装完整工作区。

| 服务 | 测试别名 | 候选部署 | 已验证运行函数 |
| --- | --- | --- | --- |
| Web | https://tickergarden-web-test.vercel.app | https://tickergarden-gtki81esz-garden24.vercel.app | 1 / sin1 |
| Read API | https://tickergarden-read-api-test.vercel.app | https://tickergarden-read-dvaqus13w-garden24.vercel.app | 2 / sin1 |
| Pipeline | https://tickergarden-pipeline-test.vercel.app | https://tickergarden-chain-pipeline-lzi1exmpb-garden24.vercel.app | 2 / sin1 |
| Content | https://tickergarden-content-test.vercel.app | https://tickergarden-content-jhuopkq51-garden24.vercel.app | 2 / sin1 |

每个别名切换前均再次运行 `check-vercel-region.mjs`，所有函数均为 sin1。该脚本支持 `TG_VERCEL_CLI` 指定已安装 CLI，避免依赖 npx 的包缓存选择。

远程测试数据库的 14 个迁移摘要与当前源码完全一致，仅执行只读核验，没有修改 schema。候选地址和测试别名的后台验收均通过：live/ready、精确 CORS、拒绝不允许的写请求、拒绝伪造 relay、10 并发请求。最终前端 440、后台 86、环境边界 19 项测试均通过。

线上前端自动市场发现确认目录为空，完整 Trade/Stake 验收因此不能开始。另用明确不存在的市场 ID 检查其余流程，16 项页面/跳转/草稿检查、钱包连接/换账户/错链失效以及 CSP/no-cache/API 404 检查通过；Trade 数据完整性检查在桌面/手机均因缺少市场而未通过，未知市场详情返回 503。该结果不记作完整浏览器业务验收通过，未签名或广播交易。

线上配置目录：Stock 0，Quote 1，Baseline 1，Template 1；均返回 200，无后续游标。历史 release 发布记录也明确该测试版本起始时无市场、无 Stock 准入。继续实链交易、质押、领奖闭环需要补齐该测试 release 的 Stock 准入和测试市场。主网前后端运行时目录及独立环境资源的接入仍是下一阶段，不能直接将此测试目录提升到生产。

本轮线上证据：`outputs/backend-candidate-acceptance.json`、`outputs/backend-hosted-acceptance.json`、`outputs/frontend-hosted-empty-state.json`、`outputs/hosted-config-counts.json`、`outputs/vercel-*-region.log`、`outputs/vercel-*-alias.log`。切换前的旧测试部署信息保留在 `outputs/previous-*-deployment.log`。
