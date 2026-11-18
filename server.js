import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import sharp from 'sharp';
import {randomBytes,createHmac} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {pool,atomic,one,hash,passwordHash,equal,active,audit,lockCampaign,allocate,addTransaction} from './db.js';
import {phoneNumber,dateValue,ticketNumbers,positive,workbook,sheetRows,mapRows,processImport} from './import.js';
import * as views from './views.js';

const token=()=>randomBytes(32).toString('hex');
const invalid=(res,status,message)=>res.status(status).json({error:message});
const trimmed=max=>z.string().trim().max(max);
const reqText=max=>trimmed(max).min(1);
const safeUrl=z.string().max(2048).pipe(z.url({protocol:/^https$/})).or(z.literal(''));
const imageUrl=safeUrl.or(z.string().regex(/^\/media\/[a-f0-9]{64}$/));
const campaignInput=z.object({
  title:reqText(150),slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),description:reqText(6000),
  total:z.coerce.number().int().min(1).max(1000000),price:z.coerce.number().int().min(1).max(2147483647),
  participantGoal:z.preprocess(value=>value===''||value===undefined?null:value,z.coerce.number().int().min(1).max(1000000).nullable()),
  image:imageUrl,active:z.string().optional(),public:z.string().optional(),
  starts:trimmed(40),ends:trimmed(40),bank:trimmed(100),holder:trimmed(150),account:trimmed(40),iban:trimmed(40),
  logo:imageUrl,provider:trimmed(40)
});
const statSql=`SELECT c.*, b.bank,b.holder,b.account,b.iban,b.logo,b.provider,
  (SELECT count(DISTINCT t.participant_id)::int FROM transactions t WHERE t.campaign_id=c.id AND t.status='confirmed' AND EXISTS (SELECT 1 FROM lottery_tickets l WHERE l.transaction_id=t.id)) participants,
  (SELECT count(*)::int FROM lottery_tickets l WHERE l.campaign_id=c.id) sold
  FROM campaigns c LEFT JOIN bank_accounts b ON b.campaign_id=c.id`;
const allowedPhone=z.object({phone:z.string().max(30)});
const parseId=value=>positive(value);
const publicDir=fileURLToPath(new URL('./public',import.meta.url));
const fallbackHash=passwordHash('invalid-account-placeholder');

function parseTransaction(body){
  const input=z.object({phone:reqText(30),date:reqText(40),amount:reqText(30),count:reqText(10),numbers:trimmed(30000),bank:trimmed(100),memo:trimmed(500)}).parse(body);
  const phone=phoneNumber(input.phone),date=dateValue(input.date),amount=positive(input.amount),count=positive(input.count,5000),tickets=ticketNumbers(input.numbers);
  if(!phone||!date||!amount||!count||tickets.length&&tickets.length!==count) throw new Error('Гүйлгээний мэдээллийг шалгана уу');
  return {phone,date,amount,count,tickets,bank:input.bank,memo:input.memo};
}

export function createApp(db=pool, env=process.env) {
  const app=express();
  const origin=new URL(env.PUBLIC_ORIGIN||'http://localhost:3000').origin;
  const secure=new URL(origin).protocol==='https:';
  const production=env.NODE_ENV==='production';
  if(production && (!secure || !env.PUBLIC_ORIGIN || !env.DATABASE_URL)) throw new Error('Production requires HTTPS PUBLIC_ORIGIN and DATABASE_URL');
  if(env.TRUST_PROXY_HOPS) app.set('trust proxy',Number(env.TRUST_PROXY_HOPS));
  const cookieName=secure?'__Host-hurd':'hurd';
  const cookie={httpOnly:true,secure,sameSite:'strict',path:'/'};
  const limiter=(limit,windowMs)=>rateLimit({limit,windowMs,standardHeaders:'draft-8',legacyHeaders:false,
    handler:(_req,res)=>invalid(res,429,'Түр хүлээгээд дахин оролдоно уу')});
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:20,fieldSize:7000}});
  const signing=(key,value)=>createHmac('sha256',key).update(value).digest('hex');
  app.disable('x-powered-by');
  app.use(helmet({contentSecurityPolicy:{directives:{imgSrc:["'self'",'https:'],upgradeInsecureRequests:secure?[]:null}},
    strictTransportSecurity:secure?undefined:false,referrerPolicy:{policy:'same-origin'}}));
  app.use(express.static(publicDir,{maxAge:'1h',index:false}));
  app.use(['/admin','/lookup'],(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.use((req,res,next)=>{
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('origin')!==origin)
      return invalid(res,403,'Хүсэлтийн эх үүсвэр зөвшөөрөгдөөгүй');
    next();
  });
  app.use(express.json({limit:'32kb'}));
  app.use(express.urlencoded({extended:false,limit:'32kb'}));

  const setting=async key=>(await one(db,'SELECT value FROM site_settings WHERE key=$1',[key]))?.value||'';
  const renderPublic=async (res,campaign=null)=>{
    const campaigns=(await db.query(statSql+` WHERE ${active} ORDER BY c.id DESC`)).rows;
    res.send(views.home({campaigns,campaign,origin,facebook:await setting('facebook')}));
  };
  app.get('/',(_req,res)=>renderPublic(res));
  app.get('/campaign/:slug',async(req,res)=>{
    const campaign=await one(db,statSql+` WHERE ${active} AND c.slug=$1`,[req.params.slug]);
    if(!campaign) return res.status(404).send(views.message('Сугалаа олдсонгүй'));
    await renderPublic(res,campaign);
  });
  app.get('/media/:id',async(req,res)=>{
    if(!/^[a-f0-9]{64}$/.test(req.params.id)) return res.sendStatus(404);
    const image=await one(db,'SELECT * FROM images WHERE id=$1',[req.params.id]);
    if(!image) return res.sendStatus(404);
    res.set('Cache-Control','public, max-age=31536000, immutable').type(image.mime).send(image.bytes);
  });

  app.post('/lookup',limiter(20,10*60000),async(req,res)=>{
    const parsed=allowedPhone.safeParse(req.body);
    const phone=parsed.success?phoneNumber(parsed.data.phone):'';
    if(!phone) return invalid(res,400,'Утасны 8 оронтой дугаараа шалгана уу.');
    const result=await one(db,`SELECT count(*)::int count FROM lottery_tickets l
      JOIN transactions t ON t.id=l.transaction_id
      JOIN participants p ON p.id=t.participant_id
      JOIN campaigns c ON c.id=l.campaign_id
      WHERE p.phone=$1 AND t.status='confirmed' AND c.public AND NOT c.archived`,[phone]);
    res.json({count:result.count});
  });

  app.get('/admin/login',(_req,res)=>res.send(views.login()));
  app.post('/admin/login',limiter(8,15*60000),async(req,res)=>{
    const input=z.object({username:reqText(64),password:z.string().min(1).max(160)}).parse(req.body);
    const admin=await one(db,'SELECT * FROM admins WHERE username=$1',[input.username]);
    const stored=admin?.password||fallbackHash;
    if(!equal(stored,passwordHash(input.password,stored.split(':')[0])) || !admin)
      return res.status(401).send(views.login('Нэвтрэх нэр эсвэл нууц үг буруу'));
    const session=token();
    await atomic(async tx=>{
      await tx.query("DELETE FROM sessions WHERE admin_id=$1 AND expires<=now()",[admin.id]);
      await tx.query("INSERT INTO sessions VALUES ($1,$2,now()+interval '8 hours')",[hash(session),admin.id]);
      await audit(tx,admin.id,'admin.login',admin.id);
    },db);
    res.cookie(cookieName,session,{...cookie,maxAge:8*3600000}).redirect(303,'/admin');
  });
  app.use('/admin',async(req,res,next)=>{
    const raw=req.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))?.split('=')[1];
    if(raw && /^[a-f0-9]{64}$/.test(raw)) {
      req.session=hash(raw);
      req.admin=await one(db,'SELECT a.id,a.role FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token=$1 AND s.expires>now()',[req.session]);
    }
    if(!req.admin) return req.method==='GET'?res.redirect('/admin/login'):invalid(res,401,'Админаар нэвтэрнэ үү');
    next();
  });
  const owner=(req,res,next)=>req.admin.role==='owner'?next():invalid(res,403,'Эрх хүрэлцэхгүй');
  app.post('/admin/logout',async(req,res)=>{
    await db.query('DELETE FROM sessions WHERE token=$1',[req.session]);
    res.clearCookie(cookieName,cookie).redirect(303,'/admin/login');
  });
  app.post('/admin/password',limiter(8,15*60000),async(req,res)=>{
    const input=z.object({current:z.string().max(160),password:z.string().min(14).max(160)}).parse(req.body);
    const changed=await atomic(async tx=>{
      const admin=await one(tx,'SELECT password FROM admins WHERE id=$1 FOR UPDATE',[req.admin.id]);
      if(!equal(admin.password,passwordHash(input.current,admin.password.split(':')[0]))) return false;
      await tx.query('UPDATE admins SET password=$1 WHERE id=$2',[passwordHash(input.password),req.admin.id]);
      await tx.query('DELETE FROM sessions WHERE admin_id=$1',[req.admin.id]);
      await audit(tx,req.admin.id,'admin.password',req.admin.id);
      return true;
    },db);
    if(!changed) return res.status(400).send(views.message('Одоогийн нууц үг буруу','/admin'));
    res.clearCookie(cookieName,cookie).redirect(303,'/admin/login');
  });
  app.get('/admin',async(req,res)=>{
    const [campaigns,stats,logs,imports,facebook]=await Promise.all([
      db.query(statSql+' WHERE NOT c.archived ORDER BY c.id DESC'),
      one(db,`SELECT count(*) transactions,count(*) FILTER (WHERE status='confirmed') confirmed,
       count(*) FILTER(WHERE status='pending') pending,count(DISTINCT participant_id) FILTER(WHERE status='confirmed') participants,
       coalesce(sum(amount) FILTER(WHERE status='confirmed'),0) revenue,(SELECT count(*) FROM lottery_tickets) sold,
       (SELECT count(*) FROM campaigns c WHERE ${active}) active FROM transactions`),
      db.query('SELECT action,target,created_at FROM audit_logs ORDER BY id DESC LIMIT 15'),
      db.query('SELECT i.*,c.title FROM imports i JOIN campaigns c ON c.id=i.campaign_id ORDER BY i.id DESC LIMIT 25'),
      setting('facebook')
    ]);
    res.send(views.admin(campaigns.rows,stats,logs.rows,imports.rows,facebook,req.admin.role==='owner'));
  });
  app.get('/admin/campaigns/new',owner,(_req,res)=>res.send(views.campaignForm({})));
  app.get('/admin/campaigns/:id',owner,async(req,res)=>{
    const campaign=await one(db,statSql+' WHERE c.id=$1 AND NOT c.archived',[parseId(req.params.id)]);
    if(!campaign) return res.status(404).send(views.message('Сугалаа олдсонгүй','/admin'));
    res.send(views.campaignForm(campaign));
  });
  app.post('/admin/campaigns',owner,limiter(30,60000),upload.fields([{name:'photo',maxCount:1}]),async(req,res)=>{
    const input=campaignInput.parse(req.body);
    const id=parseId(req.body.id);
    const starts=input.starts?dateValue(input.starts):null, ends=input.ends?dateValue(input.ends):null;
    if(input.starts&&!starts || input.ends&&!ends || starts&&ends&&starts>=ends) throw new Error('Сугалааны хугацааг шалгана уу');
    if((input.account||input.iban||input.provider) && !(input.bank&&input.holder&&input.account)) throw new Error('Банк, данс эзэмшигч болон дансны дугаарыг бөглөнө үү');
    let bytes;
    if(req.files?.photo?.[0]){
      const photo=sharp(req.files.photo[0].buffer,{limitInputPixels:20000000});
      if(!['jpeg','png','webp'].includes((await photo.metadata()).format)) throw new Error('Зургийг JPG, PNG эсвэл WebP хэлбэрээр оруулна уу');
      bytes=await photo.rotate().resize({width:1600,withoutEnlargement:true}).webp({quality:85}).toBuffer();
    }
    await atomic(async tx=>{
      let image=input.image||null;
      if(bytes){
        const mediaId=hash(bytes);
        await tx.query('INSERT INTO images VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[mediaId,'image/webp',bytes]);
        image='/media/'+mediaId;
      }
      const values=[input.slug,input.title,input.description,image,input.total,input.price,input.active==='on',input.public==='on',starts,ends,input.participantGoal];
      let campaignId=id;
      if(id) {
        await lockCampaign(tx,id);
        const max=await one(tx,'SELECT max(number) n FROM lottery_tickets WHERE campaign_id=$1',[id]);
        if(max.n>input.total) throw new Error('Нийт эрх нь баталгаажсан эрхийн дугаараас бага байна');
        await tx.query('UPDATE campaigns SET (slug,title,description,image,total,price,active,public,starts,ends,participant_goal)=($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) WHERE id=$12',[...values,id]);
      } else {
        campaignId=(await one(tx,'INSERT INTO campaigns(slug,title,description,image,total,price,active,public,starts,ends,participant_goal) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',values)).id;
        await tx.query('INSERT INTO campaign_settings(campaign_id) VALUES ($1)',[campaignId]);
      }
      if(input.account) await tx.query(`INSERT INTO bank_accounts VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(campaign_id) DO UPDATE SET (bank,holder,account,iban,logo,provider)=(excluded.bank,excluded.holder,excluded.account,excluded.iban,excluded.logo,excluded.provider)`,
        [campaignId,input.bank,input.holder,input.account,input.iban,input.logo||null,input.provider||null]);
      else await tx.query('DELETE FROM bank_accounts WHERE campaign_id=$1',[campaignId]);
      await audit(tx,req.admin.id,id?'campaign.updated':'campaign.created',campaignId);
    },db);
    res.redirect(303,'/admin');
  });
  app.post('/admin/campaigns/:id/delete',owner,async(req,res)=>{
    await atomic(async tx=>{
      const {id}=await lockCampaign(tx,parseId(req.params.id));
      await tx.query('UPDATE campaigns SET archived=true,active=false,public=false WHERE id=$1',[id]);
      await audit(tx,req.admin.id,'campaign.archived',id);
    },db);
    res.redirect(303,'/admin');
  });
  app.post('/admin/site',owner,async(req,res)=>{
    const url=safeUrl.parse(req.body.facebook);
    if(url&&!['www.facebook.com','facebook.com','m.facebook.com','fb.com','fb.me','m.me'].includes(new URL(url).hostname)) throw new Error('Facebook холбоос оруулна уу');
    await atomic(async tx=>{
      await tx.query("INSERT INTO site_settings VALUES ('facebook',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[url]);
      await audit(tx,req.admin.id,'site.updated','facebook');
    },db);
    res.redirect(303,'/admin');
  });

  app.post('/admin/import/:mode',limiter(40,60000),upload.single('file'),async(req,res)=>{
    try {
      const book=workbook(req.file);
      if(req.params.mode==='inspect') {
        const sheet=req.body.sheet||book.SheetNames[0];
        const rows=sheetRows(book,sheet);
        return res.json({sheets:book.SheetNames,sheet,columns:rows[0]?.length||0,rows:rows.slice(0,12).map(row=>row.map(value=>String(value).slice(0,160)))});
      }
      const mode=z.enum(['preview','commit']).parse(req.params.mode);
      const campaignId=parseId(req.body.campaign);
      const result=await atomic(async tx=>{
        const campaign=await lockCampaign(tx,campaignId);
        const bank=await one(tx,'SELECT bank FROM bank_accounts WHERE campaign_id=$1',[campaign.id]);
        const rows=mapRows(sheetRows(book,req.body.sheet),{...req.body,bank:bank?.bank},campaign.price);
        if(!rows.length) throw new Error('Импортлох мөр алга');
        const digest=signing(req.session,JSON.stringify([hash(req.file.buffer),req.body.sheet,req.body.header,req.body.start,req.body.phone,req.body.date,req.body.amount,req.body.count,req.body.tickets,req.body.grouped,req.body.mode,campaignId,campaign.price,campaign.total]));
        const preview=await processImport(tx,campaign,rows,req.admin.id,false);
        const fingerprint=signing(digest,JSON.stringify(preview));
        if(mode==='preview') return {...preview,fingerprint};
        if(!equal(fingerprint,String(req.body.fingerprint||''))) throw new Error('Урьдчилсан шалгалтыг дахин хийнэ үү. Өгөгдөл өөрчлөгдсөн байна.');
        if(!preview.summary.valid) throw new Error('Импортлох зөв мөр алга');
        return processImport(tx,campaign,rows,req.admin.id,true);
      },db);
      res.json(result);
    } catch(error) {
      if(error.code) throw error;
      invalid(res,400,error.message);
    }
  });
  app.get('/admin/imports/:id',async(req,res)=>{
    const id=parseId(req.params.id);
    const batch=await one(db,'SELECT i.*,c.title FROM imports i JOIN campaigns c ON c.id=i.campaign_id WHERE i.id=$1',[id]);
    if(!batch) return res.status(404).send(views.message('Импорт олдсонгүй','/admin#import'));
    const page=Math.min(100,parseId(req.query.page)||1);
    const {rows}=await db.query('SELECT row_no,result,reason,transaction_id FROM import_rows WHERE import_id=$1 ORDER BY row_no LIMIT 101 OFFSET $2',[id,(page-1)*100]);
    res.send(views.importReport(batch,rows,page));
  });
  app.post('/admin/imports/:id/rollback',async(req,res)=>{
    await atomic(async tx=>{
      const batch=await one(tx,'SELECT * FROM imports WHERE id=$1 AND rolled_back_at IS NULL',[parseId(req.params.id)]);
      if(!batch) throw new Error('Импорт олдсонгүй эсвэл аль хэдийн буцаасан');
      await one(tx,'SELECT id FROM campaigns WHERE id=$1 FOR UPDATE',[batch.campaign_id]);
      const updated=await tx.query('UPDATE imports SET rolled_back_at=now() WHERE id=$1 AND rolled_back_at IS NULL',[batch.id]);
      if(!updated.rowCount) throw new Error('Импортыг аль хэдийн буцаасан');
      await tx.query('DELETE FROM lottery_tickets WHERE transaction_id IN (SELECT id FROM transactions WHERE import_id=$1)',[batch.id]);
      await tx.query("UPDATE transactions SET status='reversed' WHERE import_id=$1",[batch.id]);
      await audit(tx,req.admin.id,'import.rolled_back',batch.id);
    },db);
    res.redirect(303,'/admin#import');
  });
  app.get('/admin/transactions',async(req,res)=>{
    const term=String(req.query.q||'').slice(0,100);
    const page=Math.max(1,parseId(req.query.page)||1);
    const {rows}=await db.query(`SELECT t.*,p.phone,c.title,ARRAY(SELECT number FROM lottery_tickets WHERE transaction_id=t.id ORDER BY number) tickets
      FROM transactions t JOIN participants p ON p.id=t.participant_id JOIN campaigns c ON c.id=t.campaign_id
      WHERE $1='' OR strpos(p.phone,$1)>0 OR strpos(lower(t.memo),lower($1))>0 OR t.id::text=$1
      ORDER BY t.id DESC LIMIT 51 OFFSET $2`,[term,(page-1)*50]);
    res.send(views.transactions(rows,term,page));
  });
  app.get('/admin/transactions/new',async(_req,res)=>{
    const campaigns=(await db.query('SELECT id,title FROM campaigns WHERE NOT archived ORDER BY id DESC')).rows;
    res.send(views.transactionForm({tickets:[],requested:[],status:'pending'},campaigns));
  });
  app.post('/admin/transactions/new',async(req,res)=>{
    const entry=parseTransaction(req.body);
    await atomic(async tx=>{
      const campaign=await lockCampaign(tx,parseId(req.body.campaign));
      const id=await addTransaction(tx,campaign,entry,'pending');
      await audit(tx,req.admin.id,'transaction.created',id);
    },db);
    res.redirect(303,'/admin/transactions');
  });
  app.get('/admin/transactions/:id',async(req,res)=>{
    const transaction=await one(db,`SELECT t.*,p.phone,
      ARRAY(SELECT number FROM lottery_tickets WHERE transaction_id=t.id ORDER BY number) tickets
      FROM transactions t JOIN participants p ON p.id=t.participant_id WHERE t.id=$1`,[parseId(req.params.id)]);
    if(!transaction) return res.status(404).send(views.message('Гүйлгээ олдсонгүй','/admin/transactions'));
    const campaigns=(await db.query('SELECT id,title FROM campaigns WHERE NOT archived ORDER BY id DESC')).rows;
    res.send(views.transactionForm(transaction,campaigns));
  });
  app.post('/admin/transactions/:id',async(req,res)=>{
    const id=parseId(req.params.id);
    const action=z.enum(['save','confirm','reverse']).parse(req.body.action);
    await atomic(async tx=>{
      const original=await one(tx,'SELECT campaign_id FROM transactions WHERE id=$1',[id]);
      if(!original) throw new Error('Гүйлгээ олдсонгүй');
      const nextId=action==='save'?parseId(req.body.campaign):original.campaign_id;
      const campaignIds=[...new Set([original.campaign_id,nextId])].sort((a,b)=>a-b);
      await tx.query('SELECT id FROM campaigns WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE',[campaignIds]);
      const row=await one(tx,'SELECT * FROM transactions WHERE id=$1 FOR UPDATE',[id]);
      if(row.campaign_id!==original.campaign_id) throw new Error('Гүйлгээ өөрчлөгдсөн. Хуудсаа шинэчилнэ үү');
      if(action==='reverse') {
        await tx.query('DELETE FROM lottery_tickets WHERE transaction_id=$1',[id]);
        await tx.query("UPDATE transactions SET status='reversed' WHERE id=$1",[id]);
      }
      if(action==='confirm' && row.status!=='confirmed'){
        const campaign=await lockCampaign(tx,row.campaign_id);
        await allocate(tx,campaign,id,row.requested,row.count);
        await tx.query("UPDATE transactions SET status='confirmed' WHERE id=$1",[id]);
      }
      if(action==='save'){
        const {phone,date,amount,count,tickets,bank,memo}=parseTransaction(req.body);
        const campaign=await lockCampaign(tx,nextId);
        const participant=await one(tx,'INSERT INTO participants(phone) VALUES ($1) ON CONFLICT(phone) DO UPDATE SET phone=excluded.phone RETURNING id',[phone]);
        await tx.query('DELETE FROM lottery_tickets WHERE transaction_id=$1',[id]);
        if(row.status==='confirmed') await allocate(tx,campaign,id,tickets,count);
        await tx.query(`UPDATE transactions SET (campaign_id,participant_id,occurred_at,amount,bank,memo,count,requested)=($1,$2,$3,$4,$5,$6,$7,$8) WHERE id=$9`,
          [nextId,participant.id,date,amount,bank,memo,count,tickets,id]);
      }
      await audit(tx,req.admin.id,'transaction.'+action,id);
    },db);
    res.redirect(303,'/admin/transactions');
  });

  app.use((req,res)=>res.status(404).send(views.message('Хуудас олдсонгүй')));
  app.use((error,req,res,_next)=>{
    const translated=error instanceof z.ZodError?'Оруулсан мэдээллийн форматыг шалгана уу':
      error instanceof multer.MulterError?'Файлын хэмжээ эсвэл талбар тохирохгүй':
      error.code==='23505'?'Ийм бүртгэл өмнө нь үүссэн байна':
      error.status===400?'Хүсэлтийн формат буруу':
      error.status===413?'Хүсэлт хэт том байна':
      !error.code && /[\u0400-\u04ff]/.test(error.message||'') ? error.message : null;
    if(!translated) console.error('Application request failed',error.code||error.name);
    const message=translated||'Системийн алдаа гарлаа. Дахин оролдоно уу.';
    const status=translated?400:500;
    if(req.path==='/lookup'||req.path.startsWith('/admin/import/')) return invalid(res,status,message);
    res.status(status).send(views.message(message,req.path.startsWith('/admin')?'/admin':'/'));
  });
  return app;
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  createApp().listen(Number(process.env.PORT||3000),'0.0.0.0');
}
