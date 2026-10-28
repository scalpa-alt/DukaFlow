# ShopFlow POS (DukaFlow)

A mobile-first inventory and point-of-sale web app for small retail shops. Scan a product's barcode with your phone camera, build a cart, check out in seconds, and keep track of stock and sales without paperwork.

**Live demo:** [shopflow-pos-three.vercel.app](https://shopflow-pos-three.vercel.app)

## Why it exists

Small shops often track stock and sales by hand, which is slow and makes it easy to miss that an item has run out. ShopFlow gives an attendant one fast screen for selling, plus the stock alerts and sales reports an owner needs to restock on time.

## Features

**Inventory**
- Store each product's barcode, name, price, quantity, category and a per-item low-stock threshold.
- Add, edit and delete products.
- Clear status badges: red **Out of Stock** at zero, orange **Low Stock** at or below the threshold.

**Barcode scanning**
- Scan with the device camera; the item name, price and stock level appear instantly.
- If a barcode isn't found, the app offers to add it as a new product.

**Sales and checkout**
- Scan several items in a row to build a cart with a running total.
- Adjust quantities before confirming.
- On checkout, stock is deducted automatically and the sale is logged with a timestamp, items, quantities and total.

**Low-stock alerts**
- In-app notification when an item falls to or below its threshold (for example, "Item X is running low: 3 left").
- A dedicated Alerts page lists everything that needs restocking.

**Reports**
- Daily, weekly and monthly sales with total revenue and items sold.
- Bar and line charts for sales trends.
- Custom date-range filtering, best-selling items and transaction counts.

**M-Pesa payment confirmation**
- Payment confirmation screen after checkout showing the amount due.
- A section for incoming M-Pesa confirmations (payer name, amount, transaction ID, timestamp).
- Manual matching of a received payment to a pending sale.

## Project status

| Area | Status |
| --- | --- |
| Inventory, scanning, checkout, alerts, reports | Built |
| M-Pesa confirmation screens and data structure | Built |
| Live M-Pesa payments via Safaricom Daraja API (Till/Paybill C2B or STK Push) | Needs a backend webhook, not connected yet |

Automatic M-Pesa matching requires a backend that receives Daraja callbacks and pushes them to the app. Until that is added, payments are confirmed manually from the confirmation screen.

## Tech

- Web app deployed on Vercel
- Camera-based barcode scanning through a web-compatible scanning library
- Database storing products, sales transactions and stock history, structured so reports can be generated efficiently
- Installable on a phone as a progressive web app

## Run locally

You need Node.js and npm ([install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

Open the local address shown in the terminal. Camera scanning needs HTTPS or `localhost`, and a browser with camera permission granted.

## Deploy on Vercel

1. Import this repository in Vercel. The framework is detected automatically; the build command is `npm run build`.
2. Add the variables from `.env.example` under Settings -> Environment Variables.
3. Apply the SQL files in `drizzle/migrations/` to your Supabase database, in order, using the Supabase SQL Editor.
4. Set `MPESA_CALLBACK_URL` to `https://<your-domain>/api/public/mpesa/callback` if you use M-Pesa prompts.

## Author

Built by **Godwin Paschal Mwenda**, Computer Science student at Zetech University.
Contact: godwinpaschalmwenda@gmail.com
