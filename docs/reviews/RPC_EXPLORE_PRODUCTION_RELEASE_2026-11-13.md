# RPC 与 Explore 优化生产发布 — 2026-11-13

已根据用户“将以上优化过（前端和后端）的内容发布到生产”的授权，于北京时间 **2026-11-13 23:48:41** 完成发布，随后通过线上验收。

## 发布范围与版本

| 范围 | 生产结果 |
| --- | --- |
| RPC 优化 | BSC Web 独立预算、固定区块分组读取、Pipeline 链身份短期缓存、用途日志、页面并发只读合并、交易状态退避均已上线 |
| BSC Explore | checksummed stockToken 正常识别，TBULL 卡片显示 NVDAB |
| RH Explore | 可见市场 Quote 加入按需价格刷新；RH 报价以 HTTP 接收时间校验，SEED 市值恢复 |
| 共用 Web / RH | `75dc280b3ae797e674cac46ace8644043f4b8f3b` |
| BSC 独立后端 | `2d124f5f2cea220dffba3879332e6df4290198e2` |

主仓库候选从 `1f1e207` 建立隔离工作区，只整合 `0fd151e20e`、`9d301634de`、`a6bf185bf3` 三组已验证改动。BSC 从 `48881c4` 接受 `2d124f5`。两个仓库都经 `test → master` 快进，主仓库两分支已推送；BSC 使用其既有独立生产源码仓库，未覆盖原 BSC 开发目录。

最终生产配置构建发现主业务包约 501.4 KB，触发既有 500 KB 门禁。没有提高阈值，而将原有 BSC 静态目录放进 `asset-catalogs` 分包，主包降至约 449.6 KB。另将 RH resident 的公开 release/chain 标识纳入现有权威配置投影，避免新逻辑继续标记旧版本。这两项装配调整也经过测试分支晋级和最终构建验收。

## 部署与隔离

沿用新加坡 VPS 主机托管，未调用 Vercel、恢复其项目或调整域名。

顺序更新并逐项检查：RH Read/Pipeline、BSC Read/Pipeline、RH Resident、RH Display、BSC Display，最后 Web。共 8 个服务，全部 active、NRestarts=0。存在串行服务重启窗口，不能描述为零停机。

- 只更新 56 个运行/装配文件及 357 个候选 Web 静态资产，全部逐项 SHA-256 读回通过。
- 核对 613 个受版本管理的前端运行源码/资源基线；服务器上的旧测试文件未当作运行源码发布。
- CSS 字节指纹与原生产一致；HTML 布局、样式、合约、经济参数、资产准入、业务开关及签名器均未改变。
- Content、统一 Gateway、测试环境、数据库、持久队列和事件中继进程保持不变，未做数据库迁移。
- 旧哈希静态资源保留，兼容已打开的页面。原 Links 禁用展示及上传 CSP 许可仍有效。
- 生产唯一人工配置仍为 `/etc/tickergarden/hosting.json`。Web 的 BSC 预算 token/access token 从 BSC Read 配置派生，只存在于私有运行投影；与 RH 凭据独立，未进入浏览器。
- 本轮没有新建市场、钱包签名、转账、交易或领奖。RPC 验收仅为两条链各一次已登记合约的受限 `eth_getCode` 读取。

## 验证

| 检查 | 结果 |
| --- | --- |
| 最终整合前端测试 | 826/826 |
| RH 后端单元测试 | 269 通过、1 项环境条件跳过；相关主网文件此前已独立 2/2 通过 |
| BSC 后端测试 | 279/279 |
| TypeScript、ABI/source、生成客户端和目录 | 通过 |
| 运维配置测试 | 8/8，另有部署边界测试通过 |
| 生产配置构建 | 性能、分包边界、SEO 门禁通过；既有禁止索引策略保留 |
| 最终构建浏览器 fixture | RH/BSC 各 1440px、390px；RH MC 更新、BSC NVDAB 正常；无页面异常，无链 RPC |
| 线上真实浏览器 | RH/BSC Trade、Create、Explore 共 6 页；无未捕获 JS 异常或横向溢出 |
| 线上卡片 | TBULL ticker=NVDAB；SEED ticker=AAPL、MC 约 `$3.1K`；该值为验收时行情估算，会随有效报价变化 |
| Web RPC | BSC 与 RH 范围内合约读取均 HTTP 200，返回非空 bytecode；BSC 独立预算投影四项核对通过 |
| 运行读回 | 全部修改文件指纹、357 静态资产、8 个服务版本标识及健康检查通过；未涉及的服务 PID/状态不变 |

发布后短时日志观察，两个 Display Worker 均处理价格批次且未产生 RPC，未见新的后端 warn/error。Web 仍出现一次此前已记录的 `market_metadata_unavailable`，属于 BSC 服务端 metadata 仍读 RH 来源的旧问题，本次未处理。不能将短时观察等同于长期无异常，也不能把受控测试的 RPC 节省量当作实际账单下降比例。

两个 Display Worker 原有覆盖缺口仍为 `gap / synchronized=false`。没有通过扫块或改标记清除；本次修复不代表该独立历史问题已解决。

## 记录和回滚

服务器 manifest：`/opt/tickergarden-hosting/releases/20261112/release-manifest.json` 的 `rpcExploreRelease`。

root 私有回滚目录：

`/opt/tickergarden-hosting/releases/20261112/backups/rpc-explore-20261113T154732Z`

内含原运行文件、权威配置、manifest、原 Web dist、服务状态和部署结果。回滚只恢复该层、重新生成运行投影并重启本轮受影响服务；不要回滚其他已发布修复、数据库或业务状态。

本地验证资料：隔离工作区 `.codex_tmp/rpc-explore-release/`，含冻结 packet、构建/回归日志、上线读回、6 页浏览器结果及 RH/BSC 手机截图。暂存部署包不包含私钥、生产数据库内容或人工配置凭据。
