from pathlib import Path
import json,re,hashlib,datetime,shutil
root=Path(__file__).resolve().parents[1];r=root/'.codex_tmp/r6-fast-test';out=root/'outputs/reviews/r6-fast-test-2026-09-06';live=r/'outputs/reviews/r6-fast-test-2026-09-06'
def read(p,default=None):return json.loads(p.read_text())if p.exists()else default
s=read(live/'public/results.json',{'transactions':[],'checks':[],'markets':{}});checks={x['id']:x for x in s['checks']};audit=read(live/'public/receipt-audit.json',{});audited=audit.get('status')=='RECEIPTS_AND_OBSERVED_ACCOUNTING_VERIFIED' and audit.get('sourceTransactions')==len(s['transactions'])
audited=audited and audit.get('releaseId')==s.get('releaseId') and [(x['id'],x['hash']) for x in audit.get('receipts',[])]==[(x['id'],x['hash']) for x in s['transactions']]
auditPrefixVerified=audit.get('status')=='RECEIPTS_AND_OBSERVED_ACCOUNTING_VERIFIED' and audit.get('releaseId')==s.get('releaseId') and [(x['id'],x['hash']) for x in audit.get('receipts',[])]==[(x['id'],x['hash']) for x in s['transactions'][:len(audit.get('receipts',[]))]]
auditedIds={x['id'] for x in audit.get('receipts',[])} if auditPrefixVerified else set()
selectorEvidence=read(out/'local-selector-evidence.json',{'entries':[]}); selectorByCase={}
for evidence in selectorEvidence.get('entries',[]): selectorByCase.setdefault(evidence['caseId'],[]).append(evidence)
cycle=read(live/'natural-cycle.json',{});holderAudit=read(live/'public/holder-audit.json',{});holderAudited=holderAudit.get('status')=='HOLDER_RECEIPTS_AND_LIABILITIES_VERIFIED' and holderAudit.get('sourceTransactions')==len(s['transactions'])
matrixlog=live/'local-matrix-fork.log';matrixPass=set(x.replace('_','-')for x in re.findall(r'\[PASS\] test_matrix_(\w+)\(',matrixlog.read_text()if matrixlog.exists()else''))
timeLog=live/'deployed-time-fork.log';timePass=len(re.findall(r'\[PASS\] test_R6Actual',timeLog.read_text() if timeLog.exists() else ''))
catalog=read(root/'docs/testing/R6_FAST_BUSINESS_CASES.json');rows=[]
for case in catalog['cases']:
 key=case.get('matrixKey');pubid=('matrix-'if case.get('phase')=='CORE'else'graduated-')+key if key else None
 m=s['markets'].get(key,{}) if key else {}
 boundary=('curve-claims-'+key+'-platform-'+m.get('quote','')) if key and case.get('phase')=='CORE' else ('fund-holder-'+key if m.get('params',{}).get('creatorFeesToHolders') else 'v4-claims-'+key+'-platform-'+m.get('token','')) if key else None
 caseAudited=pubid in checks and boundary in auditedIds
 evidence=selectorByCase.get(case['caseId'],[]); localSupport=bool(evidence) and all(x['status']=='PASS' for x in evidence)
 publicIds=[]
 if pubid and pubid in checks: publicIds.append(pubid)
 domainPrefixes={'R6-HOLDER-03':('canonical-root-published-','holder-natural-claims-'),'R6-HOLDER-04':('invalid-proof-','holder-repeat-','bad-root-review-cancelled'),'R6-HOLDER-05':('root-finalize-','natural-rollover-','expired-proof-'),'R6-REG-04':('natural-stock-unpause',),'R6-REWARD-03':('natural-raw-exit',),'R6-STAKE-03':('normal-exit-',),'R6-CLOCK-01':('canonical-root-published-',)}
 for checkId in checks:
  if any(checkId==prefix or checkId.startswith(prefix) for prefix in domainPrefixes.get(case['caseId'],())): publicIds.append(checkId)
 publicIds=list(dict.fromkeys(publicIds)); publicEvidence=[checks[x] for x in publicIds]
 rows.append({'caseId':case['caseId'],'title':case['title'],'local':'PASS'if key in matrixPass else'SUPPORTING_TESTS_PASS'if localSupport else'PARTIAL_SUPPORTING_TESTS'if case.get('localSelectors')else'NOT_COMPLETED','localEvidence':evidence,'public':'PASS'if caseAudited else'EXECUTED_AWAITING_AUDIT'if pubid in checks else'PARTIAL_EXECUTION_VERIFIED'if publicEvidence and audited else'PARTIAL_EXECUTION_AWAITING_AUDIT'if publicEvidence else'PARTIAL_OR_NOT_RUN','publicEvidence':publicEvidence,'auditedThroughCaseBoundary':boundary if caseAudited else None,'overall':'PASS'if key in matrixPass and caseAudited else'INCOMPLETE','requiredEnvironments':case['requiredEnvironments'],'note':'Supporting selector tests and expectedStatus=reverted receipt checks are auditable evidence, but neither automatically completes the business case; ordinary unit tests are not full public or browser coverage.'})
counts={x:sum(v['overall']==x for v in rows)for x in ['PASS','INCOMPLETE']}
ledger={'runId':'R6-FAST-BUSINESS-2026-09-06','releaseId':s.get('releaseId'),'status':'TEST_ONLY_ACCEPTANCE_INCOMPLETE','rows':rows,'counts':counts,'additionalCases':catalog['additionalCases'],'naturalChecks':[v for k,v in checks.items()if k.startswith(('normal-exit-','natural-','canonical-root-','holder-natural-','bad-root-','expired-proof-','invalid-proof-'))]}
ledger['supportingSelectorStats']={'pass':sum(x['status']=='PASS' for x in selectorEvidence.get('entries',[])),'total':len(selectorEvidence.get('entries',[]))}
clockChecks=[v for k,v in checks.items() if k.startswith('canonical-root-published-')]
ledger['additionalCaseResults']=[{'caseId':'R6-CLOCK-01','status':'PASS_ARBITRUM_TEST_PROFILE' if len(clockChecks)==8 and holderAudited else 'PUBLIC_ROOTS_EXECUTED_AWAITING_INDEPENDENT_AUDIT' if clockChecks else 'LOCAL_AND_RPC_PROBE_PASS_PUBLIC_ROOT_PENDING','localRegressionCount':5,'publicEvidence':clockChecks,'limit':'RH RPC number/hash probe is not RH end-to-end deployment evidence.'},{'caseId':'R6-PROFILE-01','status':'PASS_TEST_PROFILE' if cycle.get('status')=='NATURAL_STAGES_AND_RECEIPT_AUDIT_FINISHED' and holderAudited and len(matrixPass)==16 and timePass==4 else 'PARTIAL','limit':'Short test periods never certify production economic parameters.'}]
ledger['naturalCycle']=cycle
ledger['holderAuditCurrent']=holderAudited
ledger['publicCheckStats']={'total':len(checks),'natural':sum(k.startswith(('normal-exit-','natural-','canonical-root-','holder-natural-','bad-root-','expired-proof-','invalid-proof-')) for k in checks),'timeQueueEntries':len(s.get('timeQueue',[])),'transactionsWithExpectedRevert':sum(t.get('expectedStatus')=='reverted' for t in s.get('transactions',[])),'browserContinuousServiceGovernanceGaps':['R6-UI-01','R6-SERVICE-01','R6-SERVICE-02','R6-SERVICE-04','R6-SERVICE-05','R6-PROD-01','R6-PROD-02']}
(out/'case-results.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
when=datetime.datetime.now(datetime.timezone.utc).isoformat();matrix='\n'.join(f"| {k} | {'PASS'if k in matrixPass else'待完成'} | {'PASS'if 'matrix-'+k in checks else'待完成'} | {'PASS'if 'graduated-'+k in checks else'待完成'} |"for k in s['markets'])
report=f'''# R6 快速测试发布与验收报告（持续登记）

更新：{when}。仅Arbitrum Sepolia421614；RH4663未广播。默认R5部署manifest保持原样。正式源码的后续区块域修复与服务联调另见 `outputs/reviews/formal-clock-service-integration-2026-09-06/`，不改变本R6部署身份。

## 已部署

Release `{s.get('releaseId','0xf2ab431cdae9144d0bd1b5f4f3c52c337e0b77a5aa8fd5504cff3d46bf2eec4f')}`，Factory `0x8928565528D13e26190e7D9302c1cb63DF7DE92D`。19笔部署交易、21个运行时及全部组件绑定核验通过，已激活独立图。

链上核验epoch3600秒、raw退出3600秒、claim7200秒、review300秒、publication1200秒、finality600秒+2块。质押与解暂停20分钟另按实际操作回执验证。ETH phantom0.00168、毕业净门槛0.0042。短周期不得作为R5正常生产周期通过证据。

## 本地门禁

- 最终合约827/827通过，fuzz1000，3组invariant256×500、fail_on_revert。
- 新参数下实际Uniswap v4依赖Fork1/1通过；其时间/finality模拟不算自然公开时间。
- 实际R6部署Fork的时间边界 {timePass}/4 通过，完整矩阵 {len(matrixPass)}/16 通过；均有独立固定区块身份，明确不算自然公开时间。
- 链下145/145、root generator8/8、Go全量-race、前端57测试与构建通过。
- 22制品、579源码引用及模拟中的16组件创建字节码通过；完整模拟后才广播。

## 公开业务执行

本轮业务journal目前{len(s['transactions'])}笔交易、{len(checks)}条执行检查；创建市场{len(s['markets'])}个。独立逐笔会计审计：{'已通过且覆盖当前journal'if audited else'尚未覆盖全部当前journal，不计最终PASS'}。

| 配置 | 本地完整矩阵 | 公开曲线 | 公开毕业/v4/兑换 |
|---|---|---|---|
{matrix}

表中公开列PASS表示对应执行断言完成，最终综合用例通过仍需独立审计和必需环境齐备。矩阵用例的审计范围精确绑定该阶段最后一笔交易，已审计通过的阶段不会因新增后续自然时间交易而退回未测试；最新完整journal是否已审计仍单独显示。完整逐项机器登记见`case-results.json`；自然时间证据见`public/results.json`的checks/roots/timeQueue。前端真实MetaMask签名、持续索引/故障恢复和生产治理仍独立登记，不以脚本签名或离散服务验证替代。

## 自然时间进度

已发布根 {sum(bool(x.get('published')) for x in s.get('roots',{}).values())}/8；已执行真实领取 {sum(bool(x.get('claimed')) for x in s.get('roots',{}).values())}/8；已完成过期结转 {sum(bool(x.get('rolledOver')) for x in s.get('roots',{}).values())}/8。正常退出与奖励检查 {sum(k.startswith('normal-exit-') and checks[k].get('detail',{}).get('normalExitTest') is not False for k in checks)} 项；解暂停 {'PASS' if 'natural-stock-unpause' in checks else '等待或未执行'}；原币退出 {'PASS' if 'natural-raw-exit' in checks else '等待或未执行'}。

自然流程状态：`{cycle.get('status','尚未启动')}`。下一链上到期时间（Unix 秒）：`{'无，全部自然阶段完成' if cycle.get('status') == 'NATURAL_STAGES_AND_RECEIPT_AUDIT_FINISHED' else cycle.get('nextAvailableAt','尚未登记')}`。持有人独立回执与偿付审计：{'当前journal通过' if holderAudited else '待完成'}。流程失败会停止，不自动跳过或重复广播；错误：`{cycle.get('error',s.get('error','无'))}`。

精确匹配的本地支持测试：{ledger['supportingSelectorStats']['pass']}/{ledger['supportingSelectorStats']['total']}。实际预期回滚交易 {ledger['publicCheckStats']['transactionsWithExpectedRevert']} 笔，按预期 revert 审计，不误作失败或成功业务交易。完整综合矩阵用例通过 {counts['PASS']}/76；其余逐项保留不完整状态，不能据此声称全部76条完成。

## 重要发现与修复

新增L2区块域修复：旧root请求记录Solidity parent-chain估计区块，与L2 RPC不一致。R6使用ArbSys原生L2高度/hash，已在Arbitrum和RH固定RPC区块核对；已知Nitro链预编译不可用时拒绝执行。root发布前必须再次核验实际链上source。R5持有人链路不能仅靠等待自然到期即视为完成；修复已在后续任务回移正式源码（保留7天/30天参数），该源码尚未重部署；不能把旧R5已部署合约视为已修复。

TWAB schema独立为`TRANSFER_LOG_TWAB_1H_R6_TEST_ONLY`，Distributor、leaf library、TS和Go一致，独立ABI向量已保存。缩短Gauge锁定后更新Factory精确runtime hash；保留代码身份验证。Fork曾因沿用大交易量而出现部分兑换，按池子规模缩小测试输入后通过，未放宽合约限制。旧R5 runner release guard、过期制品/编译和旧测试向量等失败尝试均保留，没有计入成功。生命周期脚本也曾在v4交易之后误调用毕业前的curve sweep，合约正确拒绝；移除旧调用后沿原journal恢复，并未重发已确认交易。

## 交付与继续

- 参数与执行说明：`docs/testing/R6_FAST_TEST_PROFILE.md`
- 冻结用例：`docs/testing/R6_FAST_BUSINESS_CASES.json`（76条继承用例+2条R6补充回归）
- 可审阅独立源码和公开配置：`deployments/test-profiles/r6-fast/`
- 新地址归档：`deployments/releases/0xf2ab431cdae9144d0bd1b5f4f3c52c337e0b77a5aa8fd5504cff3d46bf2eec4f/`

仍是TEST_ONLY，不能宣布生产可发布。公开链禁止加速时间；2小时领取截止从真实finalize开始计时。所有恢复均使用原journal，不删除未知交易，不盲目换nonce。
'''
(out/'REPORT.md').write_text(report)
# Copy latest evidence to durable review directory; this is a snapshot, never execution state.
if live.exists():
 for p in live.rglob('*'):
  if p.is_file():q=out/p.relative_to(live);q.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,q)
print(json.dumps({'transactions':len(s['transactions']),'checks':len(checks),'audited':audited,'matrixLocal':len(matrixPass),'completeBusinessCases':counts['PASS']}))
