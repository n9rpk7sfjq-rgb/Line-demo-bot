import "dotenv/config";
import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import path from "path";
import { fileURLToPath } from "url";

// --------------------
// ESM __dirname
// --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --------------------
// Config
// --------------------
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

if (!config.channelAccessToken || !config.channelSecret) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET");
}

// ✅ Classic Client
const client = new Client(config);

const app = express();

// Health check
app.get("/", (_, res) => res.send("OK"));

// --------------------
// Session store (in-memory)
// --------------------
const sessions = new Map();

const STEPS = {
  IDLE: "idle",

  BOOK_SERVICE: "book_service",
  BOOK_AREA: "book_area",
  BOOK_BUDGET: "book_budget",
  BOOK_DAY: "book_day",
  BOOK_TIME: "book_time",
  BOOK_CONTACT: "book_contact",
  BOOK_CONFIRM: "book_confirm",

  FAQ_MENU: "faq_menu",
  WAIT_LOCATION_TEXT: "wait_location_text",
};

function getUserId(event) {
  return event.source?.userId || null;
}

function getSession(userId) {
  const s = sessions.get(userId);
  if (s) return s;

  const fresh = {
    step: STEPS.IDLE,
    data: {
      service: null,
      serviceChosen: null,
      area: null,
      budget: null,
      day: null,
      time: null,
      name: null,
      phone: null,
      lastTile: null,
      welcomed: false,
    },
    updatedAt: Date.now(),
  };
  sessions.set(userId, fresh);
  return fresh;
}

function resetSession(userId) {
  sessions.set(userId, {
    step: STEPS.IDLE,
    data: {
      service: null,
      serviceChosen: null,
      area: null,
      budget: null,
      day: null,
      time: null,
      name: null,
      phone: null,
      lastTile: null,
      welcomed: false,
    },
    updatedAt: Date.now(),
  });
}

function touch(session) {
  session.updatedAt = Date.now();
}

function normalize(s) {
  return (s || "").trim();
}

// --------------------
// Messaging helpers
// --------------------
function makeText(text) {
  return { type: "text", text };
}

function makeQuickReply(items) {
  return {
    items: items.map((i) => ({
      type: "action",
      action: { type: "message", label: i.label, text: i.text },
    })),
  };
}

async function reply(event, messages) {
  return client.replyMessage(event.replyToken, messages);
}

async function replyOne(event, message, quickReply = null) {
  const m = quickReply ? { ...message, quickReply } : message;
  return reply(event, [m]);
}

// --------------------
// Input extraction
// --------------------
function getEventText(event) {
  if (event.type === "message" && event.message?.type === "text") {
    return normalize(event.message.text);
  }
  if (event.type === "postback") {
    return normalize(event.postback?.data || "");
  }
  return "";
}

function parseAction(raw) {
  const s = (raw || "").trim();
  if (s.startsWith("action=")) return s.slice("action=".length).toLowerCase();

  const t = s.toLowerCase();
  if (t === "book appointment" || t === "book an appointment" || t === "book") return "book";
  if (t === "quick questions" || t === "faq") return "faq";
  if (t === "prices" || t === "typical prices") return "prices";
  if (t === "promotions" || t === "promo") return "promo";
  if (t === "location / branches" || t === "location" || t === "branches") return "location";
  if (t === "talk to staff" || t === "staff") return "staff";
  return null;
}

function isReset(text) {
  return /^reset$|^start over$|^restart$/i.test(text || "");
}

function validatePhone(text) {
  const digits = (text || "").replace(/[^\d+]/g, "");
  if (digits.length < 8) return null;
  return digits;
}

// ✅ parse "name + phone" even without comma
function parseNameAndPhone(raw) {
  const text = normalize(raw);

  // Find a phone-like chunk anywhere
  const match = text.match(/(\+?\d[\d\s().-]{6,}\d)/);
  if (!match) return null;

  const phoneCandidate = match[1];
  const phone = validatePhone(phoneCandidate);
  if (!phone) return null;

  // Everything except the phone becomes name
  let name = text.replace(phoneCandidate, " ").trim();
  name = name.replace(/\s{2,}/g, " ");
  name = name.replace(/^[,;:\-–—]+/, "").replace(/[,;:\-–—]+$/, "").trim();

  if (!name) return { name: null, phone };

  return { name, phone };
}

// --------------------
// Welcome
// --------------------
const WELCOME_1 = "Welcome to Beauty Clinics ✨";
const WELCOME_2 =
  "We’re here to make your beauty journey easy — from booking treatments to finding the right clinic for you.";
const WELCOME_3 = "Tap a menu tile below to get started.";

// --------------------
// Demo content
// --------------------
const FAQ_ANSWER = {
  prices:
    "Typical prices (demo):\n" +
    "• Botox: 3,500–12,000 THB\n" +
    "• Filler: 9,900–25,000 THB / cc\n" +
    "• HIFU: 5,900–29,000 THB\n" +
    "• Pico laser: 1,500–6,000 THB\n\n" +
    "Want something specific? Tap “Book appointment” or “Talk to staff”.",
  promo:
    "Promotions change weekly (demo).\n" +
    "Tell staff what treatment you want + your budget, and they’ll share what’s available.",
};

const BRANCHES = {
  bangkok: [
    { name: "Sukhumvit", maps: "https://maps.google.com/?q=Sukhumvit+Bangkok" },
    { name: "Thonglor", maps: "https://maps.google.com/?q=Thonglor+Bangkok" },
    { name: "Siam", maps: "https://maps.google.com/?q=Siam+Bangkok" },
  ],
  phuket: [{ name: "Phuket – Central", maps: "https://maps.google.com/?q=Central+Phuket" }],
  samui: [{ name: "Samui – Chaweng", maps: "https://maps.google.com/?q=Chaweng+Koh+Samui" }],
};

// --------------------
// Quick replies
// --------------------
function qrAfterInfo() {
  return makeQuickReply([
    { label: "Book appointment", text: "Book appointment" },
    { label: "Talk to staff", text: "Talk to staff" },
    { label: "Back to menu", text: "Back to menu" },
  ]);
}

function qrFaqMenu() {
  return makeQuickReply([
    { label: "Typical prices", text: "Typical prices" },
    { label: "Promotions", text: "Promotions" },
    { label: "Location / Branches", text: "Location / Branches" },
    { label: "Talk to staff", text: "Talk to staff" },
    { label: "Back to menu", text: "Back to menu" },
  ]);
}

function qrLocationCities() {
  return makeQuickReply([
    { label: "Bangkok", text: "Bangkok" },
    { label: "Phuket", text: "Phuket" },
    { label: "Samui", text: "Samui" },
    { label: "Other", text: "Other" },
    { label: "Back to menu", text: "Back to menu" },
  ]);
}

function qrBookingService() {
  return makeQuickReply([
    { label: "Botox", text: "Botox" },
    { label: "Filler", text: "Filler" },
    { label: "HIFU", text: "HIFU" },
    { label: "Pico laser", text: "Pico laser" },
    { label: "Thread lift", text: "Thread lift" },
    { label: "Other", text: "Other" },
    { label: "Back to menu", text: "Back to menu" },
  ]);
}

function qrBookingArea() {
  return makeQuickReply([
    { label: "Full face", text: "Full face" },
    { label: "Under-eye", text: "Under-eye" },
    { label: "Jawline", text: "Jawline" },
    { label: "Cheeks", text: "Cheeks" },
    { label: "Lips", text: "Lips" },
    { label: "Other", text: "Other" },
    { label: "Back to menu", text: "Back to menu" },
  ]);
}

function qrBookingBudget() {
  return makeQuickReply([
    { label: "< 5k", text: "< 5k" },
    { label: "5k–10k", text: "5k–10k" },
    { label: "10k–20k", text: "10k–20k" },
    { label: "20k–40k", text: "20k–40k" },
    { label: "40k+", text: "40k+" },
    { label: "Other", text: "Other" },
    { label: "Back to menu", text: "Back to menu" },
  ]);
}

function qrBookingDay() {
  return makeQuickReply([
    { label: "Today", text: "Today" },
    { label: "Tomorrow", text: "Tomorrow" },
    { label: "This weekend", text: "This weekend" },
    { label: "Next week", text: "Next week" },
    { label: "Other", text: "Other" },
    { label: "Back to menu", text: "Back to menu" },
  ]);
}

function qrBookingTime() {
  return makeQuickReply([
    { label: "Morning", text: "Morning" },
    { label: "Afternoon", text: "Afternoon" },
    { label: "Evening", text: "Evening" },
    { label: "Other", text: "Other" },
    { label: "Back to menu", text: "Back to menu" },
  ]);
}

function qrConfirm() {
  return makeQuickReply([
    { label: "YES", text: "YES" },
    { label: "EDIT", text: "EDIT" },
    { label: "Back to menu", text: "Back to menu" },
  ]);
}

// --------------------
// Lead sender (Google Sheets)
// --------------------
async function sendLeadToSheet(lead) {
  const url = process.env.LEADS_API_URL;
  if (!url) {
    console.error("LEADS_API_URL missing");
    return;
  }

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
    });

    const text = await r.text();
    if (!r.ok) console.error("Apps Script error", r.status, text);
  } catch (e) {
    console.error("Failed to send lead", e);
  }
}

// --------------------
// Webhook (IMPORTANT: do NOT add express.json() before this)
// --------------------
app.post("/webhook", middleware(config), async (req, res) => {
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
// Core handler
// --------------------
async function handleEvent(event) {
  const userId = getUserId(event);
  if (!userId) return;

  const session = getSession(userId);
  touch(session);

  // Welcome ONLY on follow/join
  if (event.type === "follow" || event.type === "join") {
    resetSession(userId);
    const s = getSession(userId);
    s.step = STEPS.IDLE;
    s.data.welcomed = true;

    // Link rich menu instantly if set
    const richMenuId = (process.env.DEFAULT_RICHMENU_ID || "").trim();
    if (richMenuId) {
      try {
        await client.linkRichMenuToUser(userId, richMenuId);
      } catch (e) {
        console.error("Failed to link rich menu to user", e?.message || e);
      }
    }

    return reply(event, [makeText(WELCOME_1), makeText(WELCOME_2), makeText(WELCOME_3)]);
  }

  const textRaw = getEventText(event);
  if (!textRaw) return;

  if (isReset(textRaw)) {
    resetSession(userId);
    const s = getSession(userId);
    s.data.welcomed = true;
    return replyOne(event, makeText("Reset ✅ Use the menu tiles below."));
  }

  if (/^back to menu$/i.test(textRaw)) {
    session.step = STEPS.IDLE;
    return replyOne(event, makeText("OK ✅ Use the menu tiles below."));
  }

  const action = parseAction(textRaw);
  if (action) {
    session.data.lastTile = action;

    if (action === "book") {
      session.step = STEPS.BOOK_SERVICE;
      return replyOne(event, makeText("Booking — step 1/5\nWhat service do you want?"), qrBookingService());
    }

    if (action === "faq") {
      session.step = STEPS.FAQ_MENU;
      return replyOne(event, makeText("Quick questions — choose one:"), qrFaqMenu());
    }

    if (action === "prices") {
      session.step = STEPS.IDLE;
      return replyOne(event, makeText(FAQ_ANSWER.prices), qrAfterInfo());
    }

    if (action === "promo") {
      session.step = STEPS.IDLE;
      return replyOne(event, makeText(FAQ_ANSWER.promo), qrAfterInfo());
    }

    if (action === "location") {
      session.step = STEPS.IDLE;
      return replyOne(event, makeText("Locations — choose a city:"), qrLocationCities());
    }

    if (action === "staff") {
      session.step = STEPS.BOOK_CONTACT;
      session.data.service = "Talk to staff";
      session.data.serviceChosen = "Talk to staff";
      session.data.area = "-";
      session.data.budget = "-";
      session.data.day = "-";
      session.data.time = "-";
      return replyOne(event, makeText("Please send your name + phone.\nExamples:\n• N 0812345678\n• N, 0812345678\n• N: 0812345678"));
    }
  }

  // Location city handling
  if (/^bangkok$|^phuket$|^samui$|^other$/i.test(textRaw)) {
    const t = textRaw.toLowerCase();

    if (t === "other") {
      session.step = STEPS.WAIT_LOCATION_TEXT;
      return replyOne(event, makeText("Which city/area are you looking for? (Type it)"));
    }

    const list = BRANCHES[t] || [];
    const lines = list.map((b, i) => `${i + 1}) ${b.name}\n${b.maps}`).join("\n\n");

    session.step = STEPS.IDLE;
    return replyOne(
      event,
      makeText(`Branches in ${textRaw} (demo):\n\n${lines}\n\nWant to book or talk to staff?`),
      qrAfterInfo()
    );
  }

  if (session.step === STEPS.WAIT_LOCATION_TEXT) {
    const city = normalize(textRaw);
    session.step = STEPS.IDLE;
    return replyOne(event, makeText(`Got it — ${city}.\nStaff will confirm the closest branch.`), qrAfterInfo());
  }

  // Booking flow
  if (session.step === STEPS.BOOK_SERVICE) {
    session.data.service = textRaw;
    session.data.serviceChosen = textRaw;
    session.step = STEPS.BOOK_AREA;
    return replyOne(event, makeText("Booking — step 2/5\nWhich area?"), qrBookingArea());
  }

  if (session.step === STEPS.BOOK_AREA) {
    session.data.area = textRaw;
    session.step = STEPS.BOOK_BUDGET;
    return replyOne(event, makeText("Booking — step 3/5\nWhat is your budget?"), qrBookingBudget());
  }

  if (session.step === STEPS.BOOK_BUDGET) {
    session.data.budget = textRaw;
    session.step = STEPS.BOOK_DAY;
    return replyOne(event, makeText("Booking — step 4/5\nWhich day?"), qrBookingDay());
  }

  if (session.step === STEPS.BOOK_DAY) {
    session.data.day = textRaw;
    session.step = STEPS.BOOK_TIME;
    return replyOne(event, makeText("Booking — step 5/5\nWhich time?"), qrBookingTime());
  }

  if (session.step === STEPS.BOOK_TIME) {
    session.data.time = textRaw;
    session.step = STEPS.BOOK_CONTACT;
    return replyOne(
      event,
makeText("Please send your name + phone. Example: N 0812345678")    );
  }

  // ✅ FIXED: single BOOK_CONTACT handler (no duplicate logic)
  if (session.step === STEPS.BOOK_CONTACT) {
    // If we already have phone but missing name: treat this message as name-only
    if (session.data.phone && !session.data.name) {
      const nameOnly = normalize(textRaw);
      // reject if it's still a phone-like message
      if (nameOnly && !/(\+?\d[\d\s().-]{6,}\d)/.test(nameOnly)) {
        session.data.name = nameOnly;
        session.step = STEPS.BOOK_CONFIRM;

        const summary =
          `Please confirm:\n\n` +
          `• Service: ${session.data.serviceChosen || session.data.service || "-"}\n` +
          `• Area: ${session.data.area || "-"}\n` +
          `• Budget: ${session.data.budget || "-"}\n` +
          `• Day: ${session.data.day || "-"}\n` +
          `• Time: ${session.data.time || "-"}\n` +
          `• Name: ${session.data.name || "-"}\n` +
          `• Phone: ${session.data.phone || "-"}\n\nYES / EDIT`;

        return replyOne(event, makeText(summary), qrConfirm());
      }

      return replyOne(event, makeText("Now send your name only (example: N)"));
    }

    // Normal case: parse name+phone in one message
    const parsed = parseNameAndPhone(textRaw);

    if (!parsed) {
      return replyOne(
        event,
        makeText("Please send your name + phone.\nExamples:\n• N 0812345678\n• N, 0812345678\n• N: 0812345678")
      );
    }

    // Phone-only -> ask for name next
    if (!parsed.name) {
      session.data.phone = parsed.phone;
      session.data.name = null;
      return replyOne(event, makeText("Got your phone ✅ Now send your name only (example: N)"));
    }

    session.data.name = parsed.name;
    session.data.phone = parsed.phone;

    session.step = STEPS.BOOK_CONFIRM;

    const summary =
      `Please confirm:\n\n` +
      `• Service: ${session.data.serviceChosen || session.data.service || "-"}\n` +
      `• Area: ${session.data.area || "-"}\n` +
      `• Budget: ${session.data.budget || "-"}\n` +
      `• Day: ${session.data.day || "-"}\n` +
      `• Time: ${session.data.time || "-"}\n` +
      `• Name: ${session.data.name || "-"}\n` +
      `• Phone: ${session.data.phone || "-"}\n\nYES / EDIT`;

    return replyOne(event, makeText(summary), qrConfirm());
  }

  if (session.step === STEPS.BOOK_CONFIRM) {
    if (/^yes$/i.test(textRaw)) {
      const serviceFinal = String(session.data.serviceChosen || session.data.service || "-").trim() || "-";

      const lead = {
        ts_iso: new Date().toISOString(),
        userId,
        service: serviceFinal,
        area: session.data.area || "-",
        budget: session.data.budget || "-",
        day: session.data.day || "-",
        time: session.data.time || "-",
        name: session.data.name || "-",
        phone: session.data.phone || "-",
        source: "line",
      };

      await sendLeadToSheet(lead);

      session.step = STEPS.IDLE;
      return replyOne(event, makeText("Booked (demo) ✅ Staff will contact you shortly."), qrAfterInfo());
    }

    if (/^edit$/i.test(textRaw)) {
      session.data.service = null;
      session.data.serviceChosen = null;
      session.data.area = null;
      session.data.budget = null;
      session.data.day = null;
      session.data.time = null;
      session.data.name = null;
      session.data.phone = null;

      session.step = STEPS.BOOK_SERVICE;
      return replyOne(event, makeText("Booking — step 1/5\nWhat service do you want?"), qrBookingService());
    }

    return replyOne(event, makeText("Please choose YES or EDIT."), qrConfirm());
  }

  return replyOne(event, makeText("Use the menu tiles below to continue."));
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LINE bot running on port ${port}`));
