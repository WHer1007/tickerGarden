# QuickNode 主节点与 Alchemy 备用接入

## 范围

主网 4663 的 HTTP 查询、Web RPC 代理与项目日志 WebSocket 订阅优先使用 QuickNode；Alchemy 为可用性备用。保持单源信任策略，不增加每次双源查询，不改变资金结算确认规则、地址/事件过滤或页面数据读取方式。交易广播不自动重试。

## 凭据

Endpoint Authentication Token 存放于 `/Users/dear/Documents/code/TickerGarden/.env.master.local` 的 `QUICKNODE_API_KEY`。HTTP/WS 基址分别为 `QUICKNODE_HTTP_BASE`、`QUICKNODE_WS_BASE`。实际 URL 使用路径 Token；没有将密钥写入本报告、Git 或 VITE 变量。部署仅设置对应服务的 RPC 主备 URL，不能上传整份本机配置。

## 实测

- 主网 Chain ID 4663，latest、finalized 区块可读。
- 激活区块 63094312 的哈希与已部署清单一致。
- 激活区块的 Registry 代码、`minimumAllocation(bytes32)` 历史状态读取成功。
- 限定项目代币地址和 Transfer 事件的日志查询、WebSocket 订阅与取消订阅成功；未广播任何交易。
- 当前 Discover 套餐 `eth_getLogs` 区块范围上限为 5；10 区块查询返回 HTTP 413 / -32615。超过上限的补扫直接走 Alchemy，避免大量分片调用和反复失败。
- 实际 QuickNode 固定区块读取成功；模拟主节点 503 后，使用真实 Alchemy 读取同一固定区块，哈希一致。

本次没有制造链上交易或链重组，订阅验收证明订阅协议与项目过滤兼容，不代表新成交事件实测。

## 失败策略

- 仅网络/超时/限流/服务异常切换；应用回滚、非法参数不因切换被当作成功。
- 查询参数、指定区块不变；跨节点仍校验链身份，业务层仍保留区块与回执一致性检查。
- 只合并在途相同查询，不缓存资金判断。后台主节点故障进入短暂冷却，随后重新尝试主节点。
- Relay 保留持久事件入口、去重和补漏；同一时间只保留一个活动连接，备用期间定期恢复主节点。
- 不记录完整上游 URL、Token 或原始提供商错误文案。

## 本地验收

后端、Web、Relay 单元测试和 TypeScript 检查；Web 构建/资源预算/SEO；Vercel 打包与部署边界检查。发布状态以独立的实际部署验收记录为准，此报告不单独证明线上已切换。

## 配置映射

见 `config/README.md` 的 QuickNode 配置表。主网保持 `TG_RPC_VERIFICATION_MODE=single`；`*_RPC_FALLBACK_URL` 不等于 `TG_SECONDARY_RPC_URL`。

参考：[QuickNode Welcome](https://www.quicknode.com/docs/welcome)、[Robinhood RPC](https://www.quicknode.com/docs/robinhood)、[eth_getLogs](https://www.quicknode.com/docs/robinhood/eth_getLogs)、[eth_subscribe](https://www.quicknode.com/docs/robinhood/eth_subscribe)。
