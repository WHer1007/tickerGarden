# RH 测试网 Locker 修复版本复核与部署

日期：2026-09-13。源码提交：`375cfff`。本次范围为当前 V1 合约、规范、测试与部署工具；保留工作区中另行开发的前后端改动，不切换网站及已有市场。

## 复核结论

当前候选未确认新增的阻断测试网部署问题。Locker 外部余额隔离与缺口恢复修复已通过 ERC20/native、外部余额干扰、连续复投、隔离账目保护、部分恢复和失败回滚回归。部署验证额外检查 Locker 创建代码 hash、FeeVault authority/Treasury、默认 keeper 及 Meme burn mode，防止部署旧代码或接错依赖。

Creator/Staker 未领取时不销毁、紧急退出罚没 Meme 转归平台后不销毁，按用户确认的设计保留。钱包快照仍信任发布者，错误 Root 可锁定或错付奖励；发布服务、proof API 和自动运营尚未验收，本次不配置发布者。LP fee 仍为 0，keeper 未配置，不表示已经启动自动复投。以上边界不因测试通过而消失，本报告不构成独立安全审计或主网放行。

## 验证

- 本地合约：92 套件、995 通过、0 失败、0 跳过；不含 Fork。
- 独立固定区块 RH 主网 Fork：业务集成 2 项，Locker/真实 Permit2 12 项；Locker fuzz 256 次，运行前后核对区块身份。
- 规范 63、部署工具 67、Web 384、产物一致性测试 3 项通过；合约构建、ABI、fixtures、后端构建及 OpenAPI 检查通过。
- 新部署批次 19 笔交易无签名模拟通过；发送端重新估算 gas，并按代码存储成本设置下限，总核心部署费用上限 0.02 测试 ETH。

日志、源码 SHA256 和 Fork 固定区块见 [验证证据](evidence/rh-locker-release-2026-09-13/verification.json)。Fork 依赖的主网地址与实际测试网部署依赖分别验证，不将两者混为同一环境。

## 部署结果

网络：Robinhood Testnet，chainId `46630`；发布 ID：`0x685b5c20e826f4ddd076b61216c7529a967322082925c4741469b0fda837a7f2`。

- Factory：`0xF11839C3566C8B3345Ed81E4A0e26cc38Aa2866A`
- LaunchAndBuyRouter：`0xdCe9a656Eb611A7Ee34651Ead17F3b76e2155756`
- Hook：`0x3D10b2891730dC11F352087B0703A93772d56044`
- 19 笔核心部署 + 4 笔激活交易成功。核心费用 `0.00055556297 ETH`，激活费用 `0.00007313123 ETH`，合计 `0.0006286942` 测试 ETH。
- 21 个核心合约 runtime 和关系核验通过。ETH quote、baseline、template 已激活；毕业阈值为测试用 `0.42 ETH`。
- 激活后 `previewMarketEconomics` 与 `launchAndBuy` 的真实链只读模拟通过，没有创建市场。`publicTestnetE2E=false`，不能视为实际交易完整业务 E2E。

激活交易成功后，旧冒烟脚本因遗漏 `burnMemeFees` 在本地 ABI 编码阶段失败。已补齐显式 `false` 并新增基于当前 ABI 的参数编码回归（工具提交 `22fd8e8`，5 项测试通过）；恢复执行读取并跳过 4 笔已确认交易，只重新验证，未重复发送。合约源码和部署字节码未变。

本次采用 release 独立 `paired-assets.json`，没有覆盖共享配对资产清单、网站配置或旧市场。snapshotPublisher、compoundKeeper 为零地址；未注册 Stock quote，未启动自动发布/复投。

完整地址、回执、激活、证书和公共预检文件见 [发布目录](../../deployments/releases/0x685b5c20e826f4ddd076b61216c7529a967322082925c4741469b0fda837a7f2/release-status.json)。`preflight/` 和 `simulation/` 保存原 `outputs/reviews` 文件副本，证书中的输入路径为执行时路径。最终链上状态核验另见证据目录 `final-chain.log`。

构建与接口长日志以 `.log.gz` 归档；文本日志仅规范化行尾空白，保留验证输出内容。
