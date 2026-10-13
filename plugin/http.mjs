import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const mediaKeys=new Set(['avatar','url','original','download','image']);
export function rewriteMedia(value,prefix,key=''){
 if(typeof value==='string')return mediaKeys.has(key)&&value.startsWith('/api/')?prefix+value:value;
 if(Array.isArray(value))return value.map(x=>rewriteMedia(x,prefix));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewriteMedia(v,prefix,k)]));return value;
}
export function mountedPath(url,prefix){const path=new URL(url,'http://local.invalid');if(path.pathname===prefix)return '/';if(!path.pathname.startsWith(prefix+'/'))throw Error('Invalid plugin mount');return path.pathname.slice(prefix.length)+path.search;}
export async function serveMounted(bridge,prefix,req,res){
 const controller=new AbortController();res.once('close',()=>controller.abort());
 const path=mountedPath(req.url,prefix);
 if(req.method!=='GET'&&req.method!=='POST'){res.writeHead(405).end();return;}
 const options={method:req.method,headers:{}};
 for(const name of ['content-type','range'])if(req.headers[name])options.headers[name]=req.headers[name];
 if(req.method==='POST'){
  // The Python HTTP server requires Content-Length and does not decode chunked bodies.
  const limit=['/api/messages/image','/api/messages/file'].includes(path.split('?')[0])?32*1024*1024+65536:65536;
  const chunks=[];let length=0;
  for await(const chunk of req){
   length+=chunk.length;
   if(length>limit){res.writeHead(413,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({error:'请求大小超出限制'}));return;}
   chunks.push(chunk);
  }
  options.body=Buffer.concat(chunks,length);
  options.headers['content-length']=String(length);
 }
 const upstream=await bridge.fetch(path,options,controller.signal,!path.startsWith('/api/events'));
 const mime=upstream.headers.get('content-type')||'application/octet-stream';
 const headers={'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 if(mime.includes('application/json')){const data=rewriteMedia(await upstream.json(),prefix);res.writeHead(upstream.status,headers).end(JSON.stringify(data));return;}
 if(path==='/'&&mime.includes('text/html')){let html=await upstream.text();html=html.replace('href="/style.css"',`href="${prefix}/style.css"`).replace('src="/app.js"',`src="${prefix}/app.js"`).replace('href="/"',`href="${prefix}/"`);res.writeHead(upstream.status,headers).end(html);return;}
 for(const name of ['content-range','accept-ranges','content-disposition','content-length'])if(upstream.headers.has(name))headers[name]=upstream.headers.get(name);
 if(mime.includes('text/event-stream'))headers['X-Accel-Buffering']='no';
 res.writeHead(upstream.status,headers);res.flushHeaders();if(upstream.body)await pipeline(Readable.fromWeb(upstream.body),res);else res.end();
}
