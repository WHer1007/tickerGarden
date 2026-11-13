# BSC Explore 股票 ticker 修复（2026-11-13）

状态：本地修复、回归与浏览器验收完成，未发布生产。

生产公开 `/v1/explore/bootstrap?chainId=56` 返回 78 项资产，`stockToken` 为大小写混合的 EVM 地址。TBULL 的 asset UID 可以正确关联 NVDAB，市场 symbol 也正确返回 TBULL；数据没有缺失。

根因位于 `app.ts` 的 `stockToken()`：直接将原值传入仅接受小写的 `ADDRESS_PATTERN`，导致 78 个实际返回地址全部误判为 null。Explore 在 stockAddress 为 null 时显示 `-`，同时不能取得相关股票标识。目录查询本身已有大小写处理，但在执行到该查询前就被错误短路。

修复将配置地址规范化为小写后验证，并统一 Explore 与股票目录使用的地址提取函数。保留 chain + token address + asset UID 的身份匹配、状态限制和 GPROB 禁用规则；没有改变页面 HTML、CSS、合约或后端配置，也不增加 RPC 请求。

验收结果：

- 用当前生产公开 bootstrap 逐项复核：修复前 78/78 地址被该 helper 拒绝，修复后 78/78 正确映射到股票 ticker。
- Chrome 桌面 1440px 和手机 390px，使用生产公开接口快照回放真实 Explore 页面：修复前 TBULL 股票栏为 `-`；修复后为 `NVDAB` 且股票图标可见，MEME symbol 保持 `$TBULL`。两种尺寸均无页面异常、无 RPC 请求。
- 814 项前端测试全部通过，包括 RH 全目录与 BSC 78 项 checksum／小写映射、错误地址、跨链不匹配和准入规则回归。
- `build:vercel` 通过，包含类型、ABI source、生成客户端、catalog、构建、性能预算及 SEO 检查。此命令只构建本地产物，没有部署。

固定基线为 master `1f1e20718a0ba1e3e17bfd67cab84fb74c234f85`，独立分支 `codex/bsc-explore-ticker-20261113`。未混入上一轮尚未发布的 RPC 优化。

本地证据位于 `.codex_tmp/explore-ticker/`（公开 API 快照、浏览器脚本、修复前后截图与测试日志）。上线前仍需经过授权的 test → master 晋级与生产发布流程；当前生产页面尚未应用此修复。
