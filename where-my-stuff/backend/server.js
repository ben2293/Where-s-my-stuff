require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { getDb, get, all, run } = require('./db');
const { getAuthUrl, exchangeCode, syncGmail, resyncPackage } = require('./gmail');

const app = express();
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

app.set('trust proxy', 1);
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

function getToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function requireAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const user = get('SELECT * FROM users WHERE auth_token = ?', [token]);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.userEmail = user.email;
  req.user = user;
  next();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.get('/auth/google', (req, res) => {
  try { res.redirect(getAuthUrl()); }
  catch { res.redirect(`${FRONTEND_URL}?error=auth_init_failed`); }
});

app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect(`${FRONTEND_URL}?error=${error || 'no_code'}`);
  try {
    const { tokens, profile } = await exchangeCode(code);
    const authToken = crypto.randomBytes(32).toString('hex');
    run(
      `INSERT INTO users (email, name, picture, access_token, refresh_token, token_expiry, auth_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         name=excluded.name, picture=excluded.picture,
         access_token=excluded.access_token,
         refresh_token=COALESCE(excluded.refresh_token, refresh_token),
         token_expiry=excluded.token_expiry,
         auth_token=excluded.auth_token`,
      [profile.email, profile.name, profile.picture || null,
       tokens.access_token, tokens.refresh_token || null, tokens.expiry_date || 0, authToken]
    );
    res.redirect(`${FRONTEND_URL}?token=${authToken}`);
  } catch (e) {
    console.error('Auth callback error:', e.message);
    res.redirect(`${FRONTEND_URL}?error=auth_failed`);
  }
});

app.get('/auth/me', (req, res) => {
  const token = getToken(req);
  if (!token) return res.json({ user: null });
  const user = get('SELECT email, name, picture, last_sync FROM users WHERE auth_token = ?', [token]);
  res.json({ user: user || null });
});

app.post('/auth/logout', (req, res) => {
  const token = getToken(req);
  if (token) run('UPDATE users SET auth_token = NULL WHERE auth_token = ?', [token]);
  res.json({ success: true });
});

// ── Packages ──────────────────────────────────────────────────────────────────

app.get('/api/packages', requireAuth, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  ?? '50', 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset ?? '0',  10) || 0,  0);
  const pkgs = all(
    'SELECT * FROM packages WHERE user_email = ? ORDER BY received_date DESC LIMIT ? OFFSET ?',
    [req.userEmail, limit, offset]
  );
  const total = get('SELECT COUNT(*) as n FROM packages WHERE user_email = ?', [req.userEmail])?.n ?? 0;
  res.json({ packages: pkgs, total, offset, limit });
});

app.post('/api/sync', requireAuth, async (req, res) => {
  const userEmail = req.userEmail;
  try {
    const user = req.user;
    if (!user?.access_token) {
      return res.status(401).json({ error: 'No Gmail access. Please sign in again.' });
    }

    // Load user's learned blocks so sync can skip them
    const userBlocks = all('SELECT type, value FROM user_blocks WHERE user_email = ?', [userEmail]);

    const { packages, freshAccessToken } = await syncGmail(
      { access_token: user.access_token, refresh_token: user.refresh_token },
      user.last_sync || 0,
      userBlocks
    );

    if (freshAccessToken && freshAccessToken !== user.access_token) {
      run('UPDATE users SET access_token = ? WHERE email = ?', [freshAccessToken, userEmail]);
    }

    for (const p of packages) {
      run(
        `INSERT INTO packages
           (user_email, gmail_message_id, thread_id, from_address, merchant, carrier, tracking_number,
            order_number, status, stage, subject, received_date, snippet, image_url, price, expected_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_email, gmail_message_id) DO UPDATE SET
           merchant=excluded.merchant, carrier=excluded.carrier,
           stage=CASE WHEN excluded.stage>=7 THEN MAX(excluded.stage,stage) WHEN stage>=7 THEN stage WHEN stage>=5 THEN stage ELSE MAX(excluded.stage,stage) END,
           status=CASE WHEN excluded.stage>=7 THEN CASE WHEN excluded.stage>=stage THEN excluded.status ELSE status END WHEN stage>=5 THEN status ELSE excluded.status END,
           thread_id=COALESCE(excluded.thread_id, thread_id),
           from_address=COALESCE(excluded.from_address, from_address),
           image_url=COALESCE(excluded.image_url, image_url),
           price=COALESCE(excluded.price, price),
           order_number=COALESCE(excluded.order_number, order_number),
           expected_date=COALESCE(excluded.expected_date, expected_date),
           updated_at=strftime('%s','now')`,
        [userEmail, p.gmail_message_id, p.thread_id || null, p.from_address || null,
         p.merchant, p.carrier, p.trackingNumber, p.orderNumber || null, p.status, p.stage,
         p.subject, p.received_date, p.snippet, p.image_url || null, p.price || null, p.expectedDate || null]
      );
    }

    run('UPDATE users SET last_sync = ? WHERE email = ?', [Date.now(), userEmail]);

    const all_pkgs = all(
      'SELECT * FROM packages WHERE user_email = ? ORDER BY received_date DESC LIMIT 200',
      [userEmail]
    );

    res.json({ success: true, newCount: packages.length, packages: all_pkgs });
  } catch (e) {
    console.error('Sync error:', e.message);
    res.status(500).json({ error: e.message || 'Sync failed' });
  }
});

app.post('/api/packages/:id/resync', requireAuth, async (req, res) => {
  const { id } = req.params;
  const pkg = get('SELECT * FROM packages WHERE id = ? AND user_email = ?', [id, req.userEmail]);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  const user = req.user;
  if (!user?.access_token) return res.status(401).json({ error: 'No Gmail access' });
  try {
    const { package: p, freshAccessToken } = await resyncPackage(
      { access_token: user.access_token, refresh_token: user.refresh_token },
      pkg
    );
    if (freshAccessToken) run('UPDATE users SET access_token = ? WHERE email = ?', [freshAccessToken, req.userEmail]);
    if (p) {
      run(
        `UPDATE packages SET
           merchant=?, carrier=?, status=?, stage=?,
           tracking_number=COALESCE(?, tracking_number),
           order_number=COALESCE(?, order_number),
           expected_date=COALESCE(?, expected_date),
           image_url=COALESCE(?, image_url),
           price=COALESCE(?, price),
           updated_at=strftime('%s','now')
         WHERE id=?`,
        [p.merchant, p.carrier, p.status, p.stage,
         p.trackingNumber, p.orderNumber, p.expectedDate,
         p.image_url, p.price, id]
      );
    }
    res.json({ success: true, package: get('SELECT * FROM packages WHERE id = ?', [id]) });
  } catch (e) {
    console.error('Resync error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Diagnose why a package leaked through the delivery filter
// Returns a list of block rules to create + a human-readable reason string
const SUBJECT_DELIVERY_KEYWORDS = [
  'shipped', 'dispatched', 'delivered', 'delivery', 'shipment',
  'out for delivery', 'in transit', 'order confirmed', 'order placed',
  'order received', 'order update', 'your order', 'on its way',
  'arriving today', 'tracking', 'invoice', 'your package',
];

function diagnose(pkg) {
  const blocks = [];
  const reasons = [];

  // 1. Block the specific sender email address (most surgical)
  if (pkg.from_address) {
    blocks.push({ type: 'sender', value: pkg.from_address });
    reasons.push(`sender ${pkg.from_address}`);
  }

  // 2. Identify which subject keyword triggered the match
  const subjectLow = (pkg.subject || '').toLowerCase();
  for (const kw of SUBJECT_DELIVERY_KEYWORDS) {
    if (subjectLow.includes(kw)) {
      reasons.push(`subject matched "${kw}"`);
      break;
    }
  }

  // 3. Note if it had a false tracking/order number
  if (pkg.tracking_number) reasons.push(`false tracking: ${pkg.tracking_number}`);
  else if (pkg.order_number) reasons.push(`false order: ${pkg.order_number}`);
  else if (pkg.stage > 0)    reasons.push(`false stage detection (stage ${pkg.stage})`);

  return {
    blocks,
    reason: reasons.join(' · ') || 'unknown pattern',
    learnedLabel: pkg.from_address ? `Won't show emails from ${pkg.from_address} again` : 'Pattern blocked',
  };
}

app.post('/api/packages/:id/report', requireAuth, (req, res) => {
  const { id } = req.params;
  const pkg = get('SELECT * FROM packages WHERE id = ? AND user_email = ?', [id, req.userEmail]);
  if (!pkg) return res.status(404).json({ error: 'Not found' });

  const { blocks, reason, learnedLabel } = diagnose(pkg);

  // Persist block rules
  for (const block of blocks) {
    try {
      run(
        `INSERT INTO user_blocks (user_email, type, value, reason)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_email, type, value) DO NOTHING`,
        [req.userEmail, block.type, block.value, reason]
      );
    } catch { /* duplicate — ignore */ }
  }

  // Delete the package so it never comes back
  run('DELETE FROM packages WHERE id = ?', [id]);

  console.log(`[feedback] ${req.userEmail} reported "${pkg.subject}" — ${reason}`);

  res.json({ success: true, reason, learnedLabel, blocksAdded: blocks.length });
});

app.get('/api/blocks', requireAuth, (req, res) => {
  const blocks = all('SELECT * FROM user_blocks WHERE user_email = ? ORDER BY created_at DESC', [req.userEmail]);
  res.json(blocks);
});

app.delete('/api/blocks/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const block = get('SELECT id FROM user_blocks WHERE id = ? AND user_email = ?', [id, req.userEmail]);
  if (!block) return res.status(404).json({ error: 'Not found' });
  run('DELETE FROM user_blocks WHERE id = ?', [id]);
  res.json({ success: true });
});

app.patch('/api/packages/:id/stage', requireAuth, (req, res) => {
  const { id } = req.params;
  const { stage } = req.body;
  if (typeof stage !== 'number' || stage < 0 || stage > 8) return res.status(400).json({ error: 'Invalid stage' });
  const pkg = get('SELECT id FROM packages WHERE id = ? AND user_email = ?', [id, req.userEmail]);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  const STATUS_MAP = { 0:'Order Confirmed',1:'Processing',2:'Dispatched',3:'In Transit',4:'Out for Delivery',5:'Delivered',6:'Failed / Returned',7:'Return Initiated',8:'Returned' };
  run('UPDATE packages SET stage = ?, status = ?, updated_at = strftime(\'%s\',\'now\') WHERE id = ?',
    [stage, STATUS_MAP[stage] ?? 'Order Confirmed', id]);
  res.json({ success: true });
});

// Initialise DB then start server
const PORT = process.env.PORT || 3001;
getDb().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch(e => {
  console.error('Failed to initialise DB:', e);
  process.exit(1);
});
