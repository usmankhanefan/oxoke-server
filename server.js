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

function hashId(id) {
  return crypto.createHash('sha256').update(id).digest('hex').substring(0, 16);
}

// ==============================
// HEALTH CHECK
// ==============================
app.get('/', (req, res) => {
  res.json({ status: 'OXOKE Activation Server Running', version: '2.0.0' });
});

// ==============================
// POST /api/activate
// ==============================
app.post('/api/activate', (req, res) => {
  const { code, browser_id, hardware_id } = req.body;

  if (!code || !browser_id) {
    return res.status(400).json({ success: false, message: 'Missing code or browser_id' });
  }

  const normalizedCode = code.toUpperCase().trim();
  const hashedBrowser = hashId(browser_id);
  // hardware_id হলো শুধু hardware fingerprint — reinstall এ একই থাকে
  const hashedHardware = hardware_id ? hashId(hardware_id) : hashedBrowser;

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
      message: 'This activation code has been disabled. Contact: +8801811507607'
    });
  }

  // browsers array আগে ছিল string, এখন object — migrate করি
  if (!codeData.browsers) codeData.browsers = [];
  codeData.browsers = codeData.browsers.map(b => {
    if (typeof b === 'string') return { bid: b, hwid: b };
    return b;
  });

  // ১. এই exact browser_id আগে registered ছিল?
  const exactMatch = codeData.browsers.find(b => b.bid === hashedBrowser);
  if (exactMatch) {
    return res.json({
      success: true,
      message: 'Already activated on this browser.',
      browsers_used: codeData.browsers.length,
      max_browsers: codeData.max_browsers
    });
  }

  // ২. Same hardware_id আগে registered ছিল? (reinstall detect)
  const hardwareMatch = codeData.browsers.find(b => b.hwid === hashedHardware);
  if (hardwareMatch) {
    // Reinstall detected! পুরনো browser_id টা নতুনটা দিয়ে replace করি
    hardwareMatch.bid = hashedBrowser;
    hardwareMatch.hwid = hashedHardware;
    hardwareMatch.reinstalled_at = new Date().toISOString();
    codeData.last_activated = new Date().toISOString();
    saveData(data);
    return res.json({
      success: true,
      message: 'Reinstall detected. Reactivated successfully!',
      browsers_used: codeData.browsers.length,
      max_browsers: codeData.max_browsers
    });
  }

  // ৩. সম্পূর্ণ নতুন browser — limit চেক করি
  if (codeData.browsers.length >= codeData.max_browsers) {
    return res.status(403).json({
      success: false,
      message: `Maximum browser limit reached (${codeData.max_browsers} browsers). Purchase a new code: +8801811507607`
    });
  }

  // ৪. নতুন browser add করি
  codeData.browsers.push({
    bid: hashedBrowser,
    hwid: hashedHardware,
    activated_at: new Date().toISOString()
  });
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
  const { code, browser_id, hardware_id } = req.body;
  if (!code || !browser_id) return res.json({ valid: false });

  const normalizedCode = code.toUpperCase().trim();
  const hashedBrowser = hashId(browser_id);
  const hashedHardware = hardware_id ? hashId(hardware_id) : hashedBrowser;
  const data = loadData();
  const codeData = data.activation_codes[normalizedCode];

  if (!codeData || !codeData.active) return res.json({ valid: false });

  if (!codeData.browsers) return res.json({ valid: false });

  // Migrate old string format
  codeData.browsers = codeData.browsers.map(b => {
    if (typeof b === 'string') return { bid: b, hwid: b };
    return b;
  });

  const exactMatch = codeData.browsers.find(b => b.bid === hashedBrowser);
  const hwMatch = codeData.browsers.find(b => b.hwid === hashedHardware);

  return res.json({
    valid: !!(exactMatch || hwMatch),
    browsers_used: codeData.browsers.length,
    max_browsers: codeData.max_browsers
  });
});

// ==============================
// POST /api/deactivate
// ==============================
app.post('/api/deactivate', (req, res) => {
  const { code, browser_id, hardware_id } = req.body;
  if (!code || !browser_id) return res.status(400).json({ success: false });

  const normalizedCode = code.toUpperCase().trim();
  const hashedBrowser = hashId(browser_id);
  const hashedHardware = hardware_id ? hashId(hardware_id) : hashedBrowser;
  const data = loadData();
  const codeData = data.activation_codes[normalizedCode];

  if (!codeData) return res.status(404).json({ success: false });

  codeData.browsers = (codeData.browsers || []).map(b => {
    if (typeof b === 'string') return { bid: b, hwid: b };
    return b;
  }).filter(b => b.bid !== hashedBrowser && b.hwid !== hashedHardware);

  saveData(data);
  return res.json({ success: true, message: 'Browser deactivated.' });
});

// ==============================
// ADMIN ROUTES
// ==============================
app.get('/admin/codes', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const data = loadData();
  const summary = {};
  for (const [code, info] of Object.entries(data.activation_codes)) {
    const browsers = (info.browsers || []).map(b => typeof b === 'string' ? { bid: b, hwid: b } : b);
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
  const normalizedCode = code.toUpperCase().trim();
  if (data.activation_codes[normalizedCode]) return res.status(409).json({ error: 'Code already exists' });
  data.activation_codes[normalizedCode] = {
    active: true, browsers: [], max_browsers: max_browsers || 3,
    created: new Date().toISOString().split('T')[0]
  };
  saveData(data);
  res.json({ success: true, code: normalizedCode });
});

app.post('/admin/disable-code', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const { code } = req.body;
  const data = loadData();
  const normalizedCode = code.toUpperCase().trim();
  if (!data.activation_codes[normalizedCode]) return res.status(404).json({ error: 'Not found' });
  data.activation_codes[normalizedCode].active = false;
  saveData(data);
  res.json({ success: true });
});

app.post('/admin/reset-browsers', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const { code } = req.body;
  const data = loadData();
  const normalizedCode = code.toUpperCase().trim();
  if (!data.activation_codes[normalizedCode]) return res.status(404).json({ error: 'Not found' });
  data.activation_codes[normalizedCode].browsers = [];
  saveData(data);
  res.json({ success: true, message: `Browsers reset for ${normalizedCode}` });
});

app.listen(PORT, () => {
  console.log(`\n🚀 OXOKE Activation Server v2.0 running on port ${PORT}`);
  console.log(`✅ Reinstall detection: ENABLED`);
});
