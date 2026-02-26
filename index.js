// index.js (FULL FILE) — Perfect approach:
// ✅ Rich menu tiles use POSTBACK (silent, no chat echo)
// ✅ Bot handles postback events everywhere (global routing)
// ✅ No Thai (English only, simpler)
// ✅ Start trigger: follow/join + any first message
// ✅ Sheet logging stays consistent (flat strings)
// ✅ Safe rich menu creation endpoint (ADMIN_KEY required)

import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import { middleware, messagingApi } from '@line/bot-sdk';

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const app = express();

// Health check
app.get('/', (_, res) => res.send('OK'));

// --------------------
// Session store (in-memory)
// --------------------
const sessions = new Map();

const STEPS = {
  MENU: 'menu',

  INTENT: 'intent',
  INTENT_OTHER: 'intent_other',

  AREA: 'area',
  AREA_OTHER: 'area_other',

  BUDGET: 'budget',
  BUDGET_OTHER: 'budget_other',

  DAY: 'day',
  DAY_OTHER: 'day_other',

  TIME_OF_DAY: 'time_of_day',
  TIME_EXACT: 'time_exact',

  CONTACT: 'contact',
  CONFIRM: 'confirm',
  DONE: 'done',

  FAQ: 'faq',
};

const T = {
  menuTitle: 'What would you like to do?',
  menuBook: 'Book an appointment',
  menuFaq: 'Quick questions',

  welcome: 'Welcome! What service are you interested in?',
  askOtherService: 'Please type the service you want (e.g., HIFU / Pico laser / Thread lift).',

  askArea: 'Which area?',
  askOtherArea: 'Please type the area you want (e.g., cheeks, nose, under-eye, full face).',

  askBudget: 'What is your budget range?',
  askOtherBudget: 'Please type your budget (e.g., 12,000 THB or “under 20k”).',

  askDay: 'Which day would you like to come?',
  askOtherDay: 'Please type your preferred day/date (e.g., “Friday” or “Mar 7”).',

  askTimeOfDay: 'Which time of day?',
  askExactTime: 'Please type your preferred time (e.g., 3:30pm).',

  askContact: 'Please send: Name, Phone (example: N, 0812345678)',
  confirmTitle: 'Please confirm your booking:',
  yes: 'YES',
  edit: 'EDIT',
  booked: 'Booked (demo) ✅ We’ll contact you shortly.',
  invalidPhone: 'Phone number looks invalid. Please resend (example: N, 0812345678).',
  needPick: 'Please choose one of the options below.',
  reset: 'Reset ✅ Let’s start again.',

  faqTitle: 'Quick questions — choose one:',
  faqLocation: 'Location / Branches',
  faqPrices: 'Typical prices',
  faqPromo: 'Promotions',
  faqDoctor: 'Doctor & safety',
  faqAftercare: 'Aftercare',
  faqTalkHuman: 'Talk to staff',
  faqBookNow: 'Book appointment',
  faqBackMenu: 'Back to menu',

  faqAnswers: {
    location: 'Demo: We can operate for clinics in Bangkok. Share your branch address and we’ll customize.',
    prices: 'Demo: Pricing depends on product/area/units. Tell me service + area and I’ll estimate a range.',
    promo: 'Demo: Promotions vary weekly. Tell me the service you want and your budget.',
    doctor: 'Demo: Ask for certified doctor, product authenticity, and clear aftercare.',
    aftercare:
      'Demo: Avoid alcohol + heavy workout 24h; follow clinic instructions; report unusual swelling/pain.',
  },
};

// --------------------
// Helpers
// --------------------
function getUserId(event) {
  return event.source?.userId || null;
}

function getSession(userId) {
  const existing = sessions.get(userId);
  if (existing) return existing;

  const fresh = {
    step: STEPS.MENU,
    data: {
      // booking fields:
      intent: null,
      area: null,
      budget: null,
      day: null,
      timeWindow: null,
      timeExact: null,
      name: null,
      phone: null,
      path: null, // 'book' or 'faq'
      faqLastKey: null,
    },
    updatedAt: Date.now(),
  };

  sessions.set(userId, fresh);
  return fresh;
}

function resetSession(userId) {
  sessions.set(userId, {
    step: STEPS.MENU,
    data: { path: null, faqLastKey: null },
    updatedAt: Date.now(),
  });
}

function touch(session) {
  session.updatedAt = Date.now();
}

function normalize(s) {
  return (s || '').trim();
}

function makeText(text) {
  return { type: 'text', text };
}

function makeQuickReply(items) {
  return {
    items: items.map((i) => ({
      type: 'action',
      action: { type: 'message', label: i.label, text: i.text },
    })),
  };
}

function isReset(text) {
  return /^reset$|^start over$|^restart$/i.test(text);
}

function validatePhone(text) {
  const digits = (text || '').replace(/[^\d+]/g, '');
  if (digits.length < 8) return null;
  return digits;
}

function isOther(text) {
  return /^other$/i.test(text);
}

function bangkokTimes() {
  const now = new Date();
  const bkk = now.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
  return { iso: now.toISOString(), bangkok: bkk };
}

// ✅ Get text from message OR postback (rich menu tiles should be postback)
function getEventText(event) {
  if (event.type === 'message' && event.message?.type === 'text') {
    return normalize(event.message.text);
  }
  if (event.type === 'postback') {
    return normalize(event.postback?.data || '');
  }
  return '';
}

// ✅ Parse postback data like "action=book"
function parsePostbackAction(data) {
  const s = (data || '').trim();
  const m = s.match(/(?:^|[?&])action=([^&]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : '';
}

// ✅ Global router (works anywhere)
function classifyCommand(raw) {
  const s = (raw || '').trim().toLowerCase();

  // postback format
  if (s.includes('action=')) {
    const a = parsePostbackAction(s);
    if (a === 'book') return 'BOOK';
    if (a === 'faq') return 'FAQ';
    if (a === 'promo') return 'FAQ_PROMO';
    if (a === 'prices') return 'FAQ_PRICES';
    if (a === 'location') return 'FAQ_LOCATION';
    if (a === 'contact') return 'STAFF';
  }

  // typed text fallback (still supported)
  if (s === 'book an appointment' || s === 'book appointment' || s === 'book') return 'BOOK';
  if (s === 'quick questions' || s === 'questions' || s === 'quick') return 'FAQ';
  if (s === 'prices' || s === 'typical prices') return 'FAQ_PRICES';
  if (s === 'promotions' || s === 'promo') return 'FAQ_PROMO';
  if (s === 'location' || s === 'branches' || s === 'location / branches') return 'FAQ_LOCATION';
  if (s === 'talk to staff' || s === 'staff' || s === 'contact') return 'STAFF';

  return null;
}

function forceFaqAnswer(session, key) {
  const answer = T.faqAnswers[key] || 'Demo';
  session.step = STEPS.FAQ;
  session.data.path = 'faq';
  session.data.faqLastKey = key;
  return { answer, quick: faqQuickReply(session) };
}

// --------------------
// Google Sheets sender (Apps Script Web App)
// --------------------
async function sendLeadToSheet(lead) {
  const url = process.env.LEADS_API_URL;
  if (!url) {
    console.warn('LEADS_API_URL missing');
    return;
  }

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead),
    });

    const text = await r.text();
    if (!r.ok) console.error('Apps Script error', r.status, text);
    else console.log('Lead saved to sheet:', text);
  } catch (e) {
    console.error('Failed to send lead to sheet', e);
  }
}

// --------------------
// LINE webhook
// --------------------
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

// --------------------
// Main event handler
// --------------------
async function handleEvent(event) {
  // Start trigger: follow/join
  if (event.type === 'follow' || event.type === 'join') {
    const userId = getUserId(event);
    if (!userId) return;
    resetSession(userId);
    return reply(event, makeText(T.menuTitle), menuQuickReply());
  }

  const userId = getUserId(event);
  if (!userId) return;

  const userText = getEventText(event);
  if (!userText) return;

  if (isReset(userText)) {
    resetSession(userId);
    return reply(event, makeText(T.menuTitle), menuQuickReply());
  }

  const session = getSession(userId);
  touch(session);

  // ✅ GLOBAL RICH MENU ROUTING (anytime, anywhere)
  const cmd = classifyCommand(userText);
  if (cmd) {
    if (cmd === 'BOOK') {
      session.data.path = 'book';
      session.step = STEPS.INTENT;
      return reply(event, makeText(T.welcome), intentQuickReply());
    }

    if (cmd === 'FAQ') {
      session.data.path = 'faq';
      session.step = STEPS.FAQ;
      return reply(event, makeText(T.faqTitle), faqQuickReply(session));
    }

    if (cmd === 'FAQ_PRICES') {
      const { answer, quick } = forceFaqAnswer(session, 'prices');
      return reply(event, makeText(answer), quick);
    }

    if (cmd === 'FAQ_PROMO') {
      const { answer, quick } = forceFaqAnswer(session, 'promo');
      return reply(event, makeText(answer), quick);
    }

    if (cmd === 'FAQ_LOCATION') {
      const { answer, quick } = forceFaqAnswer(session, 'location');
      return reply(event, makeText(answer), quick);
    }

    if (cmd === 'STAFF') {
      session.step = STEPS.CONTACT;
      session.data.path = session.data.path || 'faq';

      // sheet consistency for staff/contact requests
      session.data.intent = session.data.intent || 'Quick Question';
      session.data.area = session.data.area || '-';
      session.data.budget = session.data.budget || '-';
      session.data.day = session.data.day || '-';
      session.data.timeWindow = session.data.timeWindow || '-';
      session.data.timeExact = session.data.timeExact || '-';

      return reply(event, makeText(T.askContact));
    }
  }

  // If user is new / unclear, always show menu quickly
  if (session.step === STEPS.MENU) {
    const kick = /^(hi|hello|hey|start|test)$/i.test(userText);
    if (kick) return reply(event, makeText(T.menuTitle), menuQuickReply());
  }

  // --------------------
  // MENU
  // --------------------
  if (session.step === STEPS.MENU) {
    if (/^book( an)? appointment$/i.test(userText)) {
      session.data.path = 'book';
      session.step = STEPS.INTENT;
      return reply(event, makeText(T.welcome), intentQuickReply());
    }
    if (/^quick questions$/i.test(userText)) {
      session.data.path = 'faq';
      session.step = STEPS.FAQ;
      return reply(event, makeText(T.faqTitle), faqQuickReply(session));
    }
    return reply(event, makeText(T.needPick), menuQuickReply());
  }

  // --------------------
  // FAQ
  // --------------------
  if (session.step === STEPS.FAQ) {
    if (userText === T.faqBackMenu) {
      session.step = STEPS.MENU;
      return reply(event, makeText(T.menuTitle), menuQuickReply());
    }
    if (userText === T.faqBookNow) {
      session.data.path = 'book';
      session.step = STEPS.INTENT;
      return reply(event, makeText(T.welcome), intentQuickReply());
    }

    const map = {
      [T.faqLocation]: 'location',
      [T.faqPrices]: 'prices',
      [T.faqPromo]: 'promo',
      [T.faqDoctor]: 'doctor',
      [T.faqAftercare]: 'aftercare',
      [T.faqTalkHuman]: 'talkHuman',
      // short labels (if you used them on tiles or quick replies later)
      location: 'location',
      prices: 'prices',
      promo: 'promo',
      doctor: 'doctor',
      aftercare: 'aftercare',
      staff: 'talkHuman',
    };

    const key = map[userText.toLowerCase()] || map[userText];
    if (!key) return reply(event, makeText(T.needPick), faqQuickReply(session));

    session.data.faqLastKey = key;

    if (key === 'talkHuman') {
      session.step = STEPS.CONTACT;
      session.data.intent = 'Quick Question';
      session.data.area = '-';
      session.data.budget = '-';
      session.data.day = '-';
      session.data.timeWindow = '-';
      session.data.timeExact = '-';
      return reply(event, makeText(T.askContact));
    }

    const answer = T.faqAnswers[key] || 'Demo';
    return reply(event, makeText(answer), faqQuickReply(session));
  }

  // --------------------
  // BOOKING FLOW
  // --------------------
  if (session.step === STEPS.INTENT) {
    if (isOther(userText)) {
      session.step = STEPS.INTENT_OTHER;
      return reply(event, makeText(T.askOtherService));
    }
    session.data.intent = userText;
    session.step = STEPS.AREA;
    return reply(event, makeText(T.askArea), areaQuickReply());
  }

  if (session.step === STEPS.INTENT_OTHER) {
    session.data.intent = userText;
    session.step = STEPS.AREA;
    return reply(event, makeText(T.askArea), areaQuickReply());
  }

  if (session.step === STEPS.AREA) {
    if (isOther(userText)) {
      session.step = STEPS.AREA_OTHER;
      return reply(event, makeText(T.askOtherArea));
    }
    session.data.area = userText;
    session.step = STEPS.BUDGET;
    return reply(event, makeText(T.askBudget), budgetQuickReply());
  }

  if (session.step === STEPS.AREA_OTHER) {
    session.data.area = userText;
    session.step = STEPS.BUDGET;
    return reply(event, makeText(T.askBudget), budgetQuickReply());
  }

  if (session.step === STEPS.BUDGET) {
    if (isOther(userText)) {
      session.step = STEPS.BUDGET_OTHER;
      return reply(event, makeText(T.askOtherBudget));
    }
    session.data.budget = userText;
    session.step = STEPS.DAY;
    return reply(event, makeText(T.askDay), dayQuickReply());
  }

  if (session.step === STEPS.BUDGET_OTHER) {
    session.data.budget = userText;
    session.step = STEPS.DAY;
    return reply(event, makeText(T.askDay), dayQuickReply());
  }

  if (session.step === STEPS.DAY) {
    if (isOther(userText)) {
      session.step = STEPS.DAY_OTHER;
      return reply(event, makeText(T.askOtherDay));
    }
    session.data.day = userText;
    session.step = STEPS.TIME_OF_DAY;
    return reply(event, makeText(T.askTimeOfDay), timeOfDayQuickReply());
  }

  if (session.step === STEPS.DAY_OTHER) {
    session.data.day = userText;
    session.step = STEPS.TIME_OF_DAY;
    return reply(event, makeText(T.askTimeOfDay), timeOfDayQuickReply());
  }

  if (session.step === STEPS.TIME_OF_DAY) {
    session.data.timeWindow = userText;
    if (isOther(userText)) {
      session.step = STEPS.TIME_EXACT;
      return reply(event, makeText(T.askExactTime));
    }
    session.data.timeExact = userText;
    session.step = STEPS.CONTACT;
    return reply(event, makeText(T.askContact));
  }

  if (session.step === STEPS.TIME_EXACT) {
    session.data.timeExact = userText;
    session.step = STEPS.CONTACT;
    return reply(event, makeText(T.askContact));
  }

  if (session.step === STEPS.CONTACT) {
    const parts = userText.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return reply(event, makeText(T.askContact));

    const name = parts[0];
    const phone = validatePhone(parts.slice(1).join(' '));
    if (!phone) return reply(event, makeText(T.invalidPhone));

    session.data.name = name;
    session.data.phone = phone;
    session.step = STEPS.CONFIRM;

    const summary =
      `${T.confirmTitle}\n\n` +
      `• Service: ${session.data.intent}\n` +
      `• Area: ${session.data.area}\n` +
      `• Budget: ${session.data.budget}\n` +
      `• Day: ${session.data.day}\n` +
      `• Time: ${session.data.timeExact}\n` +
      `• Name: ${session.data.name}\n` +
      `• Phone: ${session.data.phone}\n\n` +
      `${T.yes} / ${T.edit}`;

    return reply(event, makeText(summary), confirmQuickReply());
  }

  if (session.step === STEPS.CONFIRM) {
    if (/^yes$/i.test(userText)) {
      const ts = bangkokTimes();

      const lead = {
        ts_iso: ts.iso,
        ts_bkk: ts.bangkok,

        userId,
        intent: session.data.intent || '-',
        area: session.data.area || '-',
        budget: session.data.budget || '-',

        day: session.data.day || '-',
        timeWindow: session.data.timeWindow || '-',
        timeExact: session.data.timeExact || '-',

        timing: session.data.day || '-',
        slot: session.data.timeExact || session.data.timeWindow || '-',

        name: session.data.name || '-',
        phone: session.data.phone || '-',

        path: session.data.path || 'book',
        source: 'line',
      };

      await sendLeadToSheet(lead);
      session.step = STEPS.DONE;
      return reply(event, makeText(T.booked));
    }

    if (/^edit$/i.test(userText)) {
      resetSession(userId);
      return reply(event, makeText(T.menuTitle), menuQuickReply());
    }

    return reply(event, makeText(T.needPick), confirmQuickReply());
  }

  if (session.step === STEPS.DONE) {
    return reply(event, makeText('Type RESET to start a new booking.'));
  }

  // fallback
  session.step = STEPS.MENU;
  return reply(event, makeText(T.menuTitle), menuQuickReply());
}

// --------------------
// Quick replies
// --------------------
function menuQuickReply() {
  return makeQuickReply([
    { label: T.menuBook, text: T.menuBook },
    { label: T.menuFaq, text: T.menuFaq },
  ]);
}

function intentQuickReply() {
  const items = [
    'Botox',
    'Filler',
    'HIFU',
    'Thermage',
    'Ultherapy',
    'Laser (Pico/IPL)',
    'Acne scar treatment',
    'Skin booster',
    'Thread lift',
    'Facial',
    'Other',
  ];
  return makeQuickReply(items.map((x) => ({ label: x, text: x })));
}

function areaQuickReply() {
  const items = ['Forehead', 'Jawline', 'Under-eye', 'Lips', 'Cheeks', 'Chin', 'Nose', 'Full face', 'Other'];
  return makeQuickReply(items.map((x) => ({ label: x, text: x })));
}

function budgetQuickReply() {
  const items = ['< 5k', '5k–10k', '10k–20k', '20k–40k', '40k+', 'Other'];
  return makeQuickReply(items.map((x) => ({ label: x, text: x })));
}

function dayQuickReply() {
  const items = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Other'];
  return makeQuickReply(items.map((x) => ({ label: x, text: x })));
}

function timeOfDayQuickReply() {
  const items = ['Morning (10–12)', 'Afternoon (12–15)', 'Late (15–18)', 'Evening (18–20)', 'Other'];
  return makeQuickReply(items.map((x) => ({ label: x, text: x })));
}

function faqQuickReply(session) {
  // includes exits so user never gets stuck
  return makeQuickReply([
    { label: T.faqLocation, text: T.faqLocation },
    { label: T.faqPrices, text: T.faqPrices },
    { label: T.faqPromo, text: T.faqPromo },
    { label: T.faqDoctor, text: T.faqDoctor },
    { label: T.faqAftercare, text: T.faqAftercare },
    { label: T.faqTalkHuman, text: T.faqTalkHuman },
    { label: T.faqBookNow, text: T.faqBookNow },
    { label: T.faqBackMenu, text: T.faqBackMenu },
  ]);
}

function confirmQuickReply() {
  return makeQuickReply([
    { label: T.yes, text: T.yes },
    { label: T.edit, text: T.edit },
  ]);
}

// --------------------
// Reply wrapper
// --------------------
async function reply(event, message, quickReply = null) {
  const m = quickReply ? { ...message, quickReply } : message;
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [m],
  });
}

// --------------------
// Rich menu: create + set default (ADMIN endpoint)
// IMPORTANT:
// - Upload your image file to GitHub repo as: ./richmenu.png
// - Rich menu tiles must be POSTBACK and should NOT include displayText (silent)
// Call once: https://<your-render-url>/create-rich-menu?key=YOUR_ADMIN_KEY
// --------------------
app.get('/create-rich-menu', async (req, res) => {
  try {
    const key = req.query.key;
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
      return res.status(403).send('Forbidden');
    }

    const richMenu = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'Clinic Menu',
      chatBarText: 'Menu',
      areas: [
        {
          bounds: { x: 0, y: 0, width: 1250, height: 843 },
          action: { type: 'postback', data: 'action=book' }, // ✅ silent
        },
        {
          bounds: { x: 1250, y: 0, width: 1250, height: 843 },
          action: { type: 'postback', data: 'action=faq' }, // ✅ silent
        },
        {
          bounds: { x: 0, y: 843, width: 1250, height: 843 },
          action: { type: 'postback', data: 'action=promo' }, // ✅ silent
        },
        {
          bounds: { x: 1250, y: 843, width: 1250, height: 843 },
          action: { type: 'postback', data: 'action=contact' }, // ✅ silent
        },
      ],
    };

    // Create rich menu via Messaging API (SDK)
    const created = await client.createRichMenu(richMenu);
    const richMenuId = created.richMenuId;

    // Upload image + set default (raw HTTP because SDK methods differ by version)
    const image = fs.readFileSync('./richmenu.png');

    const headersBase = {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    };

    // 1) set image
    const r1 = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
      method: 'POST',
      headers: { ...headersBase, 'Content-Type': 'image/png' },
      body: image,
    });
    if (!r1.ok) {
      const t = await r1.text();
      throw new Error(`set image failed: ${r1.status} ${t}`);
    }

    // 2) set default
    const r2 = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
      method: 'POST',
      headers: headersBase,
    });
    if (!r2.ok) {
      const t = await r2.text();
      throw new Error(`set default failed: ${r2.status} ${t}`);
    }

    res.send(`✅ Rich menu created + default set. ID: ${richMenuId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ Error creating rich menu: ' + err.message);
  }
});

// --------------------
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LINE bot running on port ${port}`));
