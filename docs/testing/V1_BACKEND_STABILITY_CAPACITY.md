# 后端稳定性、恢复与历史容量验证

本测试是本地验证，不发送交易、不改变链上时间、不修改现有部署。公开链持有人服务领取闭环仍保持暂缓。

## 可重复入口

从仓库根目录运行，需要本地 Go、PostgreSQL（initdb、pg_ctl、psql、pg_dump/pg_restore）。脚本会创建自己的临时数据库和服务二进制；不要将现有数据库地址传入测试。

```sh
python3 tools/service-integration/run-stability.py
python3 tools/service-integration/run-stability.py --test-pattern TestPostgresMigrationAndReadiness --label postgres-regression
python3 tools/service-integration/restore-drill.py
```

`run-stability.py` 每次生成独立证据目录，执行结束停止自己的 PostgreSQL。恢复工具读取已归档 dump 和校验文件，在新实例恢复，停止并保留恢复目录；重复运行可用 `--output` 指定新的报告目录。不要将该恢复实例直接接入生产。

## 持续同步与故障验收

真实 indexer / discovery-worker 二进制通过 HTTP 连接合成 RPC，写入真实 PostgreSQL。数据源每 250ms 新增一块，每块 4 个回执、16 条非创建事件日志。基础 RPC 延迟 2ms，另测 50ms 延迟。

必须验证：

- 初始积压被处理，持续出块时 indexer、finalized checkpoint 和 discovery 均接近源头；不能只与滞后的数据库 finalized 比较。
- RPC 返回 503 后记录实际错误；停机期间检查点保持不变。
- 外部重新启动服务后继续追平，不声称服务进程自带 supervisor。
- SIGKILL 后重新启动，完整区块、回执与日志保持一致；逐块重算已存回执集合 commitment。
- 区块高度与父哈希连续，没有重复、部分区块或遗漏。
- 50ms 延迟场景单独记录吞吐和积压，不将故障恢复 PASS 当作所有延迟下的容量 PASS。

这是约分钟级持续运行测试，不是 24 小时或数周 soak，不包含 RPC provider SLA、真实网络重组概率或全业务混合流量认证。创建事件完整身份验证由现有 PostgreSQL discovery 回归覆盖，本负载场景不批量模拟新市场。

## 七天历史容量验收

调用真实 `Treasury.LoadJournalInput` 和 `Generate`，物理写入 604801 个连续区块及 discovery marker；时间戳覆盖七天，采用一秒一块的假设。该场景只有一笔创建回执、两条 Transfer，属于稀疏历史；不是 60 万笔交易，也不是实际等待七天。

必须分别登记：

1. 一秒一块、第一周期：实际加载区块、校验创建与 Transfer、生成根和预期分配。
2. 每 0.25 秒一块、七天：实际调用 loader 到范围限制，必须明确报告容量不支持。超限分支仅创建有效查询锚点，不物理填充全部 242 万块。
3. 一秒一块、第二个周期：历史仍从创建时累计，超过 100 万块；调用 loader 验证拒绝。不能仅计算常量后宣布完成测试。

不得为了让测试变绿而提高上限、删除无关回执验证或跳过历史来源核验。当前全量从创建时回放的方式需要增量且可验证的历史 checkpoint 设计，才能支持长期运行；还需要密集回执、多个市场、用户规模与硬件/RPC延迟的容量测试。

## 恢复验收

核验 dump SHA256；实际 pg_restore；比对区块高度/哈希、discovery 与 canonical 区块一致性、任务状态/次数/候选 ID，并将候选 input/dataset 与独立归档结果逐字段对比（十六进制大小写归一化）。记录表行数、约束和实际 migration 版本。

本次恢复使用 `--no-owner --no-acl`，权限恢复不在验收范围。备份 schema 与当前程序 schema 必须分别记录；不自动升级备份。完整灾备还需权限、配置、迁移升级、服务重接与新的链上状态校验。
