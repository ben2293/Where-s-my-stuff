const { google } = require('googleapis');
const { parseEmail, parseEmailsBatch } = require('./parser');

// Smart query — covers all major Indian merchants + carriers + delivery keywords
// This runs AFTER date filtering so the result set is small
// Domains that send transactional delivery emails — exempt from List-Unsubscribe filter
const KNOWN_DELIVERY_DOMAINS = new Set([
  'amazon.in', 'amazon.com',
  'flipkart.com', 'ekartlogistics.com',
  'myntra.com', 'nykaa.com', 'nykaafashion.com',
  'meesho.com', 'ajio.com', 'zara.com', 'hm.com', 'mango.com',
  'puma.com', 'nike.com', 'adidas.com', 'lenskart.com', 'decathlon.in',
  'croma.com', 'reliancedigital.in', 'boat-lifestyle.com', 'gonoise.com',
  'swiggy.in', 'swiggy.com', 'blinkit.com', 'grofers.com', 'zepto.team',
  'bigbasket.com', 'netmeds.com', 'pharmeasy.in', '1mg.com',
  'snapdeal.com', 'tatacliq.com', 'mamaearth.in',
  'delhivery.com', 'bluedart.com', 'dtdc.in', 'dtdc.com', 'xpressbees.com',
  'shadowfax.in', 'ecomexpress.in', 'shiprocket.in',
  'lagavi.in', 'lagavi.com',
  'miduty.in', 'miduty.com',
  'lazyfilms.in', 'lazyfilms.com',
  'firstcry.com', 'purplle.com', 'bewakoof.com', 'limeroad.com',
  'shoppersstop.com', 'pepperfry.com', 'fabindia.com', 'manyavar.com',
  'sugarcosmetics.com', 'wow-skinscience.in', 'mcmg.in',
  'thesouledstore.com', 'bombayshavingcompany.com', 'mokobara.com',
  'headphonezone.in', 'vedantcomputers.com', 'mdcomputers.in',
  'thesleepcompany.in', 'sleepyowl.co', 'blue-tokai.com',
  'dhl.com', 'fedex.com', 'ups.com', 'usps.com',
  'aramex.com', 'indiapost.gov.in',
  'shopifyemail.com', 'myshopify.com', 'shopify.com',
]);

function isKnownDeliverySender(email) {
  const domain = (email.split('@')[1] ?? '').toLowerCase();
  if (KNOWN_DELIVERY_DOMAINS.has(domain)) return true;
  for (const d of KNOWN_DELIVERY_DOMAINS) {
    if (domain.endsWith('.' + d)) return true;
  }
  return false;
}

// Well-known Amazon senders where the event type is unambiguous.
// Used as a MINIMUM stage floor — parser wins if it detects something higher.
// return@/no-reply@ are intentionally excluded from the floor: their content varies
// (cancellations, refunds, surveys) so we let the parser determine stage.
const SENDER_STAGE_FLOOR = {
  'auto-confirm@amazon.in':         0,  // order confirmed
  'auto-confirm@amazon.com':        0,
  'shipment-tracking@amazon.in':    2,  // dispatched / shipped
  'shipment-tracking@amazon.com':   2,
  'order-update@amazon.in':         5,  // delivered
  'order-update@amazon.com':        5,
};

const SENDER_STATUS_FLOOR = {
  'auto-confirm@amazon.in':         'Ordered',
  'auto-confirm@amazon.com':        'Ordered',
  'shipment-tracking@amazon.in':    'Dispatched',
  'shipment-tracking@amazon.com':   'Dispatched',
  'order-update@amazon.in':         'Delivered',
  'order-update@amazon.com':        'Delivered',
};

// Senders we trust as genuine delivery-related emails.
// These bypass the isDelivery filter (no tracking/order number required).
// Stage is still determined by the parser + subject/body keywords — sender just
// guarantees the email is relevant, not what state the package is in.
const TRUSTED_DELIVERY_SENDERS = new Set([
  // Amazon — known transactional addresses
  'auto-confirm@amazon.in',       'auto-confirm@amazon.com',
  'shipment-tracking@amazon.in',  'shipment-tracking@amazon.com',
  'order-update@amazon.in',       'order-update@amazon.com',
  'return@amazon.in',             'return@amazon.com',
  'no-reply@amazon.in',           'no-reply@amazon.com',
  // Flipkart / Ekart
  'no-reply@flipkart.com',
  'no-reply@nct.flipkart.com',
  // Myntra
  'updates@myntra.com',
]);

// Smart query — purely content-based, zero domain dependency.
// These subject keywords catch ANY order/tracking email from ANY sender.
// No domain whitelists. Amazon, Flipkart, Shopify D2C, carrier — all caught
// by what's in the subject line, not who sent it.
const DELIVERY_QUERY = [
  'subject:order',
  'subject:shipped',
  'subject:dispatched',
  'subject:delivered',
  'subject:delivery',
  'subject:tracking',
  'subject:shipment',
  'subject:invoice',
  'subject:confirmed',
  'subject:purchase',
  'subject:awb',
  'subject:package',
  'subject:parcel',
  'subject:waybill',
  'subject:dispatch',
  'subject:consignment',
  'subject:receipt',
  'subject:payment',
  'subject:courier',
  'subject:arriving',
  'subject:status',
  'subject:update',
  'subject:details',
  'subject:confirmation',
  'subject:shipping',
  'subject:transit',
].join(' OR ');

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/callback'
  );
}

function getAuthUrl() {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
  });
}

async function exchangeCode(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data: profile } = await oauth2.userinfo.get();
  return { tokens, profile };
}

function decodeEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)));
}

function extractProductImage(html) {
  if (!html) return null;

  // Truncate at promotional sections — only scan the order-summary portion of the email.
  const PROMO_SPLITTER = /related\s+products|you\s+might\s+also\s+like|recommended\s+for\s+you|customers\s+also\s+bought|complete\s+your\s+purchase|more\s+items\s+to\s+consider|based\s+on\s+your\s+viewing|frequently\s+bought\s+together|customers\s+who\s+bought|sponsored\s+products|learn\s+more\s+about\s+this|get\s+it\s+by|what\s+other\s+items/i;
  const promoMatch = html.match(PROMO_SPLITTER);
  const scanHtml = promoMatch ? html.slice(0, promoMatch.index) : html;

  const candidates = [];
  const imgRe = /<img([^>]+)>/gi;
  let m;
  while ((m = imgRe.exec(scanHtml)) !== null) {
    const tag = m[1];
    const srcM = tag.match(/src=["']([^"']+)["']/i);
    if (!srcM) continue;
    const src = srcM[1];
    if (!src.startsWith('http')) continue;

    // Skip obvious non-product images
    if (/pixel|beacon|track(er)?|open\?|spacer|icon|avatar|signature|divider|border|bg|background|separator|blank|clear\.gif|arrow|bullet/i.test(src)) continue;

    // Check alt text for logo indicators
    const altM = tag.match(/alt=["']([^"']*)["']/i);
    const alt = altM ? altM[1].toLowerCase() : '';
    if (alt.includes('logo') || alt === 'brand' || alt === 'store') continue;

    // Parse dimensions if explicitly declared
    const wM = tag.match(/width=["']?(\d+)/i);
    const hM = tag.match(/height=["']?(\d+)/i);
    const w = wM ? parseInt(wM[1]) : null;
    const h = hM ? parseInt(hM[1]) : null;

    // Skip tiny tracking pixels (only when dimensions are known)
    if ((w !== null && w < 60) || (h !== null && h < 60)) continue;

    // Skip lifestyle banners: anything explicitly declared >350px is a banner,
    // not a product thumbnail. If dimensions are missing, we can't tell — keep it.
    if ((w !== null && w > 350) || (h !== null && h > 350)) continue;

    // Score: prefer square-ish product photos (aspect near 1.0)
    // When dimensions are unknown, use a neutral score based on URL patterns
    const hasDims = w !== null && h !== null;
    const aspect = hasDims ? w / h : 1;
    const aspectScore = 1 - Math.min(Math.abs(aspect - 1), 1);
    const sizeScore = hasDims ? w * h : 150 * 150; // neutral fallback
    // Position bonus: images appearing earlier in HTML are more likely to be the actual product
    const positionBonus = 1 / (1 + m.index / 2000);
    candidates.push({ src, w, h, score: sizeScore * (1 + aspectScore) * positionBonus });
  }
  if (!candidates.length) return null;

  // Prefer known product CDNs (ranked)
  const CDN_PRIORITY = [
    // Amazon product images (not lifestyle banners)
    /m\.media-amazon\.com\/images\/.*\/(?:I|41|51|61)\w{9,}/i,
    // Flipkart / Ekart
    /rukminim\d*\.flixcart\.com|img\.fkcdn\.com/i,
    // Myntra
    /assets\.myntassets\.com/i,
    // Nykaa
    /adn\.nykaa\.com|images\.nykaa\.com/i,
    // Ajio
    /assets\.ajio\.com/i,
    // Meesho
    /images\.meesho\.com|meesho-media/i,
    // Shopify (Marchtee, many D2C brands)
    /cdn\.shopify\.com|\.myshopify\.com/i,
    // Generic CDNs
    /cloudfront\.net|imagedelivery\.net|imgix\.net|cdn\.shopifycloud\.com/i,
    /\.s3\.amazonaws\.com.*\.(jpg|jpeg|png|webp)/i,
    // Any image subdomain
    /(?:^|\.)(?:images?|img|cdn|static|media|assets)\./i,
  ];
  for (const pattern of CDN_PRIORITY) {
    const matches = candidates.filter(c => pattern.test(c.src));
    if (matches.length) {
      matches.sort((a, b) => a.src.localeCompare(b.src) || b.score - a.score);
      return matches[0].src;
    }
  }

  // Largest + most square image otherwise, with position bonus
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].src;
}

function extractPrice(text) {
  const parseVal = s => {
    const n = Math.round(parseFloat(s.replace(/,/g, '')));
    return (n > 0 && n < 500000) ? n : null;
  };

  const hasRupee = /₹|Rs\.?|INR|rupees/i.test(text);
  const hasDollar = /\$|USD|US\s?\$|dollars/i.test(text);
  const currency = hasDollar && !hasRupee ? 'USD' : 'INR';
  const symbol = currency === 'USD' ? '\\$' : '₹';

  // Pattern 1: "Total" / "Grand Total" followed by optional ₹/$ and amount
  // Matches: "Total: ₹1,799.00", "Grand Total $5.00", "Total ₹ 1,234"
  const patternTotal = new RegExp(
    `(?:grand\\s+)?total[^${symbol}\\d\\n]{0,60}(?:${symbol}|Rs\\.?|INR|USD)?\\s*([\\d,]+(?:\\.[\\d]{1,2})?)`,
    'i'
  );
  const m1 = text.match(patternTotal);
  if (m1) { const n = parseVal(m1[1]); if (n) return { amount: n, currency }; }

  // Pattern 2: "Amount paid" / "Amount charged" / "Order total"
  const patternAmount = new RegExp(
    `(?:amount\\s+(?:paid|charged|due)|order\\s+total)[^${symbol}\\d\\n]{0,60}(?:${symbol}|Rs\\.?|INR|USD)?\\s*([\\d,]+(?:\\.[\\d]{1,2})?)`,
    'i'
  );
  const m2 = text.match(patternAmount);
  if (m2) { const n = parseVal(m2[1]); if (n) return { amount: n, currency }; }

  // Pattern 3: ₹/$ before amount, then "total" nearby
  const patternBefore = new RegExp(
    `(?:${symbol}|Rs\\.?|INR|USD)\\s*([\\d,]+(?:\\.[\\d]{1,2})?)\\s*(?:total|paid|charged|grand)`,
    'i'
  );
  const m3 = text.match(patternBefore);
  if (m3) { const n = parseVal(m3[1]); if (n) return { amount: n, currency }; }

  // Pattern 4: Find the LAST ₹/$ amount in the text (totals tend to be at the end)
  const allAmounts = new RegExp(
    `(?:${symbol}|Rs\\.?|INR|USD)\\s*([\\d,]+(?:\\.[\\d]{1,2})?)`,
    'gi'
  );
  let lastMatch = null;
  let match;
  while ((match = allAmounts.exec(text)) !== null) {
    lastMatch = match;
  }
  if (lastMatch) {
    const n = parseVal(lastMatch[1]);
    if (n) return { amount: n, currency };
  }

  return null;
}

function extractBodyAndImage(payload) {
  if (!payload) return { text: '', imageUrl: null };
  const texts = [];
  let rawHtml = '';
  function walk(part) {
    if (!part) return;
    const mime = part.mimeType || '';
    if (mime === 'text/plain' && part.body?.data) {
      texts.push(Buffer.from(part.body.data, 'base64').toString('utf-8'));
    } else if (mime === 'text/html' && part.body?.data) {
      const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
      rawHtml += html;
      const clean = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
      texts.push(clean);
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  const fullText = decodeEntities(texts.join(' '));
  const text = fullText.slice(0, 10000);

  // ─── Order number hint extraction (conservative) ──────────────────────────
  // We ONLY pass hints that look like real order numbers.
  // The parser.js strict validation will double-check anyway.
  const ORDER_HINT_BLACKLIST = /^(confirmed|placed|received|shipped|dispatched|delivered|update|processing|accepted|cancelled|canceled|payment|status|order|number|track|tracking|ref|id|has|been|will|your|this|that|with|from|for|and|the|are|you|not|but|can|had|her|was|one|our|out|day|get|him|his|how|its|may|new|now|old|see|two|who|boy|did|she|use|way|many|oil|sit|set|run|eat|far|sea|eye|ago|off|too|any|say|man|try|ask|end|why|let|put|come|here|just|like|long|make|over|such|take|than|them|well|were|what|have|they|know|want|good|much|some|time|very|tell)$/i;

  function looksLikeOrderNumber(v) {
    if (!v || v.length < 4 || !/\d/.test(v) || ORDER_HINT_BLACKLIST.test(v)) return false;
    if (!/^[A-Za-z0-9][A-Za-z0-9\-_/]+$/.test(v)) return false;
    return true;
  }

  // 1. Amazon format is unmistakable
  const amazonOrderMatch = fullText.match(/\b(\d{3}-\d{7}-\d{7})\b/);
  // 2. Explicit prefix + number keyword (e.g. "order number 12345", "order id: ABC")
  const explicitMatch = fullText.match(/\b(?:order|booking|receipt)[\s#:./-]*(?:number|no|id|ref(?:erence)?)[\s#:./-]+([A-Za-z0-9\-_/]{4,25})\b/i);
  // 3. Hash shorthand (e.g. "order #12345", "order # 12345")
  const hashShorthandMatch = fullText.match(/\b(?:order|booking|receipt)\s*#\s*([A-Za-z0-9\-_/]{4,25})\b/i);
  // 4. Standalone hash prefix (e.g. "#12345")
  const hashMatch = fullText.match(/#\s*([A-Za-z0-9\-_/]{4,25})\b/i);

  const orderNumberHint = (amazonOrderMatch && looksLikeOrderNumber(amazonOrderMatch[1])) ? amazonOrderMatch[1]
    : (explicitMatch && looksLikeOrderNumber(explicitMatch[1])) ? explicitMatch[1]
    : (hashShorthandMatch && looksLikeOrderNumber(hashShorthandMatch[1])) ? hashShorthandMatch[1]
    : (hashMatch && looksLikeOrderNumber(hashMatch[1])) ? hashMatch[1]
    : null;

  const priceResult = extractPrice(text);
  return {
    text,
    imageUrl: extractProductImage(rawHtml),
    price: priceResult?.amount ?? null,
    currency: priceResult?.currency ?? null,
    orderNumberHint,
  };
}

// Extract bare email address from "Name <email>" or raw "email"
function extractEmail(from) {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

// Check if a message is blocked by user-learned rules
function isUserBlocked(from, subject, userBlocks) {
  if (!userBlocks.length) return false;
  const fromEmail = extractEmail(from);
  const subjectLow = subject.toLowerCase();
  for (const block of userBlocks) {
    if (block.type === 'sender' && fromEmail === block.value) return true;
    if (block.type === 'subject_contains' && subjectLow.includes(block.value)) return true;
  }
  return false;
}

// ─── Delivery signal detection ──────────────────────────────────────────────
// Instead of brittle regexes, we count tokens in two buckets:
//   - ecommerce: signals a transaction happened (order, purchase, confirmed, etc.)
//   - logistics: signals something is being moved (shipped, tracking, delivery, etc.)
//
// An email is "delivery-related" if it has meaningful vocabulary from at least
// one bucket. This catches unknown D2C brands, Shopify stores, and indie
// sellers without whitelisting domains or pattern-matching subject lines.

// Indian e-commerce vocabulary — the tokens that appear in order confirmations,
// shipping notifications, and delivery updates from any Indian seller.
// These are sender-agnostic: they work for Amazon, Flipkart, Shopify D2C,
// WooCommerce stores, carrier tracking pages, and handwritten invoice PDFs.
const ECOMM_TOKENS = [
  // Universal order signals
  'order', 'purchase', 'confirmed', 'placed', 'receipt', 'invoice',
  'total', 'amount', 'paid', 'subtotal', 'discount', 'cart', 'checkout',
  'order summary', 'order details', 'order status',
  'thank you for', 'thanks for your', 'view your order',
  // Payment signals (India-specific)
  'payment', 'transaction', 'cod', 'cash on delivery',
  'upi', 'phonepe', 'paytm', 'google pay', 'net banking',
  'rupees', 'inr', 'gst', 'gstin', 'mrp',
  // Item signals
  'item', 'items', 'price', 'qty', 'quantity', 'sku',
  // Indian shipping address signals
  'shipping address', 'billing address', 'pincode', 'pin code',
];

const LOGISTICS_TOKENS = [
  // Universal logistics
  'shipped', 'dispatched', 'delivered', 'delivery', 'tracking',
  'shipment', 'courier', 'out for delivery', 'in transit',
  'arriving', 'expected by', 'estimated delivery', 'pickup scheduled',
  'parcel', 'package', 'consignment', 'carrier',
  'on the way', 'on its way', 'ofd', 'out for',
  'reached', 'hub', 'facility', 'sorting', 'departed',
  'arrival', 'departure', 'picked up', 'manifest',
  // India-specific logistics terms
  'awb', 'waybill', 'docket', 'lr number', 'forwarding number',
  'rto', 'return to origin', 'returned to sender',
  'dispatched via', 'shipped via', 'booked via',
  // Indian carrier names in body text
  'delhivery', 'bluedart', 'dtdc', 'ekart', 'xpressbees',
  'shadowfax', 'ecom express', 'india post', 'speed post',
  'shiprocket', 'pickrr', 'clickpost', 'nimbuspost',
];

function countTokens(text, tokens) {
  // Strip punctuation so "confirmed." and "confirmed" both match
  const t = ` ${text.toLowerCase().replace(/[.,!?:;()\[\]{}"'\-_#@$%&*+=|/\\<>~`]+/g, ' ')} `;
  let count = 0;
  for (const tok of tokens) {
    if (t.includes(` ${tok} `)) count++;
  }
  return count;
}

// Pre-body filter: subject + snippet only.
// Gmail already narrowed by subject keywords (order, purchase, confirmed, etc.).
// Goal: catch ANY email that could be a real order — from any sender, any domain.
// Strategy: vocabulary tokens OR identifier patterns (order #, tracking #, etc.).
//
// Identifier patterns are the strongest signal — an "Order #XXXX" in the subject
// from an unknown D2C brand is a dead giveaway, even without standardized vocabulary.
function isPlausibleDelivery(subject = '', snippet = '') {
  const text = `${subject} ${snippet}`;
  const ecom = countTokens(text, ECOMM_TOKENS);
  const logi = countTokens(text, LOGISTICS_TOKENS);
  if (ecom >= 1 || logi >= 1) return true;
  // No vocab tokens matched — still check for raw identifier patterns.
  // Many D2C/Shopify stores use subjects like "Lagavi — Your order details #LG1234"
  // where the hash is the only machine-recognizable signal.
  return hasIdentifierPattern(text);
}

// Quick scan for order/tracking number patterns in text.
// Catches #XXXX, order no XXXX, tracking #XXXX, AWB XXXX, etc.
// No domain knowledge needed — just structural patterns.
function hasIdentifierPattern(text) {
  // Standalone hash prefix: #XXXX, #XXXX-YYYY, #ABC-123
  if (/#\s*[A-Za-z0-9\-_/]{4,25}/i.test(text)) return true;
  // Explicit order keywords + any alphanumeric identifier nearby
  if (/\b(?:order|booking|receipt)[\s#:./-]*(?:number|no|id|ref(?:erence)?)[\s#:./-]+[A-Za-z0-9]/i.test(text)) return true;
  // Tracking/AWB/waybill patterns
  if (/\b(?:tracking|awb|waybill|consignment|docket|lr)[\s#:./-]*(?:number|no|id)?[\s#:./-]*[A-Z0-9]/i.test(text)) return true;
  // Standard tracking number format: 2-4 uppercase letters + 6-16 digits
  if (/\b[A-Z]{2,4}\d{6,16}\b/.test(text)) return true;
  // Amazon order format: 000-0000000-0000000
  if (/\b\d{3}-\d{7}-\d{7}\b/.test(text)) return true;
  return false;
}

// Post-body filter: full text. Same buckets, same thresholds, but with body
// content included so compound phrases like "shipping address" or
// "out for delivery" actually match.
//
// India-specific: ₹ (rupee symbol) near order/payment text is a unique
// Indian ecom signal that generic spam/marketing doesn't have.
function isDeliveryEmail(subject = '', snippet = '', body = '') {
  const text = `${subject} ${snippet} ${body.slice(0, 3000)}`;
  const ecom = countTokens(text, ECOMM_TOKENS);
  const logi = countTokens(text, LOGISTICS_TOKENS);

  // Standard thresholds
  if (ecom >= 2 || logi >= 2 || (ecom >= 1 && logi >= 1)) return true;

  // India-specific: ₹ (rupee symbol) + order signals = strong Indian ecom
  const hasRupee = /₹|rs\.?\s*\d|inr\s*\d/i.test(text);
  if (hasRupee && ecom >= 1) return true;

  // India-specific: GST + any delivery signal
  const hasGst = /gst(?:in| number| invoice)?/i.test(text);
  if (hasGst && (ecom >= 1 || logi >= 1)) return true;

  // India-specific: AWB/waybill/docket alone is a strong logistics signal
  const hasAwb = /\b(?:awb|waybill|docket|lr)\s*(?:no|num|number|#)?[.\s]*\d/i.test(text);
  if (hasAwb && logi >= 1) return true;

  return false;
}

async function syncGmail(userTokens, lastSyncMs, userBlocks = [], tzOffsetMin) {
  const client = createOAuthClient();
  client.setCredentials({
    access_token: userTokens.access_token,
    refresh_token: userTokens.refresh_token,
  });

  let freshAccessToken = null;
  client.on('tokens', (t) => {
    if (t.access_token) freshAccessToken = t.access_token;
  });

  const gmail = google.gmail({ version: 'v1', auth: client });

  // Default: 90 days back on first sync, else since last sync
  const afterSec = lastSyncMs
    ? Math.floor(lastSyncMs / 1000)
    : Math.floor(Date.now() / 1000) - 90 * 24 * 3600;

  console.log(`[sync] lastSyncMs=${lastSyncMs} afterSec=${afterSec} query=after:${afterSec}`);

  // Paginate through all Gmail results — never miss an email
  const messageIds = [];
  let pageToken = null;
  let totalMessages = 0;
  do {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `(${DELIVERY_QUERY}) after:${afterSec}`,
      maxResults: 150,
      pageToken: pageToken || undefined,
    });
    const msgs = listRes.data.messages || [];
    messageIds.push(...msgs.map(m => m.id));
    totalMessages += msgs.length;
    pageToken = listRes.data.nextPageToken || null;
    console.log(`[sync] Gmail page: ${msgs.length} messages, total so far: ${totalMessages}`);
  } while (pageToken && totalMessages < 500);

  const messages = messageIds.map(id => ({ id }));
  console.log(`[sync] Gmail returned ${messages.length} total messages`);

  // Step 1: fetch all raw email data in parallel (10 at a time — Gmail API, not Haiku)
  const rawEmails = [];
  for (let i = 0; i < messages.length; i += 10) {
    const batch = messages.slice(i, i + 10);
    const fetched = await Promise.all(batch.map(async ({ id }) => {
      try {
        const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        const headers = msg.data.payload?.headers || [];
        const h = name => headers.find(h => h.name === name)?.value || '';
        const from = h('From');
        const subject = h('Subject');
        const dateStr = h('Date');
        const snippet = decodeEntities(msg.data.snippet || '');
        const hasListUnsub = !!h('List-Unsubscribe');
        const fromEmail = extractEmail(from);
        const knownSender = isKnownDeliverySender(fromEmail);
        const plausible = isPlausibleDelivery(subject, snippet);
        if (hasListUnsub && !knownSender && !plausible) {
          console.log(`[sync] PRE-FILTER REJECT: "${subject.slice(0,60)}" from=${fromEmail} hasLU=${hasListUnsub} known=${knownSender} plausible=${plausible}`);
          return null;
        }
        if (isUserBlocked(from, subject, userBlocks)) {
          console.log(`[sync] USER BLOCKED: "${subject.slice(0,60)}" from=${fromEmail}`);
          return null;
        }
        const { text: body, imageUrl, price, currency, orderNumberHint } = extractBodyAndImage(msg.data.payload);
        console.log(`[sync] PRE-FILTER PASS: "${subject.slice(0,60)}" from=${fromEmail} hasLU=${hasListUnsub} known=${knownSender} plausible=${plausible}`);
        return {
          id, from, subject, snippet, body, imageUrl, price, currency, orderNumberHint,
          thread_id: msg.data.threadId || null,
          fromEmail,
          dateStr,
        };
      } catch { return null; }
    }));
    rawEmails.push(...fetched.filter(Boolean));
  }

  // Step 2: parse all at once — regex for clear cases, Haiku batches for ambiguous
  const parseInputs = rawEmails.map(e => ({
    from: e.from, subject: e.subject, snippet: e.snippet,
    body: e.body, orderNumberHint: e.orderNumberHint,
    receivedMs: e.dateStr ? new Date(e.dateStr).getTime() : Date.now(),
  }));
  const parsed = await parseEmailsBatch(parseInputs, tzOffsetMin);

  // Step 3: assemble results and apply sender-based stage floors
  // An identifier (order number or tracking number) is the STRONGEST signal but not
  // the ONLY one. D2C/Shopify stores often use non-standard order formats or hide
  // identifiers in images. Rejecting them at the gate drops legitimate packages.
  // Instead, use a multi-signal approach: identifier > trusted sender > stage > body tokens.
  const hasIdentifier = (r) =>
    !!r.trackingNumber || !!(r.orderNumber && r.orderNumber.length >= 3);

  const isDelivery = (r, body = '') => {
    // Strong signal: has a tracking number or valid order number
    if (r.trackingNumber) return true;
    if (r.orderNumber && r.orderNumber.length >= 3) return true;

    // Known delivery senders are always relevant
    if (TRUSTED_DELIVERY_SENDERS.has(r.from_address)) return true;
    if (isKnownDeliverySender(r.from_address)) return true;

    // Haiku-detected stage > 0 (dispatched/in transit/delivered) is a strong logistics signal
    if (r.stage > 0) return true;

    // Stage 0 (ordered) with no identifier — needs body evidence
    if (r.stage === 0 && isDeliveryEmail(r.subject, r.snippet, body)) return true;

    // Any other unclassified email that still has delivery vocabulary
    if (isDeliveryEmail(r.subject, r.snippet, body)) return true;

    return false;
  };

  const results = rawEmails.map((e, i) => {
    const p = parsed[i];
    if (!p) {
      console.log(`[sync] PARSE FAILED: "${e.subject.slice(0,60)}"`);
      return null;
    }
    const stageFloor = SENDER_STAGE_FLOOR[e.fromEmail] ?? -1;
    if (stageFloor > p.stage) { p.stage = stageFloor; p.status = SENDER_STATUS_FLOOR[e.fromEmail]; }
    const r = {
      gmail_message_id: e.id,
      thread_id: e.thread_id,
      from_address: e.fromEmail,
      image_url: e.imageUrl,
      price: e.price,
      currency: e.currency || 'INR',
      ...p,
      subject: decodeEntities(e.subject),
      snippet: e.snippet.slice(0, 500),
      received_date: e.dateStr ? new Date(e.dateStr).getTime() : Date.now(),
    };
    const pass = isDelivery(r, e.body);
    console.log(`[sync] isDelivery=${pass} stage=${r.stage} order=${r.orderNumber} track=${r.trackingNumber} subject="${r.subject.slice(0,60)}"`);
    return pass ? r : null;
  }).filter(Boolean);

  console.log(`[sync] RESULTS: ${results.length} packages kept out of ${rawEmails.length} raw emails`);
  return { packages: results, freshAccessToken };
}

function isValidSearchQuery(val) {
  if (!val || typeof val !== 'string') return false;
  if (val.length < 4) return false;
  if (!/\d/.test(val)) return false;
  if (/^(confirmed|placed|received|shipped|dispatched|delivered|update|processing|accepted|cancelled|canceled|payment|status|order|number|track|tracking)$/i.test(val)) return false;
  return true;
}

async function resyncPackage(userTokens, pkg, tzOffsetMin) {
  const client = createOAuthClient();
  client.setCredentials({
    access_token: userTokens.access_token,
    refresh_token: userTokens.refresh_token,
  });
  let freshAccessToken = null;
  client.on('tokens', t => { if (t.access_token) freshAccessToken = t.access_token; });
  const gmail = google.gmail({ version: 'v1', auth: client });

  let messageIds = [];
  let searchedByThread = false;

  if (pkg.thread_id) {
    const thread = await gmail.users.threads.get({ userId: 'me', id: pkg.thread_id, format: 'minimal' });
    messageIds = (thread.data.messages || []).map(m => m.id);
    searchedByThread = true;
  } else {
    const q = isValidSearchQuery(pkg.tracking_number)
      ? pkg.tracking_number
      : isValidSearchQuery(pkg.order_number)
      ? `"${pkg.order_number}"`
      : null;
    if (!q) return { package: null, freshAccessToken };
    const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults: 5 });
    messageIds = (listRes.data.messages || []).map(m => m.id);
  }

  const results = [];
  for (const id of messageIds) {
    try {
      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const headers = msg.data.payload?.headers || [];
      const h = (name) => headers.find(h => h.name === name)?.value || '';
      const from = h('From');
      const subject = h('Subject');
      const dateStr = h('Date');
      const snippet = decodeEntities(msg.data.snippet || '');
      const { text: body, imageUrl, price, orderNumberHint } = extractBodyAndImage(msg.data.payload);
      // For thread-based searches (all messages in a thread), filter out
      // non-delivery emails (marketing, feedback) that share the thread.
      // For order/tracking-number-based searches, every result is relevant.
      if (searchedByThread && !isDeliveryEmail(subject, snippet, body)) continue;
      const parsed = await parseEmail({ from, subject, snippet, body, orderNumberHint, receivedMs: dateStr ? new Date(dateStr).getTime() : Date.now() }, tzOffsetMin);
      const fromEmail = extractEmail(from);
      const stageFloor = SENDER_STAGE_FLOOR[fromEmail] ?? -1;
      if (stageFloor > parsed.stage) {
        parsed.stage = stageFloor;
        parsed.status = SENDER_STATUS_FLOOR[fromEmail];
      }
      results.push({
        gmail_message_id: id,
        thread_id: msg.data.threadId || null,
        image_url: imageUrl,
        price,
        ...parsed,
        from_address: decodeEntities(from),
        subject: decodeEntities(subject),
        snippet: snippet.slice(0, 500),
        received_date: dateStr ? new Date(dateStr).getTime() : Date.now(),
        _body: body,
      });
    } catch { /* skip bad messages */ }
  }

  if (!results.length) return { package: null, freshAccessToken };
  // Pick highest stage; on tie pick the most recently received (latest delivery estimate)
  const best = results.reduce((a, b) =>
    b.stage > a.stage ? b :
    b.stage === a.stage && b.received_date > a.received_date ? b : a
  );
  const bestBody = best._body || '';
  delete best._body;
  return { package: best, freshAccessToken, body: bestBody };
}

module.exports = { getAuthUrl, exchangeCode, syncGmail, resyncPackage };
