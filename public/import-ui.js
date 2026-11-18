const form=document.getElementById('import-form');
if(form){
  const fields=form.elements;
  const mapping=document.getElementById('mapping');
  const preview=document.getElementById('preview-import');
  const commit=document.getElementById('commit-import');
  const status=document.getElementById('import-status');
  const report=document.getElementById('import-report');
  const sample=document.getElementById('sample-data');
  const keys=['phone','tickets','date','amount'];
  let fingerprint='', inspected=null,revision=0,book=null,source=null;
  const edge=Boolean(window.XLSX);
  async function readLocal(payload){
    const file=fields.file.files[0];
    if(!file||file.size>5*1024*1024||!/\.(xlsx|xls|csv)$/i.test(file.name))throw new Error('5 МБ хүртэлх XLSX, XLS эсвэл CSV файл оруулна уу.');
    if(source!==file){
      const bytes=await file.arrayBuffer();
      book=window.XLSX.read(bytes,{type:'array',raw:/\.csv$/i.test(file.name),codepage:65001,sheetRows:10001,cellFormula:true});
      source=file;
    }
    const sheet=payload.get('sheet')||book.SheetNames[0];
    const table=book.Sheets[sheet];
    if(!table?.['!ref'])return {sheets:book.SheetNames,sheet,columns:0,rows:[]};
    const range=window.XLSX.utils.decode_range(table['!ref']);
    if(range.e.r>=10000||range.e.c>=80)throw new Error('Нэг хуудсанд 10,000 мөр, 80 багана хүртэл оруулна.');
    const cell=(r,c)=>{
      const value=table[window.XLSX.utils.encode_cell({r,c})];
      return value?.f||value?.F||value?.t==='e'?'#INVALID_CELL':String(value?.v??'');
    };
    return {sheets:book.SheetNames,sheet,columns:range.e.c+1,
      rows:Array.from({length:Math.min(12,range.e.r+1)},(_,r)=>Array.from({length:range.e.c+1},(_,c)=>cell(r,c).slice(0,160)))};
  }
  function selectedRows(){
    const dateCellValue=(table,row,column)=>{
      if(column==='')return '';
      const cell=table[window.XLSX.utils.encode_cell({r:row,c:Number(column)})];
      if(!cell)return '';
      if(cell.f||cell.F||cell.t==='e')return '#INVALID_CELL';
      const value=cell.v;
      if(typeof value==='number'&&Number.isFinite(value)&&value>=20000&&value<=80000){
        const date=new Date(Date.UTC(1899,11,30)+value*86400000);
        return date.toISOString();
      }
      return String(value??'');
    };
    const start=Number(fields.start?.value??1),header=Number(fields.header?.value??0);
    if(!Number.isInteger(start)||start<1||!Number.isInteger(header)||header<0||header>=start||!fields.phone?.value||
      !fields.tickets?.value||fields.phone.value===fields.tickets.value)throw new Error('Мөр, утас болон эрхийн баганыг шалгана уу.');
    const table=book?.Sheets[fields.sheet.value];
    if(!table?.['!ref'])return [];
    const range=window.XLSX.utils.decode_range(table['!ref']);
    const rows=[];
    for(let row=start-1;row<=range.e.r;row++){
      const read=column=>{
        const cell=table[window.XLSX.utils.encode_cell({r:row,c:Number(column)})];
        return cell?.f||cell?.F||cell?.t==='e'?'#INVALID_CELL':String(cell?.v??'');
      };
      const phone=read(fields.phone.value),tickets=read(fields.tickets.value);
      const dateValue=!fields.date?.value?'':dateCellValue(table,row,fields.date.value),amountValue=!fields.amount?.value?'':read(fields.amount.value);
      if(phone.trim()||tickets.trim()||dateValue.trim()||amountValue.trim()||Array.from({length:range.e.c+1},(_,col)=>read(col)).some(value=>value.trim()))rows.push([row+1,phone.length<=500?phone:'',tickets,dateValue,amountValue]);
    }
    return rows;
  }
  async function send(mode,payload=new FormData(form)){
    if(edge&&mode==='inspect')return readLocal(payload);
    if(mode==='commit') payload.set('fingerprint',fingerprint);
    const request=edge?{headers:{'Content-Type':'application/json'},body:JSON.stringify({
      campaign:fields.campaign.value,rows:selectedRows(),fingerprint
    })}:{body:payload};
    const res=await fetch('/admin/import/'+mode,{method:'POST',...request});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error);
    return data;
  }
  function clearPreview(){
    fingerprint='';
    commit.hidden=true;
    report.replaceChildren();
  }
  function letter(index){
    return index<26?String.fromCharCode(65+index):letter(Math.floor(index/26)-1)+letter(index%26);
  }
  const put=(tag,text,target)=>{
    const cell=document.createElement(tag);
    cell.textContent=text;
    target.append(cell);
    return cell;
  };
  function samples(){
    const table=put('table','',sample);
    const header=put('tr','',table);
    put('th','Мөр',header);
    for(let c=0;c<Math.min(12,inspected.columns);c++) put('th',letter(c),header);
    for(const [i,row] of inspected.rows.entries()){
      const tr=put('tr','',table);
      put('th',i+1,tr);
      for(const value of row.slice(0,12)) put('td',value,tr);
    }
  }
  function choices(reset){
    const heading=inspected.rows[Number(fields.header.value)-1]||[];
    const body=inspected.rows.slice(Math.max(0,Number(fields.start.value)-1));
    const patterns={phone:/утас|гүйлгээний утга|phone|mobile|харилцагч/i,date:/огноо|date|хугацаа|time/i,amount:/дүн|amount|орлого|төгрөг/i,tickets:/эрхийн дугаар|ticket|сугалааны дугаар|тасалбарын дугаар/i};
    const sampleValues=column=>body.map(row=>String(row[column]||'').trim()).filter(Boolean);
    const isPhone=value=>/(?:\+?976[ -]?)?[1-9]\d{3}[ -]?\d{4}/.test(value);
    const isDate=value=>{const n=Number(value);return n>=20000&&n<=80000||/^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(value)||/^\d{1,2}[-./]\d{1,2}[-./]\d{4}/.test(value);};
    const isTicket=value=>/^\d{1,7}(?:\.0+)?$/.test(value)&&Number(value)>=1&&Number(value)<=1000000;
    const isAmount=value=>/^\s*[\d, ]+(?:\.0+)?\s*₮?\s*$/.test(value)&&Number(value.replace(/[₮,\s]/g,''))>0;
    const phoneScores=Array.from({length:inspected.columns},(_,c)=>sampleValues(c).filter(isPhone).length);
    const dateScores=Array.from({length:inspected.columns},(_,c)=>sampleValues(c).filter(isDate).length);
    const ticketScores=Array.from({length:inspected.columns},(_,c)=>sampleValues(c).filter(isTicket).length);
    const amountScores=Array.from({length:inspected.columns},(_,c)=>sampleValues(c).filter(isAmount).length);
    const best=scores=>scores.reduce((best,value,index)=>value>scores[best]?index:best,0);
    const legacy=inspected.columns>=4 && phoneScores.some(n=>n>0)&&dateScores.some(n=>n>0)&&ticketScores.some(n=>n>0)&&amountScores.some(n=>n>0);
    const grouped=legacy || (inspected.columns>=4 && /тод\s+хүрэн\s+үрээ/i.test(inspected.rows[0]?.[0]||'') &&
      body.some(row=>row[0]&&row[1]&&row[2]&&row[3]));
    for(const name of keys){
      const select=fields[name];
      const old=select?.value??'';
      if(!select)continue;
      select.replaceChildren(new Option('Багана сонгох',''));
      for(let c=0;c<inspected.columns;c++) select.add(new Option(letter(c)+(heading[c]?' · '+heading[c]:''),c));
      const named=heading.findIndex(value=>patterns[name].test(value));
      let guessed=named;
      if(reset&&grouped){
        const detected={phone:best(phoneScores),date:best(dateScores),amount:best(amountScores),tickets:best(ticketScores)};
        const legacyLayout=phoneScores[3]>0&&dateScores[1]>0&&amountScores[2]>0&&ticketScores[0]>0;
        guessed=legacyLayout?({phone:3,date:1,amount:2,tickets:0})[name]:detected[name];
      }
      if(guessed<0 && ['phone','date','amount'].includes(name)){
        const used=new Set(keys.slice(0,keys.indexOf(name)).map(key=>fields[key]?.value??''));
        const match={
          phone:/^\s*(?:\+?976\s?)?[1-9]\d{3}[ -]?\d{4}\s*$/,
          date:/^(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|4\d{4}(?:\.\d+)?)$/,
          amount:/^\s*[\d, ]+(?:\.0+)?\s*₮?\s*$/
        }[name];
        const scores=Array.from({length:inspected.columns},(_,index)=>used.has(String(index))?0:body.filter(row=>match.test(row[index]||'')).length);
        if(Math.max(...scores)>0) guessed=scores.indexOf(Math.max(...scores));
      }
      select.value=reset||!old?(guessed>=0?String(guessed):''):old;
    }
  }
  async function inspect(keepSheet){
    const version=++revision;
    clearPreview();
    mapping.hidden=true;
    preview.disabled=true;
    sample.replaceChildren();
    if(!fields.file.files.length){status.textContent='';return;}
    status.textContent='Файлыг уншиж байна…';
    try{
      const payload=new FormData();
      payload.append('file',fields.file.files[0]);
      if(keepSheet) payload.append('sheet',fields.sheet.value);
      const data=await send('inspect',payload);
      if(version!==revision)return;
      inspected=data;
      fields.sheet.replaceChildren(...data.sheets.map(name=>new Option(name,name)));
      fields.sheet.value=data.sheet;
      const header=data.rows[0]||[];
      const likelyHeader=header.filter(v=>/утас|огноо|дүн|phone|date|amount/i.test(v)).length>=2;
      fields.header.value=likelyHeader?'1':'0';
      fields.start.value=likelyHeader||/тод\s+хүрэн\s+үрээ/i.test(header[0]||'')?'2':'1';
      choices(true);
      samples();
      mapping.hidden=false;
      preview.disabled=false;
      status.textContent=data.columns?'Багануудыг шалгаад урьдчилсан тайланг үзнэ үү.':'Энэ хуудас хоосон байна.';
    }catch(error){if(version===revision)status.textContent=error.message;}
  }
  fields.file.addEventListener('change',()=>inspect(false));
  fields.sheet.addEventListener('change',()=>inspect(true));
  fields.header.addEventListener('change',()=>{
    fields.start.value=Math.max(1,Number(fields.header.value)+1);
    if(inspected)choices(false);
  });
  form.addEventListener('change',clearPreview);
  function render(data,done){
    report.replaceChildren();
    const s=data.summary;
    put('p',(done?'Импортолсон':'Зөв')+' мөр '+s.valid+' · Алдаатай '+s.invalid+' · Давхардсан '+s.duplicate+' · Нийт мөр '+s.rows+' · Эрх '+s.tickets,report);
    const area=put('div','',report);
    area.className='table-scroll';
    const table=put('table','',area);
    const header=put('tr','',table);
    for(const label of ['Мөр','Утас','Эрх','Төлөв / тайлбар'])put('th',label,header);
    for(const item of data.report){
      const row=put('tr','',table);
      for(const value of [item.row,item.phone,item.count??'—',item.reason||(done?'Импортолсон':'Зөв')])put('td',value,row);
    }
  }
  async function run(mode){
    preview.disabled=true;
    commit.disabled=true;
    status.textContent=mode==='commit'?'Импорт хийж байна…':'Мөрүүдийг шалгаж байна…';
    try{
      const data=await send(mode);
      render(data,mode==='commit');
      fingerprint=data.fingerprint||'';
      commit.hidden=!fingerprint||!data.summary.valid;
      status.replaceChildren(document.createTextNode(mode==='commit'?'Импорт дууслаа. ':'Урьдчилсан шалгалт дууслаа.'));
      if(mode==='commit'){
        const history=put('a','Импортын түүхийг шинэчлэх',status);
        history.href='/admin?import='+data.id+'#import';
      }
    }catch(error){status.textContent=error.message;}
    finally{preview.disabled=false;commit.disabled=false;}
  }
  form.addEventListener('submit',event=>{event.preventDefault();if(!preview.disabled)run('preview');});
  commit.addEventListener('click',()=>run('commit'));
}
