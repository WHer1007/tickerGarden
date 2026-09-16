import type {BootstrapConfig} from '../../config-projector/src/f72-bootstrap.generated.ts';
export interface RuntimeArtifact {
 readonly chainId:4663; readonly releaseId:`0x${string}`; readonly activationBlock:string; readonly activationHash:`0x${string}`; readonly genesisHash:`0x${string}`;
 readonly observedAt:string; readonly finalizedHead:string;
 readonly runtime:Readonly<Record<string,{address:`0x${string}`;codeHash:`0x${string}`;runtimeBytes:number}>>;
 readonly poolManager:{address:`0x${string}`;codeHash:`0x${string}`};
 readonly configs:readonly BootstrapConfig[];
 readonly receiptHashes:readonly string[];
}
