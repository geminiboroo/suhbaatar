import {equals,sign,randomToken} from './crypto.js';

export function phoneNumber(value){
  return String(value??'').trim().replace(/[\s()-]/g,'').match(/^(?:\+?976)?([1-9]\d{7})$/)?.[1]||'';
}
export function phonesFromMemo(value){
  const direct=phoneNumber(value);
  if(direct) return [direct];
  return [...new Set(Array.from(String(value??'').matchAll(/(?<!\d)(?:\+?976[ -]?)?[1-9]\d{3}[ -]?\d{4}(?!\d)/g),m=>phoneNumber(m[0])).filter(Boolean))];
}
export function ticketNumbers(value){
  if(!String(value??'').trim()) return [];
  const fields=String(value).trim().split(/[\s,;]+/);
  if(fields.some(x=>!/^\d+(?:\.0+)?$/.test(x))) throw new Error('Эрхийн дугаарын формат буруу');
  const numbers=fields.map(Number);
  if(numbers.some(x=>!Number.isSafeInteger(x)||x<1||x>1000000)) throw new Error('Эрхийн дугаар 1–1,000,000 хооронд байх ёстой');
  return numbers;
}
export async function importTickets(db,body,admin,session,mode){
  const id=Number(body.campaign);
  if(!Number.isSafeInteger(id)||id<1||!Array.isArray(body.rows)||body.rows.length>10000) throw new Error('Файл эсвэл сугалааг шалгана уу');
  const [campaignRow,ticketRows]=await db.batch([
    db.prepare('SELECT id,total,revision FROM campaigns WHERE id=?1 AND NOT archived').bind(id),
    db.prepare('SELECT number FROM lottery_tickets WHERE campaign_id=?1').bind(id)
  ]);
  const campaign=campaignRow.results[0];
  if(!campaign) throw new Error('Сугалаа олдсонгүй');
  const used=new Set(ticketRows.results.map(r=>r.number));
  const summary={rows:0,valid:0,invalid:0,duplicate:0,tickets:0};
  const data=[];
  let previous=0;
  for(const input of body.rows){
    if(!Array.isArray(input)||(input.length!==3&&input.length!==5)) throw new Error('Файлын мөрийн бүтэц буруу');
    const [row,rawPhone,rawTickets,rawDate='',rawAmount='']=input;
    if(!Number.isInteger(row)||row<=previous||row>10000||typeof rawPhone!=='string'||rawPhone.length>500||typeof rawTickets!=='string'||rawTickets.length>30000||typeof rawDate!=='string'||rawDate.length>100||typeof rawAmount!=='string'||rawAmount.length>100) throw new Error('Файлын мөрийн бүтэц буруу');
    previous=row;
    const phones=Array.isArray(rawPhone)?[...new Set(rawPhone.map(phoneNumber).filter(Boolean))]:phonesFromMemo(rawPhone);
    let reason=null,status='valid',tickets=[],occurredAt=null,amount=null;
    try {
      if(!phones.length) throw new Error('Гүйлгээний утга эсвэл мөрийн бусад баганаас 8 оронтой утасны дугаар олдсонгүй');
      const requested=ticketNumbers(rawTickets);
      if(!requested.length) throw new Error('Эрхийн дугаар оруулаагүй байна');
      const unique=[...new Set(requested)];
      const skippedInRow=requested.length-unique.length;
      tickets=unique.filter(n=>!used.has(n));
      const skipped=skippedInRow+(unique.length-tickets.length);
      summary.duplicate+=skipped;
      if(!tickets.length){status='duplicate';reason='Бүх эрх өмнө бүртгэгдсэн тул алгаслаа';}
      else{
        for(const n of tickets)used.add(n);
        summary.tickets+=tickets.length;
        if(skipped)reason=skipped+' давхардсан дугаарыг тооцоогүй, '+tickets.length+' шинэ эрхийг нэмнэ';
      }
    } catch(error){status='invalid';reason=error.message;}
    summary.rows++;
    summary[status]++;
    data.push({row,phone:phones[0]||'',phones,tickets,status,reason,occurredAt,amount});
  }
  const fingerprint=await sign(session,JSON.stringify([id,campaign.revision,body.rows]));
  const report=data.map(({row,phone,phones,tickets,status,reason,occurredAt,amount})=>({row,phone,phones,count:tickets.length,tickets,occurredAt,amount,status,reason}));
  if(mode==='preview') return {summary,report,fingerprint};
  if(!equals(fingerprint,body.fingerprint)) throw new Error('Өгөгдөл өөрчлөгдсөн. Урьдчилж дахин шалгана уу');
  if(!summary.valid) throw new Error('Импортлох зөв мөр алга');
  const key=randomToken();
  const payload=JSON.stringify(data);
  if(new TextEncoder().encode(payload).length>1700000) throw new Error('Тайлан хэт том байна. Excel-ээ жижиг багцаар импортлоно уу');
  const stmt=(sql,...args)=>db.prepare(sql).bind(...args);
  const results=await db.batch([
    stmt(`INSERT INTO imports(campaign_id,admin_id,summary,commit_key)
       VALUES ((SELECT id FROM campaigns WHERE id=?1 AND revision=?2 AND NOT archived),?3,?4,?5) RETURNING id`,
       id,campaign.revision,admin,JSON.stringify(summary),key),
    stmt(`INSERT OR IGNORE INTO participants(phone)
       SELECT DISTINCT json_extract(value,'$.phone') FROM json_each(?1) WHERE json_extract(value,'$.status')='valid'`,payload),
    stmt(`INSERT INTO transactions(campaign_id,participant_id,import_id,source_row,occurred_at,amount,count,requested,status)
       SELECT ?1,p.id,i.id,json_extract(j.value,'$.row'),json_extract(j.value,'$.occurredAt'),json_extract(j.value,'$.amount'),json_array_length(j.value,'$.tickets'),json_extract(j.value,'$.tickets'),'confirmed'
       FROM json_each(?2) j JOIN participants p ON p.phone=json_extract(j.value,'$.phone')
       JOIN imports i ON i.commit_key=?3 WHERE json_extract(j.value,'$.status')='valid'`,id,payload,key),
    stmt(`INSERT OR IGNORE INTO participant_phones(phone,participant_id)
       SELECT phone.value,p.id FROM json_each(?1) j,json_each(j.value,'$.phones') phone
       JOIN participants p ON p.phone=json_extract(j.value,'$.phone')
       WHERE json_extract(j.value,'$.status')='valid'`,payload),
    stmt(`INSERT INTO lottery_tickets(campaign_id,transaction_id,number)
       SELECT ?1,t.id,n.value FROM transactions t JOIN imports i ON i.id=t.import_id JOIN json_each(t.requested) n WHERE i.commit_key=?2`,id,key),
    stmt(`INSERT INTO import_rows(import_id,row_no,result,reason,transaction_id)
       SELECT i.id,json_extract(j.value,'$.row'),json_extract(j.value,'$.status'),json_extract(j.value,'$.reason'),t.id
       FROM json_each(?1) j JOIN imports i ON i.commit_key=?2 LEFT JOIN transactions t ON t.import_id=i.id AND t.source_row=json_extract(j.value,'$.row')`,payload,key),
    stmt('UPDATE campaigns SET revision=revision+1 WHERE id=?1',id),
    stmt("INSERT INTO audit_logs(admin_id,action,target) SELECT ?1,'import.completed',id FROM imports WHERE commit_key=?2",admin,key)
  ]);
  return {id:results[0].results[0].id,summary,report};
}
