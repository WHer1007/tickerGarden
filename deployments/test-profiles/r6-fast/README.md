# R6 快速测试发布包

只用于 Arbitrum Sepolia 421614；不是生产发布包。R5 默认manifest和生产源码保持原样。

- `overlay/`：本轮相对主目录变更的完整文件，可直接审阅。
- `source-overlay.patch` / `overlay-index.json`：精确差异和base/new SHA256。只在新隔离快照且base hash匹配时应用，不要覆盖主目录。
- `profile.json`：初始短周期参数；后续L2区块及schema联动修复以overlay和链上核验为准。
- `arbitrum-sepolia.r6-fast.public.env`：公开部署参数，没有私钥。
- `frontend-public.env`：新地址，需匹配R6索引/API；不能连接R5数据服务。

实际运行快照在 `.codex_tmp/r6-fast-test`，独立journal在该快照的outputs/deployments/releases内。重建源码不代表可以删除journal或重放交易。正式证据与报告见主目录 `outputs/reviews/r6-fast-test-2026-09-06`，发布manifest见 `deployments/releases/0xf2ab431cdae9144d0bd1b5f4f3c52c337e0b77a5aa8fd5504cff3d46bf2eec4f`。
