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
function resolveToISO(raw, receivedMs) {
  if (!raw) return null;
  const s = raw.trim();
  const lower = s.toLowerCase();

  // Already absolute ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const ref = new Date(receivedMs || Date.now());
  ref.setHours(0, 0, 0, 0);

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
  { stage: 0, status: 'Ordered',            patterns: [/order (?:is )?confirmed/i, /order (?:has been )?placed/i, /thank(?:s| you) for (?:your )?order/i, /payment (?:received|confirmed|successful)/i] },
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
  { name: 'BigBasket',       re: /@(?:[a-z0-9-]+\.)?bigbasket\.com\b/i },
  { name: 'Tata Cliq',       re: /@(?:[a-z0-9-]+\.)?tatacliq\.com\b/i },
  { name: 'Snapdeal',        re: /@(?:[a-z0-9-]+\.)?snapdeal\.com\b/i },
  { name: 'Delhivery',       re: /@(?:[a-z0-9-]+\.)?delhivery\.com\b/i },
  { name: 'BlueDart',        re: /@(?:[a-z0-9-]+\.)?bluedart\.com\b/i },
  { name: 'Apple',           re: /@(?:[a-z0-9-]+\.)?apple\.com\b/i },
];

function detectMerchant(from) {
  for (const { name, re } of MERCHANT_FROM) {
    if (re.test(from)) return name;
  }
  const m = from.match(/@([a-z0-9-]+)\.(in|com)\b/i);
  if (!m) return null;
  const domain = m[1];
  if (['gmail','yahoo','outlook','hotmail','icloud'].includes(domain)) return null;
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

// ─── Tracking + order extraction ──────────────────────────────────────────

const TRACKING_BLACKLIST = /^(number|no|id|code|ref|reference)$/i;

const TRACKING_PATTERNS = [
  /\bAWB\s*N[o°]?[\s#.:-]+([A-Z0-9]{6,20})\b/i,
  /\b(?:awb|waybill)[\s#.:-]+([A-Z0-9\-]{6,25})\b/i,
  /\btracking[\s#:./-]*(?:(?:number|no|id)[\s#:./-]+)?([A-Z0-9\-]{6,25})\b/i,
  /\b([A-Z]{2,4}\d{9,16})\b/,
];

function extractTracking(text) {
  for (const re of TRACKING_PATTERNS) {
    const m = text.match(re);
    if (m && !TRACKING_BLACKLIST.test(m[1])) return m[1];
  }
  return null;
}

function extractOrderNumber(text, hint) {
  const amazon = text.match(/\b(\d{3}-\d{7}-\d{7})\b/);
  if (amazon) return amazon[1];
  const kw = text.match(/\b(?:order|booking|receipt)[\s#:./-]*(?:(?:number|no|id|ref(?:erence)?)[\s#:./-]+)?([A-Z0-9]{5,20})\b/i);
  if (kw && !/^(confirmed|placed|received|shipped|dispatched|delivered|update)$/i.test(kw[1])) return kw[1];
  const hash = text.match(/#([A-Z0-9]{6,20})\b/i);
  if (hash) return hash[1];
  return hint || null;
}

function extractExpectedDate(text, receivedMs) {
  const m1 = text.match(/(?:delivery|expected|estimated)\s+by[:\s]+([A-Za-z]+(?:day)?,\s*[A-Za-z]+\s+\d{1,2}(?:,?\s*\d{4})?)/i);
  if (m1) return resolveToISO(m1[1].trim(), receivedMs);
  // "Arriving tomorrow 8 am" / "Arriving Monday, 21 Apr"
  const m2 = text.match(/arriving?\s+(tomorrow|today|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*(?:\s*,?\s*[A-Za-z]+\s*\d*)?)/i);
  if (m2) return resolveToISO(m2[1].trim(), receivedMs);
  const m3 = text.match(/(?:get it|delivers?)\s+by\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*(?:\s+[A-Za-z]+\s+\d+)?|tomorrow|today)/i);
  if (m3) return resolveToISO(m3[1].trim(), receivedMs);
  const m4 = text.match(/expected\s+(tomorrow|today|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*(?:\s*,?\s*[A-Za-z]+\s*\d*)?)/i);
  if (m4) return resolveToISO(m4[1].trim(), receivedMs);
  return null;
}

// ─── Fast regex pass ───────────────────────────────────────────────────────

function quickParse({ from, subject, snippet, orderNumberHint, receivedMs }) {
  const shortText = `${subject} ${snippet}`;
  const stageResult = detectStage(shortText);
  const merchant = detectMerchant(from);
  const trackingNumber = extractTracking(shortText);
  const orderNumber = extractOrderNumber(shortText, orderNumberHint);
  const expectedDate = extractExpectedDate(shortText, receivedMs || Date.now());
  return { stageResult, merchant, trackingNumber, orderNumber, expectedDate };
}

// An email is "resolved" if we have stage + identifier — BUT stage 0-4 always go through
// Haiku: stage 0 to extract expected date + full order context; stage 2-4 for accurate date.
function isResolved({ stageResult, merchant, trackingNumber, orderNumber }) {
  if (!stageResult) return false;
  if (stageResult.stage >= 0 && stageResult.stage <= 4) return false; // always Haiku for active+ordered
  if (stageResult.stage > 0) return true;
  return false;
}

// ─── Haiku batch (only for ambiguous emails) ──────────────────────────────

const HAIKU_SYSTEM = `You are a delivery email parser. You receive emails numbered [1], [2], etc.
Each email starts with "Today: YYYY-MM-DD" — use this to resolve relative dates.
Return ONLY a JSON array, one object per email, same order:
[{"stage":"order_confirmed"|"processing"|"dispatched"|"in_transit"|"out_for_delivery"|"delivered"|"failed"|"return_initiated"|"returned","merchant":string,"carrier":string|null,"orderNumber":string|null,"trackingNumber":string|null,"expectedDate":string|null}]

Stage: read subject and main body only — ignore nav bars, footers, link text.
- dispatched: shipped/on its way/arriving soon
- delivered: actually received by customer
expectedDate: IMPORTANT — scan the full body for any delivery estimate: "Arriving [day]", "Expected by [date]", "Estimated delivery [date]", "Get it by [date]", "Delivers by [date]". Return as YYYY-MM-DD using the provided Today date to resolve day names and relative dates. Return null only if truly not found.
Return ONLY the JSON array.`;

async function haikuBatch(emails) {
  const todayStr = new Date().toISOString().slice(0, 10);
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
async function parseEmailsBatch(emailList) {
  const results = new Array(emailList.length);
  const needsHaiku = []; // { idx, email }

  // Pass 1: fast regex
  for (let i = 0; i < emailList.length; i++) {
    const e = emailList[i];
    const quick = quickParse(e);
    if (isResolved(quick)) {
      results[i] = {
        stage: quick.stageResult.stage,
        status: quick.stageResult.status,
        merchant: quick.merchant || 'Unknown',
        carrier: null,
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
    const haikuResults = await haikuBatch(batch.map(x => x.email));
    for (let j = 0; j < batch.length; j++) {
      const { idx, email } = batch[j];
      const h = haikuResults[j];
      if (h) {
        const { stage, status } = STAGE_MAP[h.stage] ?? STAGE_MAP.order_confirmed;
        // Haiku returns expectedDate as YYYY-MM-DD; if not, search subject+snippet+body
        const expectedDate = h.expectedDate || extractExpectedDate(
          `${email.subject} ${email.snippet} ${(email.body || '').slice(0, 1500)}`,
          email.receivedMs
        );
        results[idx] = {
          stage, status,
          merchant: h.merchant || quick_merchant(email.from),
          carrier: h.carrier || null,
          trackingNumber: h.trackingNumber || null,
          orderNumber: h.orderNumber || email.orderNumberHint || null,
          expectedDate,
        };
      } else {
        // Haiku failed — best-effort fallback
        const quick = quickParse(email);
        results[idx] = {
          stage: quick.stageResult?.stage ?? 0,
          status: quick.stageResult?.status ?? 'Order Confirmed',
          merchant: quick.merchant || 'Unknown',
          carrier: null,
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
  const m = from.match(/@([a-z0-9-]+)\.(in|com)\b/i);
  return m ? (m[1].charAt(0).toUpperCase() + m[1].slice(1)) : 'Unknown';
}

// Single-email interface for resync
async function parseEmail(email) {
  const results = await parseEmailsBatch([email]);
  return results[0];
}

module.exports = { parseEmail, parseEmailsBatch, extractExpectedDate };
