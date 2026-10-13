// Authenticated images stay in bounded page memory, never persistent storage.
export class ImageCache {
 constructor({fetcher=(...args)=>fetch(...args),maxBytes=64*1024*1024,maxItemBytes=16*1024*1024,maxEntries=128,ttlMs=300000,createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}={}){
  Object.assign(this,{fetcher,maxBytes,maxItemBytes,maxEntries,ttlMs,createURL,revokeURL});this.items=new Map();this.pending=new Map();this.bytes=0;this.epoch=0;
 }
 remove(key){const entry=this.items.get(key);if(entry){this.items.delete(key);this.bytes-=entry.size;this.revokeURL(entry.url);}}
 peek(key){const entry=this.items.get(key);if(!entry)return '';if(Date.now()-entry.time>this.ttlMs){this.remove(key);return '';}
  this.items.delete(key);this.items.set(key,entry);return entry.url;
 }
 async get(key){
  const hit=this.peek(key);if(hit)return hit;if(this.pending.has(key))return this.pending.get(key).promise;
  const controller=new AbortController(),epoch=this.epoch;
  const promise=(async()=>{
   const response=await this.fetcher(key,{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw Error('图片加载失败');
   const mime=response.headers.get('content-type')||'';
   if(!mime.startsWith('image/')||mime.startsWith('image/svg')||Number(response.headers.get('content-length'))>this.maxItemBytes){await response.body?.cancel();return key;}
   const reader=response.body.getReader(),chunks=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>this.maxItemBytes){await reader.cancel();return key;}chunks.push(value);}
   if(epoch!==this.epoch)throw Error('图片缓存已清空');
   if(size>this.maxBytes)return key;
   while(this.items.size&&(this.bytes+size>this.maxBytes||this.items.size>=this.maxEntries))this.remove(this.items.keys().next().value);
   const url=this.createURL(new Blob(chunks,{type:mime}));this.items.set(key,{url,size,time:Date.now()});this.bytes+=size;return url;
  })();
  this.pending.set(key,{promise,controller});
  try{return await promise;}finally{if(this.pending.get(key)?.promise===promise)this.pending.delete(key);}
 }
 clear(){this.epoch++;for(const {controller} of this.pending.values())controller.abort();this.pending.clear();for(const key of this.items.keys())this.remove(key);}
}
