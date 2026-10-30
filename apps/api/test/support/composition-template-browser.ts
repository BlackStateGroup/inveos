import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchBrowser,eventually} from './browser.js';
import {forwardBrowserApi} from './browser-proxy.js';
import {workflowFixture,type Session} from './workflow-fixture.js';

/** Real built app, HTTP API and disposable PostgreSQL. No mocked routes or browser fallback. */
export async function compositionTemplateBrowser(artifactFolder='composition-templates'){
  // Deliberately fail before fixture creation when the host cannot run sandboxed Chrome.
  const browser=await launchBrowser();
  let fixture:Awaited<ReturnType<typeof workflowFixture>>|undefined,apiAddress='';
  const upstreams=new Set<ReturnType<typeof forwardBrowserApi>>();
  const dist=fileURLToPath(new URL('../../../web/dist/',import.meta.url));
  const server=createServer((req,res)=>{void(async()=>{
    const path=new URL(req.url!,'http://localhost').pathname;
    if(path.startsWith('/api/')){const upstream=forwardBrowserApi(req,res,apiAddress+req.url);upstreams.add(upstream);upstream.once('close',()=>upstreams.delete(upstream));return;}
    if(path==='/'){res.setHeader('content-type','text/html');res.end(await readFile(join(dist,'index.html')));return;}
    if(/^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(path)){res.setHeader('content-type',path.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(dist,path.slice(1))));return;}
    res.statusCode=404;res.end();
  })().catch(error=>{res.statusCode=500;res.end(String(error));});});
  async function close(){await browser.close();for(const upstream of upstreams)upstream.destroy();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await fixture?.close();}
  try{
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
    const f=await workflowFixture(origin);fixture=f;apiAddress=await f.app.listen({host:'127.0.0.1',port:0});
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const artifacts=resolve('output/evals',artifactFolder);await mkdir(artifacts,{recursive:true});
    await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:join(artifacts,'downloads')});
    async function navigate(session:Session,view:'Reports'|'Tasks'){
      // A new document prevents a prior user's state from satisfying the next role's assertions.
      await browser.send('Page.navigate',{url:'about:blank'});
      await wait(`location.href==='about:blank'`,'blank before role switch');
      await browser.send('Network.clearBrowserCookies');
      for(const part of session.cookie.split('; ')){const at=part.indexOf('=');const result=await browser.send<{success:boolean}>('Network.setCookie',{name:part.slice(0,at),value:part.slice(at+1),url:origin,httpOnly:part.startsWith('inveos_session='),sameSite:'Strict'});assert.ok(result.success,'session cookie accepted');}
      await browser.send('Page.navigate',{url:origin+'/#case='+f.caseId+'&view='+view});
      await wait(`!!document.querySelector(${JSON.stringify(view==='Reports'?'.report-composition':'.task-templates')})`,'connected '+view+' workbench');
    }
    async function wait(expression:string,label:string){let diagnostic='';try{await eventually(async()=>{try{return await browser.evaluate<boolean>(`!!(${expression})`);}catch(error){diagnostic=String(error);return false;}},label);}catch(error){throw new Error(String(error)+(diagnostic?'\nLast browser diagnostic: '+diagnostic:''));}}
    const element=(selector:string)=>`document.querySelector(${JSON.stringify(selector)})`;
    // Fail on ambiguity. Hidden copies in collapsed details do not count as actionable controls.
    function textElement(tag:string,text:string,scope='body',prefix=false){return `(()=>{const nodes=[...document.querySelector(${JSON.stringify(scope)}).querySelectorAll(${JSON.stringify(tag)})].filter(e=>e.getClientRects().length&&e.textContent.trim().${prefix?'startsWith':'includes'}(${JSON.stringify(text)}));const exact=${prefix?'nodes':`nodes.filter(e=>e.textContent.trim()===${JSON.stringify(text)})`};if(exact.length!==1)throw Error('Expected one visible '+${JSON.stringify(tag+' '+text)}+', got '+exact.length);return exact[0]})()`;}
    function control(label:string,scope='body'){return `(()=>{const labels=[...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('label')].filter(e=>e.getClientRects().length&&e.textContent.trim().startsWith(${JSON.stringify(label)}));if(labels.length!==1)throw Error('Expected one label '+${JSON.stringify(label)}+', got '+labels.length);return labels[0].querySelector('input,textarea,select')})()`;}
    async function click(expression:string){await wait(`!!(${expression})&&!(${expression}).matches(':disabled')`,'enabled control '+expression);const xy=await browser.evaluate<{x:number;y:number}>(`(()=>{const e=${expression};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error('Hidden control');return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...xy,button:'left',clickCount:1});await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',...xy,button:'left',clickCount:1});}
    const button=(text:string,scope='body',prefix=false)=>click(textElement('button',text,scope,prefix));
    async function fill(label:string,text:string,scope='body'){
      const target=control(label,scope);await wait(`!!(${target})&&!(${target}).matches(':disabled')`,'editable '+label);
      await browser.evaluate(`(()=>{const e=${target};e.scrollIntoView({block:'center'});e.focus();e.select()})()`);
      await browser.send('Input.insertText',{text});await wait(`(${target}).value===${JSON.stringify(text)}`,'entered '+label);
    }
    async function key(key:string,code:string,virtual:number){for(const type of ['keyDown','keyUp'])await browser.send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:virtual});}
    async function select(label:string,value:string,scope='body'){
      const target=control(label,scope);await wait(`!!(${target})&&!(${target}).matches(':disabled')`,'editable selection '+label);
      const index=await browser.evaluate<number>(`(()=>{const e=${target};e.scrollIntoView({block:'center'});e.focus();return [...e.options].findIndex(o=>o.value===${JSON.stringify(value)})})()`);assert.ok(index>=0,'available option '+value);
      await key('Home','Home',36);for(let i=0;i<index;i++)await key('ArrowDown','ArrowDown',40);await key('Tab','Tab',9);
      await wait(`(${target}).value===${JSON.stringify(value)}`,'selected '+label);
    }
    const check=(label:string,scope='body')=>click(control(label,scope));
    const text=(scope='body')=>browser.evaluate<string>(`${element(scope)}?.textContent??''`);
    async function captures(name:string,selector:string){for(const [suffix,width,height] of [['desktop',1440,1000],['narrow',390,844]] as const){await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});await browser.evaluate(`${element(selector)}.scrollIntoView({block:'start'})`);await browser.send('Runtime.evaluate',{expression:'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',awaitPromise:true});assert.ok(await browser.evaluate<boolean>('document.documentElement.scrollWidth<=innerWidth+1'),'no horizontal overflow '+name+' '+suffix);await writeFile(join(artifacts,name+'-'+suffix+'.png'),Buffer.from((await browser.send<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));}await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});}
    async function reload(scope:string){await browser.evaluate('window.__inveosJourneyOldDocument=true');await browser.send('Page.reload');await wait(`!window.__inveosJourneyOldDocument&&!!${element(scope)}`,'reloaded '+scope);}
    async function failure(name:string,error:unknown){
      // Fictional rendered content only: never dump cookies, tokens or storage.
      await writeFile(join(artifacts,name+'-failure.txt'),String(error)).catch(()=>{});
      try{const page=await browser.evaluate<{url:string;body:string}>('({url:location.href,body:document.body?.innerText})');await writeFile(join(artifacts,name+'-failure-page.json'),JSON.stringify(page,null,2));const shot=await browser.send<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(artifacts,name+'-failure.png'),Buffer.from(shot.data,'base64'));}catch{/* Preserve the original failure when the browser itself has gone away. */}
    }
    return {browser,f,origin,artifacts,navigate,wait,element,textElement,control,click,button,fill,select,check,text,captures,reload,failure,close};
  }catch(error){await close();throw error;}
}
