const form = document.querySelector('#lookup-form');
const phone = document.querySelector('#phone');
const status = document.querySelector('#lookup-status');

form?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  status.hidden = false;
  status.textContent = 'Эрхийн тоог шалгаж байна…';
  try {
    const response = await fetch('/lookup', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({phone: phone.value})
    });
    const result = await response.json();
    if (!response.ok) {
      status.textContent = result.error || 'Түр хүлээгээд дахин оролдоно уу.';
      return;
    }
    status.textContent = result.count
      ? new Intl.NumberFormat('mn-MN').format(result.count) + ' эрх бүртгэгдсэн байна.'
      : 'Энэ дугаарт бүртгэлтэй эрх олдсонгүй.';
  } catch {
    status.textContent = 'Холболт тасарлаа. Дахин оролдоно уу.';
  } finally {
    button.disabled = false;
  }
});
