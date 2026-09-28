# Marquee & Co. – Event supplies rental site

Frontend (static HTML/CSS/JS) + backend (Node/Express, JSON file storage).

## Run locally
```
npm install
ADMIN_KEY=yourSecret npm start
```
Open http://localhost:3000

## Structure
- `frontend/` – the website (catalog, quote cart, request form)
- `backend/server.js` – API: `GET /api/products`, `POST /api/quotes`, `GET /api/quotes` (header `x-admin-key`)
- `backend/data/products.json` – edit your items and prices here

## Deploy
Push to GitHub, then connect the repo to Render, Railway or Fly.io. Build: `npm install`, start: `npm start`. Set env var `ADMIN_KEY`.
Note: JSON storage resets on some hosts. For production, move quotes to a database (Postgres/Supabase).

## Next steps
Availability calendar, Stripe deposits, admin dashboard, photo gallery.
