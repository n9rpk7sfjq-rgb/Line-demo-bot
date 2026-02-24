import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
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

// LINE webhook
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
// Session store (in-memory)
// --------------------
const sessions = new Map();

const STEPS = {
  LANG: 'lang',
  INTENT: 'intent',
  AREA: 'area',
  BUDGET: 'budget',
  DAY: 'day',
  TIME_OF_DAY: 'time_of_day',
  TIME_EXACT: 'time_exact',
  CONTACT: 'contact',
  CONFIRM: 'confirm',
  DONE: 'done',
};

// --------------------
// Translations
// --------------------
const T = {
  en: {
    chooseLang: "Please choose your language:",
    welcome: "Welcome! What service are you interested in?",
    askArea: "Which area?",
    askBudget: "What is your budget range?",
    askDay: "Which day would you like to come?",
    askTimeOfDay: "Which time of day?",
    askExactTime: "Please type your preferred time (e.g., 3:30pm)",
    askContact: "Please send: Name, Phone (example: N, 0812345678)",
    confirmTitle: "Please confirm your booking:",
    yes: "YES",
    edit: "EDIT",
    booked: "Booked (demo) ✅ We’ll contact you shortly.",
    invalidPhone: "Phone number looks invalid. Please resend (example: N, 0812345678).",
    needPick: "Please choose one of the options below.",
    reset: "Reset ✅ Let’s start again. What service are you interested in?",
  },
  th: {
    chooseLang: "กรุณาเลือกภาษาของคุณ:",
    welcome: "ยินดีต้อนรับ! คุณสนใจบริการอะไร?",
    askArea: "ต้องการทำบริเวณไหน?",
    askBudget: "งบประมาณเท่าไหร่?",
    askDay: "ต้องการมาวันไหน?",
    askTimeOfDay: "ต้องการช่วงเวลาไหน?",
    askExactTime: "กรุณาพิมพ์เวลาที่ต้องการ (เช่น 15:30)",
    askContact: "กรุณาส่ง: ชื่อ, เบอร์โทร (เช่น N, 0812345678)",
    confirmTitle: "กรุณายืนยันการจอง:",
    yes: "ยืนยัน",
    edit: "แก้ไข",
    booked: "จองเรียบร้อย (เดโม) ✅ ทางคลินิกจะติดต่อกลับ",
    invalidPhone: "เบอร์โทรไม่ถูกต้อง กรุณาส่งใหม่ (เช่น N, 0812345678)",
    needPick: "กรุณาเลือกจากตัวเลือกด้านล่าง",
    reset: "รีเซ็ตแล้ว ✅ เริ่มใหม่อีกครั้ง คุณสนใจบริการอะไร?",
  }
};

function t(session, key) {
  const lang = session.data.lang || 'en';
  return T[lang][key] || T.en[key] || key;
}

// --------------------
// Helpers
// --------------------
function getUserId(event) {
  return event.source?.userId || null;
}

function getSession(userId) {
  const existing = sessions.get(userId);
  if (existing) return existing;
  const fresh = { step: STEPS.LANG, data: { lang: null }, updatedAt: Date.now() };
  sessions.set(userId, fresh);
  return fresh;
}

function resetSession(userId) {
  sessions.set(userId, { step: STEPS.LANG, data: { lang: null }, updatedAt: Date.now() });
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
  return /^reset$|^start over$|^restart$|เริ่มใหม่|รีเซ็ต/i.test(text);
}

function validatePhone(text) {
  const digits = (text || '').replace(/[^\d+]/g, '');
  if (digits.length < 8) return null;
  return digits;
}

// --------------------
// Google Sheets sender
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
// Main handler
// --------------------
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = getUserId(event);
  if (!userId) return;

  const userText = normalize(event.message.text);
  if (!userText) return;

  if (isReset(userText)) {
    resetSession(userId);
    const s = getSession(userId);
    return reply(event, makeText("Please choose your language / กรุณาเลือกภาษา"), langQuickReply());
  }

  const session = getSession(userId);
  touch(session);

  // STEP 0: Language
  if (session.step === STEPS.LANG) {
    if (/^english$/i.test(userText)) {
      session.data.lang = 'en';
      session.step = STEPS.INTENT;
      return reply(event, makeText(T.en.welcome), intentQuickReplyEn());
    }
    if (/^ภาษาไทย$/i.test(userText)) {
      session.data.lang = 'th';
      session.step = STEPS.INTENT;
      return reply(event, makeText(T.th.welcome), intentQuickReplyTh());
    }
    return reply(event, makeText("Please choose your language / กรุณาเลือกภาษา"), langQuickReply());
  }

  // STEP 1: Intent
  if (session.step === STEPS.INTENT) {
    session.data.intent = userText;
    session.step = STEPS.AREA;
    return reply(event, makeText(t(session, 'askArea')), areaQuickReply(session));
  }

  // STEP 2: Area
  if (session.step === STEPS.AREA) {
    session.data.area = userText;
    session.step = STEPS.BUDGET;
    return reply(event, makeText(t(session, 'askBudget')), budgetQuickReply(session));
  }

  // STEP 3: Budget
  if (session.step === STEPS.BUDGET) {
    session.data.budget = userText;
    session.step = STEPS.DAY;
    return reply(event, makeText(t(session, 'askDay')), dayQuickReply(session));
  }

  // STEP 4: Day
  if (session.step === STEPS.DAY) {
    session.data.day = userText;
    session.step = STEPS.TIME_OF_DAY;
    return reply(event, makeText(t(session, 'askTimeOfDay')), timeOfDayQuickReply(session));
  }

  // STEP 5: Time of day
  if (session.step === STEPS.TIME_OF_DAY) {
    session.data.timeWindow = userText;
    if (/other|อื่น/i.test(userText)) {
      session.step = STEPS.TIME_EXACT;
      return reply(event, makeText(t(session, 'askExactTime')));
    } else {
      session.data.timeExact = userText;
      session.step = STEPS.CONTACT;
      return reply(event, makeText(t(session, 'askContact')));
    }
  }

  // STEP 6: Exact time
  if (session.step === STEPS.TIME_EXACT) {
    session.data.timeExact = userText;
    session.step = STEPS.CONTACT;
    return reply(event, makeText(t(session, 'askContact')));
  }

  // STEP 7: Contact
  if (session.step === STEPS.CONTACT) {
    const parts = userText.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      return reply(event, makeText(t(session, 'askContact')));
    }

    const name = parts[0];
    const phone = validatePhone(parts.slice(1).join(' '));
    if (!phone) {
      return reply(event, makeText(t(session, 'invalidPhone')));
    }

    session.data.name = name;
    session.data.phone = phone;
    session.step = STEPS.CONFIRM;

    const summary =
      `${t(session, 'confirmTitle')}\n\n` +
      `• Service: ${session.data.intent}\n` +
      `• Area: ${session.data.area}\n` +
      `• Budget: ${session.data.budget}\n` +
      `• Day: ${session.data.day}\n` +
      `• Time: ${session.data.timeExact}\n` +
      `• Name: ${session.data.name}\n` +
      `• Phone: ${session.data.phone}\n\n` +
      `${t(session, 'yes')} / ${t(session, 'edit')}`;

    return reply(event, makeText(summary), confirmQuickReply(session));
  }

  // STEP 8: Confirm
  if (session.step === STEPS.CONFIRM) {
    if (/^yes$|^ยืนยัน$/i.test(userText)) {
      const lead = {
        ts: new Date().toISOString(),
        userId,
        ...session.data,
      };
      await sendLeadToSheet(lead);
      session.step = STEPS.DONE;
      return reply(event, makeText(t(session, 'booked')));
    }

    if (/^edit$|^แก้ไข$/i.test(userText)) {
      resetSession(userId);
      const s = getSession(userId);
      return reply(event, makeText("Please choose your language / กรุณาเลือกภาษา"), langQuickReply());
    }

    return reply(event, makeText(t(session, 'needPick')), confirmQuickReply(session));
  }

  // DONE
  if (session.step === STEPS.DONE) {
    return reply(event, makeText("Type RESET to start a new booking."));
  }
}

// --------------------
// Quick replies
// --------------------
function langQuickReply() {
  return makeQuickReply([
    { label: "English", text: "English" },
    { label: "ภาษาไทย", text: "ภาษาไทย" },
  ]);
}

function intentQuickReplyEn() {
  return makeQuickReply([
    { label: 'Botox', text: 'Botox' },
    { label: 'Filler', text: 'Filler' },
    { label: 'Laser', text: 'Laser' },
    { label: 'Facial', text: 'Facial' },
    { label: 'Other', text: 'Other' },
  ]);
}

function intentQuickReplyTh() {
  return makeQuickReply([
    { label: 'โบท็อกซ์', text: 'Botox' },
    { label: 'ฟิลเลอร์', text: 'Filler' },
    { label: 'เลเซอร์', text: 'Laser' },
    { label: 'ทรีทเมนต์หน้า', text: 'Facial' },
    { label: 'อื่น ๆ', text: 'Other' },
  ]);
}

function areaQuickReply(session) {
  return makeQuickReply([
    { label: 'Forehead', text: 'Forehead' },
    { label: 'Jawline', text: 'Jawline' },
    { label: 'Under-eye', text: 'Under-eye' },
    { label: 'Lips', text: 'Lips' },
    { label: 'Other', text: 'Other' },
  ]);
}

function budgetQuickReply(session) {
  return makeQuickReply([
    { label: '< 5k', text: '<5k' },
    { label: '5k–10k', text: '5k–10k' },
    { label: '10k–20k', text: '10k–20k' },
    { label: '20k+', text: '20k+' },
    { label: 'Other', text: 'Other' },
  ]);
}

function dayQuickReply(session) {
  return makeQuickReply([
    { label: 'Monday', text: 'Monday' },
    { label: 'Tuesday', text: 'Tuesday' },
    { label: 'Wednesday', text: 'Wednesday' },
    { label: 'Thursday', text: 'Thursday' },
    { label: 'Friday', text: 'Friday' },
    { label: 'Saturday', text: 'Saturday' },
    { label: 'Sunday', text: 'Sunday' },
    { label: 'Other', text: 'Other' },
  ]);
}

function timeOfDayQuickReply(session) {
  return makeQuickReply([
    { label: 'Morning', text: 'Morning' },
    { label: 'Afternoon', text: 'Afternoon' },
    { label: 'Evening', text: 'Evening' },
    { label: 'Other', text: 'Other' },
  ]);
}

function confirmQuickReply(session) {
  return makeQuickReply([
    { label: t(session, 'yes'), text: t(session, 'yes') },
    { label: t(session, 'edit'), text: t(session, 'edit') },
  ]);
}

// --------------------
async function reply(event, message, quickReply = null) {
  const m = quickReply ? { ...message, quickReply } : message;
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [m],
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LINE bot running on port ${port}`));
