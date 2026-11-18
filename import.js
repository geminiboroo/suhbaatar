import xlsx from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import Zip from 'adm-zip';
import {hash,one,audit,addTransaction} from './db.js';

xlsx.set_cptable(cptable);

export function phoneNumber(value) {
  const compact=String(value??'').trim().replace(/[\s()-]/g,'');
  const match=compact.match(/^(?:\+?976)?([1-9]\d{7})$/);
  return match?.[1] || '';
}
export function phoneFromMemo(value) {
  const direct=phoneNumber(value);
  if (direct) return direct;
  const candidates=new Set([...(String(value??'').matchAll(/(?<!\d)(?:\+?976[ -]?)?[1-9]\d{3}[ -]?\d{4}(?!\d)/g))].map(m=>phoneNumber(m[0])).filter(Boolean));
  return candidates.size===1 ? [...candidates][0] : '';
}
export function dateValue(value) {
  let normalized=value;
  if(typeof value==='number') {
    const parsed=xlsx.SSF.parse_date_code(value);
    if(!parsed || parsed.y<1990 || parsed.y>2100) return null;
    const pad=n=>String(n).padStart(2,'0');
    normalized=`${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}T${pad(parsed.H)}:${pad(parsed.M)}:${pad(parsed.S)}+08:00`;
  }
  if(typeof normalized==='string') {
    const input=normalized.trim();
    const m=input.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d\d:\d\d(?::\d\d)?)(Z|[+-]\d\d:\d\d)?)?$/);
    if(!m) return null;
    const [,year,month,day,time,offset]=m;
    if(Number(month)<1 || Number(month)>12 || Number(day)<1 || Number(day)>new Date(Date.UTC(Number(year),Number(month),0)).getUTCDate()) return null;
    normalized=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}T${time||'00:00:00'}${offset||'+08:00'}`;
  }
  const date=normalized instanceof Date ? normalized : new Date(normalized);
  return normalized!=null && Number.isFinite(+date) && date.getUTCFullYear()>=1990 && date.getUTCFullYear()<=2100 ? date.toISOString() : null;
}
export function positive(value,max=2147483647) {
  const s=String(value??'').trim().replace(/[\s₮]/g,'').replace(/,(?=\d{3}(?:,|\.|$))/g,'');
  const n=/^\d+(?:\.0+)?$/.test(s)?Number(s):0;
  return Number.isInteger(n)&&n>0&&n<=max ? n : 0;
}
export function ticketNumbers(value) {
  if (!String(value??'').trim()) return [];
  const all=String(value).trim().split(/[\s,;]+/).map(v=>positive(v,1000000));
  if(all.includes(0)||new Set(all).size!==all.length||all.length>5000) throw new Error('Эрхийн дугаар буруу эсвэл давхардсан');
  return all;
}
export function workbook(file) {
  if (!file?.buffer?.length) throw new Error('Excel эсвэл CSV файл сонгоно уу');
  const ext=file.originalname.toLowerCase().split('.').at(-1);
  const bytes=file.buffer;
  if (!['xlsx','xls','csv'].includes(ext)) throw new Error('Файлын төрөл дэмжигдэхгүй');
  if(ext==='xlsx'){
    if(bytes.readUInt32LE(0)!==0x04034b50) throw new Error('XLSX файлын бүтэц буруу');
    const entries=new Zip(bytes).getEntries();
    if(entries.length>500 || entries.reduce((sum,e)=>sum+e.header.size,0)>32000000 || !entries.some(e=>e.entryName==='xl/workbook.xml')) throw new Error('Excel файлын бүтэц эсвэл хэмжээ тохирохгүй');
  }
  if(ext==='xls' && bytes.subarray(0,8).toString('hex')!=='d0cf11e0a1b11ae1') throw new Error('XLS файлын бүтэц буруу');
  if(ext==='csv'){
    if(bytes.includes(0)) throw new Error('CSV-г UTF-8 хэлбэрээр хадгална уу');
    new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  return xlsx.read(bytes,{type:'buffer',raw:ext==='csv',codepage:65001,sheetRows:10002,cellFormula:true});
}
export function sheetRows(book,name) {
  const sheet=Object.hasOwn(book.Sheets,name)?book.Sheets[name]:null;
  if(!sheet) throw new Error('Хуудас олдсонгүй');
  if(!sheet['!ref']) return [];
  const range=xlsx.utils.decode_range(sheet['!ref']);
  if(range.e.r>=10000 || range.e.c>=80) throw new Error('Нэг хуудсанд 10,000 мөр, 80 багана хүртэл оруулна');
  return Array.from({length:range.e.r+1},(_,r)=>Array.from({length:range.e.c+1},(_,c)=>{
    const cell=sheet[xlsx.utils.encode_cell({r,c})];
    return cell?.f || cell?.F || cell?.t==='e' ? '#INVALID_CELL' : cell?.v??'';
  }));
}
export function mapRows(rows,settings,price) {
  const {phone,date,amount,count,tickets}=settings;
  const start=positive(settings.start,10000), grouped=settings.grouped==='true';
  const header=Number(settings.header||0);
  if(!Number.isInteger(header)||header<0||header>=start) throw new Error('Толгойн мөр эхлэх мөрөөс өмнө байх ёстой');
  if(settings.mode==='tickets'){
    const columns=[phone,tickets];
    if(!start || !columns.every(c=>/^\d{1,2}$/.test(c||'')&&Number(c)<80) || phone===tickets) throw new Error('Утас болон эрхийн дугаарын багануудыг сонгоно уу');
    return rows.flatMap((row,index)=>{
      if(index+1<start || !row.some(v=>String(v).trim())) return [];
      const item={row:index+1,phone:phoneFromMemo(row[phone]),date:null,amount:null,tickets:[]};
      try {
        if(!item.phone) throw new Error('Утасны нэг тодорхой дугаар олдсонгүй');
        item.tickets=ticketNumbers(row[tickets]);
        if(!item.tickets.length) throw new Error('Эрхийн дугаар оруулаагүй байна');
        item.count=item.tickets.length;
        item.key=hash(JSON.stringify([item.phone,[...item.tickets].sort((a,b)=>a-b)]));
      } catch(error) { item.error=error.message; }
      return [item];
    });
  }
  if(!start || ![phone,date,amount].every(c=>/^\d{1,2}$/.test(c||'')&&Number(c)<80) || grouped&&!/^\d{1,2}$/.test(tickets||'')) throw new Error('Мөр болон баганын тохиргоог шалгана уу');
  const output=[];
  let group=null;
  for(const [index,row] of rows.entries()){
    if(index+1<start || !row.some(v=>String(v).trim())) continue;
    const item={bank:settings.bank||'',row:index+1,phone:phoneFromMemo(row[phone]),date:dateValue(row[date]),amount:positive(row[amount]),memo:String(row[phone]??'').slice(0,500),tickets:[]};
    try {
      if([phone,date,amount,count,tickets].some(c=>c!=='' && row[c]==='#INVALID_CELL')) throw new Error('Томьёо эсвэл алдаатай нүд байна');
      item.tickets=ticketNumbers(row[tickets]);
      if(grouped && !String(row[date]??'').trim() && !String(row[amount]??'').trim()) {
        if(!group || !item.tickets.length || !item.phone || item.phone!==group.phone) throw new Error('Эрхийн үргэлжлэлд баталгаатай утас эсвэл төлбөрийн мөр алга');
        group.tickets.push(...item.tickets);
        group.members.push(item);
        item.parent=group;
      } else {
        group=null;
        if(!item.phone || !item.date || !item.amount) throw new Error('Утас, огноо эсвэл дүнг таньсангүй');
        item.members=[];
        const inferred=item.amount%price===0?item.amount/price:0;
        item.expected=count!==''&&String(row[count]??'').trim()?positive(row[count],5000):inferred;
        if(grouped) group=item;
      }
    } catch(error) { item.error=error.message; group=null; }
    output.push(item);
  }
  for(const item of output.filter(x=>!x.error&&!x.parent)) {
    item.count=item.expected;
    if(!item.count || item.count>5000 || item.tickets.length && (item.count!==item.tickets.length || new Set(item.tickets).size!==item.tickets.length)){
      item.error='Дүн, тохируулсан үнэ эсвэл эрхийн тоо, дугаар зөрсөн';
    }
    const numbers=[...item.tickets].sort((a,b)=>a-b);
    item.key=hash(JSON.stringify([item.phone,item.date,item.amount,numbers]));
  }
  return output;
}
export async function processImport(db,campaign,rows,admin,persist) {
  const existing = await db.query("SELECT dedupe FROM transactions WHERE campaign_id=$1 AND status<>'reversed' AND dedupe IS NOT NULL",[campaign.id]);
  const keys=new Set(existing.rows.map(r=>r.dedupe));
  const ticketRows=await db.query('SELECT number FROM lottery_tickets WHERE campaign_id=$1',[campaign.id]);
  const used=new Set(ticketRows.rows.map(r=>r.number));
  const summary={rows:rows.length,valid:0,invalid:0,duplicate:0,tickets:0};
  const batch=persist?await one(db,'INSERT INTO imports(campaign_id,admin_id) VALUES ($1,$2) RETURNING id',[campaign.id,admin]):null;
  const report=[];
  for(const item of rows){
    if(item.parent) {
      item.status=item.parent.status;
      item.reason=item.parent.reason;
      item.transaction=item.parent.transaction;
    } else if(item.error) {
      item.status='invalid'; item.reason=item.error;
    } else if(keys.has(item.key) || item.tickets.some(n=>used.has(n))) {
      item.status='duplicate'; item.reason='Гүйлгээ эсвэл эрхийн дугаар давхардсан';
    } else if(used.size+item.count>campaign.total || item.tickets.some(n=>n>campaign.total)) {
      item.status='invalid'; item.reason='Эрхийн багтаамж эсвэл дугаарын хязгаар зөрсөн';
    } else {
      item.status='valid'; keys.add(item.key);
      if(persist) item.transaction=await addTransaction(db,campaign,item,'confirmed',batch.id);
      if(item.tickets.length) item.tickets.forEach(n=>used.add(n));
      else for(let n=1,added=0;added<item.count;n++) if(!used.has(n)){used.add(n);added++;}
      summary.tickets+=item.count;
    }
    summary[item.status]++;
    if(batch) await db.query('INSERT INTO import_rows VALUES ($1,$2,$3,$4,$5)',[batch.id,item.row,item.status,item.reason||null,item.transaction||null]);
    report.push({row:item.row,status:item.status,reason:item.reason,phone:item.phone?item.phone.slice(0,2)+'••••'+item.phone.slice(-2):'',count:item.parent?1:item.count});
  }
  if(batch){
    await db.query('UPDATE imports SET summary=$1 WHERE id=$2',[summary,batch.id]);
    await audit(db,admin,'import.completed',batch.id);
  }
  return {id:batch?.id,summary,report};
}
