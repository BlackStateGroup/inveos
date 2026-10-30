import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {constants,openSync,readSync,closeSync,fstatSync,realpathSync} from 'node:fs';
import {isAbsolute,relative,resolve,sep,dirname,basename} from 'node:path';

const magic=Buffer.from('INVEOS01'),maxPlaintext=262144;
export const originalEnvelopeOverhead=73; // magic(8), key length(1), key id(<=32), nonce(12), length(4), tag(16)
export type EncryptedOriginalStore={readonly rootPath:string;readonly format:'inveos_original_aes256gcm_v1';seal:(path:string,bytes:Buffer)=>Buffer;unseal:(path:string,bytes:Buffer,maximum:number)=>Buffer};
export type OriginalStore=string|EncryptedOriginalStore;
const validId=(s:string)=>/^[a-zA-Z0-9_-]{1,32}$/.test(s);
const fail=():never=>{throw new Error('Encrypted original authentication failed.');};
const validPath=(path:string)=>/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(txt|bin)\.enc$/.test(path);

/** Keys stay inside this instance's closure; no mutable process-global key registry. */
export function encryptedOriginalStore(rootPath:string,activeKeyId:string,keyring:Readonly<Record<string,Buffer>>):EncryptedOriginalStore{
 if(!isAbsolute(rootPath)||!validId(activeKeyId)||!Object.hasOwn(keyring,activeKeyId)||Object.keys(keyring).length>16)throw new Error('Invalid original encryption configuration.');
 const keys=new Map<string,Buffer>();for(const [id,key] of Object.entries(keyring)){if(!validId(id)||!Buffer.isBuffer(key)||key.length!==32)throw new Error('Invalid original encryption key.');keys.set(id,Buffer.from(key));}
 const aad=(path:string,header:Buffer)=>{if(!validPath(path))throw new Error('Invalid encrypted original scope.');return Buffer.concat([header,Buffer.from('\0'+path,'ascii')]);};
 return Object.freeze({rootPath:resolve(rootPath),format:'inveos_original_aes256gcm_v1' as const,
  seal(path:string,bytes:Buffer){
   if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>maxPlaintext)throw new Error('Original size limit');
   const id=Buffer.from(activeKeyId,'ascii'),nonce=randomBytes(12),length=Buffer.alloc(4);length.writeUInt32BE(bytes.length);
   const header=Buffer.concat([magic,Buffer.from([id.length]),id,nonce,length]);
   const cipher=createCipheriv('aes-256-gcm',keys.get(activeKeyId)!,nonce,{authTagLength:16});cipher.setAAD(aad(path,header));
   return Buffer.concat([header,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);
  },
  unseal(path:string,bytes:Buffer,maximum:number){
   if(!Number.isSafeInteger(maximum)||maximum<1||maximum>2097152||bytes.length>Math.min(maximum,maxPlaintext)+originalEnvelopeOverhead||bytes.length<43||!bytes.subarray(0,8).equals(magic))return fail();
   const idLength=bytes[8]!;if(idLength<1||idLength>32)return fail();const end=9+idLength+16;if(bytes.length<end+17)return fail();
   const id=bytes.subarray(9,9+idLength).toString('ascii'),key=keys.get(id);if(!validId(id)||!key||!Buffer.from(id,'ascii').equals(bytes.subarray(9,9+idLength)))return fail();
   const length=bytes.readUInt32BE(end-4);if(!length||length>Math.min(maximum,maxPlaintext)||bytes.length!==end+length+16)return fail();
   let provisional:Buffer|undefined;
   try{const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(9+idLength,end-4),{authTagLength:16});decipher.setAAD(aad(path,bytes.subarray(0,end)));decipher.setAuthTag(bytes.subarray(-16));provisional=decipher.update(bytes.subarray(end,-16));const final=decipher.final();return Buffer.concat([provisional,final]);}
   catch{return fail();}finally{provisional?.fill(0);}
  },
 });
}

function physicalPath(path:string):string {
 try{return realpathSync(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const parent=dirname(path);if(parent===path)throw error;return resolve(physicalPath(parent),basename(path));}
}
function outside(root:string,file:string):boolean {const path=relative(root,file);return path==='..'||path.startsWith('..'+sep)||isAbsolute(path);}

/** An explicit protected key file is separate from the original store and backups. Never log its contents. */
export function originalStoreFromEnv(rootPath:string,env:NodeJS.ProcessEnv=process.env):OriginalStore{
 const mode=env.INVEOS_ORIGINAL_STORAGE_MODE??'plaintext-lab';
 if(mode==='plaintext-lab'){if(env.INVEOS_ORIGINAL_KEYS_FILE)throw new Error('Key file requires explicit encrypted-v1 original mode.');return rootPath;}
 const file=env.INVEOS_ORIGINAL_KEYS_FILE;
 if(mode!=='encrypted-v1'||!isAbsolute(rootPath)||!file||!isAbsolute(file))throw new Error('Explicit encrypted-v1 mode and absolute protected key file required.');
 if(!outside(resolve(rootPath),resolve(file))||!outside(physicalPath(resolve(rootPath)),physicalPath(resolve(file))))throw new Error('Original keys must be outside the original store.');
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const info=fstatSync(fd);if(!info.isFile()||(info.mode&0o077)!==0||info.size<1||info.size>8192)throw new Error('Original key file must be private, regular and bounded.');
  const raw=Buffer.alloc(8193);let n=0;while(n<raw.length){const read=readSync(fd,raw,n,raw.length-n,null);if(!read)break;n+=read;}if(n>8192)throw new Error('Original key file size limit.');
  try{const data=JSON.parse(raw.subarray(0,n).toString('utf8'));if(data.format!=='inveos_original_keys_v1'||typeof data.activeKeyId!=='string'||!data.keys||typeof data.keys!=='object'||Array.isArray(data.keys)||Object.keys(data).sort().join(',')!=='activeKeyId,format,keys')throw new Error();
   const keys:Record<string,Buffer>=Object.create(null);for(const [id,value] of Object.entries(data.keys)){if(typeof value!=='string'||!(/^[a-f0-9]{64}$/).test(value))throw new Error();keys[id]=Buffer.from(value,'hex');}
   try{return encryptedOriginalStore(rootPath,data.activeKeyId,keys);}finally{for(const key of Object.values(keys))key.fill(0);}
  }catch{throw new Error('Invalid original key file.');}finally{raw.fill(0);}
 }finally{closeSync(fd);}
}
