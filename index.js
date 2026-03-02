import "dotenv/config";
import express from "express";
import { middleware, Client } from "@line/bot-sdk";

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

const CLINIC_NAME = (process.env.CLINIC_NAME || "Lumière Aesthetic Clinic").trim();
const DEFAULT_RICHMENU_ID = (process.env.DEFAULT_RICHMENU_ID || "").trim();

const client = new Client(config);
const app = express();

// --------------------
// Demo Config (Option B)
// --------------------
const DEMO = {
  branches: ["Sukhumvit", "Thonglor", "Siam"],
  services: ["Botox", "Filler", "HIFU", "Pico laser", "Thread lift", "Other"],
  days: ["Today", "Tomorrow", "This weekend", "Next week", "Other"],
  times: ["Morning", "Afternoon", "Evening", "Other"],
};

// --------------------
// Health check
// --------------------
app.get("/", (_, res) => res.send("OK"));

// --------------------
// Session store (in-memory)
// --------------------
const sessions = new Map();

const STEPS = {
  IDLE: "idle",
  BOOK_SERVICE: "book_service",
  BOOK_BRANCH: "book_branch",
  BOOK_DAY: "book_day",
  BOOK_TIME: "book_time",
  BOOK_CONTACT: "book_contact",
  BOOK_REVIEW: "book_review",
  FAQ_MENU: "faq_menu",
};

function normalize(s) {
  return (s || "").trim();
}

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
      branch: null,
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

function resetSession(userId) {
  sessions.set(userId, {
    step: STEPS.IDLE,
    data: {
      service: null,
      branch: null,
      day: null,
      time: null,
      name: null,
      phone: null,
    },
    updatedAt: Date.now(),
  });
}

function touch(session) {
  session.updatedAt = Date.now();
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

  // Fallback if some tiles are "message" actions (still handle)
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

// Parse "name + phone" with or without comma
function parseNameAndPhone(raw) {
  const text = normalize(raw);
  const match = text.match(/(\+?\d[\d\s().-]{6,}\d)/);
  if (!match) return null;

  const phoneCandidate = match[1];
  const phone = validatePhone(phoneCandidate);
  if (!phone) return null;

  let name = text.replace(phoneCandidate, " ").trim();
  name = name.replace(/\s{2,}/g, " ");
  name = name.replace(/^[,;:\-–—]+/, "").replace(/[,;:\-–—]+$/, "").trim();

  return { name: name || null, phone };
}

function looksLikePhoneMessage(text) {
  return /(\+?\d[\d\s().-]{6,}\d)/.test(text || "");
}

// --------------------
// Content
// --------------------
const FAQ_ANSWER = {
  prices:
    "Typical prices (demo):\n" +
    "• Botox: 3,500–12,000 THB\n" +
    "• Filler: 9,900–25,000 THB / cc\n" +
    "• HIFU: 5,900–29,000 THB\n" +
    "• Pico laser: 1,500–6,000 THB\n\n" +
    "Want to book? Tap “Book appointment”.",
  promo:
    "Promotions change weekly (demo).\n" +
    "Tell us what treatment you want and we’ll share what’s available.",
  staff:
    "Ask me anything about treatments or pricing — or book an appointment.",
};

// --------------------
// Quick replies
// --------------------
function qrAfterInfo() {
  return makeQuickReply([
    { label: "Book appointment", text: "Book appointment" },
    { label: "Back to menu", text: "Back to menu" },
  ]);
}

function qrFaqMenu() {
  return makeQuickReply([
    { label: "Prices", text: "Prices" },
    { label: "Promotions", text: "Promotions" },
    { label: "Location / Branches", text: "Location / Branches" },
    { label: "Talk to staff", text: "Talk to staff" },
    { label: "Back to menu", text: "Back to menu" },
  ]);
}

function qrList(labelList) {
  return makeQuickReply(labelList.map((x) => ({ label: x, text: x })));
}

function qrConfirm() {
  return makeQuickReply([
    { label: "Confirm", text: "CONFIRM" },
    { label: "Edit", text: "EDIT" },
    { label: "Back to menu", text: "Back to menu" },
  ]);
}

// --------------------
// Lead sender (Google Sheets)
// --------------------
async function getFetch() {
  if (typeof fetch === "function") return fetch; // Node 18+
  const mod = await import("node-fetch"); // fallback
  return mod.default;
}

async function sendLeadToSheet(lead) {
  const url = (process.env.LEADS_API_URL || "").trim();
  if (!url) {
    console.error("LEADS_API_URL missing");
    return false;
  }

  try {
    const _fetch = await getFetch();
    const r = await _fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
    });

    const text = await r.text().catch(() => "");
    console.log("SHEETS STATUS:", r.status, "BODY:", text);
    return r.ok;
  } catch (e) {
    console.error("Failed to send lead:", e?.message || e);
    return false;
  }
}

// --------------------
// Webhook
// --------------------
app.post("/webhook", middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error("Webhook error:", err?.message || err);
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

  // Welcome + link menu on follow/join
  if (event.type === "follow" || event.type === "join") {
    resetSession(userId);

    if (DEFAULT_RICHMENU_ID) {
      try {
        await client.linkRichMenuToUser(userId, DEFAULT_RICHMENU_ID);
      } catch (e) {
        console.error("Failed to link rich menu:", e?.message || e);
      }
    }

    return reply(event, [
      makeText(`Welcome to ${CLINIC_NAME} ✨`),
      makeText("I can help you request an appointment in under a minute."),
      makeText("Tap the menu below to get started."),
    ]);
  }

  const textRaw = getEventText(event);
  if (!textRaw) return;

  if (isReset(textRaw)) {
    resetSession(userId);
    return replyOne(event, makeText("Reset ✅ Tap the menu below to start again."));
  }

  if (/^back to menu$/i.test(textRaw)) {
    session.step = STEPS.IDLE;
    return replyOne(event, makeText("OK ✅ Tap the menu below."));
  }

  // Route rich menu actions
  const action = parseAction(textRaw);
  if (action) {
    // Never carry booking state across tiles unless you intend it
    if (action === "book") {
      session.step = STEPS.BOOK_SERVICE;
      session.data = { service: null, branch: null, day: null, time: null, name: null, phone: null };

      return replyOne(
        event,
        makeText("Book your visit\nWhat treatment are you interested in today?"),
        qrList([...DEMO.services, "Back to menu"])
      );
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
      return replyOne(
        event,
        makeText(`Branches (demo):\n• ${DEMO.branches.join("\n• ")}`),
        qrAfterInfo()
      );
    }

    if (action === "staff") {
      session.step = STEPS.IDLE;
      return replyOne(event, makeText(FAQ_ANSWER.staff), qrAfterInfo());
    }
  }

  // FAQ menu routing via messages
  if (session.step === STEPS.FAQ_MENU) {
    const t = textRaw.toLowerCase();
    if (t === "prices" || t === "typical prices") {
      session.step = STEPS.IDLE;
      return replyOne(event, makeText(FAQ_ANSWER.prices), qrAfterInfo());
    }
    if (t === "promotions") {
      session.step = STEPS.IDLE;
      return replyOne(event, makeText(FAQ_ANSWER.promo), qrAfterInfo());
    }
    if (t === "location / branches" || t === "location" || t === "branches") {
      session.step = STEPS.IDLE;
      return replyOne(
        event,
        makeText(`Branches (demo):\n• ${DEMO.branches.join("\n• ")}`),
        qrAfterInfo()
      );
    }
    if (t === "talk to staff") {
      session.step = STEPS.IDLE;
      return replyOne(event, makeText(FAQ_ANSWER.staff), qrAfterInfo());
    }
    if (t === "back to menu") {
      session.step = STEPS.IDLE;
      return replyOne(event, makeText("OK ✅ Tap the menu below."));
    }

    return replyOne(event, makeText("Choose one of the quick questions below."), qrFaqMenu());
  }

  // --------------------
  // Booking flow
  // --------------------
  if (session.step === STEPS.BOOK_SERVICE) {
    session.data.service = textRaw;
    session.step = STEPS.BOOK_BRANCH;

    return replyOne(
      event,
      makeText("Choose your location\nPlease select your preferred branch below."),
      qrList([...DEMO.branches, "Back to menu"])
    );
  }

  if (session.step === STEPS.BOOK_BRANCH) {
    session.data.branch = textRaw;
    session.step = STEPS.BOOK_DAY;

    return replyOne(
      event,
      makeText("Select a day\nWhen would you like to come in?"),
      qrList([...DEMO.days, "Back to menu"])
    );
  }

  if (session.step === STEPS.BOOK_DAY) {
    session.data.day = textRaw;
    session.step = STEPS.BOOK_TIME;

    return replyOne(
      event,
      makeText("Preferred time\nWhat time of day works best?"),
      qrList([...DEMO.times, "Back to menu"])
    );
  }

  if (session.step === STEPS.BOOK_TIME) {
    session.data.time = textRaw;
    session.step = STEPS.BOOK_CONTACT;

    return replyOne(
      event,
      makeText(
        "Your contact details\nPlease send your name + phone number.\nExample: Nathalie 0812345678"
      )
    );
  }

  if (session.step === STEPS.BOOK_CONTACT) {
    // If phone already stored but name missing => accept name-only
    if (session.data.phone && !session.data.name) {
      const nameOnly = normalize(textRaw);
      if (!nameOnly || looksLikePhoneMessage(nameOnly)) {
        return replyOne(event, makeText("Now send your name only (example: Nathalie)"));
      }
      session.data.name = nameOnly;
      session.step = STEPS.BOOK_REVIEW;
      return sendReview(event, session, userId);
    }

    // Normal parse: name + phone
    const parsed = parseNameAndPhone(textRaw);
    if (!parsed) {
      return replyOne(event, makeText("Please send: Name + Phone (example: Nathalie 0812345678)"));
    }

    // Phone-only
    if (!parsed.name) {
      session.data.phone = parsed.phone;
      session.data.name = null;
      return replyOne(event, makeText("Got your phone ✅ Now send your name only (example: Nathalie)"));
    }

    session.data.name = parsed.name;
    session.data.phone = parsed.phone;
    session.step = STEPS.BOOK_REVIEW;
    return sendReview(event, session, userId);
  }

  if (session.step === STEPS.BOOK_REVIEW) {
    if (/^confirm$/i.test(textRaw)) {
      const lead = {
        ts_iso: new Date().toISOString(),
        userId,
        clinic: CLINIC_NAME,
        service: session.data.service || "-",
        branch: session.data.branch || "-",
        day: session.data.day || "-",
        time: session.data.time || "-",
        name: session.data.name || "-",
        phone: session.data.phone || "-",
        source: "line",
        version: process.env.BOT_VERSION || "demo-v1",
      };

      const ok = await sendLeadToSheet(lead);

      // Two-message confirmation
      const msg1 =
        `My booking at ${CLINIC_NAME}\n\n` +
        `🗓 ${session.data.day || "-"}, ${session.data.time || "-"}\n` +
        `💉 ${session.data.service || "-"}\n` +
        `📍 ${session.data.branch || "-"}\n\n` +
        `👤 ${session.data.name || "-"}\n` +
        `📞 ${session.data.phone || "-"}`;

      const msg2 = ok
        ? `✅ Request received\nThe ${session.data.branch || "clinic"} team will contact you shortly to confirm the exact time.`
        : `✅ Request received\n(But the sheet write failed — check logs / Apps Script permissions.)`;

      resetSession(userId);
      return reply(event, [makeText(msg1), makeText(msg2)]);
    }

    if (/^edit$/i.test(textRaw)) {
      // restart booking cleanly
      session.step = STEPS.BOOK_SERVICE;
      session.data = { service: null, branch: null, day: null, time: null, name: null, phone: null };

      return replyOne(
        event,
        makeText("No problem — let’s start again.\nWhat treatment are you interested in today?"),
        qrList([...DEMO.services, "Back to menu"])
      );
    }

    return replyOne(event, makeText("Please tap Confirm or Edit."), qrConfirm());
  }

  // Default fallback
  return replyOne(event, makeText("Tap the menu below to continue."));
}

async function sendReview(event, session) {
  const summary =
    `Review your booking\n\n` +
    `Clinic: ${CLINIC_NAME}\n` +
    `Service: ${session.data.service || "-"}\n` +
    `Branch: ${session.data.branch || "-"}\n` +
    `Day: ${session.data.day || "-"}\n` +
    `Time: ${session.data.time || "-"}\n` +
    `Name: ${session.data.name || "-"}\n` +
    `Phone: ${session.data.phone || "-"}\n\n` +
    `Confirm or Edit?`;

  return replyOne(event, makeText(summary), qrConfirm());
}

// --------------------
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LINE bot running on port ${port}`));
