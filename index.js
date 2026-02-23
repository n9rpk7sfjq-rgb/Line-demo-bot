// index.js  (FULL FILE - replace everything with this)
import 'dotenv/config';
import express from 'express';
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

// LINE webhook endpoint
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
// Demo "database" (in-memory). Production: Redis/DB.
// --------------------
const sessions = new Map(); // userId -> { step, data, updatedAt }

const STEPS = {
  INTENT: 'intent',
  AREA: 'area',
  BUDGET: 'budget',
  TIMING: 'timing',
  SLOT: 'slot',
  CONTACT: 'contact',
  DONE: 'done',
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
  const fresh = { step: STEPS.INTENT, data: {}, updatedAt: Date.now() };
  sessions.set(userId, fresh);
  return fresh;
}

function resetSession(userId) {
  sessions.set(userId, { step: STEPS.INTENT, data: {}, updatedAt: Date.now() });
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

function isGreeting(text) {
  return /^(hi|hello|hey|yo|sup|สวัสดี|หวัดดี|ทัก|ดีครับ|ดีค่ะ)\b/i.test(text || '');
}

function detectIntent(text) {
  const t = (text || '').toLowerCase();
  if (/botox|โบท็อก/i.test(t)) return 'Botox';
  if (/filler|ฟิลเลอร์/i.test(t)) return 'Filler';
  if (/facial|ทรีทเมนต์|ทรีตเมนต์|skin|ผิว/i.test(t)) return 'Skin/Facial';
  if (/anti[- ]?aging|ยกกระชับ|lifting/i.test(t)) return 'Anti-aging/Lifting';
  return null;
}

function validatePhone(text) {
  const digits = (text || '').replace(/[^\d+]/g, '');
  if (digits.length < 8) return null;
  return digits;
}

// --------------------
// Slot generation (FIXES your “next week but today/tomorrow slots” issue)
// --------------------
const BANGKOK_TZ = 'Asia/Bangkok';

// Returns "Mon", "Tue", etc (Bangkok time)
function weekdayShort(d) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: BANGKOK_TZ }).format(d);
}

// Returns "6:30pm" (Bangkok time)
function timeShort(d) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: BANGKOK_TZ,
  })
    .format(d)
    .replace(' ', '')
    .toLowerCase();
}

// Create a Date at Bangkok local date/time (approx; good enough for demo slots)
function bangkokDate(y, m, day, hour, min) {
  // We store as UTC date corresponding to Bangkok wall clock time.
  // Bangkok is UTC+7 (no DST) so subtract 7 hours to get UTC.
  const utc = Date.UTC(y, m, day, hour - 7, min, 0);
  return new Date(utc);
}

function getBangkokYMD(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { y: Number(get('year')), m: Number(get('month')) - 1, day: Number(get('day')) };
}

function addDaysBangkok(baseYMD, addDays) {
  // build UTC date from Bangkok midnight, then add days
  const base = bangkokDate(baseYMD.y, baseYMD.m, baseYMD.day, 0, 0);
  const next = new Date(base.getTime() + addDays * 24 * 60 * 60 * 1000);
  return getBangkokYMD(next);
}

function nextMondayFromTodayBangkok() {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: BANGKOK_TZ }).format(now);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const todayIdx = map[weekday] ?? 0;
  const daysUntilMon = (8 - todayIdx) % 7 || 7; // next Monday (not today)
  const todayYMD = getBangkokYMD(now);
  return addDaysBangkok(todayYMD, daysUntilMon);
}

function buildSlots(timingText) {
  const t = (timingText || '').toLowerCase();
  const todayYMD = getBangkokYMD(new Date());

  // slot times we offer
  const slotTimes = [
    { h: 13, m: 0 },  // 1:00pm
    { h: 18, m: 30 }, // 6:30pm
    { h: 19, m: 15 }, // 7:15pm
  ];

  // choose which dates to offer based on timing
  let dates = [];

  if (t.includes('today')) {
    dates = [todayYMD];
  } else if (t.includes('next week')) {
    const mon = nextMondayFromTodayBangkok();
    const tue = addDaysBangkok(mon, 1);
    const wed = addDaysBangkok(mon, 2);
    dates = [mon, tue, wed];
  } else {
    // "This week" (or anything else): next 3 days
    const d1 = addDaysBangkok(todayYMD, 1);
    const d2 = addDaysBangkok(todayYMD, 2);
    const d3 = addDaysBangkok(todayYMD, 3);
    dates = [d1, d2, d3];
  }

  // Build slot labels the user will click
  const slots = [];
  for (const date of dates) {
    for (const st of slotTimes) {
      const d = bangkokDate(date.y, date.m, date.day, st.h, st.m);
      const label = `${weekdayShort(d)} ${timeShort(d)}`; // e.g. "Mon 6:30pm"
      slots.push(label);
    }
  }

  // Return first 3 slots (clean UX); adjust if you want more
  return slots.slice(0, 3);
}

function slotQuickReplyForTiming(timing) {
  const slots = buildSlots(timing);
  return makeQuickReply(slots.map((s) => ({ label: s, text: s })));
}

// --------------------
// SEND TO GOOGLE SHEET (Apps Script Web App)
// --------------------
async function sendLeadToSheet(lead) {
  const url = process.env.LEADS_API_URL; // Apps Script /exec URL
  if (!url) {
    console.warn('LEADS_API_URL missing - not sending lead to sheet');
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
// Main event handler
// --------------------
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = getUserId(event);
  if (!userId) return;

  const userText = normalize(event.message.text);
  if (!userText) return;

  if (isReset(userText)) {
    resetSession(userId);
    return reply(event, makeText('Reset ✅ Let’s start. What are you interested in?'), intentQuickReply());
  }

  const session = getSession(userId);
  touch(session);

  // Greeting: do NOT reset, just prompt appropriately
  if (isGreeting(userText)) {
    if (session.step === STEPS.DONE) {
      return reply(
        event,
        makeText("You’re already booked (demo). Want to change time or start over?"),
        makeQuickReply([
          { label: 'Change time', text: 'Change time' },
          { label: 'Start over', text: 'reset' },
        ])
      );
    }

    if (session.step !== STEPS.INTENT) {
      // Continue where they left off (no loop)
      const msg =
        session.step === STEPS.SLOT
          ? 'Continue: Pick a time slot:'
          : `Continue: ${stepPrompt(session)}`;

      const qr =
        session.step === STEPS.SLOT
          ? slotQuickReplyForTiming(session.data.timing)
          : quickReplyForStep(session);

      return reply(event, makeText(msg), qr);
    }

    return reply(event, makeText('What are you interested in?'), intentQuickReply());
  }

  if (/^help$|ช่วยด้วย|ช่วยหน่อย/i.test(userText)) {
    return reply(event, makeText('I can help you book a consultation. Tap an option below.'), intentQuickReply());
  }

  // DONE: allow “Change time”
  if (session.step === STEPS.DONE) {
    if (/^change time$/i.test(userText)) {
      session.step = STEPS.SLOT;
      return reply(event, makeText('Pick a time slot:'), slotQuickReplyForTiming(session.data.timing));
    }
    return reply(
      event,
      makeText("You’re already booked (demo). Want to change time or start over?"),
      makeQuickReply([
        { label: 'Change time', text: 'Change time' },
        { label: 'Start over', text: 'reset' },
      ])
    );
  }

  switch (session.step) {
    case STEPS.INTENT: {
      const detected = detectIntent(userText);
      const allowed = ['Botox', 'Filler', 'Skin/Facial', 'Anti-aging/Lifting'];

      const picked = allowed.find((a) => a.toLowerCase() === userText.toLowerCase()) || detected;
      if (!picked) return reply(event, makeText('What are you interested in?'), intentQuickReply());

      session.data.intent = picked;
      session.step = STEPS.AREA;
      return reply(event, makeText(`Got it: ${picked}. Which area?`), areaQuickReply());
    }

    case STEPS.AREA: {
      session.data.area = userText;
      session.step = STEPS.BUDGET;
      return reply(event, makeText('Budget range?'), budgetQuickReply());
    }

    case STEPS.BUDGET: {
      session.data.budget = userText;
      session.step = STEPS.TIMING;
      return reply(event, makeText('When do you want to come?'), timingQuickReply());
    }

    case STEPS.TIMING: {
      session.data.timing = userText;
      session.step = STEPS.SLOT;
      return reply(event, makeText('Pick a time slot:'), slotQuickReplyForTiming(session.data.timing));
    }

    case STEPS.SLOT: {
      const slots = buildSlots(session.data.timing);
      const picked =
        slots.find((s) => s.toLowerCase() === userText.toLowerCase()) ||
        slots.find((s) => userText.toLowerCase().includes(s.toLowerCase()));

      if (!picked) {
        return reply(event, makeText('Please pick one of the slots below:'), slotQuickReplyForTiming(session.data.timing));
      }

      session.data.slot = picked;
      session.step = STEPS.CONTACT;

      return reply(
        event,
        makeText(
          `Great. Please send:\n` +
            `1) Your name\n` +
            `2) Your phone number\n\n` +
            `Example: "N, 0812345678"\n\n` +
            `Final suitability is confirmed by the clinician.`
        )
      );
    }

    case STEPS.CONTACT: {
      const parts = userText.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) {
        return reply(event, makeText('Please send "Name, Phone" (example: "N, 0812345678").'));
      }

      const name = parts[0];
      const phone = validatePhone(parts.slice(1).join(' '));
      if (!phone) {
        return reply(event, makeText('Phone number looks invalid. Please resend (example: "N, 0812345678").'));
      }

      session.data.name = name;
      session.data.phone = phone;
      session.step = STEPS.DONE;

      const lead = {
        ts: new Date().toISOString(),
        userId,
        intent: session.data.intent,
        area: session.data.area,
        budget: session.data.budget,
        timing: session.data.timing,
        slot: session.data.slot,
        name: session.data.name,
        phone: session.data.phone,
      };

      console.log('NEW LEAD', lead);
      await sendLeadToSheet(lead);

      return reply(
        event,
        makeText(
          `Booked (demo) ✅\n\n` +
            `Summary:\n` +
            `• Service: ${lead.intent}\n` +
            `• Area: ${lead.area}\n` +
            `• Budget: ${lead.budget}\n` +
            `• Time: ${lead.slot}\n\n` +
            `We’ll confirm shortly. If you need to change time, reply here.`
        ),
        makeQuickReply([
          { label: 'Change time', text: 'Change time' },
          { label: 'Start over', text: 'reset' },
        ])
      );
    }

    default: {
      resetSession(userId);
      return reply(event, makeText('Let’s start. What are you interested in?'), intentQuickReply());
    }
  }
}

function stepPrompt(session) {
  switch (session.step) {
    case STEPS.AREA:
      return `Got it: ${session.data.intent}. Which area?`;
    case STEPS.BUDGET:
      return 'Budget range?';
    case STEPS.TIMING:
      return 'When do you want to come?';
    case STEPS.CONTACT:
      return 'Please send "Name, Phone" (example: "N, 0812345678").';
    default:
      return 'What are you interested in?';
  }
}

function quickReplyForStep(session) {
  switch (session.step) {
    case STEPS.AREA:
      return areaQuickReply();
    case STEPS.BUDGET:
      return budgetQuickReply();
    case STEPS.TIMING:
      return timingQuickReply();
    default:
      return intentQuickReply();
  }
}

// --------------------
// Quick replies
// --------------------
function intentQuickReply() {
  return makeQuickReply([
    { label: 'Botox', text: 'Botox' },
    { label: 'Filler', text: 'Filler' },
    { label: 'Skin/Facial', text: 'Skin/Facial' },
    { label: 'Anti-aging', text: 'Anti-aging/Lifting' },
  ]);
}

function areaQuickReply() {
  return makeQuickReply([
    { label: 'Forehead', text: 'Forehead' },
    { label: 'Jawline', text: 'Jawline' },
    { label: 'Under-eye', text: 'Under-eye' },
    { label: 'Lips', text: 'Lips' },
    { label: 'Other', text: 'Other (type it)' },
  ]);
}

function budgetQuickReply() {
  return makeQuickReply([
    { label: 'Under 5k', text: 'Under 5k' },
    { label: '5k–10k', text: '5k–10k' },
    { label: '10k–20k', text: '10k–20k' },
    { label: '20k+', text: '20k+' },
  ]);
}

function timingQuickReply() {
  return makeQuickReply([
    { label: 'Today', text: 'Today' },
    { label: 'This week', text: 'This week' },
    { label: 'Next week', text: 'Next week' },
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LINE demo bot running on port ${port}`));
