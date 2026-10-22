import test from 'node:test';
import assert from 'node:assert/strict';
import {windowLocalCatalog} from '../lib/catalog-window.js';

test('a ten-thousand-skill library does not flood the model context or change registry identity',()=>{
  const entries=Array.from({length:10000},(_,i)=>({name:`va-skill-${i}`,description:`${i===9999?'story writing danjdewhurst':'database'} ${'reference '.repeat(100)}`}));
  entries.push({name:'external-plugin',description:'Keep another plugin intact.'});
  const local=new Map(entries.slice(0,-1).map(row=>[row.name,{...row,repo:'fixture/skills'}]));
  const message={id:'catalog',source:{kind:'skill-catalog',entries},content:[{type:'text',text:'giant catalog'}]};
  const decision={kind:'continue',messages:[message,{id:'user',source:{kind:'user'},content:[{type:'text',text:'Write a story'}]}]};
  const result=windowLocalCatalog(decision,local,'story writing danjdewhurst');
  assert.ok(result.messages[0].content[0].text.length<14000);
  assert.match(result.messages[0].content[0].text,/va-skill-9999/);
  assert.match(result.messages[0].content[0].text,/Keep another plugin intact/);
  assert.equal(result.messages[0].source, message.source);
  assert.equal(result.messages[1],decision.messages[1]);
  assert.equal(message.content[0].text,'giant catalog');
  assert.equal(local.size,10000);
});
