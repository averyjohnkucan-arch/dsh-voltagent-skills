import {homedir} from 'node:os';
import {watchFile,unwatchFile} from 'node:fs';
import {resolve,join} from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {LocalCatalogProvider} from './lib/local-provider.js';
import {windowLocalCatalog} from './lib/catalog-window.js';
export const inject=['skills','tools'];
export const Config=Schema.object({enabled:Schema.boolean().default(true),cacheDir:Schema.string().default(''),libraryDir:Schema.string().default('')});
export async function apply(ctx,config={}){
 if(config.enabled===false)return;
 const library=resolve(config.libraryDir||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'dsh-voltagent-skills','library'));
 let provider;
 ctx.effect(()=>ctx.skills.registerProvider(control=>(provider=new LocalCatalogProvider(library,control.invalidate))));
 await provider.refresh();
 ctx.on('agent/pre-step',async({messages=[],signal},next)=>{const decision=await next();if(decision.kind==='reject')return decision;await provider.refresh(signal);const query=messages.filter(m=>m.source?.kind==='user').flatMap(m=>(m.content||[]).filter(b=>b.type==='text').map(b=>b.text)).join('\n').slice(-4000);return windowLocalCatalog(decision,provider.entries,query);},{prepend:true});
 ctx.effect(()=>{const file=join(library,'manifest.json');const changed=()=>provider.invalidate();watchFile(file,{interval:2000,persistent:false},changed);return()=>unwatchFile(file,changed);});
 ctx.effect(()=>ctx.tools.register(defineTool({name:'voltagent_skills',description:'Find locally installed skills and workflows, including story writing, fiction, outlining, characters, worldbuilding, chapter drafting, editing, Office documents and coding. Instructions, scripts and references are on disk. Load an exact returned skill name with the standard skill tool. A skill is guidance; cloud services mentioned by a skill still require their own service.',parameters:{query:{type:'string',default:''},offset:{type:'integer',default:0},limit:{type:'integer',default:20}},output:{schema:{type:'object',additionalProperties:true},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async(args,exec)=>{exec.signal.throwIfAborted();const offset=args.offset??0,limit=args.limit??20;if(typeof args.query!=='string'||args.query.length>2000||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('Use a short query, nonnegative offset, and limit 1–50.');return {...await provider.search(args.query,offset,limit,exec.signal),next:'Load a returned name through the standard skill tool. All listed instructions and their resource directories are local. Reading guidance does not execute its scripts or grant extra permissions.'};}})));
}
