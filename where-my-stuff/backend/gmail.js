const { google } = require('googleapis');
const { parseEmail } = require('./parser');

// Smart query — covers all major Indian merchants + carriers + delivery keywords
// This runs AFTER date filtering so the result set is small
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
  const text = decodeEntities(texts.join(' ')).slice(0, 4000);
  return {
    text,
    imageUrl: extractProductImage(rawHtml),
    price: extractPrice(text),
  };
}

async function syncGmail(userTokens, lastSyncMs) {
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
          // Skip newsletters — they always have List-Unsubscribe
          if (h('List-Unsubscribe') && h('List-ID')) return null;
          const snippet = decodeEntities(msg.data.snippet || '');
          const { text: body, imageUrl, price } = extractBodyAndImage(msg.data.payload);
          const parsed = parseEmail({ from, subject, snippet, body });
          return {
            gmail_message_id: id,
            thread_id: msg.data.threadId || null,
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
    // Drop emails that show no delivery signals — likely newsletters caught by keyword
    const isDelivery = r =>
      r.merchant !== 'Unknown' ||
      r.stage > 0 ||
      r.trackingNumber ||
      r.orderNumber;
    results.push(...batchResults.filter(r => r && isDelivery(r)));
  }

  return { packages: results, freshAccessToken };
}

module.exports = { getAuthUrl, exchangeCode, syncGmail };
