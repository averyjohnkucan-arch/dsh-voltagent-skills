window.__ModuleLoader__.load({id:'dsh-voltagent-skills',factory(require) {
  const {createElement:h,useEffect,useState}=require('react');
  let connection=window.__DSH_VOLTAGENT_SKILLS__;
  async function request(action,retry=true) {
    if(!connection){
      const r=await fetch('/plugins/dsh-voltagent-skills/setup/connection');
      if(!r.ok)throw Error('Library settings are unavailable.');
      connection=await r.json();
    }
    const r=await fetch(connection.path,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+connection.token},
      body:JSON.stringify({action}),
    });
    if(r.status===401&&retry){connection=null;return request(action,false);}
    const value=await r.json();
    if(!r.ok)throw Error(value.error||'Library setup request failed.');
    return value;
  }
  function LibraryPage(){
    const [status,setStatus]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
    useEffect(()=>{
      let active=true;
      const refresh=()=>request('status').then(v=>active&&setStatus(v)).catch(e=>active&&setError(e.message));
      void refresh();
      const timer=setInterval(refresh,1800);
      return ()=>{active=false;clearInterval(timer);};
    },[]);
    async function apply(action){
      setBusy(true);setError('');
      try {setStatus(await request(action));}
      catch(error){setError(error.message);}
      finally {setBusy(false);}
    }
    const running=['running','cancelling'].includes(status?.state);
    return h('section',{style:{display:'grid',gap:12}},
      h('h2',null,'VoltAgent Skills'),
      h('p',null,'Download skill files from the catalog. Once indexed, the library can be searched locally.'),
      error&&h('p',{role:'alert'},error),
      status&&h('p',null,status.skills+' local skills in '+status.directory+(status.unavailable?' · '+status.unavailable+' catalog entries unavailable':'')),
      h('div',null,
        h('button',{disabled:busy||running,onClick:()=>apply('story')},'Download Story Skills'),
        h('button',{disabled:busy||running,onClick:()=>apply('full')},'Download full catalog'),
        running&&h('button',{disabled:busy||status.state==='cancelling',onClick:()=>apply('cancel')},'Cancel')),
      status?.state&&status.state!=='idle'&&h('p',{role:'status'},status.state+' · '+(status.log.trim().split('\n').at(-1)||'')),
      status?.log&&h('details',null,h('summary',null,'Download details'),h('pre',{style:{whiteSpace:'pre-wrap'}},status.log)));
  }
  return {inject:['slots'],apply(ctx){
    ctx.slots.inject('settings.section',()=>ctx.slots.register({
      name:'settings.section',id:'voltagent-skills',order:72,label:()=> 'VoltAgent Skills',
    },LibraryPage));
  }};
}});
