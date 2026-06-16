# OwnUp Web

OwnUp is now a deploy-ready React/Vite app with Supabase auth, database tables, photo storage, outfit posting, saved looks, and a rule-based styler recommendation view.

## 1. Create Supabase

1. Create a Supabase project.
2. Open the SQL editor.
3. Run `supabase/schema.sql`.
4. Go to Project Settings > API and copy:
   - Project URL
   - anon public key

## 2. Configure Local Env

Create `.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

## 3. Run Locally

```bash
npm install
npm run dev
```

## 4. Deploy Free On Netlify

Option A, easiest:

1. Push this folder to GitHub.
2. In Netlify, choose Add new site > Import an existing project.
3. Pick the repo.
4. Set build command: `npm run build`.
5. Set publish directory: `dist`.
6. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
7. Deploy.

Option B, CLI:

```bash
npm install
npm run build
npx netlify deploy --prod --dir=dist
```

The CLI flow requires signing into your Netlify account or providing a Netlify auth token.
