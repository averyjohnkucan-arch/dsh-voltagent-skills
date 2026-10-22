import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, readFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalCatalogProvider} from '../lib/local-provider.js';

async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'local-skills-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,'repos/writer/stories/skills/chapter/references'),{recursive:true});
  await writeFile(join(dir,'repos/writer/stories/skills/chapter/SKILL.md'),'---\nname: chapter\nallowed-tools: Bash(*)\n---\n# Draft chapters\nRead references/checklist.md first.');
  await writeFile(join(dir,'repos/writer/stories/skills/chapter/references/checklist.md'),'Keep character continuity.');
  const row={name:'va-chapter-123',title:'Story chapter writing',description:'Write and edit fiction chapters',repo:'writer/stories',path:'repos/writer/stories/skills/chapter/SKILL.md',source:'https://github.com/writer/stories',cli:'repos/writer/stories/bin/story.js'};
  await writeFile(join(dir,'manifest.json'),JSON.stringify({schemaVersion:1,entries:[row],unavailable:[]}));
  return {dir,row};
}

test('local definitions and relative references load without any network; names survive restart',async t=>{
  const {dir}=await fixture(t);
  t.mock.method(globalThis,'fetch',()=>{throw Error('Network forbidden');});
  const provider=new LocalCatalogProvider(dir);
  const [candidate]=await provider.list();
  const skill=await provider.get(candidate);
  assert.match(skill.content,/Draft chapters/);
  assert.doesNotMatch(skill.content,/allowed-tools/);
  assert.equal(skill.resourceBase.kind,'directory');
  assert.equal(await readFile(join(skill.resourceBase.path,'references/checklist.md'),'utf8'),'Keep character continuity.');
  assert.match(skill.content,/companion Story CLI is already installed locally/);
  const fresh=new LocalCatalogProvider(dir);
  assert.equal((await fresh.get((await fresh.list())[0])).content,skill.content);
  assert.equal((await provider.search('fiction',0,10)).entries[0].name,candidate.name);
});

test('missing downloaded files are withdrawn and registry is invalidated instead of fetching',async t=>{
  const {dir,row}=await fixture(t);let invalidations=0;
  const provider=new LocalCatalogProvider(dir,()=>invalidations++);
  const [candidate]=await provider.list();
  await rm(join(dir,row.path));
  assert.equal(await provider.get(candidate),undefined);
  assert.equal(invalidations,1);
  assert.equal((await provider.list()).length,0);
});

test('no library means no remote entries advertised',async t=>{
  const {dir}=await fixture(t);await rm(join(dir,'manifest.json'));
  const provider=new LocalCatalogProvider(dir);
  assert.deepEqual(await provider.list(),[]);
  assert.equal((await provider.search('story')).total,0);
});

test('local provider observes abort and rejects paths escaping the library',async t=>{
  const {dir,row}=await fixture(t);
  await writeFile(join(dir,'manifest.json'),JSON.stringify({schemaVersion:1,entries:[{...row,path:'../escape.md'}]}));
  const provider=new LocalCatalogProvider(dir);
  assert.deepEqual(await provider.list(),[]);
  const controller=new AbortController();controller.abort();
  await assert.rejects(provider.list({signal:controller.signal}));
  await writeFile(join(dir,'manifest.json'),JSON.stringify({schemaVersion:1,entries:[row]}));
  await rm(join(dir,row.path));await symlink('/etc/hosts',join(dir,row.path));
  const fresh=new LocalCatalogProvider(dir);
  await assert.rejects(fresh.get((await fresh.list())[0]),/outside its library/);
});
