export const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const e=escape;
const fmt=n=>new Intl.NumberFormat('mn-MN').format(Number(n)||0);
const money=n=>fmt(n)+' ₮';
const date=n=>n?new Intl.DateTimeFormat('mn-MN',{timeZone:'Asia/Ulaanbaatar',dateStyle:'medium',timeStyle:'short'}).format(new Date(n)):'—';
const inputDate=n=>n?new Date(+new Date(n)+28800000).toISOString().slice(0,16):'';
function doc(title,body,{meta='',scripts='',className=''}={}){
  return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${e(title)}</title><link rel="stylesheet" href="/main.css">${meta}${scripts}</head><body class="${className}">${body}</body></html>`;
}
const brand=`<a class="brand" href="/"><span>СҮХБААТАРЫН</span><strong>ХУРД</strong></a>`;
const link=(url,name,classes='button')=>`<a class="${classes}" href="${e(url)}">${e(name)}</a>`;
const displayStats=c=>`<dl class="campaign-stats">${[['Оролцогч',c.participants],['Борлуулсан',c.sold],['Нийт эрх',c.total],['Үлдсэн',c.total-c.sold]].map(([k,v])=>`<div><dt>${k}</dt><dd>${fmt(v)}</dd></div>`).join('')}</dl>
  <div class="progress-label"><span>Борлуулалтын явц</span><strong>${Math.round(c.sold/c.total*100)}%</strong></div><progress value="${c.sold}" max="${c.total}" aria-label="Борлуулалтын явц"></progress>`;
const siteName='СҮХБААТАРЫН ХУРД — СУГАЛААТ ХУДАЛДАА';
const defaultCopy={heroTitle:'СҮХБААТАРЫН',heroBrand:'ХУРД',heroTagline:'СУГАЛААТ ХУДАЛДАА',heroIntro:'Сүхбаатар нутгийн хурдан хүлгийн сугалаануудтай танилцаж, бүртгүүлсэн эрхээ шалгаарай.',lookupTitle:'ЭРХ ШАЛГАХ',lookupHelp:'Бүртгүүлсэн утасны 8 оронтой дугаараа оруулна уу.',lookupButton:'ЭРХ ШАЛГАХ',phoneLabel:'Утасны дугаар',campaignHeading:'Идэвхтэй сугалаанууд',campaignIntro:'Сүхбаатарын хурдын нэрэмжит сугалаанууд',helpTitle:'Сугалааны эрхээ хэрхэн шалгах вэ?',helpText:'«ЭРХ ШАЛГАХ» хэсэгт сугалаанд бүртгүүлсэн утасны 8 оронтой дугаараа оруулаад «ЭРХ ШАЛГАХ» товчийг дарна.',shareLabel:'Facebook-д хуваалцах',contactLabel:'Холбоо барих',bankMemo:'УТАСНЫ ДУГААРАА БИЧНЭ ҮҮ!',bankNote:'Гүйлгээний утгад бүртгүүлэх утасны дугаараа заавал бичнэ үү.',priceLabel:'НЭГ ЭРХИЙН ҮНЭ',showPrice:true,showStats:true,showBank:true,showShare:true,showContact:true};
const copyOf=value=>({...defaultCopy,...(value||{})});
const publicBrand=`<a class="race-brand" href="/" aria-label="${siteName} · Нүүр хуудас"><img class="race-emblem" src="/horse-mark.webp" width="56" height="56" alt=""><span>СҮХБААТАРЫН<strong>ХУРД</strong></span></a>`;
function lookup(campaignId=null,copy=defaultCopy){return `<section class="lookup-card" id="lookup" aria-labelledby="lookup-title">
  <div class="lookup-content"><h2 id="lookup-title">${e(copy.lookupTitle)}</h2>
  <p>${e(copy.lookupHelp)}</p>
  <form id="lookup-form" class="lookup-form">${campaignId?'<input type="hidden" name="campaign" value="'+Number(campaignId)+'">':''}<label for="phone">${e(copy.phoneLabel)}</label>
  <div class="phone-field"><input id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="99112233" pattern="[0-9]{8}" maxlength="8" required></div>
  <button class="button gold" type="submit">${e(copy.lookupButton)}</button>
  <p id="lookup-status" role="status" hidden></p></form></div></section>`;}
function shareFacebook(url,classes='button facebook-button'){
  return `<a class="${classes}" href="https://www.facebook.com/sharer/sharer.php?u=${e(encodeURIComponent(url))}" target="_blank" rel="noopener noreferrer"><span class="facebook-mark" aria-hidden="true">f</span> Facebook-д хуваалцах</a>`;
}
function participantStats(c){
  const current=Number(c.participants)||0;
  const goal=Number(c.participant_goal)||0;
  return `<div class="participant-stats"><dl><div><dt>Одоо бүртгүүлсэн</dt><dd>${fmt(current)}</dd></div><div><dt>Зорилтот оролцогч</dt><dd>${goal?fmt(goal):'—'}</dd></div></dl>${goal?`<progress value="${Math.min(current,goal)}" max="${goal}" aria-label="Оролцогчдын зорилтын явц"></progress>`:''}</div>`;
}
export function home({campaigns,campaign,origin,facebook,copy:rawCopy}){
  const copy=copyOf(rawCopy);
  const canonical=origin+(campaign?'/campaign/'+campaign.slug:'/');
  const title=campaign?`${campaign.title} | ${siteName}`:siteName;
  const image=campaign?.image||'/hero.webp';
  const description=campaign?.description||'Сүхбаатарын хурдын сугалаануудтай танилцаж, бүртгэгдсэн эрхээ шалгаарай.';
  const meta=`<link rel="canonical" href="${e(canonical)}"><meta name="description" content="${e(description)}">${Object.entries({title,description:description.slice(0,300),image:new URL(image,origin).href,url:canonical,type:'website',locale:'mn_MN'}).map(([key,value])=>`<meta property="og:${key}" content="${e(value)}">`).join('')}`;
  const card=(c,index)=>`<article class="campaign-card">
    <img class="cover" src="${e(c.image||'/campaign-'+(index%3+1)+'.webp')}" alt="" loading="lazy">
    <div class="card-body">
    <h3><a href="/campaign/${e(c.slug)}">${e(c.title)}</a></h3><p class="description">${e(c.description)}</p>${copy.showPrice?`<p class="card-price">Нэг эрх: <strong>${money(c.price)}</strong></p>`:''}
    ${copy.showStats?displayStats(c):''}
    <div class="card-actions">${link('/campaign/'+c.slug,'Дэлгэрэнгүй →','button gold')}
    ${shareFacebook(origin+'/campaign/'+c.slug)}</div></div></article>`;
  const main=campaign?`<main id="content"><section class="wrap detail"><div>
    ${link('/#campaigns','← Бүх сугалаа','text-link')}<p class="eyebrow">ИДЭВХТЭЙ СУГАЛАА</p><h1>${e(campaign.title)}</h1>
    <p class="description">${e(campaign.description)}</p>${campaign.ends?'<p>'+date(campaign.ends)+' хүртэл</p>':''}
    ${copy.showPrice?`<p class="ticket-price">${e(copy.priceLabel)} <strong>${campaign.price?money(campaign.price):'Үнэ тохиролцоно'}</strong></p>`:''}
    ${copy.showStats?displayStats(campaign):''}
    ${copy.showShare?shareFacebook(canonical):''}
    </div><div><img class="detail-image" src="${e(image)}" alt="">
    ${copy.showBank&&campaign.bank?`<section class="payment-card" aria-label="Төлбөр төлөх дансны мэдээлэл"><div class="bank-brand">${campaign.logo?`<img class="bank-logo-image" src="${e(campaign.logo)}" alt="${e(campaign.provider||campaign.bank)}">`:'<span class="bank-logo-mark">K</span>'}<span><strong>${e(campaign.provider||campaign.bank||'ХААН БАНК')}</strong><small>ТӨЛБӨР ТӨЛӨХ ДАНС</small></span></div><dl>${campaign.account?`<div><dt>💳 ДАНС</dt><dd>${e(campaign.account)}</dd></div>`:''}${campaign.iban?`<div><dt>💳 IBAN</dt><dd>${e(campaign.iban)}</dd></div>`:''}${campaign.holder?`<div><dt>👤 ЭЗЭМШИГЧ</dt><dd>${e(campaign.holder)}</dd></div>`:''}<div><dt>📝 ГҮЙЛГЭЭНИЙ УТГА</dt><dd>${e(copy.bankMemo)} 📱</dd></div></dl><p class="payment-note">${e(copy.bankNote)}</p></section>`:''}
    ${lookup(campaign.id,copy)}</div></section></main>`:
    `<main id="content"><section class="hero"><div class="wrap hero-layout"><div class="hero-copy">
      <h1>${e(copy.heroTitle)}<br><em>${e(copy.heroBrand)}</em></h1>
      <p class="hero-tagline">${e(copy.heroTagline)}</p>
      <p class="hero-intro">${e(copy.heroIntro)}</p>
    </div>${lookup(null,copy)}</div></section>
    <nav class="hero-rail" aria-label="Шуурхай холбоос"><div class="wrap">
      <a href="#campaigns"><img src="/horse-mark.webp" width="26" height="26" alt=""> Идэвхтэй сугалаа</a>
      <a href="#lookup"><span aria-hidden="true">▥</span> ЭРХ ШАЛГАХ</a>
      <a href="#help"><span aria-hidden="true">?</span> Хэрхэн шалгах вэ?</a>
    </div></nav>
    <section class="campaigns" id="campaigns"><div class="wrap"><div class="section-heading"><div><p class="eyebrow">ОНЦЛОХ СУГАЛАА</p><h2>${e(copy.campaignHeading)}</h2><p>${e(copy.campaignIntro)}</p></div></div>
      ${campaigns.length?`<div class="cards">${campaigns.map(card).join('')}</div>`:`<div class="empty"><h3>Одоогоор идэвхтэй сугалаа алга</h3><p>Өмнө бүртгүүлсэн эрхээ утасны дугаараар шалгах боломжтой.</p>${link('#lookup','ЭРХ ШАЛГАХ →','text-link')}</div>`}
      <details class="site-help" id="help"><summary>${e(copy.helpTitle)}</summary><p>${e(copy.helpText)}</p></details>
      </div></section></main>`;
  return doc(title,`<a class="skip" href="#content">Үндсэн агуулга</a><header class="top"><div class="wrap nav">${publicBrand}
    <nav aria-label="Үндсэн цэс"><a href="/" ${campaign?'':'aria-current="page"'}>Нүүр</a><a href="/#campaigns">Сугалаа</a><a href="#lookup">ЭРХ ШАЛГАХ</a><a href="/#help">Тусламж</a>${facebook?'<a href="#contact">Холбоо барих</a>':''}</nav>
    </div></header>${main}<footer id="contact"><div class="wrap row">${publicBrand}<div class="contact-actions">${facebook?`<h2>Холбоо барих</h2><a class="button facebook-button" href="${e(facebook)}" target="_blank" rel="noopener noreferrer"><span class="facebook-mark" aria-hidden="true">f</span> Facebook</a>`:''}${shareFacebook(canonical)}</div></div></footer>`,
    {meta:meta+'<link rel="icon" href="/horse-mark.webp" type="image/webp">',className:campaign?'race-site race-detail':'race-site',scripts:'<script src="/public-ui.js" defer></script>'});
}
function consolePage(title,html,scripts=''){
  return doc(title,`<header class="admin-top"><div class="wrap nav">${brand}<nav><a href="/admin">Самбар</a><a href="/admin/transactions">Гүйлгээ</a><a href="/admin#import">Импорт</a></nav><form method="post" action="/admin/logout"><button type="submit" class="text-button">Гарах</button></form></div></header><main class="wrap console"><h1>${e(title)}</h1>${html}</main>`,{scripts,className:'admin'});
}
export function message(message,back='/'){
  return doc(siteName,`<main class="wrap console"><h1>${e(message)}</h1>${link(back,'Буцах','button secondary')}</main>`);
}
const field=(label,name,value='',type='text',extra='')=>`<label>${e(label)}<input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;
const check=(label,name,value=false)=>`<label class="check"><input type="checkbox" name="${name}" ${value?'checked':''}>${e(label)}</label>`;
export function login(error=''){
  return doc('Админ нэвтрэх',`<main class="signin"><div>${brand}<h1>Админ нэвтрэх</h1>
    ${error?`<p role="alert">${e(error)}</p>`:''}<form method="post" action="/admin/login">
    ${field('Нэвтрэх нэр','username','','text','required autocomplete="username"')}${field('Нууц үг','password','','password','required autocomplete="current-password"')}
    <button class="button gold">Нэвтрэх →</button></form>${link('/','← Нүүр хуудас','text-link')}</div></main>`);
}
const options=(items,selected)=>items.map(([value,label])=>`<option value="${e(value)}"${String(value)===String(selected)?' selected':''}>${e(label)}</option>`).join('');
export function admin(campaigns,stats,logs,batches,facebook,owner,edge=false,rawCopy={}){
  const copy=copyOf(rawCopy);
  return consolePage('Удирдлагын самбар',`<dl class="admin-stats">${[['Нийт сугалаа',campaigns.length],['Идэвхтэй',stats.active],['Оролцогч',stats.participants],['Борлуулсан эрх',stats.sold],['Гүйлгээ',stats.transactions],['Баталгаажсан',stats.confirmed],['Хүлээгдэж буй',stats.pending],['Нийт орлого',money(stats.revenue)]].map(([label,value])=>`<div><dt>${label}</dt><dd>${typeof value==='string'&&value.includes('₮')?e(value):fmt(value)}</dd></div>`).join('')}</dl>
    <section class="panel"><div class="row"><h2>Сугалаанууд</h2>${owner?link('/admin/campaigns/new','Сугалаа үүсгэх','button gold'):''}</div>
      ${campaigns.length?`<div class="table-scroll"><table><thead><tr><th>Нэр</th><th>Төлөв</th><th>Эрх</th><th>Үйлдэл</th></tr></thead><tbody>${campaigns.map(c=>`<tr><td>${e(c.title)}</td><td>${c.active?'Нээлттэй':'Хаалттай'} · ${c.public?'Нийтэд':'Нууц'}</td><td>${fmt(c.sold)} / ${fmt(c.total)}</td><td>${owner?link('/admin/campaigns/'+c.id,'Засах','text-link'):''}</td></tr>`).join('')}</tbody></table></div>`:'<p>Сугалаа үүсгээгүй байна.</p>'}</section>
    <section class="panel" id="import"><h2>Excel импорт</h2><p>Сугалаагаа сонгож файл оруулна уу. Утас болон эрхийн дугаарын баганыг сонгоод урьдчилж шалгана.</p>
    ${campaigns.length?`<form id="import-form" class="form-grid"><label>Сугалаа<select name="campaign">${options(campaigns.map(c=>[c.id,c.title]))}</select></label>
      <label>Excel / CSV файл<input type="file" name="file" accept=".xlsx,.xls,.csv" required></label>
      <fieldset id="mapping" class="form-grid full" hidden><legend>Мөр ба баганын тохиргоо</legend>
        <input type="hidden" name="mode" value="tickets"><label>Хуудас<select name="sheet"></select></label>
        ${field('Толгойн мөр (байхгүй бол 0)','header',0,'number','min="0" max="9999"')}${field('Эхлэх мөр','start',1,'number','required min="1" max="10000"')}
        ${[['phone','Утасны дугаар'],['tickets','Эрхийн дугаар']].map(([name,label])=>`<label>${label}<select name="${name}"></select></label>`).join('')}

        <div id="sample-data" class="table-scroll full"></div></fieldset>
      <div class="actions full"><button type="submit" class="button gold" id="preview-import" disabled>Урьдчилж шалгах</button><button type="button" class="button secondary" id="commit-import" hidden>Импорт батлах</button></div>
      <p id="import-status" class="full" role="status"></p><div id="import-report" class="full"></div></form>`:'<p>Эхлээд сугалаа үүсгэнэ үү.</p>'}
      ${batches.length?`<h3>Импортын түүх</h3><div class="table-scroll"><table><thead><tr><th>Багц</th><th>Сугалаа</th><th>Огноо</th><th>Зөв / алдаа / давхардал</th><th>Эрх</th><th>Үйлдэл</th></tr></thead><tbody>${batches.map(b=>`<tr><td>${link('/admin/imports/'+b.id,'#'+b.id,'text-link')}</td><td>${e(b.title)}</td><td>${date(b.created_at)}</td><td>${b.summary.valid||0} / ${b.summary.invalid||0} / ${b.summary.duplicate||0}</td><td>${b.summary.tickets||0}</td><td>${b.rolled_back_at?'Буцаасан':`<form method="post" action="/admin/imports/${b.id}/rollback" data-confirm="Энэ багцын бүх гүйлгээ, эрхийг буцаах уу?"><button class="text-button">Буцаах</button></form>`}</td></tr>`).join('')}</tbody></table></div>`:''}</section>
    <section class="panel"><h2>Сүүлийн үйлдлүүд</h2>${logs.length?`<ul class="logs">${logs.map(l=>`<li><strong>${e(l.action)}</strong> · ${e(l.target)} <time>${date(l.created_at)}</time></li>`).join('')}</ul>`:'<p>Үйлдэл бүртгэгдээгүй байна.</p>'}</section>
    ${owner?`<section class="panel"><h2>Сайтын тохиргоо — текст ба харагдах байдал</h2><form method="post" action="/admin/site" class="form-grid">${field('Facebook хуудасны холбоос','facebook',facebook,'url')}
    <fieldset class="full form-grid"><legend>Сайтын текстүүд (эндээс өөрчилнө)</legend>${field('Нүүр гарчиг','heroTitle',copy.heroTitle)}${field('Том гарчиг','heroBrand',copy.heroBrand)}${field('Уриа','heroTagline',copy.heroTagline)}<label class="full">Нүүр тайлбар<textarea name="heroIntro">${e(copy.heroIntro)}</textarea></label>${field('Эрх шалгах гарчиг','lookupTitle',copy.lookupTitle)}${field('Утасны талбар','phoneLabel',copy.phoneLabel)}<label class="full">Эрх шалгах тайлбар<textarea name="lookupHelp">${e(copy.lookupHelp)}</textarea></label>${field('Эрх шалгах товч','lookupButton',copy.lookupButton)}${field('Сугалааны гарчиг','campaignHeading',copy.campaignHeading)}<label class="full">Сугалааны тайлбар<textarea name="campaignIntro">${e(copy.campaignIntro)}</textarea></label>${field('Тусламжийн гарчиг','helpTitle',copy.helpTitle)}<label class="full">Тусламжийн текст<textarea name="helpText">${e(copy.helpText)}</textarea></label>${field('Үнэний гарчиг','priceLabel',copy.priceLabel)}${field('Facebook share товч','shareLabel',copy.shareLabel)}${field('Холбоо барих гарчиг','contactLabel',copy.contactLabel)}${field('Гүйлгээний утга','bankMemo',copy.bankMemo)}<label class="full">Банкны тайлбар<textarea name="bankNote">${e(copy.bankNote)}</textarea></label></fieldset>
    <fieldset class="full form-grid"><legend>Харагдах / нуух</legend>${check('Эрхийн үнэ харуулах','showPrice',copy.showPrice)}${check('Эрхийн тоо, үлдэгдэл, явц харуулах','showStats',copy.showStats)}${check('Банкны данс харуулах','showBank',copy.showBank)}${check('Facebook share харуулах','showShare',copy.showShare)}${check('Холбоо барих харуулах','showContact',copy.showContact)}</fieldset><div class="full"><button class="button secondary">Тохиргоо хадгалах</button></div></form></section>`:''}
    <details class="panel"><summary>Нууц үг солих</summary><form method="post" action="/admin/password" class="form-grid">
    ${field('Одоогийн нууц үг','current','','password','required autocomplete="current-password"')}${field('Шинэ нууц үг (14 тэмдэгтээс дээш)','password','','password','required minlength="14" maxlength="160" autocomplete="new-password"')}<div class="full"><button class="button secondary">Нууц үг солих</button></div></form></details>`, (edge?'<script src="/cloudflare-xlsx.js" defer></script>':'')+'<script src="/import-ui.js" defer></script><script src="/confirm.js" defer></script>');
}
export function importReport(batch,rows,page){
  const labels={valid:'Импортолсон',invalid:'Алдаатай',duplicate:'Давхардсан'};
  const base='/admin/imports/'+batch.id+'?page=';
  return consolePage('Импорт #'+batch.id,`<section class="panel"><p><strong>${e(batch.title)}</strong> · ${date(batch.created_at)}${batch.rolled_back_at?' · Буцаасан':''}</p>
    <div class="table-scroll"><table><thead><tr><th>Excel мөр</th><th>Төлөв</th><th>Тайлбар</th><th>Гүйлгээ</th></tr></thead>
    <tbody>${rows.slice(0,100).map(row=>`<tr><td>${row.row_no}</td><td>${labels[row.result]}</td><td>${e(row.reason)}</td><td>${row.transaction_id?link('/admin/transactions/'+row.transaction_id,'#'+row.transaction_id,'text-link'):'—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="actions">${link('/admin#import','Импортын түүх','button secondary')}
    ${page>1?link(base+(page-1),'← Өмнөх','button secondary'):''}
    ${rows.length>100?link(base+(page+1),'Дараах →','button secondary'):''}</div></section>`);
}
export function campaignForm(c){
  return consolePage(c.id?'Сугалаа засах':'Шинэ сугалаа',`<form method="post" action="/admin/campaigns" enctype="multipart/form-data" class="panel form-grid">
    <input type="hidden" name="id" value="${c.id||''}">${field('Нэр','title',c.title,'text','required maxlength="150"')}${field('Холбоосын нэр (slug)','slug',c.slug,'text','required pattern="[a-z0-9]+(-[a-z0-9]+)*"')}
    <label class="full">Тайлбар<textarea name="description" required maxlength="6000">${e(c.description)}</textarea></label>
    ${field('Нийт эрх','total',c.total,'number','required min="1" max="1000000"')}${field('Нэг эрхийн үнэ (₮) — хоосон бол харуулахгүй','price',c.price||'','number','min="0" max="1000000000"')}
    
    ${field('Эхлэх хугацаа (Улаанбаатар)','starts',inputDate(c.starts),'datetime-local')}${field('Дуусах хугацаа (Улаанбаатар)','ends',inputDate(c.ends),'datetime-local')}
    ${field('Зургийн HTTPS холбоос','image',c.image)}<label>Зураг оруулах<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>
    <input type="hidden" name="active" value="off"><input type="hidden" name="public" value="off">
    ${check('Сугалааг нээх','active',c.id?c.active:true)}${check('Нийтэд харуулах','public',c.id?c.public:true)}
    <fieldset class="full form-grid bank-fields"><legend>Төлбөр хүлээн авах данс (энэ сугалаанд)</legend>
    ${field('Банк','bank',c.bank||'ХААН БАНК')}${field('Эзэмшигч','holder',c.holder||'ГОНГОРЖАВ')}${field('Дансны дугаар','account',c.account||'5637213181')}${field('IBAN','iban',c.iban||'93000500')}${field('Банкны логоны HTTPS холбоос (сонголтоор)','logo',c.logo,'url')}<label class="full">Банкны лого upload<input type="file" name="bankLogo" accept="image/jpeg,image/png,image/webp"></label>${field('Дэлгэцэд харагдах банкны нэр','provider',c.provider||'ХААН БАНК')}</fieldset>
    <div class="actions full"><button class="button gold">Хадгалах</button>${link('/admin','Буцах','button secondary')}</div>
    </form>${c.id?`<div class="campaign-danger-actions"><form method="post" action="/admin/campaigns/${c.id}/delete" data-confirm="Сугалааг архивлаж, нийтээс нуух уу? Өгөгдөл хадгалагдана."><button class="button secondary">Архивлах (өгөгдөл хадгална)</button></form><form method="post" action="/admin/campaigns/${c.id}/hard-delete" data-confirm="Зөвхөн гүйлгээ, эрх бүртгэгдээгүй сугалааг бүрмөсөн устгана. Үргэлжлүүлэх үү?"><button class="button danger">Бүрмөсөн устгах</button></form></div>`:''}`,'<script src="/confirm.js" defer></script>');
}
const statuses={confirmed:'Баталгаажсан',pending:'Хүлээгдэж буй',reversed:'Буцаасан'};
export function transactions(rows,term,page,campaigns=[],campaignId=0){
  const query=(p)=>'/admin/transactions?q='+encodeURIComponent(term)+'&campaign='+campaignId+'&page='+p;
  return consolePage('Гүйлгээнүүд',`<section class="panel"><p>${link('/admin/transactions/new','Гүйлгээ бүртгэх','button secondary')}</p><form action="/admin/transactions" class="actions">${field('Утас, гүйлгээний утга эсвэл ID','q',term,'search','maxlength="100"')}<label>Сугалаагаар шүүх<select name="campaign"><option value="0">Бүх сугалаа</option>${options(campaigns.map(c=>[c.id,c.title]),campaignId)}</select></label><button class="button gold">Шүүх</button></form>
  ${rows.length?`<div class="table-scroll"><table><thead><tr><th>ID</th><th>Утас</th><th>Сугалаа</th><th>Огноо</th><th>Дүн</th><th>Эрх</th><th>Төлөв</th></tr></thead>
  <tbody>${rows.slice(0,50).map(t=>`<tr><td>${link('/admin/transactions/'+t.id,'#'+t.id,'text-link')}</td><td>${e(t.phone)}</td><td>${e(t.title)}</td><td>${date(t.occurred_at)}</td><td>${t.amount==null?'—':money(t.amount)}</td><td>${t.count}</td><td>${statuses[t.status]}</td></tr>`).join('')}</tbody></table></div>`:'<p>Тохирох гүйлгээ алга.</p>'}
  <div class="actions">${page>1?link(query(page-1),'← Өмнөх','button secondary'):''}${rows.length>50?link(query(page+1),'Дараах →','button secondary'):''}</div></section>`);
}
export function transactionForm(t,campaigns){
  const path='/admin/transactions/'+(t.id||'new');
  return consolePage(t.id?'Гүйлгээ #'+t.id:'Гүйлгээ бүртгэх',`<form method="post" action="${path}" class="panel form-grid">
  <p class="full"><strong>${statuses[t.status]}</strong></p><label>Сугалаа<select name="campaign">${options(campaigns.map(c=>[c.id,c.title]),t.campaign_id)}</select></label>
  ${field('Утас','phone',t.phone,'tel','required')}${field('Огноо (Улаанбаатар)','date',inputDate(t.occurred_at),'datetime-local','required')}
  ${field('Дүн','amount',t.amount,'number','required min="1"')}${field('Банк','bank',t.bank)}${field('Гүйлгээний утга','memo',t.memo)}
  ${field('Эрхийн тоо','count',t.count,'number','required min="1" max="5000"')}${field('Эрхийн дугаарууд','numbers',(t.tickets.length?t.tickets:t.requested).join(', '))}
  <div class="actions full"><button name="action" value="save" class="button gold">Хадгалах</button>
  ${t.id&&t.status!=='confirmed'?'<button name="action" value="confirm" formnovalidate class="button secondary">Баталгаажуулах</button>':''}
  ${t.id&&t.status!=='reversed'?'<button name="action" value="reverse" formnovalidate class="button danger" data-confirm="Гүйлгээний баталгаажуулалтыг буцаах уу?">Буцаах</button>':''}</div></form>`,'<script src="/confirm.js" defer></script>');
}
