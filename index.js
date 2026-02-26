import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import { middleware, messagingApi } from '@line/bot-sdk';

// --------------------
// Config
// --------------------
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

// IMPORTANT: rich menu image upload is done via Blob client
const blobClient = new messagingApi.MessagingApiBlobClient({
  channelAccessToken: config.channelAccessToken,
});

const app = express();
const port = process.env.PORT || 3000;

// --------------------
// Session store (in-memory)
// NOTE: Render free tier may restart => sessions reset. That's OK for demo.
// --------------------
const sessions = new Map();

const STEPS = {
  IDLE: 'idle',

  BOOK_SERVICE: 'book_service',
  BOOK_AREA: 'book_area',
  BOOK_BUDGET: 'book_budget',
  BOOK_DAY: 'book_day',
  BOOK_TIME: 'book_time',
  BOOK_CONTACT: 'book_contact',
  BOOK_CONFIRM: 'book_confirm',
};

function getUserId(event) {
  return event.source?.userId || null;
}

function getSession(userId) {
  const s = sessions.get(userId);
  if (s) return s;

  const fresh = {
    welcomed: false,     // one-time welcome flag
    step: STEPS.IDLE,
    data: {
      service: null,
      area: null,
      budget: null,
      day: null,
      time: null,
      name: null,
      phone: null,
    },
    updatedAt: Date.now(),
  };

  sessions.set(userId, fresh);
  return fresh;
}

function resetFlow(session) {
  session.step = STEPS.IDLE;
  session.data = {
    service: null,
    area: null,
    budget: null,
    day: null,
    time: null,
    name: null,
    phone: null,
  };
  session.updatedAt = Date.now();
}

function touch(session) {
  session.updatedAt = Date.now();
}

function normalize(s) {
  return (s || '').trim();
}

function isReset(text) {
  return /^reset$|^start over$|^restart$/i.test(text);
}

function makeText(text) {
  return { type: 'text', text };
}

function makeQuickReply(items) {
  // items: [{label, data}] -> postback pills
  return {
    items: items.map((i) => ({
      type: 'action',
      action: { type: 'postback', label: i.label, data: i.data },
    })),
  };
}

async function reply(event, message, quickReply = null) {
  const m = quickReply ? { ...message, quickReply } : message;
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [m],
  });
}

// --------------------
// One-time welcome message (NO quick replies here)
// --------------------
function welcomeMessage() {
  return (
    `Welcome to our Beauty Clinic 👋\n\n` +
    `Use the menu tiles below to:\n` +
    `• Book an appointment\n` +
    `• Check prices, promotions, or locations\n` +
    `• Talk to staff\n\n` +
    `Tip: Type RESET anytime to start over.`
  );
}

// --------------------
// Tile actions (POSTBACK data)
// --------------------
function parsePostbackData(data) {
  // supports: "action=book" etc
  const out = {};
  (data || '').split('&').forEach((kv) => {
    const [k, v] = kv.split('=');
    if (!k) return;
    out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return out;
}

// --------------------
// Quick reply sets (contextual pills)
// --------------------
function bookingServicePills() {
  return makeQuickReply([
    { label: 'Botox', data: 'action=book_service&value=Botox' },
    { label: 'Filler', data: 'action=book_service&value=Filler' },
    { label: 'HIFU', data: 'action=book_service&value=HIFU' },
    { label: 'Pico / IPL Laser', data: 'action=book_service&value=Pico%20%2F%20IPL%20Laser' },
    { label: 'Thread lift', data: 'action=book_service&value=Thread%20lift' },
    { label: 'Other', data: 'action=book_service&value=Other' },
    { label: '⬅ Back to menu', data: 'action=home' },
  ]);
}

function bookingAreaPills() {
  return makeQuickReply([
    { label: 'Forehead', data: 'action=book_area&value=Forehead' },
    { label: 'Jawline', data: 'action=book_area&value=Jawline' },
    { label: 'Under-eye', data: 'action=book_area&value=Under-eye' },
    { label: 'Lips', data: 'action=book_area&value=Lips' },
    { label: 'Cheeks', data: 'action=book_area&value=Cheeks' },
    { label: 'Full face', data: 'action=book_area&value=Full%20face' },
    { label: 'Other', data: 'action=book_area&value=Other' },
    { label: '⬅ Back', data: 'action=book_back_to_service' },
  ]);
}

function bookingBudgetPills() {
  return makeQuickReply([
    { label: '< 5k THB', data: 'action=book_budget&value=<%205k' },
    { label: '5k–10k THB', data: 'action=book_budget&value=5k-10k' },
    { label: '10k–20k THB', data: 'action=book_budget&value=10k-20k' },
    { label: '20k–40k THB', data: 'action=book_budget&value=20k-40k' },
    { label: '40k+ THB', data: 'action=book_budget&value=40k%2B' },
    { label: 'Other', data: 'action=book_budget&value=Other' },
    { label: '⬅ Back', data: 'action=book_back_to_area' },
  ]);
}

function bookingDayPills() {
  return makeQuickReply([
    { label: 'Mon', data: 'action=book_day&value=Monday' },
    { label: 'Tue', data: 'action=book_day&value=Tuesday' },
    { label: 'Wed', data: 'action=book_day&value=Wednesday' },
    { label: 'Thu', data: 'action=book_day&value=Thursday' },
    { label: 'Fri', data: 'action=book_day&value=Friday' },
    { label: 'Sat', data: 'action=book_day&value=Saturday' },
    { label: 'Sun', data: 'action=book_day&value=Sunday' },
    { label: 'Other', data: 'action=book_day&value=Other' },
    { label: '⬅ Back', data: 'action=book_back_to_budget' },
  ]);
}

function bookingTimePills() {
  return makeQuickReply([
    { label: 'Morning (10–12)', data: 'action=book_time&value=Morning%20(10-12)' },
    { label: 'Afternoon (12–15)', data: 'action=book_time&value=Afternoon%20(12-15)' },
    { label: 'Late (15–18)', data: 'action=book_time&value=Late%20(15-18)' },
    { label: 'Evening (18–20)', data: 'action=book_time&value=Evening%20(18-20)' },
    { label: 'Exact time', data: 'action=book_time&value=Exact' },
    { label: '⬅ Back', data: 'action=book_back_to_day' },
  ]);
}

function faqPills() {
  return makeQuickReply([
    { label: 'Location / Branches', data: 'action=faq&value=location' },
    { label: 'Typical prices', data: 'action=faq&value=prices' },
    { label: 'Promotions', data: 'action=faq&value=promotions' },
    { label: 'Doctor & safety', data: 'action=faq&value=safety' },
    { label: 'Aftercare', data: 'action=faq&value=aftercare' },
    { label: 'Talk to staff', data: 'action=talk_to_staff' },
    { label: '⬅ Back to menu', data: 'action=home' },
  ]);
}

function afterInfoPills() {
  return makeQuickReply([
    { label: 'Book appointment', data: 'action=book' },
    { label: 'Talk to staff', data: 'action=talk_to_staff' },
    { label: '⬅ Back to menu', data: 'action=home' },
  ]);
}

// --------------------
// FAQ answers (demo text)
// --------------------
function faqAnswer(key) {
  switch (key) {
    case 'location':
      return `We operate for clinics in Bangkok.\n\nSend your preferred area/branch and we’ll share the closest options.`;
    case 'prices':
      return `Pricing depends on the treatment + area + units.\n\nTell me what you want (e.g., Botox jawline) and your budget, and I’ll estimate a range.`;
    case 'promotions':
      return `Promotions change weekly.\n\nTell me the treatment you want and your budget and we’ll share what’s available.`;
    case 'safety':
      return `Safety checklist:\n• Certified doctor\n• Authentic product\n• Clear aftercare\n• Transparent pricing\n\nIf you want, tell me the treatment and we’ll advise what to ask.`;
    case 'aftercare':
      return `General aftercare:\n• Avoid alcohol 24h\n• Avoid heavy workout 24h\n• Don’t massage treated area unless instructed\n• Contact staff if unusual swelling/pain`;
    default:
      return `Choose one of the options below.`;
  }
}

// --------------------
// Lead sender (optional)
// --------------------
async function sendLeadToSheet(lead) {
  const url = process.env.LEADS_API_URL;
  if (!url) return;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead),
    });

    const text = await r.text();
    if (!r.ok) console.error('Apps Script error', r.status, text);
  } catch (e) {
    console.error('Failed to send lead to sheet', e);
  }
}

function validatePhone(text) {
  const digits = (text || '').replace(/[^\d+]/g, '');
  if (digits.length < 8) return null;
  return digits;
}

// --------------------
// Webhook handler
// --------------------
async function handleEvent(event) {
  const userId = getUserId(event);
  if (!userId) return;

  const session = getSession(userId);
  touch(session);

  // 1) follow/join => welcome ONCE
  if (event.type === 'follow' || event.type === 'join') {
    if (!session.welcomed) {
      session.welcomed = true;
      resetFlow(session);
      return reply(event, makeText(welcomeMessage())); // no pills
    }
    return;
  }

  // 2) reset via text
  if (event.type === 'message' && event.message?.type === 'text') {
    const text = normalize(event.message.text);

    if (isReset(text)) {
      resetFlow(session);
      return reply(event, makeText('Reset ✅ Use the menu tiles below to start again.'));
    }

    // First text ever (if user didn't "follow" event reach webhook)
    if (!session.welcomed) {
      session.welcomed = true;
      resetFlow(session);
      return reply(event, makeText(welcomeMessage())); // no pills
    }

    // If user types while idle, don’t show pills (tiles only)
    if (session.step === STEPS.IDLE) {
      return reply(
        event,
        makeText('Use the menu tiles below to choose: Booking, Prices, Promotions, Locations, or Talk to staff.')
      );
    }

    // If in booking flow and they typed something, handle the “Other / Exact time / Contact” free-text steps:
    if (session.step === STEPS.BOOK_SERVICE) {
      session.data.service = text;
      session.step = STEPS.BOOK_AREA;
      return reply(event, makeText('Step 2/5 — Which area?'), bookingAreaPills());
    }

    if (session.step === STEPS.BOOK_AREA) {
      session.data.area = text;
      session.step = STEPS.BOOK_BUDGET;
      return reply(event, makeText('Step 3/5 — What is your budget range?'), bookingBudgetPills());
    }

    if (session.step === STEPS.BOOK_BUDGET) {
      session.data.budget = text;
      session.step = STEPS.BOOK_DAY;
      return reply(event, makeText('Step 4/5 — Which day would you like to come?'), bookingDayPills());
    }

    if (session.step === STEPS.BOOK_DAY) {
      session.data.day = text;
      session.step = STEPS.BOOK_TIME;
      return reply(event, makeText('Step 5/5 — What time works best?'), bookingTimePills());
    }

    if (session.step === STEPS.BOOK_TIME) {
      // exact time free text
      session.data.time = text;
      session.step = STEPS.BOOK_CONTACT;
      return reply(event, makeText('Please send: Name, Phone (example: N, 0812345678)'));
    }

    if (session.step === STEPS.BOOK_CONTACT) {
      const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) {
        return reply(event, makeText('Please send: Name, Phone (example: N, 0812345678)'));
      }

      const name = parts[0];
      const phone = validatePhone(parts.slice(1).join(' '));
      if (!phone) {
        return reply(event, makeText('Phone number looks invalid. Please resend (example: N, 0812345678).'));
      }

      session.data.name = name;
      session.data.phone = phone;
      session.step = STEPS.BOOK_CONFIRM;

      const summary =
        `Please confirm your booking:\n\n` +
        `• Service: ${session.data.service}\n` +
        `• Area: ${session.data.area}\n` +
        `• Budget: ${session.data.budget}\n` +
        `• Day: ${session.data.day}\n` +
        `• Time: ${session.data.time}\n` +
        `• Name: ${session.data.name}\n` +
        `• Phone: ${session.data.phone}`;

      const confirmPills = makeQuickReply([
        { label: '✅ Confirm', data: 'action=confirm_booking' },
        { label: '✏️ Edit / Start over', data: 'action=reset' },
      ]);

      return reply(event, makeText(summary), confirmPills);
    }

    if (session.step === STEPS.BOOK_CONFIRM) {
      return reply(
        event,
        makeText('Please confirm using the buttons below.'),
        makeQuickReply([
          { label: '✅ Confirm', data: 'action=confirm_booking' },
          { label: '✏️ Edit / Start over', data: 'action=reset' },
        ])
      );
    }

    return;
  }

  // 3) postback (this is what rich menu tiles should send)
  if (event.type === 'postback') {
    if (!session.welcomed) {
      session.welcomed = true;
      resetFlow(session);
      // Don’t block the action; show welcome once, then continue to action below
      await reply(event, makeText(welcomeMessage()));
    }

    const pb = parsePostbackData(event.postback?.data || '');
    const action = pb.action || '';
    const value = pb.value || '';

    // Global: reset
    if (action === 'reset') {
      resetFlow(session);
      return reply(event, makeText('Reset ✅ Use the menu tiles below to start again.'));
    }

    // Global: home (no pills)
    if (action === 'home') {
      resetFlow(session);
      return reply(event, makeText('Use the menu tiles below to choose what you want.'));
    }

    // ----------------
    // Tiles
    // ----------------
    if (action === 'book') {
      resetFlow(session);
      session.step = STEPS.BOOK_SERVICE;
      return reply(
        event,
        makeText('Booking — step 1/5\nWhat service do you want?'),
        bookingServicePills()
      );
    }

    if (action === 'faq') {
      // show FAQ categories (pills)
      resetFlow(session);
      return reply(event, makeText('Quick questions — choose one:'), faqPills());
    }

    if (action === 'prices') {
      resetFlow(session);
      return reply(event, makeText(faqAnswer('prices')), afterInfoPills());
    }

    if (action === 'promotions') {
      resetFlow(session);
      return reply(event, makeText(faqAnswer('promotions')), afterInfoPills());
    }

    if (action === 'location') {
      resetFlow(session);
      return reply(event, makeText(faqAnswer('location')), afterInfoPills());
    }

    if (action === 'talk_to_staff') {
      resetFlow(session);
      session.step = STEPS.BOOK_CONTACT; // reuse contact step
      session.data.service = 'Talk to staff';
      session.data.area = '-';
      session.data.budget = '-';
      session.data.day = '-';
      session.data.time = '-';
      return reply(event, makeText('Please send: Name, Phone (example: N, 0812345678)'));
    }

    // ----------------
    // Booking flow via pills
    // ----------------
    if (action === 'book_service') {
      session.data.service = value || 'Other';
      session.step = STEPS.BOOK_AREA;
      if (value === 'Other') {
        return reply(event, makeText('Please type the service you want (e.g., HIFU / Pico laser / Thread lift).'));
      }
      return reply(event, makeText('Step 2/5 — Which area?'), bookingAreaPills());
    }

    if (action === 'book_area') {
      session.data.area = value || 'Other';
      session.step = STEPS.BOOK_BUDGET;
      if (value === 'Other') {
        return reply(event, makeText('Please type the area (e.g., cheeks, nose, under-eye, full face).'));
      }
      return reply(event, makeText('Step 3/5 — What is your budget range?'), bookingBudgetPills());
    }

    if (action === 'book_budget') {
      session.data.budget = value || 'Other';
      session.step = STEPS.BOOK_DAY;
      if (value === 'Other') {
        return reply(event, makeText('Please type your budget (e.g., 12,000 THB or “under 20k”).'));
      }
      return reply(event, makeText('Step 4/5 — Which day would you like to come?'), bookingDayPills());
    }

    if (action === 'book_day') {
      session.data.day = value || 'Other';
      session.step = STEPS.BOOK_TIME;
      if (value === 'Other') {
        return reply(event, makeText('Please type your preferred day/date (e.g., “Friday” or “Mar 7”).'));
      }
      return reply(event, makeText('Step 5/5 — What time works best?'), bookingTimePills());
    }

    if (action === 'book_time') {
      session.data.time = value || 'Exact';
      session.step = STEPS.BOOK_CONTACT;
      if (value === 'Exact') {
        // capture exact time via text
        session.step = STEPS.BOOK_TIME;
        return reply(event, makeText('Please type your preferred time (e.g., 3:30pm).'));
      }
      return reply(event, makeText('Please send: Name, Phone (example: N, 0812345678)'));
    }

    // Booking back buttons
    if (action === 'book_back_to_service') {
      session.step = STEPS.BOOK_SERVICE;
      return reply(event, makeText('Booking — step 1/5\nWhat service do you want?'), bookingServicePills());
    }
    if (action === 'book_back_to_area') {
      session.step = STEPS.BOOK_AREA;
      return reply(event, makeText('Step 2/5 — Which area?'), bookingAreaPills());
    }
    if (action === 'book_back_to_budget') {
      session.step = STEPS.BOOK_BUDGET;
      return reply(event, makeText('Step 3/5 — What is your budget range?'), bookingBudgetPills());
    }
    if (action === 'book_back_to_day') {
      session.step = STEPS.BOOK_DAY;
      return reply(event, makeText('Step 4/5 — Which day would you like to come?'), bookingDayPills());
    }

    // FAQ answer pills
    if (action === 'faq') {
      const ans = faqAnswer(value);
      return reply(event, makeText(ans), afterInfoPills());
    }

    // Confirm booking
    if (action === 'confirm_booking') {
      // Send to sheet (optional)
      await sendLeadToSheet({
        ts: new Date().toISOString(),
        userId,
        service: session.data.service || '-',
        area: session.data.area || '-',
        budget: session.data.budget || '-',
        day: session.data.day || '-',
        time: session.data.time || '-',
        name: session.data.name || '-',
        phone: session.data.phone || '-',
        source: 'line',
      });

      resetFlow(session);
      return reply(event, makeText('Booked ✅ We’ll contact you shortly.\n\nUse the menu tiles below anytime.'));
    }

    return;
  }
}

// --------------------
// Express routes
// --------------------
app.get('/', (_, res) => res.send('OK'));

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
// Create rich menu (protected)
// Call once:
// https://YOUR-RENDER-URL/create-rich-menu?key=YOUR_ADMIN_KEY
// --------------------
app.get('/create-rich-menu', async (req, res) => {
  try {
    const adminKey = process.env.ADMIN_KEY || '';
    const key = (req.query.key || '').toString();

    if (!adminKey || key !== adminKey) {
      return res.status(401).send('Unauthorized');
    }

    // Image is 2500 x 1686 (3 columns x 2 rows)
    // widths: 833 + 833 + 834 = 2500
    // heights: 843 + 843 = 1686
    const W1 = 833, W2 = 833, W3 = 834;
    const H = 843;

    const richMenu = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'Beauty Clinic Menu',
      chatBarText: 'Menu',
      areas: [
        // Row 1
        { bounds: { x: 0, y: 0, width: W1, height: H }, action: { type: 'postback', data: 'action=book' } },
        { bounds: { x: W1, y: 0, width: W2, height: H }, action: { type: 'postback', data: 'action=faq' } },
        { bounds: { x: W1 + W2, y: 0, width: W3, height: H }, action: { type: 'postback', data: 'action=prices' } },

        // Row 2
        { bounds: { x: 0, y: H, width: W1, height: H }, action: { type: 'postback', data: 'action=promotions' } },
        { bounds: { x: W1, y: H, width: W2, height: H }, action: { type: 'postback', data: 'action=location' } },
        { bounds: { x: W1 + W2, y: H, width: W3, height: H }, action: { type: 'postback', data: 'action=talk_to_staff' } },
      ],
    };

    const created = await client.createRichMenu({ richMenu });
    const richMenuId = created.richMenuId;

    // Upload image
    const image = fs.readFileSync('./richmenu.png');
    await blobClient.setRichMenuImage(richMenuId, 'image/png', image);

    // Set default
    await client.setDefaultRichMenu({ richMenuId });

    res.send(`✅ Rich menu created + default set. ID: ${richMenuId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`❌ Error creating rich menu: ${err.message}`);
  }
});

app.listen(port, () => console.log(`LINE bot running on port ${port}`));
