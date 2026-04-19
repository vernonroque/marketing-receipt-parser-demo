# Receipt Parser API — Marketing Demo

A live marketing demo for your Receipt Parser API hosted on Netlify.
Lets visitors upload a receipt and see it parsed instantly — no signup required.

---

## Project Structure

```
receipt-parser-demo/
├── frontend/                   # Static website (served by Netlify)
│   ├── index.html              # Main demo page
│   ├── css/
│   │   └── styles.css          # All styles
│   └── js/
│       └── app.js              # Frontend logic (upload, reCAPTCHA, display)
│
├── netlify/
│   └── functions/
│       └── parse-receipt.js    # Serverless backend function
│
├── .env.example                # Template for environment variables
├── .gitignore
├── netlify.toml                # Netlify build + routing config
├── package.json
└── README.md
```

---

## How It Works

```
User uploads receipt (frontend)
        ↓
Get reCAPTCHA v3 token (invisible, no friction)
        ↓
POST to /.netlify/functions/parse-receipt (your serverless backend)
        ↓
Backend: verify reCAPTCHA token with Google
        ↓
Backend: check IP rate limit (3 requests / 24 hours)
        ↓
Backend: call RapidAPI Receipt Parser with your key (never exposed to browser)
        ↓
Return structured JSON to frontend
        ↓
Display parsed fields + raw JSON to user
```

---

## Setup Instructions

### Step 1 — Install Dependencies

```bash
npm install
```

### Step 2 — Set Up reCAPTCHA v3

1. Go to https://www.google.com/recaptcha/admin/create
2. Choose **reCAPTCHA v3**
3. Add your Netlify domain (e.g. `your-site.netlify.app`) and `localhost` for dev
4. Copy your **Site Key** and **Secret Key**
5. Replace `YOUR_RECAPTCHA_SITE_KEY` in these two files:
   - `frontend/index.html` (in the `<script>` tag src URL)
   - `frontend/js/app.js` (in the `RECAPTCHA_SITE_KEY` constant at the top)

### Step 3 — Configure Environment Variables

For **local development**, create a `.env` file:

```bash
cp .env.example .env
```

Then fill in the values in `.env`:

| Variable | Where to find it |
|---|---|
| `RAPIDAPI_KEY` | RapidAPI Dashboard → Apps → your app |
| `RAPIDAPI_HOST` | Your API's endpoint page on RapidAPI (e.g. `receipt-parser3.p.rapidapi.com`) |
| `RAPIDAPI_ENDPOINT` | Full URL of your parse endpoint (e.g. `https://receipt-parser3.p.rapidapi.com/parse`) |
| `RECAPTCHA_SECRET_KEY` | Google reCAPTCHA admin console (the Secret Key, not Site Key) |

### Step 4 — Update RapidAPI Links

Search for `YOUR_RAPIDAPI_PROFILE` in `frontend/index.html` and replace with your actual RapidAPI profile/API URL. It appears in:
- The header Subscribe button
- The result CTA button
- The footer link

### Step 5 — Add Sample Receipts (Optional but Recommended)

In `frontend/js/app.js`, update the `SAMPLES` object with real hosted receipt images:

```javascript
const SAMPLES = {
  restaurant: { url: 'https://your-cdn.com/sample-restaurant-receipt.jpg', label: '🍕 Restaurant' },
  grocery:    { url: 'https://your-cdn.com/sample-grocery-receipt.jpg',    label: '🛒 Grocery'    },
  gas:        { url: 'https://your-cdn.com/sample-gas-receipt.jpg',        label: '⛽ Gas Station' }
};
```

**Tips for sample receipts:**
- Use clear, high-contrast receipt images
- Host them on Netlify itself (put them in `frontend/images/`) or a CDN
- Make sure they parse well — these are your showcase receipts!

### Step 6 — Test Locally

Install Netlify CLI if you haven't:

```bash
npm install -g netlify-cli
```

Run the local dev server (this runs both frontend + serverless functions):

```bash
netlify dev
```

Visit `http://localhost:8888`

---

## Deploying to Netlify

### Option A — Deploy via Netlify CLI

```bash
netlify login
netlify init         # Link to a new or existing site
netlify deploy --prod
```

### Option B — Deploy via Netlify Dashboard (Drag & Drop)

1. Go to https://app.netlify.com
2. Drag your entire `receipt-parser-demo` folder onto the dashboard
3. Netlify will auto-detect `netlify.toml` and configure everything

### Option C — Deploy via GitHub (Recommended)

1. Push this project to a GitHub repo
2. Go to https://app.netlify.com → New site from Git
3. Connect your repo — Netlify will auto-deploy on every push

### Add Environment Variables in Netlify

After deploying, go to:
**Netlify Dashboard → Your Site → Site Settings → Environment Variables**

Add all four variables from `.env.example`. These are kept secret server-side.

---

## Rate Limiting

By default the demo allows **3 parses per IP per 24 hours**.

To change this, edit the constants in `netlify/functions/parse-receipt.js`:

```javascript
const RATE_LIMIT = {
  MAX_REQUESTS: 3,                    // change this number
  WINDOW_MS: 24 * 60 * 60 * 1000,    // change window (currently 24 hours)
};
```

### Upgrading to Persistent Rate Limiting (Upstash Redis)

The default in-memory store resets on every cold start (function spin-up). For
stricter limits that persist across cold starts, use Upstash Redis (free tier available):

1. Create a free Redis database at https://upstash.com
2. Install the client: `npm install @upstash/redis`
3. Replace the `rateLimitStore` Map and `isRateLimited` function with:

```javascript
const { Redis } = require('@upstash/redis');
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN,
});

async function isRateLimited(ip) {
  const key = `rate:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 86400); // 24h TTL
  return count > RATE_LIMIT.MAX_REQUESTS;
}
```

4. Add `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN` to your Netlify environment variables.

---

## Customization

| What | Where |
|---|---|
| Colors / fonts / theme | `frontend/css/styles.css` (CSS variables at top) |
| Hero text | `frontend/index.html` (`.hero` section) |
| API endpoint called | `netlify/functions/parse-receipt.js` (`callReceiptParserAPI`) |
| Rate limit amount | `netlify/functions/parse-receipt.js` (`RATE_LIMIT` constants) |
| Sample receipts | `frontend/js/app.js` (`SAMPLES` object) |
| RapidAPI subscribe links | `frontend/index.html` (search `YOUR_RAPIDAPI_PROFILE`) |

---

## Security Summary

| Threat | Protection |
|---|---|
| API key exposure | Key stored in Netlify env vars, never sent to browser |
| Bot abuse | reCAPTCHA v3 (invisible, scores each request) |
| Manual abuse / scripting | IP rate limiting (3 req / 24h) |
| Oversized uploads | 5MB file size limit enforced server-side |
| Slow loris / timeout attacks | 30s axios timeout on RapidAPI call |
| Clickjacking | `X-Frame-Options: DENY` header |
