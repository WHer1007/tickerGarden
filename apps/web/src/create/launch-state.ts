import {recoveryRead,recoveryWrite} from '../v1/recoveryStorage.ts';
import type {LaunchDiagnostic} from './launch-diagnostics.ts';
export type LaunchPhase='publishing'|'preparing'|'approval'|'wallet'|'pending'|'confirming'|'complete'|'paused'|'failed';
export type LaunchState={version:1;id:string;chainId:number;account:string;phase:LaunchPhase;detail:string;failedFrom?:LaunchPhase;diagnostic?:LaunchDiagnostic;hash?:string;intent?:string;data?:string;cancelled?:boolean;expected?:{factory:string;marketId:string;token:string;curve:string;gauge:string};listing?:{chainId:number;chainName:string;tokenAddress:string;name:string;symbol:string;logo:string;website:string;x:string;metadataURI:string;txHash:string}};
export const launchStateKey=(chainId:number)=>`tickergarden:launch-progress:${chainId}`;
export function readLaunchState(storage:Pick<Storage,'getItem'>,chainId:number):LaunchState|null{
 const raw=recoveryRead(storage,launchStateKey(chainId));if(!raw)return null;
 const s=JSON.parse(raw) as LaunchState;
 if(s.version!==1||s.chainId!==chainId||typeof s.id!=='string'||!/^0x[\da-f]{40}$/i.test(s.account)||!['publishing','preparing','approval','wallet','pending','confirming','complete','paused','failed'].includes(s.phase)||typeof s.detail!=='string')throw Error('Saved launch progress is invalid. Check your wallet transaction history before launching again.');
 if(s.failedFrom&&!Object.hasOwn(launchPhaseDisplay,s.failedFrom))throw Error('Invalid saved failure phase');
 if(s.data&&!/^0x[\da-f]*$/i.test(s.data))throw Error('Invalid saved launch calldata');
 if(s.hash&&!/^0x[\da-f]{64}$/i.test(s.hash))throw Error('Invalid saved transaction hash');
 if(s.expected&&(!/^0x[\da-f]{64}$/i.test(s.expected.marketId)||!['factory','token','curve','gauge'].every(k=>/^0x[\da-f]{40}$/i.test(s.expected![k as 'factory']))))throw Error('Invalid saved launch identity');
 return s;
}
export function saveLaunchState(storage:Pick<Storage,'setItem'>,state:LaunchState):void{recoveryWrite(storage,launchStateKey(state.chainId),JSON.stringify(state));}
export const launchPhaseDisplay:Record<LaunchPhase,{step:string;percent:number}>={
 publishing:{step:'Publish details',percent:10},preparing:{step:'Prepare launch',percent:30},approval:{step:'Approve asset',percent:45},wallet:{step:'Confirm in wallet',percent:60},pending:{step:'Confirm on chain',percent:80},confirming:{step:'Confirm on chain',percent:95},complete:{step:'Launch complete',percent:100},paused:{step:'Check transaction',percent:80},failed:{step:'Launch stopped',percent:0},
};

/** A verified terminal receipt supersedes diagnostics recorded while pending. */
export function failedLaunchState(state:LaunchState,code:'transaction_reverted'|'replacement_cancelled'):LaunchState {
 const detail=code==='transaction_reverted'?'The launch transaction failed. No token was created. Return to the form to review and try again.':'The launch transaction was cancelled. No token was created. Return to the form when you are ready.';
 return {...state,phase:'failed',failedFrom:'pending',detail,...(state.diagnostic?{diagnostic:{...state.diagnostic,code,transactionMayBePending:false}}:{})};
}
