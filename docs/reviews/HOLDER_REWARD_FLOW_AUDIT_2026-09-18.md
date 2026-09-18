# Holder 奖励业务链路审查

日期：2026-09-18。范围：当前工作树 `codex/stake-flow-hardening`（HEAD `fcdb06a903`），包括已有未提交的 Stake 优化。只读代码审查及本地测试；本次仅新增此报告，未修改业务代码、配置、合约或部署。未核验生产数据库、实际发布者运行状态，未执行主网签名交易。不是独立外部安全审计。

## 结论

当前钱包快照模式的资金归集、预算分配、Merkle 证明和领取隔离有完整保护；本轮未发现可复现的重复领取、跨市场领取或超预算支付漏洞。主要问题在多轮领取体验、发布吞吐量、快照计算扩容和故障隔离。旧 Treasury/连续奖励是旧 release 兼容路径，不应把其周期、过期或服务费机制套到当前快照模式。

## 当前完整流程

1. 发行时启用 Holder fee sharing，配置固定。交易基础手续费中，Creator 基础份额的一半计入 Holder；Creator tax 不参与该二次分配。不是将总交易额或全部手续费的一半给 Holder。
2. 手续费按原始 Quote/Meme 资产计账。Curve 费用需完成归集进入 FeeVault；FeeVault Holder 负债再通过 permissionless funding 转入 Distributor。资金转入并不自动发布奖励。
3. 开启 Token fee burn 时，相关 Meme 奖励走销毁，不能同时承诺给 Holder；Quote 奖励仍可分配。批量 funding 有逐资产失败隔离和 Gas 续作点，批次交易成功不等于每项均成功。
4. 在已确认且索引覆盖完整的区块生成快照：重放 Transfer，核对供应量、正余额账户和排除账户。直接余额按比例向下取整，余数保留未分配；没有有效权益时不发布零预算轮次。
5. 数据集及钱包证明先入库，再由获授权 publisher 发布 root、dataHash、快照区块和预算。根只能顺序新增，不能直接改写已发布轮次。
6. Claim 从数据库读取轮次、证明及领取位图；签名前校验钱包、链、市场、root、链上已领取状态和预算，合约再次验证证明和金额。Quote/Meme 可独立领取，回执必须匹配实际领取事件。
7. 领取后的本地回执覆盖可避免数据库短暂滞后再次显示相同权益；最终状态由索引更新。快照后卖出代币不会取消该轮权益，当前快照模式也没有旧版领取周期到期规则。

## 优先修复

### H1 / 高：分页游标失效后，重试无法恢复

- 证据：`services/backend-ts/packages/read-store/src/holder-snapshots.ts:18-20`，cursor 绑定市场观察区块；`packages/chain-worker/src/holder-snapshots.ts:49-74`，领取事件也触发市场状态更新。
- 前端证据：`apps/web/src/app.ts:3498,3518-3522`，翻页失败保留 prior 和旧 cursor，下一次继续使用同一个 cursor。
- 条件：历史超过一页；加载第一页后发生领取或新发布，再继续翻页。旧游标返回 409，点击 Retry 仍会重复失败。
- 建议：将轮次集合版本与领取状态版本拆分。领取位图更新不应使轮次分页失效；发布/重组导致真正版本变化时，前端捕获 409，按当前钱包及市场重新读取并尽量保留所选轮次。不要要求用户反复完整刷新。
- 验收：他人领取、本人另一设备领取、新轮次发布和重组分别发生在两次翻页之间，均能恢复；不得混入旧钱包或旧市场数据。

### H2 / 中：最早轮次优先，与“View older rounds”相反

- 证据：Read Store `holder-snapshots.ts:24-35` 按 `round ASC`、`round > cursor` 返回；前端 `app.ts:3513-3517` 优先选择最早可领取轮次，按钮却写 View older rounds。
- 影响：近期奖励需要翻过旧轮次才能看到。每页扫描 10 个全市场轮次，钱包没有权益时，也可能得到空列表和非空 cursor；此时显示 No rewards available 容易被理解为全部没有奖励。
- 建议：按钱包权益分页，明确未领取优先、同组按新到旧；历史入口确实读取更早轮次。未扫描到完整结果前，不把空的中间页视为没有任何权益。分页方案与 H1 一起改造。
- 验收：钱包仅在第 21 轮有权益、旧轮次全部已领、Quote/Meme 仅领取一项等场景。

### H3 / 中高：一个坏轮次阻塞整页健康奖励

- 证据：Read Store `holder-snapshots.ts:23,27-32`，轮次计数不完整，或任一可见轮次缺少/损坏 proof dataset，整个请求返回不可用。
- 影响：即便钱包要领取的其他轮次证明完整，也无法通过这页取得数据。资金不会丢失，但可用性故障被扩大。
- 建议：保持损坏轮次禁止领取，后台报警及重建 proof index；对已独立验证的健康轮次提供可读结果，不能把缺失轮次当成零权益，也不能绕过 root/dataHash 校验。API 明确完整性语义，不增加未经批准的页面组件。
- 验收：多个轮次中删去一个归档或破坏一份证明，其他有效轮次仍可读、可独立领取；坏轮次继续被拒绝。

### H4 / 中高：快照生成和发布反复全量工作，存在 100,000 正余额账户硬上限

- 证据：Worker `holder-snapshots.ts:134-152`，每轮从历史开头重放 Transfer（已有 SQL 分页，但无持久化余额续作）；`holder-snapshot.ts:4,35` 限制 100,000；Worker `:142` 连重放中间状态达到上限也拒绝。
- 发布预验 `holder-snapshots.ts:170-194` 每次重验所有历史钱包 balanceOf；`holder-publication.ts:118,128,103,87` 在首次预验、签名前、发送前和成功对账阶段重复调用。已发布匹配判断也位于历史余额全量检查之后。
- 影响：长历史和大 Holder 数增加 RPC、内存和恢复成本。发送前全量预验发生在签名意图建立之后，若耗时超过 300 秒意图窗口，可能尚未广播便过期并保留待处理意图。该极限耗时为代码推导，未做 100,000 账户端到端实测。
- 建议：持久化余额增量账本、重组回滚及校验进度；不可变历史验证证据绑定 dataset digest、区块哈希和 generation；临发送前只刷新会变化的权限、预算、nonce 和模拟。超大快照分片生成及索引，不仅调大常量。资金和供应量校验必须保留。
- 注意：通用 RpcTransport 已合并同源并发相同读取（`packages/chain/src/index.ts:106-145`），不能笼统认定当前每个 balanceOf 都对同一 RPC 发两遍。重复的不同预验轮次仍会重新请求。
- 验收：中途崩溃续作、区块重组、超过当前上限、历史中间账户多但最终账户少、签名意图过期前不得广播。

### H5 / 中：发布工具仍硬编码 600 秒，单笔单市场串行

- 证据：`scripts/holder-publication-cli.ts:38-40` 默认及最低 600 秒；`holder-publication.ts:35-37` 每次编码一个市场；`:85-91,117` 未确认 pending 保留并优先处理；journal `:18-20` 同链同 publisher 共用状态。
- 影响：使用该工具串行发布多个市场，上一笔回执达到确认门槛并对账清除前，后续市场不能正常推进。该限制是运维发布器的门槛，**不等于链上领取函数强制等待十分钟**。
- 建议：与当前已批准的结算确认政策统一配置；不要未经核验将奖励结算门槛直接等同展示延迟。利用合约已支持的最多 32 项批量发布，保留逐项预验和原子失败处理。publisher 与 Keeper 共钱包时，需要共享 nonce 协调；当前文件锁只覆盖 Holder 工具。
- 验收：多市场批次、单项冲突、回执未决、同钱包另一任务及重组，不重复签发或覆盖 nonce。

### H6 / 中：快照投影只对 RPC 核验分页，事件装载和最终写入仍可无界增长

- 证据：Worker `holder-snapshots.ts:49-59` 一次取出区间全部事件；`:63-82` 已按 128 个市场续作；`:84-100` 最终重新装载全部暂存事件及观察记录，并在事务中应用。
- 影响：历史回填、长时间停机或重组全量恢复时，即使 RPC 能续作，仍可能在装载/提交阶段耗尽内存或形成长事务。这不是普通小批实时更新一定会失败。
- 建议：事件分段入库、固定工作上限、分片应用，最后通过版本指针原子切换完整可读版本；不能暴露部分结算状态。

### H7 / 低：发布进程异常终止后文件锁需人工恢复

- 证据：`holder-publication-journal.ts:20-23,35`，独占创建文件锁，仅 finally 删除；SIGKILL/主机重启无法执行 finally。
- 已有运维文档给出确认 PID 终止后移除锁的办法，所以不是完全没有恢复方案。建议提供受控恢复命令，结合进程/主机身份与未决交易核验，不因锁文件“较旧”直接删除。

## 运营与信任边界（不能误判为已上线自动功能）

- 当前快照 CLI 的 funding 仅生成预览；prepare/publish/reconcile 是显式操作。`docs/operations/HOLDER_SNAPSHOT_BACKEND.md` 明确周期发布尚未启用，属于既有决策，不能擅自开启。
- `tools/holder-rewards/worker.mjs:10` 仅允许测试网旧工具；它不能证明主网快照自动归集/发布已经运行。本轮未检查 VPS，因此不对线上调度状态作推断。
- 若要承诺持续发放，需要单独确定归集阈值、快照/发布时机、Gas 预算、未决任务及失败告警负责人。页面累计手续费不能直接视作已发布可领取奖励。
- publisher 是受信任的分配者。Merkle 证明只能验证领取与已发布 root 一致，合约无法验证链下分配是否真实公平；错误 root 不能直接覆盖。保留严格链下验证和发布前数据核验十分必要。停止 publisher 可阻止后续发布，不撤销已发布权益。当前方案不是无需信任的自动分红。
- 直接余额快照不是按持有时长计息，快照时持币者参与此前已归集可用资金分配；这是当前机制，不能自动视为计算错误。不要在文案承诺固定收益、连续计息或固定发放时间。
- 后端操作文档仍有仅测试 release/双独立 RPC 的旧说明，与 CLI 已支持生产单源配置不完全一致，应在下一次发布流程优化时同步更新。

## 本次验证

使用 Node 24，在本地 PostgreSQL 独立测试 schema 上执行：

```sh
# services/backend-ts
node --experimental-strip-types --test tests/unit/holder*.test.ts
TG_MIGRATION_DATABASE_URL='postgresql:///postgres?host=/tmp' \
TG_TEST_DATABASE_URL='postgresql:///postgres?host=/tmp' \
node --experimental-strip-types --test --test-concurrency=1 \
  tests/integration/holder-rewards.test.ts \
  tests/integration/holder-snapshot-worker.test.ts \
  tests/integration/holder-proof-capacity.test.ts

# contracts
FOUNDRY_PROFILE=v1 forge test \
  --match-contract 'HolderSnapshot|HolderBatch|HolderFee|HolderPool|ContinuousHolderFee|ProtocolFeeVault'

# repository root; read-only frontend review subtask
npm --prefix apps/web test
```

结果：后端单元 18/18，数据库集成 3/3，合约 129/129，前端 621/621（含生成检查和类型检查）通过。10,001 Holder proof-index 测试通过，证明钱包读取无需加载全量 dataset；不等于 100,000 Holder 端到端生成/发布已验证。Foundry 有预处理和测试 mock 的既有警告，最终编译与测试成功。

H1/H2 为跨前后端代码路径确认，现有测试没有覆盖实际浏览器分页交错；本轮没有新增该回归测试或执行真实钱包浏览器验收。H3 的整页拒绝由现有数据库测试覆盖，其业务故障隔离改进尚未实现。没有进行生产运行验证、主网 Fork 全链路或发布交易。

建议实施顺序：H1/H2 → H3 → H4/H5 → H6/H7；自动化发布的启用与运营参数另行确定。以上主要可在前后端及操作工具修复，不要求改动已部署的领取合约。
