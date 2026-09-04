# TickerGarden V1 激活轮 Gas 与存储报告

> 任务：`V1-T-202-A`
> 状态：`FROZEN TEST EVIDENCE / NOT A PRODUCTION GAS BUDGET`  
> 日期：2026-09-03

## 1. 测量环境

- Foundry `1.8.1`，commit `982849d3140c01fd3b72905759581a132df7aa98`；
- Solidity `0.8.26`，EVM `cancun`；
- optimizer 开启，`optimizer_runs = 200`，使用 `FOUNDRY_PROFILE=v1`；
- 数值是测试内围绕目标外部调用的 `gasleft()` 差值，不包含 fixture 部署、注入和断言；
- 本报告用于证明算法复杂度与建立回归阈值。目标链最终入口预算仍属于 `V1-T-702-A`，不得把本地数值直接当成生产上限。

## 2. 冻结结果

| 场景 | 实测 Gas | 可执行阈值 | 结论 |
|---|---:|---:|---|
| 单一成熟槽、1 ref checkpoint | 330,296 | 对照基线 | 只按固定32槽扫描 |
| 单一成熟槽、256次正常调度 refs checkpoint | 330,304 | `<= 1 ref + 500` | ref/用户数量不进入循环 |
| 结构性满32个成熟槽 checkpoint | 1,818,300 | `< 2,000,000` | adversarial满存储状态仍由32槽硬上界限制 |
| 公开路径跨秒正常调度后的30槽 checkpoint | 1,694,167 | `< 2,000,000` | 后两次schedule已自动处理最早2槽，最终调用只剩30槽 |
| 近端成熟槽 checkpoint | 330,494 | 对照基线 | 时间距离不参与循环 |
| 空闲一年后 checkpoint | 330,296 | `<= 近端 + 2,000` | 不按秒或历史 generation 扫描 |
| 无遗弃历史的用户 materialize | 91,850 | 对照基线 | 按用户当前 generation 直接读取 |
| 存在256个遗弃 snapshot 后 materialize | 91,961 | `<= 干净状态 + 500` | 不扫描历史 snapshot |

所有阈值均由 Foundry 测试直接断言；超限会使 CI 非零退出。Gas 的微小负差或差值来自冷暖访问与测试调用顺序，因此复杂度判断使用保守差值阈值，而不是要求绝对相等。

## 3. 存储与规模边界

- 热路径 ring 固定为 `32` 个 `ActivationSlot`；checkpoint 每次最多检查32槽，不遍历用户、市场或经过的时间。
- 同一绝对 generation 的所有用户只聚合进一个槽，槽内仅保存 `amount` 与 `refs`；测试通过256次正常 schedule 把 refs 从1扩大到256，checkpoint Gas 不变。
- 满32槽数值通过测试 harness 注入，仅用于覆盖合约内部可能面对的结构性最坏存储状态。公开 `schedule` 会先执行 checkpoint：连续跨秒调度32次时，第31、32次调用已分别处理最早两槽，因此最终公开路径 checkpoint 实际处理30槽、激活525，并使累计 active 达到528；该可达路径亦单独冻结阈值。
- processed snapshot 以绝对 generation 为键保存不可变 accumulator 与 refcount。用户物化通过自己唯一的 `pendingGeneration` 直接定位，不扫描其他用户或历史。
- snapshot 只有在最后一个引用物化后删除；未物化 snapshot 可以长期存在并占用存储，但不会放大单次 checkpoint/materialize Gas。
- 单用户/市场最多一个 pending；跨秒增仓先移除旧槽引用，再把合并量写入新 generation，避免按用户历史累积槽位。

## 4. 覆盖证据

`MemeStockGaugeActivationWheel.t.sol` 覆盖同秒256次正常调度聚合、绝对 generation 槽冲突、结构性满32槽、公开跨秒调度自动处理成熟槽、分段处理、槽复用、清理、snapshot hook 回滚、跨年空闲和本报告的最坏 Gas 阈值。

`MemeStockGaugeActivationSnapshots.t.sol` 覆盖 processed 未物化、共享 refcount 的 `N -> 1 -> 0` 清理、槽复用时旧 snapshot 保留，以及256个遗弃 snapshot 前后的 materialize Gas 对照。

`MemeStockGaugePendingPositions.t.sol` 覆盖单 pending、同秒合并、跨秒 reset、成熟后物化、目标槽冲突回滚与跨年后重新调度。

复现命令：

```bash
cd contracts
FOUNDRY_PROFILE=v1 forge test --match-path test/v1/shared/MemeStockGaugeActivationWheel.t.sol -vv
FOUNDRY_PROFILE=v1 forge test --match-path test/v1/shared/MemeStockGaugeActivationSnapshots.t.sol -vv
FOUNDRY_PROFILE=v1 forge test --match-path test/v1/shared/MemeStockGaugePendingPositions.t.sol
```
