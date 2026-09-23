# 生产健康检查后续修正

状态：代码、数据库迁移及运维配置已完成本地验证；尚未发布测试或生产，也未修改运行中的 PostgreSQL/容器。

工作分支：`codex/production-health-fixes`，基于生产 master `2c4e8034068aa5ea2c7e3f93e9fb5f35d872e4a4`。工作目录：`/Users/dear/Documents/code/TickerGarden-health`。

## 已修正

1. `circulatingSupplyRaw` 统一等于当前链上 totalSupply。初始 mint、协议/用户间转移、质押和锁定不会按持仓地址扣减供应量；Burn 减少当前供应量。Fixed Supply 仍是原始创建供应量。
2. 新建详情、展示 Worker 和 finalized analytics 三个入口均使用 `CHAIN_TOTAL_SUPPLY_V1`。前端支持新标记并验证 circulation 与 totalSupply 一致，同时接受旧响应用于分步发布；不改变界面元素。
3. `0034_circulating_supply` 修正数据库已有公共详情和近期创建详情、清除含旧 Holder 详情的响应缓存，不改 Holder 资格、余额和奖励记录。旧重组 undo 恢复时也转换为正确口径。迁移不新增表或角色权限。
4. RPC 在同一轮中复用 inbox/scan 已核验的区块对象，供回执和锚点检查使用；同一区块的多个迟到事件只读一次区块。跨轮不复用 canonical 判断，扫描前后及写入前的重组校验保留；结算规则不变。
5. 准备任务由新市场、事件、价格通知唤醒，1 秒合并突发通知；空闲每 5 秒兜底，积压时继续 100 ms 分批推进。无通知时空跑上限由约 3,600 次/小时降至约 720 次/小时；这是调度理论值，实际线上效果待发布后测量。
6. Docker 全部 11 个服务设置 20 MB × 5 文件的日志轮转。
7. PostgreSQL 配置全局查询统计、1 秒慢 SQL 阈值、I/O 计时和参数日志脱敏，并提供仅含 queryid/数字指标的只读查询脚本。现有业务角色不增加全局统计权限。

## 验证

- 后端 npm test 完整通过：243 项单元测试通过；类型检查、构建、OpenAPI/锁定摘要、接口契约和打包检查通过。
- 前端 763 个测试通过，类型检查与 build:vercel 通过，资源预算和 SEO 检查通过；该构建为本地未启用索引的验证构建，不是生产产物。
- 独立本地 PostgreSQL：analytics、confirmed display/reorg、display sections、event inbox 集成测试 6 项通过，无跳过。
- 0034 存量迁移、inbox、confirmed display 专项 4 项通过；验证迁移前后 holder items 和 chart 不变、重复 apply 不重复修改。
- RPC 区块复用测试 2 项通过；确认下一轮重新核验、扫描期间发生重组拒绝存储。
- 独立本地 PostgreSQL 14 已启用 pg_stat_statements；1.05 秒查询成功出现在慢日志和统计中。生产 PostgreSQL 17 镜像已确认包含该扩展文件，但未重启启用；17 的字段兼容已按官方文档处理，仍须在测试环境验收实际 17 容器。
- Compose 配置由远程 Docker Compose 只读解析，所有服务日志策略一致；未修改远程文件或容器。

## 发布边界

必须先发布兼容新旧口径的前端，再暂停旧展示/接口写入入口，执行 0034 并切换新后端/Worker；不能让旧 Writer 在迁移后重新写入旧值。清空短期进程响应缓存通过正常服务切换完成。已有浏览器长连接在此次 API 口径切换后应刷新到新前端。

PostgreSQL 全局统计需要一次容器重建/重启；日志轮转也需要重建对应容器。生产会有短暂数据库连接中断，不应静默执行。运行环境必须按 test→master 推进；Vercel 发布时使用 sin1，并执行现有 deployment-boundary 和 runtime region 检查。

详细运维步骤：`infra/vps/observability/retention.example.md`。本次不启用自动备份、Lark 或任何新增前端提示。
