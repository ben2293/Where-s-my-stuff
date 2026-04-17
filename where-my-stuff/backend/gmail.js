const { google } = require('googleapis');
const { parseEmail } = require('./parser');

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
]);

function isKnownDeliverySender(email) {
  const domain = (email.split('@')[1] ?? '').toLowerCase();
  if (KNOWN_DELIVERY_DOMAINS.has(domain)) return true;
  for (const d of KNOWN_DELIVERY_DOMAINS) {
    if (domain.endsWith('.' + d)) return true;
  }
  return false;
}

const DELIVERY_QUERY = [
  // Amazon
  'from:shipped@amazon.in',
  'from:order-update@amazon.in',
  'from:auto-confirm@amazon.in',
  'from:ship-confirm@amazon.in',
  'from:@amazon.in',
  'from:@amazon.com',
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
  // Subject keywords — catches D2C brands (Marchtee etc.) not in sender list
  'subject:shipped',
  'subject:dispatched',
  'subject:delivered',
  'subject:delivery',
  'subject:shipment',
  'subject:"out for delivery"',
  'subject:"in transit"',
  'subject:"order confirmed"',
  'subject:"order placed"',
  'subject:"order received"',
  'subject:"order update"',
  'subject:"your order"',
  'subject:"on its way"',
  'subject:"arriving today"',
  'subject:tracking',
  'subject:invoice',
  'subject:"your package"',
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
  const candidates = [];
  const imgRe = /<img([^>]+)>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[1];
    const srcM = tag.match(/src=["']([^"']+)["']/i);
    if (!srcM) continue;
    const src = srcM[1];
    if (!src.startsWith('http')) continue;
    // Skip obvious non-product images
    if (/pixel|beacon|track(er)?|open\?|spacer|logo|icon|avatar|signature|divider|border|bg|background|separator|blank|clear\.gif|arrow|bullet/i.test(src)) continue;
    // Skip data URIs and tiny tracking pixels
    const wM = tag.match(/width=["']?(\d+)/i);
    const hM = tag.match(/height=["']?(\d+)/i);
    const w = wM ? parseInt(wM[1]) : 999;
    const h = hM ? parseInt(hM[1]) : 999;
    if (w < 60 || h < 60) continue;
    candidates.push({ src, w, h, score: w * h });
  }
  if (!candidates.length) return null;
  // Prefer known product CDNs (ranked)
  const CDN_PRIORITY = [
    // Amazon
    /m\.media-amazon\.com|ssl-images-amazon\.com|images-amazon\.com/i,
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
    const match = candidates.find(c => pattern.test(c.src));
    if (match) return match.src;
  }
  // Largest image otherwise
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
      texts.push(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  const fullText = decodeEntities(texts.join(' '));
  const text = fullText.slice(0, 10000);
  // Extract order number from full text before truncation — order numbers can appear
  // deep in Amazon/merchant emails beyond the truncation window
  const amazonOrderMatch = fullText.match(/\b(\d{3}-\d{7}-\d{7})\b/);
  const orderNumberHint = amazonOrderMatch ? amazonOrderMatch[1] : null;
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

async function syncGmail(userTokens, lastSyncMs, userBlocks = []) {
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

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `(${DELIVERY_QUERY}) after:${afterSec}`,
    maxResults: 150,
  });

  const messages = listRes.data.messages || [];
  const results = [];

  // Batch fetch: 10 at a time to avoid rate limits
  for (let i = 0; i < messages.length; i += 10) {
    const batch = messages.slice(i, i + 10);
    const batchResults = await Promise.all(
      batch.map(async ({ id }) => {
        try {
          const msg = await gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'full',
          });
          const headers = msg.data.payload?.headers || [];
          const h = (name) => headers.find(h => h.name === name)?.value || '';
          const from = h('From');
          const subject = h('Subject');
          const dateStr = h('Date');
          // Skip newsletters/promos — they have List-Unsubscribe
          // But always allow known merchant/carrier domains (they use this header for transactional email too)
          if (h('List-Unsubscribe') && !isKnownDeliverySender(extractEmail(from))) return null;
          // Skip user-learned blocks
          if (isUserBlocked(from, subject, userBlocks)) return null;
          const snippet = decodeEntities(msg.data.snippet || '');
          const { text: body, imageUrl, price, orderNumberHint } = extractBodyAndImage(msg.data.payload);
          const parsed = parseEmail({ from, subject, snippet, body, orderNumberHint });
          return {
            gmail_message_id: id,
            thread_id: msg.data.threadId || null,
            from_address: extractEmail(from),
            image_url: imageUrl,
            price: price,
            ...parsed,
            subject: decodeEntities(subject),
            snippet: snippet.slice(0, 500),
            received_date: dateStr ? new Date(dateStr).getTime() : Date.now(),
          };
        } catch {
          return null;
        }
      })
    );
    // Keep only emails with real delivery signals:
    // must have a tracking/order number OR a stage above 0 (shipped, delivered etc.)
    // This drops promo/marketing emails even from known merchants
    const isDelivery = r =>
      r.trackingNumber ||
      r.orderNumber ||
      r.stage > 0;
    results.push(...batchResults.filter(r => r && isDelivery(r)));
  }

  return { packages: results, freshAccessToken };
}

async function resyncPackage(userTokens, pkg) {
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
      if (h('List-Unsubscribe') && !isKnownDeliverySender(extractEmail(from))) continue;
      const snippet = decodeEntities(msg.data.snippet || '');
      const { text: body, imageUrl, price, orderNumberHint } = extractBodyAndImage(msg.data.payload);
      const parsed = parseEmail({ from, subject, snippet, body, orderNumberHint });
      results.push({
        gmail_message_id: id,
        thread_id: msg.data.threadId || null,
        image_url: imageUrl,
        price,
        ...parsed,
        subject: decodeEntities(subject),
        snippet: snippet.slice(0, 500),
        received_date: dateStr ? new Date(dateStr).getTime() : Date.now(),
      });
    } catch { /* skip bad messages */ }
  }

  if (!results.length) return { package: null, freshAccessToken };
  const best = results.reduce((a, b) => b.stage > a.stage ? b : a);
  return { package: best, freshAccessToken };
}

module.exports = { getAuthUrl, exchangeCode, syncGmail, resyncPackage };
