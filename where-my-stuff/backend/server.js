require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { getDb, get, all, run } = require('./db');
const { getAuthUrl, exchangeCode, syncGmail, resyncPackage } = require('./gmail');
const { extractExpectedDate, deepEnrichEmail, isValidOrderNumber } = require('./parser');

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

async function requireAuth(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const user = await get('SELECT * FROM users WHERE auth_token = ?', [token]);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.userEmail = user.email;
    req.user = user;
    next();
  } catch (e) {
    console.error('requireAuth error:', e.message);
    res.status(500).json({ error: 'Database error' });
  }
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
    await run(
      `INSERT INTO users (email, name, picture, access_token, refresh_token, token_expiry, auth_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         name=excluded.name, picture=excluded.picture,
         access_token=excluded.access_token,
         refresh_token=COALESCE(excluded.refresh_token, users.refresh_token),
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

app.get('/auth/me', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.json({ user: null });
  const user = await get('SELECT email, name, picture, last_sync FROM users WHERE auth_token = ?', [token]);
  res.json({ user: user || null });
});

app.post('/auth/logout', async (req, res) => {
  const token = getToken(req);
  if (token) await run('UPDATE users SET auth_token = NULL WHERE auth_token = ?', [token]);
  res.json({ success: true });
});

// ── Packages ──────────────────────────────────────────────────────────────────

app.get('/api/packages', requireAuth, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  ?? '50', 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset ?? '0',  10) || 0,  0);
  const pkgs = await all(
    'SELECT * FROM packages WHERE user_email = ? ORDER BY received_date DESC LIMIT ? OFFSET ?',
    [req.userEmail, limit, offset]
  );
  const row = await get('SELECT COUNT(*)::int as n FROM packages WHERE user_email = ?', [req.userEmail]);
  res.json({ packages: pkgs, total: row?.n ?? 0, offset, limit });
});

app.post('/api/sync', requireAuth, async (req, res) => {
  const userEmail = req.userEmail;
  try {
    const user = req.user;
    if (!user?.access_token) {
      return res.status(401).json({ error: 'No Gmail access. Please sign in again.' });
    }

    const tzOffsetMin = typeof req.body?.tzOffsetMin === 'number' ? req.body.tzOffsetMin : undefined;

    const userBlocks = await all('SELECT type, value FROM user_blocks WHERE user_email = ?', [userEmail]);

    const { packages, freshAccessToken } = await syncGmail(
      { access_token: user.access_token, refresh_token: user.refresh_token },
      user.last_sync || 0,
      userBlocks,
      tzOffsetMin
    );

    if (freshAccessToken && freshAccessToken !== user.access_token) {
      await run('UPDATE users SET access_token = ? WHERE email = ?', [freshAccessToken, userEmail]);
    }

    // Enrich each package by searching Gmail for its order/tracking number.
    // The subject-keyword search may only find one email (e.g. "order confirmed").
    // Searching by order number finds the FULL lifecycle: shipped, tracking, delivered.
    // This runs BEFORE storage so the package is saved at the correct stage immediately.
    for (let i = 0; i < packages.length; i++) {
      const p = packages[i];
      try {
        // SMARTER ENRICHMENT: only chase the order number when the initial
        // parse is weak. Strong signals (tracking, dispatched/delivered, known
        // carrier) mean the package is already well-classified.
        //
        // Weak signals that justify enrichment:
        //   - Stage 0 (ordered) with no tracking or carrier — just an order #
        //   - No order number and no tracking number — can't search anyway
        //
        // Skip enrichment when:
        //   - Already stage 5+ (delivered/failed/returned) — done
        //   - Has valid tracking number — tracking is a strong logistics signal
        //   - Stage > 0 AND has carrier — dispatched by a known carrier
        //
        if (!p.orderNumber && !p.trackingNumber) continue;
        if (p.stage >= 5) continue;
        if (p.trackingNumber) continue;
        if (p.stage > 0 && p.carrier) continue;
        const tokens = { access_token: user.access_token, refresh_token: user.refresh_token };
        const searchPkg = {
          thread_id: null,
          order_number: p.orderNumber || null,
          tracking_number: p.trackingNumber || null,
        };
        const { package: enriched, freshAccessToken: fat } = await resyncPackage(tokens, searchPkg, tzOffsetMin);
        if (fat && fat !== user.access_token) {
          await run('UPDATE users SET access_token = ? WHERE email = ?', [fat, userEmail]);
          user.access_token = fat;
        }
        if (enriched && enriched.stage > p.stage) {
          // Found higher-stage emails → use enriched data
          packages[i] = {
            ...p,
            stage: enriched.stage,
            status: enriched.status,
            carrier: enriched.carrier || p.carrier,
            trackingNumber: enriched.trackingNumber || p.trackingNumber,
            expectedDate: enriched.expectedDate || p.expectedDate,
            image_url: enriched.image_url || p.image_url,
            productName: enriched.productName || p.productName,
          };
        }
      } catch (e) {
        console.warn(`[sync] enrichment failed for order ${p.orderNumber}:`, e.message);
      }
    }

    for (const p of packages) {
      await run(
        `INSERT INTO packages
           (user_email, gmail_message_id, thread_id, from_address, merchant, carrier, tracking_number,
            order_number, status, stage, subject, received_date, snippet, image_url, price, expected_date, product_name, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_email, gmail_message_id) DO UPDATE SET
           merchant=excluded.merchant, carrier=excluded.carrier,
           stage=CASE WHEN excluded.stage>=7 THEN GREATEST(excluded.stage,packages.stage) WHEN packages.stage>=7 THEN packages.stage WHEN packages.manually_delivered=1 AND packages.stage>=5 THEN packages.stage ELSE GREATEST(excluded.stage,packages.stage) END,
           status=CASE WHEN excluded.stage>=7 THEN CASE WHEN excluded.stage>=packages.stage THEN excluded.status ELSE packages.status END WHEN packages.manually_delivered=1 AND packages.stage>=5 THEN packages.status ELSE excluded.status END,
           thread_id=COALESCE(excluded.thread_id, packages.thread_id),
           from_address=COALESCE(excluded.from_address, packages.from_address),
           image_url=COALESCE(excluded.image_url, packages.image_url),
           price=COALESCE(excluded.price, packages.price),
           order_number=COALESCE(excluded.order_number, packages.order_number),
           expected_date=COALESCE(excluded.expected_date, packages.expected_date),
            product_name=COALESCE(excluded.product_name, packages.product_name),
            currency=COALESCE(excluded.currency, packages.currency),
            updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT`,
        [userEmail, p.gmail_message_id, p.thread_id || null, p.from_address || null,
         p.merchant, p.carrier, p.trackingNumber, p.orderNumber || null, p.status, p.stage,
         p.subject, p.received_date, p.snippet, p.image_url || null, p.price || null, p.expectedDate || null,
         p.productName || null, p.currency || 'INR']
      );
    }

    // Only advance last_sync if we found emails OR a previous sync already ran
    if (packages.length > 0 || user.last_sync > 0) {
      await run('UPDATE users SET last_sync = ? WHERE email = ?', [Date.now(), userEmail]);
    }

    // Promote packages whose order/tracking is already manually delivered
    await run(
      `UPDATE packages SET stage=5, status='Delivered', manually_delivered=1
       WHERE user_email=? AND stage BETWEEN 0 AND 4 AND (
         (thread_id IS NOT NULL AND thread_id IN (
           SELECT thread_id FROM packages
           WHERE user_email=? AND manually_delivered=1 AND thread_id IS NOT NULL
         ))
         OR
         (order_number IS NOT NULL AND order_number != '' AND order_number IN (
           SELECT order_number FROM packages
           WHERE user_email=? AND manually_delivered=1 AND order_number IS NOT NULL AND order_number != ''
         ))
         OR
         (tracking_number IS NOT NULL AND tracking_number != '' AND tracking_number IN (
           SELECT tracking_number FROM packages
           WHERE user_email=? AND manually_delivered=1 AND tracking_number IS NOT NULL AND tracking_number != ''
         ))
       )`,
      [userEmail, userEmail, userEmail, userEmail]
    );

    // Re-verify ALL active packages (not just missing expected_date).
    // Shipping/delivery emails may have different subject lines that didn't
    // match the keyword set. Searching by order/tracking number catches them.
    // Only resync packages not updated in the last hour to avoid duplicate work.
    const ONE_HOUR_MS = 3600_000;
    const nowMs = Date.now();
    const activePkgs = await all(
      `SELECT * FROM packages WHERE user_email = ? AND stage BETWEEN 0 AND 4
       AND (updated_at IS NULL OR updated_at < ?)`,
      [userEmail, Math.floor((nowMs - ONE_HOUR_MS) / 1000)]
    );
    for (const pkg of activePkgs) {
      try {
        const tokens = { access_token: user.access_token, refresh_token: user.refresh_token };
        const { package: p, freshAccessToken: fat, body: resyncBody } = await resyncPackage(tokens, pkg, tzOffsetMin);
        if (fat && fat !== user.access_token) {
          await run('UPDATE users SET access_token = ? WHERE email = ?', [fat, userEmail]);
          user.access_token = fat;
        }
        const newDate = p?.expectedDate
          || extractExpectedDate(`${pkg.subject || ''} ${pkg.snippet || ''}`, pkg.received_date, tzOffsetMin)
          || (resyncBody ? extractExpectedDate(resyncBody, pkg.received_date, tzOffsetMin) : null);
        // Update stage if resync found a higher one (e.g. delivered email)
        if (p && p.stage > pkg.stage) {
          await run('UPDATE packages SET stage=?, status=?, expected_date=COALESCE(?,expected_date), updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=?',
            [p.stage, p.status, newDate, pkg.id]);
        } else if (newDate) {
          await run('UPDATE packages SET expected_date = ? WHERE id = ?', [newDate, pkg.id]);
        }
      } catch (e) {
        console.warn(`[sync] date re-verify failed for pkg ${pkg.id}:`, e.message);
      }
    }

    const all_pkgs = await all(
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
  const pkg = await get('SELECT * FROM packages WHERE id = ? AND user_email = ?', [id, req.userEmail]);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  const user = req.user;
  if (!user?.access_token) return res.status(401).json({ error: 'No Gmail access' });
  const tzOffsetMin = typeof req.body?.tzOffsetMin === 'number' ? req.body.tzOffsetMin : undefined;
  try {
    const { package: p, freshAccessToken, body: resyncBody } = await resyncPackage(
      { access_token: user.access_token, refresh_token: user.refresh_token },
      pkg,
      tzOffsetMin
    );
    if (freshAccessToken) await run('UPDATE users SET access_token = ? WHERE email = ?', [freshAccessToken, req.userEmail]);
    if (p) {
      const oldOrderValid = isValidOrderNumber(pkg.order_number);
      const newOrderValid = isValidOrderNumber(p.orderNumber);
      await run(
        `UPDATE packages SET
           merchant=?, carrier=?,
           stage=CASE WHEN manually_delivered=1 AND stage>=5 THEN stage ELSE ? END,
           status=CASE WHEN manually_delivered=1 AND stage>=5 THEN status ELSE ? END,
           tracking_number=COALESCE(?, tracking_number),
           order_number=?,
           expected_date=?,
           image_url=COALESCE(?, image_url),
           price=COALESCE(?, price),
           product_name=COALESCE(?, product_name),
           subject=?, snippet=?, from_address=?,
           gmail_message_id=?, thread_id=COALESCE(?, thread_id),
           updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT
         WHERE id=?`,
        [p.merchant, p.carrier, p.stage, p.status,
         p.trackingNumber,
         newOrderValid ? p.orderNumber : (oldOrderValid ? pkg.order_number : null),
         p.expectedDate || null,
         p.image_url, p.price, p.productName || null,
         p.subject || pkg.subject, p.snippet || pkg.snippet, p.from_address || pkg.from_address,
         p.gmail_message_id, p.thread_id || pkg.thread_id, id]
      );
    }

    // Deep Haiku enrichment — extract product name + real store name from full email body
    if (resyncBody) {
      const enriched = await deepEnrichEmail({
        from: (p?.from_address) || pkg.from_address || '',
        subject: (p?.subject) || pkg.subject || '',
        snippet: (p?.snippet) || pkg.snippet || '',
        body: resyncBody,
      }).catch(() => null);
      if (enriched) {
        const PLATFORM_RE = /^(shopify|unknown|woocommerce)$/i;
        const newProductName = enriched.productName || null;
        const newMerchant = (enriched.storeName && PLATFORM_RE.test(pkg.merchant))
          ? enriched.storeName : null;
        if (newProductName || newMerchant) {
          await run(
            `UPDATE packages SET
               product_name=COALESCE(?,product_name),
               merchant=COALESCE(?,merchant),
               updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT
             WHERE id=?`,
            [newProductName, newMerchant, id]
          );
        }
      }
    }

    res.json({ success: true, package: await get('SELECT * FROM packages WHERE id = ?', [id]) });
  } catch (e) {
    console.error('Resync error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const SUBJECT_DELIVERY_KEYWORDS = [
  'shipped', 'dispatched', 'delivered', 'delivery', 'shipment',
  'out for delivery', 'in transit', 'order confirmed', 'order placed',
  'order received', 'order update', 'your order', 'on its way',
  'arriving today', 'tracking', 'invoice', 'your package',
];

function diagnose(pkg) {
  const blocks = [];
  const reasons = [];
  if (pkg.from_address) {
    blocks.push({ type: 'sender', value: pkg.from_address });
    reasons.push(`sender ${pkg.from_address}`);
  }
  const subjectLow = (pkg.subject || '').toLowerCase();
  for (const kw of SUBJECT_DELIVERY_KEYWORDS) {
    if (subjectLow.includes(kw)) { reasons.push(`subject matched "${kw}"`); break; }
  }
  if (pkg.tracking_number) reasons.push(`false tracking: ${pkg.tracking_number}`);
  else if (pkg.order_number) reasons.push(`false order: ${pkg.order_number}`);
  else if (pkg.stage > 0)    reasons.push(`false stage detection (stage ${pkg.stage})`);
  return {
    blocks,
    reason: reasons.join(' · ') || 'unknown pattern',
    learnedLabel: pkg.from_address ? `Won't show emails from ${pkg.from_address} again` : 'Pattern blocked',
  };
}

app.post('/api/packages/:id/report', requireAuth, async (req, res) => {
  const { id } = req.params;
  const pkg = await get('SELECT * FROM packages WHERE id = ? AND user_email = ?', [id, req.userEmail]);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  const { blocks, reason, learnedLabel } = diagnose(pkg);
  for (const block of blocks) {
    try {
      await run(
        `INSERT INTO user_blocks (user_email, type, value, reason)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_email, type, value) DO NOTHING`,
        [req.userEmail, block.type, block.value, reason]
      );
    } catch { /* duplicate — ignore */ }
  }
  const blockIds = (await Promise.all(blocks.map(b =>
    get('SELECT id FROM user_blocks WHERE user_email = ? AND type = ? AND value = ?', [req.userEmail, b.type, b.value])
  ))).map(r => r?.id).filter(id => id != null);

  await run('DELETE FROM packages WHERE id = ?', [id]);
  console.log(`[feedback] ${req.userEmail} reported "${pkg.subject}" — ${reason}`);
  res.json({ success: true, reason, learnedLabel, blocksAdded: blocks.length, blockIds });
});

app.post('/api/cleanse', requireAuth, async (req, res) => {
  await run('DELETE FROM packages WHERE user_email = ?', [req.userEmail]);
  await run('UPDATE users SET last_sync = 0 WHERE email = ?', [req.userEmail]);
  res.json({ success: true });
});

app.get('/api/blocks', requireAuth, async (req, res) => {
  const blocks = await all('SELECT * FROM user_blocks WHERE user_email = ? ORDER BY created_at DESC', [req.userEmail]);
  res.json(blocks);
});

app.delete('/api/blocks/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const block = await get('SELECT id FROM user_blocks WHERE id = ? AND user_email = ?', [id, req.userEmail]);
  if (!block) return res.status(404).json({ error: 'Not found' });
  await run('DELETE FROM user_blocks WHERE id = ?', [id]);
  res.json({ success: true });
});

app.patch('/api/packages/:id/stage', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { stage } = req.body;
  if (typeof stage !== 'number' || stage < 0 || stage > 8) return res.status(400).json({ error: 'Invalid stage' });
  const pkg = await get('SELECT id, order_number, tracking_number, thread_id FROM packages WHERE id = ? AND user_email = ?', [id, req.userEmail]);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  const STATUS_MAP = { 0:'Ordered',1:'Processing',2:'Dispatched',3:'In Transit',4:'Out for Delivery',5:'Delivered',6:'Failed / Returned',7:'Return Initiated',8:'Returned' };
  const newStatus = STATUS_MAP[stage] ?? 'Order Confirmed';
  const manuallyDelivered = stage >= 5 ? 1 : 0;
  const ts = 'EXTRACT(EPOCH FROM NOW())::BIGINT';
  await run(`UPDATE packages SET stage=?, status=?, manually_delivered=?, updated_at=${ts} WHERE id=?`,
    [stage, newStatus, manuallyDelivered, id]);
  if (pkg.thread_id) {
    await run(`UPDATE packages SET stage=?, status=?, manually_delivered=?, updated_at=${ts} WHERE user_email=? AND thread_id=? AND id!=?`,
      [stage, newStatus, manuallyDelivered, req.userEmail, pkg.thread_id, id]);
  }
  const ORDER_BLACKLIST = /^(number|no|id|update|summary|details|status|confirmation|confirmed|regular|express|placed|received|accepted|cancelled|canceled)$/i;
  if (pkg.order_number && !ORDER_BLACKLIST.test(pkg.order_number)) {
    await run(`UPDATE packages SET stage=?, status=?, manually_delivered=?, updated_at=${ts} WHERE user_email=? AND order_number=? AND id!=?`,
      [stage, newStatus, manuallyDelivered, req.userEmail, pkg.order_number, id]);
  }
  if (pkg.tracking_number) {
    await run(`UPDATE packages SET stage=?, status=?, manually_delivered=?, updated_at=${ts} WHERE user_email=? AND tracking_number=? AND id!=?`,
      [stage, newStatus, manuallyDelivered, req.userEmail, pkg.tracking_number, id]);
  }
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
