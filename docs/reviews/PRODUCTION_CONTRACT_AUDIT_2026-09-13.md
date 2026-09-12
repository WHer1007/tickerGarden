# RH 生产候选：合约安全与参数审计

日期：2026-09-13（Asia/Shanghai）。代码提交：`7533461010c2439b328cd36c46bdb3842e68d8d7`，分支 `codex/production-treasury-audit`。

**结论：本地一致性与合约回归通过；NOT_PRODUCTION_READY；NOT_BROADCAST。** Treasury 优化已经实现并提交，但主网部署路径、真实 Fork、最终多签及运行配置尚未闭环，不能把这次提交当成上线许可。

## 范围、方法和证据边界

本轮检查 Factory → Curve → Graduation → Hook/PoolManager → FeeVault 的交易与收费链路，Stock Registry → Vault → Allocation/Gauge 的本金和奖励链路，以及 Holder、Creator、权限交接、确定性部署、参数与 ABI 的一致性。审查关键授权、外部调用、余额守恒、重入、整数边界、退出可用性和配置升级语义，运行全部本地合约测试及相关跨层检查。

[参数机器审计](evidence/production-contracts-2026-09-13/parameter-audit.json)包含 72 个生产 Solidity 文件 SHA256、常量清单、数值边界、生产配置模板全部键、空值清单和输入文件哈希；72 个源文件逐一与上述 commit 内容匹配。常量扫描用于可追溯清单，不等于形式化证明。读取的配置是公开 example，未读取私钥或秘密环境文件。

这是内部代码审查及回归审计，不是独立第三方审计或正式验证。Slither 未安装、未运行；真实 Fork 未通过。前端/后端测试在包含既有未提交产品改动的工作区执行，仅说明兼容性；它们不证明本次代码提交独立包含这些产品改动。审计不覆盖未提供的生产 Safe 内部状态或未部署实例。

## 已落地的修复

| 项目 | 改动与保护 | 验证 |
|---|---|---|
| Treasury 单一来源 | FeeVault 保存当前 Treasury；Factory 每次创建费支付读取同一来源 | Factory 跟随新 Treasury、构造 authority 不一致拒绝 |
| Treasury 迁移 | Governance 直接提议；新 Treasury 自身确认；提议起满 48h 后执行；治理/Guardian 可立即取消 | 14 项专项测试，含时间模糊测试、旧 nonce、撤权、代码变化、重入和忙碌状态 |
| Treasury 资金语义 | 未领取的平台费用在领取时付给当前 Treasury；旧钱包已收资金不迁移 | Native/ERC20、既有平台负债、其他受益人权益隔离 |
| Stock 身份检查 Gas | 初次注册 Vault 扫描字节码，日常继续 codehash 和依赖绑定校验 | 身份变化拒绝与 Gas 回归 |
| Vault 本金缺口 | 收入新存款前检查实际余额不低于既有 totalDeposited | 外部扣减后新存款拒绝；正常资产路径通过 |
| FeeVault 余额读取 | 复用付款后实际余额用于最终偿付检查 | 恶意资产、跨资产余额扰动、偿付边界测试 |
| 兑换失败 fallback | 有界兑换子调用，保留完成和付款 Gas | 耗尽兑换 Gas 的 Quote/raw fallback 与回滚权益保护 |
| 发布一致性 | ABI、权限矩阵、生成清单、构造参数及部署预检一起更新 | 87 个 mutation；部署 66 项、spec 63 项通过 |

Treasury 的 48h 是 FeeVault 状态延迟，**不再叠加 AccessManager.schedule 的 48h**。其直接入口只承认 AccessManager 活跃 role 1（治理）；取消额外允许 role 2（Guardian）。到期执行公开，但检查原提议者仍有治理角色。不得通过给 PUBLIC 配置 AccessManager selector 绕过成员检查。

详细操作见 [Treasury 迁移流程](../runbooks/PLATFORM_TREASURY_ROTATION.md)。此变化用于新部署；不会升级既有不可升级合约，不能沿用旧 initcode hash、预测地址或签名。

## 发布阻塞

### B1：原子部署超过 RH 单笔 Gas 上限

本轮公开 RPC 只读实测 chainId=4663，`getMaxTxGasLimit()` 和 `getMaxBlockGasLimit()` 均返回 **32,000,000**。20 个组件当前运行时代码合计 **225,419 bytes**，仅代码存储就至少 **45,083,800 Gas**，尚未计入构造、初始化、存储和外部调用。现有一次性原子部署无法装入该上限。

证据：[网络原始观察](evidence/production-contracts-2026-09-13/rh-network-observation-node.json)、[组件字节码清单](evidence/production-contracts-2026-09-13/runtime-sizes.json)。网络观察时间为 `2026-09-12T18:22:52.941Z`；这是点时证据，广播前仍须复核。此前 urllib 请求 403 也保留，最终成功值来自 Node fetch。

解除条件：实现并审计 RH 4663 分阶段部署计划，每笔低于上限且留余量，绑定部署者、releaseId、组件地址、初始化参数与代码哈希；防止第三方抢先初始化、重复执行或错序完成。现有测试网 staged 脚本锁定另一 chainId，不能直接替代主网计划。生成新 unsigned 交易包，在离线签名端复核，再完成真实链模拟与回执验收。本次没有扩展实现新的主网部署架构。

### B2：必需的真实 Fork 未通过

固定块 `55747994`，hash `0xd7bc428f76e456752aed5c129204b1aed67239a2cb824f1be544d41dcd60df78`。公开 RPC 和仓库兼容代理分别尝试后，均在 Foundry 读取历史状态时返回 `-32000: metadata is not found, 55747997`。前面的六项本地 adversarial fixture 测试通过，不代表后面的 Fork 通过。

解除条件：取得能提供该固定块历史状态的 RPC，重新运行完整 fork track；若正式更新固定块，必须按仓库流程同时更新身份、代码哈希、池状态与审查证据，不能仅换成 latest 绕过。

### B3：旧部署计划不匹配新合约；最终 Safe 与权限交接未验证

当前 `check:deployment-track` 对历史 testnet plan 返回 `Invalid V1 deterministic ordinary component order`，已保留失败。没有修改旧证据或放宽检查使其假通过。新 release 必须重新生成地址、initcode/runtime hash、87 项权限及配置证据。

两个已部署 Safe 的地址尚未提供，无法确认其位于 RH 4663、owners/threshold、singleton、modules、guard/fallback handler 或 ETH/ERC20 收付能力。最终 Governance、Treasury、Guardian、Unpause、bootstrap admin 撤权仍需要逐项链上核对。`TG_RUNTIME_CONFIGURED=false`；清单选入不等于链上 Registry 已激活。

## 剩余安全与经济风险

| 编号/级别 | 条件与后果 | 现有保护、剩余处理 |
|---|---|---|
| S1 高：外部 Stock 发行权限 | 发行方升级、冻结、黑名单或管理员扣减 Vault 余额，可以影响退出与交易；历史快照不能保证未来行为 | 已阻止短缺时新存款填旧损失；仍不提供缺口按比例分摊。外部扣减后的既有提现存在先到先得风险，足额本金不能保证。生产需监控并停用新增准入、明确损失处置政策 |
| S2 高：奖励兑换无最低到账约束 | 自动奖励兑换使用宽价格界限，缺少 minOut/price-impact 保护；低流动性或 MEV 可使成交不利，即使技术上成功 | 这是既有明确产品政策，未擅自改为预设滑点；可选择 raw 领取。大额兑换前应重新评估是否需要用户提供 minOut/deadline；私有提交不能保证消除风险 |
| S3 中：Safe 外层 codehash 不代表配置安全 | owners、threshold、module、guard 或代理内部实现变化可能不改变外层字节码；确认地址有代码不等于认证 Safe | 提议时 pin 外层 hash、接收方自身确认、48h Guardian 响应；仍需 Safe 状态与事件监控，不应只做 extcodehash 检查 |
| S4 中：治理与取消的运行假设 | 治理密钥被控制且 Guardian 未响应，可在48h后重定向平台收入；取消无法撤回抢先打包的执行 | 不授予转移用户本金/Creator/Holder/Staker 权益能力。撤销提议者角色时同时取消待执行提议；以后重授同角色会重新满足活跃成员条件 |
| S5 中：接收和兑换可用性 | Treasury 拒绝 ETH 会阻止创建；代币冻结、收款人回滚或异常高 Gas 付款可能让领取回滚 | 迁移解决未来收款，不能取回旧钱包资产。300k 完成预留不是任意恶意 token/receiver 的成功保证；失败回滚保留权益，不能等同于总能即时提取 |
| S6 中：资产准入不等于路由有深度 | 194 Stock/196 Quote 名单没有证明每一项原生资产首买路径和毕业后交易都具备生产流动性 | 发布前核对实际 PoolKey、fee/tickSpacing、PoolManager、Quote 余额和真实报价；固定 native router fee/tickSpacing 不能假定覆盖全部股票。直接持有 Quote 的路径也需实际测试 |
| S7 低：代码大小余量有限 | Factory runtime 23,880 bytes，仅余696；FeeVault 22,850，余1726 | 当前均低于24,576。以后任何修改都重算，不把测试高 Gas 配置当主网可部署证明 |
| S8 中：暂停能力边界 | Registry 的准入暂停不是所有已存在市场交易的全局紧急停止 | 运维不能承诺暂停会冻结所有已部署 Curve/Pool；用户 rageQuit 仍受资产自身可转账能力限制 |

S1 的历史 Stock 身份源已纳入提交。普通 ERC20 proxy 的外层 codehash 不能监测全部实现变化；选择显式 Stock 身份绑定时会校验已知依赖/实现，但不能消除发行方的冻结和扣减权限。不得把当前非 rebase 的观察写成永久不会余额减少。

## 参数逐项核对

### 已选定生产经济参数

| 参数 | 当前候选值 | 部署后语义 |
|---|---|---|
| Chain | RH 4663 | 禁止复用46630测试网地址和签名 |
| Quote 名单 | ETH + USDG +194 Stock =196 | 名单不是激活证明；Registry 治理准入 |
| Stake 名单 |194 Stock | 全部 minimumAllocation=0.5 token，即5×10^17 raw（当前18 decimals） |
| 最低总质押仓位 |0.5/资产 | 校验增仓后的总仓位，不要求每次 deposit 都≥0.5；治理可改，协议下限414 raw |
| ETH 毕业阈值 / 虚拟储备 |3 ETH /1.2 ETH | 新配置版本影响后续创建，既有市场冻结其创建参数 |
| USDG 毕业阈值 / 虚拟储备 |7000 /2800；6 decimals | raw=7,000,000,000 /2,800,000,000 |
|194 Stock 毕业阈值 |按2026-09-12参考价格折算7000USD，ROUND_HALF_UP保留2位 | 固定token数量；股价变化不会自动跟踪7000USD |
| 全部 Quote 虚拟储备 |阈值的40% | 两位小数要求用于Stock阈值，虚拟储备按40%精确计算，不另行强制2位 |
| Stock 参考价 |(bid+ask)/2 × multiplier |194项逐项复算，multiplier只乘一次 |
| Launch fee |0.0005 ETH | 转到当前 Treasury，不存入 Stock Vault |
| Meme 总供应 |10^27 raw，18 decimals，即10亿 | 曲线出售/池储备由冻结的经济公式推导 |
| 毕业池基础手续费 |1%；PoolKey.fee=0、LP fee=0 | Core protocol fee 独立，不计入平台FeeVault分配 |
| 费用分配 |有Active stake：Creator40/Staker30/Platform30；否则70/0/30 | 整数余数归Creator；Holder模式按已选收益政策执行 |
| Creator tax |上限500bps=5% | 与基础税组合仍受配置总税边界限制 |
| 开盘 anti-snipe 时长 |模板5秒 | 具体 baseline、初始/最终税率和完整调度必须在新release明确 |
| Stake 激活 / 锁定 |30秒 /24小时 | 增仓重置整个仓位锁定；rageQuit放弃全部未领收益 |
| Holder |24h stream；funding interval默认4h，范围1h–24h；最多24条 | 生产模式dual-asset-24h-v4；旧发行版不自动改变 |
| 治理 / unpause |48h /24h | Guardian取消/准入暂停按其对应权限；Treasury另用单个48h状态延迟 |
| 领取Gas预留 |完成300k，call开销30k，最低兑换100k | 内部可用性保护，不是交易统一gasLimit |

精确196项地址、阈值、phantom和194项Stake UID/下限见 [Quote清单](../../deployments/manifests/robinhood-mainnet-4663.paired-assets.json)、[Stake清单](../../deployments/manifests/robinhood-mainnet-4663.staking-assets.json)。自动检查了数量、唯一性、UID对应、6–18位decimals、int128边界及全部40%比例。ETH的3ETH是独立批准值，不宣称它始终等值7000USD。

### 尚须填入或重新证明的生产发布参数

| 类别 | 必需配置与验收 |
|---|---|
| 多签及角色 | Treasury/Governance Safe地址与配置；Guardian、Unpause角色；initialAdmin=预期bootstrap部署者，交接后撤销其ADMIN_ROLE；独立性约束核对 |
| 外部合约 | PoolManager、PositionManager、Permit2、SwapRouter、Quoter 地址、链ID、runtime codehash及相互依赖；不能照搬测试网 |
| 确定性构建 | 新releaseId、deployer、orchestrator、helper、hook salt及0x2044权限位、各组件预测地址、initcode/runtime哈希；solc0.8.26/Cancun/optimizer200/无metadata hash与CBOR |
| 收费和模板 | feePolicyId/hash、baselineId、templateId、Creator tax和anti-snipe完整曲线、所有pair economics及版本；所有选择进入签名绑定的配置清单 |
| 首买路径 | nativeQuotePoolFee、nativeQuoteTickSpacing及每个资产可用的真实池证据；这不是TickerGarden毕业池的固定零LP fee |
| 资产身份 |194 Stock UID/地址、beacon/implementation及codehash重新读链；USDG地址/decimals/代理和依赖；逐项激活Registry并留回执 |
| 部署交易 | 分阶段顺序、每笔gas上限、value、nonce、salt、chainId、offline签名摘要、失败恢复和重复执行保护；预算按新模拟重算 |
| 最终预检 | FeeVault authority一致；Factory/FeeVault Treasury一致；48h；pending=0、nonce=0；权限移交与发布状态证据 |
| 服务运行 | 数据库、RPC/archive、webhook签名及回补、只读API、价格统计、监控和告警；模板finality600s/2blocks不应阻止已确认创建事件立即入库；Vercel仅sin1 |

## 验证结果

| 检查 | 本轮结果 | 证据/限制 |
|---|---|---|
| 全本地合约（排除fork目录） |89 suites，1001通过，0失败/跳过 | [完整日志](evidence/production-contracts-2026-09-13/full-contracts.log)；含fuzz和invariant |
| Factory补充复核 |68通过 | [日志](evidence/production-contracts-2026-09-13/factory.log)；增加authority不一致断言后重跑，生产源未改 |
| Execution spec |63通过 | [日志](evidence/production-contracts-2026-09-13/spec.log) |
| Deployment模块 |66通过，build通过 | [日志](evidence/production-contracts-2026-09-13/deployments.log) |
| 前端兼容回归 |364通过、build通过 | 工作区兼容性；存在既有大chunk警告 |
| 后端单元/工具 |9+50通过、build和ABI/OpenAPI边界通过 | 未重跑PostgreSQL集成；不等于生产DB验收 |
| ABI/接口/产品生成物 |一致性检查通过 | canonical、interfaces、product artifacts、paired-assets generator |
| 工具回归 |24通过 | CI track、RPC兼容代理、build-input验证 |
| Forge fmt / git diff |通过 | 无格式或空白错误；无新增依赖 |
| 参数计算 |196 Quote、194 Stake、194价格计算通过 | [机器报告](evidence/production-contracts-2026-09-13/parameter-audit.json) |
| 真实Fork |失败/阻塞 | [直连](evidence/production-contracts-2026-09-13/fork.log)、[兼容代理](evidence/production-contracts-2026-09-13/fork-compat.log) |
| Deployment track |失败/阻塞 | [历史计划失败](evidence/production-contracts-2026-09-13/deployment-track.log) |

复现核心命令：

```sh
python3 tools/audit-production-parameters.py
python3 tools/generate-v1-paired-assets.py --check
node tools/run-forge.mjs test --no-match-path 'test/v1/fork/**'
npm run test:spec
npm --prefix deployments test
npm --prefix deployments run build
npm run check:fork-track
npm run check:deployment-track
```

后两项需要对应有效RPC/新计划；本报告不将其标为通过。平台手续费迁移测试包含在1001项中，不能另加14重复计算。

## 发布验收顺序

1. 修复RH4663部署分阶段方案，生成新release与离线签名交易包，验证每笔Gas、初始化授权、依赖与可恢复性。
2. 补齐真实Fork和新deployment track；确定生产外部依赖及196/194项资产激活证据。
3. 核验两套Safe和Guardian/Unpause权限，演练Treasury提议、取消、到期迁移和Native/ERC20收款，撤销bootstrap权限。
4. 对S1/S2等经济与外部资产风险取得明确发布决策；完成独立安全复核、许可证/来源差异审查和监控预案。
5. 新部署先验收回执与所有绑定，再执行完整业务演练/仓库规定的canary和运营签署；全部门槛满足后才可标记DEPLOYMENT_ELIGIBLE。

此次没有上链、没有签名、没有发送任何交易，也没有推送远端。生产相关代码、参数与必要ABI已独立提交；其余既有产品改动保留在工作区。
