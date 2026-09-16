import fs from 'node:fs';import path from 'node:path';import {createHash}from'node:crypto';
const root=process.cwd(),dir='outputs/reviews/r5-business-acceptance-2026-09-06';
const read=(p,fallback=null)=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p)):fallback;
const catalog=read('docs/testing/R5_BUSINESS_CASES.json'),s=read(dir+'/public/results.json'),audit=read(dir+'/public/receipt-audit.json'),local=read(dir+'/local-contract-results.json'),baseline=read(dir+'/baseline.json');
const checks=new Map(s.checks.map(x=>[x.id,x]));const has=x=>checks.get(x)?.status==='PASS';const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const evidence=p=>({path:p,sha256:hash(p)});const isAudited=audit?.sourceTransactions===s.transactions.length&&audit.status==='RECEIPTS_AND_OBSERVED_ACCOUNTING_VERIFIED';
const matrixLog=fs.existsSync(dir+'/local-matrix-fork-retry.log')?fs.readFileSync(dir+'/local-matrix-fork-retry.log','utf8'):'';
const matrixPass=new Set([...matrixLog.matchAll(/\[PASS\] test_matrix_(\w+)\(/g)].map(m=>m[1].replaceAll('_','-')));
const timeLog=fs.readFileSync(dir+'/deployed-time-fork.log','utf8');const timePass=timeLog.includes('4 tests passed, 0 failed');
const localComplete=new Set(['CREATE-01','CREATE-05','REG-03','GRAD-02','FEE-04']);
const publicComplete={
 'ENV-01':['baseline'], 'CREATE-01':['staking-missing-stock','disabled-staking-stock'],
 'FEE-01':['no-staker-claim','matrix-ETH-S0-H0-T0','matrix-ERC20-S0-H1-T500'],
 'FEE-03':['all-stakers-exited-zero-fee-state','two-staker-weight-ERC20-S1-H0-T0'],
 'REWARD-01':['graduated-ETH-S1-H1-T500','graduated-ERC20-S1-H1-T500'],
 'REWARD-02':['conversion-expired','conversion-duplicate-items','conversion-wrong-beneficiary','conversion-min-output','outsider-convert','conversion-invalid-deadline','conversion-failures-state-unchanged'],
 'HOLDER-01':['graduated-ETH-S1-H1-T500','graduated-ERC20-S1-H1-T0','graduated-ERC20-S0-H0-T0']
};
const publicPartial={
 'ADM-01':['outsider-stock-pause','paused-stock-increase'], 'CREATE-02':['duplicate-identity','stale-economics'],
 'CREATE-03':['wrong-launch-fee','mined-atomic-rollback'], 'CREATE-04':['graduated-ETH-S1-H1-T500'],
 'TAX-01':['tax-cap','matrix-ETH-S0-H1-T500'], 'CURVE-01':['matrix-ETH-S0-H0-T500'], 'CURVE-02':['curve-slippage'],
 'GRAD-01':['graduated-ETH-S1-H1-T500','graduated-ERC20-S1-H1-T500'], 'FEE-02':['creator-beneficiary-epochs'],
 'STAKE-01':['disabled-stake','pregraduation-stake','graduated-ERC20-S1-H0-T0'], 'STAKE-02':['two-staker-weight-ETH-S1-H1-T500'],
 'STAKE-04':['paused-stock-increase','ragequit-principal'], 'STAKE-05':['ragequit-principal','all-stakers-exited-zero-fee-state'],
 'CREATOR-01':['creator-beneficiary-epochs','outsider-creator-transfer']
};
const waitCases=new Set(['STAKE-03','REWARD-03','HOLDER-02','HOLDER-03','HOLDER-04','HOLDER-05','REG-04','SERVICE-05']);
const extraLocal={
 'HOLDER-04':['test_leafIsBoundToMarketWindowSourceAndAccount()','test_twoLeafClaimsUseBitmapAndFixedRecipients()','test_platformRootUsesReviewDelayThenPermissionlessFinalizationAndClaim()'],
 'HOLDER-05':['test_unclaimedRemainderRollsIntoCurrentEpochWithoutReducingLiability()','test_unpublishedRequestExpiresAndRefundDoesNotMoveQuote()']
};
const rows=[];
for(const c of catalog.cases){const short=c.caseId.replace('R5-','');const selectorNames=new Set([...c.localSelectors.map(x=>x+'('),...(extraLocal[short]??[])]);
 const support=local.filter(t=>[...selectorNames].some(n=>t.test.startsWith(n)));
 const executions=[];
 for(const env of c.requiredEnvironments){let status='NOT_RUN',actual='本轮未执行完整的该环境用例。',ev=[],ids=[];
  if(env==='local'){
   if(c.matrixKey&&matrixPass.has(c.matrixKey)){status='PASS';actual='实际R5部署的本地Fork：该组合完整创建、曲线买卖和领取、毕业、无/有有效质押v4收费独立金额断言、批量兑换、持有人注资、整仓退出和偿付检查通过；使用本地时间推进。';ev=[evidence(dir+'/local-matrix-fork-retry.log'),evidence(dir+'/local-matrix-fork-pin.json')];}
   else if(c.matrixKey){status='NOT_RUN';actual='对应完整Fork矩阵用例尚无通过结果；普通单测不能替代该组合。';}
   else if(support.length){status=localComplete.has(short)?'PASS':'PARTIAL';actual=`${support.length} 条明确支持选择器本轮通过；${status==='PARTIAL'?'未将这些选择器外的业务断言自动计为通过。':'对应限定故障/配置断言已覆盖。'}`;ev=[evidence(dir+'/local-contract-results.json')];}
   if(short==='ENV-01'){status='PASS';actual='22部署制品、577源码输入检查通过；源码和R5基线已登记。';ev=[evidence(dir+'/build-input-verification-final.log'),evidence(dir+'/baseline.json')];}
   if(timePass&&['STAKE-03','REWARD-03','HOLDER-02','REG-04'].includes(short)){status=short==='STAKE-03'||short==='REG-04'?'PASS':'PARTIAL';actual+=' 实际R5头寸的对应时间边界Fork测试通过；不是公共自然时间。';ev.push(evidence(dir+'/deployed-time-fork.log'));}
   if(short.startsWith('SERVICE-')){status='PARTIAL';actual='本轮服务单测/子测试及4个隔离PostgreSQL+Anvil smoke通过；fixture为合成，真实R5连续索引到根发布和重组恢复未闭环。';ev=[evidence(dir+'/local-services/test-results.json'),evidence(dir+'/local-services/smoke-holder.log')];}
  }else if(env==='public'){
   if(c.matrixKey){const id=(c.phase==='CORE'?'matrix-':'graduated-')+c.matrixKey;ids=[id];if(has(id)&&isAudited){status='PASS';actual='该组合的本次真实交易、固定收款人余额差和独立会计审计通过。正常锁定领取按GRAD用例规定仅验证未到期状态，另由STAKE-03登记自然到期领取。';ev=[evidence(dir+'/public/results.json'),evidence(dir+'/public/receipt-audit.json')];}else if(c.phase==='GRAD'&&c.matrixKey.startsWith('ETH')){status='BLOCKED_FUNDS';actual='本轮ETH本金仅覆盖1个0.42净门槛毕业组合；其余7组未公开毕业。ERC20与本地Fork结果不能替代。';} }
   else if(short in publicComplete){ids=publicComplete[short];if(ids.every(id=>id==='baseline'||has(id))&&isAudited){status='PASS';actual='指定真实链上/只读断言完成；金额和回执另经独立审计。';ev=[evidence(dir+'/public/results.json'),evidence(dir+'/public/receipt-audit.json')];}}
   else if(short in publicPartial){ids=publicPartial[short].filter(has);status=ids.length?'PARTIAL':'NOT_RUN';actual='已执行所列检查；未执行的边界、组合或攻击输入仍不计通过，参照规范逐项补齐。';ev=[evidence(dir+'/public/results.json')];}
   if(waitCases.has(short)){status='WAITING_TIME';actual='未满足真实自然时间或依赖其完成后的根发布/领取；到期前拒绝已验证不等于到期后成功。具体队列见time-queue.json；30天领取截止尚须真实finalize后才能确定。';ev=[evidence(dir+'/public/results.json')];}
   if(short.startsWith('SERVICE-')&&short!=='SERVICE-05'){status='PARTIAL';actual='286份真实回执的选定事件投影和重复处理通过；未覆盖连续区块、真实重组、持久服务重启及根发布全链路。';ev=[evidence(dir+'/real-receipt-replay/evidence.json')];}
   if(['ADM-02','ADM-03','REG-01','REG-02'].includes(short)){status='PARTIAL';actual='本轮仅验证活动图中已有设置和隔离fixture的部分准入行为；完整轮换/治理迁移、精度和身份漂移公开矩阵未执行。';}
  }else if(env==='rh-fork'){status='PARTIAL';actual='真实RH固定区块的3条Fork链路通过，含真实股票依赖；不等于RH生产配置、所有quote池流动性和治理验收。';ev=[evidence(dir+'/rh-fresh-fork.log'),evidence(dir+'/rh-fresh-pin.json')];}
  else if(env==='frontend'){status='NOT_RUN';actual='本轮先执行无需人工签名的合约与服务验证。57个前端单测及构建通过，但未进行Chrome+MetaMask页面签名联调。';}
  else if(env==='production-plan'){status='BLOCKED_INPUT';actual='RH正式多签/治理/运营和生产经济验证尚未配置验收；禁止以测试EOA配置宣称生产可发布。';}
  executions.push({environment:env,status,actual,checkIds:ids,evidence:ev,localSupportingTests:env==='local'?support.map(t=>({suite:t.suite,test:t.test,status:t.status})):undefined});
 }
 const overall=executions.every(x=>x.status==='PASS')?'PASS':executions.some(x=>x.status==='FAIL')?'FAIL':executions.some(x=>x.status==='WAITING_TIME')?'WAITING_TIME':executions.some(x=>x.status==='BLOCKED_FUNDS')?'BLOCKED_FUNDS':executions.some(x=>x.status==='BLOCKED_INPUT')?'BLOCKED_INPUT':executions.some(x=>['PASS','PARTIAL'].includes(x.status))?'PARTIAL':'NOT_RUN';
 rows.push({caseId:c.caseId,title:c.title,priority:c.priority,expected:c.expected,overall,market:c.matrixKey?s.markets[c.matrixKey]:undefined,executions});
}
const counts=Object.fromEntries([...new Set(rows.map(x=>x.overall))].map(k=>[k,rows.filter(x=>x.overall===k).length]));
const ledger={runId:catalog.schemaVersion,releaseId:s.releaseId,generatedAt:new Date().toISOString(),catalogSHA256:hash('docs/testing/R5_BUSINESS_CASES.json'),overall:'ACCEPTANCE_INCOMPLETE_NOT_PRODUCTION_READY',caseCount:rows.length,counts,rows};
fs.writeFileSync(dir+'/case-results.json',JSON.stringify(ledger,null,2)+'\n');
let md='# R5 逐项业务测试登记\n\n状态为本次执行事实；PARTIAL不计通过。技术单测结果另见 local-contract-results.json。\n\n| 用例 | 本地 | 公开链/其他 | 综合 |\n|---|---|---|---|\n';
for(const r of rows)md+=`| ${r.caseId} · ${r.title} | ${r.executions.find(x=>x.environment==='local')?.status??'—'} | ${r.executions.filter(x=>x.environment!=='local').map(x=>x.environment+': '+x.status).join('<br>')} | ${r.overall} |\n`;
for(const r of rows){md+=`\n## ${r.caseId}\n\n${r.title}\n\n`;for(const e of r.executions)md+=`- **${e.environment} / ${e.status}**：${e.actual}${e.checkIds.length?' 检查ID：'+e.checkIds.join('、'):''}\n`;}
fs.writeFileSync(dir+'/CASE_RESULTS.md',md);
const queue=s.timeQueue.map(x=>({...x,availableAtUTC:new Date(Number(x.availableAt)*1000).toISOString(),availableAtShanghai:new Date(Number(x.availableAt)*1000).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})+' +08:00'}));
queue.push({type:'HOLDER_30_DAY_CLAIM_EXPIRY',status:'WAITING_DEPENDENCY',availableAt:null,dependsOn:'Actual public root request, publication, review, finalization. Derive from onchain claimUntil only.'});
fs.writeFileSync(dir+'/time-queue.json',JSON.stringify(queue,null,2)+'\n');
const matrixRows=catalog.cases.filter(x=>x.matrixKey&&x.phase==='CORE').map(c=>`| ${c.matrixKey} | ${matrixPass.has(c.matrixKey)?'PASS':'待完成'} | ${has('matrix-'+c.matrixKey)?'PASS':'未执行'} | ${has('graduated-'+c.matrixKey)?'PASS':'未执行：ETH本金不足'} |`).join('\n');
const report=`# R5 业务验收报告（即时阶段，尚未闭环）

生成时间：${ledger.generatedAt}。Run：${ledger.runId}。Release：\`${s.releaseId}\`。公开链421614；RH4663是最终目标，未向生产链发送交易。

## 结论

本轮已取得下表所列即时证据，但**完整业务验收尚未通过，不能宣布生产可发布**。76条用例综合登记为：${Object.entries(counts).map(([k,v])=>k+' '+v).join('；')}。PASS要求所有必需环境完成，PARTIAL/等待/阻塞均不计通过。该分母包含自然时间、连续服务、前端和生产治理门禁，不与822条技术单测混用。

[严格规范](${root}/docs/testing/R5_BUSINESS_ACCEPTANCE_SPEC.md) · [76条具体用例](${root}/docs/testing/R5_BUSINESS_CASES.md) · [逐项登记](CASE_RESULTS.md) · [机器可读明细](case-results.json)

## 已取得的证据

| 层次 | 本轮结果 | 限制 |
|---|---|---|
| 普通合约 | 822/822通过；fuzz1000；3组invariant各256×500，合计384000次调用、0revert | 普通本地测试，不冒充所有业务组合 |
| 官方依赖Fork | Arbitrum 1条、RH 3条通过 | 重新核验的新固定区块；保留旧pin失败日志 |
| 实际R5时间边界Fork | ${timePass?'4/4通过':'未全部通过'} | 本地warp，非自然到期 |
| 实际R5完整配置矩阵Fork | ${matrixPass.size}/16通过 | 覆盖创建至正常退出，vm.deal只在本地 |
| 公共链 | ${s.transactions.length}笔交易，${s.transactions.filter(t=>t.expectedStatus==='reverted').length}笔为预期回滚；${s.checks.length}项执行断言 | 16组曲线、9组毕业，7组ETH毕业缺资金 |
| 独立审计 | ${isAudited?'回执及观察到的会计通过':'尚未最终匹配'}；${audit.curveRows.length}次curve sweep、${audit.feeRows.length}次v4收费、${audit.conversions.length}个兑换batch | 逐笔复算恒定乘积、费用、退款和分配；非仅交易success |
| 服务单测 | indexer32、root8、maintenance25、API28；Go26包346顶层测试，含子测试1148个PASS事件 | Go使用-race -count=1，子测试不重复充当业务用例 |
| 本地服务集成 | chain/gauge/vault/holder 4个隔离PostgreSQL+Anvil smoke通过 | 合成fixture，不是R5完整生产服务 |
| 真实回执投影 | 286份回执、1090条选定事件及1090次重复处理通过，内容不变 | 不证明连续区块/reorg/真实root发布 |
| 前端 | 57单测及构建复测通过 | 未做MetaMask页面签名联调 |

公共链gas合计 **${Number(BigInt(audit.gasWei))/1e18} ETH**；另有1个市场约0.42 ETH净Quote进入毕业池，本金与gas分开。9个毕业组合中的ERC20是独立合成fixture，不能证明RH Stock同源码或生产流动性。

## 核心组合覆盖

S=股票质押，H=持有人分配，T=Creator tax bps。

| 配置 | 本地完整链路 | 公开曲线 | 公开毕业/v4/兑换 |
|---|---|---|---|
${matrixRows}

## 本轮重点结果

- 关闭质押时Gauge为零，创建者与平台仍可领取ETH/ERC20费用；无质押staker入口拒绝。61条实际FeeClaimed事件按真实受益人和creator epoch审核。
- Creator tax全部归创建者，持有人只获得创建者基础份额的50%；买入v4手续费资产为meme、卖出为Quote。0有效质押与正有效质押两种分配均复算。
- 5个市场的100:300两人股票头寸按1:3分配，整数误差在2最小单位内。提前退出本金精确返还；3次延迟奖励清算均已另行重试完成。全体退出后验证回到0有效质押费率状态。
- 创建者收益权转移前后分别属于epoch1/epoch2，真实收款地址和余额差独立核对。
- 失败原子创建实际上链回滚：只有gas支出、无残留token代码、无发布费转出，原身份可重试。兑换越权、过期、重复item、错误受益人和超高minOutput另按ETH_CALL登记，不能称为已广播失败交易。
- 原币退出重复请求/取消/重新计时，股票暂停后的新增质押拒绝、解暂停延时，以及7天前root申请拒绝均已登记。到期后成功仍等待自然时间。

## 失败尝试与修正（没有删除历史）

1. 旧R3时间测试曾读取当前R5 manifest：已改为R3归档并加release/chain断言；它不计本轮R5成功。新R5时间测试只读取本轮fixture并核对FeeVault代码。
2. 旧固定区块公共RPC历史状态不可用；使用新pin、重新校验依赖和区块后Fork通过。标准\`check:tracks\`依旧要求特定RPC/历史pin，聚合CI并未宣称全绿。
3. Web生成ABI指纹过期：同步生成文件后测试/构建通过，原失败日志保留。
4. 测试工具遗漏下游错误ABI：已核验原始SlippageExceeded及PositionLockedUntil选择器后补全解码，不归为合约缺陷。
5. 第二质押者初始1000测试股票不足5×300：在失败广播前补足500，按区块核实100→600，继续剩余两头寸。root早期拒绝探测的原请求者ETH不足0.001，改用持有代币且余额充足的创建者；未以“余额不足”冒充EpochNotClosed。
6. 最初审计把净门槛当作精确相等值，观察到2–4最小单位差。已用独立整数恒定乘积、保留token分区及尾单向上取整复算精确金额，未采用任意epsilon放宽。
7. 首次receipt回放按交易hash排序导致out-of-order：已改真实block/tx/log顺序和明确emitter允许列表；全部1090事件及重复回放通过。
8. CI首次长任务被中断；主代理重跑的315个product测试通过，聚合track在RPC配置门禁停止。16矩阵首次并发RPC超时保留，降并发重跑单列。测试代码开发编译错误亦保留，未计为产品失败。

上述为已确认的工具、环境和测试准备问题；**本轮已执行路径未确认新的产品资金损失/越权缺陷**，此结论不覆盖未执行项。

## 尚未完成的强制门禁

- 真实正常退出、原币退出、股票解暂停、7天holder root及后续30天截止：[自然时间队列](time-queue.json)。30天准确截止只能在真实root finalize后读取链上claimUntil，目前没有虚构到期日。
- 7个ETH组合尚未公开毕业；需要额外测试ETH，不能用8个ERC20毕业结果替代。
- 真实R5连续索引→持仓积分→root生成/发布/审核→API→领取、reorg/服务宕机恢复未闭环。当前已通过的是合成服务集成和真实离散回执投影。
- 跨角色完整治理移交、生产多签/运营者轮换、全部Quote精度和对抗代币公开矩阵仍见逐项PARTIAL记录。
- 浏览器签名联调未执行；RH正式经济参数、治理与运营门禁未验收。测试EOA和Arbitrum结果不能替代生产方案。

## 后续执行

按[执行手册](${root}/docs/testing/R5_BUSINESS_EXECUTION_RUNBOOK.md)使用同一run/release和交易journal继续；不可重置nonce或重复广播未知交易。未获得定时继续执行的确认，因此本轮没有创建自动任务。到期完成后追加attempt与回执，重算ledger并生成最终版；本文件当前为即时阶段报告。
`;
fs.writeFileSync(dir+'/REPORT.md',report);
console.log(JSON.stringify({cases:rows.length,counts,matrixLocalPassed:matrixPass.size,transactions:s.transactions.length,independentAudit:isAudited,overall:ledger.overall}));
