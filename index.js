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
const sessions = new Map(); // key: userId -> { step, data, updatedAt }

const STEPS = {
  INTENT: 'intent',
  AREA: 'area',
  BUDGET: 'budget',
  TIMING: 'timing',
  SLOT: 'slot',
  CONTACT: 'contact',
  DONE: 'done',
};

// Demo slots
const DEMO_SLOTS = ['Today 6:30pm', 'Tomorrow 1:00pm', 'Tomorrow 7:15pm'];

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
  // items: [{ label, text }]
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
  // Works at ANY step (prevents “hi does nothing”)
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

function currentQuestionForStep(step, session) {
  switch (step) {
    case STEPS.INTENT:
      return 'What are you interested in?';
    case STEPS.AREA:
      return `Got it: ${session?.data?.intent || ''}. Which area?`.trim();
    case STEPS.BUDGET:
      return 'Budget range?';
    case STEPS.TIMING:
      return 'When do you want to come?';
    case STEPS.SLOT:
      return 'Pick a time slot:';
    case STEPS.CONTACT:
      return (
        `Great. Please send:\n` +
        `1) Your name\n` +
        `2) Your phone number\n\n` +
        `Example: "N, 0812345678"\n\n` +
        `Final suitability is confirmed by the clinician.`
      );
    case STEPS.DONE:
      return "You’re already booked (demo). Want to change time or start over?";
    default:
      return 'What are you interested in?';
  }
}

function getQuickReplyForStep(step) {
  switch (step) {
    case STEPS.INTENT:
      return intentQuickReply();
    case STEPS.AREA:
      return areaQuickReply();
    case STEPS.BUDGET:
      return budgetQuickReply();
    case STEPS.TIMING:
      return timingQuickReply();
    case STEPS.SLOT:
      return slotQuickReply();
    case STEPS.DONE:
      return makeQuickReply([
        { label: 'Change time', text: 'Change time' },
        { label: 'Start over', text: 'reset' },
      ]);
    default:
      return intentQuickReply();
  }
}

// --------------------
// SEND TO GOOGLE SHEET (Apps Script Web App)
// --------------------
async function sendLeadToSheet(lead) {
  const url = process.env.LEADS_API_URL; // MUST be your Apps Script /exec URL
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
    if (!r.ok) {
      console.error('Apps Script error', r.status, text);
    } else {
      console.log('Lead saved to sheet:', text);
    }
  } catch (e) {
    console.error('Failed to send lead to sheet', e);
  }
}

// --------------------
// Main event handler
// --------------------
async function handleEvent(event) {
  // Only respond to text messages
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = getUserId(event);
  if (!userId) return;

  const userText = normalize(event.message.text);
  if (!userText) return;

  // Reset is the only thing that should hard-reset
  if (isReset(userText)) {
    resetSession(userId);
    return reply(
      event,
      makeText('Reset ✅ Let’s start. What are you interested in?'),
      intentQuickReply()
    );
  }

  // Session must exist for greeting handler + flow
  const session = getSession(userId);
  touch(session);

  // Greetings: do NOT reset. Just prompt the right next question.
  if (isGreeting(userText)) {
    // If already booked, show done options
    if (session.step === STEPS.DONE) {
      return reply(event, makeText(currentQuestionForStep(STEPS.DONE, session)), getQuickReplyForStep(STEPS.DONE));
    }

    // Mid-flow: continue where they left off
    if (session.step !== STEPS.INTENT) {
      return reply(
        event,
        makeText(`Continue: ${currentQuestionForStep(session.step, session)}`),
        getQuickReplyForStep(session.step)
      );
    }

    // Start flow
    return reply(event, makeText('What are you interested in?'), intentQuickReply());
  }

  // Help
  if (/^help$|ช่วยด้วย|ช่วยหน่อย/i.test(userText)) {
    return reply(
      event,
      makeText('I can help you book a consultation. Tap an option below.'),
      intentQuickReply()
    );
  }

  // DONE: allow “Change time”
  if (session.step === STEPS.DONE) {
    if (/^change time$/i.test(userText)) {
      session.step = STEPS.SLOT;
      // keep prior answers; just redo slot + contact if you want later
      return reply(event, makeText('Pick a time slot:'), slotQuickReply());
    }
    // Otherwise keep it simple
    return reply(
      event,
      makeText("You’re already booked (demo). Want to change time or start over?"),
      getQuickReplyForStep(STEPS.DONE)
    );
  }

  switch (session.step) {
    case STEPS.INTENT: {
      const detected = detectIntent(userText);
      const allowed = ['Botox', 'Filler', 'Skin/Facial', 'Anti-aging/Lifting'];

      const picked =
        allowed.find((a) => a.toLowerCase() === userText.toLowerCase()) || detected;

      if (!picked) {
        return reply(event, makeText('What are you interested in?'), intentQuickReply());
      }

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
      return reply(event, makeText('Pick a time slot:'), slotQuickReply());
    }

    case STEPS.SLOT: {
      const slot =
        DEMO_SLOTS.find((s) => s.toLowerCase() === userText.toLowerCase()) ||
        DEMO_SLOTS.find((s) => userText.toLowerCase().includes(s.toLowerCase()));

      if (!slot) {
        return reply(event, makeText('Please pick one of the slots below:'), slotQuickReply());
      }

      session.data.slot = slot;
      session.step = STEPS.CONTACT;

      return reply(event, makeText(currentQuestionForStep(STEPS.CONTACT, session)));
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

function slotQuickReply() {
  return makeQuickReply(DEMO_SLOTS.map((s) => ({ label: s, text: s })));
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
