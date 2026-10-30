/** SYNTHETIC CONTRACT INPUT. No Tika/JVM/container was run to produce this fixture.
 * The test explicitly injects a result below the worker transport boundary.
 * These receipt-shaped values exercise validation only; they are not host evidence.
 */
import {tikaProfile,tikaProfileDigest,type TikaResult} from '../../src/tika-derivative.js';
import type {TikaContext} from '@inveos/contracts';
import {hash} from './source-family.js';
export const fictionalPassage='FICTIONAL INVEOS repeated passage';
export function syntheticTikaContract(original:Buffer,context:TikaContext):TikaResult{
 const profile=JSON.parse(tikaProfile),xhtml=Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>FICTIONAL SYNTHETIC CONTRACT</title></head><body><div class="page"><p>'+fictionalPassage+'</p></div><div class="page"><p>'+fictionalPassage+'</p></div></body></html>');
 return {context,profileDigest:tikaProfileDigest,raw:Buffer.from(JSON.stringify({format:'inveos_tika_research_probe_v1',metadata:{'xmpTPg:NPages':['2'],'pdf:ocr-page-count':['0'],'pdf:encrypted':['false'],'access-permission:extract-content':['true']},parseNanos:1,peakRssKiB:1,processCpuNanos:1,sourceSha256:hash(original),state:'unreviewed_research_derivative',xhtmlBase64:xhtml.toString('base64'),xhtmlSha256:hash(xhtml)})),runtime:{qualification:{syntheticContractOnly:true,actualHostProbeExecuted:false,status:'host_probe_passed',parserExecuted:false,profile:'runtime-1g',daemonLogging:false,imageId:profile.imageId,repoDigests:[profile.image],runtimeLockSha256:profile.runtimeLockSha256,checks:['boundaries','timeout','stdout_limit','stderr_limit','memory','pids','cpu'],resourceEvidence:{oomKilled:true,pids:1,cpu:1},checkedAt:new Date().toISOString()},preparation:{syntheticContractOnly:true,status:'verified_locked_tika_bundle',parserExecuted:false,...Object.fromEntries(['sourceRevision','compiledJarSha256','runtimeLockSha256','wrapperSha256'].map(k=>[k,profile[k]]))}}};
}
