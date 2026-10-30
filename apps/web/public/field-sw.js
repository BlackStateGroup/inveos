/* Cache only the public application shell. API requests and case data never enter this cache. */
const prefix='inveos-field-shell-',control='inveos-field-control-v1',marker='/__field_active_shell';
let preparing=Promise.resolve();
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
async function active(){const response=await(await caches.open(control)).match(marker);const name=response?await response.text():'';return name.startsWith(prefix)?name:null;}
async function prepare(paths){
 if(!Array.isArray(paths)||paths.length<2||paths.length>20||paths.filter(p=>p==='/').length!==1||new Set(paths).size!==paths.length||paths.some(path=>typeof path!=='string'||!(path==='/'||/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(path))))throw new Error('Invalid public shell list');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(paths))))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const name=prefix+digest,previous=await active();if(previous===name)return;
 const cache=await caches.open(name);
 try{
  for(const path of paths){const response=await fetch(path,{credentials:'omit',cache:'reload'});if(!response.ok||response.redirected||response.url!==self.location.origin+path)throw new Error('Public shell asset unavailable');await cache.put(path,response);}
  // Publish only a complete shell; interruption leaves the previous version active.
  await(await caches.open(control)).put(marker,new Response(name));
 }catch(error){await caches.delete(name);throw error;}
 for(const old of await caches.keys())if(old.startsWith(prefix)&&old!==name)await caches.delete(old);
}
self.addEventListener('message',event=>{
 if(event.data?.type!=='PREPARE_FIELD_SHELL'||!event.ports[0])return;
 const port=event.ports[0];preparing=preparing.catch(()=>{}).then(()=>prepare(event.data.paths));event.waitUntil(preparing.then(()=>port.postMessage({ok:true}),()=>port.postMessage({ok:false})));
});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.search||!(url.pathname==='/'||/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(url.pathname)))return;
 event.respondWith(fetch(event.request).catch(async()=>{
  const name=await active(),response=name?await(await caches.open(name)).match(url.pathname):null;
  return response||Response.error();
 }));
});
