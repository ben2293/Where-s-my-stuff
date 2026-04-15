require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { getDb, get, all, run } = require('./db');
const { getAuthUrl, exchangeCode, syncGmail } = require('./gmail');

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

app.set('trust proxy', 1);
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

function requireAuth(req, res, next) {
  if (!req.session?.userEmail) return res.status(401).json({ error: 'Not authenticated' });
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
    run(
      `INSERT INTO users (email, name, picture, access_token, refresh_token, token_expiry)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         name=excluded.name, picture=excluded.picture,
         access_token=excluded.access_token,
         refresh_token=COALESCE(excluded.refresh_token, refresh_token),
         token_expiry=excluded.token_expiry`,
      [profile.email, profile.name, profile.picture || null,
       tokens.access_token, tokens.refresh_token || null, tokens.expiry_date || 0]
    );
    req.session.userEmail = profile.email;
    res.redirect(FRONTEND_URL);
  } catch (e) {
    console.error('Auth callback error:', e.message);
    res.redirect(`${FRONTEND_URL}?error=auth_failed`);
  }
});

app.get('/auth/me', (req, res) => {
  if (!req.session?.userEmail) return res.json({ user: null });
  const user = get('SELECT email, name, picture, last_sync FROM users WHERE email = ?', [req.session.userEmail]);
  res.json({ user: user || null });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── Packages ──────────────────────────────────────────────────────────────────

app.get('/api/packages', requireAuth, (req, res) => {
  const pkgs = all(
    'SELECT * FROM packages WHERE user_email = ? ORDER BY received_date DESC LIMIT 200',
    [req.session.userEmail]
  );
  res.json(pkgs);
});

app.post('/api/sync', requireAuth, async (req, res) => {
  const userEmail = req.session.userEmail;
  try {
    const user = get('SELECT * FROM users WHERE email = ?', [userEmail]);
    if (!user?.access_token) {
      return res.status(401).json({ error: 'No Gmail access. Please sign in again.' });
    }

    const { packages, freshAccessToken } = await syncGmail(
      { access_token: user.access_token, refresh_token: user.refresh_token },
      user.last_sync || 0
    );

    if (freshAccessToken && freshAccessToken !== user.access_token) {
      run('UPDATE users SET access_token = ? WHERE email = ?', [freshAccessToken, userEmail]);
    }

    for (const p of packages) {
      run(
        `INSERT INTO packages
           (user_email, gmail_message_id, thread_id, merchant, carrier, tracking_number,
            order_number, status, stage, subject, received_date, snippet, image_url, price, expected_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_email, gmail_message_id) DO UPDATE SET
           merchant=excluded.merchant, carrier=excluded.carrier,
           status=excluded.status, stage=excluded.stage,
           thread_id=COALESCE(excluded.thread_id, thread_id),
           image_url=COALESCE(excluded.image_url, image_url),
           price=COALESCE(excluded.price, price),
           order_number=COALESCE(excluded.order_number, order_number),
           expected_date=COALESCE(excluded.expected_date, expected_date),
           updated_at=strftime('%s','now')`,
        [userEmail, p.gmail_message_id, p.thread_id || null, p.merchant, p.carrier,
         p.trackingNumber, p.orderNumber || null, p.status, p.stage,
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

app.patch('/api/packages/:id/stage', requireAuth, (req, res) => {
  const { id } = req.params;
  const { stage } = req.body;
  if (![5, 6].includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  const pkg = get('SELECT id FROM packages WHERE id = ? AND user_email = ?', [id, req.session.userEmail]);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  run('UPDATE packages SET stage = ?, status = ?, updated_at = strftime(\'%s\',\'now\') WHERE id = ?',
    [stage, stage === 5 ? 'Delivered' : 'Failed / Returned', id]);
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
