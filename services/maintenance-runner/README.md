# TickerGarden V2 maintenance runner

This package reserves the boundary for optional permissionless maintenance calls described by the V2 plan. It currently exports only a frozen descriptor and cannot read chain state, construct transactions, submit transactions, custody funds, or exercise privileged roles.

Operation allowlists and retry behavior must be derived from the final compiled ABI and permissions manifest; they are intentionally absent at scaffold stage.

```bash
npm run build
npm test
```
