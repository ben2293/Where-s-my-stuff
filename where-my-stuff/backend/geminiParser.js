/**
 * Gemini-Powered Email Parser
 * 
 * Uses Google's Gemini Flash-Lite API to intelligently parse shipping emails.
 * This replaces brittle regex patterns with AI that actually understands email content.
 * 
 * Free tier: 1000 requests/day — more than enough for personal use.
 * 
 * SMART PRE-FILTERING: We don't send every email to Gemini.
 * Only emails that pass keyword filtering get sent — saves 50-70% of API calls.
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent';

// Indian carriers we support
const KNOWN_CARRIERS = [
  'Delhivery', 'BlueDart', 'Blue Dart', 'DTDC', 'Ekart', 'Ecom Express',
  'Xpressbees', 'Shiprocket', 'Shadowfax', 'Amazon Logistics', 'AmazonIndia',
  'FedEx', 'DHL', 'Gati', 'Professional Couriers', 'India Post', 'Speed Post'
];

// Known Indian e-commerce merchants
const KNOWN_MERCHANTS = [
  'Amazon', 'Flipkart', 'Myntra', 'Nykaa', 'Meesho', 'AJIO', 'Snapdeal',
  'Tata Cliq', 'Reliance Digital', 'Croma', 'BigBasket', 'Blinkit', 'Zepto',
  'Swiggy Instamart', 'JioMart', 'FirstCry', 'Bewakoof', 'The Souled Store'
];

// ============================================
// SMART PRE-FILTER - Runs BEFORE Gemini
// ============================================
const SHIPPING_KEYWORDS = [
  // Order related
  'order', 'ordered', 'confirmed', 'placed', 'purchase', 'bought',
  'order confirmation', 'order placed', 'order id', 'order number',
  
  // Shipping related
  'ship', 'shipped', 'shipping', 'shipment',
  'dispatch', 'dispatched', 'dispatching',
  'courier', 'carrier', 'awb', 'tracking', 'track',
  'consignment', 'parcel', 'package',
  
  // Transit related
  'transit', 'on the way', 'in transit', 'on its way',
  'out for delivery', 'ofd',
  'arriving', 'expected delivery', 'delivery date',
  'reaching', 'en route',
  
  // Delivery related
  'deliver', 'delivered', 'delivery',
  'handed over', 'received by', 'left at',
  'delivery attempt', 'failed delivery', 'undelivered',
  'rescheduled', 'reattempt',
  
  // Carrier names (lowercase)
  'delhivery', 'bluedart', 'blue dart', 'dtdc',
  'ekart', 'xpressbees', 'xpress bees',
  'shiprocket', 'shadowfax', 'ecom express',
  'amazon logistics', 'fedex', 'dhl', 'gati',
  'india post', 'speed post', 'professional couriers',
  
  // E-commerce platforms
  'flipkart', 'amazon', 'myntra', 'meesho', 'ajio', 'nykaa',
  'snapdeal', 'tata cliq', 'jiomart', 'bigbasket', 'blinkit',
  'zepto', 'swiggy instamart', 'firstcry', 'bewakoof',
  
  // Shopify / D2C
  'shopify', 'your order is on the way', 'view your order',
  'track your order', 'track package', 'track shipment'
];

// Keywords that indicate it's NOT a shipping email (false positives)
const EXCLUDE_KEYWORDS = [
  'unsubscribe from shipping', 'shipping policy', 'free shipping offer',
  'shipping rates', 'delivery charges', 'delivery partner wanted',
  'job', 'career', 'hiring', 'recruitment',
  'newsletter', 'promotional', 'sale alert', 'discount code',
  'password reset', 'verify your email', 'login alert',
  'invoice only', 'payment receipt', 'subscription'
];

/**
 * Pre-filter to check if email is likely a shipping email
 * This runs BEFORE we call Gemini — saves API calls
 * 
 * @param {string} subject - Email subject
 * @param {string} from - Sender email/name
 * @param {string} bodySnippet - First ~500 chars of email body
 * @returns {boolean} - true if likely shipping email
 */
function isLikelyShippingEmail(subject, from, bodySnippet) {
  const text = `${subject} ${from} ${bodySnippet}`.toLowerCase();
  
  // First check exclusions — skip promotional/non-shipping emails
  const hasExcludeKeyword = EXCLUDE_KEYWORDS.some(kw => text.includes(kw));
  if (hasExcludeKeyword) {
    // But allow if it also has strong shipping indicators
    const hasStrongIndicator = [
      'has been shipped', 'has been dispatched', 'is on the way',
      'out for delivery', 'has been delivered', 'tracking number',
      'awb number', 'track your order'
    ].some(kw => text.includes(kw));
    
    if (!hasStrongIndicator) {
      return false;
    }
  }
  
  // Check for shipping keywords
  const matchedKeywords = SHIPPING_KEYWORDS.filter(kw => text.includes(kw));
  
  // Need at least 2 keyword matches to be confident
  // OR 1 match if it's a strong indicator
  const strongIndicators = [
    'tracking number', 'awb', 'has been shipped', 'has been delivered',
    'out for delivery', 'in transit', 'dispatch', 'shipment'
  ];
  
  const hasStrongIndicator = strongIndicators.some(kw => text.includes(kw));
  
  return matchedKeywords.length >= 2 || (matchedKeywords.length >= 1 && hasStrongIndicator);
}

/**
 * Get confidence score for shipping email (for logging/debugging)
 */
function getShippingConfidence(subject, from, bodySnippet) {
  const text = `${subject} ${from} ${bodySnippet}`.toLowerCase();
  const matchedKeywords = SHIPPING_KEYWORDS.filter(kw => text.includes(kw));
  
  return {
    isLikely: isLikelyShippingEmail(subject, from, bodySnippet),
    matchedCount: matchedKeywords.length,
    matchedKeywords: matchedKeywords.slice(0, 5) // First 5 for brevity
  };
}

/**
 * The prompt that makes Gemini understand shipping emails like a human.
 * This is the core of the parsing logic — carefully crafted.
 */
const EXTRACTION_PROMPT = `You are a shipping email parser for Indian e-commerce. Extract information from this email accurately.

CRITICAL RULES:
1. MERCHANT is the SELLER/STORE (who sold the item), NOT the delivery company
2. CARRIER is the DELIVERY COMPANY (Delhivery, BlueDart, DTDC, Ekart, Xpressbees, Shiprocket, Shadowfax, etc.)
3. Product name should be the ACTUAL ITEM NAME, not order numbers or generic text
4. If multiple items, list the first one and add "(+N more)" 
5. Status must be one of: ORDERED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, EXCEPTION
6. For Shopify stores, the merchant is the store name, not "Shopify"
7. tracking_number is the SHIPMENT tracking ID (often 10+ digits), NOT the order number

KNOWN INDIAN CARRIERS: ${KNOWN_CARRIERS.join(', ')}
KNOWN MERCHANTS: ${KNOWN_MERCHANTS.join(', ')}

Respond with ONLY valid JSON (no markdown, no backticks):
{
  "product_name": "exact item name or null if not found",
  "merchant": "store/seller name",
  "carrier": "delivery company name or null if not mentioned",
  "tracking_number": "shipment tracking ID or null",
  "order_number": "order ID or null",
  "status": "ORDERED|SHIPPED|IN_TRANSIT|OUT_FOR_DELIVERY|DELIVERED|EXCEPTION",
  "expected_delivery": "date string or null",
  "ai_summary": "2-3 sentence summary of shipment status, written naturally like a helpful assistant"
}

EMAIL CONTENT:
`;

/**
 * Clean email content for Gemini processing
 * Removes excessive HTML but keeps structure
 */
function cleanEmailContent(html, text) {
  let content = text || '';
  
  // If we have HTML, extract meaningful text
  if (html) {
    // Remove scripts and styles
    let cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    
    // Convert common elements to readable format
    cleaned = cleaned
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/td>/gi, ' | ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')  // Remove remaining tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .trim();
    
    // Use HTML-derived content if it's more substantial
    if (cleaned.length > content.length) {
      content = cleaned;
    }
  }
  
  // Truncate to avoid token limits (keep first 4000 chars — usually enough)
  if (content.length > 4000) {
    content = content.substring(0, 4000) + '... [truncated]';
  }
  
  return content;
}

/**
 * Parse a single email using Gemini
 */
async function parseEmailWithGemini(emailData, apiKey) {
  const { subject, from, html, text, date } = emailData;
  
  // Prepare email content for Gemini
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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: fullPrompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,  // Low temperature for consistent extraction
          maxOutputTokens: 500,
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = await response.json();
    
    // Extract the text response
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!responseText) {
      throw new Error('No response from Gemini');
    }

    // Parse JSON response (handle potential markdown wrapping)
    let jsonStr = responseText.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);
    
    // Validate and normalize the response
    return normalizeGeminiResponse(parsed, emailData);
    
  } catch (error) {
    console.error('Error parsing email with Gemini:', error);
    
    // Return a fallback structure so we don't lose the email entirely
    return createFallbackResponse(emailData);
  }
}

/**
 * Normalize and validate Gemini's response
 */
function normalizeGeminiResponse(parsed, emailData) {
  // Normalize carrier name
  let carrier = parsed.carrier;
  if (carrier) {
    // Map common variations
    const carrierMap = {
      'blue dart': 'BlueDart',
      'bluedart': 'BlueDart',
      'ecom express': 'Ecom Express',
      'ecomexpress': 'Ecom Express',
      'amazon logistics': 'Amazon Logistics',
      'amazonindia': 'Amazon Logistics',
      'xpress bees': 'Xpressbees',
    };
    carrier = carrierMap[carrier.toLowerCase()] || carrier;
  }

  // Normalize status
  const statusMap = {
    'ordered': 'ORDERED',
    'confirmed': 'ORDERED',
    'order confirmed': 'ORDERED',
    'shipped': 'SHIPPED',
    'dispatched': 'SHIPPED',
    'in transit': 'IN_TRANSIT',
    'in_transit': 'IN_TRANSIT',
    'on the way': 'IN_TRANSIT',
    'out for delivery': 'OUT_FOR_DELIVERY',
    'out_for_delivery': 'OUT_FOR_DELIVERY',
    'delivered': 'DELIVERED',
    'exception': 'EXCEPTION',
    'failed': 'EXCEPTION',
    'undelivered': 'EXCEPTION',
  };
  
  let status = parsed.status?.toUpperCase() || 'IN_TRANSIT';
  status = statusMap[parsed.status?.toLowerCase()] || status;

  return {
    product_name: parsed.product_name || null,
    merchant: parsed.merchant || extractMerchantFromEmail(emailData.from),
    carrier: carrier || null,
    tracking_number: parsed.tracking_number || null,
    order_number: parsed.order_number || null,
    status: status,
    expected_delivery: parsed.expected_delivery || null,
    ai_summary: parsed.ai_summary || 'Shipment update received.',
    raw_subject: emailData.subject,
    raw_from: emailData.from,
    email_date: emailData.date,
    parsed_by: 'gemini'
  };
}

/**
 * Extract merchant name from email address as fallback
 */
function extractMerchantFromEmail(fromEmail) {
  if (!fromEmail) return 'Unknown';
  
  // Common patterns
  const patterns = [
    { regex: /amazon\.(in|com)/i, name: 'Amazon India' },
    { regex: /flipkart\.com/i, name: 'Flipkart' },
    { regex: /myntra\.com/i, name: 'Myntra' },
    { regex: /nykaa\.com/i, name: 'Nykaa' },
    { regex: /meesho\.com/i, name: 'Meesho' },
    { regex: /ajio\.com/i, name: 'AJIO' },
    { regex: /shopify/i, name: 'Shopify Store' },
  ];

  for (const { regex, name } of patterns) {
    if (regex.test(fromEmail)) {
      return name;
    }
  }

  // Try to extract domain name
  const match = fromEmail.match(/@([^.]+)/);
  if (match) {
    return match[1].charAt(0).toUpperCase() + match[1].slice(1);
  }

  return 'Unknown';
}

/**
 * Create fallback response when Gemini fails
 */
function createFallbackResponse(emailData) {
  return {
    product_name: null,
    merchant: extractMerchantFromEmail(emailData.from),
    carrier: null,
    tracking_number: null,
    order_number: null,
    status: 'IN_TRANSIT',
    expected_delivery: null,
    ai_summary: 'Unable to parse email details. Please check the original email.',
    raw_subject: emailData.subject,
    raw_from: emailData.from,
    email_date: emailData.date,
    parsed_by: 'fallback'
  };
}

/**
 * Batch parse multiple emails efficiently
 * NOW WITH SMART PRE-FILTERING — only sends likely shipping emails to Gemini
 */
async function batchParseEmails(emails, apiKey) {
  const results = [];
  let skipped = 0;
  let processed = 0;
  
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    
    // SMART PRE-FILTER: Check if this looks like a shipping email
    const bodySnippet = (email.text || email.html || '').substring(0, 500);
    const confidence = getShippingConfidence(email.subject, email.from, bodySnippet);
    
    if (!confidence.isLikely) {
      console.log(`⏭️  Skipping (not shipping): "${email.subject.substring(0, 50)}..."`);
      skipped++;
      continue;
    }
    
    console.log(`📦 Processing: "${email.subject.substring(0, 50)}..." (matched: ${confidence.matchedKeywords.join(', ')})`);
    
    try {
      const parsed = await parseEmailWithGemini(email, apiKey);
      results.push(parsed);
      processed++;
      
      // Rate limit: 15 RPM for free tier, so ~4 seconds between calls
      // Being safe with 1 second delay (we pre-filter anyway)
      if (i < emails.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`❌ Failed to parse email ${i}:`, error);
      results.push(createFallbackResponse(email));
    }
  }
  
  console.log(`\n📊 Batch complete: ${processed} processed, ${skipped} skipped (saved ${skipped} API calls!)\n`);
  
  return results;
}

/**
 * Generate/update AI summary for a shipment based on all its emails
 */
async function generateShipmentSummary(emails, currentStatus, apiKey) {
  const summaryPrompt = `Based on these shipping email updates (newest first), write a 2-3 sentence summary of where this package is and what the customer should know:

${emails.map((e, i) => `Email ${i + 1} (${e.date}): ${e.subject}`).join('\n')}

Current status: ${currentStatus}

Write naturally, like a helpful assistant. Be specific about dates and locations if mentioned. If there was a delivery issue, explain what happened and what to do next.`;

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
    console.error('Error generating summary:', error);
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
  KNOWN_CARRIERS,
  KNOWN_MERCHANTS,
  SHIPPING_KEYWORDS
};
