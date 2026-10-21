import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export const PROVIDER='voltagent-catalog';
export function githubRaw(source){
 const u=new URL(source);
 if(u.protocol!=='https:'||u.hostname!=='github.com')return [];
 const [owner,repo,kind,ref,...parts]=u.pathname.split('/').filter(Boolean);
 if(!owner||!repo)return [];
 const base=`https://raw.githubusercontent.com/${owner}/${repo}/`;
 if(kind==='tree'||kind==='blob'){
  const path=parts.join('/');return [base+ref+'/'+(kind==='blob'?path:path.replace(/\/$/,'')+'/SKILL.md')];
 }
 return [base+'main/SKILL.md',base+'master/SKILL.md'];
}
export async function fetchText(url,signal,fetcher=fetch){
 const u=new URL(url);
 if(u.protocol!=='https:'||u.username||u.password)throw Error('Skill sources must use HTTPS without credentials.');
 const response=await fetcher(u,{signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)]),redirect:'error'});
 if(!response.ok)throw Error(`Source returned HTTP ${response.status}: ${u}`);
 let size=0,text='';const decoder=new TextDecoder();
 for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw Error('Skill source exceeds 2 MiB.');text+=decoder.decode(chunk,{stream:true});}
 return text+decoder.decode();
}
export function instructionBody(markdown){
 if(/^\s*<!doctype html|^\s*<html/i.test(markdown))throw Error('Source returned HTML instead of a skill file.');
 const body=markdown.replace(/^\uFEFF/,'').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'').trim();
 if(!body)throw Error('The skill instruction file is empty.');
 return body;
}
export class CatalogProvider{
 constructor(catalog,cacheDir,fetcher=fetch){this.name=PROVIDER;this.catalog=catalog;this.cacheDir=cacheDir;this.fetcher=fetcher;this.entries=new Map(catalog.entries.map(row=>[row.name,row]));}
 async list({signal}={}){
  signal?.throwIfAborted();
  return this.catalog.entries.map(row=>({name:row.name,description:`${row.title}: ${row.description}`,provider:this.name,source:'bundled',rank:600,invocation:{modelInvocable:true,userInvocable:true},locator:row.name,metadata:{source:row.source,catalog:'VoltAgent/awesome-agent-skills'}}));
 }
 async load(row,signal){
  const file=join(this.cacheDir,row.name+'.json');
  try{const cached=JSON.parse(await readFile(file,'utf8'));if(cached.source===row.source&&typeof cached.url==='string'&&typeof cached.markdown==='string'){instructionBody(cached.markdown);return cached;}}catch(error){if(signal?.aborted)throw signal.reason;}
  signal?.throwIfAborted();let urls=githubRaw(row.source);
  if(new URL(row.source).hostname==='officialskills.sh'){
   const html=await fetchText(row.source,signal,this.fetcher);
   const links=[...html.matchAll(/https:\/\/github\.com\/[^\s<>"'\\]+/g)].map(m=>m[0].replace(/&amp;/g,'&').replace(/&quot;.*$/,''));
   const parts=new URL(row.source).pathname.split('/').filter(Boolean),repo=parts.slice(0,2).join('/').toLowerCase();
   urls=[...new Set(links.filter(link=>{const u=new URL(link);return u.pathname.slice(1).toLowerCase().startsWith(repo+'/tree/')||u.pathname.slice(1).toLowerCase().startsWith(repo+'/blob/');}).flatMap(githubRaw))];
  }else if(row.source.endsWith('/SKILL.md')&&new URL(row.source).hostname!=='github.com')urls=[row.source];
  let last;
  for(const url of urls){
   signal?.throwIfAborted();
   try{const markdown=await fetchText(url,signal,this.fetcher);instructionBody(markdown);const value={source:row.source,url,markdown,fetchedAt:new Date().toISOString()};await mkdir(this.cacheDir,{recursive:true,mode:0o700});const temp=file+'.'+randomUUID();await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,file);return value;}catch(error){if(signal?.aborted)throw signal.reason;last=error;}
  }
  throw Error(`Could not load ${row.title}. This catalog entry may be a collection, require authentication, or have moved. Original source: ${row.source}${last?' — '+last.message:''}`);
 }
 async get(candidate,{signal}={}){
  signal?.throwIfAborted();const row=this.entries.get(candidate.locator);if(!row||candidate.name!==row.name)return;
  const loaded=await this.load(row,signal);signal?.throwIfAborted();
  return {name:row.name,description:`${row.title}: ${row.description}`,provider:this.name,source:'bundled',invocation:{modelInvocable:true,userInvocable:true},resourceBase:{kind:'url',url:new URL('.',loaded.url).href},content:`Source: ${row.source}\nFetched: ${loaded.fetchedAt}\n\n${instructionBody(loaded.markdown)}`,metadata:{source:row.source}};
 }
 search(query='',offset=0,limit=20){
  const words=query.toLowerCase().split(/\W+/).filter(Boolean);
  const rows=this.catalog.entries.map(row=>({row,score:words.reduce((n,w)=>n+(row.title+' '+row.description).toLowerCase().split(w).length-1,0)})).filter(x=>!words.length||x.score).sort((a,b)=>b.score-a.score||a.row.title.localeCompare(b.row.title));
  return {total:rows.length,entries:rows.slice(offset,offset+limit).map(x=>x.row),nextOffset:offset+limit<rows.length?offset+limit:null};
 }
}
