// Execute the catalog and visibility SQL against disposable PostgreSQL only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process'),{Pool}=require('pg');
const CONTAINER=`artsoul-admin-catalog-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const STAFF=`0x${'1'.repeat(40)}`,CREATOR=`0x${'2'.repeat(40)}`,REPORTER=`0x${'3'.repeat(40)}`;
const migration=name=>fs.readFileSync(`sql/migrations/${name}`,'utf8');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function available(){try{return docker('version','--format','{{.Server.Os}}')==='linux';}catch{return false;}}
test('staff catalog and manual visibility changes preserve complaint restrictions (PostgreSQL 17)',{skip:available()?false:'Docker unavailable'},async t=>{
  let created=false,pool;
  t.after(async()=>{if(pool)await pool.end();if(created)docker('rm','-f',CONTAINER);});
  docker('run','-d','--name',CONTAINER,'-e','POSTGRES_PASSWORD=local-catalog-only','-e','POSTGRES_DB=artsoul','-p','127.0.0.1::5432','postgres:17');created=true;
  const port=Number(docker('port',CONTAINER,'5432/tcp').split(':')[1]);
  pool=new Pool({host:'127.0.0.1',port,user:'postgres',database:'artsoul',password:'local-catalog-only',connectionTimeoutMillis:1000,max:8});
  for(let n=0;n<60;n++){try{await pool.query('SELECT 1');await delay(200);await pool.query('SELECT 1');break;}catch{await delay(500);}}
  await pool.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.v41_artworks(chain_id NUMERIC(78,0),artwork_id NUMERIC(78,0),creator TEXT,metadata_uri TEXT,
      transaction_hash TEXT,canonical_floor NUMERIC(78,0) DEFAULT 0,token_id NUMERIC(78,0),PRIMARY KEY(chain_id,artwork_id));
    CREATE TABLE public.contract_events(chain_id NUMERIC(78,0),transaction_hash TEXT,log_index INTEGER,PRIMARY KEY(chain_id,transaction_hash,log_index));
    CREATE TABLE public.artsoul_staff_roles(wallet_address TEXT PRIMARY KEY,role TEXT,active BOOLEAN);
    CREATE TABLE public.artwork_search_metadata(chain_id NUMERIC(78,0),artwork_id NUMERIC(78,0),metadata_uri TEXT,source_transaction_hash TEXT,title TEXT,metadata JSONB);
    GRANT SELECT ON public.v41_artworks,public.artwork_search_metadata TO service_role;
    INSERT INTO public.artsoul_staff_roles VALUES('${STAFF}','moderator',TRUE);`);
  for(const name of ['phase18_artwork_moderation_visibility.sql','a8b_artwork_report_intake.sql','a8c_protocol_admin_review.sql','artist_support.sql','artist_support_moderation.sql','admin_artwork_catalog.sql'])await pool.query(migration(name));
  // Migration is repeatable and never resets existing state.
  await pool.query(migration('admin_artwork_catalog.sql'));
  t.beforeEach(async()=>{
    await pool.query(`TRUNCATE public.artwork_report_notifications,public.artwork_report_events,public.artwork_reports,
      public.artwork_moderation_log,public.artwork_moderation_visibility,public.v41_artworks,public.artwork_search_metadata RESTART IDENTITY CASCADE;
      UPDATE public.artsoul_staff_roles SET active=TRUE;
      INSERT INTO public.v41_artworks(chain_id,artwork_id,creator,metadata_uri,transaction_hash)
        SELECT 84532,n,'${CREATOR}','data:application/json,{}','tx-'||n FROM generate_series(1,205) n;
      INSERT INTO public.artwork_search_metadata VALUES(84532,205,'data:application/json,{}','tx-205','Newest','{"image":"https://example.com/preview.png"}');`);
  });
  const visibility=async()=> (await pool.query('SELECT *,updated_at::TEXT AS revision FROM public.artwork_moderation_visibility WHERE chain_id=84532 AND artwork_id=205')).rows[0];
  const manual=(hidden,revision=null,reason='Manually reviewed.')=>pool.query('SELECT * FROM public.review_artwork_visibility($1,$2,$3,$4,$5,$6)',[84532,205,hidden,reason,STAFF,revision]);
  const submit=async()=> (await pool.query('SELECT * FROM public.submit_artwork_report($1,$2,$3,$4,$5,$6,$7,$8)',[84532,205,REPORTER,'copyright','Evidence for review',null,true,5])).rows[0].report_id;
  const review=async(id,action)=>{const version=(await pool.query('SELECT updated_at::TEXT AS version FROM public.artwork_reports WHERE id=$1',[id])).rows[0].version;
    return pool.query('SELECT * FROM public.review_artwork_report($1,$2,$3,$4,$5)',[id,version,action,'Complaint evidence reviewed.',STAFF]);};
  await t.test('catalog pages traverse more than 200 artworks, include hidden and bind metadata to registration',async()=>{
    await manual(true);
    await pool.query(`INSERT INTO public.artwork_search_metadata VALUES(84532,204,'wrong-uri','wrong-tx','Stale title','{}');`);
    let before=null,ids=[];
    do {const rows=(await pool.query('SELECT public.read_admin_artwork_catalog($1,26,NULL) AS data',[before])).rows[0].data;
      assert.ok(rows.length<=26);const page=rows.slice(0,25);ids.push(...page.map(row=>row.artwork_id));
      if(!before){assert.equal(page[0].title,'Newest');assert.equal(page[0].hidden,true);assert.equal(page[1].title,null);}
      before=rows.length===26?page.at(-1).artwork_id:null;
    }while(before);
    assert.equal(ids.length,205);assert.equal(new Set(ids).size,205);assert.equal(ids.at(-1),'1');
  });
  await t.test('manual hide and restore require revisions, preserve reasons and reject replay',async()=>{
    await manual(true);const hidden=await visibility();assert.equal(hidden.hidden,true);
    await assert.rejects(manual(false,null),/VISIBILITY_REVIEW_CONFLICT/);
    await manual(false,hidden.revision,'Restriction cleared after review.');assert.equal((await visibility()).hidden,false);
    await assert.rejects(manual(false,hidden.revision),/VISIBILITY_REVIEW_CONFLICT/);
    assert.deepEqual((await pool.query('SELECT action,reason FROM public.artwork_moderation_log ORDER BY id')).rows,
      [{action:'HIDE',reason:'Manually reviewed.'},{action:'UNHIDE',reason:'Restriction cleared after review.'}]);
    await assert.rejects(manual(true,(await visibility()).revision,''),/INVALID_VISIBILITY_REQUEST/);
  });
  await t.test('active complaints forbid direct restore; final complaint review still restores',async()=>{
    const id=await submit();await review(id,'hide');
    await assert.rejects(manual(false,(await visibility()).revision),/ARTWORK_ACTIVE_REPORTS/);
    assert.equal((await visibility()).hidden,true);
    const counts=(await pool.query('SELECT public.read_admin_artwork_catalog(NULL,1,ARRAY[\'205\']) AS data')).rows[0].data[0];
    assert.equal(counts.report_count,1);assert.equal(counts.actioned_count,1);assert.equal(counts.pending_count,0);
    await review(id,'restore');assert.equal((await visibility()).hidden,false);
  });
  await t.test('concurrent manual restore and complaint hide cannot expose an actioned work',async()=>{
    await manual(true);const version=(await visibility()).revision,id=await submit();
    await Promise.allSettled([manual(false,version),review(id,'hide')]);
    assert.equal((await visibility()).hidden,true);
    assert.equal((await pool.query('SELECT status FROM public.artwork_reports WHERE id=$1',[id])).rows[0].status,'actioned');
  });
  await t.test('two stale manual decisions produce one mutation and one conflict',async()=>{
    const results=await Promise.allSettled([manual(true),manual(true)]);
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
    assert.match(results.find(row=>row.status==='rejected').reason.message,/VISIBILITY_REVIEW_CONFLICT/);
    assert.equal((await pool.query('SELECT count(*) AS count FROM public.artwork_moderation_log')).rows[0].count,'1');
  });
  await t.test('revoked roles, absent artworks and browser database roles cannot mutate visibility',async()=>{
    await pool.query('UPDATE public.artsoul_staff_roles SET active=FALSE');await assert.rejects(manual(true),/ADMIN_REQUIRED/);
    await pool.query('UPDATE public.artsoul_staff_roles SET active=TRUE');
    await assert.rejects(pool.query('SELECT * FROM public.review_artwork_visibility(84532,999,TRUE,\'Evidence\',$1,NULL)',[STAFF]),/ARTWORK_NOT_FOUND/);
    for(const role of ['anon','authenticated']){
      const grants=(await pool.query(`SELECT has_function_privilege($1,'public.read_admin_artwork_catalog(text,integer,text[])','EXECUTE') AS catalog,
        has_function_privilege($1,'public.review_artwork_visibility(numeric,numeric,boolean,text,text,timestamptz)','EXECUTE') AS write`,[role])).rows[0];
      assert.equal(grants.catalog,false);assert.equal(grants.write,false);
    }
  });
  await t.test('catalog enforces bounded inputs and exact requested IDs',async()=>{
    for(const args of [[null,27,null],['0',1,null],[null,1,[]]])await assert.rejects(pool.query('SELECT public.read_admin_artwork_catalog($1,$2,$3)',args));
    const rows=(await pool.query('SELECT public.read_admin_artwork_catalog(NULL,2,ARRAY[\'1\',\'205\']) AS data')).rows[0].data;
    assert.deepEqual(rows.map(row=>row.artwork_id),['205','1']);
  });
});
