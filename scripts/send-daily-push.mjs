// Sends the Daily Dose notification to FCM topics daily_en / daily_hi.
// Usage: node scripts/send-daily-push.mjs 2026-11-25
// Env:   FIREBASE_SERVICE_ACCOUNT = the service-account JSON (GitHub secret)
// No npm packages needed (uses Node's built-in crypto + fetch).
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
  console.error('Pass the date as YYYY-MM-DD');
  process.exit(1);
}

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT secret');
  process.exit(1);
}
const sa = JSON.parse(raw);

const b64url = (input) => Buffer.from(input).toString('base64url');

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(sa.private_key).toString('base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const COPY = {
  en: {
    title: "Today's Daily Dose is live 🔥",
    body: (n, topics) => `${n} fresh NEET questions${topics ? ` · ${topics}` : ''}. Keep your streak going!`,
  },
  hi: {
    title: 'आज का डेली डोज़ आ गया 🔥',
    body: (n, topics) => `${n} नए NEET प्रश्न${topics ? ` · ${topics}` : ''}। अपनी स्ट्रीक जारी रखें!`,
  },
};

function summary(lang) {
  const file = `daily/${lang}/${date}.json`;
  if (!existsSync(file)) return null;
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    const questions = Array.isArray(json.questions) ? json.questions : [];
    const subjects = [...new Set(questions.map((q) => q.subject).filter(Boolean))].slice(0, 4);
    return { count: questions.length || 10, topics: subjects.join(', ') };
  } catch {
    return { count: 10, topics: '' };
  }
}

const token = await getAccessToken();
let sent = 0;

for (const lang of ['en', 'hi']) {
  const info = summary(lang);
  if (!info) {
    console.log(`No ${lang} file for ${date}, skipping daily_${lang}`);
    continue;
  }
  const copy = COPY[lang];
  const message = {
    topic: `daily_${lang}`,
    notification: { title: copy.title, body: copy.body(info.count, info.topics) },
    data: { type: 'daily_dose', date },
    android: {
      priority: 'HIGH',
      notification: { channel_id: 'neet-updates', tag: `daily-${date}` },
    },
    apns: {
      headers: { 'apns-priority': '10', 'apns-collapse-id': `daily-${date}` },
      payload: { aps: { sound: 'default' } },
    },
  };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`daily_${lang}: FAILED ${res.status} ${text}`);
    process.exitCode = 1;
  } else {
    sent += 1;
    console.log(`daily_${lang}: sent ${text}`);
  }
}

if (sent === 0 && process.exitCode !== 1) {
  console.log('Nothing sent.');
}

