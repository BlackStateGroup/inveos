import {request as upstreamRequest,type IncomingMessage,type ServerResponse} from 'node:http';

/** Test-only loopback proxy. A disconnected browser must not strand an API request. */
export function forwardBrowserApi(req:IncomingMessage,res:ServerResponse,target:string,fault?:(status:number)=>'hold'|'drop'|undefined){
 let responseEnded=false;
 const upstream=upstreamRequest(target,{method:req.method,headers:req.headers},response=>{
  response.once('end',()=>{responseEnded=true;});
  response.once('error',()=>res.destroy());
  const action=fault?.(response.statusCode!);
  if(action){response.resume();if(action==='drop')res.destroy();return;}
  res.writeHead(response.statusCode!,response.headers);response.pipe(res);
 });
 req.once('aborted',()=>upstream.destroy());
 res.once('close',()=>{if(!res.writableEnded&&!responseEnded)upstream.destroy();});
 upstream.once('error',()=>{if(!res.destroyed){res.statusCode=502;res.end();}});
 req.pipe(upstream);return upstream;
}
