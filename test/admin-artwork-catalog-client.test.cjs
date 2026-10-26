const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('src/features/admin/artwork-catalog.jsx','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {resolve,promise};};
function hooks(){const values=[],refs=[],effects=[];let si,ri,ei,pending;return {
  useState(initial){const i=si++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],value=>{values[i]=typeof value==='function'?value(values[i]):value;}];},
  useRef(initial){return refs[ri++]||=( {current:initial});},
  useEffect(fn,deps){const i=ei++,old=effects[i];if(!old||deps.some((value,j)=>value!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
  render(fn){si=ri=ei=0;pending=[];const tree=fn();pending.forEach(fn=>fn());return tree;},unmount(){effects.forEach(effect=>effect.cleanup?.());}
};}
function descendants(node){return !node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(descendants)];}
const text=node=>typeof node==='string'?node:node&&typeof node==='object'?[node.props?.children].flat(Infinity).map(text).join(''):'';
const row=overrides=>({chain_id:84532,artwork_id:'34',title:'Review artwork',hidden:false,report_count:3,pending_count:0,actioned_count:0,donation_report_count:1,visibility_updated_at:'2026-10-26T10:00:00.123456Z',...overrides});
async function harness(api){const {transformWithOxc}=await import('vite');const compiled=await transformWithOxc(source.replace(/^import .*;\s*/,'').replaceAll('export function','function'),'catalog.jsx',{jsx:{runtime:'classic'}});
  const h=hooks(),calls=[],reviews=[],errors=[];let current=true,changed=0;
  const React={...h,createElement:(type,props,...children)=>({type,props:{...props,children}})};
  const render=vm.runInNewContext(compiled.code+'\nAdminArtworkCatalog;',{React,document:{activeElement:null}});
  const props={api:async(path,options)=>{calls.push({path,options});return api(path,options);},isSessionCurrent:()=>current,onAccessError:error=>errors.push(error),onReview:(artwork,status)=>reviews.push({artwork,status}),onChanged:()=>changed++};
  let tree;const update=()=>tree=h.render(()=>render(props));update();
  return {h,calls,reviews,errors,update,lose:()=>{current=false;},button:name=>descendants(tree).find(node=>node.type==='button'&&text(node)===name),
    decision:()=>descendants(tree).find(node=>typeof node.type==='function'&&node.type.name==='VisibilityDialog'),nodes:()=>descendants(tree),changed:()=>changed};
}
test('catalog ignores a stale account read and unmounted result',async()=>{
  for(const action of ['lose','unmount']){const pending=deferred(),h=await harness(()=>pending.promise);if(action==='lose')h.lose();else h.h.unmount();
    pending.resolve({data:{artworks:[row()],next:null}});await tick();h.update();assert.equal(h.nodes().some(node=>node.type==='article'),false);}
});
test('catalog review opens the exact target and all closed states instead of an empty resolved filter',async()=>{
  const h=await harness(async()=>({data:{artworks:[row()],next:null}}));await tick();h.update();
  h.button('Review artwork reports').props.onClick();assert.equal(h.reviews[0].status,'all');assert.equal(h.reviews[0].artwork.artwork_id,'34');
  h.button('Review donation reports').props.onClick();assert.equal(h.reviews[1].artwork.target_type,'donation_message');
  assert.equal(h.nodes().find(node=>node.type==='article').props['data-pending'],false);
});
test('catalog manual hide submits the full revision and cannot submit after account loss',async()=>{
  const h=await harness(async()=>({data:{artworks:[row()],next:null}}));await tick();h.update();
  h.button('Hide artwork').props.onClick();h.update();await h.decision().props.onSubmit('Verified reason.');await tick();h.update();
  const body=JSON.parse(h.calls.find(call=>call.path==='artwork-visibility').options.body);
  assert.equal(body.expected_updated_at,'2026-10-26T10:00:00.123456Z');assert.equal(body.hidden,true);assert.equal(body.reason,'Verified reason.');
  assert.equal(h.changed(),1);
  h.button('Hide artwork').props.onClick();h.update();h.lose();await h.decision().props.onSubmit('No authority.');
  assert.equal(h.calls.filter(call=>call.path==='artwork-visibility').length,1);
});
test('active complaints offer review but no direct restore; an unrelated manual hide can be restored',async()=>{
  for(const active of [0,2]){const h=await harness(async()=>({data:{artworks:[row({hidden:true,actioned_count:active})],next:null}}));await tick();h.update();
    assert.equal(Boolean(h.button('Restore artwork')),active===0);
    h.button('Review artwork reports').props.onClick();assert.equal(h.reviews[0].status,active?'actioned':'all');}
});
test('late write completion cannot reload, report success or notify after session loss',async()=>{
  const write=deferred(),h=await harness(async path=>path==='artwork-visibility'?write.promise:{data:{artworks:[row()],next:null}});await tick();h.update();
  h.button('Hide artwork').props.onClick();h.update();const pending=h.decision().props.onSubmit('Evidence.');h.lose();write.resolve({success:true});await pending;h.update();
  assert.equal(h.calls.length,2);assert.equal(h.changed(),0);assert.equal(h.nodes().some(node=>text(node)==='Visibility decision recorded.'),false);
});
test('conflicting decisions close their dialog and refresh without replaying the write',async()=>{
  const error=Object.assign(new Error('This artwork changed.'),{status:409});
  const h=await harness(async path=>{if(path==='artwork-visibility')throw error;return {data:{artworks:[row()],next:null}};});await tick();h.update();
  h.button('Hide artwork').props.onClick();h.update();await h.decision().props.onSubmit('Reason.');h.update();
  assert.equal(h.decision(),undefined);assert.equal(h.calls.length,3);assert.equal(h.changed(),0);
  assert.ok(h.nodes().some(node=>node.props?.role==='status'&&text(node)==='This artwork changed.'));
});

test('a recorded decision with a failed refresh clears stale cards and asks for a read-only retry',async()=>{
  let reads=0;
  const h=await harness(async path=>{
    if(path==='artwork-visibility')return {success:true};
    if(++reads>1)throw Object.assign(new Error('Temporary catalog failure.'),{status:500});
    return {data:{artworks:[row()],next:null}};
  });
  await tick();h.update();h.button('Hide artwork').props.onClick();h.update();
  await h.decision().props.onSubmit('Reviewed evidence.');h.update();
  assert.equal(h.decision(),undefined);assert.equal(h.nodes().some(node=>node.type==='article'),false);
  assert.equal(h.changed(),1);assert.equal(h.calls.filter(call=>call.path==='artwork-visibility').length,1);
  assert.ok(h.nodes().some(node=>node.props?.role==='status'&&text(node)==='Decision recorded. Refresh artworks before making another decision.'));
  assert.equal(h.button('Refresh artworks').props.disabled,false);
});
