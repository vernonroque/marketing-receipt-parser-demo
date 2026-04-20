/**
 * parse-receipt.js
 * Netlify Serverless Function — Receipt Parser Backend
 *
 * Responsibilities:
 *  1. Parse multipart form data (file upload or sample URL)
 *  2. Validate reCAPTCHA v3 token
 *  3. Apply IP-based rate limiting (in-memory store)
 *  4. Call RapidAPI Receipt Parser endpoint via axios
 *  5. Return structured JSON to the frontend
 */

const axios = require('axios');
const Busboy = require('busboy');

// ── Rate Limit Store (in-memory) ─────────────────────────────────────────────
// NOTE: In-memory store resets on each cold start (function spin-up).
// For persistent rate limiting across cold starts, replace with Upstash Redis.
// See README.md for instructions on upgrading to Redis.
const rateLimitStore = new Map();

const RATE_LIMIT = {
  MAX_REQUESTS: 3,        // max requests per window per IP
  WINDOW_MS: 24 * 60 * 60 * 1000, // 24-hour window
};

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return false;
  }

  // Reset window if expired
  if (now - record.windowStart > RATE_LIMIT.WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return false;
  }

  if (record.count >= RATE_LIMIT.MAX_REQUESTS) {
    return true;
  }

  record.count += 1;
  return false;
}

function getRemainingRequests(ip) {
  const record = rateLimitStore.get(ip);
  if (!record) return RATE_LIMIT.MAX_REQUESTS;
  return Math.max(0, RATE_LIMIT.MAX_REQUESTS - record.count);
}

// ── reCAPTCHA Verification ────────────────────────────────────────────────────
async function verifyRecaptcha(token) {
  // Skip verification in development if token is 'dev-token'
  if (token === 'dev-token' && process.env.NODE_ENV !== 'production') {
    console.warn('reCAPTCHA skipped in dev mode');
    return true;
  }

  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    console.warn('RECAPTCHA_SECRET_KEY not set — skipping verification');
    return true;
  }

  try {
    const response = await axios.post(
      'https://www.google.com/recaptcha/api/siteverify',
      null,
      {
        params: {
          secret,
          response: token,
        },
      }
    );

    const { success, score, action } = response.data;

    // Require a minimum score of 0.5 (0.0 = bot, 1.0 = human)
    if (!success || score < 0.5) {
      console.warn(`reCAPTCHA failed: success=${success}, score=${score}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('reCAPTCHA verification error:', err.message);
    return false;
  }
}

// ── Parse Multipart Form Data ─────────────────────────────────────────────────
function parseFormData(event) {
  return new Promise((resolve, reject) => {
    const fields = {};
    let fileBuffer = null;
    let fileMimeType = null;
    let fileName = null;

    const contentType = event.headers['content-type'] || event.headers['Content-Type'];

    const busboy = Busboy({ headers: { 'content-type': contentType } });

    busboy.on('file', (fieldname, stream, info) => {
      const { filename, mimeType } = info;
      fileName = filename;
      fileMimeType = mimeType;
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on('field', (fieldname, value) => {
      fields[fieldname] = value;
    });

    busboy.on('close', () => {
      resolve({ fields, fileBuffer, fileMimeType, fileName });
    });

    busboy.on('error', reject);

    // Handle base64-encoded body (Netlify sends binary as base64)
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body || '');

    busboy.write(body);
    busboy.end();
  });
}

// ── Fetch Sample Image as Buffer ──────────────────────────────────────────────
async function fetchSampleImage(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return {
    buffer: Buffer.from(response.data),
    mimeType: response.headers['content-type'] || 'image/jpeg',
  };
}

// ── Call RapidAPI Receipt Parser ──────────────────────────────────────────────
async function callReceiptParserAPI(imageBuffer, mimeType) {
  const rapidApiKey = process.env.RAPIDAPI_KEY;
  const rapidApiHost = process.env.RAPIDAPI_HOST; // e.g. 'receipt-parser3.p.rapidapi.com'
  const rapidApiEndpoint = process.env.RAPIDAPI_ENDPOINT; // e.g. 'https://receipt-parser3.p.rapidapi.com/parse'

  if (!rapidApiKey || !rapidApiHost || !rapidApiEndpoint) {
    throw new Error('RapidAPI environment variables are not configured.');
  }

  // Build multipart form data for RapidAPI
  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', imageBuffer, {
    filename: 'receipt.jpg',
    contentType: mimeType,
  });

  const response = await axios.post(rapidApiEndpoint, form, {
    headers: {
      ...form.getHeaders(),
      'X-RapidAPI-Key': rapidApiKey,
      'X-RapidAPI-Host': rapidApiHost,
    },
    timeout: 25000, // 25s timeout
  });

  return response.data;
}

// ── CORS Headers ──────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Main Handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed.' }),
    };
  }

  // ── 1. Get client IP ────────────────────────────────────────────────────────
  const clientIp =
    event.headers['x-forwarded-for']?.split(',')[0].trim() ||
    event.headers['client-ip'] ||
    'unknown';

  // ── 2. Check rate limit ─────────────────────────────────────────────────────
  if (isRateLimited(clientIp)) {
    return {
      statusCode: 429,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: `You've used all ${RATE_LIMIT.MAX_REQUESTS} free demo parses for today. Subscribe on RapidAPI for unlimited access!`,
      }),
    };
  }

  // ── 3. Parse form data ──────────────────────────────────────────────────────
  let fields, fileBuffer, fileMimeType;

  try {
    const parsed = await parseFormData(event);
    fields = parsed.fields;
    fileBuffer = parsed.fileBuffer;
    fileMimeType = parsed.fileMimeType;
  } catch (err) {
    console.error('Form parse error:', err);
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to read uploaded file.' }),
    };
  }

  // ── 4. Verify reCAPTCHA ─────────────────────────────────────────────────────
  const recaptchaToken = fields.recaptchaToken;
  const recaptchaValid = await verifyRecaptcha(recaptchaToken);

  if (!recaptchaValid) {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Bot detection failed. Please try again.' }),
    };
  }

  // ── 5. Resolve image buffer (uploaded file or sample URL) ───────────────────
  try {
    if (fileBuffer && fileBuffer.length > 0) {
      // Validate file size (5MB limit)
      if (fileBuffer.length > 5 * 1024 * 1024) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'File too large. Maximum size is 5MB.' }),
        };
      }
    } else if (fields.sampleUrl) {
      // Fetch the sample image from its URL
      const sample = await fetchSampleImage(fields.sampleUrl);
      fileBuffer = sample.buffer;
      fileMimeType = sample.mimeType;
    } else {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'No receipt image provided.' }),
      };
    }
  } catch (err) {
    console.error('Image fetch error:', err);
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Could not load the receipt image.' }),
    };
  }

  // ── 6. Call RapidAPI ────────────────────────────────────────────────────────
  try {
    const result = await callReceiptParserAPI(fileBuffer, fileMimeType || 'image/jpeg');

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('RapidAPI error:', err.response?.data || err.message);

    const status = err.response?.status;

    if (status === 429) {
      return {
        statusCode: 429,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'API rate limit reached. Please try again shortly.' }),
      };
    }

    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Receipt parsing failed. Please try a clearer image.' }),
    };
  }
};
