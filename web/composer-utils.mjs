// UTF-16 offsets match textarea selection and Yunzhijia's message length.
export function reconcileMentions(before,after,mentions){
 let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
 let oldEnd=before.length,newEnd=after.length;
 while(oldEnd>start&&newEnd>start&&before[oldEnd-1]===after[newEnd-1]){oldEnd--;newEnd--;}
 const delta=newEnd-oldEnd;
 return (Array.isArray(mentions)?mentions:[]).flatMap(item=>{
  let next={...item};
  if(item.end<=start){}else if(item.start>=oldEnd)next={...item,start:item.start+delta,end:item.end+delta};else return [];
  return after.slice(next.start,next.end)==='@'+next.name?[next]:[];
 });
}
export function mentionPayload(raw,mentions){
 mentions=Array.isArray(mentions)?mentions:[];
 const offset=raw.length-raw.trimStart().length,text=raw.trim();
 return mentions.filter(x=>raw.slice(x.start,x.end)==='@'+x.name&&x.start>=offset&&x.end<=offset+text.length).map(x=>({id:x.id,start:x.start-offset,end:x.end-offset}));
}
export function mentionQuery(text,caret){
 const prefix=text.slice(0,caret),match=prefix.match(/(?:^|\s)@([^@\n]{0,30})$/);
 return match?{start:caret-match[1].length-1,end:caret,query:match[1]}:null;
}
export function looksMarkdown(text){return /(?:^|\n)\s*(?:#{1,6}\s|```|~~~|>\s|[-+*]\s|\d+[.)]\s)|\*\*[^*]+\*\*|(?:^|\s)(?:\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~)|(?:^|\n) {0,3}(?:---+|___+|\*\*\*+)\s*(?:$|\n)|`[^`\n]+`|\[[^\]]+\]\([^\n]+\)|(?:^|\n)\s*\|.+\|/.test(text);}
