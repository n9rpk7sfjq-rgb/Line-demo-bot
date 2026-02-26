import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import { middleware, messagingApi } from '@line/bot-sdk';

const {
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  LEADS_API_URL,
  ADMIN_KEY,
} = process.env;

if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_CHANNEL_SECRET) {
  console.error('Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET');
}

const config = {
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
};

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
});

const app = express();

// ---- Health check
app.get('/', (_, res) => res.send('OK'));

// ---- Simple in-memory sessions (demo)
const sessions = new Map();
/*
session = {
  step: 'idle' | 'book_service' | 'book_area' | 'book_budget' | 'book_day' | 'book_time' | 'book_contact' | 'confirm',
  data: { service, area, budget, day, time, name, phone }
}
*/
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { step: 'idle', data: {} });
  }
  return sessions.get(userId);
}

function resetSession(userId) {
  sessions.set(userId, { step: 'idle', data: {} });
}

// ---- Helpers
function normalize(s) {
  return (s || '').trim();
}

function isReset(text) {
  return /^reset$|^start over$|^restart$/i.test(text);
}

function validatePhone(text) {
  const digits = (text || '').replace(/[^\d+]/g, '');
  if (digits.length < 8) return null;
  return digits;
}

function nowBangkok() {
  const now = new Date();
  const bangkok = now.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
  return { iso: now.toISOString(), bangkok };
}

async function sendLeadToSheet(lead) {
  if (!LEADS_API_URL) return;
  try {
    const r = await fetch(LEADS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead),
    });
    const txt = await r.text();
    if (!r.ok) console.error('LEADS_API_URL error:', r.status, txt);
  } catch (e) {
    console.error('Failed sending lead:', e);
  }
}

// ---- Unified command parsing
// Supports BOTH:
// 1) postback data: "action=prices"
// 2) message text: "/prices" or "Prices" etc
function parseCommandFromEvent(event) {
  // Postback
  if (event.type === 'postback') {
    const data = normalize(event.postback?.data);
    const m = data.match(/action=([a-z_]+)/i);
    if (m) return m[1].toLowerCase();
    return null;
  }

  // Text message
  if (event.type === 'message' && event.message?.type === 'text') {
    const t = normalize(event.message.text).toLowerCase();

    // allow slash commands
    if (t === '/book' || t === 'book appointment' || t === 'book an appointment') return 'book';
    if (t === '/faq' || t === 'quick questions') return 'faq';
    if (t === '/prices' || t === 'typical prices' || t === 'prices') return 'prices';
    if (t === '/promotions' || t === 'promotions' || t === 'promo') return 'promotions';
    if (t === '/location' || t === 'location' || t === 'location / branches' || t === 'location / branches') return 'location';
    if (t === '/staff' || t === 'talk to staff' || t === 'staff') return 'staff';
    if (t === 'yes') return 'yes';
    if (t === 'edit') return 'edit';
    if (isReset(t)) return 'reset';

    return null;
  }

  return null;
}

async function replyText(replyToken, text) {
  return client.replyMessage({
    replyToken,
    messages: [{ type: 'text', text }],
  });
}

async function pushText(userId, text) {
  return client.pushMessage({
    to: userId,
    messages: [{ type: 'text', text }],
  });
}

// ---- Copy (English only)
const COPY = {
  welcome:
    `Welcome 👋\n\n` +
    `Use the menu buttons below to:\n` +
    `• Book an appointment\n` +
    `• See prices / promotions / location\n` +
    `• Talk to staff\n\n` +
    `Type RESET anytime to start over.`,

  faqIntro: `Quick questions — tap a menu button:\n• Location / Branches\n• Typical prices\n• Promotions\n• Talk to staff`,

  location:
    `Location / Branches (demo):\n` +
    `We support clinics in Bangkok. Send your clinic address and we’ll tailor this.`,

  prices:
    `Typical prices (demo):\n` +
    `Pricing depends on treatment + area + units.\n` +
    `Tell me the service and area and I’ll estimate a range.`,

  promotions:
    `Promotions (demo):\n` +
    `Promotions vary weekly.\n` +
    `Tell me what you want + your budget and we’ll suggest best deals.`,

  staff: `Please send: Name, Phone (example: N, 0812345678)`,

  bookingStart:
    `Booking — step 1/5\n` +
    `What service do you want?\n` +
    `Examples: Botox / Filler / HIFU / Pico laser / Thread lift`,

  askArea:
    `Booking — step 2/5\n` +
    `Which area?\nExamples: full face / cheeks / jawline / under-eye / lips`,

  askBudget:
    `Booking — step 3/5\n` +
    `Budget range?\nExamples: under 10k / 10k–20k / 20k–40k`,

  askDay:
    `Booking — step 4/5\n` +
    `Which day/date?\nExamples: Friday / Mar 7`,

  askTime:
    `Booking — step 5/5\n` +
    `Preferred time?\nExamples: 3pm / 15:30 / morning (10–12)`,

  askContact:
    `Almost done.\nSend: Name, Phone (example: N, 0812345678)`,

  invalidPhone: `Phone looks invalid. Please resend like: N, 0812345678`,

  confirmPrefix: `Please confirm:\n(Type YES to confirm or EDIT to restart)\n\n`,

  booked:
    `Booked (demo) ✅\n` +
    `A staff member will contact you shortly.`,

  needMenu:
    `Please use the menu buttons below.\n` +
    `If you prefer typing, use: /book /prices /promotions /location /staff`,

  reset: `Reset ✅ Use the menu to start again.`,
};

// ---- Webhook
app.post('/webhook', middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  const userId = event.source?.userId;

  // 1) Welcome once (follow)
  if (event.type === 'follow') {
    if (userId) resetSession(userId);
    if (event.replyToken) return replyText(event.replyToken, COPY.welcome);
    return;
  }

  // Ignore if no user
  if (!userId) return;

  const session = getSession(userId);

  // 2) Commands from rich menu postback OR typed text
  const cmd = parseCommandFromEvent(event);

  // 3) RESET command
  if (cmd === 'reset') {
    resetSession(userId);
    if (event.replyToken) return replyText(event.replyToken, COPY.reset);
    return;
  }

  // 4) Global rich-menu actions (work anytime)
  if (cmd === 'book') {
    session.step = 'book_service';
    session.data = {};
    return replyText(event.replyToken, COPY.bookingStart);
  }

  if (cmd === 'faq') {
    session.step = 'idle';
    return replyText(event.replyToken, COPY.faqIntro);
  }

  if (cmd === 'prices') {
    session.step = 'idle';
    return replyText(event.replyToken, COPY.prices);
  }

  if (cmd === 'promotions') {
    session.step = 'idle';
    return replyText(event.replyToken, COPY.promotions);
  }

  if (cmd === 'location') {
    session.step = 'idle';
    return replyText(event.replyToken, COPY.location);
  }

  if (cmd === 'staff') {
    session.step = 'book_contact';
    // if they came from staff tile, we treat as "talk to staff" lead
    session.data = session.data || {};
    session.data.service = session.data.service || 'Talk to staff';
    session.data.area = session.data.area || '-';
    session.data.budget = session.data.budget || '-';
    session.data.day = session.data.day || '-';
    session.data.time = session.data.time || '-';
    return replyText(event.replyToken, COPY.staff);
  }

  // 5) Booking flow is plain text (no quick replies)
  if (event.type === 'message' && event.message?.type === 'text') {
    const text = normalize(event.message.text);

    // If user is idle and types random stuff, tell them to use menu
    if (session.step === 'idle') {
      // allow them to type "/book" style even if parseCommand missed (it shouldn’t)
      return replyText(event.replyToken, COPY.needMenu);
    }

    if (session.step === 'book_service') {
      session.data.service = text;
      session.step = 'book_area';
      return replyText(event.replyToken, COPY.askArea);
    }

    if (session.step === 'book_area') {
      session.data.area = text;
      session.step = 'book_budget';
      return replyText(event.replyToken, COPY.askBudget);
    }

    if (session.step === 'book_budget') {
      session.data.budget = text;
      session.step = 'book_day';
      return replyText(event.replyToken, COPY.askDay);
    }

    if (session.step === 'book_day') {
      session.data.day = text;
      session.step = 'book_time';
      return replyText(event.replyToken, COPY.askTime);
    }

    if (session.step === 'book_time') {
      session.data.time = text;
      session.step = 'book_contact';
      return replyText(event.replyToken, COPY.askContact);
    }

    if (session.step === 'book_contact') {
      const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) return replyText(event.replyToken, COPY.askContact);

      const name = parts[0];
      const phone = validatePhone(parts.slice(1).join(' '));
      if (!phone) return replyText(event.replyToken, COPY.invalidPhone);

      session.data.name = name;
      session.data.phone = phone;
      session.step = 'confirm';

      const summary =
        COPY.confirmPrefix +
        `• Service: ${session.data.service || '-'}\n` +
        `• Area: ${session.data.area || '-'}\n` +
        `• Budget: ${session.data.budget || '-'}\n` +
        `• Day: ${session.data.day || '-'}\n` +
        `• Time: ${session.data.time || '-'}\n` +
        `• Name: ${session.data.name || '-'}\n` +
        `• Phone: ${session.data.phone || '-'}\n`;

      return replyText(event.replyToken, summary);
    }

    if (session.step === 'confirm') {
      const low = text.toLowerCase();

      if (low === 'edit') {
        resetSession(userId);
        return replyText(event.replyToken, COPY.reset);
      }

      if (low === 'yes') {
        const ts = nowBangkok();
        const lead = {
          ts_iso: ts.iso,
          ts_bkk: ts.bangkok,
          userId,
          service: session.data.service || '-',
          area: session.data.area || '-',
          budget: session.data.budget || '-',
          day: session.data.day || '-',
          time: session.data.time || '-',
          name: session.data.name || '-',
          phone: session.data.phone || '-',
          source: 'line',
        };

        await sendLeadToSheet(lead);
        resetSession(userId);
        return replyText(event.replyToken, COPY.booked);
      }

      return replyText(event.replyToken, `Type YES to confirm or EDIT to restart.\nType RESET to start over.`);
    }

    // fallback
    return replyText(event.replyToken, COPY.needMenu);
  }

  // If it’s not a text message / postback we handle, ignore.
}

// ------------------------------------------------------------------
// ADMIN endpoint: create + upload + set default rich menu (6 tiles)
// ------------------------------------------------------------------
app.get('/create-rich-menu', async (req, res) => {
  try {
    const key = req.query.key;
    if (!ADMIN_KEY || key !== ADMIN_KEY) {
      return res.status(401).send('Unauthorized (missing/invalid key)');
    }

    // 2500x1686 with 3 columns / 2 rows
    // widths: 833, 833, 834 (to total 2500)
    const COL1 = 833;
    const COL2 = 833;
    const COL3 = 834;
    const ROW = 843;

    const richMenu = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'Clinic Menu',
      chatBarText: 'Menu',
      areas: [
        // Row 1
        { bounds: { x: 0, y: 0, width: COL1, height: ROW }, action: { type: 'postback', data: 'action=book' } },
        { bounds: { x: COL1, y: 0, width: COL2, height: ROW }, action: { type: 'postback', data: 'action=faq' } },
        { bounds: { x: COL1 + COL2, y: 0, width: COL3, height: ROW }, action: { type: 'postback', data: 'action=prices' } },

        // Row 2
        { bounds: { x: 0, y: ROW, width: COL1, height: ROW }, action: { type: 'postback', data: 'action=promotions' } },
        { bounds: { x: COL1, y: ROW, width: COL2, height: ROW }, action: { type: 'postback', data: 'action=location' } },
        { bounds: { x: COL1 + COL2, y: ROW, width: COL3, height: ROW }, action: { type: 'postback', data: 'action=staff' } },
      ],
    };

    // 1) Create rich menu
    const createResp = await fetch('https://api.line.me/v2/bot/richmenu', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(richMenu),
    });

    const createJson = await createResp.json();
    if (!createResp.ok) {
      console.error('Create rich menu failed:', createResp.status, createJson);
      return res.status(500).send(`Create rich menu failed: ${createResp.status} ${JSON.stringify(createJson)}`);
    }

    const richMenuId = createJson.richMenuId;

    // 2) Upload image (must exist in repo root)
    const imagePath = './richmenu.png';
    if (!fs.existsSync(imagePath)) {
      return res.status(500).send('richmenu.png not found in repo root');
    }

    const img = fs.readFileSync(imagePath);

    const uploadResp = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'image/png',
      },
      body: img,
    });

    if (!uploadResp.ok) {
      const t = await uploadResp.text();
      console.error('Upload image failed:', uploadResp.status, t);
      return res.status(500).send(`Upload image failed: ${uploadResp.status} ${t}`);
    }

    // 3) Set as default
    const defaultResp = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });

    if (!defaultResp.ok) {
      const t = await defaultResp.text();
      console.error('Set default failed:', defaultResp.status, t);
      return res.status(500).send(`Set default failed: ${defaultResp.status} ${t}`);
    }

    res.send(`✅ Rich menu created + default set. ID: ${richMenuId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ Error creating rich menu: ' + err.message);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LINE bot running on port ${port}`));
