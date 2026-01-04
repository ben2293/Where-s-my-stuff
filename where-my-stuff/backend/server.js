/**
 * Where's My Stuff - Backend Server
 * 
 * A package tracking app that uses Gmail API to fetch shipping emails
 * and Gemini AI to intelligently parse them.
 * 
 * No lazy regex. No guessing. Gemini reads emails like a human.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { google } = require('googleapis');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const { parseEmailWithGemini, batchParseEmails, generateShipmentSummary } = require('./geminiParser');

const app = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, 'shipments.db');

// ============================================
// CONFIGURATION
// ============================================
const config = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback'
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY
  },
  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:5173'
  }
};

// Validate required config
if (!config.google.clientId || !config.google.clientSecret) {
  console.error('ERROR: Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  process.exit(1);
}

if (!config.gemini.apiKey) {
  console.error('ERROR: Missing Gemini API key. Set GEMINI_API_KEY.');
  process.exit(1);
}

// ============================================
// DATABASE SETUP (sql.js - pure JS SQLite)
// ============================================
let db;
let SQL;

async function initDatabase() {
  SQL = await initSqlJs();
  
  // Load existing database or create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('Created new database');
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tracking_number TEXT,
      carrier TEXT,
      product_name TEXT,
      merchant TEXT,
      status TEXT DEFAULT 'IN_TRANSIT',
      order_number TEXT,
      email_date INTEGER,
      expected_delivery TEXT,
      ai_summary TEXT,
      raw_subject TEXT,
      raw_from TEXT,
      email_id TEXT,
      parsed_by TEXT DEFAULT 'gemini',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE(user_id, email_id)
    )
  `);

  // Index for faster queries
  db.run(`CREATE INDEX IF NOT EXISTS idx_shipments_user ON shipments(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_number)`);
  
  saveDatabase();
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Database helper functions
function dbRun(sql, params = []) {
  try {
    db.run(sql, params);
    saveDatabase();
  } catch (error) {
    console.error('DB Error:', error);
    throw error;
  }
}

function dbGet(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  } catch (error) {
    console.error('DB Error:', error);
    return null;
  }
}

function dbAll(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch (error) {
    console.error('DB Error:', error);
    return [];
  }
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
  origin: [config.frontend.url, 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Simple session store (in-memory for now)
const sessions = new Map();

function getSession(req) {
  const sessionId = req.headers['x-session-id'];
  return sessionId ? sessions.get(sessionId) : null;
}

function setSession(sessionId, data) {
  sessions.set(sessionId, { ...sessions.get(sessionId), ...data });
}

// ============================================
// GOOGLE OAUTH
// ============================================
function createOAuthClient() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

// Auth routes
app.get('/auth/google', (req, res) => {
  const oauth2Client = createOAuthClient();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    prompt: 'consent'
  });
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.redirect(`${config.frontend.url}?auth=error`);
  }

  try {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // Create or update user
    const userId = crypto.createHash('sha256').update(userInfo.email).digest('hex').slice(0, 16);
    
    const existingUser = dbGet('SELECT * FROM users WHERE email = ?', [userInfo.email]);
    
    if (existingUser) {
      dbRun(`
        UPDATE users SET 
          access_token = ?, 
          refresh_token = COALESCE(?, refresh_token),
          token_expiry = ?
        WHERE email = ?
      `, [tokens.access_token, tokens.refresh_token, tokens.expiry_date, userInfo.email]);
    } else {
      dbRun(`
        INSERT INTO users (id, email, access_token, refresh_token, token_expiry)
        VALUES (?, ?, ?, ?, ?)
      `, [userId, userInfo.email, tokens.access_token, tokens.refresh_token, tokens.expiry_date]);
    }

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex');
    setSession(sessionId, { userId, email: userInfo.email });

    // Redirect with session
    res.redirect(`${config.frontend.url}?auth=success&session=${sessionId}`);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${config.frontend.url}?auth=error`);
  }
});

app.get('/auth/status', (req, res) => {
  const session = getSession(req);
  if (session) {
    res.json({ authenticated: true, email: session.email });
  } else {
    res.json({ authenticated: false });
  }
});

app.post('/auth/logout', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (sessionId) {
    sessions.delete(sessionId);
  }
  res.json({ success: true });
});

// ============================================
// GMAIL INTEGRATION
// ============================================
async function getAuthenticatedClient(userId) {
  const user = dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('User not found');

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: user.access_token,
    refresh_token: user.refresh_token,
    expiry_date: user.token_expiry
  });

  // Refresh token if expired
  if (user.token_expiry && Date.now() > user.token_expiry) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      dbRun(`
        UPDATE users SET 
          access_token = ?,
          token_expiry = ?
        WHERE id = ?
      `, [credentials.access_token, credentials.expiry_date, userId]);
      oauth2Client.setCredentials(credentials);
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw new Error('Authentication expired. Please re-login.');
    }
  }

  return oauth2Client;
}

/**
 * Extract email content from Gmail message
 */
function extractEmailContent(message) {
  const headers = message.payload.headers;
  const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
  const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
  const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';

  let html = '';
  let text = '';

  function extractParts(part) {
    if (part.mimeType === 'text/html' && part.body?.data) {
      html = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.mimeType === 'text/plain' && part.body?.data) {
      text = Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) {
      part.parts.forEach(extractParts);
    }
  }

  extractParts(message.payload);

  return { subject, from, date, html, text, messageId: message.id };
}

/**
 * Search Gmail for shipping-related emails
 */
async function searchShippingEmails(auth, maxResults = 50) {
  const gmail = google.gmail({ version: 'v1', auth });

  // Comprehensive search query for Indian e-commerce
  const query = `
    newer_than:90d AND (
      from:(flipkart.com OR amazon.in OR myntra.com OR meesho.com OR ajio.com OR nykaa.com OR snapdeal.com OR tatacliq.com) OR
      from:(delhivery.com OR bluedart.com OR dtdc.com OR ecomexpress.in OR xpressbees.com OR shiprocket.in OR shadowfax.in OR ekartlogistics.com) OR
      from:(shopifymail.com OR shopify.com) OR
      subject:(shipped OR dispatched OR "on the way" OR "out for delivery" OR delivered OR tracking OR "order confirmed" OR "your order")
    )
  `.replace(/\s+/g, ' ').trim();

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults
  });

  if (!response.data.messages) {
    return [];
  }

  // Fetch full message content
  const emails = [];
  for (const msg of response.data.messages) {
    try {
      const fullMessage = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full'
      });
      emails.push(extractEmailContent(fullMessage.data));
    } catch (error) {
      console.error(`Error fetching message ${msg.id}:`, error);
    }
  }

  return emails;
}

// ============================================
// SHIPMENT SYNC - THE MAIN LOGIC
// ============================================
async function syncShipmentsForUser(userId) {
  console.log(`\n🔄 Starting sync for user ${userId}`);
  
  const auth = await getAuthenticatedClient(userId);
  const emails = await searchShippingEmails(auth);
  
  console.log(`📬 Found ${emails.length} emails from Gmail search`);

  if (emails.length === 0) {
    return getShipmentsForUser(userId);
  }

  // OPTIMIZATION 1: Filter out emails we've already processed
  const existingEmailIds = new Set(
    dbAll('SELECT email_id FROM shipments WHERE user_id = ?', [userId])
      .map(row => row.email_id)
  );

  const newEmails = emails.filter(e => !existingEmailIds.has(e.messageId));
  console.log(`📭 ${emails.length - newEmails.length} already processed, ${newEmails.length} new emails`);

  if (newEmails.length === 0) {
    console.log('✅ All caught up! No new emails to process.\n');
    return getShipmentsForUser(userId);
  }

  // OPTIMIZATION 2: Pre-filter happens inside batchParseEmails
  // Only emails matching shipping keywords will be sent to Gemini
  console.log(`\n🤖 Sending to Gemini (with smart pre-filter)...`);
  const parsedEmails = await batchParseEmails(newEmails, config.gemini.apiKey);

  // Save to database
  for (const parsed of parsedEmails) {
    if (!parsed.tracking_number && !parsed.order_number) {
      // Skip emails that don't seem to be actual shipments
      console.log('Skipping email - no tracking or order number:', parsed.raw_subject);
      continue;
    }

    const id = crypto.randomUUID();
    const emailDate = parsed.email_date ? new Date(parsed.email_date).getTime() / 1000 : Date.now() / 1000;

    try {
      // Check if we already have this shipment (by tracking number)
      const existing = parsed.tracking_number 
        ? dbGet('SELECT * FROM shipments WHERE user_id = ? AND tracking_number = ?', [userId, parsed.tracking_number])
        : null;

      if (existing) {
        // Update existing shipment with newer info
        dbRun(`
          UPDATE shipments SET
            status = CASE WHEN ? IN ('DELIVERED', 'OUT_FOR_DELIVERY') OR status NOT IN ('DELIVERED') THEN ? ELSE status END,
            ai_summary = COALESCE(?, ai_summary),
            expected_delivery = COALESCE(?, expected_delivery),
            updated_at = strftime('%s', 'now')
          WHERE id = ?
        `, [parsed.status, parsed.status, parsed.ai_summary, parsed.expected_delivery, existing.id]);
      } else {
        // Insert new shipment
        dbRun(`
          INSERT INTO shipments (
            id, user_id, tracking_number, carrier, product_name, merchant,
            status, order_number, email_date, expected_delivery, ai_summary,
            raw_subject, raw_from, email_id, parsed_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          id, userId, parsed.tracking_number, parsed.carrier, parsed.product_name,
          parsed.merchant, parsed.status, parsed.order_number, emailDate,
          parsed.expected_delivery, parsed.ai_summary, parsed.raw_subject,
          parsed.raw_from, parsed.messageId || null, parsed.parsed_by
        ]);
      }
    } catch (error) {
      console.error('Error saving shipment:', error);
    }
  }

  return getShipmentsForUser(userId);
}

/**
 * Get all shipments for a user, formatted for frontend
 */
function getShipmentsForUser(userId) {
  const shipments = dbAll(`
    SELECT * FROM shipments 
    WHERE user_id = ? 
    ORDER BY email_date DESC
  `, [userId]);

  return shipments.map(formatShipmentForFrontend);
}

/**
 * Format shipment for frontend consumption
 */
function formatShipmentForFrontend(shipment) {
  const statusLabels = {
    'ORDERED': 'Order Confirmed',
    'SHIPPED': 'Shipped',
    'IN_TRANSIT': 'In Transit',
    'OUT_FOR_DELIVERY': 'Out for Delivery',
    'DELIVERED': 'Delivered',
    'EXCEPTION': 'Delivery Issue'
  };

  // Generate tracking URL
  const trackingUrls = {
    'Delhivery': `https://www.delhivery.com/track/package/${shipment.tracking_number}`,
    'BlueDart': `https://www.bluedart.com/tracking/${shipment.tracking_number}`,
    'DTDC': `https://www.dtdc.in/trace.asp?strAwb=${shipment.tracking_number}`,
    'Ekart': `https://www.ekartlogistics.com/track/${shipment.tracking_number}`,
    'Xpressbees': `https://www.xpressbees.com/track?awb=${shipment.tracking_number}`,
    'Shiprocket': `https://www.shiprocket.in/shipment-tracking/${shipment.tracking_number}`,
    'Ecom Express': `https://www.ecomexpress.in/tracking/?awb_field=${shipment.tracking_number}`,
    'Shadowfax': `https://tracker.shadowfax.in/#/track/${shipment.tracking_number}`,
    'Amazon Logistics': `https://www.amazon.in/gp/your-account/order-history`
  };

  const trackingUrl = shipment.carrier && shipment.tracking_number 
    ? trackingUrls[shipment.carrier] || null 
    : null;

  // Format date
  const emailDate = shipment.email_date ? new Date(shipment.email_date * 1000) : new Date();
  const dateStr = emailDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });

  return {
    id: shipment.id,
    productName: shipment.product_name || shipment.raw_subject || 'Package',
    merchant: shipment.merchant || 'Unknown',
    carrier: shipment.carrier || 'Unknown',
    status: shipment.status || 'IN_TRANSIT',
    statusLabel: statusLabels[shipment.status] || 'In Transit',
    trackingNumber: shipment.tracking_number || 'N/A',
    orderNumber: shipment.order_number || 'N/A',
    expectedDelivery: shipment.expected_delivery || null,
    aiSummary: shipment.ai_summary || null,
    trackingUrl,
    date: dateStr,
    rawSubject: shipment.raw_subject
  };
}

// ============================================
// API ROUTES
// ============================================
// Health check route
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Where\'s My Stuff API is running', timestamp: new Date().toISOString() });
  });

app.get('/api/shipments', async (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const shipments = getShipmentsForUser(session.userId);
    res.json(shipments);
  } catch (error) {
    console.error('Error fetching shipments:', error);
    res.status(500).json({ error: 'Failed to fetch shipments' });
  }
});

app.post('/api/shipments/sync', async (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const shipments = await syncShipmentsForUser(session.userId);
    res.json(shipments);
  } catch (error) {
    console.error('Error syncing shipments:', error);
    res.status(500).json({ error: error.message || 'Failed to sync shipments' });
  }
});

// Manual refresh of AI summary for a shipment
app.post('/api/shipments/:id/refresh-summary', async (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const shipment = dbGet('SELECT * FROM shipments WHERE id = ? AND user_id = ?', [req.params.id, session.userId]);
    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // Get all emails for this tracking number to generate comprehensive summary
    const relatedEmails = dbAll(`
      SELECT raw_subject, email_date FROM shipments 
      WHERE user_id = ? AND tracking_number = ?
      ORDER BY email_date DESC
    `, [session.userId, shipment.tracking_number]);

    const newSummary = await generateShipmentSummary(
      relatedEmails.map(e => ({ subject: e.raw_subject, date: new Date(e.email_date * 1000).toISOString() })),
      shipment.status,
      config.gemini.apiKey
    );

    if (newSummary) {
      dbRun('UPDATE shipments SET ai_summary = ?, updated_at = strftime("%s", "now") WHERE id = ?', [newSummary, shipment.id]);
    }

    res.json({ success: true, summary: newSummary });
  } catch (error) {
    console.error('Error refreshing summary:', error);
    res.status(500).json({ error: 'Failed to refresh summary' });
  }
});

// Mark shipment as delivered manually
app.post('/api/shipments/:id/mark-delivered', async (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    dbRun(`
      UPDATE shipments 
      SET status = 'DELIVERED', ai_summary = 'Manually marked as delivered.', updated_at = strftime('%s', 'now')
      WHERE id = ? AND user_id = ?
    `, [req.params.id, session.userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking delivered:', error);
    res.status(500).json({ error: 'Failed to update shipment' });
  }
});

// ============================================
// START SERVER
// ============================================
async function startServer() {
  await initDatabase();
  
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    Where's My Stuff?                       ║
║                                                            ║
║  Server running on http://localhost:${PORT}                   ║
║                                                            ║
║  Gemini API: ${config.gemini.apiKey ? '✓ Configured' : '✗ Missing'}                              ║
║  Google OAuth: ${config.google.clientId ? '✓ Configured' : '✗ Missing'}                            ║
╚════════════════════════════════════════════════════════════╝
    `);
  });
}

startServer().catch(console.error);
