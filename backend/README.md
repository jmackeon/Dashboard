# LAC Dashboard Backend (Render-ready)

Express API that stores **daily updates** and **weekly dashboard snapshots** in Supabase.

## 1) Environment variables

Create `.env` (or set in Render):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`  (server only)
- `ALLOWED_ORIGINS` (comma-separated) e.g. `http://localhost:5173,https://your-vercel-domain.vercel.app`
- `PORT` (Render sets this automatically)

See `.env.example`.

## 2) Run locally

```bash
npm i
npm run dev
```

Health check:

```bash
curl http://localhost:10000/health
```

## 3) Deploy on Render

- Create a new **Web Service** from this `backend` folder.
- Build command: `npm install`
- Start command: `npm start`
- Add the env vars above.

## 4) Frontend

Set `VITE_API_BASE_URL` in the Vite frontend:

- Local: `http://localhost:10000`
- Prod: your Render URL
