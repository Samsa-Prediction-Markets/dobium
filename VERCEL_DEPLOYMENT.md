# Vercel Deployment Guide

## Overview

This project is a monorepo with a **React frontend** (Vite) and **Node.js/Express backend**. Vercel's architecture requires special handling for full-stack apps.

## Deployment Options

### Option 1: Frontend Only on Vercel (Recommended)

Deploy the **frontend to Vercel** and keep the **backend elsewhere** (Railway, Render, Heroku, etc.).

**Steps:**
1. Remove `api/` folder (not needed)
2. Push to GitHub
3. Connect to Vercel
4. Set `Build Command`: `npm install --prefix frontend && npm run frontend:build`
5. Set `Output Directory`: `frontend/dist`
6. Set Environment Variables in Vercel Dashboard:
   - `VITE_API_URL=https://your-backend-url.com` (your actual backend domain)
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_STRIPE_PUBLISHABLE_KEY`

**Backend Setup (separate service):**
- Deploy `backend/server.js` to Railway, Render, or your preferred platform
- Ensure it's accessible from the frontend's `VITE_API_URL`

---

### Option 2: Frontend on Vercel + Backend API Routes as Serverless Functions

Advanced setup - requires refactoring backend routes into individual serverless functions.

**File Structure:**
```
api/
├── health.js           # GET /api/health
├── auth/
│   ├── login.js        # POST /api/auth/login
│   └── signup.js       # POST /api/auth/signup
├── markets/
│   ├── index.js        # GET/POST /api/markets
│   └── [id].js         # GET /api/markets/:id
└── ...
```

**Current Status:** Not yet implemented. Would require:
- Splitting `backend/server.js` routes into individual files
- Handling database pooling for serverless (complex with long-running migrations)
- Managing state across function invocations

---

## Current Setup (vercel.json)

The `vercel.json` file currently:
- Builds the frontend with `npm run frontend:build`
- Includes environment variable placeholders
- Creates an `api/index.js` placeholder for future expansion

## Environment Variables Required for Vercel

Add these to your **Vercel Project Settings** → **Environment Variables**:

| Variable | Source |
|----------|--------|
| `DATABASE_URL` | PostgreSQL connection string (if using serverless) |
| `SUPABASE_URL` | Supabase Dashboard → Settings → API |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → API Keys |
| `STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard → API Keys |
| `VITE_SUPABASE_URL` | Same as `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Same as `SUPABASE_ANON_KEY` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Same as `STRIPE_PUBLISHABLE_KEY` |
| `VITE_API_URL` | Your backend domain (e.g., `https://api.example.com`) |

## Recommended Deployment Architecture

```
┌─────────────────────┐
│  Vercel (Frontend)  │
│  - React App        │
│  - Vite Build       │
│  - Static Hosting   │
└──────────┬──────────┘
           │
    API Requests
           │
           ▼
┌─────────────────────┐
│ Railway/Render      │
│ (Backend)           │
│ - Node.js/Express   │
│ - PostgreSQL        │
│ - Jobs/Crons        │
└─────────────────────┘
```

## Quick Deploy Checklist

- [ ] Push code to GitHub
- [ ] Create Vercel project from GitHub
- [ ] Configure Build Settings:
  - Build Command: `npm install --prefix frontend && npm run frontend:build`
  - Output Directory: `frontend/dist`
- [ ] Add all Environment Variables
- [ ] Deploy!
- [ ] Test frontend loads at `your-domain.vercel.app`
- [ ] Check browser console for API connection errors

## Troubleshooting

### "vite: command not found"
- **Cause:** Frontend dependencies not installed
- **Fix:** Check Vercel build logs. Ensure build command includes `npm install --prefix frontend`

### API calls return 404
- **Cause:** `VITE_API_URL` not set or incorrect
- **Fix:** Set correct backend URL in Vercel environment variables

### Rust engine build fails
- **Cause:** Vercel doesn't support Rust compilation by default
- **Fix:** Skip it! The JavaScript fallback in `rust-engine.js` handles LMSR calculations

## Local Development

```bash
# Install dependencies
npm install
npm --prefix frontend install

# Start both frontend and backend
npm run dev

# Frontend only (with proxy to localhost:3001)
npm --prefix frontend run dev

# Backend only
npm run backend:dev
```

## Next Steps

If you want full serverless deployment on Vercel:
1. Refactor backend routes into `api/*.js` files
2. Use connection pooling for database
3. Move long-running jobs to external services (Bull, Temporal, etc.)
