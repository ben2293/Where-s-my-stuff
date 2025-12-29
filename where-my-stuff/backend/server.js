// server.js - Production-ready Package Tracker with Indian Carriers Priority
import express from 'express';
import { google } from 'googleapis';
import session from 'express-session';
import cors from 'cors';
import initSqlJs from 'sql.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// DATABASE SETUP (SQLite via sql.js - Pure JS)
// ============================================
let db;
const DB_PATH = process.env.NODE_ENV === 'production' ? '/opt/render/project/src/shipments.db' : './shipments.db';

async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Try to load existing database
  try {
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
  } catch (err) {
    console.log('Creating new database');
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expiry INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tracking_number TEXT NOT NULL,
      carrier TEXT,
      item_name TEXT,
      merchant TEXT,
      status TEXT DEFAULT 'IN_TRANSIT',
      order_number TEXT,
      email_date INTEGER,
      estimated_delivery TEXT,
      last_updated INTEGER DEFAULT (strftime('%s', 'now')),
      raw_subject TEXT,
      raw_from TEXT,
      FOREIGN KEY (user_id) REFERENCES users (id),
      UNIQUE(user_id, tracking_number)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_user_shipments ON shipments(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tracking ON shipments(tracking_number)`);
  
  saveDatabase();
}

function saveDatabase() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('Failed to save database:', err);
  }
}

// Helper functions for sql.js
function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// ============================================
// TOKEN ENCRYPTION
// ============================================
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex').substring(0, 32);
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf8'), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encryptedText = Buffer.from(parts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf8'), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

// ============================================
// EXPRESS MIDDLEWARE
// ============================================
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173'
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(allowed => origin.startsWith(allowed.replace(/\/$/, '')))) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true
}));

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-in-production-' + crypto.randomBytes(16).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Trust proxy for production (Render, Vercel)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ============================================
// GOOGLE OAUTH SETUP
// ============================================
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback'
);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];

// ============================================
// INDIAN CARRIER TRACKING PATTERNS (PRIORITY)
// ============================================
const INDIAN_CARRIERS = {
  // Shiprocket / Carrier partners
  Shiprocket: {
    patterns: [
      /\b[A-Z]{2,4}\d{9,14}\b/i,  // Generic AWB format
    ],
    emailDomains: ['shiprocket.co', 'shiprocket.in'],
    priority: 1
  },
  // Delhivery
  Delhivery: {
    patterns: [
      /\b\d{13,14}\b/,  // 13-14 digit tracking
      /\bDL\d{10,12}\b/i
    ],
    emailDomains: ['delhivery.com'],
    priority: 1
  },
  // DTDC
  DTDC: {
    patterns: [
      /\b[A-Z]\d{8,9}\b/,  // Letter + 8-9 digits
      /\bD\d{9}\b/i,
      /\b\d{9}\b/  // 9 digit consignment
    ],
    emailDomains: ['dtdc.com', 'dtdc.in'],
    priority: 1
  },
  // Ekart (Flipkart Logistics)
  Ekart: {
    patterns: [
      /\bFMPC?\d{12,15}\b/i,  // Flipkart pattern
      /\bEKART\d{10,14}\b/i,
      /\bOD\d{12,18}\b/i  // Order ID based
    ],
    emailDomains: ['flipkart.com', 'ekartlogistics.com'],
    priority: 1
  },
  // BlueDart
  BlueDart: {
    patterns: [
      /\b\d{11}\b/,  // 11 digit AWB
      /\b[A-Z]{2}\d{9}[A-Z]{2}\b/i
    ],
    emailDomains: ['bluedart.com'],
    priority: 1
  },
  // Xpressbees
  Xpressbees: {
    patterns: [
      /\bXB\d{10,12}\b/i,
      /\b\d{10,12}\b/
    ],
    emailDomains: ['xpressbees.com'],
    priority: 1
  },
  // Ecom Express
  EcomExpress: {
    patterns: [
      /\b\d{10,12}\b/,
      /\bEE\d{9,11}\b/i
    ],
    emailDomains: ['ecomexpress.in'],
    priority: 1
  },
  // Shadowfax
  Shadowfax: {
    patterns: [
      /\bSF\d{10,12}\b/i,
      /\b\d{12}\b/
    ],
    emailDomains: ['shadowfax.in'],
    priority: 1
  },
  // India Post
  IndiaPost: {
    patterns: [
      /\b[A-Z]{2}\d{9}IN\b/i,  // EMS format
      /\b\d{13}\b/  // Speed Post
    ],
    emailDomains: ['indiapost.gov.in', 'epostoffice.gov.in'],
    priority: 1
  },
  // Amazon India (handled by various carriers)
  AmazonIndia: {
    patterns: [
      /\bTBA\d{12,14}\b/i,  // Amazon tracking
      /\b\d{3}-\d{7}-\d{7}\b/  // Order ID
    ],
    emailDomains: ['amazon.in', 'amazon.com'],
    priority: 1
  },
  // Myntra / Jabong (Flipkart)
  Myntra: {
    patterns: [
      /\bMYN\d{10,14}\b/i,
      /\b\d{12,15}\b/
    ],
    emailDomains: ['myntra.com'],
    priority: 1
  },
  // Meesho
  Meesho: {
    patterns: [
      /\bMSH\d{10,12}\b/i,
      /\b\d{12,14}\b/
    ],
    emailDomains: ['meesho.com'],
    priority: 1
  }
};

// International carriers (lower priority for Indian users)
const INTERNATIONAL_CARRIERS = {
  UPS: {
    patterns: [/\b1Z[0-9A-Z]{16}\b/i],
    emailDomains: ['ups.com'],
    priority: 2
  },
  FedEx: {
    patterns: [
      /\b\d{12,14}\b/,
      /\b\d{20}\b/
    ],
    emailDomains: ['fedex.com'],
    priority: 2
  },
  DHL: {
    patterns: [
      /\b\d{10,11}\b/,
      /\b[A-Z]{3}\d{7}\b/i
    ],
    emailDomains: ['dhl.com', 'dhl.co.in'],
    priority: 2
  },
  USPS: {
    patterns: [
      /\b(94|93|92|95)\d{20}\b/,
      /\b(EA|EC|CP|RA)\d{9}US\b/i
    ],
    emailDomains: ['usps.com'],
    priority: 3
  }
};

// Combine all carriers with Indian ones first
const ALL_CARRIERS = INDIAN_CARRIERS;
// ============================================
// EMAIL PARSING FUNCTION
// ============================================
function parseShipmentEmail(message) {
  const headers = message.payload.headers;
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';
  const dateHeader = headers.find(h => h.name === 'Date')?.value || '';
  const emailDate = dateHeader ? Math.floor(new Date(dateHeader).getTime() / 1000) : Math.floor(Date.now() / 1000);

  // Extract email body
  let body = '';
  function extractBody(part) {
    if (part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) {
      for (const subPart of part.parts) {
        if (subPart.mimeType === 'text/plain' || subPart.mimeType === 'text/html') {
          const text = extractBody(subPart);
          if (text) return text;
        }
      }
    }
    return '';
  }
  body = extractBody(message.payload);
  const fromLower = from.toLowerCase();
  const bodyLower = body.toLowerCase();
  const combinedText = subject + ' ' + body;

  // First, try to identify carrier from email domain (most reliable)
  let carrier = 'Unknown';
  let trackingNumber = null;
  let matchPriority = 999;

  // Check Indian carriers first (priority)
  for (const [carrierName, config] of Object.entries(ALL_CARRIERS)) {
    // Check if email is from this carrier
    const isFromCarrier = config.emailDomains.some(domain => fromLower.includes(domain));
    
    if (isFromCarrier) {
      // Try carrier-specific patterns first
      for (const pattern of config.patterns) {
        const match = combinedText.match(pattern);
        if (match) {
          trackingNumber = match[0];
          carrier = carrierName;
          matchPriority = config.priority;
          break;
        }
      }
      
      // If carrier identified but no tracking found, still assign carrier
      if (!trackingNumber && carrier === 'Unknown') {
        carrier = carrierName;
      }
      break;
    }
  }

  // If carrier not identified from email domain, try pattern matching
  // Prioritize Indian carriers
  if (!trackingNumber) {
    const sortedCarriers = Object.entries(ALL_CARRIERS).sort((a, b) => a[1].priority - b[1].priority);
    
    for (const [carrierName, config] of sortedCarriers) {
      for (const pattern of config.patterns) {
        const match = combinedText.match(pattern);
        if (match && config.priority < matchPriority) {
          trackingNumber = match[0];
          carrier = carrierName;
          matchPriority = config.priority;
          break;
        }
      }
      if (trackingNumber && matchPriority === 1) break; // Found Indian carrier, stop
    }
  }

  // Skip if no tracking number found
  if (!trackingNumber) {
    return null;
  }

  // Extract item name from subject
  let itemName = 'Package';
  const itemPatterns = [
    /(?:shipped|dispatched)[:\s]+["']?(.+?)["']?(?:\(|$|-|has)/i,
    /(?:order|item)[:\s]+["']?(.+?)["']?(?:\(|$|-|has|is)/i,
    /your\s+["']?(.+?)["']?\s+(?:has|is|will|order)/i,
    /["'](.{5,50})["']\s+(?:shipped|dispatched)/i,
    /(?:delivering|delivery of)[:\s]+["']?(.+?)["']?/i
  ];

  for (const pattern of itemPatterns) {
    const match = subject.match(pattern);
    if (match) {
      itemName = match[1].trim().substring(0, 60).replace(/['"]/g, '');
      break;
    }
  }

  // If still generic, try to extract from body
  if (itemName === 'Package') {
    const bodyItemMatch = body.match(/(?:item|product)[:\s]+["']?([^"'\n]{5,50})["']?/i);
    if (bodyItemMatch) {
      itemName = bodyItemMatch[1].trim().substring(0, 60);
    }
  }

  // Extract order number
  const orderPatterns = [
    /order[#\s:]+([A-Z0-9-]{5,})/i,
    /order\s*(?:number|id|no\.?)[:\s]+([A-Z0-9-]{5,})/i,
    /(?:OD|ORD)[A-Z0-9]{10,}/i,
    /#([A-Z0-9-]{8,})/
  ];

  let orderNumber = 'N/A';
  for (const pattern of orderPatterns) {
    const match = combinedText.match(pattern);
    if (match) {
      orderNumber = match[1] || match[0];
      break;
    }
  }

  // Determine status from email content
  let status = 'IN_TRANSIT';
  if (bodyLower.includes('delivered') || bodyLower.includes('was delivered') || bodyLower.includes('has been delivered')) {
    status = 'DELIVERED';
  } else if (bodyLower.includes('out for delivery') || bodyLower.includes('out-for-delivery')) {
    status = 'OUT_FOR_DELIVERY';
  } else if (bodyLower.includes('exception') || bodyLower.includes('delayed') || bodyLower.includes('failed delivery') || bodyLower.includes('undelivered')) {
    status = 'EXCEPTION';
  } else if (bodyLower.includes('shipped') || bodyLower.includes('dispatched') || bodyLower.includes('on the way') || bodyLower.includes('in transit')) {
    status = 'IN_TRANSIT';
  } else if (bodyLower.includes('order confirmed') || bodyLower.includes('order placed') || bodyLower.includes('order received')) {
    status = 'ORDERED';
  }

  // Try to extract delivery date
  const datePatterns = [
    /(?:arriving|delivery|expected|estimated)[:\s]*(?:by|on)?[:\s]*([A-Z][a-z]+,?\s+[A-Z][a-z]+\s+\d{1,2}(?:,?\s+\d{4})?)/i,
    /(?:arriving|delivery)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:by|on)[:\s]*([A-Z][a-z]+,?\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+[A-Z][a-z]+)?)/i,
    /(\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/i
  ];

  let estimatedDelivery = null;
  for (const pattern of datePatterns) {
    const match = combinedText.match(pattern);
    if (match) {
      estimatedDelivery = match[1];
      break;
    }
  }

  // Extract merchant name (Indian e-commerce platforms)
  let merchant = carrier;
  const merchantPatterns = [
    { pattern: /amazon\.in/i, name: 'Amazon India' },
    { pattern: /amazon\.com/i, name: 'Amazon' },
    { pattern: /flipkart/i, name: 'Flipkart' },
    { pattern: /myntra/i, name: 'Myntra' },
    { pattern: /meesho/i, name: 'Meesho' },
    { pattern: /ajio/i, name: 'AJIO' },
    { pattern: /nykaa/i, name: 'Nykaa' },
    { pattern: /tatacliq/i, name: 'Tata CLiQ' },
    { pattern: /snapdeal/i, name: 'Snapdeal' },
    { pattern: /jiomart/i, name: 'JioMart' },
    { pattern: /bigbasket/i, name: 'BigBasket' },
    { pattern: /blinkit/i, name: 'Blinkit' },
    { pattern: /swiggy/i, name: 'Swiggy Instamart' },
    { pattern: /zepto/i, name: 'Zepto' },
    { pattern: /ebay/i, name: 'eBay' },
    { pattern: /etsy/i, name: 'Etsy' }
  ];

  for (const { pattern, name } of merchantPatterns) {
    if (pattern.test(fromLower)) {
      merchant = name;
      break;
    }
  }

  return {
    trackingNumber,
    carrier,
    itemName,
    merchant,
    status,
    orderNumber,
    emailDate,
    estimatedDelivery,
    rawSubject: subject,
    rawFrom: from
  };
}

// ============================================
// AUTH ROUTES
// ============================================
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    const userId = userInfo.data.id;
    const email = userInfo.data.email;

    // Store user and tokens in database
    dbRun(`
      INSERT INTO users (id, email, access_token, refresh_token, token_expiry)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, users.refresh_token),
        token_expiry = excluded.token_expiry
    `, [
      userId,
      email,
      encrypt(tokens.access_token),
      tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      tokens.expiry_date
    ]);

    // Store in session
    req.session.userId = userId;
    req.session.email = email;

    // Redirect to frontend
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}?auth=success`);
  } catch (error) {
    console.error('OAuth error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}?auth=error`);
  }
});

app.get('/auth/status', (req, res) => {
  if (req.session.userId) {
    res.json({ 
      authenticated: true, 
      email: req.session.email 
    });
  } else {
    res.json({ authenticated: false });
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: 'Failed to logout' });
    } else {
      res.json({ success: true });
    }
  });
});

// ============================================
// AUTH MIDDLEWARE
// ============================================
async function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const user = dbGet('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const tokens = {
      access_token: decrypt(user.access_token),
      refresh_token: user.refresh_token ? decrypt(user.refresh_token) : null,
      expiry_date: user.token_expiry
    };

    oauth2Client.setCredentials(tokens);

    // Check if token needs refresh
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);

        dbRun(`
          UPDATE users SET 
            access_token = ?,
            token_expiry = ?
          WHERE id = ?
        `, [encrypt(credentials.access_token), credentials.expiry_date, user.id]);
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
        return res.status(401).json({ error: 'Session expired, please login again' });
      }
    }

    req.oauth2Client = oauth2Client;
    req.userId = req.session.userId;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}

// ============================================
// SHIPMENT ROUTES
// ============================================
app.get('/api/shipments', requireAuth, async (req, res) => {
  try {
    const shipments = dbAll(
      'SELECT * FROM shipments WHERE user_id = ? ORDER BY email_date DESC',
      [req.userId]
    );

    const formatted = shipments.map(s => formatShipmentForFrontend(s));
    res.json(formatted);
  } catch (error) {
    console.error('Error fetching shipments:', error);
    res.status(500).json({ error: 'Failed to fetch shipments' });
  }
});

app.post('/api/shipments/refresh', requireAuth, async (req, res) => {
  try {
    await syncShipmentsFromGmail(req.oauth2Client, req.userId);
    const shipments = dbAll(
      'SELECT * FROM shipments WHERE user_id = ? ORDER BY email_date DESC',
      [req.userId]
    );
    res.json(shipments.map(s => formatShipmentForFrontend(s)));
  } catch (error) {
    console.error('Error refreshing shipments:', error);
    res.status(500).json({ error: 'Failed to refresh shipments' });
  }
});

// ============================================
// GMAIL SYNC FUNCTION
// ============================================
async function syncShipmentsFromGmail(auth, userId) {
  const gmail = google.gmail({ version: 'v1', auth });

  // Search query prioritizing Indian carriers and e-commerce
  const query = [
    // Indian e-commerce
    'from:(flipkart.com OR amazon.in OR myntra.com OR meesho.com OR ajio.com OR nykaa.com OR snapdeal.com)',
    // Indian carriers
    'OR from:(delhivery.com OR dtdc.com OR bluedart.com OR shiprocket.co OR xpressbees.com OR ecomexpress.in OR ekartlogistics.com OR shadowfax.in)',
    // International
    'OR from:(amazon.com OR ups.com OR fedex.com OR dhl.com)',
    // Subject keywords
    'OR subject:(shipped OR dispatched OR tracking OR delivery OR "out for delivery" OR "order confirmed" OR "on the way")',
    // Time filter
    'newer_than:90d'
  ].join(' ');

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 100
  });

  if (!response.data.messages) {
    return;
  }

  for (const message of response.data.messages) {
    try {
      const fullMessage = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'full'
      });

      const shipmentData = parseShipmentEmail(fullMessage.data);
      if (shipmentData && shipmentData.trackingNumber) {
        dbRun(`
          INSERT INTO shipments (
            id, user_id, tracking_number, carrier, item_name, merchant,
            status, order_number, email_date, estimated_delivery, raw_subject, raw_from
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, tracking_number) DO UPDATE SET
            last_updated = strftime('%s', 'now'),
            status = CASE
              WHEN shipments.status != 'DELIVERED' THEN excluded.status
              ELSE shipments.status
            END,
            estimated_delivery = COALESCE(excluded.estimated_delivery, shipments.estimated_delivery)
        `, [
          crypto.randomUUID(),
          userId,
          shipmentData.trackingNumber,
          shipmentData.carrier,
          shipmentData.itemName,
          shipmentData.merchant,
          shipmentData.status,
          shipmentData.orderNumber,
          shipmentData.emailDate,
          shipmentData.estimatedDelivery,
          shipmentData.rawSubject,
          shipmentData.rawFrom
        ]);
      }
    } catch (error) {
      console.error(`Error processing message ${message.id}:`, error);
    }
  }
}

// ============================================
// FORMAT SHIPMENT FOR FRONTEND
// ============================================
function formatShipmentForFrontend(dbShipment) {
  const now = Date.now() / 1000;
  const emailAge = now - dbShipment.email_date;
  const daysAgo = Math.floor(emailAge / 86400);

  let group = 'This Month';
  if (daysAgo === 0) group = 'Today';
  else if (daysAgo === 1) group = 'Yesterday';
  else if (daysAgo <= 7) group = 'This Week';
  else if (daysAgo <= 30) group = 'This Month';
  else group = 'Older';

  let etaLabel = 'Status';
  let etaDate = dbShipment.status.replace('_', ' ');

  if (dbShipment.status === 'DELIVERED') {
    etaLabel = 'Delivered';
    etaDate = dbShipment.estimated_delivery || 'Recently';
  } else if (dbShipment.estimated_delivery) {
    etaLabel = 'Arriving';
    etaDate = dbShipment.estimated_delivery;
  } else if (dbShipment.status === 'OUT_FOR_DELIVERY') {
    etaLabel = 'Arriving';
    etaDate = 'Today';
  } else if (dbShipment.status === 'IN_TRANSIT') {
    etaLabel = 'In Transit';
    etaDate = 'Tracking...';
  } else if (dbShipment.status === 'EXCEPTION') {
    etaLabel = 'Status';
    etaDate = 'Delivery Issue';
  } else if (dbShipment.status === 'ORDERED') {
    etaLabel = 'Status';
    etaDate = 'Order Confirmed';
  }

  const statusLabels = {
    'IN_TRANSIT': 'In Transit',
    'OUT_FOR_DELIVERY': 'Out for Delivery',
    'DELIVERED': 'Delivered',
    'EXCEPTION': 'Delivery Issue',
    'ORDERED': 'Order Confirmed'
  };

  // Carrier-specific tracking URLs (Indian carriers)
  const trackingUrls = {
    Delhivery: `https://www.delhivery.com/track/package/${dbShipment.tracking_number}`,
    DTDC: `https://www.dtdc.in/tracking/shipment-tracking.asp?strCnno=${dbShipment.tracking_number}`,
    BlueDart: `https://www.bluedart.com/tracking/${dbShipment.tracking_number}`,
    Ekart: `https://www.ekartlogistics.com/track/${dbShipment.tracking_number}`,
    Xpressbees: `https://www.xpressbees.com/track/${dbShipment.tracking_number}`,
    EcomExpress: `https://www.ecomexpress.in/tracking/?awb_field=${dbShipment.tracking_number}`,
    IndiaPost: `https://www.indiapost.gov.in/_layouts/15/DOP.Portal.Tracking/TrackConsignment.aspx?consession=${dbShipment.tracking_number}`,
    AmazonIndia: `https://www.amazon.in/gp/your-account/order-details?orderID=${dbShipment.order_number}`,
    UPS: `https://www.ups.com/track?tracknum=${dbShipment.tracking_number}`,
    FedEx: `https://www.fedex.com/fedextrack/?trknbr=${dbShipment.tracking_number}`,
    DHL: `https://www.dhl.com/en/express/tracking.html?AWB=${dbShipment.tracking_number}`,
    USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${dbShipment.tracking_number}`
  };

  return {
    id: dbShipment.id,
    itemName: dbShipment.item_name,
    itemImage: 'https://i.imgur.com/gK42D75.png',
    merchant: { name: dbShipment.merchant },
    status: dbShipment.status,
    statusLabel: statusLabels[dbShipment.status] || dbShipment.status,
    eta: { label: etaLabel, date: etaDate },
    orderNumber: dbShipment.order_number,
    trackingNumber: dbShipment.tracking_number,
    carrier: dbShipment.carrier,
    group,
    estimatedDelivery: dbShipment.estimated_delivery,
    trackingUrl: trackingUrls[dbShipment.carrier] || null,
    actualDelivery: dbShipment.status === 'DELIVERED' ? dbShipment.estimated_delivery : null
  };
}

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ 
    name: 'Where\'s My Stuff API',
    version: '1.0.0',
    status: 'running',
    indianCarriers: Object.keys(INDIAN_CARRIERS)
  });
});

// ============================================
// START SERVER
// ============================================
(async () => {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📦 Database: ${process.env.NODE_ENV === 'production' ? 'production' : 'development'}`);
      console.log(`🇮🇳 Indian carriers prioritized: ${Object.keys(INDIAN_CARRIERS).join(', ')}`);
    });
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }
})();
