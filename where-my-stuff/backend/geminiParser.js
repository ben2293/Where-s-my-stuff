/**
 * Gemini-Powered Email Parser - FIXED VERSION
 * 
 * KEY FIXES:
 * 1. Better status inference based on email age (old emails = likely delivered)
 * 2. Improved product name extraction from Indian e-commerce emails
 * 3. Smarter Gemini prompt that extracts actual item names
 * 4. Carrier name normalization
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent';

// Indian carriers we support (with proper casing)
const KNOWN_CARRIERS = {
  'delhivery': 'Delhivery',
  'bluedart': 'BlueDart',
  'blue dart': 'BlueDart',
  'dtdc': 'DTDC',
  'ekart': 'Ekart',
  'ekart logistics': 'Ekart',
  'ecom express': 'Ecom Express',
  'ecomexpress': 'Ecom Express',
  'xpressbees': 'Xpressbees',
  'xpress bees': 'Xpressbees',
  'shiprocket': 'Shiprocket',
  'shadowfax': 'Shadowfax',
  'amazon logistics': 'Amazon Logistics',
  'amazon': 'Amazon Logistics',
  'fedex': 'FedEx',
  'dhl': 'DHL',
  'gati': 'Gati',
  'professional couriers': 'Professional Couriers',
  'india post': 'India Post',
  'speed post': 'India Post'
};

// Known Indian e-commerce merchants
const KNOWN_MERCHANTS = {
  'amazon': 'Amazon',
  'flipkart': 'Flipkart',
  'myntra': 'Myntra',
  'nykaa': 'Nykaa',
  'meesho': 'Meesho',
  'ajio': 'AJIO',
  'snapdeal': 'Snapdeal',
  'tata cliq': 'Tata CLiQ',
  'tatacliq': 'Tata CLiQ',
  'reliance digital': 'Reliance Digital',
  'croma': 'Croma',
  'bigbasket': 'BigBasket',
  'blinkit': 'Blinkit',
  'zepto': 'Zepto',
  'swiggy instamart': 'Swiggy Instamart',
  'jiomart': 'JioMart',
  'firstcry': 'FirstCry',
  'bewakoof': 'Bewakoof',
  'the souled store': 'The Souled Store',
  'boat': 'boAt',
  'noise': 'Noise',
  'mamaearth': 'Mamaearth',
  'sugar cosmetics': 'SUGAR Cosmetics',
  'urbanic': 'Urbanic',
  'snitch': 'Snitch'
};

// ============================================
// SMART PRE-FILTER
// ============================================
const SHIPPING_KEYWORDS = [
  'order', 'ordered', 'confirmed', 'placed', 'purchase',
  'ship', 'shipped', 'shipping', 'shipment',
  'dispatch', 'dispatched',
  'courier', 'carrier', 'awb', 'tracking', 'track',
  'consignment', 'parcel', 'package',
  'transit', 'on the way', 'in transit', 'on its way',
  'out for delivery', 'ofd',
  'arriving', 'expected delivery', 'delivery date',
  'deliver', 'delivered', 'delivery',
  'handed over', 'received by',
  'delivery attempt', 'failed delivery',
  // Carrier names
  'delhivery', 'bluedart', 'blue dart', 'dtdc',
  'ekart', 'xpressbees', 'shiprocket', 'shadowfax',
  'ecom express', 'amazon logistics', 'fedex', 'dhl',
  // E-commerce
  'flipkart', 'amazon', 'myntra', 'meesho', 'ajio', 'nykaa',
  'shopify', 'your order is on the way', 'track your order'
];

const EXCLUDE_KEYWORDS = [
  'unsubscribe from shipping', 'shipping policy', 'free shipping offer',
  'shipping rates', 'delivery charges',
  'job', 'career', 'hiring', 'recruitment',
  'newsletter', 'promotional', 'sale alert', 'discount code',
  'password reset', 'verify your email', 'login alert',
  'invoice only', 'payment receipt', 'subscription renewal'
];

function isLikelyShippingEmail(subject, from, bodySnippet) {
  const text = `${subject} ${from} ${bodySnippet}`.toLowerCase();
  
  const hasExcludeKeyword = EXCLUDE_KEYWORDS.some(kw => text.includes(kw));
  if (hasExcludeKeyword) {
    const hasStrongIndicator = [
      'has been shipped', 'has been dispatched', 'is on the way',
      'out for delivery', 'has been delivered', 'tracking number',
      'awb number', 'track your order'
    ].some(kw => text.includes(kw));
    if (!hasStrongIndicator) return false;
  }
  
  const matchedKeywords = SHIPPING_KEYWORDS.filter(kw => text.includes(kw));
  const strongIndicators = [
    'tracking number', 'awb', 'has been shipped', 'has been delivered',
    'out for delivery', 'in transit', 'dispatch', 'shipment'
  ];
  const hasStrongIndicator = strongIndicators.some(kw => text.includes(kw));
  
  return matchedKeywords.length >= 1;}

function getShippingConfidence(subject, from, bodySnippet) {
  const text = `${subject} ${from} ${bodySnippet}`.toLowerCase();
  const matchedKeywords = SHIPPING_KEYWORDS.filter(kw => text.includes(kw));
  return {
    isLikely: isLikelyShippingEmail(subject, from, bodySnippet),
    matchedCount: matchedKeywords.length,
    matchedKeywords: matchedKeywords.slice(0, 5)
  };
}

// ============================================
// IMPROVED GEMINI PROMPT
// ============================================
const EXTRACTION_PROMPT = `You are an expert at parsing Indian e-commerce shipping emails. Extract information ACCURATELY.

CRITICAL RULES:
1. PRODUCT_NAME: Extract the ACTUAL item name (e.g., "Nike Air Max 270", "boAt Airdopes 141", "Samsung Galaxy M34"). 
   - Look in tables, order details sections, or "Items in your order"
   - If multiple items, use first one + "(+N more)"
   - NEVER use order numbers, tracking numbers, or generic text like "your order" as product name
   - If you truly cannot find it, return null

2. MERCHANT: The SELLER/STORE (Flipkart, Amazon, Myntra, Nykaa, etc.)
   - NOT the delivery company
   - For D2C brands via Shopify, use the brand name, not "Shopify"

3. CARRIER: The DELIVERY COMPANY (Delhivery, BlueDart, DTDC, Ekart, Xpressbees, Shiprocket, Shadowfax, etc.)
   - Extract from "shipped via", "delivered by", "carrier:", or tracking section
   - Return null if not mentioned

4. STATUS - Determine from email content:
   - ORDERED = Order confirmed, payment received, not yet shipped
   - SHIPPED = Just dispatched, picked up by courier
   - IN_TRANSIT = On the way, in transit between hubs
   - OUT_FOR_DELIVERY = With delivery agent, arriving today
   - DELIVERED = Successfully delivered
   - EXCEPTION = Failed delivery, returned, issue

5. TRACKING_NUMBER: The shipment AWB/tracking ID (usually 10+ digits), NOT the order number

6. AI_SUMMARY: Write 1-2 helpful sentences about current status. Be specific with dates if mentioned.

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "product_name": "actual item name or null",
  "merchant": "store name",
  "carrier": "delivery company or null",
  "tracking_number": "AWB/tracking ID or null",
  "order_number": "order ID or null",
  "status": "ORDERED|SHIPPED|IN_TRANSIT|OUT_FOR_DELIVERY|DELIVERED|EXCEPTION",
  "expected_delivery": "date string or null",
  "ai_summary": "helpful status summary"
}

EMAIL:
`;

// ============================================
// EMAIL CONTENT CLEANING - IMPROVED
// ============================================
function cleanEmailContent(html, text) {
  let content = text || '';
  
  if (html) {
    // Remove scripts, styles, comments
    let cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    
    // IMPROVED: Better table handling for product details
    // Replace table cells with clear separators
    cleaned = cleaned
      .replace(/<\/th>/gi, ' | ')
      .replace(/<\/td>/gi, ' | ')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n');
    
    // Remove remaining tags but keep their content
    cleaned = cleaned
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&rsquo;/g, "'")
      .replace(/&ldquo;/g, '"')
      .replace(/&rdquo;/g, '"')
      .replace(/&#x20B9;/g, '₹')
      .replace(/&rupee;/gi, '₹');
    
    // Normalize whitespace but keep structure
    cleaned = cleaned
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
    
    if (cleaned.length > content.length) {
      content = cleaned;
    }
  }
  
  // Keep more content for better product extraction (6000 chars)
  if (content.length > 6000) {
    content = content.substring(0, 6000) + '... [truncated]';
  }
  
  return content;
}

// ============================================
// STATUS INFERENCE FROM EMAIL AGE
// ============================================
function inferStatusFromAge(emailDate, parsedStatus) {
  if (!emailDate) return parsedStatus;
  
  const emailTime = new Date(emailDate).getTime();
  const now = Date.now();
  const daysSinceEmail = (now - emailTime) / (1000 * 60 * 60 * 24);
  
  // If email is old and status is still "in transit", it's probably delivered
  // Indian deliveries typically complete within 7-10 days
  if (daysSinceEmail > 14 && ['IN_TRANSIT', 'SHIPPED', 'OUT_FOR_DELIVERY'].includes(parsedStatus)) {
    return 'DELIVERED';
  }
  
  // If email is 7+ days old and status is SHIPPED, likely in transit or delivered
  if (daysSinceEmail > 7 && parsedStatus === 'SHIPPED') {
    return 'IN_TRANSIT';
  }
  
  return parsedStatus;
}

// ============================================
// CARRIER & MERCHANT NORMALIZATION
// ============================================
function normalizeCarrier(carrier) {
  if (!carrier) return null;
  const key = carrier.toLowerCase().trim();
  return KNOWN_CARRIERS[key] || carrier;
}

function normalizeMerchant(merchant) {
  if (!merchant) return 'Unknown';
  const key = merchant.toLowerCase().trim();
  return KNOWN_MERCHANTS[key] || merchant;
}

function extractMerchantFromEmail(fromEmail) {
  if (!fromEmail) return 'Unknown';
  const lower = fromEmail.toLowerCase();
  
  for (const [pattern, name] of Object.entries(KNOWN_MERCHANTS)) {
    if (lower.includes(pattern)) return name;
  }
  
  // Extract from domain
  const match = fromEmail.match(/@([^.]+)/);
  if (match) {
    const domain = match[1].toLowerCase();
    return KNOWN_MERCHANTS[domain] || match[1].charAt(0).toUpperCase() + match[1].slice(1);
  }
  
  return 'Unknown';
}

// ============================================
// PARSE SINGLE EMAIL WITH GEMINI
// ============================================
async function parseEmailWithGemini(emailData, apiKey) {
  const { subject, from, html, text, date } = emailData;
  const cleanedContent = cleanEmailContent(html, text);
  
  const fullPrompt = EXTRACTION_PROMPT + `
Subject: ${subject}
From: ${from}
Date: ${date}

Body:
${cleanedContent}
`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 600,
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!responseText) throw new Error('No response from Gemini');

    // Clean JSON response
    let jsonStr = responseText.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);
    return normalizeGeminiResponse(parsed, emailData);
    
  } catch (error) {
    console.error('Error parsing email with Gemini:', error.message);
    return createFallbackResponse(emailData);
  }
}

// ============================================
// NORMALIZE GEMINI RESPONSE
// ============================================
function normalizeGeminiResponse(parsed, emailData) {
  // Normalize carrier
  const carrier = normalizeCarrier(parsed.carrier);
  
  // Normalize merchant
  let merchant = normalizeMerchant(parsed.merchant);
  if (merchant === 'Unknown') {
    merchant = extractMerchantFromEmail(emailData.from);
  }
  
  // Normalize status
  const statusMap = {
    'ordered': 'ORDERED',
    'confirmed': 'ORDERED',
    'order confirmed': 'ORDERED',
    'order placed': 'ORDERED',
    'shipped': 'SHIPPED',
    'dispatched': 'SHIPPED',
    'picked up': 'SHIPPED',
    'in transit': 'IN_TRANSIT',
    'in_transit': 'IN_TRANSIT',
    'on the way': 'IN_TRANSIT',
    'out for delivery': 'OUT_FOR_DELIVERY',
    'out_for_delivery': 'OUT_FOR_DELIVERY',
    'with courier': 'OUT_FOR_DELIVERY',
    'delivered': 'DELIVERED',
    'exception': 'EXCEPTION',
    'failed': 'EXCEPTION',
    'undelivered': 'EXCEPTION',
    'returned': 'EXCEPTION'
  };
  
  let status = parsed.status?.toUpperCase() || 'IN_TRANSIT';
  status = statusMap[parsed.status?.toLowerCase()] || status;
  
  // IMPORTANT: Infer status from email age
  status = inferStatusFromAge(emailData.date, status);
  
  // Clean product name - reject bad values
  let productName = parsed.product_name;
  if (productName) {
    const badPatterns = [
      /^order/i, /^your order/i, /^package/i, /^shipment/i,
      /^\d+$/, /^#?\d{5,}/, /^OD\d+/i, /^ORD/i
    ];
    if (badPatterns.some(p => p.test(productName.trim()))) {
      productName = null;
    }
  }
  
  // Generate better AI summary if missing
  let aiSummary = parsed.ai_summary;
  if (!aiSummary || aiSummary.length < 10) {
    const statusMessages = {
      'ORDERED': `Your order from ${merchant} has been confirmed and is being processed.`,
      'SHIPPED': `Your order has been shipped${carrier ? ` via ${carrier}` : ''}. It's on its way!`,
      'IN_TRANSIT': `Your package is in transit${carrier ? ` with ${carrier}` : ''}. Delivery expected soon.`,
      'OUT_FOR_DELIVERY': `Great news! Your package is out for delivery today.`,
      'DELIVERED': `Your package has been delivered. Enjoy your purchase!`,
      'EXCEPTION': `There was an issue with your delivery. Please check with ${carrier || 'the carrier'}.`
    };
    aiSummary = statusMessages[status] || 'Shipment update received.';
  }

  return {
    product_name: productName || null,
    merchant,
    carrier,
    tracking_number: parsed.tracking_number || null,
    order_number: parsed.order_number || null,
    status,
    expected_delivery: parsed.expected_delivery || null,
    ai_summary: aiSummary,
    raw_subject: emailData.subject,
    raw_from: emailData.from,
    email_date: emailData.date,
    messageId: emailData.messageId,
    parsed_by: 'gemini'
  };
}

// ============================================
// FALLBACK RESPONSE
// ============================================
function createFallbackResponse(emailData) {
  const merchant = extractMerchantFromEmail(emailData.from);
  
  // Try to infer status from subject line
  let status = 'IN_TRANSIT';
  const subjectLower = (emailData.subject || '').toLowerCase();
  if (subjectLower.includes('delivered')) status = 'DELIVERED';
  else if (subjectLower.includes('out for delivery')) status = 'OUT_FOR_DELIVERY';
  else if (subjectLower.includes('shipped') || subjectLower.includes('dispatched')) status = 'SHIPPED';
  else if (subjectLower.includes('confirmed') || subjectLower.includes('placed')) status = 'ORDERED';
  
  // Infer from age
  status = inferStatusFromAge(emailData.date, status);
  
  return {
    product_name: null,
    merchant,
    carrier: null,
    tracking_number: null,
    order_number: null,
    status,
    expected_delivery: null,
    ai_summary: `Order update from ${merchant}. Check email for details.`,
    raw_subject: emailData.subject,
    raw_from: emailData.from,
    email_date: emailData.date,
    messageId: emailData.messageId,
    parsed_by: 'fallback'
  };
}

// ============================================
// BATCH PARSE EMAILS
// ============================================
async function batchParseEmails(emails, apiKey) {
  const results = [];
  let skipped = 0;
  let processed = 0;
  
for (let i = Math.max(0, emails.length - 5); i < emails.length; i++) {    const email = emails[i];
    
    const bodySnippet = (email.text || email.html || '').substring(0, 500);
    const confidence = getShippingConfidence(email.subject, email.from, bodySnippet);
    
    if (!confidence.isLikely) {
      console.log(`⏭️  Skip: "${email.subject?.substring(0, 40)}..."`);
      skipped++;
      continue;
    }
    
    console.log(`📦 Parse: "${email.subject?.substring(0, 40)}..."`);

                                                                      
    try {
      const parsed = await parseEmailWithGemini(email, apiKey);
      results.push(parsed);
      processed++;
      
      // Rate limit: 1 second between calls
      if (i < emails.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`❌ Failed: ${error.message}`);
      results.push(createFallbackResponse(email));
    }
  }
  
  console.log(`\n📊 Done: ${processed} parsed, ${skipped} skipped\n`);
  return results;
}

// ============================================
// GENERATE SUMMARY (for manual refresh)
// ============================================
async function generateShipmentSummary(emails, currentStatus, apiKey) {
  const summaryPrompt = `Based on these shipping emails (newest first), write a 2-sentence summary:

${emails.map((e, i) => `${i + 1}. (${e.date}): ${e.subject}`).join('\n')}

Status: ${currentStatus}

Be specific about dates/locations if mentioned. Write naturally.`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: summaryPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 150 }
      })
    });

    if (response.ok) {
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }
  } catch (error) {
    console.error('Summary error:', error);
  }
  return null;
}

module.exports = {
  parseEmailWithGemini,
  batchParseEmails,
  generateShipmentSummary,
  cleanEmailContent,
  isLikelyShippingEmail,
  getShippingConfidence,
  normalizeCarrier,
  normalizeMerchant,
  inferStatusFromAge,
  KNOWN_CARRIERS,
  KNOWN_MERCHANTS,
  SHIPPING_KEYWORDS
};
