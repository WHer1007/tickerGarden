# TickerGarden V2 Frontend

独立设计的六页面中文前端，位于 `apps/web-v2`。没有读取、复用或导入 `apps/web` 或旧版视觉资产；CSS 花园插画为本版原创。零 npm 运行依赖，Node.js 22+ 即可运行。

```sh
cd /Users/dear/Documents/code/TickerGarden/apps/web-v2
npm run dev
# http://127.0.0.1:5174
npm run test
npm run build
npm run preview
```

`PORT=5180 npm run dev` 可更换端口。构建文件在本目录 `dist/`，可部署到任何静态服务器。使用 hash 路由，无需服务器 rewrite。

## 页面

- `/#home`：独立花园主视觉、社区指标、热门市场、产品流程。
- `/#trade/nvcat`：市场切换、买卖切换、周期切换、金额快捷键、滑点、订单预览、毕业进度。
- `/#markets`：关键词搜索、阶段筛选、排序、可持久化自选、空结果状态。
- `/#create`：输入校验、关联 STOCK、报价与模板、可选收益地址与首买、实时卡片、发行预览、本地草稿恢复。
- `/#analytics`：期间切换、成交量、手续费分配、市场排名。
- `/#rewards`：STOCK 仓位与空闲金库、操作预览、创建者收入、独立国库轮次与证明空状态。

## 业务依据与边界

以当前 `docs/v1/V1_PROTOCOL_PARAMETERS.md` 等正式产品文档的 V1-EXEC-11 规则作为业务依据，V2 是此次全新前端的版本号，不表示新增协议版本。没有独立的 canonical V2 产品文档。

保留的主要规则：仅 In Bloom 后分配 STOCK；新增份额 30 秒激活；最新分配重置整个仓位 24 小时锁；正常整仓退出；紧急退出返本金并放弃奖励；Quote/Meme 分别记账；毕业后 1% 总协议费，LP 协议费 0；有效质押时 40/30/30、否则 70/0/30；创建费 0.0005 原生资产；一市场一 STOCK Base 和一 Quote。

所有余额、市场、图表、历史与预览都是明确标注的演示数据。钱包按钮只进入演示账户；没有 RPC、签名、链上交易或实际领取。订单预览使用固定 ETH/USD 演示参考价 2400 与 1% 示例费率，不能作为真实曲线/Hook 报价。曲线真实费率、价格冲击、Gas 与反狙击税需要正式报价接口。STOCK 下拉为六项示例，不是完整 ACTIVE 目录。

投入真实使用前需要单独接入：部署清单、ACTIVE Registry、immutable identity 校验、Indexer/API、钱包与交易模拟、真实 raw-unit 计算、STOCK 最低分配额、链上锁定时间、国库 proof/epoch 与退款数据。创建元数据 URI、salt 和 expectedEconomics 需由生产适配器生成/验证。当前草稿不是可直接提交的合约 calldata。

## 设计与验证

暖白、森林绿、青柠与柔和花卉色；独立 CSS 插画，不使用旧版图片。响应式断点为 1100、800、540px；移动端表格可局部横向滚动。原生标签、键盘焦点、dialog、aria-live、输入约束、reduced-motion 已覆盖。

字体优先使用可选 Google Fonts，网络不可用时回退系统字体；无其他远程运行资源。`src/data.js` 独立存放示例数据与预览函数，`src/app.js` 管理六页与本地状态，`src/style.css` 管理视觉系统。

本轮验证：构建成功，5 项 Node 测试通过；浏览器实测市场搜索与自选、订单预览、创建输入与预览、统计 30D 切换、奖励紧急退出说明和国库空状态。390px 下六个页面均无页面级横向溢出（市场表格内部允许滚动）；1280px 首页无横向溢出。浏览器未记录 JavaScript 错误。修复过表格中绝对定位的无障碍文字造成的移动端溢出。
