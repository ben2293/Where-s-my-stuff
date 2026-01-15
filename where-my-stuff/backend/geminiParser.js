const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function parsePackageImage(imageBuffer, mimeType) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `Extract package delivery information from this image.
    Provide ONLY a JSON object with these fields:
    - merchantName: the company or store name (string)
    - orderNumber: the order or tracking number (string or null)
    - carrier: the shipping company/carrier name (string or null)
    - status: the CURRENT delivery status. Must be one of: "Delivered", "Out for delivery", "In transit", "Dispatched", "Processing", or "Unknown" (string)
    
    IMPORTANT: Extract the LATEST/CURRENT status mentioned, not historical statuses.
    If a field is not found or unclear, use null.
    Return ONLY valid JSON, no other text or explanation.`;
    
    const imagePart = {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: mimeType,
      },
    };
    
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Normalize status to standard values
      if (parsed.status) {
        parsed.status = normalizeStatus(parsed.status);
      }
      return parsed;
    }
    
    // Fallback: try to extract with regex if JSON parsing fails
    return extractWithRegex(text);
  } catch (error) {
    console.error('Gemini parsing error:', error);
    throw error;
  }
}

// Normalize status to standard values and prioritize correctly
function normalizeStatus(statusStr) {
  if (!statusStr) return null;
  
  const str = statusStr.toLowerCase().trim();
  
  // Map various status strings to standard values
  const statusMap = {
    'delivered': 'Delivered',
    'out for delivery': 'Out for delivery',
    'out for delivery ': 'Out for delivery',
    'in transit': 'In transit',
    'in-transit': 'In transit',
    'dispatched': 'Dispatched',
    'shipped': 'Dispatched',
    'processing': 'Processing',
    'out of delivery': 'Out for delivery',
  };
  
  // Check for exact matches first
  for (const [key, value] of Object.entries(statusMap)) {
    if (str === key) return value;
  }
  
  // Check for substring matches
  if (str.includes('delivered')) return 'Delivered';
  if (str.includes('out for') || str.includes('out of')) return 'Out for delivery';
  if (str.includes('transit')) return 'In transit';
  if (str.includes('dispatch') || str.includes('shipped')) return 'Dispatched';
  if (str.includes('process')) return 'Processing';
  
  return 'Unknown';
}

function extractWithRegex(text) {
  const patterns = {
    orderNumber: [
      /order\s*(?:number|#|no\.?|id)?[:\s]*([A-Z0-9-]+)/i,
      /tracking\s*(?:number|#|no\.?|id)?[:\s]*([A-Z0-9-]+)/i,
      /shipment\s*(?:number|#|no\.?|id)?[:\s]*([A-Z0-9-]+)/i,
      /order\s+(\d{8,})/i,
    ],
    carrier: [
      /carrier[:\s]*([\w\s]+?)(?:\n|$)/i,
      /shipped\s*(?:via|with|by)[:\s]*([\w\s]+?)(?:\n|$)/i,
      /from[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    ],
    status: [
      /status[:\s]*([\w\s]+?)(?:\n|$)/i,
      /delivery\s*status[:\s]*([\w\s]+?)(?:\n|$)/i,
    ],
    merchantName: [
      /from[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:order|package|delivery)/i,
    ],
  };
  
  const info = {
    merchantName: null,
    orderNumber: null,
    carrier: null,
    status: null,
  };
  
  for (const [key, patternList] of Object.entries(patterns)) {
    for (const pattern of patternList) {
      const match = text.match(pattern);
      if (match) {
        let value = match[1].trim();
        if (key === 'status') {
          value = normalizeStatus(value);
        }
        info[key] = value;
        break;
      }
    }
  }
  
  return info;
}

module.exports = { parsePackageImage };
