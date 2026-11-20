import {spawn} from 'node:child_process';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function attachLibrarySetup(ctx,provider) {
  const endpoint='/plugins/dsh-voltagent-skills/setup';
  const connection={path:endpoint, token:randomBytes(32).toString('hex')};
  const downloader=fileURLToPath(new URL('../scripts/download-library.py',import.meta.url));
  let child=null, done=null, state='idle', log='';
  ctx.on('webserver/index-inject',items=>items.push({kind:'global',name:'__DSH_VOLTAGENT_SKILLS__',value:connection}));
  ctx.inject(['connection'],scope=>scope.effect(()=>ctx.webServer.register({
    kind:'exact',path:endpoint+'/connection',handler(req,res) {
      res.setHeader('Cache-Control','no-store');
      if(req.method!=='GET'||req.headers.origin&&req.headers.origin!==ctx.webServer.getOrigin()){
        res.writeHead(403);res.end();return;
      }
      if(!scope.connection.authorizeIndex(req,res))return;
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(connection));
    }
  })));
  ctx.effect(()=>ctx.webServer.register({
    kind:'exact',path:endpoint,async handler(req,res) {
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Type','application/json');
      const actual=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,''));
      const expected=Buffer.from(connection.token);
      if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.writeHead(401);res.end('{}');return;}
      if(req.method!=='POST'||!String(req.headers['content-type']).startsWith('application/json')||req.headers.origin&&req.headers.origin!==ctx.webServer.getOrigin()){
        res.writeHead(403);res.end('{}');return;
      }
      try {
        let body='';
        for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Request too large.');}
        const {action}=JSON.parse(body);
        if(action==='story'||action==='full'){
          if(child)throw Error('Wait for the current library download.');
          state='running';log='Starting library download';
          const args=['-B',downloader,'--library',provider.libraryDir];
          if(action==='story')args.push('--repo','danjdewhurst/story-skills');
          child=spawn(process.platform==='win32'?'python':'python3',args,{stdio:['ignore','pipe','pipe']});
          const append=chunk=>{log=(log+'\n'+String(chunk)).slice(-12000);};
          child.stdout.on('data',append);child.stderr.on('data',append);
          child.once('error',error=>{state='failed';append(error.message);});
          done=new Promise(resolve=>child.once('close',async code=>{
            try {
              if(state==='cancelling')state='cancelled';
              else if(state==='running')state=code===0?'complete':'failed';
              if(code===0){
                await provider.refresh();
                if(state==='complete'&&!provider.entries.size)state='failed';
              }
            } catch(error){state='failed';append(error.message);}
            finally {child=null;resolve();}
          }));
        } else if(action==='cancel'){
          if(child){state='cancelling';child.kill();}
        } else if(action!=='status')throw Error('Unknown library setup action.');
        await provider.refresh();
        res.end(JSON.stringify({state, log, directory:provider.libraryDir, skills:provider.entries.size, unavailable:provider.manifest.unavailable.length}));
      } catch(error){res.writeHead(400);res.end(JSON.stringify({error:error.message}));}
    },
  }));
  ctx.effect(()=>async()=>{
    if(child){state='cancelling';child.kill();}
    await done;
  });
}
