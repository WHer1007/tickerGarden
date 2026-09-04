# TickerGarden 品牌文化与生态语言

> 决策状态：`APPROVED BRAND DIRECTION`
> 确认日期：2026-09-04
> 适用范围：TickerGarden V1 的官网、产品界面、社区内容、活动与生态合作
> 规范边界：本文定义非链上的品牌与用户语言，不新增或修改任何合约状态、经济参数、权限或执行条件。协议事实以 [`V1_PROTOCOL_PARAMETERS.md`](../V1_PROTOCOL_PARAMETERS.md) 和 [`V1_EXECUTION_SPEC.md`](../V1_EXECUTION_SPEC.md) 为准。

## 1. 品牌定位

TickerGarden 是一座围绕官方 Stock Token 生长的开放股票文化花园。

一只 STOCK 可以成为多个独立 Ticker Meme 社区的共同文化起点。创作者提出故事、符号与表达，社区通过内容、参与和市场行为让不同文化自然生长；TickerGarden 提供公共土壤、透明规则和长期运行的基础设施，但不指定某只股票的“官方 Meme”，也不替社区决定唯一叙事。

Ticker Meme 是围绕股票社区形成的文化资产，不代表对应股票的所有权、股东权、固定赎回权、收益承诺或价格跟踪关系。STOCK 在市场完成毕业后用于社区选择和实际手续费分配，不是 Ticker Meme 的抵押物或兑付储备。

品牌原型：**公共花园与园丁**。平台培育环境，不占有果实；制定共同规则，不裁定文化高低。

## 2. 文化属性

TickerGarden 的文化由以下五项原则组成：

1. **生长，而不是速成。** 市场、内容、认同和流动性需要时间形成；品牌不以短期价格涨幅定义成功。
2. **多元，而不是唯一。** 同一只 STOCK 可以生长出多个彼此独立的 Ticker Meme，每个社区都可以拥有自己的名称、视觉和故事。
3. **共建，而不是平台导演。** 创作者种下文化种子，参与者决定哪些叙事能够持续；TickerGarden 不为单一市场背书。
4. **真实活动，而不是通胀补贴。** V1 的参与者收益来自对应市场已经实际产生并到账的手续费，不来自持续增发或预设 APY。
5. **自治与退出。** 市场按公开规则长期运行；文化可以继续演化，但不能被平台事后接管。用户退出权与本金安全语言必须优先于增长叙事。

## 3. 口号体系

### 3.1 主口号

> **Stake the ticker. Grow the culture.**
>
> 让 Ticker 扎根，让文化生长。

主口号表达 STOCK 参与和社区文化生长之间的关系，不表示质押会铸造 Ticker Meme，也不构成收益承诺。

### 3.2 品牌愿景

> **Culture grows beyond the chart.**
>
> 图表之外，文化继续生长。

中文长句：

> 连接股票与 Meme 文化，让每一个 Ticker 生长出更多可能。

### 3.3 辅助口号

- **Every ticker has more than one story.** — 每个 Ticker，都不止一种故事。
- **One stock. Many cultures.** — 一只股票，许多种文化。
- **Where stock communities become culture.** — 让股票社区生长为一种文化。

辅助口号可以根据页面场景选择，但不得使用 “official Meme”“stock-backed Meme”“tracks the stock price” 或任何等价表达。

## 4. 生命周期品牌语言

`Bloom`（绽放）是 TickerGarden 对协议 `Graduation` 成功结果的统一用户侧表达。它是品牌语言，不是新的链上状态。

推荐的完整文化叙事为：

> **Seed → Grow → Bloom → Root → Harvest**

其中 `Bloom` 是成功完成 Graduation 的事件名称，`In Bloom` 是成功后的持续状态；`Root` 与 `Harvest` 只描述 Bloom 后已经发生的结果，不新增协议状态。

| 协议事实 | 用户侧语言 | 精确定义与使用边界 |
|---|---|---|
| 市场创建并处于 `NotGraduated` | **Seed / Seeded**（种下） | 市场已经创建，可以开始曲线阶段；不表示平台背书或保证毕业。 |
| 曲线交易进行中 | **Growing**（生长中） | 社区与曲线市场仍在形成；不得把交易热度描述为股票价值增长。 |
| 前端模拟显示下一笔可能吃完曲线 | **Ready to Bloom**（即将绽放） | 仅是非权威交易预览；链上不存在可持续观察的 ready 或 pending 阶段。 |
| canonical Registry 中 `launchPhase == PoolCreated` | **Bloom / In Bloom**（绽放 / 已绽放） | `Bloom` 唯一成立条件。事件发生时使用 `Bloom`，成功后的市场状态使用 `In Bloom`。表示 canonical Pool 已成功创建；此后才能在满足其他协议门禁时接受对应 STOCK 配置。 |
| `PoolCreated` 后的 canonical 初始流动性保持永久锁定 | **Rooted Liquidity**（流动性已扎根） | 描述 Bloom 后已经形成的持久流动性结果，不是独立 `launchPhase`，也不表示流动性规模或币价不会变化。 |
| 市场已经产生并记账的可领取手续费 | **Harvest**（收获） | 只指已经实际产生、到账并可核验的手续费；不得用于预估收益、固定回报、排放奖励或 APY。 |

### 4.1 `Bloom` 的产品展示规则

- 合约、ABI、事件、Indexer 和技术文档继续使用 `Graduation`、`PoolGraduated` 与 `PoolCreated`，不得为了品牌语言重命名协议接口。
- Web 的最终状态必须读取 canonical Registry；不能根据前端进度条、成交额估算或链下数据库自行判定 Bloom。
- 只有 canonical `PoolCreated` 可以显示 “In Bloom”。“Ready to Bloom”只能来自明确标注的前端模拟；不得从缓存或不存在的中间阶段推断成功。
- `Bloom` 用于命名成功转换事件；持续状态、市场徽章和筛选标签统一使用 `In Bloom`，不再使用 `Bloomed`。
- “Liquidity rooted permanently” 或 `Rooted Liquidity` 只描述 canonical 初始流动性的永久锁定事实；`Rooted` 不能替代 `PoolCreated`，也不能单独用于判定市场状态。
- `Harvest` 只描述已经实际产生并记账的手续费，不得用于收益预测、奖励排放或尚未到账的金额。
- Bloom 表示生命周期转换成功，不表示币价上涨、投资成功、平台认证、上市公司认可或未来收益保证。
- 对外首次使用时推荐写作 **“Bloom（链上 Graduation 完成）”**；在同一页面后续内容中可以简称 Bloom。

## 5. 生态角色

| 角色 | 文化身份 | 在生态中的作用 |
|---|---|---|
| 市场创作者 | **Planter / Storyteller** | 围绕一个获准 STOCK 提出 Ticker Meme 的名称、视觉与文化故事，并分享该市场实际产生的 Creator 手续费。 |
| 交易与社区参与者 | **Community Grower** | 发现、交易、创作和传播不同社区文化；交易不产生股票权利。 |
| STOCK 配置者 | **Cultivator** | 在市场 Bloom 后，把对应 STOCK 配置到自己认同的社区，并按实际 active STOCK 比例分享该市场实际产生的 Staker 手续费。 |
| 内容与策展者 | **Curator** | 制作研究、表情包、主题榜单、文化档案和社区活动，帮助用户理解不同花园。 |
| 开发者 | **Garden Builder** | 使用公开数据构建看板、机器人、发现工具、组件和第三方前端。 |
| TickerGarden | **Public Garden Infrastructure** | 提供统一发行、状态、手续费和数据基础设施；不成为任何单一 Meme 的运营者或文化裁判。 |

这些称谓属于传播语言，不产生新的治理权、收益权或协议权限。

## 6. 生态飞轮

```text
股票形成公共话题与共同符号
        ↓
创作者围绕同一 STOCK 提出不同 Ticker Meme 文化
        ↓
内容、讨论、交易与社区参与形成真实活动
        ↓
成熟市场完成 Bloom，进入永久锁定的 canonical Pool
        ↓
STOCK 持有者选择配置到自己认同的已 Bloom 社区
        ↓
实际手续费在 Creator、Staker 与 Platform 之间透明分配
        ↓
更好的创作者、策展者与开发工具进入生态
        ↓
发现成本下降，更多文化种子被种下
        ↺
```

飞轮的燃料是持续的文化创作、市场使用和可核验手续费，而不是平台代币排放、承诺收益或平台人为维持价格。

## 7. 社区仪式

- **Seed Day：** 一个新市场首次进入花园，介绍其文化设定与创作者，不作官方背书。
- **Bloom：** `PoolCreated` 成功后的社区时刻，可展示 canonical Pool、永久锁定流动性和开放 STOCK 配置的事实。
- **Harvest Report：** 定期展示已经实际产生的交易量、手续费资产、Creator/Staker/Platform 分配和领取数据。
- **Garden Season：** 围绕 AI、汽车、消费、太空等股票文化主题进行阶段性内容活动。
- **Hall of Gardens：** 记录长期活跃、创作丰富和数据透明的社区；不得只按短期涨幅排序。

## 8. 生态发展方向

### 阶段一：建立可信花园

- 完成部署、审计、法律措辞和生产 E2E 门禁后再对外宣称正式运行。
- 建立少量文化差异清晰的示范市场，验证从 Seed 到 Bloom 的完整体验。
- 在所有页面统一 Stock Token、Ticker Meme、Bloom 和实际手续费语言。

### 阶段二：形成社区发现网络

- 建立市场故事页、创作者身份、文化标签和透明手续费看板。
- 推出 Garden Season、Bloom 动态和 Harvest Report。
- 排行体系优先展示持续活跃度、内容贡献和可核验市场数据，而不是只有价格。

### 阶段三：开放生态工具

- 提供只读 API、Indexer 数据、嵌入式卡片、通知机器人和开发者组件。
- 支持第三方策展页、研究工具和独立前端，形成多个进入花园的入口。
- 保持链上身份和状态判定唯一，第三方展示不得创造平行的 “Bloom” 标准。

### 阶段四：扩展文化网络

- 发展跨社区联合创作、主题策展与长期文化档案。
- 尚未冻结的 Treasury、平台代币、回购、治理或额外激励，只能经过独立产品决策后加入；在确认前不得写入核心品牌承诺。

## 9. 对外传播红线

TickerGarden 的文案不得暗示或宣称：

- Ticker Meme 是股票、代表股票权益或由股票 1:1 支持；
- Ticker Meme 会跟踪股票价格、可兑换股票或享有股息；
- STOCK 配置会铸造 Meme、保证固定收益或获得预设 APY；
- Bloom 等于价格上涨、投资成功、平台背书或上市公司认可；
- 当前协议已经部署、已经审计或可用于生产，除非相应门禁已经形成可验证证据；
- 社区文化身份等同于链上治理权、协议控制权或接管权。

一句话检查标准：**我们描述的是社区如何生长，以及协议已经发生的可验证事实，而不是对资产价值和未来收益作出承诺。**
