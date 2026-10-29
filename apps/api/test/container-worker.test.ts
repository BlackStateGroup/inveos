import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateContainer,runResearchContainer} from '../src/container-worker.js';
import {validateNativeQualification} from '../src/native-document-worker.js';
import {documentProfile} from '../src/document-derivative.js';
const profile=JSON.parse(documentProfile),image='sha256:'+profile.imageId;
const fixture=()=>({Image:image,Config:{User:'65534:65534',Volumes:null},HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,LogConfig:{Type:'none'},CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],Memory:1073741824,MemorySwap:1073741824,NanoCpus:500000000,PidsLimit:32,Tmpfs:{'/scratch':'rw,noexec,nosuid,nodev,size=512m,mode=1777','/output':'rw,noexec,nosuid,nodev,size=16m,mode=1777'},Binds:null,CapAdd:null,Devices:[],PidMode:'',IpcMode:'private'},Mounts:[{Type:'bind',Source:'/fictional',Destination:'/original',RW:false}]});
test('container configuration rejects weakened limits, mounts, image identity and host access',()=>{
  validateContainer(fixture(),'/fictional',image);
  for(const [key,value] of Object.entries({NetworkMode:'host',ReadonlyRootfs:false,Privileged:true,Memory:0,MemorySwap:-1,NanoCpus:0,PidsLimit:0,CapDrop:[],SecurityOpt:[],CapAdd:['SYS_ADMIN'],Devices:[{}],PidMode:'host',IpcMode:'host',Binds:['/secret:/secret'],LogConfig:{Type:'json-file'}})){
    const f=fixture();Object.assign(f.HostConfig,{[key]:value});assert.throws(()=>validateContainer(f,'/fictional',image));
  }
  const writable=fixture();writable.Mounts[0]!.RW=true;assert.throws(()=>validateContainer(writable,'/fictional',image));
  const extra=fixture();extra.Mounts.push({Type:'bind',Source:'/secret',Destination:'/secret',RW:false});assert.throws(()=>validateContainer(extra,'/fictional',image));
  const volume=fixture();Object.assign(volume.Config,{Volumes:{'/data':{}}});assert.throws(()=>validateContainer(volume,'/fictional',image));
  assert.throws(()=>validateContainer(fixture(),'/wrong',image));assert.throws(()=>validateContainer(fixture(),'/fictional','sha256:'+'f'.repeat(64)));
});
test('native execution requires the complete matching host qualification receipt',()=>{
  const q={checkedAt:new Date().toISOString(),status:'host_probe_passed',profile:'runtime-1g',imageId:image,repoDigests:[profile.image],checks:['boundaries','timeout','stdout_limit','stderr_limit','memory','pids','cpu'],daemonLogging:false,resourceEvidence:{oomKilled:true,pids:1,cpu:1}};
  validateNativeQualification(q);
  for(const change of [{checkedAt:'2020-01-01T00:00:00Z'},{profile:'probe-128m'},{imageId:'sha256:'+'f'.repeat(64)},{repoDigests:[]},{checks:['boundaries']},{daemonLogging:true},{resourceEvidence:{oomKilled:false,pids:1,cpu:1}}])assert.throws(()=>validateNativeQualification({...q,...change}));
});
test('container executor rejects unsafe mount configuration before any renewal or Docker command',async()=>{
  let calls=0;const renew=async()=>{calls++;return true;};
  for(const bundle of ['relative','/fictional,readonly=false'])await assert.rejects(runResearchContainer({bundle,imageId:image,script:'true'},renew),/configuration/);
  assert.equal(calls,0);
});
