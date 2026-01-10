/**
 * Where's My Stuff - Backend Server (FIXED)
 * 
 * KEY FIXES:
 * 1. Status now inferred from email age (old emails = delivered)
 * 2. Better duplicate handling - updates status from newer emails
 * 3. Manual "mark as delivered" actually works
 * 4. Added "archive" feature to hide delivered packages
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { google } = require('googleapis');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const { 
  parseEmailWithGemini, 
  batchParseEmails, 
  generateShipmentSummary,
  inferStatusFromAge 
} = require('./geminiParser');

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
  console.error('ERROR: Missing Google OAuth credentials.');
  process.exit(1);
}

if (!config.gemini.apiKey) {
  console.error('ERROR: Missing Gemini API key.');
  process.exit(1);
}

// ============================================
// DATABASE SETUP
// ============================================
let db;
let SQL;

async function initDatabase() {
  SQL = await initSqlJs();
  
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('Created new database');
  }

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
      status_override TEXT,
      order_number TEXT,
      email_date INTEGER,
      expected_delivery TEXT,
      ai_summary TEXT,
      raw_subject TEXT,
      raw_from TEXT,
      email_id TEXT,
      parsed_by TEXT DEFAULT 'gemini',
      archived INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE(user_id, email_id)
    )
  `);

  // Add archived column if it doesn't exist (migration)
  try {
    db.run(`ALTER TABLE shipments ADD COLUMN archived INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  
  try {
    db.run(`ALTER TABLE shipments ADD COLUMN status_override TEXT`);
  } catch (e) { /* column exists */ }

  db.run(`CREATE INDEX IF NOT EXISTS idx_shipments_user ON shipments(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_number)`);
  
  saveDatabase();
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

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

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

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

    const sessionId = crypto.randomBytes(32).toString('hex');
    setSession(sessionId, { userId, email: userInfo.email });

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
  if (sessionId) sessions.delete(sessionId);
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

  if (user.token_expiry && Date.now() > user.token_expiry) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      dbRun(`UPDATE users SET access_token = ?, token_expiry = ? WHERE id = ?`, 
        [credentials.access_token, credentials.expiry_date, userId]);
      oauth2Client.setCredentials(credentials);
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw new Error('Authentication expired. Please re-login.');
    }
  }

  return oauth2Client;
}

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
    if (part.parts) part.parts.forEach(extractParts);
  }

  extractParts(message.payload);
  return { subject, from, date, html, text, messageId: message.id };
}

async function searchShippingEmails(auth, maxResults = 50) {
  const gmail = google.gmail({ version: 'v1', auth });

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

  if (!response.data.messages) return [];

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
// STATUS PRIORITY (higher = more final)
// ============================================
const STATUS_PRIORITY = {
  'ORDERED': 1,
  'SHIPPED': 2,
  'IN_TRANSIT': 3,
  'OUT_FOR_DELIVERY': 4,
  'DELIVERED': 5,
  'EXCEPTION': 3 // Same as in transit (can still be delivered)
};

function shouldUpdateStatus(oldStatus, newStatus) {
  return (STATUS_PRIORITY[newStatus] || 0) >= (STATUS_PRIORITY[oldStatus] || 0);
}

// ============================================
// SHIPMENT SYNC
// ============================================
async function syncShipmentsForUser(userId) {
  console.log(`\n🔄 Syncing for user ${userId}`);
  
  const auth = await getAuthenticatedClient(userId);
  const emails = await searchShippingEmails(auth);
  
  console.log(`📬 Found ${emails.length} emails`);

  if (emails.length === 0) {
    return getShipmentsForUser(userId);
  }

  // Filter already processed
  const existingEmailIds = new Set(
    dbAll('SELECT email_id FROM shipments WHERE user_id = ?', [userId])
      .map(row => row.email_id)
  );

  const newEmails = emails.filter(e => !existingEmailIds.has(e.messageId));
  console.log(`📭 ${newEmails.length} new emails to process`);

  if (newEmails.length === 0) {
    // Still update statuses based on age
    updateStaleStatuses(userId);
    return getShipmentsForUser(userId);
  }

  console.log(`\n🤖 Parsing with Gemini...`);
  const parsedEmails = await batchParseEmails(newEmails, config.gemini.apiKey);

  for (const parsed of parsedEmails) {
    // Only skip if we have NOTHING useful - tracking OR order OR subject with "shipment"
    const hasTracking = parsed.tracking_number && parsed.tracking_number.length > 5;
    const hasOrder = parsed.order_number && parsed.order_number.length > 3;
    const hasShipmentSubject = parsed.raw_subject?.toLowerCase().includes('shipment');
    
    if (!hasTracking && !hasOrder && !hasShipmentSubject) {
      console.log('Skip - no useful data:', parsed.raw_subject?.substring(0, 50));
      continue;
    }
    
    console.log('✅ Saving:', parsed.raw_subject?.substring(0, 50), '| AWB:', parsed.tracking_number || 'N/A');

    const id = crypto.randomUUID();
    const emailDate = parsed.email_date ? new Date(parsed.email_date).getTime() / 1000 : Date.now() / 1000;

    try {
      // Check for existing shipment by tracking number OR order number
      let existing = null;
      if (parsed.tracking_number) {
        existing = dbGet('SELECT * FROM shipments WHERE user_id = ? AND tracking_number = ?', 
          [userId, parsed.tracking_number]);
      }
      if (!existing && parsed.order_number) {
        existing = dbGet('SELECT * FROM shipments WHERE user_id = ? AND order_number = ?', 
          [userId, parsed.order_number]);
      }

      if (existing) {
        // Update if new status is "more progressed"
        const updates = [];
        const params = [];
        
        if (shouldUpdateStatus(existing.status, parsed.status) && !existing.status_override) {
          updates.push('status = ?');
          params.push(parsed.status);
        }
        if (parsed.ai_summary && parsed.ai_summary.length > (existing.ai_summary?.length || 0)) {
          updates.push('ai_summary = ?');
          params.push(parsed.ai_summary);
        }
        if (parsed.expected_delivery && !existing.expected_delivery) {
          updates.push('expected_delivery = ?');
          params.push(parsed.expected_delivery);
        }
        if (parsed.product_name && !existing.product_name) {
          updates.push('product_name = ?');
          params.push(parsed.product_name);
        }
        if (parsed.carrier && !existing.carrier) {
          updates.push('carrier = ?');
          params.push(parsed.carrier);
        }
        
        if (updates.length > 0) {
          updates.push('updated_at = strftime("%s", "now")');
          params.push(existing.id);
          dbRun(`UPDATE shipments SET ${updates.join(', ')} WHERE id = ?`, params);
        }
      } else {
        // Insert new
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
          parsed.raw_from, parsed.messageId, parsed.parsed_by
        ]);
      }
    } catch (error) {
      console.error('Error saving shipment:', error);
    }
  }

  // Update stale statuses
  updateStaleStatuses(userId);

  return getShipmentsForUser(userId);
}

/**
 * Update old shipments that are likely delivered
 */
function updateStaleStatuses(userId) {
  const staleShipments = dbAll(`
    SELECT * FROM shipments 
    WHERE user_id = ? 
    AND status IN ('SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY')
    AND status_override IS NULL
    AND email_date < ?
  `, [userId, (Date.now() / 1000) - (14 * 24 * 60 * 60)]); // 14 days old

  for (const shipment of staleShipments) {
    const newStatus = inferStatusFromAge(
      new Date(shipment.email_date * 1000).toISOString(),
      shipment.status
    );
    
    if (newStatus !== shipment.status) {
      console.log(`📦 Auto-updating ${shipment.tracking_number || shipment.id}: ${shipment.status} → ${newStatus}`);
      dbRun(`UPDATE shipments SET status = ?, ai_summary = ?, updated_at = strftime('%s', 'now') WHERE id = ?`, 
        [newStatus, 'Status updated based on delivery timeframe.', shipment.id]);
    }
  }
}

// ============================================
// GET SHIPMENTS
// ============================================
function getShipmentsForUser(userId, includeArchived = false) {
  let query = `SELECT * FROM shipments WHERE user_id = ?`;
  if (!includeArchived) {
    query += ` AND (archived = 0 OR archived IS NULL)`;
  }
  query += ` ORDER BY email_date DESC`;
  
  const shipments = dbAll(query, [userId]);
  return shipments.map(formatShipmentForFrontend);
}

function formatShipmentForFrontend(shipment) {
  const statusLabels = {
    'ORDERED': 'Order Confirmed',
    'SHIPPED': 'Shipped',
    'IN_TRANSIT': 'In Transit',
    'OUT_FOR_DELIVERY': 'Out for Delivery',
    'DELIVERED': 'Delivered',
    'EXCEPTION': 'Delivery Issue'
  };

  const trackingUrls = {
    'Delhivery': `https://www.delhivery.com/track/package/${shipment.tracking_number}`,
    'BlueDart': `https://www.bluedart.com/tracking/${shipment.tracking_number}`,
    'DTDC': `https://www.dtdc.in/trace.asp?strAwb=${shipment.tracking_number}`,
    'Ekart': `https://www.ekartlogistics.com/track/${shipment.tracking_number}`,
    'Xpressbees': `https://www.xpressbees.com/track?awb=${shipment.tracking_number}`,
    'Shiprocket': `https://www.shiprocket.in/shipment-tracking/${shipment.tracking_number}`,
    'Ecom Express': `https://www.ecomexpress.in/tracking/?awb_field=${shipment.tracking_number}`,
    'Shadowfax': `https://tracker.shadowfax.in/#/track/${shipment.tracking_number}`,
    'Amazon Logistics': `https://www.amazon.in/gp/your-account/order-history`,
    'FedEx': `https://www.fedex.com/fedextrack/?trknbr=${shipment.tracking_number}`,
    'DHL': `https://www.dhl.com/in-en/home/tracking.html?tracking-id=${shipment.tracking_number}`
  };

  const trackingUrl = shipment.carrier && shipment.tracking_number 
    ? trackingUrls[shipment.carrier] || null 
    : null;

  const emailDate = shipment.email_date ? new Date(shipment.email_date * 1000) : new Date();
  const dateStr = emailDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });

  // Use override status if set
  const finalStatus = shipment.status_override || shipment.status || 'IN_TRANSIT';

  return {
    id: shipment.id,
    itemName: shipment.product_name || 'Package',
    merchant: { name: shipment.merchant || 'Unknown' },
    carrier: shipment.carrier || 'Unknown',
    status: finalStatus,
    statusLabel: statusLabels[finalStatus] || 'In Transit',
    trackingNumber: shipment.tracking_number || 'N/A',
    orderNumber: shipment.order_number || 'N/A',
    expectedDelivery: shipment.expected_delivery || null,
    eta: { label: 'Expected', date: dateStr },
    aiSummary: shipment.ai_summary || null,
    trackingUrl,
    date: dateStr,
    rawSubject: shipment.raw_subject,
    archived: shipment.archived === 1
  };
}

// ============================================
// API ROUTES
// ============================================
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: "Where's My Stuff API", 
    timestamp: new Date().toISOString() 
  });
});

app.get('/api/shipments', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const includeArchived = req.query.archived === 'true';
    const shipments = getShipmentsForUser(session.userId, includeArchived);
    res.json(shipments);
  } catch (error) {
    console.error('Error fetching shipments:', error);
    res.status(500).json({ error: 'Failed to fetch shipments' });
  }
});

app.post('/api/shipments/sync', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const shipments = await syncShipmentsForUser(session.userId);
    res.json({ success: true, shipments, rateLimited: false });
  } catch (error) {
    console.error('Error syncing:', error);
    
    // Check if it's a rate limit error
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      return res.status(429).json({ 
        error: 'Rate limited', 
        rateLimited: true,
        retryAfter: 30,
        message: 'Too many requests. Please wait before syncing again.'
      });
    }
    
    res.status(500).json({ error: error.message || 'Failed to sync' });
  }
});

app.post('/api/shipments/:id/mark-delivered', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    dbRun(`
      UPDATE shipments 
      SET status = 'DELIVERED', status_override = 'DELIVERED', 
          ai_summary = 'Manually marked as delivered.', 
          updated_at = strftime('%s', 'now')
      WHERE id = ? AND user_id = ?
    `, [req.params.id, session.userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to update' });
  }
});

app.post('/api/shipments/:id/archive', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    dbRun(`UPDATE shipments SET archived = 1, updated_at = strftime('%s', 'now') WHERE id = ? AND user_id = ?`,
      [req.params.id, session.userId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to archive' });
  }
});

app.post('/api/shipments/:id/unarchive', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    dbRun(`UPDATE shipments SET archived = 0, updated_at = strftime('%s', 'now') WHERE id = ? AND user_id = ?`,
      [req.params.id, session.userId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unarchive' });
  }
});

app.post('/api/shipments/:id/refresh-summary', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const shipment = dbGet('SELECT * FROM shipments WHERE id = ? AND user_id = ?', 
      [req.params.id, session.userId]);
    if (!shipment) return res.status(404).json({ error: 'Not found' });

    const relatedEmails = dbAll(`
      SELECT raw_subject, email_date FROM shipments 
      WHERE user_id = ? AND (tracking_number = ? OR order_number = ?)
      ORDER BY email_date DESC
    `, [session.userId, shipment.tracking_number, shipment.order_number]);

    const newSummary = await generateShipmentSummary(
      relatedEmails.map(e => ({ 
        subject: e.raw_subject, 
        date: new Date(e.email_date * 1000).toISOString() 
      })),
      shipment.status,
      config.gemini.apiKey
    );

    if (newSummary) {
      dbRun('UPDATE shipments SET ai_summary = ?, updated_at = strftime("%s", "now") WHERE id = ?', 
        [newSummary, shipment.id]);
    }

    res.json({ success: true, summary: newSummary });
  } catch (error) {
    res.status(500).json({ error: 'Failed to refresh' });
  }
});

// Delete a shipment
app.delete('/api/shipments/:id', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  try {
    dbRun('DELETE FROM shipments WHERE id = ? AND user_id = ?', [req.params.id, session.userId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete' });
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
║                   Where's My Stuff? v2                     ║
║                                                            ║
║  Server: http://localhost:${PORT}                             ║
║  Gemini: ${config.gemini.apiKey ? '✓ Ready' : '✗ Missing'}                                    ║
║  OAuth:  ${config.google.clientId ? '✓ Ready' : '✗ Missing'}                                    ║
╚════════════════════════════════════════════════════════════╝
    `);
  });
}

startServer().catch(console.error);
