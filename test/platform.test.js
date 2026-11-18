import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import xlsx from 'xlsx';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from '../server.js';
import {migrate,passwordHash} from '../db.js';
import {mapRows,workbook,sheetRows,dateValue,phoneFromMemo} from '../import.js';

test('import parses CSV, xls and xlsx, Ulaanbaatar dates and rejects ambiguous numbers/formulas',()=>{
  const settings={header:'1',start:'2',phone:'3',date:'1',amount:'2',tickets:'0',count:'',grouped:'true'};
  const matrix=[['Эрх','Огноо','Дүн','Утас'],[10,'2026-11-14',10000,'99110003'],[11,'','','+976 9911 0003'],[12,'2026-11-15',5000,'99110003 99110004']];
  let book=xlsx.utils.book_new();
  const sheet=xlsx.utils.aoa_to_sheet(matrix);
  xlsx.utils.book_append_sheet(book,sheet,'Тест');
  for(const ext of ['csv','xls','xlsx']){
    const bytes=xlsx.write(book,{type:'buffer',bookType:ext==='xls'?'biff8':ext});
    const parsed=workbook({originalname:'fixture.'+ext,buffer:bytes});
    const rows=mapRows(sheetRows(parsed,parsed.SheetNames[0]),settings,5000);
    assert.deepEqual(rows[0].tickets,[10,11]);
    assert.equal(rows[0].phone,'99110003');
    assert.equal(rows[0].date,'2026-11-13T16:00:00.000Z');
    assert.equal(rows[0].count,2);
    assert.ok(rows[2].error);
  }
  sheet.D2={t:'n',v:99110003,f:'99110000+3'};
  const parsed=workbook({originalname:'formula.xlsx',buffer:xlsx.write(book,{type:'buffer',bookType:'xlsx'})});
  assert.match(mapRows(sheetRows(parsed,'Тест'),settings,5000)[0].error,/Томьёо/);
  assert.equal(dateValue('2026-02-30'),null);
  assert.equal(phoneFromMemo('99110003 99110004'),'');
});
test('HTTP + PostgreSQL: auth, campaign lifecycle, Excel, phone count, duplicates, rollback',async(t)=>{
  const url=process.env.HURD_TEST_DATABASE_URL;
  const schema='hurd_test_'+randomBytes(8).toString('hex');
  const setup=url?new pg.Pool({connectionString:url}):null;
  if(setup) await setup.query('CREATE SCHEMA '+schema);
  const store=url?new pg.Pool({connectionString:url,options:'-c search_path='+schema}):new PGlite();
  const db=url?store:{
    query:(sql,params)=>store.query(sql,params).then(r=>({...r,rowCount:r.affectedRows??r.rows.length})),
    connect:async()=>({...db,release(){}})
  };
  t.after(async()=>{
    if(setup){
      await store.end();
      await setup.query('DROP SCHEMA '+schema+' CASCADE');
      await setup.end();
    } else await store.close();
  });
  if(url) await migrate(db);
  else await store.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  await db.query('INSERT INTO admins(username,password) VALUES ($1,$2)',['test-admin',passwordHash('integration-password')]);
  const origin='http://localhost:3000';
  const server=createApp(db,{PUBLIC_ORIGIN:origin}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const host='http://127.0.0.1:'+server.address().port;
  let cookie='';
  function req(path,{method='GET',body,headers={},auth=false}={}){
    return fetch(host+path,{method,body,redirect:'manual',headers:{Origin:origin,...(auth?{Cookie:cookie}:{}),...headers}});
  }
  const post=(path,data,auth=true)=>req(path,{method:'POST',body:new URLSearchParams(data),auth});
  const json=(path,data)=>req(path,{method:'POST',body:JSON.stringify(data),headers:{'Content-Type':'application/json'}});
  assert.equal((await req('/admin')).status,302);
  assert.match(await (await req('/')).text(),/Одоогоор идэвхтэй сугалаа алга/);
  assert.equal((await req('/admin/login',{method:'POST',headers:{Origin:'https://other.test'}})).status,403);
  assert.equal((await post('/admin/login',{username:'test-admin',password:'bad'},false)).status,401);
  const login=await post('/admin/login',{username:'test-admin',password:'integration-password'},false);
  assert.equal(login.status,303);
  assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  cookie=login.headers.get('set-cookie').split(';')[0];
  const campaign={title:'Туршилтын хүлэг',slug:'test-horse',description:'<script>fixture</script>',total:'20',participantGoal:'75',price:'5000',bank:'Шалгах банк',holder:'Данс эзэмшигч',account:'10001',iban:'MN00001',starts:'',ends:'',logo:'',provider:'test',image:'',active:'on',public:'on'};
  const adminForm=new FormData();
  Object.entries(campaign).forEach(([key,value])=>adminForm.set(key,value));
  assert.equal((await req('/admin/campaigns',{method:'POST',body:adminForm,auth:true})).status,303);
  assert.match(await (await req('/')).text(),/Туршилтын хүлэг/);
  const page=await (await req('/campaign/test-horse')).text();
  assert.match(page,/og:title/);
  assert.doesNotMatch(page,/MN00001/);
  assert.doesNotMatch(page,/<script>fixture<\/script>/);
  assert.equal((await req('/admin/transactions',{auth:true})).status,200);

  const fixture='Номер,Огноо,Дүн,Утас\n1,2026-11-12,10000,99110003\n2,,,99110003\n3,2026-11-13,5000,99110004\n4,2026-11-13,5000,99999999 99110004';
  async function imports(mode,fingerprint){
    const payload=new FormData();
    payload.append('file',new Blob([fixture]),'fixture.csv');
    for(const [key,value] of Object.entries({campaign:'1',sheet:'Sheet1',header:'1',start:'2',phone:'3',date:'1',amount:'2',count:'',tickets:'0',mode:'tickets',...(fingerprint?{fingerprint}:{})})) payload.set(key,value);
    return req('/admin/import/'+mode,{method:'POST',body:payload,auth:true});
  }
  const inspected=await (await imports('inspect')).json();
  assert.equal(inspected.columns,4);
  const preview=await (await imports('preview')).json();
  assert.deepEqual(preview.summary,{rows:4,valid:3,invalid:1,duplicate:0,tickets:3});
  assert.equal((await imports('commit','forged')).status,400);
  const committed=await (await imports('commit',preview.fingerprint)).json();
  assert.equal(committed.summary.tickets,3);
  assert.match(await (await req('/admin/imports/'+committed.id,{auth:true})).text(),/Импортолсон/);
  const repeated=await (await imports('preview')).json();
  assert.equal(repeated.summary.duplicate,3);
  assert.equal((await imports('commit',preview.fingerprint)).status,400);

  const config=await post('/admin/site',{facebook:'https://www.facebook.com/test-page'});
  assert.equal(config.status,303);
  const landing=await (await req('/')).text();
  assert.match(landing,/Одоо бүртгүүлсэн<\/dt><dd>2<\/dd>/);
  assert.match(landing,/Зорилтот оролцогч<\/dt><dd>75<\/dd>/);
  assert.match(landing,/facebook\.com\/sharer\/sharer\.php\?u=http%3A%2F%2Flocalhost%3A3000%2Fcampaign%2Ftest-horse/);
  assert.match(landing,/href="https:\/\/www\.facebook\.com\/test-page"/);
  assert.doesNotMatch(landing, /\+976|href="\/admin\/login"/);
  assert.equal((await json('/lookup',{phone:'123'})).status,400);
  assert.deepEqual(await (await json('/lookup',{phone:'+976 9911 0003'})).json(),{count:2});
  assert.deepEqual(await (await json('/lookup',{phone:'99110004'})).json(),{count:1});
  assert.deepEqual(await (await json('/lookup',{phone:'99110009'})).json(),{count:0});

  assert.equal((await post('/admin/imports/'+committed.id+'/rollback',{})).status,303);
  assert.deepEqual(await (await json('/lookup',{phone:'99110003'})).json(),{count:0});
  const remaining=await db.query('SELECT number FROM lottery_tickets ORDER BY number');
  assert.deepEqual(remaining.rows.map(x=>x.number),[]);
  const hidden=new FormData();
  Object.entries({...campaign,id:'1',public:''}).forEach(([key,value])=>hidden.set(key,value));
  assert.equal((await req('/admin/campaigns',{method:'POST',body:hidden,auth:true})).status,303);
  assert.equal((await req('/campaign/test-horse')).status,404);
  assert.equal((await post('/admin/campaigns/1/delete',{})).status,303);
  assert.equal((await post('/admin/password',{current:'integration-password',password:'new-integration-password'})).status,303);
  assert.equal((await req('/admin',{auth:true})).status,302);
});
