# Staking 资产资料表

维护文件：`staking-assets.json`。这是随前端发布的静态配置数据表，不需要数据库或额外 RPC。

| 字段 | 说明 |
| --- | --- |
| chainId | 链 ID；测试网与主网必须分别登记 |
| assetUid | OfficialStockRegistry 中的资产 ID |
| tokenAddress | 此链上的 Stock 合约地址 |
| symbol / name | 展示符号与名称 |
| decimals | 资产精度资料；交易仍使用链上配置 |
| logo | `apps/web/assets/quotes/` 下的 SVG 或 PNG 文件名 |
| enabled | 是否允许在创建页选择此质押资产 |

当前资料源为 sourceManifest 指向的已有发行记录，包含 Robinhood 测试网（46630）的 TSLA、AMZN、PLTR、NFLX、AMD。这不是一次新的链上状态检查。尚未登记主网资产，不会将测试网地址自动用于主网。

新增资产时填写完整行，并将 Logo 放入上述目录。修改名称、Logo 或本地展示开关无需重新部署合约，但需要重新发布前端；开发服务器会热更新。

创建页按链 ID、合约地址和 assetUid 精确匹配，且要求链上配置 status=1。本地 enabled=true 不能激活链上未登记的资产。新增链上资格仍需现有 Registry 管理流程。

enabled=false 会从新建市场的质押资产选项中移除该资产，资料仍保留用于旧市场展示，不阻止已有仓位领取或退出。该开关不是链上全局暂停开关，也不会禁止已有市场新增质押。

接入位置：创建页质押资产下拉、详情页质押标识和 Stock 名称、质押弹框的资产名称及 Logo。配对资产仍使用独立的 paired-assets 清单。

校验：`npm --prefix apps/web run typecheck`，以及在 `apps/web` 下执行 `node --experimental-strip-types --test tests/staking-assets.test.ts`。
