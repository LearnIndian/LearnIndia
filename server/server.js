const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'profiles.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}', 'utf8');

app.disable('x-powered-by');
// Work correctly behind common HTTPS hosting/proxies (Render, Railway, etc.).
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }));

// Profile responses must never be cached by a shared browser/proxy.
app.use('/api/profile', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function readProfiles() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}'); }
  catch { return {}; }
}
let writeQueue = Promise.resolve();
function writeProfiles(data) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}
function queueWrite(data) {
  writeQueue = writeQueue.then(() => writeProfiles(data));
  return writeQueue;
}
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function clean(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function validId(id) { return /^LI-[A-Z0-9]{8}$/.test(id); }
function validWebsite(value) {
  if (!value) return '';
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString().slice(0, 500) : '';
  } catch { return ''; }
}
function publicProfile(p) {
  const f = p.publicFields || {};
  const out = { learnIndiaId: p.learnIndiaId, publicFields: {} };
  if (f.name === true && p.name) out.name = p.name;
  if (f.city === true && p.city) out.city = p.city;
  if (f.email === true && p.email) out.email = p.email;
  if (f.phone === true && p.phone) out.phone = p.phone;
  if (f.website === true && p.website) out.website = p.website;
  return out;
}

app.get('/api/health', (req, res) => res.json({ success: true, app: 'LearnIndia', mission: 4 }));

const profileWriteLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many profile saves. Please try again later.' }
});

const profileDeleteLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many delete requests. Please try again later.' }
});

const profileReadLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many profile requests. Please try again later.' }
});

app.post('/api/profile', profileWriteLimit, (req, res) => {
  const body = req.body || {};
  let id = clean(body.learnIndiaId, 20).toUpperCase();
  const profiles = readProfiles();

  if (!validId(id)) {
    id = 'LI-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  const existing = profiles[id];
  if (existing) {
    if (!sameSecret(body.ownerKey, existing.ownerKey)) {
      return res.status(403).json({ success: false, message: 'Profile ownership verification failed.' });
    }
  }

  const ownerKey = existing ? existing.ownerKey : crypto.randomBytes(32).toString('hex');
  const publicFields = {
    name: body.publicFields?.name === true,
    city: body.publicFields?.city === true,
    email: body.publicFields?.email === true,
    phone: body.publicFields?.phone === true,
    website: body.publicFields?.website === true
  };

  const profile = {
    learnIndiaId: id,
    ownerKey,
    name: clean(body.name, 100),
    city: clean(body.city, 100),
    email: clean(body.email, 160),
    phone: clean(body.phone, 40),
    website: validWebsite(clean(body.website, 500)),
    publicFields,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  profiles[id] = profile;
  queueWrite(profiles).then(() => {
    // ownerKey is returned only to the profile owner so it can update/delete later.
    res.json({ success: true, profile: { ...profile } });
  }).catch(() => res.status(500).json({ success: false, message: 'Could not save profile.' }));
});

app.get('/api/profile/:id', profileReadLimit, (req, res) => {
  const id = clean(req.params.id, 20).toUpperCase();
  if (!validId(id)) return res.status(400).json({ success: false, message: 'Invalid LearnIndia Profile ID.' });
  const profiles = readProfiles();
  const profile = profiles[id];
  if (!profile) return res.status(404).json({ success: false, message: 'Profile not found.' });
  res.json({ success: true, profile: publicProfile(profile) });
});

app.delete('/api/profile/:id', profileDeleteLimit, (req, res) => {
  const id = clean(req.params.id, 20).toUpperCase();
  const profiles = readProfiles();
  const profile = profiles[id];
  if (!profile) return res.status(404).json({ success: false, message: 'Profile not found.' });
  if (!sameSecret(req.body?.ownerKey, profile.ownerKey)) return res.status(403).json({ success: false, message: 'Ownership verification failed.' });
  delete profiles[id];
  queueWrite(profiles).then(() => res.json({ success: true })).catch(() => res.status(500).json({ success: false, message: 'Could not delete profile.' }));
});

app.use(express.static(ROOT));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ success: false, message: 'Server error. Please try again.' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`LearnIndia Mission 4 running on port ${PORT}`));
