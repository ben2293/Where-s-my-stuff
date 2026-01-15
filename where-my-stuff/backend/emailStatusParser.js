/**
 * Email Status Parser
 * Parses shipping email subject lines and body text to extract package delivery status
 * Works with Indian and International carriers
 */

// Define delivery status hierarchy - higher priority means more current/important
const STATUS_PRIORITY = {
  'Delivered': 5,
  'Out for delivery': 4,
  'In transit': 3,
  'Dispatched': 2,
  'Processing': 1,
  'Unknown': 0,
};

// Status keywords and their mappings for different carriers
const STATUS_PATTERNS = {
  delivered: [
    /delivered/i,
    /successfully delivered/i,
    /package handed over/i,
    /recipient.*received/i,
    /package received/i,
    /delivery complete/i,
    /shipment.*completed/i,
  ],
  outForDelivery: [
    /out for delivery/i,
    /out for delivery today/i,
    /\bout for\s*delivery\b/i,
    /out for delivery, expected today/i,
    /vehicle departed/i,
    /in for delivery/i,
    /delivery today/i,
    /on the way/i,
    /towards delivery address/i,
  ],
  inTransit: [
    /in transit/i,
    /in-transit/i,
    /enroute/i,
    /in movement/i,
    /on its way/i,
    /in travel/i,
    /shipped/i,
  ],
  dispatched: [
    /dispatched/i,
    /picked up/i,
    /picked from/i,
    /shipment dispatched/i,
    /ready to ship/i,
    /label created/i,
  ],
  processing: [
    /processing/i,
    /order confirmed/i,
    /preparing shipment/i,
    /order placed/i,
  ],
};

/**
 * Extract status from email subject and body
 * @param {string} subject - Email subject line
 * @param {string} body - Email body text
 * @returns {string} - One of: 'Delivered', 'Out for delivery', 'In transit', 'Dispatched', 'Processing', 'Unknown'
 */
function parseEmailStatus(subject = '', body = '') {
  if (!subject && !body) return 'Unknown';
  
  // Combine subject and body, prioritize recent info (body typically has latest status)
  const fullText = `${subject}\n\n${body}`.toLowerCase();
  
  // Split into lines to find the most recent status mention
  const lines = fullText.split('\n').filter(line => line.trim().length > 0);
  
  // Scan from the end (most recent) to find the first meaningful status
  const foundStatuses = [];
  
  for (const line of lines.reverse()) {
    // Skip metadata lines that aren't about package status
    if (line.includes('email delivered') || 
        line.includes('this message') || 
        line.includes('unsubscribe') ||
        line.includes('footer') ||
        line.includes('terms') ||
        line.includes('privacy')) {
      continue;
    }
    
    // Check each status type
    for (const [statusType, patterns] of Object.entries(STATUS_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          const status = convertStatusTypeToName(statusType);
          foundStatuses.push({
            status,
            priority: STATUS_PRIORITY[status],
            line: line.trim(),
          });
          break;
        }
      }
    }
  }
  
  if (foundStatuses.length === 0) return 'Unknown';
  
  // Return the status with highest priority
  foundStatuses.sort((a, b) => b.priority - a.priority);
  return foundStatuses[0].status;
}

/**
 * Convert status type key to display name
 * @param {string} statusType - Type key like 'outForDelivery'
 * @returns {string} - Display name like 'Out for delivery'
 */
function convertStatusTypeToName(statusType) {
  const mapping = {
    'delivered': 'Delivered',
    'outForDelivery': 'Out for delivery',
    'inTransit': 'In transit',
    'dispatched': 'Dispatched',
    'processing': 'Processing',
  };
  return mapping[statusType] || 'Unknown';
}

/**
 * Sanitize and normalize email text
 * @param {string} text - Raw email text
 * @returns {string} - Cleaned text
 */
function sanitizeEmailText(text) {
  if (!text) return '';
  // Remove HTML tags if present
  text = text.replace(/<[^>]*>/g, '');
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  // Remove excess whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Main export function
 * Parses email and returns status
 * @param {Object} email - Email object with subject and body
 * @returns {string} - Package delivery status
 */
function extractStatus(email) {
  const subject = sanitizeEmailText(email.subject || '');
  const body = sanitizeEmailText(email.body || '');
  return parseEmailStatus(subject, body);
}

module.exports = {
  parseEmailStatus,
  extractStatus,
  sanitizeEmailText,
  STATUS_PRIORITY,
};
