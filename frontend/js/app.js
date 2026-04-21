/* =============================================
   app.js — Receipt Parser Demo Frontend
   ============================================= */

// ── Config ──────────────────────────────────────
const RECAPTCHA_SITE_KEY = '6LfWBcAsAAAAALevYvApxaMuEExB-ga4WN_H4QSg'; // Replace with your reCAPTCHA v3 site key
const API_ENDPOINT = '/.netlify/functions/parse-receipt'; // Netlify serverless function

// ── Sample receipt images (public domain / placeholder URLs) ──
// Replace these with actual hosted sample receipt images
const SAMPLES = {
  restaurant: {
    url: '../sample-receipts/restaurant-receipt.jpg',
    label: '🍕 Restaurant'
  },
  grocery: {
    url: '../sample-receipts/Carulla.jpg',
    label: '🛒 Grocery'
  },
  gym: {
    url: '../sample-receipts/gym-invoice.jpg',
    label: '🏋️ Gym Invoice'
  }
};

// ── Static Preview Sample ────────────────────────
const PREVIEW_SAMPLE = {
  merchant_name: "The Golden Fork",
  date: "2025-04-18",
  time: "19:42",
  address: "120 Main St, Austin, TX 78701",
  line_items: [
    { description: "Ribeye Steak", price: 42.00 },
    { description: "Caesar Salad", price: 14.50 },
    { description: "Craft IPA (2x)", price: 18.00 },
    { description: "Crème Brûlée", price: 9.75 }
  ],
  subtotal: 84.25,
  tax: 6.96,
  tip: 15.00,
  total: 106.21,
  payment_method: "Visa •••• 4242",
  currency: "USD",
  receipt_number: "RCP-20250418-0047"
};

// ── Ref Source Tracking ──────────────────────────
function captureRef() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref) {
    sessionStorage.setItem('ref_source', ref);
    if (typeof gtag !== 'undefined') {
      gtag('event', 'referral_source', { source: ref });
    }
  }
}
captureRef();

// ── State ────────────────────────────────────────
let currentFile = null;
let currentSample = null;

// ── DOM References ───────────────────────────────
const dropzone       = document.getElementById('dropzone');
const fileInput      = document.getElementById('file-input');
const previewArea    = document.getElementById('preview-area');
const previewImg     = document.getElementById('preview-img');
const btnClear       = document.getElementById('btn-clear');
const btnParse       = document.getElementById('btn-parse');
const errorMsg       = document.getElementById('error-msg');
const outputIdle     = document.getElementById('output-idle');
const outputLoading  = document.getElementById('output-loading');
const outputResult   = document.getElementById('output-result');
const resultCards    = document.getElementById('result-cards');
const resultTime     = document.getElementById('result-time');
const jsonOutput     = document.getElementById('json-output');
const jsonBlock      = document.getElementById('json-block');
const btnCopyJson    = document.getElementById('btn-copy-json');
// btn-toggle-json removed
const sampleBtns     = document.querySelectorAll('.sample-btn');

// ── Drag & Drop ──────────────────────────────────
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelect(file);
});

dropzone.addEventListener('click', (e) => {
  if (e.target.closest('label') || e.target === fileInput) return;
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFileSelect(fileInput.files[0]);
});

// ── File Select ──────────────────────────────────
function handleFileSelect(file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  const maxSize = 5 * 1024 * 1024; // 5MB

  if (!allowedTypes.includes(file.type)) {
    showError('Please upload a JPG, PNG, or PDF file.');
    return;
  }

  if (file.size > maxSize) {
    showError('File is too large. Maximum size is 5MB.');
    return;
  }

  clearSampleSelection();
  currentFile = file;
  currentSample = null;

  hideError();
  showPreview(file);
  enableParseButton();
}

function showPreview(file) {
  if (file.type === 'application/pdf') {
    // Show a PDF icon placeholder for PDFs
    previewImg.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiMxMTExMTgiLz48dGV4dCB4PSI1MCIgeT0iNTUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM4YThhOWEiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiPlBERjwvdGV4dD48L3N2Zz4=';
  } else {
    const reader = new FileReader();
    reader.onload = (e) => { previewImg.src = e.target.result; };
    reader.readAsDataURL(file);
  }

  dropzone.style.display = 'none';
  previewArea.style.display = 'block';
}

// ── Sample Buttons ───────────────────────────────
sampleBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const sampleKey = btn.dataset.sample;
    const sample = SAMPLES[sampleKey];

    clearSampleSelection();
    btn.classList.add('active');
    currentSample = sampleKey;
    currentFile = null;

    // Show the sample image in preview
    previewImg.src = sample.url;
    dropzone.style.display = 'none';
    previewArea.style.display = 'block';

    hideError();
    enableParseButton();
  });
});

function clearSampleSelection() {
  sampleBtns.forEach((b) => b.classList.remove('active'));
}

// ── Clear Button ─────────────────────────────────
btnClear.addEventListener('click', () => {
  resetUpload();
});

function resetUpload() {
  currentFile = null;
  currentSample = null;
  fileInput.value = '';
  previewImg.src = '';
  previewArea.style.display = 'none';
  dropzone.style.display = 'block';
  clearSampleSelection();
  disableParseButton();
  hideError();
  resetOutput();
}

// ── Parse Button ─────────────────────────────────
function enableParseButton() {
  btnParse.disabled = false;
}

function disableParseButton() {
  btnParse.disabled = true;
}

btnParse.addEventListener('click', handleParse);

// ── Copy JSON Button ──────────────────────────────
btnCopyJson.addEventListener('click', () => {
  const text = jsonOutput.textContent;
  if (!text) return;

  const onCopied = () => {
    btnCopyJson.textContent = 'Copied!';
    btnCopyJson.classList.add('copied');
    setTimeout(() => {
      btnCopyJson.textContent = 'Copy JSON';
      btnCopyJson.classList.remove('copied');
    }, 2000);
  };

  navigator.clipboard.writeText(text).then(onCopied).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    onCopied();
  });
});

async function handleParse() {
  hideError();
  setLoading(true);

  try {
    // 1. Get reCAPTCHA v3 token
    const token = await getRecaptchaToken();

    // 2. Build form data
    const formData = new FormData();
    formData.append('recaptchaToken', token);
    formData.append('ref_source', sessionStorage.getItem('ref_source') || 'direct');

    if (currentFile) {
      formData.append('receipt', currentFile);
    } else if (currentSample) {
      formData.append('sampleKey', currentSample);
      formData.append('sampleUrl', new URL(SAMPLES[currentSample].url, window.location.href).href);
    } else {
      throw new Error('No receipt selected.');
    }

    // 3. Call backend
    const startTime = Date.now();
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      body: formData
    });

    const contentType = response.headers.get('content-type');
    
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error('Request timed out. Try a smaller or single-page receipt.');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Something went wrong. Please try again.');
    }

    // 4. Display result
    displayResult(data, elapsed);

  } catch (err) {
    showError(err.message || 'An unexpected error occurred.');
    setLoading(false);
    showIdle();
  }
}

// ── reCAPTCHA ────────────────────────────────────
function getRecaptchaToken() {
  return new Promise((resolve, reject) => {
    if (typeof grecaptcha === 'undefined') {
      // If reCAPTCHA not loaded, skip (dev mode)
      resolve('dev-token');
      return;
    }
    grecaptcha.ready(() => {
      grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'parse_receipt' })
        .then(resolve)
        .catch(reject);
    });
  });
}

// ── Display Result ───────────────────────────────
function displayResult(data, elapsed, isExample = false) {
  setLoading(false);

  // Show result panel
  outputIdle.style.display = 'none';
  outputLoading.style.display = 'none';
  outputResult.style.display = 'block';

  if (isExample) {
    // Example preview: just show raw JSON, no cards or header chrome
    outputResult.querySelector('.result-header').style.display = 'none';
    resultCards.innerHTML = '';
    jsonOutput.textContent = JSON.stringify(data, null, 2);
    jsonBlock.style.display = 'block';
  } else {
    // Real parse: full card display + JSON shown automatically
    outputResult.querySelector('.result-header').style.display = '';
    jsonBlock.style.display = 'block';

    const badge = outputResult.querySelector('.result-badge');
    badge.textContent = '✓ Parsed Successfully';
    badge.className = 'result-badge';
    resultTime.textContent = `Parsed in ${elapsed}s`;

    resultCards.innerHTML = '';
    const fields = buildDisplayFields(data);
    fields.forEach((field, i) => {
      const card = document.createElement('div');
      card.className = 'result-card';
      card.style.animationDelay = `${i * 0.05}s`;
      card.innerHTML = `
        <span class="card-key">${field.key}</span>
        <span class="card-value ${field.highlight ? 'highlight' : ''}">${field.value}</span>
      `;
      resultCards.appendChild(card);
    });

    jsonOutput.textContent = JSON.stringify(data, null, 2);
  }
}

function buildDisplayFields(data) {
  const fields = [];

  if (data.merchant_name) fields.push({ key: 'Merchant', value: data.merchant_name });
  if (data.date) fields.push({ key: 'Date', value: data.date });
  if (data.time) fields.push({ key: 'Time', value: data.time });
  if (data.address) fields.push({ key: 'Address', value: data.address });

  if (data.line_items && data.line_items.length > 0) {
    const itemsHtml = `<ul class="line-items-list">
      ${data.line_items.slice(0, 5).map(item =>
        `<li>${item.description || item.name || 'Item'} ${item.price ? '— ' + formatCurrency(item.price, data.currency) : ''}</li>`
      ).join('')}
      ${data.line_items.length > 5 ? `<li style="color:var(--text-muted)">+ ${data.line_items.length - 5} more</li>` : ''}
    </ul>`;
    fields.push({ key: 'Line Items', value: itemsHtml });
  }

  if (data.subtotal) fields.push({ key: 'Subtotal', value: formatCurrency(data.subtotal, data.currency) });
  if (data.tax) fields.push({ key: 'Tax', value: formatCurrency(data.tax, data.currency) });
  if (data.tip) fields.push({ key: 'Tip', value: formatCurrency(data.tip, data.currency) });
  if (data.total) fields.push({ key: 'Total', value: formatCurrency(data.total, data.currency), highlight: true });
  if (data.payment_method) fields.push({ key: 'Payment', value: data.payment_method });
  if (data.currency) fields.push({ key: 'Currency', value: data.currency });
  if (data.receipt_number) fields.push({ key: 'Receipt #', value: data.receipt_number });

  return fields;
}

function formatCurrency(amount, currency) {
  if (amount == null) return '—';
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return `${symbol}${num.toFixed(2)}`;
}


// ── UI State Helpers ─────────────────────────────
function setLoading(isLoading) {
  if (isLoading) {
    outputIdle.style.display = 'none';
    outputResult.style.display = 'none';
    outputLoading.style.display = 'flex';
    btnParse.disabled = true;
    btnParse.classList.add('loading');
    btnParse.querySelector('.btn-parse-text').textContent = 'Parsing...';
  } else {
    outputLoading.style.display = 'none';
    btnParse.disabled = false;
    btnParse.classList.remove('loading');
    btnParse.querySelector('.btn-parse-text').textContent = 'Parse Receipt';
  }
}

function showIdle() {
  outputIdle.style.display = 'flex';
  outputLoading.style.display = 'none';
  outputResult.style.display = 'none';
}

function resetOutput() {
  showIdle();
  jsonBlock.style.display = 'none';
}

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.style.display = 'block';
}

function hideError() {
  errorMsg.style.display = 'none';
  errorMsg.textContent = '';
}

// ── Page Load Preview ────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  displayResult(PREVIEW_SAMPLE, null, true);
});
