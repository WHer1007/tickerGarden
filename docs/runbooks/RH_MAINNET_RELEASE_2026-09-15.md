# RH 4663 生产候选执行手册

本手册对应 `docs/reviews/evidence/production-release-2026-09-15/` 中的候选。仅用于准备、审查与后续获明确授权的操作，不构成广播授权。历史 `before-registry-cache/` 是高 Gas 方案的对照证据，不能用于签名。

## 发布内容与顺序

共 34 笔交易：19 笔 runtime 安装、7 批 Stock（首批带 baseline）、7 批 Quote、1 笔最终激活及权限交接。Stock 每批最多 32 项，共 194 项；Quote 每批最多 32 项，共 196 项。单笔 `AccessManager.multicall` 将 `execute(target,data)` 顺序执行；它检查原调用者权限，无须给额外批处理合约授予管理员角色。

最后一笔交易依次包含：模板登记、Holder 发布者初始化、Keeper 初始化、selector 权限配置、Safe 角色授予、role admin 固定、部署者退权。其原子性确保市场模板不会在发布者、Keeper 和权限尚未完成交接时开放。任何一步失败，整笔最后交易回滚。

Holder 发布者和 Keeper 均为 `0x2cFb6cAa2042690fc928CE0ccE40F3828336dE44`。部署初始化完成时 Keeper 非零，链上复投可用；链下调度保持关闭，后期按需执行。

## 广播前

1. 执行 `npm run check:production-release`，确认 source/configuration lock、完整构造参数、确定性地址、嵌套批次 calldata、模拟结果、Gas 上限和独立构建一致。该命令只检查本地技术候选，不执行交易。
2. 审查 `transactions.unsigned.json`、`fee-budget.json`、`runtime-catalog.candidate.json`、`runtime-code.json`、`activation-plan.json` 和 `control-challenges.json`。地址均为预计地址，尚无部署回执，不能配置成已上线目录。
3. 完成仓库要求的最终独立安全签字、参考基线与差异审查、法律/许可批准。现有内部测试和本地 Fork 不替代这些材料。
4. 两组 2/3 Safe 各取得至少两名有效 owner 的可用性证明。`control-challenges.json` 是绑定交易包摘要的普通消息，明确不授权转账或部署；共享操作钱包还需一份控制证明。只提交签名，不提交私钥。可通过 `node tools/production-release/control-proofs.mjs <evidence-dir> <proofs.json>` 检查 EOA 签名。此证明不等同于 Safe 实际 `execTransaction` 签名流程；Safe 交易签名与执行演练仍需按团队签名设施完成。
5. 在明确批准具体交易包和费用上限后、签名前，重新读取同一 4663 主网：deployer confirmed/pending nonce、余额、Safe owners/threshold/modules/guard、官方资产与外部依赖 codehash、最新 Gas/L1 费用。任意差异须停止并复核，不能自动改收款人、角色、资产名单或经济参数。快照中的历史报价不是长期签名费率。

检查主网使用已配置的内部 `ROBINHOOD_RPC_URL`。读取固定区块使用现有 Node 兼容代理，不关闭 TLS 验证。新的只读快照应输出到新的目录，保留本次证据。

## 执行与中断恢复

仅由已批准的 deployer 签署当前交易包，按 nonce 顺序提交，逐笔等成功回执。不要并发使用该 deployer 发无关交易。每笔核对 chainId、from、to、value、data、nonce、Gas 上限、费用上限、回执状态和 canonical block hash。

34 笔之间不具备整体原子性；已经成功的前缀会保留。若中断：先确认已提交交易的原始 hash、回执、nonce 和链上状态，定位已完成的连续前缀，再审查剩余后缀。未知 pending、nonce 被其他交易占用、孤立回执或状态与前缀不符时停止。不能重发一套从首笔开始的旧包，也不能自动重新签名替换状态不明的交易。

Orchestrator 的 `initialized/nextComponent/completed`、payloadHash、16 个 initCodeHashes 和 finalHash 可用于定位 runtime 阶段。激活阶段逐项回读 Registry。失败交易消耗 nonce 时，重建剩余 nonce 的包需要重新生成摘要及审查；不得将旧签名当作新计划。

最后一笔完成后验证：194 Stock 均 ACTIVE、UID/Token/Vault/最低分配量正确，196 Quote 参数和 baseline 正确，模板完整绑定实际 runtime hash；publisher 与 Keeper 均为指定钱包；治理 48h、Unpause 24h、Guardian 即时；deployer 不再有 ADMIN_ROLE(0)。保存全部真实主网回执，不得用本地 Anvil hash 填入。

## 部署后的开放门禁

用归档 `compiler-inputs/standard-json-input.json` 和精确构造参数验证源码，并将链上 runtime codehash 与 `runtime-code.json` 一一比对。补齐真实 finalized activation block/hash 后才能生成已部署 catalog。

前后端/Indexer/Holder 的生产身份和索引起点必须绑定实际回执；现有 46630 测试环境保持隔离。完成生产适配、监控告警、业务/应急验收及仓库要求的 72h 受控运行后，才能开放用户资金。

当前 Holder CLI 仍限定测试环境；共享钱包的 Holder/复投执行工具仍需统一跨任务 nonce 和 pending journal 协调。它们是运营启用前必须完成的事项。不得仅修改链 ID 或同时启动两个独立 signer 进程。Keeper 已在链上初始化与是否启动链下任务是两个独立状态。
