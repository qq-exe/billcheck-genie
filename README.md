# BillCheck Genie — Alipay AI Pay PAYATHON 2026

> **TL;DR**: Snap a receipt, and AI checks it for overcharges, duplicate charges, and missed discounts — one check, one payment.

**Competition**: Alipay AI Pay PAYATHON 2026 | Total prize pool ¥200,000 | Machine Pay (pay-per-use) track
**Registration status**: ⏸️ Waiting for the user to scan the QR code with Alipay on mobile to log in (QR code left in the browser) | Submission deadline Dec 9
**Prize target**: Machine Pay Best Exploration Award ¥10,000 (independent track, less competition)

## 30-Second Pitch (opens with a pain-point scenario)
"Last week I bought 12 things at the supermarket, and on row three of the receipt there was a ¥18.50 duplicate item — the cashier never warns you, and most people never look at their receipts. BillCheck Genie: snap a photo of your receipt, AI reads every line item and price, then automatically checks for duplicates, overcharges, and missed discounts. If something looks wrong, pay ¥1 to unlock the full report. Pay per check — no subscription, settle as you go."

## Core Features (strictly 3, mapped to scoring weights)
1. **Receipt Recognition** (Product Completeness 30%): photo → structured line-by-line items/prices/quantities (multimodal model)
2. **Check Report** (Commercial Performance 25%): duplicate charges, abnormal unit prices (vs. common prices), missed member discounts, with confidence scoring
3. **AI Pay Pay-per-Use** (Payment Integration 25%): ¥1 per check, first check free — closing the discover → use → pay → deliver loop with AI Pay Machine Pay

## Scoring Map (official weights)
- Product Completeness 30%: three-step flow, report in ≤20 seconds
- Payment Integration 25%: native AI Pay integration, verifiable per-usage pricing
- Commercial Performance 25%: free first check → paid deep check conversion; real paying users is a hard metric
- Project Impact 20%: publish real-world test content on Douyin/Xiaohongshu — "How much were you overcharged last time?" — to drive traffic

## Directory
- `README.md` — this file
- `app/index.html` — mobile single page (photo/upload → recognize → report → AI Pay checkout)
- (To integrate AI Pay SDK and complete registration after the user logs in via QR scan)
