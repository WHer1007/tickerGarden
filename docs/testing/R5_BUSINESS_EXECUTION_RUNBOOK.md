# R5 业务验收执行与续测手册

本轮：`R5-BUSINESS-2026-09-06`。工作目录：`/Users/dear/Documents/code/TickerGarden`。

本手册对应 [规范](R5_BUSINESS_ACCEPTANCE_SPEC.md) 和 [76条用例](R5_BUSINESS_CASES.md)。历史报告不可填入本轮 PASS。真实生产网络 RH 4663；本轮只对 Arbitrum Sepolia 421614 的隔离测试资产和市场写入。

## 1. 先固定预期和环境

1. 审阅用例的前置、操作、数值断言和必需环境。增加场景时新增版本/attempt，不能改掉已失败尝试。
2. 核对 `deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json` 与 activation release 一致。本轮 release 为 `0x14963af9576a3b1cb915b8a13e86e0899a4c8345c010c47d4932789ebf46031d`。
3. 检查 RPC chainId、固定区块 hash、21个已部署runtime。源码、编译参数、公共角色地址/余额和依赖哈希保存在本轮 `baseline.json` 与最终来源索引。
4. 执行 `node tools/verify-v1-build-inputs.mjs`；涉及部署字节码时再执行 `--batch`。生产代码修改后重新清洁编译和复测，不能拿增量缓存中的旧创建字节码广播。
5. 钱包只在本机 `/Users/dear/.config/tickergarden/testnet-wallets/` 的 owner-only JSON 文件中读取。本轮脚本不输出私钥，不把密钥写入日志、报告、Git或命令参数。测试角色公开映射见 `public/roles.json`。

## 2. 本地测试

严格普通合约测试：

```sh
FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=500 FOUNDRY_INVARIANT_FAIL_ON_REVERT=true \
node tools/run-forge.mjs test --no-match-path 'test/v1/fork/**' --fuzz-runs 1000 --json
```

必须保存 stdout、stderr、退出码和源代码版本；解析每个 suite/test 的状态及 fuzz/invariant次数。不要用最后一行通过总数替代逐项登记。

官方依赖的新固定区块 Fork：

```sh
node tools/run-r5-business-fork.mjs arbitrum
node tools/run-r5-business-fork.mjs rh
```

这两个工具读取真实新 header、校验依赖代码，然后生成本轮独立测试 harness；保留历史 pin 和发布证明。它们不向生产链广播。公共 RPC 历史状态不可用时应记录基础设施失败；不得返回伪造零状态或改成最新状态却沿用旧 hash。

本轮实际 R5 已部署状态的本地验证（公共 lifecycle 完成后）：

```sh
node tools/run-r5-deployed-time-fork.mjs
node tools/run-r5-deployed-time-fork.mjs matrix
```

第一条验证自然时间边界的本地模拟，第二条按16组合执行完整链路。两者都是本地 Fork，`vm.deal` 和 `vm.warp` 不构成公开链成功证据。矩阵降并发执行，避免公共 RPC 瞬时负载；保存每次失败和重试日志。

服务测试使用各服务 `npm test`；Go使用 `go test -race -count=1 -json ./...`，同时统计包、顶层测试和子测试。4个 `make smoke-*` 必须使用脚本自建的临时PostgreSQL与随机loopback Anvil，不能连接现有业务数据库做故障注入。完整命令和日志见本轮 `local-services/`。

## 3. 公共链即时阶段

本轮已经执行以下阶段。下面命令用于理解流程或在同一journal中断点恢复；不要删除结果文件后重新广播。

```sh
node tools/test-r5-business-public.mjs run matrix
node tools/test-r5-business-public.mjs run negative
node tools/test-r5-business-public.mjs run graduated
node tools/test-r5-business-public.mjs run lifecycle
node tools/test-r5-business-public.mjs run conversion-rejections
```

- `matrix`：隔离股票/Quote → 16组合原子购买 → 曲线买卖 → sweep → 固定受益人领取。
- `negative`：精确自定义错误、无效配置、滑点和一笔预期实际上链回滚。
- `graduated`：1个ETH及8个ERC20毕业、双向v4收费、两用户质押激活、批量兑换、holder独立注资。额外500股票补充有单独交易ID，不能重复手动划转。
- `lifecycle`：两人1:3核对、全部/部分提前退出及deferred重试、creator epoch转移、raw退出计时、7天前请求拒绝、隔离股票暂停及等待队列。
- `conversion-rejections`：真实已有权益上的越权/过期/重复item/错误收款人/过高minOut ETH_CALL；明确不是失败广播。

每笔交易先写入角色、nonce、目标、value、calldata hash和签名交易hash，再发送。进程中断时先查询同一hash的receipt；不得换nonce盲目重发。金额、目标或payload与journal不一致时停止核对。脚本单笔value上限0.55 ETH，gas预算有单独上限；本轮按已有测试资金仅完成1个ETH毕业。

执行后：

```sh
node tools/audit-r5-business-public.mjs
node --experimental-strip-types outputs/reviews/r5-business-acceptance-2026-09-06/real-receipt-replay/replay-real-receipts.mjs
node tools/report-r5-business.mjs
```

审计绑定最后一个纳入回执的区块，避免边测试边取latest造成快照混用。重复审计可复用已保存的不可变交易/receipt，但重新验证其canonical header。必须复算恒定乘积输入输出、退款、各费率和所有bucket，并检查各资产余额覆盖总负债。

## 4. 自然时间续测

准确时刻见本轮 `time-queue.json`，以链上 timestamp 为准，不能以电脑时间替代。当前没有创建自动定时任务。

### 正常退出及Quote领取

对于队列中每个仍有本金的staker市场：

1. 重新读取Gauge position、unlockAt、Vault allocation、钱包股票及Quote余额。
2. 到期前测试只读拒绝；到期后以该staker执行 `unstakeAndWithdraw(marketId)`，核实整仓原额进入同一钱包。
3. `claimStaker(marketId, quoteAsset)`：对比实际到账，确认奖励没有因正常退出丢失。
4. 重复领取为0；重复退出应拒绝且本金不能再次增加。保留每笔回执和前后快照。

不要对已在本轮全部rageQuit的 `ERC20-S1-H0-T500` 再执行正常退出；该市场已从等待队列移除。

### 原币奖励退出

读取 `rawRewardExitAt(marketId, creator)` 与当前meme负债，只有到期后领取原meme。不得在等待期间用兑换消耗这个测试样本。验证到期前拒绝、到期后固定收款人到账、重复领取无二次付款。

### 股票解暂停

本轮暂停的是隔离合成Stock。读取pause交易时间与当前代码指纹，满足1天状态延迟后由管理员解暂停。验证身份仍匹配，再测试可新增质押；若身份发生漂移，不能单凭“时间已到”放行。

### 持有人真实7天与30天

1. 等epoch结束且秒/块finality同时满足；从R5真实canonical Transfer记录生成积分。仅离散receipt列表不足以证明完整期间TWAB。
2. 清理该epoch尚未兑换的holder meme并fund所有Quote；确认holder/creator互不串账。
3. 持有人按当前 `rootServiceFee()` 精确付费请求root，记录source block/hash。
4. 保存规范化积分输入、排除地址规则、根/证明、总分配和来源摘要；由授权发布者publish，满足review delay后finalize。
5. 两个独立holder验证正确proof支付、错误proof拒绝和重复领取不重复支付。
6. 读取真实链上claimUntil后，才登记30天窗口准确截止。到期前/到期/到期后、结转与旧proof重放分别追加attempt；不能提前生成一个“已验证”的最终报告。

公开链不允许时间加速。这一阶段未完成时整体保持 `ACCEPTANCE_INCOMPLETE`。

## 5. 尚需另外组织的验证

- 余下7种ETH公开毕业组合需额外测试币。使用本地/合成ERC20补足逻辑覆盖不意味着这些公开ETH行通过。
- 连续区块索引、持久cursor、真实分叉回滚、publisher/worker中断和交易不确定状态恢复，须有独立运行的完整服务和数据库；当前receipt projector证据只证明所选真实日志及幂等。
- Chrome+MetaMask真实页面签名另行登记，前端57单测和build不替代。
- 生产多签/权限移交、正式RH参数和真实流动性仍是独立门禁。不要直接迁移活动测试图的owner来做破坏性演练；使用本地或明确独立组件。

## 6. 验收报告更新规则

结果优先级为实际断言/回执 > 工具退出码 > 文案。`PARTIAL`、等待、资金/输入/基础设施阻塞不计通过。保留失败尝试及修正原因，列明哪些测试仅是ETH_CALL、哪些确实MINED_TX、哪些LOCAL_TIME_WARP。只有每条必需环境完成且P0/P1关闭，才可将即时报告改为完整最终验收报告。
