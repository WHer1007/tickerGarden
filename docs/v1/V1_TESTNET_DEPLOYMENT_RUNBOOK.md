# TickerGarden V1 Robinhood 测试网部署手册

状态：`DEPLOYMENT_ELIGIBLE / NOT_PRODUCTION_READY / NOT_BROADCAST`
执行规范：`V1-EXEC-11`
目标网络：Robinhood Chain Testnet（chain ID `46630`）
部署计划：[`deployments/manifests/robinhood-testnet-46630.v1.plan.json`](../../deployments/manifests/robinhood-testnet-46630.v1.plan.json)
当前技术 gate 证据：[`deployments/evidence/v1-deployment-gates-current.json`](../../deployments/evidence/v1-deployment-gates-current.json)；历史证据：[`deployments/evidence/v1-deployment-gates.json`](../../deployments/evidence/v1-deployment-gates.json)

本文是正式操作顺序，不是广播授权。仓库当前为 `DEPLOYMENT_ELIGIBLE`，没有测试网部署交易或 release certificate，`broadcastAuthorized=false`；七个 deployment gate 已由当前证据关闭，八个生产 gate 仍开放。完整验证材料见 [`outputs/reviews/testnet-release-candidate/`](../../outputs/reviews/testnet-release-candidate/)。

`DeployV1Deterministic.run()` 现在先执行 `V1ReleaseGate._assertReleaseEligibility()`，再读取 `DEPLOYER_PRIVATE_KEY`。因此当前 open gate 会在私钥读取前 fail closed，不能通过官方 Forge broadcast entrypoint 绕过。`preview()` 仍只执行无密钥的确定性计划校验，不读取或要求 release certificate，也不授权广播。

进入可部署状态后，release operator 必须在真实证据通过后，由 operator review 签发仓库外或仓库内固定路径 `../deployments/evidence/v1-current-release.json` 的本地证书；当前没有该文件，不能创建伪造的 `VERIFIED` 文件。证书的固定字段形状为：

```json
{
  "status": "VERIFIED",
  "schemaVersion": 1,
  "verifiedAt": 0,
  "expiresAt": 0,
  "executionSpecId": "V1-EXEC-11",
  "executionManifestSha256": "0x…",
  "productArtifactManifestSha256": "0x…",
  "compiledInterfaceManifestSha256": "0x…",
  "chainId": 46630,
  "deployer": "0x…",
  "releaseId": "0x…",
  "payloadHash": "0x…"
}
```

`V1ReleaseGate` 要求 `status=VERIFIED`、schema version 为 `1`、证书未过期且 `expiresAt <= verifiedAt + 24h`，并绑定当前 execution manifest、product artifact manifest、compiled interface manifest 的精确文件 SHA-256；同时校验 `executionSpecId`、chain ID、deployer、release ID 与 payload hash。该本地文件是经 operator review 的证据载体，不是 cryptographic signature 或链上权限授予；签发前必须完成真实部署证据复核。

## 1. 不可跳过的部署边界

1. 只部署已冻结的 `V1-EXEC-11` runtime graph；不得在操作窗口临时修改源码、构造参数、角色、费率或地址。
2. `DeployV1Deterministic.preview()` 不读取私钥；必须先执行 preview，再由两名操作人员独立核对地址和 payload hash。
3. `DeployV1Deterministic.run()` 部署 runtime graph，但不会配置 Registry、授予长期角色、创建市场或转移管理权。
4. runtime graph 在第二笔交易中原子部署：16 个普通组件、Hook/Executor helper、Factory 要么全部成功，要么全部回滚。
5. runtime 成功后不可升级、销毁或回滚。发现错误时必须废弃整个 release，使用新的 `V1_RELEASE_ID`。
6. `V1_INITIAL_ADMIN` 必须等于 `V1_EXPECTED_DEPLOYER`。引导部署者只在 AccessManager 配置期持有 `ADMIN_ROLE`，并在最后一步永久放弃。
7. 测试网依赖地址不是 Robinhood 或 Uniswap 对 chain `46630` 的官方部署声明。广播前必须签署 `EXPLICIT_TEST_ONLY_PIN_ACCEPTANCE`，并在同一操作窗口重新验证全部 runtime codehash 和 PositionManager 绑定。
8. 不得把测试网依赖、测试 Stock fixture、测试 Safe 或测试 Treasury 地址复制进 Robinhood 主网 manifest。

官方网络资料：Robinhood 公布的测试网 RPC 为 `https://rpc.testnet.chain.robinhood.com`，浏览器为 `https://explorer.testnet.chain.robinhood.com`；公共 RPC 有速率限制，不应作为生产基础设施。参见 [Robinhood Chain 连接文档](https://docs.robinhood.com/chain/connecting/)。合约源码验证流程参见 [Robinhood Chain 合约部署文档](https://docs.robinhood.com/chain/deploy-smart-contracts/)。

## 2. 操作角色与签署输入

部署窗口至少需要以下相互独立的参与方：

- Release operator：执行只读 preview、模拟和广播。
- Reviewer：逐项复核配置、预测地址、payload hash、依赖 codehash 与交易回执。
- Governance Safe：持有延迟 `PROTOCOL_ADMIN_ROLE`。
- Guardian Safe：持有即时 `PAUSE_GUARDIAN_ROLE`，且不得与 Governance Safe 重合。
- Security/Governance Safe：持有延迟 `UNPAUSE_ROLE`。
- Root Publisher Safe 与 Root Reviewer Safe：两个相互独立、且不与上述核心 Safe 重合的 Treasury 角色。
- Platform Treasury：必须是有代码的合约账户，并匹配签署的 runtime codehash；不得临时替换为 EOA。

部署接口必须提供以下 27 个环境变量，字段名与部署脚本完全一致。签署包固定其中 26 个非秘密值，并以 `V1_EXPECTED_DEPLOYER` 固定私钥对应的公开地址：

```text
DEPLOYER_PRIVATE_KEY
V1_EXPECTED_DEPLOYER
V1_EXPECTED_CHAIN_ID
V1_RELEASE_ID
V1_EXPECTED_ORCHESTRATOR
V1_INITIAL_ADMIN
V1_POOL_MANAGER
V1_POOL_MANAGER_CODEHASH
V1_POSITION_MANAGER
V1_POSITION_MANAGER_CODEHASH
V1_PERMIT2
V1_PERMIT2_CODEHASH
V1_SWAP_ROUTER
V1_SWAP_ROUTER_CODEHASH
V1_QUOTER
V1_QUOTER_CODEHASH
V1_PLATFORM_TREASURY
V1_PLATFORM_TREASURY_CODEHASH
V1_ROOT_SERVICE_TREASURY
V1_ROOT_SERVICE_FEE_ASSET
V1_ROOT_SERVICE_FEE_AMOUNT
V1_FINALITY_DELAY_SECONDS
V1_FINALITY_DELAY_BLOCKS
V1_ROOT_PUBLICATION_WINDOW
V1_ROOT_REVIEW_DELAY
V1_CLAIM_WINDOW
V1_FEE_POLICY_ID
```

其中 `DEPLOYER_PRIVATE_KEY` 不得写入签署 JSON、`.env`、shell history、日志或仓库；签署包只记录对应的 `V1_EXPECTED_DEPLOYER`。`V1_FEE_POLICY_ID`、Treasury 费用、finality、Root 窗口和 claim 窗口都必须来自批准记录，不得直接采用单元测试示例值。

当前计划锁定的测试依赖如下；以 plan manifest 和临广播 live check 为准，不手工抄写地址：

| Dependency | Address | Runtime codehash |
| --- | --- | --- |
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626` |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` | `0xf3a0edb689229fa4bf135a728f2ec2eb4a2fbee2e41e3e74ffadb7b4c56e8a6d` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `0x0117e0ed818bc3f2a8729ffc336c837e63e965f04b473047b39b35ad86aac259` |
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` | `0xfdd90802f39ce5fc8bac4c2f1b3ac7bac530fd17ff46b0630f1bd00f1e14082f` |
| V4 Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` | `0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6` |
| StateView（部署后验证） | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | `0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6` |

## 3. T-24h：冻结候选版本

从干净、已审核的 commit 创建不可变 release 记录，保存 commit、编译器、Node/Python/Foundry 版本和机器生成物哈希。不得在部署窗口自动安装或升级依赖。

```bash
git status --short
git rev-parse HEAD
node --version
python3 --version
node tools/run-forge.mjs --version
node contracts/scripts/sync-dependencies.mjs --check
node tools/run-forge.mjs fmt --check
npm run test:spec
node tools/run-forge.mjs build --force
python3 spec/generate_v1_product_artifacts.py --check
python3 spec/generate_v1_artifact_manifest.py --check
npm run check:interfaces
npm --prefix deployments run build
npm --prefix deployments test
```

验收：没有格式漂移、生成物漂移、ABI/permission diff、编译警告升级或失败测试。若任一项失败，停止部署并重新走 release review。

## 4. T-4h：真实网络与 Fork 证据复核

将 RPC 放在不进入 history 的受控环境中。公开测试网 RPC 可用于只读复核；主网 Fork 必须使用能读取固定历史块完整 state/code/storage 的 archive-capable RPC。

```bash
export TG_RH_TESTNET_RPC_URL='https://rpc.testnet.chain.robinhood.com'
export TG_RH_ARCHIVE_RPC_URL='<operator-supplied-archive-rpc>'

ROBINHOOD_TESTNET_RPC_URL="$TG_RH_TESTNET_RPC_URL" \
  npm --prefix deployments run check:testnet-plan-live

ROBINHOOD_RPC_URL="$TG_RH_ARCHIVE_RPC_URL" npm run check:fork-track

ROBINHOOD_RPC_URL="$TG_RH_ARCHIVE_RPC_URL" \
ROBINHOOD_TESTNET_RPC_URL="$TG_RH_TESTNET_RPC_URL" \
  npm test
```

必须确认：

- chain ID 精确为 `46630`；不得连接 chain `4663` 或其他网络。
- canonical CREATE2 deployer、PoolManager、PositionManager、Permit2、Router、Quoter、StateView 的地址、代码长度、codehash 与 plan 完全一致。
- PositionManager 的 `poolManager()` 和 `permit2()` 绑定一致。
- 固定主网 Fork pin 以 [`outputs/reviews/testnet-release-candidate/fork-pin.json`](../../outputs/reviews/testnet-release-candidate/fork-pin.json) 和对应的官方 header 记录为准；本轮验证使用块 `55165256`、哈希 `0xc6c62c0bc02d8a2e71d1898213cdd3f7606a957de11827e5df6646bca1d16ed7`。BlockReq 的响应省略 `l1BlockNumber`；适配器核对两个来源同一区块的 hash/stateRoot 后，仅从该区块的官方原始 header 恢复此字段，不修改账户、存储或交易状态。
- Fork/E2E 真实执行官方 CRM BeaconProxy/Beacon/implementation、Stock Quote 准入、最终一笔 buy 的原子 v4 graduation、StateView、Vault deposit/allocation/rageQuit。Stock 余额由测试 cheatcode 合成，不得描述为历史自然余额。

公共测试网 RPC 只适合近期 `latest` 读取；无法读取历史合约状态时，固定 Fork 必须改用 archive-capable RPC，不能把近期读数当作历史证明或伪造 finalized codehash。兼容代理只能转换特定 EIP-1898 block 参数，不能把裁剪节点变成 archive 节点。Fork 中用于资金准备的 synthetic TWAB 仅是测试证据，不代表生产权重。

## 5. T-1h：无密钥确定性 preview

先加载经过签署的非秘密参数。不要在命令行直接写值；示例文件必须位于仓库外，并确保内容不含私钥。

```bash
set -a
source /secure/tickergarden/v1-46630-signed.env
set +a

test "$V1_EXPECTED_CHAIN_ID" = '46630'
test "$V1_INITIAL_ADMIN" = "$V1_EXPECTED_DEPLOYER"

node tools/run-forge.mjs script \
  script/v1/DeployV1Deterministic.s.sol:DeployV1Deterministic \
  --sig 'preview()' \
  --rpc-url "$TG_RH_TESTNET_RPC_URL" \
  -vvvv | tee /secure/tickergarden/v1-46630-preview.log
```

从 preview 输出提取并双人复核：

- release ID；
- orchestrator 地址与 salt；
- helper 地址、salt 与搜索次数；
- Hook 地址及低 14 bit permission mask `0x2044`；
- Executor 与 Factory 地址；
- deployment payload hash。

将 preview 得到的 orchestrator 地址写入签署参数 `V1_EXPECTED_ORCHESTRATOR`，再运行一次 preview，确认输出逐字节不变。任何参数变更都会使原签署失效。

## 6. T-30m：带密钥本地模拟，不广播

使用专用、低余额测试网部署账户。Robinhood 官方部署文档同样要求不要提交私钥，并建议测试使用一次性账户。私钥通过隐藏输入注入，只在当前 shell 生命周期存在：

```bash
read -rs 'DEPLOYER_PRIVATE_KEY?Deployer private key: '
export DEPLOYER_PRIVATE_KEY
echo

node tools/run-forge.mjs script \
  script/v1/DeployV1Deterministic.s.sol:DeployV1Deterministic \
  --sig 'run()' \
  --rpc-url "$TG_RH_TESTNET_RPC_URL" \
  -vvvv
```

此命令没有 `--broadcast`，只执行 Forge 模拟。脚本会在内部从密钥推导地址，并与 `V1_EXPECTED_DEPLOYER` 精确比较，因此无需把私钥作为其他命令的参数暴露给进程列表。核对两笔预期交易、gas、预测地址和所有内部 CREATE2。失败时执行 `unset DEPLOYER_PRIVATE_KEY`，不得继续。

## 7. T0：最后复核与广播

广播前重新运行 `check:testnet-plan-live`。Reviewer 在同一窗口签署以下结论：

- 测试依赖接受记录有效；
- 最新 codehash 与绑定无漂移；
- 账户、chain ID、release ID、orchestrator、payload hash 与 preview 一致；
- 测试网 gas 余额满足上限并保留余量；
- 没有待处理的源码、生成物或配置修改；
- 本次授权仅覆盖 runtime graph 两笔交易，不覆盖 Registry 激活、角色移交或市场创建。

仅在获得明确书面广播授权后执行：

```bash
node tools/run-forge.mjs script \
  script/v1/DeployV1Deterministic.s.sol:DeployV1Deterministic \
  --sig 'run()' \
  --rpc-url "$TG_RH_TESTNET_RPC_URL" \
  --broadcast \
  --slow \
  -vvvv

unset DEPLOYER_PRIVATE_KEY
```

立刻保存 Foundry broadcast JSON、交易哈希、区块哈希、状态、gas 和日志；不得把含私密 RPC 凭证的完整命令行写入证据文件。

## 8. T+15m：runtime graph 验收与源码验证

在 finalized 后逐项确认：

1. orchestrator 的 `authorizer`、`releaseId`、`completed=true`、`deploymentPayloadHash` 与 preview 一致。
2. 16 个 ordinary components、helper、Hook、Executor、Factory 全部位于预测地址且有代码。
3. Hook 低 14 bit 为 `0x2044`；Factory/Hook/Executor/Registry/Vault/Treasury 的构造绑定全部一致。
4. 外部依赖 codehash 与 PositionManager 绑定仍一致。
5. 所有合约使用锁定 compiler/settings/constructor args 在 Blockscout 验证；参考 [Robinhood 的 Foundry/Blockscout 验证步骤](https://docs.robinhood.com/chain/deploy-smart-contracts/)。

若 runtime 成功但任一验收失败，不进行激活；按回滚清单废弃 release。

## 9. T+30m：AccessManager 配置与角色移交

从实际部署地址生成 calldata-only 计划。输入 JSON 位于仓库外，必须包含 `accessManager`、`deployer`、五个 Safe 和 `spec/v1_compiled_interface_manifest.json` 中全部 19 个 `moduleAddresses`，不能多也不能少。

```bash
npm --prefix deployments run render:access-manager-plan -- \
  /secure/tickergarden/v1-46630-access-input.json \
  > /secure/tickergarden/v1-46630-access-plan.json
```

在固定块 Fork 或测试网模拟中完整重放后，通过部署者与 Safe 按以下阶段严格执行并逐笔等待最终确认：

1. `BOOTSTRAP_GUARDIANS`
2. `PROTOCOL_SELECTORS`
3. `ROLE_GRANTS`
4. `FREEZE_ADMIN_SURFACE`
5. `RENOUNCE_DEPLOYER`

在执行最后一步前，必须证明 23 个 role-gated selectors、61 个 direct/immutable selectors、五个角色成员及延迟均与计划完全一致。`RENOUNCE_DEPLOYER` 不可撤销，不能批量隐藏在未经逐项审阅的交易中。

## 10. Registry 激活、测试 Stock 与 canary

Registry 激活与 runtime 部署分离。每条 Asset、Quote、Pons baseline、Launch template 都采用追加式 ID，并保存 calldata、交易、证据哈希和 effective 状态。

Robinhood 官方 Stock Token 当前取证路径位于主网 chain `4663`；[官方 Stock Token API 文档](https://docs.robinhood.com/chain/stock-token-apis/) 不能证明 chain `46630` 存在同一资产。测试网 canary 因此只有两种合规方式：

- 使用经过单独源码、proxy/implementation、余额 delta 与身份策略评审的测试专用 Stock fixture；或
- 仅完成 runtime 与角色移交，不创建 Stock 市场。

不得把合成 fixture 登记成官方 Robinhood Stock。若没有单独批准的测试 Asset/Quote/market vector，本次 rehearsal 到角色移交即结束。

一旦创建市场，市场不可由 owner 暂停、终止、救援或指定资产接收人；配置级 pause/retire 只阻止新的市场或敞口。毕业在最后一笔 buy 内原子完成，不存在人工补建池步骤。

## 11. 链上候选 manifest 与最终验收

部署前 plan manifest 不能改写成“已部署”。交易和角色移交完成后，新建 `TICKERGARDEN_V1_NETWORK_DEPLOYMENT` 候选 manifest：

- chain `46630` 只能使用 `releaseStatus=DEPLOYMENT_CANDIDATE`；
- 写入 finalized block、全部 module 地址/代码哈希/构造哈希、source verification、CREATE2 证据、AccessManager receipt、角色移交回执和测试报告；
- schema 要求至少一个经审核的 Quote 与 official Stock 向量。若测试网没有合规 Stock canary，只保留 plan、runtime receipt 与角色证据，不得伪造完整候选 manifest；
- `PRODUCTION_CANDIDATE` 只允许 chain `4663`，并且仍须关闭八个生产 gate。

对完整候选 manifest 执行只读链上验证：

```bash
V1_DEPLOYMENT_RPC_URL="$TG_RH_TESTNET_RPC_URL" \
  npm --prefix deployments run check:manifest-live -- \
  /secure/tickergarden/robinhood-testnet-46630.v1.deployed.json
```

正式结束条件：

- 计划、preview、交易与链上地址完全一致；
- runtime graph、外部依赖与所有 immutable bindings 通过；
- 源码验证完成；
- AccessManager exact diff 通过，部署者 `ADMIN_ROLE` 已放弃；
- 候选 manifest（如具备合规 canary）通过 schema 与 read-only live preflight；
- 前端资金敏感入口在产品激活批准前保持关闭；
- 证据仍明确标注 `NOT_PRODUCTION_READY`，不得据此宣传生产上线。

操作异常时立即转入 [`V1_TESTNET_ROLLBACK_CHECKLIST.md`](./V1_TESTNET_ROLLBACK_CHECKLIST.md)。
