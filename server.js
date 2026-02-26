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

// ==============================
// DATA HELPERS
// ==============================
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    // First run: copy seed file
    const seedFile = path.join(__dirname, 'codes_seed.json');
    if (fs.existsSync(seedFile)) {
      fs.copyFileSync(seedFile, DATA_FILE);
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ activation_codes: {} }, null, 2));
    }
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Browser ID hashing for privacy
function hashBrowserId(id) {
  return crypto.createHash('sha256').update(id).digest('hex').substring(0, 16);
}

// ==============================
// ROUTES
// ==============================

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'OXOKE Activation Server Running', version: '1.0.0' });
});

// POST /api/activate — Activate a code for a browser
app.post('/api/activate', (req, res) => {
  const { code, browser_id } = req.body;

  if (!code || !browser_id) {
    return res.status(400).json({ success: false, message: 'Missing code or browser_id' });
  }

  const normalizedCode = code.toUpperCase().trim();
  const hashedBrowser = hashBrowserId(browser_id);
  const data = loadData();
  const codeData = data.activation_codes[normalizedCode];

  if (!codeData) {
    return res.status(404).json({
      success: false,
      message: 'Invalid activation code. Please contact us on WhatsApp: +8801811507607'
    });
  }

  if (!codeData.active) {
    return res.status(403).json({
      success: false,
      message: 'This activation code has been disabled. Contact: +8801811507607'
    });
  }

  // Already registered on this browser?
  if (codeData.browsers.includes(hashedBrowser)) {
    return res.json({
      success: true,
      message: 'Already activated on this browser.',
      browsers_used: codeData.browsers.length,
      max_browsers: codeData.max_browsers
    });
  }

  // Check max browser limit
  if (codeData.browsers.length >= codeData.max_browsers) {
    return res.status(403).json({
      success: false,
      message: `Maximum browser limit reached (${codeData.max_browsers} browsers). Purchase a new code: +8801811507607`
    });
  }

  // Register browser
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

// POST /api/verify — Verify existing activation is still valid
app.post('/api/verify', (req, res) => {
  const { code, browser_id } = req.body;

  if (!code || !browser_id) {
    return res.status(400).json({ valid: false });
  }

  const normalizedCode = code.toUpperCase().trim();
  const hashedBrowser = hashBrowserId(browser_id);
  const data = loadData();
  const codeData = data.activation_codes[normalizedCode];

  if (!codeData || !codeData.active) {
    return res.json({ valid: false, message: 'Code is no longer valid.' });
  }

  const registered = codeData.browsers.includes(hashedBrowser);
  return res.json({
    valid: registered,
    browsers_used: codeData.browsers.length,
    max_browsers: codeData.max_browsers
  });
});

// POST /api/deactivate — Remove a browser from a code
app.post('/api/deactivate', (req, res) => {
  const { code, browser_id } = req.body;
  if (!code || !browser_id) return res.status(400).json({ success: false });

  const normalizedCode = code.toUpperCase().trim();
  const hashedBrowser = hashBrowserId(browser_id);
  const data = loadData();
  const codeData = data.activation_codes[normalizedCode];

  if (!codeData) return res.status(404).json({ success: false });

  codeData.browsers = codeData.browsers.filter(b => b !== hashedBrowser);
  saveData(data);

  return res.json({ success: true, message: 'Browser deactivated.' });
});

// ==============================
// ADMIN ROUTES (Protected)
// ==============================

// GET /admin/codes — List all codes
app.get('/admin/codes', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const data = loadData();
  const summary = {};
  for (const [code, info] of Object.entries(data.activation_codes)) {
    summary[code] = {
      active: info.active,
      browsers_used: info.browsers.length,
      max_browsers: info.max_browsers,
      created: info.created,
      last_activated: info.last_activated || null
    };
  }
  res.json({ total: Object.keys(summary).length, codes: summary });
});

// POST /admin/add-code — Add a new code
app.post('/admin/add-code', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { code, max_browsers } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });

  const data = loadData();
  const normalizedCode = code.toUpperCase().trim();

  if (data.activation_codes[normalizedCode]) {
    return res.status(409).json({ error: 'Code already exists' });
  }

  data.activation_codes[normalizedCode] = {
    active: true,
    browsers: [],
    max_browsers: max_browsers || 3,
    created: new Date().toISOString().split('T')[0]
  };
  saveData(data);
  res.json({ success: true, code: normalizedCode });
});

// POST /admin/disable-code — Disable a code
app.post('/admin/disable-code', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { code } = req.body;
  const data = loadData();
  const normalizedCode = code.toUpperCase().trim();

  if (!data.activation_codes[normalizedCode]) {
    return res.status(404).json({ error: 'Code not found' });
  }

  data.activation_codes[normalizedCode].active = false;
  saveData(data);
  res.json({ success: true, message: `Code ${normalizedCode} disabled.` });
});

// POST /admin/reset-browsers — Reset browser list for a code
app.post('/admin/reset-browsers', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { code } = req.body;
  const data = loadData();
  const normalizedCode = code.toUpperCase().trim();

  if (!data.activation_codes[normalizedCode]) {
    return res.status(404).json({ error: 'Code not found' });
  }

  data.activation_codes[normalizedCode].browsers = [];
  saveData(data);
  res.json({ success: true, message: `Browsers reset for ${normalizedCode}` });
});

app.listen(PORT, () => {
  console.log(`\n🚀 OXOKE Activation Server running on port ${PORT}`);
  console.log(`📊 Admin Key: ${ADMIN_KEY}`);
  console.log(`🌐 Endpoints: /api/activate | /api/verify | /api/deactivate`);
});
