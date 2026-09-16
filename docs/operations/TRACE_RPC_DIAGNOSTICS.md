# Trace RPC diagnostics

本文件记录 call-trace RPC 的边界修复及已实现的脱敏错误接口。它不证明真实 RPC trace 已通过，也不证明 Holder 历史或发布闭环已完成。

## Root trace 类型

Root transaction trace 允许 `CALL` 和 `CREATE` 两种类型。此前将 root trace 限定为 `CALL` 会拒绝合法合约创建交易；修复后，调用方应根据已认证交易判断期望类型：普通调用要求 `CALL`，合约创建要求 `CREATE`，并继续逐项绑定 `from`、`to`、input、value、receipt status 和 transaction hash。子调用仍受现有深度、节点数、数据大小和 ABI 格式限制。

允许 `CREATE` 只修正 trace 结构校验，不改变 callTracer 是 provider execution evidence、不是共识证明的边界。trace 仍必须绑定已认证交易、canonical receipt block 和完整 transaction coverage。

## 脱敏错误分类

诊断接口通过可包装的 `TraceError` 暴露有限分类，并保持 `errors.Is(err, ErrTraceUnavailable)` 为真。分类值为：

- `http_status`：RPC HTTP 层返回非成功状态；
- `rpc_error`：JSON-RPC 返回结构化 error；
- `transport`：请求连接失败、取消或超时；
- `invalid_trace`：响应可读取但不符合 trace schema、边界或 root 约束。

分类只用于运维定位，不触发自动重试。HTTP 400 不应被自动解释为权限问题或链故障；它可能来自 provider 参数、方法、请求限制或其他服务端策略。诊断输出不得回显 endpoint、请求 body、认证信息或 provider 原始 message。对外响应应使用稳定的通用不可用错误。

## 当前未完成

本地测试覆盖 RPC CREATE 接受与错误类型拒绝、经真实客户端入口的合成整块回放、失败不修改账本、错误分类、取消语义与脱敏。尚未在本文中宣称任何真实 trace、CREATE 生产交易、provider 兼容性或全历史回放已经验证。持久化恢复、trace 共识证明、完整历史、D01/D02 发布门禁和生产广播仍保持未完成。

## 只读诊断命令

```sh
cd services/backend-go
# TG_HOLDER_RPC_URL 已安全配置；缺省回退到 TG_RPC_URL。
go run ./cmd/trace-inspect --describe
go run ./cmd/trace-inspect --once 421614 TRANSACTION_HASH
```

正式编译后的二进制退出码：0 表示 trace 结构校验通过；1 表示参数、网络身份或输出失败；2 表示 trace 不可用（JSON 含脱敏分类）。`go run` 对非零程序退出码会额外包装，自动化请使用 `bin/trace-inspect`。命令只读取 chainId 和一笔 trace，不执行重试、不写账本、不验证交易根或回执，不证明 trace 对应已认证交易。成功也始终保留 historyVerified/publicationEligible=false。

本轮公开 RPC 只读探测网络 421614、系统交易 `0x501729bce8bb0bda4f86d60c3432cb9bdd8965ad88b1e855fa1f85f2af2b356d`，结果为 `http_status` / 400。这只是当前请求结果，不能定位具体原因，也不代表 CREATE 公链验收完成。记录见 `outputs/reviews/trace-diagnostics-2026-09-07/live-probe.json`。
