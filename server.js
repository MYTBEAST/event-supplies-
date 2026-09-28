const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const DEPOSIT = Number(process.env.DEPOSIT_PERCENT || 30);
const BUSINESS = process.env.BUSINESS_NAME || 'Marquee & Co.';
const QUOTES = path.join(__dirname, 'quotes.json');

app.use(cors());
app.use(express.json({ limit: '100kb' }));

const read = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const save = all => fs.writeFileSync(QUOTES, JSON.stringify(all, null, 2));
const products = () => read(path.join(__dirname, 'products.json'), []);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

app.get('/api/products', (req, res) => res.json(products()));

// Create a quote request. Prices are recalculated on the server.
app.post('/api/quotes', (req, res) => {
  const { name, phone, email, eventType, eventDate, endDate, location, items, notes } = req.body || {};
  if (!name || !phone || !eventDate || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Name, phone, event date and at least one item are required.' });
  const start = new Date(eventDate), end = new Date(endDate || eventDate);
  if (isNaN(start) || isNaN(end) || end < start) return res.status(400).json({ error: 'Check the event dates.' });
  const days = Math.round((end - start) / 86400000) + 1;

  const catalog = products();
  let total = 0;
  const lines = [];
  for (const it of items) {
    const p = catalog.find(x => x.id === it.id);
    const qty = Math.floor(Number(it.qty));
    if (!p || !(qty > 0) || qty > 10000) continue;
    const lineTotal = p.price * qty * days;
    total += lineTotal;
    lines.push({ id: p.id, name: p.name, qty, price: p.price, lineTotal });
  }
  if (!lines.length) return res.status(400).json({ error: 'No valid items.' });

  const quote = {
    id: crypto.randomBytes(8).toString('hex'),
    createdAt: new Date().toISOString(), status: 'new', paid: false,
    name: String(name).slice(0, 100), phone: String(phone).slice(0, 40),
    email: String(email || '').slice(0, 120), eventType: String(eventType || '').slice(0, 60),
    eventDate, endDate: endDate || eventDate, days,
    location: String(location || '').slice(0, 200), notes: String(notes || '').slice(0, 1000),
    lines, estimate: total
  };
  const all = read(QUOTES, []);
  all.push(quote);
  save(all);
  res.status(201).json({ id: quote.id, estimate: total, days, deposit: Math.round(total * DEPOSIT) / 100 });
});

// Step 1 of payment: create a Razorpay order for the deposit.
app.post('/api/pay/order', async (req, res) => {
  if (!KEY_ID || !KEY_SECRET) return res.status(503).json({ error: 'Online payment is not set up yet. We will contact you to confirm.' });
  const all = read(QUOTES, []);
  const q = all.find(x => x.id === (req.body || {}).quoteId);
  if (!q) return res.status(404).json({ error: 'Quote not found.' });
  if (q.paid) return res.status(400).json({ error: 'Already paid.' });
  const amount = Math.max(100, Math.round(q.estimate * DEPOSIT)); // in paise
  try {
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(KEY_ID + ':' + KEY_SECRET).toString('base64') },
      body: JSON.stringify({ amount, currency: 'INR', receipt: q.id, notes: { quoteId: q.id } })
    });
    const o = await r.json();
    if (!r.ok) return res.status(502).json({ error: (o.error && o.error.description) || 'Could not start payment.' });
    q.orderId = o.id; q.depositAmount = amount / 100;
    save(all);
    res.json({ keyId: KEY_ID, orderId: o.id, amount, name: BUSINESS, customer: { name: q.name, email: q.email, contact: q.phone } });
  } catch { res.status(502).json({ error: 'Payment service unreachable. Try again.' }); }
});

// Step 2: verify Razorpay's signature, then mark paid and issue a receipt number.
app.post('/api/pay/verify', (req, res) => {
  const { quoteId, razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body || {};
  const all = read(QUOTES, []);
  const q = all.find(x => x.id === quoteId);
  if (!q || !KEY_SECRET || q.orderId !== oid || !pid || !sig) return res.status(400).json({ error: 'Invalid payment details.' });
  const expected = crypto.createHmac('sha256', KEY_SECRET).update(oid + '|' + pid).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(sig));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).json({ error: 'Payment could not be verified.' });
  if (!q.paid) {
    q.paid = true; q.status = 'deposit paid'; q.paymentId = pid; q.paidAt = new Date().toISOString();
    q.receiptNo = 'RCPT-' + String(all.filter(x => x.paid).length).padStart(5, '0');
    save(all);
  }
  res.json({ receiptUrl: '/receipt/' + q.id });
});

// Printable receipt. Use the browser's Print > Save as PDF.
app.get('/receipt/:id', (req, res) => {
  const q = read(QUOTES, []).find(x => x.id === req.params.id);
  if (!q || !q.paid) return res.status(404).send('Receipt not found.');
  const rows = q.lines.map(l => `<tr><td>${esc(l.name)}</td><td>${l.qty}</td><td>${inr(l.price)}</td><td>${q.days}</td><td>${inr(l.lineTotal)}</td></tr>`).join('');
  const dt = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipt ${esc(q.receiptNo)}</title><style>
body{font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#14213d}
h1{margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd;font-size:.92rem}
.r{text-align:right}.paid{display:inline-block;border:2px solid #1a7f37;color:#1a7f37;padding:2px 10px;font-weight:700;border-radius:4px}
button{background:#f2a900;border:0;padding:12px 20px;font-size:1rem;font-weight:600;border-radius:6px}@media print{button{display:none}}
</style></head><body>
<h1>${esc(BUSINESS)}</h1><p>Payment receipt <span class="paid">PAID</span></p>
<p><b>Receipt no:</b> ${esc(q.receiptNo)}<br><b>Date:</b> ${dt(q.paidAt)}<br><b>Payment ID:</b> ${esc(q.paymentId)}</p>
<p><b>Billed to:</b> ${esc(q.name)}<br>${esc(q.phone)}${q.email ? '<br>' + esc(q.email) : ''}</p>
<p><b>Event:</b> ${esc(q.eventType)} | ${dt(q.eventDate)}${q.endDate !== q.eventDate ? ' to ' + dt(q.endDate) : ''}<br><b>Location:</b> ${esc(q.location) || '-'}</p>
<table><tr><th>Item</th><th>Qty</th><th>Rate/day</th><th>Days</th><th>Amount</th></tr>${rows}</table>
<p class="r">Estimate total: <b>${inr(q.estimate)}</b><br>Deposit paid (${DEPOSIT}%): <b>${inr(q.depositAmount)}</b><br>Balance due: <b>${inr(q.estimate - q.depositAmount)}</b></p>
<p style="font-size:.85rem;color:#555">Delivery, setup and any damage or late-return fees are billed separately per our terms.</p>
<button onclick="window.print()">Print / Save as PDF</button></body></html>`);
});

app.get('/api/quotes', (req, res) => {
  if (req.get('x-admin-key') !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  res.json(read(QUOTES, []).reverse());
});

['index.html', 'style.css', 'app.js'].forEach(f =>
  app.get('/' + (f === 'index.html' ? '' : f), (req, res) => res.sendFile(path.join(__dirname, f))));

app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
