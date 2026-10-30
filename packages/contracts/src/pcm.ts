/** First-party bounded PCM inspection. No codec, metadata parser or resampling. */
export type PcmSource={sampleRate:16000;channels:1;sampleBits:16;samples:number;durationMs:number;dataOffset:44;byteLength:number};
export function inspectPcm(bytes:Uint8Array):PcmSource{
 const fail=():never=>{throw new Error('Only canonical mono PCM16 WAV at 16000 Hz within the 256 KiB intake bound is supported.');};
 if(bytes.byteLength<=44||bytes.byteLength>262144||bytes.byteLength%2)fail();
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tag=(offset:number,value:string)=>[...value].every((c,i)=>bytes[offset+i]===c.charCodeAt(0));
 if(!tag(0,'RIFF')||v.getUint32(4,true)!==bytes.length-8||!tag(8,'WAVE')||!tag(12,'fmt ')||v.getUint32(16,true)!==16||v.getUint16(20,true)!==1||v.getUint16(22,true)!==1||v.getUint32(24,true)!==16000||v.getUint32(28,true)!==32000||v.getUint16(32,true)!==2||v.getUint16(34,true)!==16||!tag(36,'data')||v.getUint32(40,true)!==bytes.length-44)fail();
 const samples=(bytes.length-44)/2;return {sampleRate:16000,channels:1,sampleBits:16,samples,durationMs:samples/16,dataOffset:44,byteLength:bytes.length};
}
