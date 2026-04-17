const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STAGE_MAP = {
  'order_confirmed':    { stage: 0, status: 'Order Confirmed' },
  'processing':         { stage: 1, status: 'Processing' },
  'dispatched':         { stage: 2, status: 'Dispatched' },
  'in_transit':         { stage: 3, status: 'In Transit' },
  'out_for_delivery':   { stage: 4, status: 'Out for Delivery' },
  'delivered':          { stage: 5, status: 'Delivered' },
  'failed':             { stage: 6, status: 'Failed / Returned' },
  'return_initiated':   { stage: 7, status: 'Return Initiated' },
  'returned':           { stage: 8, status: 'Returned' },
};

const SYSTEM_PROMPT = `You are a delivery email parser. Given an email, extract delivery information and return ONLY valid JSON with exactly these fields:

{
  "stage": one of: "order_confirmed" | "processing" | "dispatched" | "in_transit" | "out_for_delivery" | "delivered" | "failed" | "return_initiated" | "returned",
  "merchant": string (brand/store name, e.g. "Amazon", "Flipkart", "Marchtee"),
  "carrier": string or null (logistics provider, e.g. "Delhivery", "Ekart", "Amazon Logistics"),
  "orderNumber": string or null (order ID, e.g. "403-4078392-0494706", "P80B2X"),
  "trackingNumber": string or null (shipment tracking code),
  "expectedDate": string or null (expected delivery date as written, e.g. "Tomorrow", "Friday, Apr 18")
}

Rules:
- stage: read the SUBJECT and main body content only. Ignore navigation bars, footers, and link text like "View delivered orders" or "Delivered items". Focus on what the email is actually telling the customer right now.
- order_confirmed = order just placed, payment received
- processing = being packed/prepared
- dispatched = shipped, on its way, estimate given
- in_transit = at facility, sorting center, moving between hubs
- out_for_delivery = arriving today, with delivery agent
- delivered = actually delivered to customer
- failed = delivery attempt failed, returned to sender, RTO
- return_initiated = return/exchange requested or pickup scheduled
- returned = return completed, refund processed
- merchant: infer from sender domain or email content
- orderNumber: prefer Amazon 3-7-7 format. Min 4 chars. Don't return tracking numbers as order numbers.
- Return ONLY the JSON object, no markdown, no explanation.`;

async function parseEmail({ from, subject, snippet, body = '', orderNumberHint = null }) {
  const emailContent = [
    `From: ${from}`,
    `Subject: ${subject}`,
    `Preview: ${snippet}`,
    body ? `Body:\n${body.slice(0, 3000)}` : '',
    orderNumberHint ? `Order number hint (found in full email): ${orderNumberHint}` : '',
  ].filter(Boolean).join('\n\n');

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: emailContent }],
    });

    const raw = response.content[0].text.trim();
    const parsed = JSON.parse(raw);
    const { stage, status } = STAGE_MAP[parsed.stage] ?? STAGE_MAP['order_confirmed'];

    return {
      stage,
      status,
      merchant: parsed.merchant || extractMerchantFallback(from),
      carrier: parsed.carrier || null,
      trackingNumber: parsed.trackingNumber || null,
      orderNumber: parsed.orderNumber || orderNumberHint || null,
      expectedDate: parsed.expectedDate || null,
    };
  } catch (e) {
    console.error('[parser] Haiku error:', e.message);
    // Fallback: return minimal info so the email still shows up
    return {
      stage: 0,
      status: 'Order Confirmed',
      merchant: extractMerchantFallback(from),
      carrier: null,
      trackingNumber: null,
      orderNumber: orderNumberHint || null,
      expectedDate: null,
    };
  }
}

function extractMerchantFallback(from) {
  const m = from.match(/@([a-z0-9-]+)\.(in|com)\b/i);
  if (!m) return 'Unknown';
  const domain = m[1];
  const MAP = {
    amazon: 'Amazon', flipkart: 'Flipkart', myntra: 'Myntra',
    nykaa: 'Nykaa', meesho: 'Meesho', ajio: 'AJIO',
    swiggy: 'Swiggy', blinkit: 'Blinkit', bigbasket: 'BigBasket',
    delhivery: 'Delhivery', bluedart: 'BlueDart', dtdc: 'DTDC',
  };
  return MAP[domain] || (domain.charAt(0).toUpperCase() + domain.slice(1));
}

module.exports = { parseEmail };
