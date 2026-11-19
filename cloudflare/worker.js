import * as views from '../views.js';
import {digest,equals,passwordHash,randomToken} from './crypto.js';
import {importTickets,phoneNumber,ticketNumbers} from './import.js';

const active="c.active AND c.public AND NOT c.archived AND (c.starts IS NULL OR c.starts<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND (c.ends IS NULL OR c.ends>strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
const statsSql=`SELECT c.*,
 (SELECT count(DISTINCT t.participant_id) FROM transactions t JOIN lottery_tickets l ON l.transaction_id=t.id WHERE t.campaign_id=c.id AND t.status='confirmed') participants,
 (SELECT count(*) FROM lottery_tickets l WHERE l.campaign_id=c.id) sold,
 b.bank,b.holder,b.account,b.iban,b.logo,b.provider FROM campaigns c LEFT JOIN bank_accounts b ON b.campaign_id=c.id`;
const nowSql="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const validation='Оруулсан мэдээллийн форматыг шалгана уу';
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
function fail(message=validation,status=400){throw new HttpError(status,message);}
function number(value,max=2147483647){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0&&n<=max?n:0;
}
function field(body,name,max,required=false){
  const value=body[name]??'';
  if(typeof value!=='string'||value.trim().length>max||required&&!value.trim()) fail();
  return value.trim();
}
function date(value){
  if(!value)return null;
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value)) fail('Огноог шалгана уу');
  const result=new Date(value+'+08:00');
  if(!Number.isFinite(+result)||new Date(+result+28800000).toISOString().slice(0,16)!==value.slice(0,16)) fail('Огноог шалгана уу');
  return result.toISOString();
}
function httpsUrl(value,allowMedia=false){
  if(!value||allowMedia&&/^\/media\/[a-f0-9]{64}$/.test(value))return value;
  let url;
  try {url=new URL(value);} catch {fail('Холбоосоо шалгана уу');}
  if(url.protocol!=='https:'||url.username||url.password) fail('HTTPS холбоос оруулна уу');
  return url.href;
}
const json=(data,status=200)=>Response.json(data,{status});
const html=(data,status=200)=>new Response(data,{status,headers:{'Content-Type':'text/html; charset=utf-8'}});
const redirect=(location,cookie)=>new Response(null,{status:303,headers:{Location:location,...(cookie?{'Set-Cookie':cookie}:{})}});
function cookie(value,maxAge,secure){
  return (secure?'__Host-hurd':'hurd')+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(secure?'; Secure':'');
}
async function readBody(req,max=32768){
  if(Number(req.headers.get('Content-Length'))>max) fail('Файл эсвэл хүсэлт хэт том байна',413);
  if(!req.body) return {};
  const reader=req.body.getReader(),parts=[];
  let size=0;
  for(;;){
    const part=await reader.read();
    if(part.done)break;
    size+=part.value.byteLength;
    if(size>max){await reader.cancel();fail('Файл эсвэл хүсэлт хэт том байна',413);}
    parts.push(part.value);
  }
  try {
    const type=req.headers.get('Content-Type')||'';
    if(type.startsWith('multipart/form-data')){
      return Object.fromEntries(await new Response(new Blob(parts),{headers:{'Content-Type':type}}).formData());
    }
    const text=await new Blob(parts).text();
    if(type.startsWith('application/json')) {
      const body=JSON.parse(text);
      if(!body||typeof body!=='object'||Array.isArray(body))fail();
      return body;
    }
    if(type.startsWith('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  } catch {fail();}
  fail();
}
async function rate(db,req,scope,limit,seconds){
  const client=req.headers.get('CF-Connecting-IP')||'local';
  const key=await digest(client);
  const bucket=Math.floor(Date.now()/1000/seconds);
  const row=await db.prepare(`INSERT INTO rate_limits VALUES (?1,?2,?3,1)
    ON CONFLICT(scope,key) DO UPDATE SET count=CASE WHEN bucket=excluded.bucket THEN count+1 ELSE 1 END,bucket=excluded.bucket
    RETURNING count`).bind(scope,key,bucket).first();
  if(row.count>limit) fail('Түр хүлээгээд дахин оролдоно уу',429);
}
function imageType(bytes){
  const length=bytes.length;
  if(length<16) return '';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes[length-2]===255&&bytes[length-1]===217)return 'image/jpeg';
  if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'image/png';
  if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
  return '';
}

async function route(req,env){
  const url=new URL(req.url);
  const path=url.pathname;
  const method=req.method;
  const db=env.DB;
  const stmt=(sql,...args)=>args.length?db.prepare(sql).bind(...args):db.prepare(sql);
  const one=(sql,...args)=>stmt(sql,...args).first();
  const all=async(sql,...args)=>(await stmt(sql,...args).all()).results;
  const setting=async key=>(await one('SELECT value FROM site_settings WHERE key=?1',key))?.value||'';
  const audit=(id,action,target)=>stmt('INSERT INTO audit_logs(admin_id,action,target) VALUES (?1,?2,?3)',id,action,String(target));
  const origin=env.PUBLIC_ORIGIN?new URL(env.PUBLIC_ORIGIN).origin:url.origin;
  const secure=url.protocol==='https:';
  if(method==='POST'&&req.headers.get('Origin')!==url.origin) fail('Хүсэлтийн эх үүсвэр зөвшөөрөгдөөгүй',403);
  if(method==='GET'&&(path==='/'||path.startsWith('/campaign/'))){
    const campaign=path==='/'?null:await one(statsSql+` WHERE ${active} AND c.slug=?1`,path.slice(10));
    if(path!=='/'&&!campaign)return html(views.message('Сугалаа олдсонгүй'),404);
    const campaigns=campaign?[]:await all(statsSql+` WHERE ${active} ORDER BY c.id DESC`);
    const copyRow=await one("SELECT value FROM site_settings WHERE key='copy'");
    return html(views.home({campaigns,campaign,origin,facebook:await setting('facebook'),facebookLive:await setting('facebook_live'),copy:copyRow?JSON.parse(copyRow.value):{}}));
  }
  const media=path.match(/^\/media\/([a-f0-9]{64})$/);
  if(method==='GET'&&media){
    const image=await one('SELECT * FROM images WHERE id=?1',media[1]);
    if(!image)return new Response(null,{status:404});
    return new Response(new Uint8Array(image.bytes),{headers:{'Content-Type':image.mime,'Cache-Control':'public, max-age=31536000, immutable'}});
  }
  if(method==='POST'&&path==='/lookup'){
    const body=await readBody(req);
    const phone=phoneNumber(field(body,'phone',30));
    if(!phone)fail('Утасны 8 оронтой дугаараа шалгана уу.');
    const campaignId=body.campaign?number(body.campaign):0;
    if(body.campaign&&!campaignId)fail('Сугалаагаа шалгана уу.');
    await rate(db,req,'lookup',30,600);
    const found=await all(`SELECT c.id campaign_id,c.title,c.slug,l.number ticket_number
      FROM participants p
      JOIN transactions t ON t.participant_id=p.id
      JOIN lottery_tickets l ON l.transaction_id=t.id JOIN campaigns c ON c.id=l.campaign_id
      LEFT JOIN participant_phones pp ON pp.participant_id=p.id AND pp.phone=?1
      WHERE (pp.phone=?1 OR p.phone=?1) AND t.status='confirmed' AND c.public AND NOT c.archived
      AND (?2=0 OR c.id=?2)
      GROUP BY c.id,l.number
      ORDER BY c.id DESC,l.number ASC`,phone,campaignId);
    const grouped=new Map();
    for(const row of found){if(!grouped.has(row.campaign_id))grouped.set(row.campaign_id,{id:row.campaign_id,title:row.title,slug:row.slug,tickets:[]});grouped.get(row.campaign_id).tickets.push({number:row.ticket_number});}
    const campaigns=[...grouped.values()].map(c=>({...c,count:c.tickets.length}));
    return json({count:campaigns.reduce((sum,c)=>sum+c.count,0),campaigns});
  }
  if(path==='/admin/login'&&method==='GET')return html(views.login());
  if(path==='/admin/login'&&method==='POST'){
    const body=await readBody(req);
    const username=field(body,'username',64,true);
    const password=typeof body.password==='string'&&body.password.length<=160?body.password:'';
    await rate(db,req,'login',8,900);
    let admin=await one('SELECT * FROM admins WHERE username=?1',username);
    if(!admin && env.ADMIN_USERNAME===username && typeof env.ADMIN_PASSWORD==='string' && env.ADMIN_PASSWORD.length>=14 &&
       equals(await digest(password),await digest(env.ADMIN_PASSWORD))){
      await stmt(`INSERT INTO admins(username,password) SELECT ?1,?2 WHERE NOT EXISTS (SELECT 1 FROM admins)
        ON CONFLICT(username) DO NOTHING`,username,await passwordHash(password)).run();
      admin=await one('SELECT * FROM admins WHERE username=?1',username);
    }
    const saved=admin?.password||'0123456789abcdef:placeholder';
    if(!equals(await passwordHash(password,saved.split(':')[0]),saved)||!admin) return html(views.login('Нэвтрэх нэр эсвэл нууц үг буруу'),401);
    const raw=randomToken();
    await db.batch([
      stmt('DELETE FROM sessions WHERE admin_id=?1 AND expires<=?2',admin.id,Date.now()),
      stmt('INSERT INTO sessions VALUES (?1,?2,?3)',await digest(raw),admin.id,Date.now()+28800000),
      audit(admin.id,'admin.login',admin.id)
    ]);
    return redirect('/admin',cookie(raw,28800,secure));
  }
  if(path!=='/admin'&&!path.startsWith('/admin/'))return html(views.message('Хуудас олдсонгүй'),404);
  const key=secure?'__Host-hurd':'hurd';
  const raw=req.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(key+'='))?.slice(key.length+1);
  const session=/^[a-f0-9]{64}$/.test(raw||'')?await digest(raw):null;
  const admin=session?await one('SELECT a.* FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token=?1 AND s.expires>?2',session,Date.now()):null;
  if(!admin){if(method==='GET')return redirect('/admin/login');fail('Админаар нэвтэрнэ үү',401);}
  const owner=()=>{if(admin.role!=='owner')fail('Эрх хүрэлцэхгүй',403);};
  if(path==='/admin/logout'&&method==='POST'){
    await stmt('DELETE FROM sessions WHERE token=?1',session).run();
    return redirect('/admin/login',cookie('',0,secure));
  }
  if(path==='/admin/password'&&method==='POST'){
    const body=await readBody(req);
    await rate(db,req,'password',8,900);
    if(typeof body.current!=='string'||body.current.length>160||typeof body.password!=='string'||body.password.length<14||body.password.length>160)fail();
    if(!equals(await passwordHash(body.current,admin.password.split(':')[0]),admin.password))fail('Одоогийн нууц үг буруу');
    await db.batch([
      stmt('UPDATE admins SET password=?1 WHERE id=?2 AND password=?3',await passwordHash(body.password),admin.id,admin.password),
      stmt('DELETE FROM sessions WHERE admin_id=?1',admin.id),audit(admin.id,'admin.password',admin.id)
    ]);
    return redirect('/admin/login',cookie('',0,secure));
  }
  if(path==='/admin'&&method==='GET'){
    const [campaigns,stats,logs,imports,facebook,facebookLive,copyRow]=await Promise.all([
      all(statsSql+' WHERE NOT c.archived ORDER BY c.id DESC'),
      one(`SELECT count(*) transactions,count(*) FILTER (WHERE status='confirmed') confirmed,
       count(*) FILTER (WHERE status='pending') pending,count(DISTINCT participant_id) FILTER(WHERE status='confirmed') participants,
       coalesce(sum(amount) FILTER(WHERE status='confirmed'),0) revenue,(SELECT count(*) FROM lottery_tickets) sold,
       (SELECT count(*) FROM campaigns c WHERE ${active}) active FROM transactions`),
      all('SELECT action,target,created_at FROM audit_logs ORDER BY id DESC LIMIT 15'),
      all('SELECT i.*,c.title FROM imports i JOIN campaigns c ON c.id=i.campaign_id ORDER BY i.id DESC LIMIT 25'),
      setting('facebook'),setting('facebook_live'),one("SELECT value FROM site_settings WHERE key='copy'")
    ]);
    for(const row of imports)row.summary=JSON.parse(row.summary);
    return html(views.admin(campaigns,stats,logs,imports,facebook,facebookLive,admin.role==='owner',true,copyRow?JSON.parse(copyRow.value):{}));
  }
  if(path==='/admin/site'&&method==='POST'){
    owner();
    const body=await readBody(req);
    const facebook=httpsUrl(field(body,'facebook',2048));
    const facebookLive=httpsUrl(field(body,'facebookLive',2048));
    if(facebook&&!['www.facebook.com','facebook.com','m.facebook.com','fb.com','fb.me','m.me'].includes(new URL(facebook).hostname)) fail('Facebook холбоос оруулна уу');
    if(facebookLive&&!['www.facebook.com','facebook.com','m.facebook.com','fb.watch'].includes(new URL(facebookLive).hostname)) fail('Facebook LIVE холбоос оруулна уу');
    const keys=['heroTitle','heroBrand','heroTagline','heroIntro','lookupTitle','lookupHelp','lookupButton','phoneLabel','campaignHeading','campaignIntro','helpTitle','helpText','priceLabel','shareLabel','contactLabel','navHome','navCampaigns','navLookup','navHelp','railCampaigns','railLookup','railHelp','noCampaignTitle','noCampaignText','detailLabel','bankMemo','bankNote'];
    const copy={};for(const key of keys)copy[key]=field(body,key,1200);
    for(const key of ['showPrice','showStats','showBank','showShare','showContact'])copy[key]=body[key]==='on';
    await db.batch([stmt("INSERT INTO site_settings VALUES ('facebook',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",facebook),stmt("INSERT INTO site_settings VALUES ('facebook_live',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",facebookLive),stmt("INSERT INTO site_settings VALUES ('copy',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(copy)),audit(admin.id,'site.updated','copy')]);
    return redirect('/admin');
  }
  const campaignPath=path.match(/^\/admin\/campaigns\/(new|[1-9]\d*)(\/(?:delete|hard-delete))?$/);
  if(campaignPath){
    owner();
    const id=number(campaignPath[1]);
    if(method==='GET'&&!campaignPath[2]){
      if(campaignPath[1]==='new')return html(views.campaignForm({}));
      const campaign=await one(statsSql+' WHERE c.id=?1 AND NOT c.archived',id);
      if(!campaign)fail('Сугалаа олдсонгүй',404);
      return html(views.campaignForm(campaign));
    }
    if(method==='POST'&&id&&campaignPath[2]==='/delete'){
      await db.batch([stmt('UPDATE campaigns SET archived=1,active=0,public=0,revision=revision+1 WHERE id=?1',id),audit(admin.id,'campaign.archived',id)]);
      return redirect('/admin');
    }
    if(method==='POST'&&id&&campaignPath[2]==='/hard-delete'){
      const exists=await one('SELECT id FROM campaigns WHERE id=?1',id);
      if(!exists)fail('Сугалаа олдсонгүй',404);
      await db.batch([
        stmt('DELETE FROM import_rows WHERE import_id IN (SELECT id FROM imports WHERE campaign_id=?1) OR transaction_id IN (SELECT id FROM transactions WHERE campaign_id=?1)',id),
        stmt('DELETE FROM lottery_tickets WHERE campaign_id=?1',id),
        stmt('DELETE FROM transactions WHERE campaign_id=?1',id),
        stmt('DELETE FROM imports WHERE campaign_id=?1',id),
        stmt('DELETE FROM bank_accounts WHERE campaign_id=?1',id),
        audit(admin.id,'campaign.deleted',id),
        stmt('DELETE FROM campaigns WHERE id=?1',id)
      ]);
      return redirect('/admin');
    }
  }
  if(path==='/admin/campaigns'&&method==='POST'){
    owner();
    const body=await readBody(req,1700000);
    const id=number(body.id),slug=field(body,'slug',100,true),title=field(body,'title',150,true),description=field(body,'description',6000,true);
    const total=number(body.total,1000000),price=body.price===''?0:number(body.price,1000000000);
    if(!total||(body.price!==''&&body.price!=='0'&&!price)||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))fail();
    const bank=field(body,'bank',100),holder=field(body,'holder',120),account=field(body,'account',40),iban=field(body,'iban',40),provider=field(body,'provider',100);
    let logo=httpsUrl(field(body,'logo',2048),true)||null;
    const starts=date(field(body,'starts',40)),ends=date(field(body,'ends',40));
    if(starts&&ends&&starts>=ends)fail('Сугалааны хугацааг шалгана уу');
    let image=httpsUrl(field(body,'image',2048),true)||null;
    const statements=[];
    if(body.bankLogo instanceof Blob&&body.bankLogo.size){
      if(body.bankLogo.size>1000000)fail('Банкны логоны дээд хэмжээ 1 МБ',413);
      const bytes=new Uint8Array(await body.bankLogo.arrayBuffer()),mime=imageType(bytes);
      if(!mime)fail('JPG, PNG эсвэл WebP лого оруулна уу');
      const mediaId=await digest(bytes);
      statements.push(stmt('INSERT OR IGNORE INTO images VALUES (?1,?2,?3)',mediaId,mime,bytes.buffer));
      logo='/media/'+mediaId;
    }
    if(body.photo instanceof Blob&&body.photo.size){
      if(body.photo.size>1500000)fail('Зургийн дээд хэмжээ 1.5 МБ',413);
      const bytes=new Uint8Array(await body.photo.arrayBuffer());
      const mime=imageType(bytes);
      if(!mime)fail('JPG, PNG эсвэл WebP зураг оруулна уу');
      const mediaId=await digest(bytes);
      statements.push(stmt('INSERT OR IGNORE INTO images VALUES (?1,?2,?3)',mediaId,mime,bytes.buffer));
      image='/media/'+mediaId;
    }
    const values=[slug,title,description,image,total,Number(body.active==='on'),Number(body.public==='on'),starts,ends,null,price];
    if(id){
      statements.push(stmt('UPDATE campaigns SET (slug,title,description,image,total,active,public,starts,ends,participant_goal,price)=(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11),revision=revision+1 WHERE id=?12 AND NOT archived',...values,id));
      statements.push(stmt('INSERT INTO bank_accounts(campaign_id,bank,holder,account,iban,logo,provider) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(campaign_id) DO UPDATE SET bank=excluded.bank,holder=excluded.holder,account=excluded.account,iban=excluded.iban,logo=excluded.logo,provider=excluded.provider',id,bank,holder,account,iban,logo,provider));
      statements.push(audit(admin.id,'campaign.updated',id));
    }else{
      statements.push(stmt('INSERT INTO campaigns(slug,title,description,image,total,active,public,starts,ends,participant_goal,price) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)',...values));
      statements.push(stmt('INSERT INTO bank_accounts(campaign_id,bank,holder,account,iban,logo,provider) SELECT id,?2,?3,?4,?5,?6,?7 FROM campaigns WHERE slug=?1',slug,bank,holder,account,iban,logo,provider));
      statements.push(stmt("INSERT INTO audit_logs(admin_id,action,target) SELECT ?1,'campaign.created',id FROM campaigns WHERE slug=?2",admin.id,slug));
    }
    await db.batch(statements);
    return redirect('/admin');
  }
  if(method==='POST'&&['/admin/import/preview','/admin/import/commit'].includes(path)){
    const body=await readBody(req,1200000);
    try {return json(await importTickets(db,body,admin.id,session,path.split('/').at(-1)));}
    catch(error){
      if(error.message==='IMPORT_PREVIEW_STALE')fail('Сугалааны мэдээлэл эсвэл эрхийн жагсаалт урьдчилсан шалгалтаас хойш өөрчлөгдсөн. Шалгалтыг дахин хийнэ үү.',409);
      if(/constraint/i.test(error.message))fail('Давхардсан эрх эсвэл өгөгдлийн хязгаар зөрчигдлөө. Урьдчилсан шалгалтыг дахин хийнэ үү.',409);
      if(error.message.includes('Утас')||/[А-Яа-яӨөҮү]/.test(error.message))fail(error.message);
      throw error;
    }
  }
  const batchPath=path.match(/^\/admin\/imports\/([1-9]\d*)(\/rollback)?$/);
  if(batchPath){
    const id=number(batchPath[1]);
    const batch=await one('SELECT i.*,c.title FROM imports i JOIN campaigns c ON c.id=i.campaign_id WHERE i.id=?1',id);
    if(!batch)fail('Импорт олдсонгүй',404);
    if(method==='GET'&&!batchPath[2]){
      const page=Math.min(100,number(url.searchParams.get('page'))||1);
      const rows=await all('SELECT row_no,result,reason,transaction_id FROM import_rows WHERE import_id=?1 ORDER BY row_no LIMIT 101 OFFSET ?2',id,(page-1)*100);
      return html(views.importReport(batch,rows,page));
    }
    if(method==='POST'&&batchPath[2]){
      if(batch.rolled_back_at)fail('Импортыг аль хэдийн буцаасан');
      await db.batch([
        stmt('DELETE FROM lottery_tickets WHERE transaction_id IN (SELECT id FROM transactions WHERE import_id=?1) AND EXISTS(SELECT 1 FROM imports WHERE id=?1 AND rolled_back_at IS NULL)',id),
        stmt("UPDATE transactions SET status='reversed' WHERE import_id=?1 AND EXISTS(SELECT 1 FROM imports WHERE id=?1 AND rolled_back_at IS NULL)",id),
        stmt('UPDATE campaigns SET revision=revision+1 WHERE id=?1 AND EXISTS(SELECT 1 FROM imports WHERE id=?2 AND rolled_back_at IS NULL)',batch.campaign_id,id),
        stmt(`UPDATE imports SET rolled_back_at=${nowSql} WHERE id=?1 AND rolled_back_at IS NULL`,id),
        audit(admin.id,'import.rolled_back',id)
      ]);
      return redirect('/admin#import');
    }
  }
  if(method==='GET'&&path==='/admin/transactions'){
    const term=(url.searchParams.get('q')||'').slice(0,100),campaignId=number(url.searchParams.get('campaign')),page=number(url.searchParams.get('page'))||1;
    const campaigns=await all('SELECT id,title FROM campaigns ORDER BY id DESC');
    const rows=await all(`SELECT t.*,p.phone,c.title,
      (SELECT count(*) FROM lottery_tickets l WHERE l.transaction_id=t.id) actual_count
      FROM transactions t JOIN participants p ON p.id=t.participant_id
      JOIN campaigns c ON c.id=t.campaign_id WHERE (?1=0 OR c.id=?1) AND (?2='' OR instr(p.phone,?2)>0 OR instr(lower(t.memo),lower(?2))>0 OR CAST(t.id AS TEXT)=?2)
      ORDER BY t.id DESC LIMIT 51 OFFSET ?3`,campaignId,term,(page-1)*50);
    return html(views.transactions(rows,term,page,campaigns,campaignId));
  }
  const transactionPath=path.match(/^\/admin\/transactions\/(new|[1-9]\d*)$/);
  if(transactionPath){
    const id=number(transactionPath[1]);
    const entry=id?await one('SELECT t.*,p.phone FROM transactions t JOIN participants p ON p.id=t.participant_id WHERE t.id=?1',id):null;
    if(id&&!entry)fail('Гүйлгээ олдсонгүй',404);
    if(method==='GET'){
      const campaigns=await all('SELECT id,title FROM campaigns WHERE NOT archived ORDER BY id DESC');
      if(!entry)return html(views.transactionForm({tickets:[],requested:[],status:'pending'},campaigns));
      const tickets=await all('SELECT number FROM lottery_tickets WHERE transaction_id=?1 ORDER BY number',id);
      return html(views.transactionForm({...entry,tickets:tickets.map(row=>row.number),requested:JSON.parse(entry.requested)},campaigns));
    }
    if(method==='POST'){
      const body=await readBody(req,65536);
      const action=id?body.action:'save';
      if(!['save','confirm','reverse'].includes(action))fail();
      if(action==='reverse'){
        if(!entry)fail('Гүйлгээ олдсонгүй',404);
        if(entry.status!=='reversed')await db.batch([
          stmt('DELETE FROM lottery_tickets WHERE transaction_id=?1',id),
          stmt("UPDATE transactions SET status='reversed' WHERE id=?1 AND status<>'reversed'",id),
          stmt('UPDATE campaigns SET revision=revision+1 WHERE id=?1',entry.campaign_id),
          audit(admin.id,'transaction.reverse',id)
        ]);
        return redirect('/admin/transactions');
      }
      const saving=action==='save';
      const cid=saving?number(body.campaign):entry?.campaign_id;
      const campaign=await one('SELECT id,total,revision FROM campaigns WHERE id=?1 AND NOT archived',cid||0);
      if(!campaign)fail('Сугалаа олдсонгүй');
      const phone=saving?phoneNumber(field(body,'phone',30,true)):entry.phone;
      const payment=saving?number(body.amount):entry.amount;
      const occurred=saving?date(field(body,'date',40,true)):entry.occurred_at;
      const count=saving?number(body.count,5000):entry.count;
      const bank=saving?field(body,'bank',100):entry.bank,memo=saving?field(body,'memo',500):entry.memo;
      let requested;
      try{requested=saving?ticketNumbers(field(body,'numbers',30000)):JSON.parse(entry.requested);}
      catch{fail('Эрхийн дугаар буруу байна. Зөвхөн тоо, таслал эсвэл зай ашиглана уу.');}
      if(!phone||!count||saving&&(!payment||!occurred))fail('Утас, огноо, дүн болон эрхийн тоог шалгана уу.');
      if(requested.length&&requested.length!==count)fail('Эрхийн тоо ('+count+') болон оруулсан дугаарын тоо ('+requested.length+') зөрүүтэй байна.');
      if(new Set(requested).size!==requested.length)fail('Нэг гүйлгээнд ижил эрхийн дугаарыг давхар оруулсан байна.');
      if(requested.some(n=>n>campaign.total))fail('Эрхийн дугаар сугалааны нийт эрхийн хязгаараас хэтэрсэн байна.');
      if(action==='confirm'&&entry.status==='confirmed')return redirect('/admin/transactions');
      const status=action==='confirm'?'confirmed':entry?.status||'pending';
      const tickets=[...requested];
      if(status==='confirmed'){
        const used=new Set((await all('SELECT number FROM lottery_tickets WHERE campaign_id=?1 AND transaction_id<>?2',cid,id)).map(row=>row.number));
        if(used.size+count>campaign.total)fail('Сугалааны үлдэгдэл эрх хүрэлцэхгүй байна. Одоогийн үлдэгдлийг шалгана уу.');
        if(tickets.some(n=>used.has(n)))fail('Оруулсан эрхийн дугаар өөр гүйлгээнд аль хэдийн олгогдсон байна.');
        if(!tickets.length)for(let n=1;tickets.length<count&&n<=campaign.total;n++)if(!used.has(n))tickets.push(n);
        if(tickets.length!==count)fail('Шаардлагатай эрхийн тоог олгох боломжгүй байна.');
      }
      const insertPhone=stmt('INSERT OR IGNORE INTO participants(phone) VALUES (?1)',phone);
      const values=[cid,phone,occurred,payment,bank,memo,count,JSON.stringify(requested),status];
      if(id){
        await db.batch([
          insertPhone,
          stmt(`UPDATE transactions SET campaign_id=?1,participant_id=(SELECT id FROM participants WHERE phone=?2),
            occurred_at=?3,amount=?4,bank=?5,memo=?6,count=?7,requested=?8,status=?9 WHERE id=?10`,
            ...values,id),
          stmt('DELETE FROM lottery_tickets WHERE transaction_id=?1',id),
          ...(status==='confirmed'?[stmt('INSERT INTO lottery_tickets(campaign_id,transaction_id,number) SELECT ?1,?2,value FROM json_each(?3)',cid,id,JSON.stringify(tickets))]:[]),
          stmt('UPDATE campaigns SET revision=revision+1 WHERE id IN (?1,?2)',cid,entry.campaign_id),
          audit(admin.id,'transaction.'+action,id)
        ]);
      }else{
        const created=await one('SELECT id FROM transactions WHERE 1=0');
        await db.batch([insertPhone,stmt(`INSERT INTO transactions(campaign_id,participant_id,occurred_at,amount,bank,memo,count,requested,status)
          VALUES (?1,(SELECT id FROM participants WHERE phone=?2),?3,?4,?5,?6,?7,?8,?9)`,...values),
          stmt("INSERT INTO audit_logs(admin_id,action,target) VALUES (?1,'transaction.created',last_insert_rowid())",admin.id)]);
      }
      return redirect('/admin/transactions');
    }
  }
  return html(views.message('Хуудас олдсонгүй','/admin'),404);
}

export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    let response;
    try {response=await route(req,env);}
    catch(error){
      const conflict=/ticket capacity|(?:UNIQUE|CHECK) constraint failed/i.test(error.message);
      const status=error instanceof HttpError?error.status:conflict?409:500;
      if(status===500)console.error('Request failed',error.name,path,error.message);
      const message=error instanceof HttpError?error.message:conflict?'Эрхийн дугаар, багтаамж эсвэл холбоос давхардсан':'Системийн алдаа гарлаа. Дахин оролдоно уу.';
      response=path==='/lookup'||path.startsWith('/admin/import/')?json({error:message},status):html(views.message(message,path.startsWith('/admin')?'/admin':'/'),status);
    }
    const headers=new Headers(response.headers);
    headers.set('X-Content-Type-Options','nosniff');
    headers.set('X-Frame-Options','DENY');
    headers.set('Referrer-Policy','same-origin');
    headers.set('Content-Security-Policy',"default-src 'self'; img-src 'self' https:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(path==='/lookup'||path.startsWith('/admin'))headers.set('Cache-Control','no-store');
    return new Response(response.body,{status:response.status,headers});
  }
};
