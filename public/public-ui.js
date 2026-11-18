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
    for(const campaign of result.campaigns||[]){
      const section=document.createElement('section');section.className='lookup-campaign-result';
      const heading=document.createElement('div');heading.className='lookup-campaign-heading';
      const name=document.createElement('strong');name.textContent=campaign.title||'Сугалаа';
      const count=document.createElement('span');count.textContent=new Intl.NumberFormat('mn-MN').format(campaign.count||0)+' эрх';
      heading.append(name,count);section.append(heading);
      const numbers=document.createElement('div');numbers.className='lookup-number-grid';
      for(const ticket of campaign.tickets||[]){
        const chip=document.createElement('strong');chip.className='lookup-number-chip';
        chip.textContent=String(ticket.number).padStart(3,'0');numbers.append(chip);
      }
      section.append(numbers);status.append(section);
    }
  } catch {
    status.textContent = 'Холболт тасарлаа. Дахин оролдоно уу.';
  } finally {
    button.disabled = false;
  }
});