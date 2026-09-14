# Locker 手动运行闭环

使用当前编译 ABI，提供费用读取 → 参数规划 → 精确模拟 → 持久化签名 → 发送 → 确认与事件核对 → 状态查询。RH 4663 首发初始化完成时，链上 `GraduationExecutor.compoundKeeper` 配置为用户批准的 `0x2cFb6cAa2042690fc928CE0ccE40F3828336dE44`，使 LP 复投可用；不启用链下自动调度，后续按需显式调用本工具。没有常驻调度，不自动配置 Keeper，不换币，不移动 LP 本金。本工具是运维后台入口，不是公开 HTTP 签名服务或前端按钮。

从仓库根目录使用：

```sh
npm run locker:preview -- /absolute/path/verified-market.json
npm run locker:execute -- /absolute/path/verified-market.json
npm run locker:status -- /absolute/path/verified-market.json
npm run test:locker-worker
```

命令加载根 `.env.test.local`，也接受显式进程环境变量；不生成各服务独立 env 文件：

- `TG_LOCKER_RPC_URL`：目标链 RPC。绝不将带凭据地址写入 manifest 或日志。
- `TG_LOCKER_STATE_DIR`：绝对路径、0700、非符号链接；**同链同 Keeper 的所有市场共用一个目录**。跨市场串行执行，不能为每个市场开独立 nonce 队列。当前 Locker worker 与 Holder publication 使用独立 journal/lock；若 Keeper 与 Holder 发布者共用同一钱包，必须由外部调度器实施跨两任务的全局串行互斥，并在签名/发送前后对账双方的 pending intent、nonce 和回执。当前没有实现共享锁，不能并发发送。
- `TG_LOCKER_SIGNER_FILE`：仅 execute 需要；0600、非符号链接的 JSON，内容为 `{"privateKey":"..."}`。禁止提交到 Git。

每个市场的 manifest 必须来自验证后的部署资料，不得将工具首次读到的 codehash 自动当成可信基准。字段如下；这里列的是字段定义而非可直接广播的示例地址：

| 字段 | 内容 |
| --- | --- |
| chainId | 明确链 ID |
| releaseId / marketId | 非零发布标识、市场 bytes32 |
| keeper | 已经由治理配置的 Keeper 地址 |
| locker / registry / executor / positionManager / poolManager | 验证过的部署地址 |
| codeHashes | 以上五个合约角色对应的 runtime keccak256；Locker 的 immutable 参数使不同市场 hash 可能不同 |
| maxGasWei | 单笔 `gasLimit × maxFeePerGas` 上限，正整数字符串 |
| minLiquidity | 最小新增流动性，正整数字符串；由运营结合资产价值设定，不是假定美元收益 |
| bufferBps | 1–1000 的流动性折减/投入缓冲，建议测试使用 50；不保证未来价格不变 |
| confirmations | 确认深度，非本地链至少 2；根据目标链最终性要求提高 |

## 行为与状态

预演使用同一区块的 codehash、Registry、Executor、NFT 所有权与 PoolKey 检查，读取 PoolManager slot0 和 PositionInfo 的真实价格/范围。使用整数 TickMath 与向上舍入的资产投入计算，支持价格处于区间内外；区间内只有单边费用时可返回 `below_minimum`，不为了复投而偷偷换币。费用预算包含模拟 collect 的结果，最终 compound 模拟必须通过；历史覆盖缺口会消耗新费用，导致计划不成立时直接失败，不能挪用隔离余额。

`preview` 不签名；`execute` 重新生成新计划，不接受过期预览文件直接执行。计划期限为链上时间后 180 秒，签名前再次模拟、检查 nonce/余额/期限；最大投入受每种资产的费用预算和明确 buffer 约束。Gas 成本超过上限返回 `gas_cap_exceeded`。

签名后原始交易先原子写盘并 fsync，才允许发送。RPC 超时后 `pending` 保留，下一次 execute 只对账或重发相同签名，不重新计算新交易。成功回执必须匹配本市场、本 tokenId、精确新增 liquidity 和投入上限；确认后 `last.status=confirmed`，记录交易 hash、区块和实际 Gas。回滚记录 `reverted`，异常事件保持待对账，不宣称复投成功。

`status` 输出待处理意图、最近结果、余额与规划信息，但不输出原始签名或私钥。错误不会展开含 RPC 凭据的嵌套异常。它是本地后台状态查询；本轮没有声称已经发布了公共 API 或网页运维面板。

## 恢复

- 同一 Keeper 若已有其他市场 pending，先使用对应市场 manifest 对账，不能跳过后另发新交易。
- nonce 已被消费却查询不到原回执、意图已过期但状态不明时停止，人工核对链上交易和 nonce。不能删除 pending 后盲目重试。
- `.lock` 使用独占创建。进程异常退出可能留下锁；核对锁内 PID 确认没有原进程后才能删除该锁。不要删除交易 journal。
- 状态目录应位于本机持久磁盘；多机器/Serverless 使用前，需要替换为数据库事务和分布式 signer 锁，本文件锁实现不能被当成分布式调度器。
- 新合约部署并治理配置 Keeper 后才可启用相应环境。旧 Locker 不会因运行此脚本而获得新功能。

定期调用可以复用同一个单次入口，但周期启用、线上账户和发布仍由后续明确运行安排决定。本轮未启用任何周期发布或复投任务。

## 独立本地复现

```sh
node tools/locker-compounding/prepare-local-test.mjs
anvil --port 18676 --hardfork cancun --timestamp 1800000000 --silent
# 在另一个终端、同一仓库根目录运行：
node tools/locker-compounding/local-integration.mjs
```

18676 必须是专用于本测试的空白 Anvil；导入程序会写入 fixture 账户代码和 storage，不能复用其他任务节点。测试结束停止这个专属进程。程序只连接固定 localhost，检查 Anvil 标识与 chainId=31337。导出用独立临时 Foundry 配置/out/cache，不改变生产构建配置或在线发布绑定。

本地使用真实 Locker、PoolManager、PositionManager，Registry/Executor/Permit2/资产为测试替身，通过 Uniswap donate 生成费用增长。使用公开测试私钥 1 签名本地交易，验证回执、流动性增量与 journal 完成状态；它不等同于真实 RH 资产或线上 Keeper 验收。四档真实 swap LP 收费及 native 组合仍由 Solidity/Fork 测试覆盖。
