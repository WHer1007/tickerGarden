# RH 主链 Quote 毕业阈值与变更流程

## 当前生产决策（2026-09-12）

- ETH 毕业阈值：3 ETH，原始数量 `3000000000000000000`。
- ETH phantomQuote 已确认同步调整为 1.2 ETH，原始数量 `1200000000000000000`；与 3 ETH 毕业阈值保持 40% 的比例。忽略整数舍入时，毕业前售出约 71.43%、入池约 20.41%、额外永久锁定约 8.16%，毕业价约为初始价的 12.25 倍。最终候选仍须重新生成配置哈希并验证。
- USDG 毕业阈值已批准为 7,000，虚拟储备 2,800；6 位精度，raw 分别为 `7000000000` / `2800000000`。所有生产 Quote 的 P/G 统一为 40%；原始阈值需可被 5 整除以精确表示，不隐式舍入。
- 194 个官方 Stock Quote 已按 2026-09-12 官方中间参考价（乘一次股份乘数）计算 7,000 USD 等价毕业阈值，四舍五入保留两位小数；虚拟储备精确为舍入后阈值的 40%。见[完整计算明细](../references/RH_ALL_STOCK_QUOTE_THRESHOLDS_2026-09-12.md)。价格变动不会自动修改这些固定数量。
- 生产范围为 194 Stock + ETH + USDG，共 196 种 Quote；cbBTC 已从生产范围移除，所有选中 Quote 参数均已确定，仍须资产审核及链上激活。
- master 示例、本地 master 配置、环境校验策略、生产清单及生成器已同步。测试网配置不变，未部署或广播。

## 部署后能否更改

可以为以后创建的市场增加新版本，不能原地修改旧配置，也不能改变已创建市场的阈值。

`ApprovedQuoteRegistry.addQuoteConfig` 的 configId/economicsHash 包含 chainId、baselineId、Quote 地址、decimals、phantomQuote、graduationThreshold。改变阈值必须产生新 configId；已有 configId 会以 QuoteConfigAlreadyExists 拒绝覆盖。Stock 显式绑定路径通过 addStockQuoteConfig 生成对应的新哈希并重新验证绑定。

Curve 构造时将 graduationThreshold 和 quoteAssetConfigId 固定为 immutable。Registry 的 pause/retire 只改变该配置后续的准入状态，不回写旧 Curve。

## 管理员操作顺序

1. 准备新阈值及原始 token 数量，核对 decimals、phantomQuote、baseline 和曲线/毕业经济域；如同时更换 baseline，先准备并登记新的 baseline。重新生成 configId/economicsHash、候选证据并审阅模拟结果。
2. 治理多签通过 AccessManager `schedule(ApprovedQuoteRegistry, encodedAddQuoteConfig, when)` 排期。当前生产角色方案是 PROTOCOL_ADMIN_ROLE 48 小时延迟；以实际部署角色延迟为准。Stock 显式绑定选择 encodedAddStockQuoteConfig。
3. 延迟到期后，由同一治理多签执行 AccessManager `execute(ApprovedQuoteRegistry, sameCalldata)`。参数必须与排期一致；成功后新配置已为 ACTIVE。
4. 后端订阅登记事件并刷新数据库配置；同时更新批准的生产清单及前端选择规则。当前前端和部署验证器都要求参数与批准清单相符，链上新增配置不会自动绕过本地生产参数约束。
5. 如果必须停止旧阈值的新建市场，需要将旧 configId 停用：治理多签排期 retireQuote（48 小时）；或独立 Guardian 执行 pauseQuote（无角色执行延迟）。可提前排好新建与 retire 两个操作，到期连续执行；存在无缝切换要求时需准备并验证同一多签批次。仅切换 UI 默认值不能禁止别人直接调用旧 ACTIVE 配置创建市场。
6. 核对回执、新/旧状态、新建市场使用的 configId 与 Curve 经济值、权限及数据库/前端一致性。保留历史配置和已有市场读取能力。

## 示例

ETH 配置 A 为 3 ETH，已有市场 X 使用 A。之后登记配置 B 为 5 ETH，并 retire A：新市场使用 B；X 继续按 3 ETH 毕业。尚未毕业的 X 也不会自动变成 5 ETH，已毕业市场更不受影响。

本流程不需要重新部署整套协议来增加阈值版本；需要改变已经创建市场的阈值则当前架构不支持，不能用管理员操作绕过。
