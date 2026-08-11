# Stonks Deployment Guide (Vercel)

## 1) Prerequisites
- A Vercel account connected to your Git provider.
- A production MySQL database reachable from Vercel.
- API keys for News API, Finnhub, Twelve Data, and Gemini.

## Local start

1. Review `.env` and add your MySQL credentials. The checked-in development defaults expect MySQL at `127.0.0.1:3306` with a `stonks` database.
2. Add provider keys to enable live news, price history, and AI chat.
3. Run `npm.cmd run dev`, then open `http://localhost:3000`.

`AUTO_MIGRATE_DB=1` and `AUTO_MIGRATE_AUTH=1` are enabled only in the local `.env` so the application tables are created automatically on first use. Set both back to `0` for production after migrating the database.

## 2) Prepare Environment Variables
Use `.env.example` as the source of truth and add these in Vercel Project Settings > Environment Variables.

Required groups:
- Database: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`
- Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- Providers: `GEMINI_API_KEY`, `NEWS_API_KEY`, `FINNHUB_API_KEY`, `TWELVE_DATA_API_KEY`

Recommended for Vercel: `HF_TOKEN` with Hugging Face inference permission. This powers BGE semantic embeddings used by Chroma memory retrieval.

### Vector search

Chat memory, stock context, and news context use the full 384-dimensional output from `BAAI/bge-small-en-v1.5`, normalized and queried in Chroma using cosine nearest-neighbour retrieval (HNSW when Chroma is running). Configure `HF_TOKEN` and optionally `BGE_EMBEDDING_URL` if you run a compatible embedding endpoint yourself. The collection names are versioned with `_bge_v2`; old 64-dimensional local vectors and the earlier 192-dimensional experimental vectors are intentionally not reused.

## 3) Push and Import to Vercel
1. Push your repository to GitHub/GitLab/Bitbucket.
2. In Vercel: Add New Project > Import repository.
3. Framework preset: Next.js (auto-detected).
4. Root directory: `stonks` (if your repo root contains a nested `stonks` folder).
5. Build command: `pnpm build` (or leave default).
6. Install command: `pnpm install`.

## 4) Deploy
- Click Deploy.
- After first deploy, verify these routes:
  - `/dashboard`
  - `/dashboard/stocks`
  - `/api/market/stocks`
  - `/api/news/realtime`

## 5) Optional Vercel CLI Flow
```bash
pnpm install
pnpm build
npx vercel
npx vercel --prod
```

## 6) Troubleshooting
- 500 on auth routes: verify the JWT and database variables.
- DB connection errors: verify host/port/user/password and DB network access.
- Empty market/news data: verify provider keys and daily limits.

