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
    const seedFile = path.join(__dirname, 'codes_seed.json');
    if (fs.existsSync(seedFile)) fs.copyFileSync(seedFile, DATA_FILE);
    else fs.writeFileSync(DATA_FILE, JSON.stringify({ activation_codes: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function hashId(id) {
  return crypto.createHash('sha256').update(String(id)).digest('hex').substring(0, 16);
}

app.get('/', (req, res) => {
  res.json({ status: 'OXOKE Activation Server Running', version: '3.0.0' });
});

// ==============================
// POST /api/activate
// ==============================
app.post('/api/activate', (req, res) => {
  const { code, browser_id } = req.body;

  if (!code || !browser_id) {
    return res.status(400).json({ success: false, message: 'Missing code or browser_id' });
  }

  const normalizedCode = code.toUpperCase().trim();
  const hashedBrowser = hashId(browser_id);
  const data = loadData();
  const codeData = data.activation_codes[normalizedCode];

  if (!codeData) {
    return res.status(404).json({
      success: false,
      message: 'Invalid activation code. Contact: +8801811507607'
    });
  }
  if (!codeData.active) {
    return res.status(403).json({
      success: false,
      message: 'This code has been disabled. Contact: +8801811507607'
    });
  }

  if (!codeData.browsers) codeData.browsers = [];

  // Migrate old object format to simple string array
  codeData.browsers = codeData.browsers.map(b => {
    if (typeof b === 'object' && b.bid) return b.bid;
    return b;
  });

  // এই browser আগে registered?
  if (codeData.browsers.includes(hashedBrowser)) {
    return res.json({
      success: true,
      message: 'Already activated on this browser.',
      browsers_used: codeData.browsers.length,
      max_browsers: codeData.max_browsers
    });
  }

  // নতুন browser — limit চেক
  if (codeData.browsers.length >= codeData.max_browsers) {
    return res.status(403).json({
      success: false,
      message: `Maximum browser limit reached (${codeData.max_browsers} browsers). Contact: +8801811507607`
    });
  }

  // Add করি
  codeData.browsers.push(hashedBrowser);
  codeData.last_activated = new Date().toISOString();
  saveData(data);

  return res.json({
    success: true,
    message: 'Activation successful! Welcome to OXOKE Ads Blocker.',
    browsers_used: codeData.browsers.length,
    max_browsers: codeData.max_browsers
  });
});

// ==============================
// POST /api/verify
// ==============================
app.post('/api/verify', (req, res) => {
  const { code, browser_id } = req.body;
  if (!code || !browser_id) return res.json({ valid: false });

  const normalizedCode = code.toUpperCase().trim();
  const hashedBrowser = hashId(browser_id);
  const data = loadData();
  const codeData = data.activation_codes[normalizedCode];
  if (!codeData || !codeData.active) return res.json({ valid: false });

  const browsers = (codeData.browsers || []).map(b =>
    typeof b === 'object' && b.bid ? b.bid : b
  );

  return res.json({
    valid: browsers.includes(hashedBrowser),
    browsers_used: browsers.length,
    max_browsers: codeData.max_browsers
  });
});

// ==============================
// POST /api/deactivate
// ==============================
app.post('/api/deactivate', (req, res) => {
  const { code, browser_id } = req.body;
  if (!code || !browser_id) return res.status(400).json({ success: false });

  const normalizedCode = code.toUpperCase().trim();
  const hashedBrowser = hashId(browser_id);
  const data = loadData();
  const codeData = data.activation_codes[normalizedCode];
  if (!codeData) return res.status(404).json({ success: false });

  codeData.browsers = (codeData.browsers || [])
    .map(b => typeof b === 'object' && b.bid ? b.bid : b)
    .filter(b => b !== hashedBrowser);
  saveData(data);

  return res.json({ success: true });
});

// ==============================
// ADMIN ROUTES
// ==============================
app.get('/admin/codes', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const data = loadData();
  const summary = {};
  for (const [code, info] of Object.entries(data.activation_codes)) {
    const browsers = (info.browsers || []).map(b => typeof b === 'object' && b.bid ? b.bid : b);
    summary[code] = {
      active: info.active,
      browsers_used: browsers.length,
      max_browsers: info.max_browsers,
      created: info.created,
      last_activated: info.last_activated || null
    };
  }
  res.json({ total: Object.keys(summary).length, codes: summary });
});

app.post('/admin/add-code', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const { code, max_browsers } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  const data = loadData();
  const nc = code.toUpperCase().trim();
  if (data.activation_codes[nc]) return res.status(409).json({ error: 'Already exists' });
  data.activation_codes[nc] = {
    active: true, browsers: [], max_browsers: max_browsers || 3,
    created: new Date().toISOString().split('T')[0]
  };
  saveData(data);
  res.json({ success: true, code: nc });
});

app.post('/admin/disable-code', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const data = loadData();
  const nc = req.body.code.toUpperCase().trim();
  if (!data.activation_codes[nc]) return res.status(404).json({ error: 'Not found' });
  data.activation_codes[nc].active = false;
  saveData(data);
  res.json({ success: true });
});

app.post('/admin/reset-browsers', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const data = loadData();
  const nc = req.body.code.toUpperCase().trim();
  if (!data.activation_codes[nc]) return res.status(404).json({ error: 'Not found' });
  data.activation_codes[nc].browsers = [];
  saveData(data);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n🚀 OXOKE Activation Server v3.0 running on port ${PORT}`);
});
