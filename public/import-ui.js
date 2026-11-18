const form=document.getElementById('import-form');
if(form){
  const fields=form.elements,preview=document.getElementById('preview-import'),commit=document.getElementById('commit-import');
  const status=document.getElementById('import-status'),report=document.getElementById('import-report');
  let fingerprint='',rows=[],revision=0;
  const phonePattern=/(?:\+?976[ -]?)?[1-9]\d{3}[ -]?\d{4}/g;
  const phoneCount=value=>new Set((String(value??'').match(phonePattern)||[]).map(v=>v.replace(/\D/g,'').replace(/^976/,'')).filter(v=>/^[1-9]\d{7}$/.test(v))).size;
  const ticketValue=value=>{const t=String(value??'').trim();return !!t&&t.split(/[\s,;]+/).every(v=>/^\d+(?:\.0+)?$/.test(v)&&Number(v)>=1&&Number(v)<=1000000);};
  const cellText=cell=>!cell||cell.f||cell.F||cell.t==='e'?'':String(cell.w??cell.v??'').trim();
  function detectSheet(book,name){
    const sheet=book.Sheets[name];if(!sheet?.['!ref'])return null;
    const range=XLSX.utils.decode_range(sheet['!ref']);
    if(range.e.r>=10000||range.e.c>=80)throw new Error(name+': 10,000 мөр, 80 баганын хязгаар хэтэрсэн.');
    const matrix=[];
    for(let r=range.s.r;r<=range.e.r;r++){const line=[];for(let c=range.s.c;c<=range.e.c;c++)line.push(cellText(sheet[XLSX.utils.encode_cell({r,c})]));matrix.push(line);}
    const nonempty=matrix.filter(row=>row.some(Boolean));if(nonempty.length<2)return null;
    const width=range.e.c-range.s.c+1,columns=Array.from({length:width},(_,c)=>nonempty.map(row=>row[c]||'').filter(Boolean));
    const numericScores=columns.map(values=>values.filter(ticketValue).length);
    const phoneScores=columns.map(values=>values.reduce((n,v)=>n+phoneCount(v),0));
    const header=matrix[0]||[];
    let ticketCol=header.findIndex(v=>/эрхийн дугаар|тасалбар|ticket|сугалааны дугаар/i.test(v));
    let phoneCol=header.findIndex(v=>/утас|гүйлгээний утга|memo|phone|mobile/i.test(v));
    if(ticketCol<0){const sorted=numericScores.map((score,c)=>({c,score,unique:new Set(columns[c]).size})).sort((a,b)=>b.score-a.score||b.unique-a.unique);ticketCol=sorted[0]?.score>0?sorted[0].c:-1;}
    if(phoneCol<0){const sorted=phoneScores.map((score,c)=>({c,score})).filter(x=>x.c!==ticketCol).sort((a,b)=>b.score-a.score);phoneCol=sorted[0]?.score>0?sorted[0].c:-1;}
    if(ticketCol<0||phoneCol<0)return {name,count:0,reason:ticketCol<0?'Эрхийн дугаарын багана илрээгүй':'Утасны дугаарын багана илрээгүй'};
    const out=[];
    for(let i=0;i<matrix.length;i++){const row=matrix[i],ticket=String(row[ticketCol]||'').trim();if(!ticketValue(ticket))continue;
      const identity=row.filter((_,c)=>c!==ticketCol).filter(Boolean).join(' | ');if(phoneCount(identity))out.push({ticket,identity});}
    return {name,count:out.length,reason:out.length?'':'Шаардлага хангасан мөр олдсонгүй',rows:out,ticketCol,phoneCol};
  }
  async function inspectFile(file){
    if(!file||file.size>5*1024*1024||! /\.(xlsx|xls|csv)$/i.test(file.name))throw new Error('5 МБ хүртэлх XLSX, XLS эсвэл CSV файл оруулна уу.');
    const book=XLSX.read(await file.arrayBuffer(),{type:'array',raw:false,codepage:65001,cellFormula:true});
    const sheets=book.SheetNames.map(name=>detectSheet(book,name)).filter(Boolean),eligible=sheets.filter(s=>s.count>0);
    if(!eligible.length)throw new Error('Эрхийн дугаар болон утасны дугаар илэрсэн хуудас олдсонгүй.');
    const result=[];for(const sheet of eligible)for(const row of sheet.rows)result.push([result.length+1,row.identity,row.ticket,'','']);
    if(result.length>10000)throw new Error('Импортлох мөр 10,000-аас хэтэрсэн. Файлыг хэсэгчлэн оруулна уу.');
    return {rows:result,sheets,total:result.length};
  }
  async function request(mode){
    const res=await fetch('/admin/import/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaign:fields.campaign.value,rows,fingerprint:mode==='commit'?fingerprint:undefined})});
    const data=await res.json();if(!res.ok)throw new Error(data.error||'Импортын хүсэлт амжилтгүй.');return data;
  }
  const put=(tag,value,parent)=>{const n=document.createElement(tag);n.textContent=value;parent.append(n);return n;};
  function render(data,done){
    report.replaceChildren();const s=data.summary;
    put('p',(done?'Импортолсон':'Зөв гэж таньсан')+' мөр: '+s.valid+' · Алдаатай: '+s.invalid+' · Давхардсан эрх: '+s.duplicate+' · Шинэ эрх: '+s.tickets,report);
    const wrap=put('div','',report);wrap.className='table-scroll';const table=put('table','',wrap),head=put('tr','',table);
    ['Мөр','Утасны дугаар(ууд)','Эрхийн тоо','Төлөв / тайлбар'].forEach(v=>put('th',v,head));
    for(const item of data.report){const tr=put('tr','',table);[item.row,(item.phones||[item.phone]).filter(Boolean).join(', '),item.count??0,item.reason||(done?'Импортолсон':'Зөв')].forEach(v=>put('td',String(v??''),tr));}
  }
  async function inspect(){
    const version=++revision;fingerprint='';rows=[];commit.hidden=true;preview.disabled=true;report.replaceChildren();
    const file=fields.file.files[0];if(!file){status.textContent='';return;}
    status.textContent='Бүх Excel хуудсыг автоматаар уншиж байна…';
    try{const scan=await inspectFile(file);if(version!==revision)return;rows=scan.rows;
      const col=n=>{let x=n+1,label='';while(x){const r=(x-1)%26;label=String.fromCharCode(65+r)+label;x=Math.floor((x-1)/26);}return label;};\n      status.textContent='Нийт '+scan.total+' мөр танилаа. '+scan.sheets.map(s=>s.name+': '+(s.count?s.count+' мөр (эрх '+col(s.ticketCol)+', утас/гүйлгээ '+col(s.phoneCol)+')':'алгассан — '+s.reason)).join(' · ');
      preview.disabled=false;
    }catch(error){if(version===revision)status.textContent=error.message;}
  }
  async function run(mode){
    preview.disabled=true;commit.disabled=true;status.textContent=mode==='commit'?'D1-д хадгалж байна…':'Урьдчилсан шалгалт хийж байна…';
    try{const data=await request(mode);render(data,mode==='commit');fingerprint=data.fingerprint||'';commit.hidden=!fingerprint||!data.summary.valid;
      status.textContent=mode==='commit'?'Импорт амжилттай.':'Тайланг шалгаад “Импорт батлах” дарна уу.';
      if(mode==='commit'){const a=put('a','Импортын түүх',status);a.href='/admin?import='+data.id+'#import';}
    }catch(error){status.textContent=error.message;}
    finally{preview.disabled=!rows.length;commit.disabled=false;}
  }
  fields.file.addEventListener('change',inspect);
  fields.campaign.addEventListener('change',()=>{fingerprint='';commit.hidden=true;});
  form.addEventListener('submit',event=>{event.preventDefault();if(rows.length)run('preview');});
  commit.addEventListener('click',()=>run('commit'));
}