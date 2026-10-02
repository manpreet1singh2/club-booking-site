# Live in the City — Club Booking & Transport Platform

Next.js 16 · React 19 · Prisma 6 (PostgreSQL) · Tailwind 4 · Razorpay · WhatsApp Cloud API

Customers book club entry/tables, pay a 15% advance, receive a QR ticket and WhatsApp confirmations, and can add cab/bike pickup.
Club owners and super admins manage clubs, events, packages, drivers, bookings and Excel exports.

## Local setup
```bash
cp .env.example .env        # fill DATABASE_URL at minimum
npm install
npx prisma db push          # first-time schema creation (see note below)
npm run prisma:seed         # needs SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
npm run dev
```

> **Migrations note:** the `prisma/migrations` folder has no baseline migration, so `migrate deploy` fails on an empty database.
> Use `prisma db push` to create/sync the schema, or generate a baseline with `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`.

## Deploy to Vercel
1. Create a **pooled** Postgres database (Neon / Supabase) and set `DATABASE_URL`.
2. Import the repo in Vercel (framework: Next.js). `postinstall` runs `prisma generate`.
3. Add every variable from `.env.example` (set `TRUST_PROXY=true`; set `CRON_SECRET` = `INTERNAL_JOB_SECRET`).
4. From your machine run `DATABASE_URL=<prod url> npx prisma db push && npm run prisma:seed` once.
5. Razorpay dashboard → Webhooks → `https://<domain>/api/payments/webhook` (events: `payment.captured`, `order.paid`, `payment.failed`), secret = `PAYMENT_WEBHOOK_SECRET`.
6. Meta WhatsApp → approve the six templates named in `.env.example`.
7. `vercel.json` registers cron jobs (notification retry every 5 min, session/booking cleanup daily).
8. Sign in as the seeded admin → **Admin → Settings** shows which integrations are configured.

## Roles
`CUSTOMER` · `CLUB_OWNER` · `SUPER_ADMIN` · `DRIVER` (DB-backed sessions, httpOnly cookie, role guards on every API route).

## Scripts
`npm run dev | build | start | lint | typecheck | prisma:seed`
