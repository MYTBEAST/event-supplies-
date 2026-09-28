const API = ''; // same origin. Set to your backend URL if hosted separately.
let products = [], cart = {}, cat = 'All';
const $ = s => document.querySelector(s);
const money = n => '$' + n.toFixed(2);

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

$('#qform').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#msg'), f = Object.fromEntries(new FormData(e.target));
  f.items = Object.entries(cart).map(([id, qty]) => ({ id: +id, qty }));
  if (!f.items.length) { msg.textContent = 'Add at least one item first.'; return; }
  msg.textContent = 'Sending...';
  try {
    const r = await fetch(API + '/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    msg.textContent = `Request sent. Reference ${d.id}. Estimate ${money(d.estimate)}. We will contact you shortly.`;
    cart = {}; e.target.reset(); renderCart();
  } catch (err) { msg.textContent = err.message || 'Something went wrong. Try again.'; }
});
