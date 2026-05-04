const Anthropic = require('@anthropic-ai/sdk');

// ─── Anthropic client (lazy) ───────────────────────────────────────────────

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Resolve a raw date string to YYYY-MM-DD using receivedMs as the anchor for relative expressions.
// Returns null if unparseable.
function resolveToISO(raw, receivedMs, tzOffsetMin) {
  if (!raw) return null;
  const s = raw.trim();
  const lower = s.toLowerCase();

  // Already absolute ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Compute reference date in user's local timezone if offset provided
  let ref;
  if (tzOffsetMin != null) {
    const nowMs = receivedMs || Date.now();
    const localMs = nowMs - tzOffsetMin * 60000;
    ref = new Date(localMs);
    ref.setUTCHours(0, 0, 0, 0);
  } else {
    ref = new Date(receivedMs || Date.now());
    ref.setHours(0, 0, 0, 0);
  }

  if (lower === 'today')    return toISO(ref);
  if (lower === 'tomorrow') { const d = new Date(ref); d.setDate(d.getDate() + 1); return toISO(d); }

  const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const firstWord = lower.split(/[\s,]/)[0];
  const dayIdx = DAY_NAMES.indexOf(firstWord);
  if (dayIdx >= 0) {
    // diff=0 means "same day of week as received" — treat as next occurrence (i.e. >=1)
    const diff = ((dayIdx - ref.getDay() + 7) % 7) || 7;
    const d = new Date(ref);
    d.setDate(d.getDate() + diff);
    // If string also contains a month+day, prefer that for accuracy
    const full = `${s} ${ref.getFullYear()}`;
    const parsed = new Date(full);
    if (!isNaN(parsed.getTime()) && Math.abs(parsed.getTime() - d.getTime()) < 8 * 86400_000) return toISO(parsed);
    return toISO(d);
  }

  // "18 Apr", "Apr 18", "Apr 18, 2025", etc.
  const clean = s.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1');
  const year  = ref.getFullYear();
  const withYear = /\d{4}/.test(clean) ? clean : `${clean} ${year}`;
  const d = new Date(withYear);
  if (!isNaN(d.getTime())) return toISO(d);

  return null;
}

// ─── Stage regex (subject+snippet only — never full body to avoid footer noise) ──

const STAGE_PATTERNS = [
  { stage: 8, status: 'Returned',          patterns: [/refund (?:has been )?(?:processed|credited)/i, /your refund (?:of|for)/i, /return (?:has been )?completed/i] },
  { stage: 7, status: 'Return Initiated',  patterns: [/return (?:has been )?initiated/i, /return (?:request|pickup) (?:accepted|approved|scheduled)/i, /exchange (?:has been )?(?:initiated|accepted)/i] },
  { stage: 6, status: 'Failed / Returned', patterns: [/delivery (?:attempt )?(?:failed|unsuccessful)/i, /could not (?:be )?delivered/i, /\bundelivered\b/i, /\brto\b/i, /return(?:ed)? to (?:sender|origin)/i] },
  { stage: 5, status: 'Delivered',         patterns: [/\bdelivered\b/i, /successfully delivered/i, /order (?:has been )?delivered/i, /delivery (?:completed|complete)/i] },
  { stage: 4, status: 'Out for Delivery',  patterns: [/out[\s-]for[\s-]delivery/i, /arriving today/i, /will (?:be )?delivered today/i, /delivering today/i, /\bofd\b/i] },
  { stage: 3, status: 'In Transit',        patterns: [/in[\s-]transit/i, /reached .{0,25}(?:facility|hub|center)/i, /at .{0,25}sorting/i, /departed from .{0,25}(?:facility|hub)/i] },
  { stage: 2, status: 'Dispatched',        patterns: [/\bshipped\b/i, /\bdispatched\b/i, /\barriving\b/i, /has been shipped/i, /order (?:is )?on its way/i, /order shipped/i, /(?:awb|waybill)[:\s#]+[A-Z0-9]/i] },
  { stage: 1, status: 'Processing',        patterns: [/being packed/i, /preparing (?:your )?order/i, /getting (?:your order|it) ready/i, /ready to ship/i] },
  { stage: 0, status: 'Ordered',            patterns: [/order\s*(?:#[A-Z0-9\-]{2,12}\s+)?(?:is\s+)?confirmed/i, /order (?:has been )?placed/i, /thank(?:s| you) for (?:your )?(?:order|purchase)/i, /payment (?:received|confirmed|successful)/i] },
];

function detectStage(text) {
  for (const { stage, status, patterns } of STAGE_PATTERNS) {
    if (patterns.some(p => p.test(text))) return { stage, status };
  }
  return null; // ambiguous — needs Haiku
}

// ─── Merchant detection ────────────────────────────────────────────────────

const MERCHANT_FROM = [
  { name: 'Amazon',          re: /@(?:[a-z0-9-]+\.)?amazon\.(in|com)\b/i },
  { name: 'Flipkart',        re: /@(?:[a-z0-9-]+\.)?flipkart\.com\b/i },
  { name: 'Myntra',          re: /@(?:[a-z0-9-]+\.)?myntra\.com\b/i },
  { name: 'Nykaa',           re: /@(?:[a-z0-9-]+\.)?nykaa(?:fashion)?\.com\b/i },
  { name: 'Meesho',          re: /@(?:[a-z0-9-]+\.)?meesho\.com\b/i },
  { name: 'AJIO',            re: /@(?:[a-z0-9-]+\.)?ajio\.com\b/i },
  { name: 'Swiggy',          re: /@(?:[a-z0-9-]+\.)?swiggy\.(in|com)\b/i },
  { name: 'Blinkit',         re: /@(?:[a-z0-9-]+\.)?(?:blinkit|grofers)\.com\b/i },
  { name: 'Zepto',           re: /@(?:[a-z0-9-]+\.)?zepto\.(?:team|in)\b/i },
  { name: 'BigBasket',       re: /@(?:[a-z0-9-]+\.)?bigbasket\.com\b/i },
  { name: 'Tata Cliq',       re: /@(?:[a-z0-9-]+\.)?tatacliq\.com\b/i },
  { name: 'Snapdeal',        re: /@(?:[a-z0-9-]+\.)?snapdeal\.com\b/i },
  { name: '1mg',             re: /@(?:[a-z0-9-]+\.)?1mg\.com\b/i },
  { name: 'Pharmeasy',       re: /@(?:[a-z0-9-]+\.)?pharmeasy\.in\b/i },
  { name: 'Netmeds',         re: /@(?:[a-z0-9-]+\.)?netmeds\.com\b/i },
  { name: 'Lenskart',        re: /@(?:[a-z0-9-]+\.)?lenskart\.com\b/i },
  { name: 'Mamaearth',       re: /@(?:[a-z0-9-]+\.)?mamaearth\.in\b/i },
  { name: 'FirstCry',        re: /@(?:[a-z0-9-]+\.)?firstcry\.com\b/i },
  { name: 'Apple',           re: /@(?:[a-z0-9-]+\.)?apple\.com\b/i },
  { name: 'Raspberry Pi',    re: /@(?:[a-z0-9-]+\.)?raspberrypi\.(?:com|org)\b/i },
  // Platform senders — the domain is NOT the merchant. Haiku extracts the real store name.
  { name: 'Shopify',         re: /@(?:[a-z0-9-]+\.)?(?:shopifyemail|myshopify|shopify)\.com\b/i },
];

// Domains that are shipping carriers — NOT merchants.
// Emails from these should use Haiku's merchant detection, not the carrier name.
const CARRIER_DOMAINS = [
  /@(?:[a-z0-9-]+\.)?delhivery\.com\b/i,
  /@(?:[a-z0-9-]+\.)?bluedart\.com\b/i,
  /@(?:[a-z0-9-]+\.)?ekartlogistics\.com\b/i,
  /@(?:[a-z0-9-]+\.)?xpressbees\.com\b/i,
  /@(?:[a-z0-9-]+\.)?shadowfax\.in\b/i,
  /@(?:[a-z0-9-]+\.)?ecomexpress\.in\b/i,
  /@(?:[a-z0-9-]+\.)?shiprocket\.(in|com)\b/i,
  /@(?:[a-z0-9-]+\.)?pickrr\.com\b/i,
  /@(?:[a-z0-9-]+\.)?dtdc\.(in|com)\b/i,
  /@(?:[a-z0-9-]+\.)?indiapost\.gov\.in\b/i,
  /@(?:[a-z0-9-]+\.)?shiptrackr\.(in|com)\b/i,
  /@(?:[a-z0-9-]+\.)?track\.[a-z]+\.(in|com)\b/i,
  /@(?:[a-z0-9-]+\.)? Shiprocket\.com\b/i,
];

function detectMerchant(from) {
  for (const { name, re } of MERCHANT_FROM) {
    if (re.test(from)) return name;
  }
  // Carrier domains should NOT be treated as merchants
  for (const re of CARRIER_DOMAINS) {
    if (re.test(from)) return null;
  }
  const m = from.match(/@(?:[a-z0-9-]+\.)*([a-z0-9-]+)\.(?:in|com|org|co|net|io|store|shop)\b/i);
  if (!m) return null;
  const domain = m[1];
  if (['gmail','yahoo','outlook','hotmail','icloud','mail','info','noreply','t','mg','em','send'].includes(domain)) return null;
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

function isCarrierSender(from) {
  for (const re of CARRIER_DOMAINS) {
    if (re.test(from)) return true;
  }
  return false;
}

// ─── Tracking + order extraction ──────────────────────────────────────────

const TRACKING_BLACKLIST = /^(number|no|id|code|ref|reference)$/i;

const TRACKING_PATTERNS = [
  // Explicit AWB/waybill prefix (very common in Indian logistics)
  /\bAWB\s*N[o°]?[\s#.:-]+([A-Z0-9]{6,20})\b/i,
  /\b(?:awb|waybill)[\s#.:-]+([A-Z0-9\-]{6,25})\b/i,
  // Tracking/consignment/docket with optional number/no/id
  /\b(?:tracking|consignment|docket|lr|reference)[\s#:./-]*(?:number|no|id|num)?[\s#:./-]+([A-Z0-9\-]{6,25})\b/i,
  // Standard Indian tracking format: 2-4 uppercase letters + 6-16 digits (Ekart: FM... / Xpressbees: XP...)
  /\b([A-Z]{2,4}\d{6,16})\b/,
  // India Post / Speed Post format: 2 letters + 9 digits + 2 letters (e.g., EM123456789IN)
  /\b([A-Z]{2}\d{9}[A-Z]{2})\b/,
  // All-numeric tracking (Delhivery, BlueDart, DTDC, Amazon): 8-20 digit numeric
  /\b(\d{10,20})\b/,
];

function extractTracking(text) {
  // Try structured patterns first (explicit labels or known formats)
  for (const re of TRACKING_PATTERNS.slice(0, -1)) {
    const m = text.match(re);
    if (m && !TRACKING_BLACKLIST.test(m[1])) return m[1];
  }
  // Last pattern: all-numeric 10-20 digits. Only extract if near a tracking keyword
  // (AWB, waybill, tracking, courier, docket, LR, consignment) to avoid matching
  // phone numbers, order totals, timestamps, etc.
  const numericPattern = TRACKING_PATTERNS[TRACKING_PATTERNS.length - 1];
  const m = text.match(numericPattern);
  if (m && !TRACKING_BLACKLIST.test(m[1])) {
    // Check if this number appears near tracking vocabulary (within ~50 chars)
    const idx = m.index;
    const context = text.slice(Math.max(0, idx - 50), idx + m[0].length + 50);
    if (/\b(?:awb|waybill|tracking|shipment|courier|docket|consignment|lr|delivery|dispatch)\b/i.test(context)) {
      return m[1];
    }
  }
  return null;
}

// ─── Strict identifier validation ───────────────────────────────────────────
// Order numbers are extremely varied, so regex alone is dangerous.
// We validate extracted candidates with strict rules before trusting them.

const ORDER_WORD_BLACKLIST = /^(confirmed|placed|received|shipped|dispatched|delivered|update|processing|accepted|cancelled|canceled|payment|status|order|number|track|tracking|ref|id|has|been|will|your|this|that|with|from|for|and|the|are|you|not|but|can|had|her|was|one|our|out|day|get|him|his|how|its|may|new|now|old|see|two|who|boy|did|she|use|her|way|many|oil|sit|set|run|eat|far|sea|eye|ago|off|too|any|say|man|try|ask|end|why|let|put|come|here|just|like|long|make|over|such|take|than|them|well|were|what|have|they|know|want|good|much|some|time|very|tell)$/i;

function isValidOrderNumber(val) {
  if (!val || typeof val !== 'string') return false;
  if (val.length < 4) return false;
  if (!/\d/.test(val)) return false;
  if (ORDER_WORD_BLACKLIST.test(val)) return false;
  // Must look like an actual identifier: starts with letter or digit, no spaces
  // Slashes allowed (e.g. "MD/26-27/709527")
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_/]+$/.test(val)) return false;
  return true;
}

function isValidTrackingNumber(val) {
  if (!val || typeof val !== 'string') return false;
  if (val.length < 6) return false;
  if (!/^\d/.test(val) && !/^[A-Z]{2,4}\d/.test(val)) return false;
  if (TRACKING_BLACKLIST.test(val)) return false;
  return true;
}

// ─── Conservative order number extraction ───────────────────────────────────
// ONLY matches patterns where the prefix is explicit.
// "order has been received" → NO match (no explicit number keyword or #)
// "order #12345" → MATCH
// "order number 12345" → MATCH
// "order no 12345" → MATCH
// "order id: ABC-123" → MATCH
// "booking ref: XYZ789" → MATCH
// "#12345" → MATCH (hash prefix is strong signal)

function extractOrderNumber(text, hint) {
  // 1. Use hint only if it passed strict validation
  if (isValidOrderNumber(hint)) return hint;

  // 2. Amazon format is very specific and reliable
  const amazon = text.match(/\b(\d{3}-\d{7}-\d{7})\b/);
  if (amazon && isValidOrderNumber(amazon[1])) return amazon[1];

  // 3. Explicit prefix + keyword: "order number 12345", "Order No. 12345",
  //    "Order ID: ABC-123", "booking ref XYZ789", "order number:12345" etc.
  //    Handles all spacing/punctuation: "order  no :  12345" → matches
  const explicit = text.match(/\b(?:order|booking|receipt)[\s#:./-]*(?:number|no|num|id|ref(?:erence)?)[.\s#:/-]*([A-Za-z0-9\-_/]{4,30})\b/i);
  if (explicit && isValidOrderNumber(explicit[1])) return explicit[1];

  // 4. Hash shorthand with optional spacing: "order#1234", "order # 1234",
  //    "order #12345", "receipt #ABC-123", "booking #XYZ789"
  const hashShorthand = text.match(/\b(?:order|booking|receipt|ref)\s*#*?\s*([A-Za-z0-9\-_/]{4,30})\b/i);
  if (hashShorthand && isValidOrderNumber(hashShorthand[1])) return hashShorthand[1];

  // 5. Standalone hash: "#XXXXX" — strong signal when it looks like an identifier
  const hash = text.match(/#\s*([A-Za-z0-9\-_/]{4,30})\b/i);
  if (hash && isValidOrderNumber(hash[1])) return hash[1];

  // 6. Loose "Order" keyword + nearby alphanumeric — for D2C formats like
  //    "Lagavi — Your order details: LG123456" or "Order ABC-XYZ confirmed"
  //    This is the catch-all for non-standard D2C/Shopify order formats.
  const loose = text.match(/\b(?:order|booking)[^.!?\n]{0,60}?\b([A-Za-z]{1,4}[\s\-_]?\d{3,12})\b/i);
  if (loose && isValidOrderNumber(loose[1].replace(/[\s\-_]/g, '-'))) return loose[1].replace(/[\s\-_]/g, '-');

  return null;
}

function extractExpectedDate(text, receivedMs, tzOffsetMin) {
  const m1 = text.match(/(?:delivery|expected|estimated)\s+by[:\s]+([A-Za-z]+(?:day)?,\s*[A-Za-z]+\s+\d{1,2}(?:,?\s*\d{4})?)/i);
  if (m1) return resolveToISO(m1[1].trim(), receivedMs, tzOffsetMin);
  // "Arriving tomorrow 8 am" / "Arriving Monday, 21 Apr"
  const m2 = text.match(/arriving?\s+(tomorrow|today|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*(?:\s*,?\s*[A-Za-z]+\s*\d*)?)/i);
  if (m2) return resolveToISO(m2[1].trim(), receivedMs, tzOffsetMin);
  const m3 = text.match(/(?:get it|delivers?)\s+by\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*(?:\s+[A-Za-z]+\s+\d+)?|tomorrow|today)/i);
  if (m3) return resolveToISO(m3[1].trim(), receivedMs, tzOffsetMin);
  const m4 = text.match(/expected\s+(tomorrow|today|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*(?:\s*,?\s*[A-Za-z]+\s*\d*)?)/i);
  if (m4) return resolveToISO(m4[1].trim(), receivedMs, tzOffsetMin);
  return null;
}

// ─── Fast regex pass ───────────────────────────────────────────────────────

const CARRIER_MAP = [
  { name: 'Delhivery',     re: /@(?:[a-z0-9-]+\.)?delhivery\.com\b/i },
  { name: 'BlueDart',      re: /@(?:[a-z0-9-]+\.)?bluedart\.com\b/i },
  { name: 'Ekart',         re: /@(?:[a-z0-9-]+\.)?ekartlogistics\.com\b/i },
  { name: 'XpressBees',    re: /@(?:[a-z0-9-]+\.)?xpressbees\.com\b/i },
  { name: 'Shadowfax',     re: /@(?:[a-z0-9-]+\.)?shadowfax\.in\b/i },
  { name: 'Ecom Express',  re: /@(?:[a-z0-9-]+\.)?ecomexpress\.in\b/i },
  { name: 'DTDC',          re: /@(?:[a-z0-9-]+\.)?dtdc\.(in|com)\b/i },
  { name: 'India Post',    re: /@(?:[a-z0-9-]+\.)?indiapost\.gov\.in\b/i },
  { name: 'Shiprocket',    re: /@(?:[a-z0-9-]+\.)?shiprocket\.(in|com)\b/i },
  { name: 'Pickrr',        re: /@(?:[a-z0-9-]+\.)?pickrr\.com\b/i },
  { name: 'Amazon Logistics', re: /@(?:[a-z0-9-]+\.)?amazon\.(in|com)\b/i },
];

function detectCarrier(from) {
  for (const { name, re } of CARRIER_MAP) {
    if (re.test(from)) return name;
  }
  return null;
}

function quickParse({ from, subject, snippet, orderNumberHint, receivedMs, tzOffsetMin }) {
  const shortText = `${subject} ${snippet}`;
  const stageResult = detectStage(shortText);
  const merchant = detectMerchant(from);
  const carrier = detectCarrier(from);
  const trackingNumber = extractTracking(shortText);
  const orderNumber = extractOrderNumber(shortText, orderNumberHint);
  const expectedDate = extractExpectedDate(shortText, receivedMs || Date.now(), tzOffsetMin);
  return { stageResult, merchant, carrier, trackingNumber, orderNumber, expectedDate };
}

// Platform domains — the merchant field will say "Shopify" but the real
// store name needs Haiku extraction. These should never skip Haiku.
const PLATFORM_DOMAINS = new Set(['Shopify', 'Unknown']);

// ─── Confidence gate ────────────────────────────────────────────────────────
// "When you're not sure, use Haiku to confirm. Be frugal — skip only when
//  the source is trusted and the signal is unambiguous."
//
// SKIP Haiku (trusted sources, strong signals):
//   - Known carrier (Delhivery, BlueDart, etc.) + valid tracking
//   - Known merchant (Amazon, Flipkart, Myntra, etc.) + valid order number
//   - Finished package (stage 5+) + any valid identifier from any source
//
// SEND to Haiku (unknown sources need verification, regardless of signals):
//   - Unknown/domain-derived merchant — even with order # and stage
//   - Platform sender (Shopify) — needs real store name + product
//   - Any email with no stage detected
//   - Active packages from non-trusted sources
//
function isConfidentExtraction({ stageResult, merchant, carrier, trackingNumber, orderNumber, expectedDate }) {
  if (!stageResult) return false;

  const hasValidTracking = isValidTrackingNumber(trackingNumber);
  const hasValidOrder = isValidOrderNumber(orderNumber);

  // Platform senders always need Haiku for store name + product
  if (PLATFORM_DOMAINS.has(merchant)) return false;

  const isKnownMerchant = MERCHANT_FROM.some(m => m.name === merchant);
  const isKnownCarrier = CARRIER_MAP.some(c => c.name === carrier);

  // Finished packages (delivered/returned): keep if we have any identifier
  if (stageResult.stage >= 5) {
    if (hasValidTracking || hasValidOrder) return true;
    return false;
  }

  // Active packages (stages 0-4)
  // ONLY skip Haiku for trusted senders with unambiguous signals.
  // Everyone else → Haiku confirms it's real, not marketing/spam.

  // Trusted: known carrier + valid tracking
  if (isKnownCarrier && hasValidTracking) return true;

  // Trusted: known merchant + valid order number
  if (isKnownMerchant && hasValidOrder) return true;

  // Unknown source (domain-derived merchant, new brand, etc.) — Haiku verifies
  return false;
}

// ─── Haiku batch (only for ambiguous emails) ──────────────────────────────

const HAIKU_SYSTEM = `You are a delivery email parser specialized in Indian e-commerce. You receive emails numbered [1], [2], etc.
Each email starts with "Today: YYYY-MM-DD" — use this to resolve relative dates.

IMPORTANT INDIAN CONTEXT:
- Carriers: Delhivery, BlueDart, DTDC, Ekart, Xpressbees, Shadowfax, Ecom Express, India Post, Shiprocket, Pickrr, Amazon Logistics, Flipkart Logistics
- Merchants: Amazon India, Flipkart, Myntra, Nykaa, Meesho, AJIO, Tata Cliq, Snapdeal, Swiggy, Blinkit, Zepto, BigBasket, Netmeds, Pharmeasy, 1mg, Mamaearth, Lenskart, Boat, Noise, Sugar, Wow Skin Science, FirstCry, Purplle, Bewakoof, The Souled Store, Bombay Shaving Company, Mokobara, Blue Tokai, Sleepy Owl — plus thousands of D2C/Shopify brands
- Order formats: Amazon (000-0000000-0000000), Flipkart (OD123456789), Myntra (alphanumeric), Shopify (#1234 or store-prefixed like LG-1234)
- Tracking formats: Delhivery/BlueDart/DTDC (numeric 6-20 digits), Ekart (FM1234567890), Xpressbees (alphanumeric), Shiprocket (numeric)
- Price symbol: ₹ (Indian Rupee)
- Payment: UPI, PhonePe, Paytm, Google Pay, COD (cash on delivery), net banking

Return ONLY a JSON array, one object per email, same order:
[{"stage":"order_confirmed"|"processing"|"dispatched"|"in_transit"|"out_for_delivery"|"delivered"|"failed"|"return_initiated"|"returned","merchant":string,"carrier":string|null,"orderNumber":string|null,"trackingNumber":string|null,"expectedDate":string|null,"productName":string|null}]

Stage: read subject and main body only — ignore nav bars, footers, link text.
- dispatched: shipped/on its way/arriving soon/dispatched via carrier
- delivered: actually received by customer
- return_initiated: return/exchange request created
- returned: refund processed or return completed

merchant: the actual store/brand name, not the email platform. For Shopify emails (sender is shopifyemail.com or myshopify.com), extract the real store name from the email header, greeting, logo, or footer. For marketplace (Amazon/Flipkart/Myntra), use the marketplace name.

carrier: the shipping carrier name if mentioned (Delhivery, BlueDart, DTDC, Ekart, Xpressbees, Shadowfax, Ecom Express, India Post, Shiprocket, etc.) or null.

orderNumber: extract from order number patterns — #XXXX, Order #XXXX, Order ID: XXXX, Order No. XXXX, OD123456 (Flipkart), 000-0000000-0000000 (Amazon), or any alphanumeric identifier near "order" text. Format may have slashes (MD/26-27/709527) or dashes (LG-1234-5678). Return as-is.

trackingNumber: AWB/waybill/tracking/consignment number. Indian carriers use: numeric 6-20 digits (Delhivery, BlueDart, DTDC), alphanumeric (Ekart: FM + digits, Xpressbees: letters+digits), or India Post format. Return as-is.

expectedDate: IMPORTANT — scan the full body for any delivery estimate: "Arriving [day]", "Expected by [date]", "Estimated delivery [date]", "Get it by [date]", "Delivers by [date]", "Delivery by [date]", "Will be delivered by [date]". Return as YYYY-MM-DD using the provided Today date to resolve day names and relative dates. Return null only if truly not found.

productName: the main product ordered (e.g. "Raspberry Pi Zero 2W", "Nike Air Max 90", "Cotton Kurta Set"). Use the order summary/line items in the body. If multiple items, name the first or most prominent. Return null only if truly not found.

Return ONLY the JSON array.`;

async function haikuBatch(emails, tzOffsetMin) {
  // tzOffsetMin is the user's timezone offset in minutes (e.g., -330 for IST UTC+5:30)
  // Positive = west of UTC, negative = east of UTC (matches JS getTimezoneOffset())
  const now = new Date();
  let todayStr;
  if (tzOffsetMin != null) {
    // Shift UTC time by offset to get user's local date
    const localMs = now.getTime() - tzOffsetMin * 60000;
    todayStr = new Date(localMs).toISOString().slice(0, 10);
  } else {
    todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }
  const prompt = emails.map((e, i) => [
    `[${i + 1}] Today: ${todayStr}`,
    `From: ${e.from}`,
    `Subject: ${e.subject}`,
    `Preview: ${e.snippet}`,
    e.body ? `Body: ${e.body.slice(0, 5000)}` : '',
    e.orderNumberHint ? `Order hint: ${e.orderNumberHint}` : '',
  ].filter(Boolean).join('\n')).join('\n\n---\n\n');

  try {
    const res = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: HAIKU_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = res.content[0].text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== emails.length) throw new Error('length mismatch');
    return parsed;
  } catch (e) {
    console.error('[parser] haiku batch error:', e.message);
    return emails.map(() => null);
  }
}

const STAGE_MAP = {
  order_confirmed: { stage: 0, status: 'Ordered' },
  processing:      { stage: 1, status: 'Processing' },
  dispatched:      { stage: 2, status: 'Dispatched' },
  in_transit:      { stage: 3, status: 'In Transit' },
  out_for_delivery:{ stage: 4, status: 'Out for Delivery' },
  delivered:       { stage: 5, status: 'Delivered' },
  failed:          { stage: 6, status: 'Failed / Returned' },
  return_initiated:{ stage: 7, status: 'Return Initiated' },
  returned:        { stage: 8, status: 'Returned' },
};

const BATCH_SIZE = 15;
const BATCH_DELAY_MS = 300;

// Main export: parse a list of emails efficiently
// Regex handles clear-cut cases; Haiku only gets ambiguous ones in batches
async function parseEmailsBatch(emailList, tzOffsetMin) {
  const results = new Array(emailList.length);
  const needsHaiku = []; // { idx, email }

  // Pass 1: fast regex
  for (let i = 0; i < emailList.length; i++) {
    const e = emailList[i];
    const quick = quickParse({ ...e, tzOffsetMin });
    if (isConfidentExtraction(quick)) {
      results[i] = {
        stage: quick.stageResult.stage,
        status: quick.stageResult.status,
        merchant: quick.merchant || 'Unknown',
        carrier: quick.carrier || null,
        trackingNumber: quick.trackingNumber,
        orderNumber: quick.orderNumber,
        expectedDate: quick.expectedDate,
      };
    } else {
      needsHaiku.push({ idx: i, email: e });
    }
  }

  console.log(`[parser] regex resolved ${emailList.length - needsHaiku.length}/${emailList.length}, Haiku needed for ${needsHaiku.length}`);

  // Pass 2: Haiku for the rest, in batches
  for (let i = 0; i < needsHaiku.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    const batch = needsHaiku.slice(i, i + BATCH_SIZE);
    const haikuResults = await haikuBatch(batch.map(x => x.email), tzOffsetMin);
    for (let j = 0; j < batch.length; j++) {
      const { idx, email } = batch[j];
      const h = haikuResults[j];
      if (h) {
        const { stage, status } = STAGE_MAP[h.stage] ?? STAGE_MAP.order_confirmed;
        // Haiku returns expectedDate as YYYY-MM-DD; if not, search subject+snippet+body
        const expectedDate = h.expectedDate || extractExpectedDate(
          `${email.subject} ${email.snippet} ${(email.body || '').slice(0, 1500)}`,
          email.receivedMs,
          tzOffsetMin
        );
        const quickForCarrier = quickParse({ ...email, tzOffsetMin });
        results[idx] = {
          stage, status,
          merchant: normalizeMerchant(h.merchant || quick_merchant(email.from), email.from),
          carrier: h.carrier || quickForCarrier.carrier || null,
          trackingNumber: h.trackingNumber || null,
          orderNumber: h.orderNumber || email.orderNumberHint || null,
          expectedDate,
          productName: h.productName || null,
        };
      } else {
        // Haiku failed — best-effort fallback
        const quick = quickParse({ ...email, tzOffsetMin });
        results[idx] = {
          stage: quick.stageResult?.stage ?? 0,
          status: quick.stageResult?.status ?? 'Order Confirmed',
          merchant: quick.merchant || 'Unknown',
          carrier: quick.carrier || null,
          trackingNumber: quick.trackingNumber,
          orderNumber: quick.orderNumber,
          expectedDate: quick.expectedDate,
        };
      }
    }
  }

  return results;
}

function quick_merchant(from) {
  const m = from.match(/@(?:[a-z0-9-]+\.)*([a-z0-9-]+)\.(?:in|com|org|co|net|io|store|shop)\b/i);
  if (!m) return 'Unknown';
  const d = m[1];
  if (['gmail','yahoo','outlook','hotmail','icloud','mail','info','noreply','t','mg','em','send'].includes(d)) return 'Unknown';
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function normalizeMerchant(name, from) {
  const detected = detectMerchant(from);

  // Known marketplace/merchant domains (Amazon, Flipkart, Myntra, etc.)
  // — the domain IS the merchant, so regex detection wins.
  if (detected) {
    // Platform senders (Shopify, WooCommerce, etc.) — the domain is NOT the merchant.
    // Haiku extracts the real store name from the email body. Prefer Haiku.
    if (PLATFORM_DOMAINS.has(detected) && name && name !== 'Unknown') return name;
    return detected;
  }

  // Carrier senders (Delhivery, BlueDart, etc.) — the domain is the carrier, not merchant.
  // Prefer Haiku's merchant detection, fall back to domain guess.
  if (isCarrierSender(from)) return name || 'Unknown';

  // Unknown sender — prefer Haiku, fall back to domain extraction.
  return name || 'Unknown';
}

// Single-email interface for resync
async function parseEmail(email, tzOffsetMin) {
  const results = await parseEmailsBatch([email], tzOffsetMin);
  return results[0];
}

// Deep enrichment — called only on manual refresh, uses full body to extract
// the actual product name and store name (for platform senders like Shopify).
const DEEP_ENRICH_SYSTEM = `Extract details from this order confirmation email.
Return ONLY valid JSON: {"productName":string|null,"storeName":string|null}

productName: the specific product ordered (e.g. "Raspberry Pi Zero 2W", "2x20 Male Header Pins", "Nike Air Max 90", "Cotton Kurta Set"). Read order line items or product title in the body. First/most prominent if multiple. null if truly absent.

storeName (IMPORTANT for Shopify/Shopifyemail emails): Shopify sends order confirmations for thousands of Indian D2C brands. The sender says "Shopify" but the actual store is in the email — look for the store name in:
- The email header/sender display name (e.g. "Lagavi" in "Lagavi via Shopify")
- The greeting ("Welcome to Lagavi", "Thank you for shopping at Lagavi")
- The header logo/ image alt text
- The footer/store address ("Lagavi, 123 Main St...")
- Order page links (lagavi.com/orders/...)
- Reply-to email domain (support@lagavi.in)

Return the real D2C store name (e.g. "Lagavi", "Miduty", "Bombay Shaving Company"), NOT "Shopify". Return null ONLY for well-known marketplaces where the store name adds no value (Amazon, Flipkart, Myntra, Nykaa, etc.).

Return ONLY the JSON object, no other text.`;

async function deepEnrichEmail({ from, subject, snippet, body }) {
  const prompt = [
    `From: ${from}`,
    `Subject: ${subject}`,
    snippet ? `Preview: ${snippet}` : '',
    body ? `Body: ${body.slice(0, 6000)}` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: DEEP_ENRICH_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = res.content[0].text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[parser] deepEnrich error:', e.message);
    return null;
  }
}

module.exports = {
  parseEmail, parseEmailsBatch, extractExpectedDate, deepEnrichEmail,
  isValidOrderNumber, isValidTrackingNumber,
};
