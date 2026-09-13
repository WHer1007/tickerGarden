# 最新 RH 合约前端测试发布验收

2026-09-13。状态：TEST_PREVIEW_PUBLISHED。用户选择切换新版本测试站，旧数据保留归档。本次未修改合约、未签名或广播钱包交易，不代表主网可发布。

## 版本与发布

- Chain ID：46630；release：`0x685b5c20e826f4ddd076b61216c7529a967322082925c4741469b0fda837a7f2`。
- Factory：`0xF11839C3566C8B3345Ed81E4A0e26cc38Aa2866A`；激活块：118689839。
- Web：https://tickergarden-web-test.vercel.app ，Preview `dpl_7Z25DQphyNPpvzu9QNU8cAkYYteU`。
- Read API：https://tickergarden-read-api-test.vercel.app ，Preview `dpl_EAfAQJ9xQXRp1ycoLVp8RXCTSVMu`。
- Pipeline：https://tickergarden-pipeline-test.vercel.app ，Preview `dpl_8q2iMhpKsMubgHHShrm9X9VQoPYv`。
- 三次部署均显式使用 `--regions sin1`；切别名前核验 Web 1、Read API 2、Pipeline 2 个运行时函数全部在 sin1。

## 对齐范围

创建参数含永久 Meme 手续费销毁开关；Creator/Staker 按原资产领取，Holder 使用钱包快照接口与独立上线开关。文案遵循已确认设计：Creator/Staker 在领取时销毁；平台手续费及紧急退出罚没部分不被承诺全部销毁。快照证明 API、发布者尚未配置，保持关闭，不伪造可领取数据。

新链上配置仅允许 ETH 配对，phantom 0.168 ETH、毕业目标 0.42 ETH；无市场、无准入 Stock，前端显示真实空态，质押资产显示不可用。新建市场及时发现、交易详情分区更新及旧响应抑制随同发布。

ABI、8 个前端绑定、后台 17 个固定来源、事件集合与 bootstrap 统一到新 release。共享前后台链数据模块纳入 Web Vercel 构建安装范围。当前生成产物及配置锁通过验证。

## 数据切换与归档

新旧部署使用独立 deployment_digest。没有删除历史数据库数据。旧发布指针仍存在；配对资产清单、后台 baseline、relay filter 均存入各自 archive 目录。旧 Web/Read/Pipeline 部署保留，见之前的部署记录。

链队列上一代任务完成后将 generation 从 0 切换到 1；新任务已成功。VPS relay 更新为 17 个来源的当前过滤器，保留原业务环境并重建持久镜像。已有定时刷新恢复。Content 服务未变更。

## 验证

- 前端测试 386 通过；后台单元测试 54 通过、接口契约测试 9 通过；类型检查、生成产物、OpenAPI、打包和 baseline 门禁通过。
- 真实测试 PostgreSQL 集成测试 4 通过、0 跳过：analytics-db、analytics-projector、principal-projector、recent-markets。
- 线上桌面 1440px 和手机 390px 共 20 个页面 HTTP 200，无页面异常、无横向溢出；创建页截图经人工视觉检查。
- 实际切换销毁开关后摘要显示 On · permanent，输入名称保留；打开质押显示 No eligible staking assets。
- Read API 健康检查 synced；链队列 generation 1 任务成功；新旧 publication 指针各 4 个。

证据见 [验收目录](evidence/frontend-latest-rh-2026-09-13/)。浏览器验收未连接钱包、签名或创建市场，因此不声称已完成新市场的线上资金全流程测试。
