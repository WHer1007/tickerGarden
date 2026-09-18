# 创建代币失败场景与恢复审计

日期：2026-09-18。对象：`test` 分支当前本地代码（含尚未提交的 Explore 更新）。

## 结论与边界

创建流程已有较完整的参数、签名、余额、报价、模拟、回执与防重复提交校验；本地合约测试验证了创建及首买同一交易的原子回滚。但失败后的用户体验尚未全部合格，发现两项恢复缺陷、通用错误覆盖过多、链上成功后数据准备缺少退出/解释策略。应先修复这些代码问题，再补 Docs 的简短排障说明。

本次仅新增测试和本报告，没有修改产品页面、业务逻辑或 Docs 正文，没有提交真实交易或部署。未执行生产钱包、真实浏览器扩展钱包或实时主网 Fork 验收；不能据此保证所有钱包、网络和池子条件都能创建成功。

## 验证结果

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| Web 完整测试与 TypeScript | 578 通过 | 含新增 34 项故障/文案特征测试；并非全部是创建专项 |
| Backend 单元测试 | 160 通过 | 含兑换路由、报价边界和 HTTP 错误处理 |
| Content PostgreSQL 集成测试 | 1 通过 | 隔离本地数据库，签名授权、一次性挑战、幂等恢复及存储失败重试 |
| Factory 产品合约测试 | 72 通过 | 本地 EVM，包括 fuzz、原子回滚、异常 ERC20、回调等 |
| Factory 共享校验测试 | 16 通过 | 本地 EVM，配置/经济参数/绑定校验 |

新增文件：
- `apps/web/tests/launch-failure-matrix.test.ts`：16 项，真实交易执行器 + 注入钱包/RPC/存储故障。
- `apps/web/tests/launch-failure-messages.test.ts`：18 项，真实错误分类、文案、诊断持久化函数。

其中标记 `characterization` 的测试用于证明当前缺陷确实存在；测试通过不表示该行为符合产品要求。回滚旧提示用例验证持久化状态和文案函数，并结合控制器源码定位，并非真实浏览器端到端复现。

复现命令：
```sh
npm --prefix apps/web test
cd services/backend-ts
npm run test:unit
TG_MIGRATION_DATABASE_URL='postgresql:///postgres?host=/tmp' node --experimental-strip-types --test tests/integration/content.test.ts
```
合约测试使用 `FOUNDRY_PROFILE=v1`，分别指定 `test/v1/product/TickerGardenFactoryV1.t.sol` 和 `test/v1/shared/V1FactoryValidation.t.sol`。以后单独审计应使用临时 out/cache 目录，避免测试编译覆盖前端 ABI 哈希校验依赖的本地 artifacts。本次已从生产工作树恢复与已跟踪 build-inputs 哈希完全一致的 18 个忽略接口 artifacts，未更改 ABI 或 build-inputs；随后完整 Web 检查通过。

## 优先修复项

### P1：广播后浏览器存储失败，恢复链路拿不到哈希

证据：`apps/web/src/v1/transaction.ts:484-503`；新增 `journal failure after broadcast` 用例。

顺序是钱包返回交易哈希 → 写持久记录 → 发出 submitted 更新。若预先存储探测正常，但钱包返回之后存储突然失败，则交易可能已广播，持久记录为空，控制器也未收到哈希。用例验证发送次数为 1、pending 记录为 0、没有 submitted 更新。

这不是已证实的重复扣款，但损坏了自动恢复能力，可能将用户留在无法自动核验的状态。应先可靠保留内存中的广播结果，并让控制器获知，再尽力写入持久记录；持久化失败不得把已广播交易当作未发送，也不能直接开放重发。

### P1：已经确认失败，仍显示“结果未确认”

证据：`apps/web/src/controllers/create.ts:103`、`:184-189`；新增 `persisted paused diagnostic` 用例。

恢复发现回执已回滚/取消后更新了 phase/detail，但保留旧 diagnostic。渲染优先读取旧 diagnostic 中的 pending 标记，因此可能继续显示：

> Your transaction outcome is not confirmed yet. Check your wallet history and keep tracking it. Do not submit another launch.

应以最新已验证的回执覆盖旧诊断状态，准确区分已回滚、已取消和仍未知，再决定是否允许重试。还应检查各恢复分支与现有多记录交易 journal 的清理格式一致性，不能只修改一句文案。

### P2：不同故障共用笼统提示，下一步不明确

证据：`apps/web/src/create/launch-diagnostics.ts:25-32`；新增文案矩阵。

明确专用提示目前集中在报价超过确认上限、报价过期、拒签、资金不足。授权回滚、交易回滚、账户/网络改变、模拟失败、兑换路线不可用及连接异常等，常落到同一条“preparation or verification”提示；上传阶段也未充分区分限流、授权失效和临时存储失败。

应使用已知失败阶段 + 已完成步骤 + 已验证交易状态产生用户语言：发生了什么、是否已购买配对资产/提交创建、是否可重试、下一步是什么。不能不加区分地让用户检查钱包历史，也不应把 RPC 原文、内部错误码或安全校验细节直接输出。

### P2：已经创建成功，但数据准备可无限等待

证据：`apps/web/src/create/launch-readiness.ts:5-27`、`apps/web/src/controllers/create.ts:72-96`；新增接口持续 503 用例。

readiness 要求身份/配置及统计、Holders、图表、成交、费用区存在，且价格和 MC 非空；无成交的零值和空数组是有效数据。读取失败全部吞掉，每轮后 3 秒重试，无整体时限。测试验证失败后未返回、只有显式取消才终止；无限循环结论同时来自源码。

这符合“不把链上成功说成失败”的原则，但共享报价缺失、索引异常或接口长期不可达时，用户会长期停在准备动画。修复不能用假数据或提前成功页掩盖：继续满足用户要求的完整数据就绪门槛，同时明确区分链上已创建和页面数据准备；利用现有进度区域表达恢复状态，自动恢复同一个项目，禁止重复创建。后台应保存和补齐初始化字段，而不是依赖用户反复刷新。

## 分阶段场景矩阵

标记：**执行** = 自动化注入/现有可执行测试覆盖；**审查** = 源码推导，未完整端到端注入。共 36 组场景，不代表穷尽所有外部钱包/提供商故障。

| # | 场景 | 验证 | 当前结果与用户提示评价 |
| --- | --- | --- | --- |
| 1 | 正常创建，不首买 | 执行 | 创建路径有正常用例；无首买不应要求 ERC20 余额 |
| 2 | ETH 首买 / 使用已有 ERC20 首买 | 执行 | 原生金额、ERC20 余额来源及原子创建校验有覆盖 |
| 3 | 名称、Symbol、描述或金额非法，异常大整数 | 执行+审查 | Content/兑换参数及合约校验拒绝；没有覆盖每一种表单输入的真实浏览器文案 |
| 4 | 开启质押未选有效资产 / 关闭却携带非零资产 | 执行 | 拒绝或规范化配置，不可绕过校验 |
| 5 | 不支持的 LP fee、Creator tax 或配置组合 | 执行 | Factory 校验拒绝；模拟失败文案需更具体 |
| 6 | 未连接、错误网络、签名前换账户/断开钱包 | 执行 | 执行器不发送交易；网络/账户错误最终提示可能通用化 |
| 7 | 确认后修改表单或换钱包 | 执行 | 原确认失效，不使用旧确认执行新配置 |
| 8 | 用户关闭二次确认 | 执行 | 不开始上传或钱包操作 |
| 9 | 拒绝上传消息签名 | 执行+审查 | 分类为拒签，不应当作链上交易；需指出当前仅为上传签名 |
| 10 | 上传挑战过期、重用、签名人/内容/origin 不匹配 | 执行 | 授权拒绝；上层主要显示统一上传失败，缺重新授权指引 |
| 11 | 图片超大小/尺寸、内容字段越界 | 执行+审查 | 有大小/尺寸/内容校验；真实浏览器各种损坏图片未逐项验证 |
| 12 | 上传额度/请求限流 | 审查 | 后端 429；前端上传文案没有清晰说明稍后重试 |
| 13 | Pinata 暂时失败、完成接口重试 | 执行 | 本地集成验证可重试并最终就绪；不是实际 Pinata 故障演练 |
| 14 | 未知/失效上传会话 | 审查 | 部分 complete 错误可能归为 503；需区分无效会话与临时服务故障 |
| 15 | IPFS 图片网关不可达 | 审查 | 有诊断分类；未模拟真实跨地区浏览器网关故障 |
| 16 | ETH 不足：发行费、购买成本、Gas 合计不足 | 执行+审查 | 有余额/模拟检查与资金不足提示；余额可能在检查后变化，不能保证成交 |
| 17 | 配对资产不足但 ETH 足够 | 执行 | 仅购买缺口；余额已补足时跳过购买，减少重复买入 |
| 18 | 报价过期 | 执行 | 拒绝旧报价，明确提示刷新并重新确认 |
| 19 | 新报价恰好为预估 ETH 的 110% / 超出 110% | 执行 | 边界接受 / 超出拒绝；向上取整、刷新不复利加上限有测试 |
| 20 | 刷新报价改变资产、购买数量或收款人 | 执行 | 拒绝；这是授权边界，不应取消 |
| 21 | SATS/BND、未知 Stock 或不支持路线 | 执行 | 路线拒绝，暂停项目不调用 RPC；用户提示仍需区分不可用与暂时失败 |
| 22 | 池子深度不足、价格在模拟后继续移动 | 审查+构造测试 | 有路由编码/上限/模拟保护；没有逐池真实深度或交易夹击实测，仍可能链上回滚 |
| 23 | 买到配对资产后，取消/失败于创建步骤 | 执行+审查 | 兑换为独立交易，资产留在钱包；Docs 应明确，不应再次买入已足够的余额 |
| 24 | Approve 拒签、模拟失败、链上回滚 | 执行 | 不继续创建；拒签较清楚，授权回滚仍泛化 |
| 25 | Approve 成功，创建模拟失败 | 执行 | 只发送授权，不发送创建；应说清“授权完成，代币尚未创建” |
| 26 | Registry 暂停/绑定变化/经济参数变化 | 执行 | 合约或模拟拒绝；提示不应泄露内部绑定细节 |
| 27 | 重复身份/预测地址冲突 | 执行 | 合约拒绝；需明确修改相关创建信息或恢复原创建，不宜笼统重试 |
| 28 | 创建内首买失败、最小输出不满足、退款失败 | 执行 | 原子交易整体回滚；此前独立购买/授权不会随之撤销 |
| 29 | 非标准 ERC20、转账扣费、失败返回值、重入/回调 | 执行 | 本地合约测试验证拒绝及状态回滚；不代表所有未知恶意代币均穷尽 |
| 30 | 钱包超时、RPC 回执读取失败、刷新页面 | 执行 | 已保存交易恢复读取，不重复广播；当前未知状态文案仍要求用户查钱包 |
| 31 | 加速替换、取消替换及取消后超时 | 执行 | 执行器保留替换状态；控制器恢复旧诊断可能与最终结果矛盾 |
| 32 | 重复点击、相同操作并发 | 执行+审查 | 执行器同操作合并，控制器有浏览器锁；真实多标签/多设备并发未实测 |
| 33 | 浏览器不支持锁、存储已满或记录损坏 | 执行+审查 | 存储前置失败阻止发送，损坏记录保守保留；具体浏览器兼容提示未端到端验收 |
| 34 | 广播完成后存储才失效 | 执行 | **缺陷：交易可能已发出但恢复记录与 submitted 更新缺失** |
| 35 | 链上成功，验证调用暂时失败；无关/伪造回执 | 执行 | 重试验证，不再发送；回执身份匹配校验拒绝伪造 |
| 36 | 链上成功，但报价/索引/详情字段持续缺失 | 执行+审查 | **准备循环可无限持续；不能认定为创建失败，也不能重复创建** |

需要保留的业务边界：ETH 10% 支付上限、正确账户/链/收款人、额度与余额检查、签名内容绑定、模拟、回执身份及防重复提交。价格在允许范围内变化不应擅自增加其他拦截；超过已确认预算则必须重新取得确认。

## Docs 是否需要补充

**需要，但应短而面向用户，不是内部错误码手册。** 放在现有 Launch / Help & support 下的一个排障小节即可，不增加弹框、免责声明或交易追踪组件。现有 Docs 已提到签名、授权、交易和恢复，但不足以解释各步骤独立完成及失败后的资产归属。

优先写明：
1. 消息签名用于发布资料，不代表链上创建。
2. 购买配对资产、授权和创建可能是不同交易；前面成功的步骤不会因后续取消而撤销。
3. 钱包要同时覆盖发行费、可选首买及网络费；失败的已上链交易仍可能消耗网络费。
4. 购买缺口使用预估 ETH 加 10% 的上限；超限需刷新并确认，不承诺任何价格下必定创建成功。
5. 已确认失败与尚未确定结果不同；应用应自动核验，未明确结果前不重复创建。
6. 链上成功但数据准备延迟时，恢复已有项目，而不是重新发行。
7. 联系现有 X 私信或 info@tickergarden.com；可提供网络、公开钱包地址、代币名、时间和错误参考编号，不索要助记词、私钥或签名。

建议英文草稿（**未写入产品 Docs**；涉及自动恢复的表述须在对应代码修复验收后上线）：

> **Trouble launching?**
>
> If your wallet request was declined, return to the form when you are ready. Signing the upload message publishes your token details; it does not create a token onchain.
>
> Make sure your ETH balance covers the launch fee, any purchase of the paired asset, and network fees. You can reduce or skip the optional Developer buy. A transaction that fails onchain may still use network fees.
>
> When ETH is used to buy a missing paired asset, the maximum payment includes a 10% allowance over the estimate you confirmed. If the updated cost exceeds that limit, refresh the quote and review the new total.
>
> Purchasing the paired asset and approving it are separate from launching. If either step completes but the launch stops, purchased assets remain in your wallet and an approval does not create a token. Continue using your updated balance.
>
> If a transaction has been sent, let the app confirm its outcome before starting again. If the token has already been created, a delay preparing its page does not mean you need to launch another one.
>
> For help, message us on X or email info@tickergarden.com with the network, token name, approximate time and error reference, if available. Never share your recovery phrase or private key.

## 后续验收门槛

先修上述恢复和提示缺陷，并将特征测试改成目标行为断言；再做浏览器注入的完整流程验收：拒绝消息签名、授权后取消、兑换后取消、广播后断网/刷新、回执替换/回滚、存储中途失败、数据接口持续 503 与恢复。钱包扩展拒签、真实主网池子可成交深度、Gas 波动及链重组需独立测试/受控 Fork，不能用本次 mocks 的通过结果代替。
