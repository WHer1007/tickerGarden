# TickerGarden V3 — The Garden Workspace

独立的六页前端设计与交互实现，以 V1 为品牌与业务参考。所有新增源代码、资源、构建和验证记录都位于 `apps/web-v3/`；不导入 V1/V2 应用代码，不修改 V1/V2。

## 运行

Node.js 22+，无需安装 npm 依赖。

```sh
cd /Users/dear/Documents/code/TickerGarden/apps/web-v3
npm run dev
# http://127.0.0.1:5183
npm test
npm run build
# dist/ 为独立静态构建
npm run preview
```

开发服务器与预览默认同一端口，二者选一运行，或使用 `PORT=5184 npm run preview`。hash 路由无需服务端 rewrite。构建目录自包含 HTML、JS、CSS、图标字体与图片。

## 页面与创新

| 页面 | V3 设计 | 可操作内容 |
| --- | --- | --- |
| 总览 `/#home` | V1 社区树成为可导航的生态入口；结合市场摘要和动态 | 点击树上 STOCK、生态筛选、市场入口 |
| 市场 `/#markets` | 卡片承载故事、阶段和流动性信息；支持结构化比较 | 搜索、生态/阶段/自选筛选、排序、卡片/列表、最多三个市场对比 |
| 交易 `/#trade/nvcat` | 市场选择替代手填 ID 的默认路径；图表与订单并列 | 市场切换、买卖、时段、快捷金额、滑点、订单预览 |
| 创建 `/#create` | 三步发行工作室：身份 → 配置 → 检查 | 表单校验、上下步、实时摘要、本地草稿、首买与费用预览 |
| 统计 `/#analytics` | 活力趋势和手续费分配并列 | 7/30/90 天切换、排行榜、资产分配说明 |
| 奖励 `/#rewards` | 本金、收益和时间状态分开 | 仓位时间线、存入/分配/提取数量预览、退出、创建者、国库状态 |

跨页面：桌面侧导航、手机底部导航、⌘K / Ctrl+K 社区搜索、原生 dialog、键盘焦点、跳至内容、响应式表格、reduced-motion。

## 业务与运行边界

这是一份完整的独立前端交互设计实现，不是 V1 的生产运行时替换版。所有行情、价格、余额、事件、图表和身份都是明确标注的演示数据。连接按钮只启用演示账户；所有资金入口仅生成预览，不签名、不发送 RPC、不修改真实资产。没有用演示数据填充或绕过 V1 fail-closed 数据/交易路径。

真实产品规则以当前 `docs/v1/V1_PROTOCOL_PARAMETERS.md`、`V1_EXECUTION_SPEC.md`、Treasury/Creator 文档和 `apps/web/README.md` 为依据。V3 表示前端设计版本，不是新协议版本。

保留：一市场一 STOCK 与 Quote；仅 In Bloom 后分配 STOCK；30 秒 pending 激活；增仓重置整仓 24 小时锁；正常整仓退出；rageQuit 放弃未领取收益并直接返本金；Quote 与 Meme 分资产计奖；毕业池总协议费 1% / LP 协议费 0%；有效质押时 40/30/30，无有效质押或曲线阶段 70/0/30；0.0005 原生创建费。

订单只使用固定 ETH/USD 2400 与 1% 示例费率，不包含真实曲线、反狙击税、价格冲击或 Gas。V1 当前毕业池 swap 的发布锁定仍然成立，V3 不代表这些生产能力已开放。

正式接入需要另行实现部署 manifest 与 immutable binding 校验、ACTIVE Registry、可验证 read API、钱包签名/模拟/receipt、raw-unit 金额与最小分配规则、真实锁定时间、Treasury proof/epoch/service credit，以及真实交易和退出恢复测试。创建流程中的 metadata URI、salt、expectedEconomics 应由生产适配器生成，不能把此演示草稿直接发送为合约参数。国库资金与 root 发布不自动发生。

## 文件

- `src/app.js`：六页模板、交互、canvas 数据图表与 UI 状态。
- `src/model.js`：演示目录、筛选、报价预览、步骤校验、HTML 转义。
- `src/style.css`：V3 设计系统与响应式规则。
- `design/DESIGN.md`：V1 截图审查、V3 设计取舍和验收记录。
- `assets/tree.png`、`assets/mark.png`：从 V1 复制的既有品牌资源，不依赖 V1 文件路径。
- `assets/icons/`：本地 Phosphor 图标字体及 MIT 许可。

字体使用可选 Google Fonts（DM Sans、Fraunces、Noto Sans SC），不可用时回退系统字体；图片与图标全部本地化。

## 已完成验证

- Node 语法检查、独立构建、6 项模型/输入测试通过。
- 浏览器实测：市场对比、搜索无结果与重置、列表切换、全局搜索直达交易、金额和滑点预览、创建三步全流程、分配超额拒绝与有效金额预览、统计 30D 更新。
- 六页在 390×844 均无页面级横向溢出；桌面截图核对首页、市场、交易、统计，手机截图核对奖励。数据表在自身容器内滚动。
- 浏览器未记录 JS 错误。没有执行真实钱包或链上 E2E，也不宣称完整 WCAG 合规。
