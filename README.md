# DukaFlow

A point-of-sale app for Kenyan shops: scan and sell, track stock, sell on credit, take M-Pesa, and see daily reports. It works offline and is available in English and Kiswahili.

Built with Next.js (App Router), React, Tailwind CSS and Supabase. Hosted on Vercel.

## Roles

| Role | Can do |
| --- | --- |
| Seller | Sell, see stock and alerts, add customers, record debt repayments, see sales reports |
| Owner | Everything a seller can, plus edit stock and prices, expenses, net profit, shop settings, receipt details and logo, staff, shop code |
| Platform admin | Sees every shop, owner and seller, can change roles, remove staff, and **block or unblock a whole shop** (`/admin`) |

Each shop is separate. Data is protected by Row Level Security in the database. There are no subscriptions.

**Blocking a shop:** in `/admin`, tap **Block shop** on any shop and give a reason. Its owner and staff then see a "Shop access blocked" screen, and the database returns none of the shop's data to them. Tap **Unblock shop** to restore access. This needs `database/migrations/0010_block_shops.sql` (already part of `full_setup.sql`).

## 1. Set up Supabase

1. Create a project at supabase.com.
2. Open **SQL Editor**, paste the whole of `database/full_setup.sql` and run it once.
   (`database/migrations/` holds the same setup in numbered steps, for reference.)
3. **Authentication → URL Configuration**: set **Site URL** to your Vercel address and add it under **Redirect URLs**.
4. Create the platform admin: sign up in the app with `scalpapaschal@gmail.com`. That email is made platform admin automatically by the database. Change its password to something private.

## 2. Deploy on Vercel

1. Import this repository in Vercel. The framework is detected as Next.js.
2. Add the environment variables from `.env.example`:

| Name | Needed | Where to find it |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | the publishable (anon) key |
| `SUPABASE_SERVICE_ROLE_KEY` | for M-Pesa | the secret / service-role key. Server only. |
| `RESEND_API_KEY`, `MAIL_FROM` | to email shop codes | resend.com |
| `MPESA_*` | for M-Pesa STK push | Safaricom Daraja portal |

3. Deploy. Every push to a branch gets its own preview address.

## 3. Run it on your computer

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

## Install on a phone or computer

Open the site in Chrome, Edge or Safari. An **Install** bar appears at the top (and always in Settings → Install the app). On iPhone, tap Share then **Add to Home Screen**. Once installed it opens full screen and keeps working offline; sales made without internet are sent when the connection returns. The install needs the site to be served over HTTPS, which Vercel does.

## Receipts

After a sale, tap **View receipt**. It shows the shop's logo, name, address, phone, email and owner name, the items, total and payment, and can be printed or shared on WhatsApp. Owners set these details in **Settings → Receipt details**. Logos are stored in the `shop-logos` Supabase Storage bucket, which `database/full_setup.sql` creates.

## How a new shop starts

1. The owner signs up and fills in the shop form: logo (optional), shop name, owner's name, phone, email, address and a receipt message. These details appear on every receipt and can be edited later in Settings → Receipt details. A join code like `MAMA-4821` is emailed to them.
2. Sellers sign up, choose **Join a shop** and type the code.

## Project layout

```
database/            SQL for Supabase (full_setup.sql runs everything)
src/app/(app)/       Screens: sell, inventory, payments, customers, reports, alerts, expenses, settings, admin
src/app/api/         Server routes: M-Pesa STK push, M-Pesa callback, email the shop code
src/lib/             Supabase client, data functions, offline queue, language and theme
src/components/      Shared pieces
public/              Icons, manifest, service worker (offline)
```

## Notes

- `next.config.mjs` sets `typescript.ignoreBuildErrors` so the first deploy cannot fail on a type slip. Once a build passes cleanly, remove that line so type errors are caught again.
- The M-Pesa callback address is `https://<your-site>/api/public/mpesa/callback`.
