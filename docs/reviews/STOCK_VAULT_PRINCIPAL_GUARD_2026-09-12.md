# Stock Vault 已有本金缺口保护 — 2026-09-12

## 实现

`contracts/src/v1/shared/UserStockVaultDeposits.sol` 在 `transferFrom` 前，将已有的 `beforeBalance` 与 `_totalDeposited[assetUid]` 比较。实际余额不足时抛出 `StockPrincipalDeficit(assetUid, balance, required)`，不会转入新资金。

检查位于共享 `_depositStock`，同时覆盖用户 `depositStock` 和 AllocationManager 调用的 `depositStockFor`。沿用已有资产身份、精确到账和重入保护；无需额外读取 token 余额。按 Asset UID 隔离，不影响其他资产存款。

提现与 rageQuit 路径没有增加本金全额覆盖条件。该改动只阻止新存款进入已有缺口，不能弥补旧损失或保证未来外部资产不会扣减。余额恢复到足额后自动恢复正常存款，无新增管理员恢复开关。

## 定向验证

`contracts/test/v1/audit/StockVaultCustodyBoundary.t.sol`：22 passed，0 failed。

- 200 本金、150 实际余额时，直接/Manager 代存均以包含金额的自定义错误拒绝，并断言没有调用 transferFrom。
- 拒绝后，新用户余额、allowance、个人账本和 Vault 总本金均不变。
- 本金缺口下仍可退出有余额支付的自由本金与已分配本金，未把新存款保护扩展成全局提现冻结。
- 缺口不影响同 Vault 的另一资产；补足至相等后恢复存款，存在盈余时也正常存款，盈余不虚增个人本金。
- 既有暂停/退役退出、精确到账、异常 token、重入与重复身份扫描 Gas 回归继续通过。

## 交付边界

本轮修改本地合约、回归测试及产品 artifact manifest。没有部署、广播或改写历史部署证据；已部署 Vault 不会自动获得本次保护。

完整回归结果及源码指纹保存在 `outputs/reviews/stock-vault-principal-guard-2026-09-12/`。

## 完整验证结果

- Foundry：88 suites，986 passed，0 failed，0 skipped（排除真实 Fork）。
- execution spec：63 passed；current contract surface：3 passed。
- fixture、boundary、interface、接口 artifact 和产品 artifact 检查通过；`git diff --check` 通过。
- 当前产品 manifest：`0x3f3c08da844e224b6adb06d24e015788986f409ce127ae7d9fe64b60f3b92310`。
- 本轮未运行真实链 Fork 或生产部署验收。
