const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const DATA = __dirname;
const QUOTES = path.join(DATA, 'quotes.json');

app.use(cors());
app.use(express.json({ limit: '100kb' }));

const read = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};
const products = () => read(path.join(DATA, 'products.json'), []);

app.get('/api/products', (req, res) => res.json(products()));

// Create a quote request. Prices are recalculated on the server.
app.post('/api/quotes', (req, res) => {
  const { name, phone, email, eventType, eventDate, endDate, location, items, notes } = req.body || {};
  if (!name || !phone || !eventDate || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Name, phone, event date and at least one item are required.' });

  const start = new Date(eventDate);
  const end = new Date(endDate || eventDate);
  if (isNaN(start) || isNaN(end) || end < start)
    return res.status(400).json({ error: 'Check the event dates.' });
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
    id: Date.now().toString(36),
    createdAt: new Date().toISOString(),
    status: 'new',
    name: String(name).slice(0, 100), phone: String(phone).slice(0, 40),
    email: String(email || '').slice(0, 120), eventType: String(eventType || '').slice(0, 60),
    eventDate, endDate: endDate || eventDate, days,
    location: String(location || '').slice(0, 200), notes: String(notes || '').slice(0, 1000),
    lines, estimate: total
  };
  const all = read(QUOTES, []);
  all.push(quote);
  fs.writeFileSync(QUOTES, JSON.stringify(all, null, 2));
  res.status(201).json({ id: quote.id, estimate: total, days });
});

// Owner view: GET /api/quotes with header x-admin-key
app.get('/api/quotes', (req, res) => {
  if (req.get('x-admin-key') !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  res.json(read(QUOTES, []).reverse());
});

['index.html','style.css','app.js'].forEach(f => app.get('/' + (f === 'index.html' ? '' : f), (req, res) => res.sendFile(path.join(__dirname, f))));
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
