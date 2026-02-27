const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const TRIAL_FILE = path.join(__dirname, 'trials.json');
const ADMIN_KEY = process.env.ADMIN_KEY || 'oxoke_admin_2025';

app.use(cors());
app.use(express.json());

// ==============================
// DATA HELPERS
// ==============================
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const seed = path.join(__dirname, 'codes_seed.json');
    if (fs.existsSync(seed)) fs.copyFileSync(seed, DATA_FILE);
    else fs.writeFileSync(DATA_FILE, JSON.stringify({ activation_codes: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}
function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

function loadTrials() {
  if (!fs.existsSync(TRIAL_FILE)) fs.writeFileSync(TRIAL_FILE, JSON.stringify({ used_pcs: {} }, null, 2));
  return JSON.parse(fs.readFileSync(TRIAL_FILE, 'utf-8'));
}
function saveTrials(data) { fs.writeFileSync(TRIAL_FILE, JSON.stringify(data, null, 2)); }

function hashId(id) {
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16);
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function generateTrialKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = (n) => Array.from({length:n}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `TRIAL-${seg(5)}-${seg(5)}`;
}

// ==============================
// HEALTH CHECK
// ==============================
app.get('/', (req, res) => {
  res.json({ status: 'OXOKE Activation Server Running', version: '4.0.0' });
});

// ==============================
// POST /api/get-trial
// প্রতিটা PC তে একবার ১ দিনের free trial
// ==============================
app.post('/api/get-trial', (req, res) => {
  const { pc_fingerprint } = req.body;
  if (!pc_fingerprint) return res.status(400).json({ success: false, message: 'Missing pc_fingerprint' });

  const hashedPc = hashId(pc_fingerprint);
  const trials = loadTrials();

  // এই PC আগে trial নিয়েছে?
  if (trials.used_pcs[hashedPc]) {
    const prevTrial = trials.used_pcs[hashedPc];
    // Trial এখনও active আছে?
    if (new Date(prevTrial.expiry).getTime() > Date.now()) {
      // Return existing trial (reinstall case)
      return res.json({
        success: true,
        key: prevTrial.key,
        expiry: prevTrial.expiry,
        message: 'Trial reactivated.'
      });
    } else {
      // Trial শেষ হয়ে গেছে
      return res.status(403).json({
        success: false,
        message: 'Free trial already used on this PC. Purchase a license: +8801811507607'
      });
    }
  }

  // নতুন trial তৈরি করি
  const trialKey = generateTrialKey();
  const expiry = addDays(1); // ১ দিন

  trials.used_pcs[hashedPc] = {
    key: trialKey,
    expiry: expiry,
    created: new Date().toISOString()
  };
  saveTrials(trials);

  return res.json({
    success: true,
    key: trialKey,
    expiry: expiry,
    type: 'trial',
    message: 'Trial activated! Enjoy 24 hours of ad-free browsing.'
  });
});

// ==============================
// POST /api/activate
// Monthly key — PC-locked
// ==============================
app.post('/api/activate', (req, res) => {
  const { code, pc_fingerprint } = req.body;
  if (!code || !pc_fingerprint) return res.status(400).json({ success: false, message: 'Missing fields' });

  const nc = code.toUpperCase().trim();
  const hashedPc = hashId(pc_fingerprint);
  const data = loadData();
  const cd = data.activation_codes[nc];

  if (!cd) return res.status(404).json({ success: false, message: 'Invalid key. Contact: +8801811507607' });
  if (!cd.active) return res.status(403).json({ success: false, message: 'This key is disabled. Contact: +8801811507607' });

  // মেয়াদ শেষ হয়েছে?
  if (cd.expiry && new Date(cd.expiry).getTime() < Date.now()) {
    return res.status(403).json({ success: false, message: 'This key has expired. Purchase a new one: +8801811507607' });
  }

  if (!cd.locked_pc) {
    // প্রথমবার activate — এই PC এ lock করি
    cd.locked_pc = hashedPc;
    cd.activated_at = new Date().toISOString();
    // Expiry set — আজ থেকে ৩০ দিন
    if (!cd.expiry) {
      cd.expiry = addDays(30);
    }
    saveData(data);
    return res.json({
      success: true,
      type: 'monthly',
      expiry: cd.expiry,
      message: 'Activation successful! Valid for 30 days.'
    });
  }

  // এই PC এ আগে activate হয়েছিল?
  if (cd.locked_pc === hashedPc) {
    return res.json({
      success: true,
      type: 'monthly',
      expiry: cd.expiry,
      message: 'License verified for this PC.'
    });
  }

  // ভিন্ন PC — block
  return res.status(403).json({
    success: false,
    message: 'This key is already activated on another PC. Contact: +8801811507607'
  });
});

// ==============================
// POST /api/verify
// ==============================
app.post('/api/verify', (req, res) => {
  const { code, pc_fingerprint } = req.body;
  if (!code || !pc_fingerprint) return res.json({ valid: false });

  const nc = code.toUpperCase().trim();

  // Trial key check
  if (nc.startsWith('TRIAL-')) {
    const hashedPc = hashId(pc_fingerprint);
    const trials = loadTrials();
    const entry = trials.used_pcs[hashedPc];
    if (!entry || entry.key !== nc) return res.json({ valid: false });
    const valid = new Date(entry.expiry).getTime() > Date.now();
    return res.json({ valid, expiry: entry.expiry, type: 'trial' });
  }

  // Monthly key check
  const hashedPc = hashId(pc_fingerprint);
  const data = loadData();
  const cd = data.activation_codes[nc];
  if (!cd || !cd.active) return res.json({ valid: false });
  if (cd.locked_pc !== hashedPc) return res.json({ valid: false });
  const valid = !cd.expiry || new Date(cd.expiry).getTime() > Date.now();
  return res.json({ valid, expiry: cd.expiry, type: 'monthly' });
});

// ==============================
// ADMIN ROUTES
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
    const expired = info.expiry && new Date(info.expiry).getTime() < Date.now();
    out[code] = {
      active: info.active,
      locked_pc: info.locked_pc ? '✓ Locked' : '○ Free',
      expiry: info.expiry || 'Not activated',
      expired: !!expired,
      created: info.created,
      activated_at: info.activated_at || null
    };
  }
  res.json({ total: Object.keys(out).length, codes: out });
});

app.get('/admin/trials', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const trials = loadTrials();
  const count = Object.keys(trials.used_pcs).length;
  const active = Object.values(trials.used_pcs).filter(t => new Date(t.expiry).getTime() > Date.now()).length;
  res.json({ total_trials: count, active_trials: active, data: trials.used_pcs });
});

app.post('/admin/add-code', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { code, custom_expiry_days } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  const data = loadData();
  const nc = code.toUpperCase().trim();
  if (data.activation_codes[nc]) return res.status(409).json({ error: 'Already exists' });
  data.activation_codes[nc] = {
    active: true,
    locked_pc: null,
    expiry: null, // expiry set হবে first activation এ
    custom_expiry_days: custom_expiry_days || 30,
    created: new Date().toISOString().split('T')[0]
  };
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

app.post('/admin/reset-code', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const data = loadData();
  const nc = req.body.code.toUpperCase().trim();
  if (!data.activation_codes[nc]) return res.status(404).json({ error: 'Not found' });
  // PC lock ও expiry reset করি — নতুন PC তে activate করা যাবে
  data.activation_codes[nc].locked_pc = null;
  data.activation_codes[nc].expiry = null;
  data.activation_codes[nc].activated_at = null;
  saveData(data);
  res.json({ success: true, message: `Code ${nc} reset. Can be activated on a new PC.` });
});

app.listen(PORT, () => {
  console.log(`\n🚀 OXOKE Server v4.0 running on port ${PORT}`);
  console.log(`✅ Trial system: ENABLED`);
  console.log(`✅ Monthly keys: ENABLED`);
  console.log(`✅ PC-locked activation: ENABLED`);
});
