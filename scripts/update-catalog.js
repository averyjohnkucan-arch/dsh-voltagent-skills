import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const url='https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/README.md';
const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error(`Catalog download failed: ${response.status}`);
const readme=await response.text(),rows=[],seen=new Set();
for(const match of readme.matchAll(/^\s*[-*]\s+(?:\*\*)?\[([^\]]+)\]\((https:\/\/[^)]+)\)(?:\*\*)?\s*[-–]\s*(.+)/gm)){
 const [,title,source,description]=match;
 if(seen.has(source))continue;seen.add(source);
 const slug=title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
 const hash=createHash('sha256').update(source).digest('hex').slice(0,8);
 rows.push({name:`va-${slug}-${hash}`,title,source,description});
}
if(rows.length<1000)throw Error(`Unexpected catalog format: only ${rows.length} entries; keeping the existing snapshot.`);
await writeFile(new URL('../data/catalog.json',import.meta.url),JSON.stringify({upstream:url,sha256:createHash('sha256').update(readme).digest('hex'),fetchedAt:new Date().toISOString(),entries:rows},null,2)+'\n');
console.log(`Saved ${rows.length} distinct catalog entries.`);
