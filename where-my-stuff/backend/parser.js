// Comprehensive delivery email parser for Indian e-commerce & carriers

const STAGE_PATTERNS = {
  failed: {
    stage: 6,
    patterns: [
      /delivery attempt failed/i,
      /delivery (?:was )?unsuccessful/i,
      /could not (?:be )?delivered/i,
      /\bundelivered\b/i,
      /returned to (?:sender|origin)/i,
      /\brto\b(?:\s|$)/i,
      /return to origin/i,
      /delivery exception/i,
      /unable to deliver/i,
      /no one (?:was )?(?:available|home)/i,
      /refused delivery/i,
      /shipment (?:has been )?returned/i,
    ],
  },
  delivered: {
    stage: 5,
    patterns: [
      /\bdelivered\b/i,
      /successfully delivered/i,
      /shipment (?:has been )?delivered/i,
      /your order has been delivered/i,
      /delivery (?:has been )?completed/i,
      /package (?:has been )?delivered/i,
      /यह डिलीवर हो गया/i,
      /order delivered/i,
      /delivery complete/i,
    ],
  },
  out_for_delivery: {
    stage: 4,
    patterns: [
      /out[\s-]for[\s-]delivery/i,
      /arriving today/i,
      /will (?:be )?delivered today/i,
      /rider (?:has )?picked/i,
      /delivery (?:agent|boy|partner|executive) (?:is )?(?:on the way|heading|out)/i,
      /on (?:the )?way to your address/i,
      /\bofd\b/i,
      /delivering today/i,
      /expected delivery(?::|\.)?(?:\s+)today/i,
      /last[\s-]mile/i,
      /your package is out/i,
    ],
  },
  in_transit: {
    stage: 3,
    patterns: [
      /in[\s-]transit/i,
      /shipment is (?:on the )?move/i,
      /reached .{0,25}(?:facility|hub|center|centre|gateway)/i,
      /at .{0,25}(?:sorting|facility|hub|center|centre|warehouse)/i,
      /sorting (?:center|centre)/i,
      /departed from .{0,25}(?:facility|hub|warehouse)/i,
      /left .{0,25}(?:facility|hub|warehouse|origin)/i,
      /shipment (?:has )?(?:left|departed)/i,
      /package (?:has )?(?:left|departed)/i,
      /transiting/i,
      /moving towards/i,
      /your shipment is (?:on its way|moving)/i,
      /in movement/i,
    ],
  },
  dispatched: {
    stage: 2,
    patterns: [
      /\bshipped\b/i,
      /\bdispatched\b/i,
      /has been shipped/i,
      /has been dispatched/i,
      /order is on its way/i,
      /handed over to (?:the )?(?:courier|carrier|logistics)/i,
      /picked up by (?:the )?(?:courier|carrier)/i,
      /your order has (?:been )?(?:shipped|dispatched)/i,
      /your package is (?:on its way|shipped)/i,
      /shipped (?:via|from|through)/i,
      /(?:awb|waybill)[:\s#]+[A-Z0-9]/i,
      /courier partner/i,
      /consignment (?:no|number)/i,
      /booked with/i,
      /order is shipped/i,
    ],
  },
  processing: {
    stage: 1,
    patterns: [
      /being packed/i,
      /order is (?:being )?packed/i,
      /preparing (?:your )?order/i,
      /getting (?:your order|it) ready/i,
      /order is being processed/i,
      /processing (?:your )?order/i,
      /order (?:has been )?accepted/i,
      /ready to ship/i,
      /getting ready to ship/i,
      /picking and packing/i,
      /seller (?:has )?accepted/i,
      /we're preparing/i,
    ],
  },
  order_confirmed: {
    stage: 0,
    patterns: [
      /order (?:is )?confirmed/i,
      /order (?:has been )?placed/i,
      /order (?:has been )?received/i,
      /thank(?:s| you) for (?:your )?order/i,
      /we(?:'ve| have) received your order/i,
      /payment (?:received|confirmed|successful)/i,
      /your order is confirmed/i,
      /order successfully placed/i,
      /order #.{0,25}confirmed/i,
      /आपका ऑर्डर कन्फर्म/i,
    ],
  },
};

const CARRIER_PATTERNS = [
  { name: 'Delhivery', patterns: [/\bdelhivery\b/i] },
  { name: 'BlueDart', patterns: [/\bblue[\s-]?dart\b/i] },
  { name: 'DTDC', patterns: [/\bDTDC\b/] },
  { name: 'Ekart', patterns: [/\be[\s-]?kart\b/i] },
  { name: 'Xpressbees', patterns: [/\bxpressbees\b/i] },
  { name: 'Shadowfax', patterns: [/\bshadowfax\b/i] },
  { name: 'Ecom Express', patterns: [/\becom[\s-]?express\b/i] },
  { name: 'Amazon Logistics', patterns: [/\bamzl\b/i, /amazon[\s-]?logistics/i] },
  { name: 'India Post', patterns: [/\bindia[\s-]?post\b/i, /\bspeed[\s-]?post\b/i] },
  { name: 'Shiprocket', patterns: [/\bshiprocket\b/i] },
  { name: 'FedEx', patterns: [/\bfedex\b/i] },
  { name: 'DHL', patterns: [/\bDHL\b/] },
  { name: 'Aramex', patterns: [/\baramex\b/i] },
  { name: 'Gati', patterns: [/\bgati\b/i] },
  { name: 'Smartr', patterns: [/\bsmartr[\s-]?logistics\b/i] },
  { name: 'Rivigo', patterns: [/\brivigo\b/i] },
  { name: 'Movin', patterns: [/\bmovin\b/i] },
];

const MERCHANT_FROM_PATTERNS = [
  { name: 'Amazon', patterns: [/@amazon\.(in|com)\b/i] },
  { name: 'Flipkart', patterns: [/@flipkart\.com\b/i] },
  { name: 'Myntra', patterns: [/@myntra\.com\b/i] },
  { name: 'Nykaa', patterns: [/@nykaa\.com\b/i] },
  { name: 'Meesho', patterns: [/@meesho\.com\b/i] },
  { name: 'AJIO', patterns: [/@ajio\.com\b/i] },
  { name: 'Zara', patterns: [/@zara\.com\b/i, /@inditex\./i] },
  { name: 'H&M', patterns: [/@hm\.com\b/i] },
  { name: 'Mango', patterns: [/@mango\.com\b/i] },
  { name: 'Puma', patterns: [/@puma\.com\b/i] },
  { name: 'Nike', patterns: [/@nike\.com\b/i] },
  { name: 'Adidas', patterns: [/@adidas\.com\b/i] },
  { name: 'Swiggy', patterns: [/@swiggy\.com\b/i] },
  { name: 'Blinkit', patterns: [/@blinkit\.com\b/i, /@grofers\.com\b/i] },
  { name: 'Zepto', patterns: [/@zepto\.(team|com|in)\b/i] },
  { name: 'BigBasket', patterns: [/@bigbasket\.com\b/i] },
  { name: 'Tata Cliq', patterns: [/@tatacliq\.com\b/i] },
  { name: 'Snapdeal', patterns: [/@snapdeal\.com\b/i] },
  { name: 'Netmeds', patterns: [/@netmeds\.com\b/i] },
  { name: 'PharmEasy', patterns: [/@pharmeasy\.in\b/i] },
  { name: '1mg', patterns: [/@1mg\.com\b/i] },
  { name: 'Lenskart', patterns: [/@lenskart\.com\b/i] },
  { name: 'Decathlon', patterns: [/@decathlon\.in\b/i] },
  { name: 'Apple', patterns: [/@apple\.com\b/i] },
  { name: 'Croma', patterns: [/@croma\.com\b/i] },
  { name: 'Reliance Digital', patterns: [/@reliancedigital\.in\b/i] },
  { name: 'Nykaa Fashion', patterns: [/@nykaafashion\.com\b/i] },
  { name: 'Mamaearth', patterns: [/@mamaearth\./i] },
  { name: 'boAt', patterns: [/@boat-lifestyle\.com\b/i] },
  { name: 'Noise', patterns: [/@gonoise\.com\b/i] },
];

const MERCHANT_SUBJECT_PATTERNS = [
  { name: 'Amazon', patterns: [/\bamazon\b/i] },
  { name: 'Flipkart', patterns: [/\bflipkart\b/i] },
  { name: 'Myntra', patterns: [/\bmyntra\b/i] },
  { name: 'Nykaa', patterns: [/\bnykaa\b/i] },
  { name: 'Meesho', patterns: [/\bmeesho\b/i] },
  { name: 'AJIO', patterns: [/\bajio\b/i] },
  { name: 'Zara', patterns: [/\bzara\b/i] },
  { name: 'Swiggy', patterns: [/\bswiggy\b/i] },
  { name: 'Blinkit', patterns: [/\bblinkit\b/i] },
  { name: 'Zepto', patterns: [/\bzepto\b/i] },
  { name: 'BigBasket', patterns: [/\bbigbasket\b/i] },
  { name: 'Snapdeal', patterns: [/\bsnapdeal\b/i] },
  { name: 'Tata Cliq', patterns: [/\btata\s*cliq\b/i] },
];

// Words that look like tracking codes but aren't
// Only block generic qualifier words that appear as part of the label, not the value
// e.g. "Tracking Number: X" — don't capture "Number" as the tracking code
const TRACKING_BLACKLIST = /^(number|no|id|code|ref|reference)$/i;

const TRACKING_PATTERNS = [
  // Explicit TRK / AWB keyword with number — highest confidence, check first
  { regex: /\bTRK\s*N[o°]?[\s#.:-]+(\d{6,20})\b/i },
  { regex: /\bAWB\s*N[o°]?[\s#.:-]+([A-Z0-9]{6,20})\b/i },
  { regex: /\b(?:awb|waybill)[\s#.:-]+([A-Z0-9\-]{6,25})\b/i },
  { regex: /\b(?:consignment|shipment)\s+(?:number|no|id)?[\s#.:-]+([A-Z0-9\-]{6,25})\b/i },
  // "Tracking #X"  "Tracking: X"  "Tracking Number: X"  "Tracking No: X"  "Tracking ID - X"
  { regex: /\btracking[\s#:./-]*(?:(?:number|no|id)[\s#:./-]+)?([A-Z0-9\-]{6,25})\b/i },
  // Standard AWB: 2-3 letters + 9-15 digits (e.g. DL123456789, FMPC0172834650)
  { regex: /\b([A-Z]{2,4}\d{9,16})\b/ },
  // Pure numeric AWB 10-18 digits near carrier name
  { regex: /\b(\d{10,18})\b(?=.{0,80}(?:delhivery|dtdc|ekart|bluedart|blue\s?dart|xpressbees|shadowfax|ecom\s?express|india\s?post))/i },
  // Short alphanumeric codes near carrier name
  { regex: /\b([A-Z0-9]{6,12})\b(?=.{0,50}(?:bluedart|blue\s?dart|delhivery|dtdc|ekart|xpressbees|shadowfax|ecom\s?express))/i },
];

function detectStage(text) {
  // Failed is special — can override delivered
  if (STAGE_PATTERNS.failed.patterns.some(p => p.test(text))) {
    return { stage: 6, status: 'Failed / Returned' };
  }
  const ordered = ['delivered', 'out_for_delivery', 'in_transit', 'dispatched', 'processing', 'order_confirmed'];
  for (const key of ordered) {
    if (STAGE_PATTERNS[key].patterns.some(p => p.test(text))) {
      return {
        stage: STAGE_PATTERNS[key].stage,
        status: {
          delivered: 'Delivered',
          out_for_delivery: 'Out for Delivery',
          in_transit: 'In Transit',
          dispatched: 'Dispatched',
          processing: 'Processing',
          order_confirmed: 'Order Confirmed',
        }[key],
      };
    }
  }
  return { stage: 0, status: 'Order Confirmed' };
}

function detectCarrier(from, subject, snippet, body) {
  const combined = `${from} ${subject} ${snippet} ${body}`;
  for (const { name, patterns } of CARRIER_PATTERNS) {
    if (patterns.some(p => p.test(combined))) return name;
  }
  return null;
}

function detectMerchant(from, subject) {
  for (const { name, patterns } of MERCHANT_FROM_PATTERNS) {
    if (patterns.some(p => p.test(from))) return name;
  }
  for (const { name, patterns } of MERCHANT_SUBJECT_PATTERNS) {
    if (patterns.some(p => p.test(subject))) return name;
  }
  // Fallback: extract domain
  const m = from.match(/@([a-z0-9-]+)\./i);
  if (m && !['gmail', 'yahoo', 'outlook', 'hotmail', 'icloud'].includes(m[1])) {
    return m[1].charAt(0).toUpperCase() + m[1].slice(1);
  }
  return 'Unknown';
}

function extractTracking(subject, snippet, body) {
  const text = `${subject} ${snippet} ${body}`;
  for (const { regex } of TRACKING_PATTERNS) {
    const m = text.match(regex);
    if (m && !TRACKING_BLACKLIST.test(m[1])) return m[1];
  }
  return null;
}

// Pure long numeric (9+ digits) = tracking number, not order number
// A real order ID must contain at least one digit.
// This naturally eliminates English words like "Confirmed", "Shipped", "Delivered"
// without needing to blacklist them explicitly.
function isValidOrderId(v) {
  return /\d/.test(v) && !TRACKING_BLACKLIST.test(v);
}

// Loop through ALL regex matches and return first capture that looks like a real order ID.
function firstValid(str, re) {
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(str)) !== null) {
    if (isValidOrderId(m[1])) return m[1];
  }
  return null;
}

function extractOrderNumber(subject, snippet, body) {
  const full = `${subject} ${snippet} ${body}`;

  // 1. Amazon 3-7-7 — unambiguous
  const amazon = full.match(/\b(\d{3}-\d{7}-\d{7})\b/);
  if (amazon) return amazon[1];

  // 2. "order/booking/receipt" keyword — loop ALL matches so we skip blacklisted
  //    words like "Confirmed" and keep scanning for the real ID.
  //    e.g. "Order Confirmed ... receipt for order QPQYZ9" → skips "Confirmed", returns "QPQYZ9"
  const v = firstValid(
    full,
    /\b(?:order|booking|receipt)[\s#:./-]*(?:(?:number|no|id|ref(?:erence)?)[\s#:./-]+)?([A-Z0-9]{4,20})\b/gi
  );
  if (v) return v;

  // 3. "#XXXXX" prefix — strip tracking context first to avoid grabbing tracking numbers
  const noTracking = full.replace(/(?:tracking|awb|waybill|consignment)\b.{0,80}/gi, '');
  const h = firstValid(noTracking, /#([A-Z0-9]{4,20})\b/gi);
  if (h) return h;

  // 4. Body-only fallback — broader sweep
  if (body) {
    const b = firstValid(body, /\border[^\w]{0,5}([A-Z0-9]{4,20})\b/gi);
    if (b) return b;
  }

  return null;
}

function extractExpectedDate(snippet, body) {
  const text = `${snippet} ${body}`;
  const m = text.match(/delivery\s+by[:\s]+(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s+\d{4})?)/i)
    ?? text.match(/(?:expected|get it|deliver[sy]?|arriving?)\s+by\s+((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|today|tomorrow)(?:\s*,?\s*\w+\s*\d*)?)/i)
    ?? text.match(/arriving?\s+(?:by\s+)?((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|today|tomorrow)(?:\s*,?\s*\w+\s*\d*)?)/i)
    ?? text.match(/expected\s+delivery[:\s]+([A-Za-z]+\s+\d{1,2}(?:\s+\w+)?)/i);
  return m ? m[1].trim() : null;
}

function parseEmail({ from, subject, snippet, body = '' }) {
  // Use subject+snippet first; if stage is ambiguous (order_confirmed default), also check body
  const shortText = `${subject} ${snippet}`;
  let { stage, status } = detectStage(shortText);
  // If short text didn't find a definitive stage, try full body
  if (stage === 0 && body) {
    const fromBody = detectStage(body);
    if (fromBody.stage > 0) { stage = fromBody.stage; status = fromBody.status; }
  }
  // If short text gave a lower stage but body says delivered, trust the body
  if (stage < 5 && body) {
    const fromBody = detectStage(body);
    if (fromBody.stage === 5 || fromBody.stage === 6) { stage = fromBody.stage; status = fromBody.status; }
  }
  return {
    merchant: detectMerchant(from, subject),
    carrier: detectCarrier(from, subject, snippet, body),
    trackingNumber: extractTracking(subject, snippet, body),
    orderNumber: extractOrderNumber(subject, snippet, body),
    expectedDate: extractExpectedDate(snippet, body),
    stage,
    status,
  };
}

module.exports = { parseEmail };
