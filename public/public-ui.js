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
    const total = document.createElement('strong');
    total.className = 'lookup-total';
    total.textContent = new Intl.NumberFormat('mn-MN').format(result.count) + ' эрх нийт бүртгэгдсэн байна';
    status.append(total);
    for (const campaign of result.campaigns || []) {
      const row = document.createElement('div');
      row.className = 'lookup-campaign-result';
      const name = document.createElement('span');
      name.textContent = campaign.title;
      const count = document.createElement('strong');
      count.textContent = new Intl.NumberFormat('mn-MN').format(campaign.count) + ' эрх';
      row.append(name, count);
      status.append(row);
    }
  } catch {
    status.textContent = 'Холболт тасарлаа. Дахин оролдоно уу.';
  } finally {
    button.disabled = false;
  }
});