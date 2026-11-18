document.addEventListener('click',async event=>{const button=event.target.closest('[data-copy-account]');if(!button)return;try{await navigator.clipboard.writeText(button.dataset.copyAccount);const old=button.textContent;button.textContent='Хуулагдлаа ✓';setTimeout(()=>button.textContent=old,1800);}catch{button.textContent='Хуулах боломжгүй';}});
const form = document.querySelector('#lookup-form');
const phone = document.querySelector('#phone');
const status = document.querySelector('#lookup-status');

form?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  status.hidden = false;
  status.replaceChildren();
  status.textContent = 'Эрхийн тоог шалгаж байна…';
  try {
    const response = await fetch('/lookup', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({phone: phone.value, campaign: form.elements.campaign?.value || ''})
    });
    const result = await response.json();
    if (!response.ok) {
      status.textContent = result.error || 'Түр хүлээгээд дахин оролдоно уу.';
      return;
    }
    status.replaceChildren();
    if (!result.count) {
      status.textContent = 'Энэ дугаарт бүртгэлтэй эрх олдсонгүй.';
      return;
    }
    const total = document.createElement('strong');total.className='lookup-total';total.textContent=new Intl.NumberFormat('mn-MN').format(result.count)+' эрх нийт бүртгэгдсэн байна';status.append(total);
    const fmtDate=value=>value?new Intl.DateTimeFormat('mn-MN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Ulaanbaatar'}).format(new Date(value)):'Огноо бүртгэгдээгүй';
    const fmtMoney=value=>value==null?'Дүн бүртгэгдээгүй':new Intl.NumberFormat('mn-MN').format(value)+' ₮';
    for(const campaign of result.campaigns||[]){
      const section=document.createElement('section');section.className='lookup-campaign-result';
      const heading=document.createElement('div');heading.className='lookup-campaign-heading';
      const name=document.createElement('strong');name.textContent=campaign.title;
      const count=document.createElement('span');count.textContent=campaign.count+' эрх';
      heading.append(name,count);section.append(heading);
      const groups=new Map();
      for(const [index,ticket] of (campaign.tickets||[]).entries()){
        const key=ticket.transactionId==null?'ticket-'+index:String(ticket.transactionId);
        if(!groups.has(key))groups.set(key,{occurredAt:ticket.occurredAt,amount:ticket.amount,tickets:[]});
        groups.get(key).tickets.push(ticket.number);
      }
      for(const group of groups.values()){
        const block=document.createElement('div');block.className='lookup-transaction';
        const meta=document.createElement('div');meta.className='lookup-transaction-meta';
        const dateLabel=document.createElement('span');dateLabel.textContent='ГҮЙЛГЭЭНИЙ ОГНОО';
        const dateValue=document.createElement('strong');dateValue.textContent=fmtDate(group.occurredAt);
        const amount=document.createElement('strong');amount.className='lookup-transaction-amount';amount.textContent=fmtMoney(group.amount);
        meta.append(dateLabel,dateValue,amount);block.append(meta);
        const label=document.createElement('div');label.className='lookup-numbers-label';label.textContent='ТАНЫ СУГАЛААНЫ ДУГААРУУД · '+group.tickets.length+' ЭРХ';
        const numbers=document.createElement('div');numbers.className='lookup-number-grid';
        group.tickets.sort((a,b)=>Number(a)-Number(b));
        for(const value of group.tickets){const chip=document.createElement('strong');chip.className='lookup-number-chip';chip.textContent=String(value).padStart(3,'0');numbers.append(chip);}
        block.append(label,numbers);section.append(block);
      }
      status.append(section);
    }
  } catch {
    status.textContent = 'Холболт тасарлаа. Дахин оролдоно уу.';
  } finally {
    button.disabled = false;
  }
});