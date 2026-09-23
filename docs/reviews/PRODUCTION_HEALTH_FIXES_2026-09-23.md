# 生产健康检查后续修正

状态：已按测试验收 → 生产发布完成。运行代码为 `7f5e530f76bf64d288d14cb33e74bbc7544e06e9`；测试和生产均已执行 0034、更新权限、重建 PostgreSQL 并切换 Worker/应用。以下本地验证条目记录发布前证据，线上结果见末节。

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


## 线上发布验收（2026-09-23 UTC）

- 用户明确允许数据库短暂重启；先测试、后生产。test/master 均使用上述同一产品提交，已推送远端。后续文档提交不改变运行产物。
- 测试数据库慢查询探针 1.05 秒同时进入日志与 pg_stat_statements；生产未制造慢查询。两环境的业务和 queue 数据库均安装扩展，生产 `pending_restart=0`。
- 生产后台写入暂停于 15:17:11，恢复于 15:18:59（约 108 秒维护窗口，不等同于数据库停机时长）。数据库重建步骤在 15:17:20–15:17:34 内完成。保留数据卷、HBA、证书和连接预算，事前创建一次性维护备份；未启用自动备份。
- 0034 摘要 `0xd288699d33a878c17e6c13614485f5fce6543e8cd905be35d4732e3bbdd32c2d`。两环境均验证重复执行幂等、Holder 余额和其他详情区域摘要不变。
- SEED 的 1H/12H/1D 接口均返回 `CHAIN_TOTAL_SUPPLY_V1`，totalSupplyRaw 与 circulatingSupplyRaw 均为 `1000000000000000000000000000`，Holder 数 1、交易记录 2。测试市场也通过相同断言。
- 两环境 health、Explore bootstrap/list、market page/detail、Stats 三区域、共享价格接口均返回 200。独立 Chrome 浏览器读取首页、Explore、Stats、详情页，生产无 pageerror，供应量/市值/价格/最近交易均可见；测试 URL 保持测试域名，未跳转生产。
- 所有 9 个实际运行容器均为 json-file 20m × 5；包括两个环境的 PostgreSQL、Queue、MinIO、Relay 和 Caddy。仓库另外两个初始化服务也配置轮转。
- Worker/resident 服务与定时器恢复 active；生产 Relay health 正常，pending/dead 为 0，重建后 restart=0。展示游标持续推进，SQL 超时、连接超时、任务失败均为 0。
- 全局统计已采集真实业务：短样本中 read-api 最大 SQL 9.44 ms、pipeline 46.59 ms、queue 11.79 ms、content 0.44 ms，业务语句临时块写入均为 0。两次采样间数据库累计临时文件数/字节保持不变；约 1.20 TB 是保留的历史累计统计，本次没有清零。
- 业务角色未获得 pg_read_all_stats；read/pipeline/content 外部连接保持 TLS。Queue 使用既有 Docker 内网连接。生产连接上限仍为 read 34、pipeline 26、content 4、queue 8。
- 短期生产 Worker 样本含 display.prepare 18 次、display.advance 11 次，未记录 error。处于发布后追赶/唤醒阶段，不据此推算日均 RPC 节省或供应商账单。

### 发布过程修正

测试首次重建 Queue/Relay 遗漏环境 release override，Relay 使用旧默认镜像并重启；发现后在生产操作前恢复正确镜像和环境配置，确认健康、无积压后才推进生产。生产 Relay 仅定义在 override 中，另补显式日志策略并重建。运维文档已补齐覆盖文件要求。生产前端先行发布以兼容新旧 basis；后续批次再次 promote 前端返回 already-current 409，已核实该候选本来就是当前生产版本，无需重复发布。

### Vercel 产物

以下全部在发布前通过每个函数 sin1 检查（Web 2、Read API 3、Pipeline 2、Content 2）。

| 环境 | Web | Read API | Pipeline | Content |
|---|---|---|---|---|
| 测试 | tickergarden-hwqqrntyf-garden24.vercel.app | tickergarden-read-ivgot79xb-garden24.vercel.app | tickergarden-chain-pipeline-gini2iu2o-garden24.vercel.app | tickergarden-content-ed9l4oigh-garden24.vercel.app |
| 生产 | tickergarden-npvis102g-garden24.vercel.app | tickergarden-read-bfsa8vrs5-garden24.vercel.app | tickergarden-chain-pipeline-i3pkvqre3-garden24.vercel.app | tickergarden-content-g7401a10j-garden24.vercel.app |

部署日志、迁移断言、API 响应与浏览器正文证据保存在本地 alignment 工作区 `.codex_tmp/releases/0034-2026-09-23/`；不把运行环境文件或凭据纳入 Git。本次未签名、未提交链上交易、未新增页面组件。
