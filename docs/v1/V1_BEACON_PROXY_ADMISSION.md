# V1 Beacon 代理准入边界

2026-09-05 修复：完整 runtime 校验替代任意位置的 Beacon 字节子串匹配。

- 权威模板：`spec/v1_beacon_proxy_templates.json`。当前支持本仓库 OZ 5.2 / solc 0.8.26 的无 metadata runtime，以及 RH Stock 已记录的 solc 0.8.33 完整 runtime（包含固定 metadata）。
- 两个程序均以 byte 29 的 immutable word 为 Beacon，通过其 `implementation()` 返回值进行实际 delegatecall。仅该 word 中的 20 字节地址允许变化，其余所有 runtime 字节均须匹配；高 12 字节必须为零，Beacon 不得为零。
- Solidity 对完整规范化 runtime 取 hash；TypeScript preflight 和 Python catalog 生成器比较相同模板。跨语言回归校验模板/hash、逐字节变异及假 Beacon 攻击。
- 链上仍检查 Beacon、实现的 codehash 及嵌套代理约束，原始完整 token codehash 仍绑定资产。管理员提交任意指纹不能扩展受支持程序集合。
- 添加新编译器或代理变体必须审核完整程序、增加模板及回归并重新部署，不能通过弱化检测自动兼容。

RH 模板的 runtime hash 为 `0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630`，与仓库官方资产快照一致；本次只读 RPC 获取的 CRM runtime 也与该 hash 一致。此核对不是固定区块 Fork/E2E，也不是现有全部资产的当前状态批准。

这是代理执行关系约束，不是任意代币全部业务行为的安全证明。官方来源、管理权限、实现行为和资产准入审核仍不可省略。历史部署证据不能覆盖修复后的 Registry/Vault/Gauge/Factory 产物。
