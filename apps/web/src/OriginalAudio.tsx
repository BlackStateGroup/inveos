import {useEffect,useRef,useState} from 'react';
import {inspectPcm} from '@inveos/contracts';
import {readOriginalDownload} from './originalDownload';

/** Identity-keyed, explicit playback; each play checks the current original route. */
export function OriginalAudio({caseId,evidenceId,digest,bytes,range}:{caseId:string;evidenceId:string;digest:string;bytes:number;range?:{startMs:number;endMs:number}}){
 const [busy,setBusy]=useState(false),[playing,setPlaying]=useState(false),[error,setError]=useState(''),[position,setPosition]=useState(0),[duration,setDuration]=useState<number|null>(null);
 const live=useRef(true),request=useRef<AbortController|null>(null),context=useRef<AudioContext|null>(null),source=useRef<AudioBufferSourceNode|null>(null),timer=useRef<ReturnType<typeof setInterval>|null>(null),working=useRef(false);
 function stop(){request.current?.abort();request.current=null;if(timer.current)clearInterval(timer.current);timer.current=null;const s=source.current;source.current=null;if(s){s.onended=null;s.stop();s.disconnect();}const c=context.current;context.current=null;if(c)void c.close().catch(()=>{});working.current=false;if(live.current){setPlaying(false);setBusy(false);}}
 useEffect(()=>{live.current=true;return()=>{live.current=false;stop();};},[]);
 useEffect(()=>{stop();setError('');setPosition(0);},[range?.startMs,range?.endMs]);
 async function play(selected:boolean){
  if(working.current)return;stop();working.current=true;setError('');setBusy(true);setDuration(null);
  const controller=new AbortController();request.current=controller;
  try{
   const audio=new AudioContext();context.current=audio;
   await audio.resume();if(controller.signal.aborted||!live.current)return;
   const response=await fetch(`/api/cases/${caseId}/evidence/${evidenceId}/original`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
   const original=await readOriginalDownload(response,{bytes,digest,originalKind:'opaque_binary',status:'Quarantined'}),pcm=inspectPcm(new Uint8Array(original));
   if(controller.signal.aborted||!live.current)return;
   const startMs=selected?range?.startMs:0,endMs=selected?range?.endMs:pcm.durationMs;
   if(startMs===undefined||endMs===undefined||!Number.isFinite(startMs)||!Number.isFinite(endMs)||startMs<0||endMs<=startMs||endMs>pcm.durationMs)throw new Error('The selected range lies outside the original audio. Play the full original and record a correction.');
   const buffer=audio.createBuffer(1,pcm.samples,16000),channel=buffer.getChannelData(0),view=new DataView(original);for(let i=0;i<pcm.samples;i++)channel[i]=view.getInt16(44+i*2,true)/32768;
   const node=audio.createBufferSource();node.buffer=buffer;node.connect(audio.destination);source.current=node;
   const started=audio.currentTime;setDuration(pcm.durationMs);setPosition(startMs);setBusy(false);setPlaying(true);
   timer.current=setInterval(()=>{if(live.current)setPosition(Math.min(endMs,startMs+(audio.currentTime-started)*1000));},100);
   node.onended=()=>{if(live.current)setPosition(endMs);stop();};node.start(0,startMs/1000,(endMs-startMs)/1000);
  }catch(e){if(!controller.signal.aborted&&live.current){setError((e as Error).message);setDuration(null);setPosition(0);}stop();}
 }
 return <section className="work-record" aria-label="Original audio playback"><h4>Compare with the original audio</h4><p className="small">Each play rechecks current access and the original fingerprint. No automatic playback, recording, transcription or speaker identification.</p><div className="work-record-actions"><button className="secondary" disabled={busy||playing} onClick={()=>void play(false)}>Play full original</button>{range&&<button className="secondary" disabled={busy||playing} onClick={()=>void play(true)}>Play selected range</button>}<button className="secondary" disabled={!busy&&!playing} onClick={stop}>Stop audio</button></div>{busy&&<p role="status">Checking original audio…</p>}{error&&<p role="alert" className="form-error">{error}</p>}{duration!==null&&<p role="status">{playing?'Playing':'Stopped'} · {Math.round(position)} ms / {duration} ms · Original 16000 Hz mono PCM16</p>}{range&&<p className="small">Selected range: {range.startMs}–{range.endMs} ms from recording origin. Playback progress is approximate; original sample positions remain unchanged.</p>}<p className="small source-digest">Original SHA-256 {digest}</p></section>;
}
