# Create 页面与 Pons V2 对齐

更新：2026-09-05。范围：现有 `apps/web` 创建页、创建元数据服务、配对资产发布清单与生产 preflight。未修改合约手续费分配，也未广播部署或 Registry 激活交易。

## 用户流程

名称、Ticker、简介、图片（PNG/JPG/WebP，2 MB 上限）、X、Website、Paired asset、Developer buy。保留本项目必需的 Rewards stock：它是质押奖励的 STOCK 基础资产，和交易用的 Paired asset 是两个不同的角色。

底层 baseline 和 launch template 自动选择。Creator wallet 留空始终使用当前连接钱包。Developer buy 空或零调用 createMarket，正数调用已有原子的 launchAndBuy；ERC-20 授权、slippage、模拟和回执校验保持原有链路。上传期间锁定表单，确认上传前后 metadata 内容与钱包没有变化。

Advanced 展示 Creator wallet、Creator tax 与「创建者手续费分配给持有人」开关。手动 slippage 和 Hosted metadata 已从页面移除，资料由保存服务自动生成 URI。Creator tax 支持 0–5%，在固定手续费之外额外收取，并在创建时固定；Curve、Hook 和前端创建参数已接通，详见 [Creator tax 规则](V1_CREATOR_TAX.md)。当前实现尚未部署，发布仍受运行时就绪检查约束。该不可变开关默认关闭；开启后，50% 的 creator base fee share（不含 creator tax）分配给持有人，创建者保留另外 50% 的 base fee share 和 100% creator tax。Factory 创建时登记 holder fee sharing 配置；不存在额外 per-user deposit 步骤。Holder period 从市场创建开始，按 30 天余额时间加权；Quote 在 FeeVault 入账时（包括 curve sweep 时）归属当前 period。Meme 转 Quote 保留原 creator epoch。Root 仍可能延迟，不能宣传已部署的自动 keeper 或即时领取。

## 毕业门槛

一手页面：https://www.ponsfamily.com/launchpad/create

本次公开前端与 RPC 查询的 Pons V2 Factory：`0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`，Robinhood mainnet 4663。

Pons 页面原生 ETH 使用 launch config 的 raw `graduationThreshold`；非原生配对读取 `pairTokenEconomics(token)` 的 raw `phantomQuote / graduationThreshold / decimals`，按该资产 decimals 显示。没有把每种资产都设成 4.2，也没有浏览器实时美元换算：

| 配对 | decimals | phantom | graduation threshold |
|---|---:|---:|---:|
| ETH | 18 | 1.68 | 4.2 |
| NVDA | 18 | 16.64 | 41.6 |
| USDG | 6 | 3236 | 8090 |
| cbBTC | 8 | 0.052739 | 0.13184752 |

我们显示自己的 ACTIVE Registry 配置；尚未激活时显示明确标记为 release target 的观测快照。选择只有同链、ACTIVE、地址/decimals/phantom/threshold 一致才进入现有 Factory 校验，静态名单不能替代链上批准。

“raises”指净实际 Quote，排除虚拟储备、交易费和 launch fee；不是买入总额、token market cap 或流动性池总价值。PonsSupplyMath 的整数分区也不能忽略：

```
reserved = floor(supply * phantom / (phantom + threshold))
sellable = supply - reserved
requiredNet = ceil(sellable * phantom / reserved)
```

1 billion × 10^18 supply、1.68 ETH phantom、4.2 ETH threshold 对应 requiredNet 为 `4200000000000000001` wei。页面主文案仍显示配置门槛 4.2 ETH，Calculation details 显示精确最低净入金；其他资产同样使用 BigInt。不能统一用 floor + 1，恰好整除时必须是数学 ceil。最后一笔交易可能部分成交并退款，以真实模拟为准。

## 发布白名单与证据

正式产品候选清单：`deployments/manifests/robinhood-mainnet-4663.paired-assets.json`。56 项包含 ETH + 55 个非原生资产，与本次 Pons V2 列表一致，排除当时未获批准的 WETH。它由 `python3 tools/generate-v1-paired-assets.py` 从观测证据确定性生成，前端直接读取同一文件，deployments tests 校验生成漂移，生产 preflight 校验发布成员与参数。

53 个股票代币通过 Robinhood 官方 `https://api.robinhood.com/rhj/assets` 按 chainId + address 匹配 assetUid、symbol、decimals、status 与 currentMultiplier。所有 55 个 ERC-20 又读取了链上 symbol、decimals 和 runtime codehash。currentMultiplier 仅保留为观测信息，不再次乘入 Pons 已冻结的 raw economics。

查询证据位于 `outputs/reviews/pons-v2-create/`。RPC finalized/historical 路径没有得到可用的完整状态，latest 查询非原子；观测区块是上下文，不被冒充为所有读取的固定 finalized block。发布前仍需补齐最终区块指纹、精确转账、官方 Stock 专用准入、配置哈希及治理回执。

USDG 与 cbBTC 的 EIP-1967 implementation/admin slot 和 runtime codehash 记录属于管理员风险审查信息，不构成协议层面的代理、opcode 或不可升级性禁令。Quote 资格唯一的准入门槛是管理员逐资产风险审查并登记到白名单；因此包括可升级 USDG、cbBTC 在内的任意 Token 都可以进入 `REGISTRY_ACTIVATION_REQUIRED` 流程。通用 `addQuoteConfig` 支持普通 Token 和 Stock proxy；可选的 `addStockQuoteConfig` 可提交明确的 Asset UID、Beacon、implementation、codehash 与 proxy-slot fingerprint commitments，但不是 Quote 准入的必要路径。当前仍未激活任何配置，也未广播链上交易。

此清单仅适用于 mainnet 4663，禁止把这些地址用于 testnet 46630。候选清单未改写 bootstrap 示例为 ACTIVE，也不等于链上治理已激活。

## 元数据持久化配置

新增 `/launch-metadata` 命名空间，和现有 GET-only read API 分开；不提交链上交易，不持有私钥。不配置时该写入服务保持关闭。

Backend 环境：

```
TICKERGARDEN_METADATA_DIRECTORY=/absolute/persistent/metadata
TICKERGARDEN_METADATA_PUBLIC_ORIGIN=https://metadata.example.com
TICKERGARDEN_WEB_ORIGIN=https://app.example.com
```

Frontend 构建环境：

```
VITE_LAUNCH_METADATA_ORIGIN=https://metadata.example.com
```

本地开发支持 localhost HTTP。发布使用稳定 HTTPS origin 和持久卷，反向代理限制公开上传速率和存储容量。POST 校验 exact Origin、3 MB body、字段、图片 magic bytes 和社交域名；JSON 与图片以 SHA-256 内容寻址原子写入，GET 验证哈希，immutable cache + nosniff。URI 才写入现有 Factory 参数，图片/简介不会仅停留在预览。不再要求用户填写 Hosted metadata；保存服务返回的 URI 自动传入 Factory。Website 写入 external_url 和 properties.website，国库偏好与税率草稿写入 properties.launch；这些声明不是链上激活证明。

## 验证

- `npm --prefix apps/web test` / `npm --prefix apps/web run build`
- `npm --prefix services/backend-api test` / `npm --prefix services/backend-api run build`
- `npm --prefix deployments test` / `npm --prefix deployments run build`
- `python3 tools/generate-v1-paired-assets.py --check`
- `node outputs/designs/create-pons-v2/check.cjs`：桌面/手机、56 项、不同精度门槛、首购切换、图片预览、Advanced 和禁用状态。

本次结果：前端45/45、后端20/20、新增发布白名单3/3及三处构建通过；浏览器桌面/手机检查通过。完整deployments测试50/52，旧artifact evidence哈希与Beacon错误文案断言两项未通过；未重写旧证据来宣称发布全绿。

2026-09-05 页面进一步简化：移除手动 Developer buy slippage，仍使用模拟结果的自动100bps最低到账保护。已执行原子发布/首购25项合约测试，全部通过，包括购买失败回滚和退款。ERC20首次使用可能先需approve交易；创建和购买本身保持原子。
