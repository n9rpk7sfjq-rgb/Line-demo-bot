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
  // Don’t hard-exit in Render; logs help you see it.
}

const CLINIC_NAME = (process.env.CLINIC_NAME || "Lumière Aesthetic Clinic").trim();
const DEFAULT_RICHMENU_ID = (process.env.DEFAULT_RICHMENU_ID || "").trim();

// Optional demo-friendly contact info
const CLINIC_PHONE = (process.env.CLINIC_PHONE || "").trim(); // e.g. +66812345678
const CLINIC_WHATSAPP = (process.env.CLINIC_WHATSAPP || "").trim(); // e.g. https://wa.me/66812345678
const CLINIC_WEBSITE = (process.env.CLINIC_WEBSITE || "").trim(); // e.g. https://yourclinic.com

const client = new Client(config);
const app = express();

// --------------------
// Demo choices (edit anytime)
// --------------------
const DEMO = {
  services: ["Botox", "Filler", "HIFU", "Pico laser", "Thread lift", "IV Drip", "Other"],
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
  BOOK_TREATMENT: "book_treatment",
  BOOK_DAY: "book_day",
  BOOK_TIME: "book_time",
  BOOK_NAME: "book_name",
  BOOK_PHONE: "book_phone",
  BOOK_REVIEW: "book_review",
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
    data: { treatment: null, day: null, time: null, name: null, phone: null },
    updatedAt: Date.now(),
  };
  sessions.set(userId, fresh);
  return fresh;
}

function resetSession(userId) {
  sessions.set(userId, {
    step: STEPS.IDLE,
    data: { treatment: null, day: null, time: null, name: null, phone: null },
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

function qrList(list) {
  return makeQuickReply(list.map((x) => ({ label: x, text: x })));
}

function qrConfirm() {
  return makeQuickReply([
    { label: "Confirm", text: "CONFIRM" },
    { label: "Edit", text: "EDIT" },
    { label: "Reset", text: "RESET" },
  ]);
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

// Parse postback action=...
function parseAction(raw) {
  const s = (raw || "").trim();

  // postback data: action=book
  if (s.startsWith("action=")) return s.slice("action=".length).toLowerCase();

  // fallback if any action is message-based
  const t = s.toLowerCase();
  if (t === "book" || t === "book consultation" || t === "book appointment") return "book";
  if (t === "treatments" || t === "treatments & services" || t === "services") return "treatments";
  if (t === "current promotions" || t === "promotions" || t === "promo") return "promotions";
  if (t === "contact clinic" || t === "contact" || t === "talk to clinic") return "contact";

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

// Optional: allow user to send name + phone in one message
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
// Content responses (demo-safe)
// --------------------
function contactMessage() {
  const lines = [];
  lines.push(`Contact ${CLINIC_NAME}`);
  if (CLINIC_PHONE) lines.push(`📞 Phone: ${CLINIC_PHONE}`);
  if (CLINIC_WHATSAPP) lines.push(`💬 WhatsApp: ${CLINIC_WHATSAPP}`);
  if (CLINIC_WEBSITE) lines.push(`🌐 Website: ${CLINIC_WEBSITE}`);
  if (!CLINIC_PHONE && !CLINIC_WHATSAPP && !CLINIC_WEBSITE) {
    lines.push("Reply here and a staff member will get back to you shortly.");
  }
  return lines.join("\n");
}

function promotionsMessage() {
  return (
    "Current promotions (demo)\n" +
    "• Free consultation with selected treatments\n" +
    "• Limited-time packages may be available\n\n" +
    "Tell me what treatment you want and I’ll share what’s available."
  );
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
    return replyOne(event, makeText("Reset ✅ Tap the menu to start again."));
  }

  // --------------------
  // Rich menu actions (4 tiles)
  // --------------------
  const action = parseAction(textRaw);
  if (action) {
    if (action === "book") {
      return startBooking(event, session, userId);
    }

    if (action === "treatments") {
      session.step = STEPS.BOOK_TREATMENT;
      session.data = { treatment: null, day: null, time: null, name: null, phone: null };
      return replyOne(
        event,
        makeText("Which treatment are you interested in?"),
        qrList([...DEMO.services, "RESET"])
      );
    }

    if (action === "promotions") {
      session.step = STEPS.IDLE;
      return replyOne(event, makeText(promotionsMessage()), qrList(["Book consultation", "Treatments", "Contact clinic"]));
    }

    if (action === "contact") {
      session.step = STEPS.IDLE;
      return replyOne(event, makeText(contactMessage()), qrList(["Book consultation", "Treatments"]));
    }
  }

  // Allow simple typed commands too
  if (/^book consultation$|^book appointment$|^book$/i.test(textRaw)) {
    return startBooking(event, session, userId);
  }
  if (/^treatments$|^services$/i.test(textRaw)) {
    session.step = STEPS.BOOK_TREATMENT;
    return replyOne(event, makeText("Which treatment are you interested in?"), qrList([...DEMO.services, "RESET"]));
  }
  if (/^promotions$|^current promotions$/i.test(textRaw)) {
    return replyOne(event, makeText(promotionsMessage()));
  }
  if (/^contact clinic$|^contact$/i.test(textRaw)) {
    return replyOne(event, makeText(contactMessage()));
  }

  // --------------------
  // Booking flow (exact sequence)
  // treatment -> day -> time -> name -> phone -> confirm
  // --------------------
  if (session.step === STEPS.BOOK_TREATMENT) {
    session.data.treatment = textRaw;
    session.step = STEPS.BOOK_DAY;
    return replyOne(event, makeText("Choose a day:"), qrList([...DEMO.days, "RESET"]));
  }

  if (session.step === STEPS.BOOK_DAY) {
    session.data.day = textRaw;
    session.step = STEPS.BOOK_TIME;
    return replyOne(event, makeText("Choose a time:"), qrList([...DEMO.times, "RESET"]));
  }

  if (session.step === STEPS.BOOK_TIME) {
    session.data.time = textRaw;
    session.step = STEPS.BOOK_NAME;
    return replyOne(event, makeText("What is your full name?"));
  }

  if (session.step === STEPS.BOOK_NAME) {
    // If user sent name+phone together, accept it (faster)
    const parsed = parseNameAndPhone(textRaw);
    if (parsed) {
      session.data.name = parsed.name || null;
      session.data.phone = parsed.phone;
      // If name was missing, ask name; else go review
      if (!session.data.name) {
        session.step = STEPS.BOOK_NAME;
        return replyOne(event, makeText("Got your phone ✅ Now send your full name."));
      }
      session.step = STEPS.BOOK_REVIEW;
      return sendReview(event, session);
    }

    const nameOnly = normalize(textRaw);
    if (!nameOnly) return replyOne(event, makeText("Please type your full name."));
    session.data.name = nameOnly;
    session.step = STEPS.BOOK_PHONE;
    return replyOne(event, makeText("What is your phone number? (example: 0812345678)"));
  }

  if (session.step === STEPS.BOOK_PHONE) {
    // Allow name+phone here too (if user repeats)
    const parsed = parseNameAndPhone(textRaw);
    if (parsed) {
      if (!session.data.name && parsed.name) session.data.name = parsed.name;
      session.data.phone = parsed.phone;
      session.step = STEPS.BOOK_REVIEW;
      return sendReview(event, session);
    }

    const phone = validatePhone(textRaw);
    if (!phone) {
      return replyOne(event, makeText("Please enter a valid phone number (example: 0812345678)."));
    }
    session.data.phone = phone;
    session.step = STEPS.BOOK_REVIEW;
    return sendReview(event, session);
  }

  if (session.step === STEPS.BOOK_REVIEW) {
    if (/^confirm$/i.test(textRaw)) {
      const lead = {
        ts_iso: new Date().toISOString(),
        userId,
        clinic: CLINIC_NAME,
        treatment: session.data.treatment || "-",
        day: session.data.day || "-",
        time: session.data.time || "-",
        name: session.data.name || "-",
        phone: session.data.phone || "-",
        source: "line",
        version: process.env.BOT_VERSION || "demo-v2",
      };

      const ok = await sendLeadToSheet(lead);

      const msg1 =
        `Appointment request — ${CLINIC_NAME}\n\n` +
        `💉 Treatment: ${session.data.treatment || "-"}\n` +
        `🗓 Day: ${session.data.day || "-"}\n` +
        `⏰ Time: ${session.data.time || "-"}\n` +
        `👤 Name: ${session.data.name || "-"}\n` +
        `📞 Phone: ${session.data.phone || "-"}`;

      const msg2 = ok
        ? `✅ Request received.\nThe clinic will contact you shortly to confirm the exact time.`
        : `✅ Request received.\n(But Sheets write failed — check Render logs / Apps Script permissions.)`;

      resetSession(userId);
      return reply(event, [makeText(msg1), makeText(msg2)]);
    }

    if (/^edit$/i.test(textRaw)) {
      // Restart at treatment step
      session.step = STEPS.BOOK_TREATMENT;
      session.data = { treatment: null, day: null, time: null, name: null, phone: null };
      return replyOne(event, makeText("Sure — let’s start again. Which treatment?"), qrList([...DEMO.services, "RESET"]));
    }

    if (isReset(textRaw)) {
      resetSession(userId);
      return replyOne(event, makeText("Reset ✅ Tap the menu to start again."));
    }

    return replyOne(event, makeText("Please tap Confirm or Edit."), qrConfirm());
  }

  // Default fallback
  return replyOne(event, makeText("Tap the menu below to continue. (Book / Treatments / Promotions / Contact)"));
}

async function startBooking(event, session, userId) {
  // clean state
  session.step = STEPS.BOOK_TREATMENT;
  session.data = { treatment: null, day: null, time: null, name: null, phone: null };

  return replyOne(
    event,
    makeText("Let’s book your consultation.\nWhich treatment are you interested in?"),
    qrList([...DEMO.services, "RESET"])
  );
}

async function sendReview(event, session) {
  const summary =
    `Please review:\n\n` +
    `Clinic: ${CLINIC_NAME}\n` +
    `Treatment: ${session.data.treatment || "-"}\n` +
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
