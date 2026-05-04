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

const DELIVERY_QUERY = [
  // Amazon — bare domain (no @) matches all subdomains: email.amazon.in, m.amazon.in, etc.
  'from:amazon.in',
  'from:amazon.com',
  // Flipkart / Ekart
  'from:@flipkart.com',
  'from:@ekartlogistics.com',
  // Fashion / lifestyle
  'from:@myntra.com',
  'from:@nykaa.com',
  'from:@nykaafashion.com',
  'from:@meesho.com',
  'from:@ajio.com',
  'from:@zara.com',
  'from:@hm.com',
  'from:@mango.com',
  'from:@puma.com',
  'from:@nike.com',
  'from:@adidas.com',
  'from:@lenskart.com',
  'from:@decathlon.in',
  // Electronics
  'from:@croma.com',
  'from:@reliancedigital.in',
  'from:@boat-lifestyle.com',
  'from:@gonoise.com',
  'from:@apple.com',
  // Grocery / quick commerce
  'from:@swiggy.in',
  'from:@swiggy.com',
  'from:@blinkit.com',
  'from:@grofers.com',
  'from:@zepto.team',
  'from:@bigbasket.com',
  // Pharma
  'from:@netmeds.com',
  'from:@pharmeasy.in',
  'from:@1mg.com',
  // Other marketplaces
  'from:@snapdeal.com',
  'from:@tatacliq.com',
  'from:@mamaearth.in',
  // Carriers
  'from:@delhivery.com',
  'from:@bluedart.com',
  'from:@dtdc.in',
  'from:@dtdc.com',
  'from:@xpressbees.com',
  'from:@shadowfax.in',
  'from:@ecomexpress.in',
  'from:@shiprocket.in',
  // Broad subject keywords — cast a wide net, Haiku filters false positives
  'subject:order',
  'subject:purchase',
  'subject:confirmed',
  'subject:shipped',
  'subject:dispatched',
  'subject:delivered',
  'subject:delivery',
  'subject:shipment',
  'subject:tracking',
  'subject:invoice',
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
  const parse = s => {
    const n = Math.round(parseFloat(s.replace(/,/g, '')));
    return (n > 0 && n < 500000) ? n : null;
  };
  // "Total" then up to 80 chars of anything (handles separate HTML cells), then optional ₹, then amount
  const t1 = text.match(/(?:grand\s+)?total[^₹\d\n]{0,80}(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (t1) { const n = parse(t1[1]); if (n) return n; }
  // Amount paid / charged
  const t2 = text.match(/(?:amount\s+(?:paid|charged|due)|order\s+total)[^₹\d\n]{0,60}(?:₹|Rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (t2) { const n = parse(t2[1]); if (n) return n; }
  // ₹ / Rs before amount, then "total/paid/charged" nearby
  const t3 = text.match(/(?:₹|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:total|paid|charged)/i);
  if (t3) { const n = parse(t3[1]); if (n) return n; }
  // Fallback: ₹ prefix (Amazon-style, handles "₹249 00" superscript artifact)
  const t4 = text.match(/(?:₹|Rs\.?)\s*([\d,]+)(?:\s+\d{2})?\b/i);
  if (t4) { const n = parse(t4[1]); if (n) return n; }
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
  // Extract order number from full text before truncation — order numbers can appear
  // deep in merchant emails beyond the truncation window
  const amazonOrderMatch = fullText.match(/\b(\d{3}-\d{7}-\d{7})\b/);
  const genericOrderMatch = fullText.match(/\b(?:order|booking|receipt)[\s#:./-]*(?:number|no|id|ref(?:erence)?)?[\s#:./-]+([A-Z0-9]{3,20})\b/i)
    || fullText.match(/#([A-Z0-9]{3,20})\b/);
  const orderNumberHint = amazonOrderMatch ? amazonOrderMatch[1]
    : (genericOrderMatch && !/^(confirmed|placed|received|shipped|dispatched|delivered|update)$/i.test(genericOrderMatch[1])) ? genericOrderMatch[1]
    : null;
  return {
    text,
    imageUrl: extractProductImage(rawHtml),
    price: extractPrice(text),
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

const ECOMM_TOKENS = [
  'order', 'purchase', 'confirmed', 'placed', 'receipt', 'invoice',
  'total', 'amount', 'paid', 'billing address', 'shipping address',
  'subtotal', 'discount', 'cart', 'checkout', 'order summary',
];

const LOGISTICS_TOKENS = [
  'shipped', 'dispatched', 'delivered', 'delivery', 'tracking',
  'shipment', 'awb', 'waybill', 'courier', 'out for delivery',
  'in transit', 'arriving', 'expected by', 'estimated delivery',
  'rto', 'return to origin', 'pickup scheduled',
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

// Pre-body filter: subject + snippet only. We need at least 2 hits from either
// bucket to keep an email for further parsing. This is lenient because the
// Gmail query already narrowed the set.
function isPlausibleDelivery(subject = '', snippet = '') {
  const text = `${subject} ${snippet}`;
  const ecom = countTokens(text, ECOMM_TOKENS);
  const logi = countTokens(text, LOGISTICS_TOKENS);
  return (ecom >= 2) || (logi >= 1) || (ecom >= 1 && logi >= 1);
}

// Post-body filter: full text. Same buckets, same thresholds, but with body
// content included so compound phrases like "shipping address" or
// "out for delivery" actually match.
function isDeliveryEmail(subject = '', snippet = '', body = '') {
  const text = `${subject} ${snippet} ${body.slice(0, 3000)}`;
  const ecom = countTokens(text, ECOMM_TOKENS);
  const logi = countTokens(text, LOGISTICS_TOKENS);
  return (ecom >= 2) || (logi >= 2) || (ecom >= 1 && logi >= 1);
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

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `(${DELIVERY_QUERY}) after:${afterSec}`,
    maxResults: 150,
  });

  const messages = listRes.data.messages || [];
  console.log(`[sync] Gmail returned ${messages.length} messages`);

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
        const { text: body, imageUrl, price, orderNumberHint } = extractBodyAndImage(msg.data.payload);
        console.log(`[sync] PRE-FILTER PASS: "${subject.slice(0,60)}" from=${fromEmail} hasLU=${hasListUnsub} known=${knownSender} plausible=${plausible}`);
        return {
          id, from, subject, snippet, body, imageUrl, price, orderNumberHint,
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
  // REQUIREMENT: every package MUST have an order number OR tracking number.
  // This filters out promotional emails, social notifications, and deal spam
  // that happen to contain e-commerce vocabulary.
  const hasIdentifier = (r) =>
    !!r.trackingNumber || !!(r.orderNumber && r.orderNumber.length >= 3);

  const isDelivery = (r, body = '') => {
    if (!hasIdentifier(r)) return false;
    if (TRUSTED_DELIVERY_SENDERS.has(r.from_address)) return true;
    if (r.trackingNumber) return true;
    if (r.orderNumber && r.orderNumber.length >= 3) return true;
    if (r.stage > 0) return true;
    if (r.stage === 0 && r.orderNumber) return true;
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

  if (pkg.thread_id) {
    const thread = await gmail.users.threads.get({ userId: 'me', id: pkg.thread_id, format: 'minimal' });
    messageIds = (thread.data.messages || []).map(m => m.id);
  } else {
    const q = pkg.tracking_number
      ? pkg.tracking_number
      : pkg.order_number
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
      // Resync searches by thread_id or tracking/order number — emails are already
      // strongly correlated. Only skip unknown senders if there's zero delivery signal.
      if (h('List-Unsubscribe') && !isKnownDeliverySender(extractEmail(from))) {
        if (!isPlausibleDelivery(subject, snippet)) continue;
      }
      const { text: body, imageUrl, price, orderNumberHint } = extractBodyAndImage(msg.data.payload);
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
