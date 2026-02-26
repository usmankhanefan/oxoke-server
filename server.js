const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const ADMIN_KEY = process.env.ADMIN_KEY || 'oxoke_admin_2025';

app.use(cors());
app.use(express.json());

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const seed = path.join(__dirname, 'codes_seed.json');
    if (fs.existsSync(seed)) fs.copyFileSync(seed, DATA_FILE);
    else fs.writeFileSync(DATA_FILE, JSON.stringify({ activation_codes: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function hashId(id) {
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16);
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'OXOKE Activation Server Running', version: '4.0.0' });
});

// ==============================
// POST /api/activate
// ==============================
app.post('/api/activate', (req, res) => {
  const { code, browser_id } = req.body;
  if (!code || !browser_id) return res.status(400).json({ success: false, message: 'Missing fields' });

  const nc = code.toUpperCase().trim();
  const hb = hashId(browser_id);
  const data = loadData();
  const cd = data.activation_codes[nc];

  if (!cd) return res.status(404).json({ success: false, message: 'Invalid activation code. Contact: +8801811507607' });
  if (!cd.active) return res.status(403).json({ success: false, message: 'Code disabled. Contact: +8801811507607' });

  if (!cd.browsers) cd.browsers = [];

  // এই browser আগে activate হয়েছিল?
  if (cd.browsers.includes(hb)) {
    return res.json({ success: true, message: 'Already activated.', browsers_used: cd.browsers.length, max_browsers: cd.max_browsers });
  }

  // Limit check
  if (cd.browsers.length >= cd.max_browsers) {
    return res.status(403).json({
      success: false,
      message: `Maximum browser limit reached (${cd.max_browsers} browsers). Contact: +8801811507607`
    });
  }

  cd.browsers.push(hb);
  cd.last_activated = new Date().toISOString();
  saveData(data);

  return res.json({ success: true, message: 'Activation successful!', browsers_used: cd.browsers.length, max_browsers: cd.max_browsers });
});

// ==============================
// POST /api/verify
// ==============================
app.post('/api/verify', (req, res) => {
  const { code, browser_id } = req.body;
  if (!code || !browser_id) return res.json({ valid: false });

  const nc = code.toUpperCase().trim();
  const hb = hashId(browser_id);
  const data = loadData();
  const cd = data.activation_codes[nc];

  if (!cd || !cd.active) return res.json({ valid: false });

  return res.json({ valid: (cd.browsers || []).includes(hb) });
});

// ==============================
// POST /api/deactivate
// ==============================
app.post('/api/deactivate', (req, res) => {
  const { code, browser_id } = req.body;
  if (!code || !browser_id) return res.status(400).json({ success: false });

  const nc = code.toUpperCase().trim();
  const hb = hashId(browser_id);
  const data = loadData();
  const cd = data.activation_codes[nc];

  if (!cd) return res.status(404).json({ success: false });
  cd.browsers = (cd.browsers || []).filter(b => b !== hb);
  saveData(data);

  return res.json({ success: true });
});

// ==============================
// ADMIN
// ==============================
function checkAdmin(req, res) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    res.status(403).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

app.get('/admin/codes', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const data = loadData();
  const out = {};
  for (const [code, info] of Object.entries(data.activation_codes)) {
    out[code] = { active: info.active, browsers_used: (info.browsers||[]).length, max_browsers: info.max_browsers, created: info.created, last_activated: info.last_activated||null };
  }
  res.json({ total: Object.keys(out).length, codes: out });
});

app.post('/admin/add-code', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { code, max_browsers } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  const data = loadData();
  const nc = code.toUpperCase().trim();
  if (data.activation_codes[nc]) return res.status(409).json({ error: 'Already exists' });
  data.activation_codes[nc] = { active: true, browsers: [], max_browsers: max_browsers || 3, created: new Date().toISOString().split('T')[0] };
  saveData(data);
  res.json({ success: true, code: nc });
});

app.post('/admin/disable-code', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const data = loadData();
  const nc = req.body.code.toUpperCase().trim();
  if (!data.activation_codes[nc]) return res.status(404).json({ error: 'Not found' });
  data.activation_codes[nc].active = false;
  saveData(data);
  res.json({ success: true });
});

app.post('/admin/reset-browsers', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const data = loadData();
  const nc = req.body.code.toUpperCase().trim();
  if (!data.activation_codes[nc]) return res.status(404).json({ error: 'Not found' });
  data.activation_codes[nc].browsers = [];
  saveData(data);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`OXOKE Server v4.0 running on port ${PORT}`));
