import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {CatalogProvider} from './lib/provider.js';
export const inject=['skills','tools'];
export const Config=Schema.object({enabled:Schema.boolean().default(true),cacheDir:Schema.string().default('')});
export async function apply(ctx,config={}){
 if(config.enabled===false)return;
 const catalog=JSON.parse(await readFile(new URL('./data/catalog.json',import.meta.url),'utf8'));
 const cache=resolve(config.cacheDir||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'dsh-voltagent-skills','cache'));
 const provider=new CatalogProvider(catalog,cache);
 ctx.effect(()=>ctx.skills.registerProvider(()=>provider));
 ctx.effect(()=>ctx.tools.register(defineTool({name:'voltagent_skills',description:'Search the entire installed VoltAgent Awesome Agent Skills catalog. Entries are guidance, not installed MCP servers. Load an exact returned skill name with the standard skill tool. First load downloads and caches upstream instructions; scripts and service setup are separate.',parameters:{query:{type:'string',default:''},offset:{type:'integer',default:0},limit:{type:'integer',default:20}},output:{schema:{type:'object',additionalProperties:true},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async(args,exec)=>{exec.signal.throwIfAborted();const offset=args.offset??0,limit=args.limit??20;if(typeof args.query!=='string'||args.query.length>2000||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('Use a short query, nonnegative offset, and limit 1–50.');return {...provider.search(args.query,offset,limit),catalogEntries:catalog.entries.length,snapshot:catalog.fetchedAt,next:'Load a returned name through the standard skill tool. Reading guidance never installs or runs its backend. Relative resources are resolved from the source URL.'};}})));
}
