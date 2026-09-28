const API = ''; // same origin. Set to your backend URL if hosted separately.
let products = [], cart = {}, cat = 'All';
const $ = s => document.querySelector(s);
const money = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

fetch(API + '/api/products').then(r => r.json()).then(p => { products = p; render(); })
  .catch(() => { $('#grid').innerHTML = '<p>Could not load items. Please refresh.</p>'; });

function render() {
  const cats = ['All', ...new Set(products.map(p => p.category))];
  $('#filters').innerHTML = cats.map(c => `<button class="${c === cat ? 'on' : ''}" data-c="${c}">${c}</button>`).join('');
  $('#grid').innerHTML = products.filter(p => cat === 'All' || p.category === cat).map(p => `
    <article class="item"><h3>${p.name}</h3><span class="muted">${p.note}</span>
    <span class="price">${money(p.price)} / ${p.unit}</span>
    <button class="btn small" data-add="${p.id}">Add</button></article>`).join('');
  renderCart();
}

function days() {
  const s = new Date($('[name=eventDate]').value), e = new Date($('[name=endDate]').value || $('[name=eventDate]').value);
  return isNaN(s) || isNaN(e) || e < s ? 1 : Math.round((e - s) / 864e5) + 1;
}

function renderCart() {
  const ids = Object.keys(cart);
  if (!ids.length) { $('#cart').innerHTML = '<p class="muted">Nothing added yet. Tap Add on any item.</p>'; return; }
  const d = days(); let total = 0;
  const rows = ids.map(id => {
    const p = products.find(x => x.id == id), q = cart[id]; total += p.price * q * d;
    return `<div class="cline"><span>${p.name}</span>
      <span><input type="number" min="0" value="${q}" data-qty="${id}" aria-label="Quantity for ${p.name}"></span></div>`;
  }).join('');
  $('#cart').innerHTML = rows + `<p class="total">Estimate for ${d} day${d > 1 ? 's' : ''}: ${money(total)}</p>`;
}

document.addEventListener('click', e => {
  const c = e.target.dataset.c, a = e.target.dataset.add;
  if (c) { cat = c; render(); }
  if (a) { cart[a] = (cart[a] || 0) + 1; renderCart(); $('#quote').scrollIntoView({ behavior: 'smooth' }); }
});
document.addEventListener('input', e => {
  const id = e.target.dataset.qty;
  if (id) { const q = parseInt(e.target.value, 10); if (q > 0) cart[id] = q; else delete cart[id]; renderCart(); }
  if (e.target.name === 'eventDate' || e.target.name === 'endDate') renderCart();
});

function show(text, label, action) {
  const msg = $('#msg'); msg.textContent = text + ' ';
  if (!label) return;
  const b = document.createElement(typeof action === 'string' ? 'a' : 'button');
  b.className = 'btn small'; b.textContent = label;
  if (typeof action === 'string') { b.href = action; b.target = '_blank'; } else { b.type = 'button'; b.onclick = action; }
  msg.appendChild(b);
}

function loadRazorpay() {
  return new Promise((ok, fail) => {
    if (window.Razorpay) return ok();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = ok; s.onerror = () => fail(new Error('Could not load payment window. Check your connection.'));
    document.head.appendChild(s);
  });
}

async function pay(quoteId) {
  try {
    show('Opening payment...');
    await loadRazorpay();
    const r = await fetch(API + '/api/pay/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteId }) });
    const o = await r.json();
    if (!r.ok) throw new Error(o.error);
    new Razorpay({
      key: o.keyId, amount: o.amount, currency: 'INR', name: o.name, order_id: o.orderId,
      description: 'Booking deposit', prefill: o.customer, theme: { color: '#f2a900' },
      handler: async resp => {
        try {
          const v = await fetch(API + '/api/pay/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteId, ...resp }) });
          const d = await v.json();
          if (!v.ok) throw new Error(d.error);
          show('Payment received. Thank you!', 'View receipt', d.receiptUrl);
        } catch (err) { show(err.message + ' If money was deducted, contact us with your quote reference.'); }
      },
      modal: { ondismiss: () => show('Payment cancelled.', 'Pay deposit', () => pay(quoteId)) }
    }).open();
  } catch (err) { show(err.message || 'Payment failed. Try again.', 'Try again', () => pay(quoteId)); }
}

$('#qform').addEventListener('submit', async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  f.items = Object.entries(cart).map(([id, qty]) => ({ id: +id, qty }));
  if (!f.items.length) { show('Add at least one item first.'); return; }
  show('Sending...');
  try {
    const r = await fetch(API + '/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    cart = {}; e.target.reset(); renderCart();
    show(`Request sent. Estimate ${money(d.estimate)}. Pay the ${money(d.deposit)} deposit to confirm your booking.`, 'Pay deposit', () => pay(d.id));
  } catch (err) { show(err.message || 'Something went wrong. Try again.'); }
});
