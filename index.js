import "dotenv/config";
import express from "express";
import { middleware, messagingApi } from "@line/bot-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const app = express();

// Health check
app.get("/", (_, res) => res.send("OK"));

// --------------------
// Session store (in-memory)
// --------------------
const sessions = new Map();

const STEPS = {
  IDLE: "idle", // tiles-only mode

  // Booking flow
  BOOK_SERVICE: "book_service",
  BOOK_AREA: "book_area",
  BOOK_BUDGET: "book_budget",
  BOOK_DAY: "book_day",
  BOOK_TIME: "book_time",
  BOOK_CONTACT: "book_contact",
  BOOK_CONFIRM: "book_confirm",

  // FAQ
  FAQ_MENU: "faq_menu",

  // Special "waiting for text" states
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
      // booking fields
      service: null,
      area: null,
      budget: null,
      day: null,
      time: null,
      name: null,
      phone: null,

      // misc
      lastTile: null,
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
      area: null,
      budget: null,
      day: null,
      time: null,
      name: null,
      phone: null,
      lastTile: null,
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
  // items: [{label, text}]
  return {
    items: items.map((i) => ({
      type: "action",
      action: { type: "message", label: i.label, text: i.text },
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
// Input extraction
// --------------------
function getEventText(event) {
  // Normal text message
  if (event.type === "message" && event.message?.type === "text") {
    return normalize(event.message.text);
  }

  // Postback from rich menu
  if (event.type === "postback") {
    // We encode "action=xxx" in postback.data
    return normalize(event.postback?.data || "");
  }

  return "";
}

function parseAction(raw) {
  // Supports:
  // "action=book"
  // "action=location"
  // Also supports if user sends plain text like "Book appointment"
  const s = (raw || "").trim();

  // Postback format
  if (s.startsWith("action=")) return s.slice("action=".length).toLowerCase();

  // Fallback for message actions (if you ever switch to type: "message")
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
  // Accept: "Name, 0812345678" or "Name 0812345678"
  const digits = (text || "").replace(/[^\d+]/g, "");
  if (digits.length < 8) return null;
  return digits;
}

// --------------------
// Demo content (editable)
// --------------------
const WELCOME =
  "Welcome to Beauty Clinics ✨\n" +
  "We’re here to make your beauty journey easy — from booking treatments to finding the right clinic for you.\n" +
  "Tap a menu tile below to get started.";
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
    { name: "สุขุมวิท (Sukhumvit)", maps: "https://maps.google.com/?q=Sukhumvit+Bangkok" },
    { name: "ทองหล่อ (Thonglor)", maps: "https://maps.google.com/?q=Thonglor+Bangkok" },
    { name: "สยาม (Siam)", maps: "https://maps.google.com/?q=Siam+Bangkok" },
  ],
  phuket: [
    { name: "Phuket – Central", maps: "https://maps.google.com/?q=Central+Phuket" },
  ],
  samui: [
    { name: "Samui – Chaweng", maps: "https://maps.google.com/?q=Chaweng+Koh+Samui" },
  ],
};

// --------------------
// Quick reply builders (ONLY used when bot asks something)
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
    { label: "Talk to staff", text: "Talk to staff" },
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
// Lead sender (optional)
// --------------------
async function sendLeadToSheet(lead) {
  const url = process.env.LEADS_API_URL;
  if (!url) return;

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
// Main webhook
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

  // follow/join = welcome once, NO quick replies (tiles only)
  if (event.type === "follow" || event.type === "join") {
    resetSession(userId);
    const s = getSession(userId);
    s.step = STEPS.IDLE;
    return reply(event, makeText(WELCOME));
  }

  const textRaw = getEventText(event);
  if (!textRaw) return;

  if (isReset(textRaw)) {
    resetSession(userId);
    return reply(event, makeText("Reset ✅ Use the menu tiles below."));
  }

  const session = getSession(userId);
  touch(session);

  // "Back to menu" always returns to tiles-only idle
  if (/^back to menu$/i.test(textRaw)) {
    session.step = STEPS.IDLE;
    return reply(event, makeText("OK ✅ Use the menu tiles below."));
  }

  // 1) Handle tile postbacks (or tile text) globally from anywhere
  const action = parseAction(textRaw);
  if (action) {
    session.data.lastTile = action;

    // IMPORTANT: Each tile sets the correct step and replies with ONLY relevant pills.
    if (action === "book") {
      session.step = STEPS.BOOK_SERVICE;
      return reply(
        event,
        makeText("Booking — step 1/5\nWhat service do you want?"),
        qrBookingService()
      );
    }

    if (action === "faq") {
      session.step = STEPS.FAQ_MENU;
      return reply(event, makeText("Quick questions — choose one:"), qrFaqMenu());
    }

    if (action === "prices") {
      session.step = STEPS.IDLE; // one-and-done
      return reply(event, makeText(FAQ_ANSWER.prices), qrAfterInfo());
    }

    if (action === "promo") {
      session.step = STEPS.IDLE; // one-and-done
      return reply(event, makeText(FAQ_ANSWER.promo), qrAfterInfo());
    }

    if (action === "location") {
      session.step = STEPS.IDLE; // until they choose city / other
      return reply(
        event,
        makeText("Locations — choose a city:"),
        qrLocationCities()
      );
    }

    if (action === "staff") {
      // direct to contact capture
      session.step = STEPS.BOOK_CONTACT;
      // mark booking fields if they came from staff tile
      if (!session.data.service) session.data.service = "Talk to staff";
      if (!session.data.area) session.data.area = "-";
      if (!session.data.budget) session.data.budget = "-";
      if (!session.data.day) session.data.day = "-";
      if (!session.data.time) session.data.time = "-";

      return reply(event, makeText("Please send: Name, Phone (example: N, 0812345678)"));
    }
  }

  // 2) Location city handling (from quick replies)
  if (/^bangkok$|^phuket$|^samui$|^other$/i.test(textRaw)) {
    const t = textRaw.toLowerCase();

    // Only treat as location selection if they recently opened location OR they're idle (harmless)
    if (t === "other") {
      session.step = STEPS.WAIT_LOCATION_TEXT;
      return reply(event, makeText("Which city/area are you looking for? (Type it)"));
    }

    const list = BRANCHES[t] || [];
    if (!list.length) {
      session.step = STEPS.WAIT_LOCATION_TEXT;
      return reply(event, makeText("I don’t have that city yet. Type the city/area you want."));
    }

    const lines = list
      .map((b, i) => `${i + 1}) ${b.name}\n${b.maps}`)
      .join("\n\n");

    session.step = STEPS.IDLE; // back to tiles-only after showing branches
    return reply(
      event,
      makeText(`Branches in ${textRaw} (demo):\n\n${lines}\n\nWant to book or talk to staff?`),
      qrAfterInfo()
    );
  }

  // 3) WAITING_LOCATION_TEXT: capture next typed message (fixes your Phuket problem)
  if (session.step === STEPS.WAIT_LOCATION_TEXT) {
    const city = normalize(textRaw);
    session.step = STEPS.IDLE;

    return reply(
      event,
      makeText(
        `Got it — ${city}.\n\n` +
          `Demo setup:\n` +
          `• We have multiple branches (Bangkok / Phuket / Samui)\n` +
          `• For ${city}, staff will confirm the closest branch + available slots.\n\n` +
          `What do you want next?`
      ),
      qrAfterInfo()
    );
  }

  // 4) FAQ menu handling
  if (session.step === STEPS.FAQ_MENU) {
    if (/^typical prices$/i.test(textRaw) || /^prices$/i.test(textRaw)) {
      session.step = STEPS.IDLE;
      return reply(event, makeText(FAQ_ANSWER.prices), qrAfterInfo());
    }
    if (/^promotions$/i.test(textRaw)) {
      session.step = STEPS.IDLE;
      return reply(event, makeText(FAQ_ANSWER.promo), qrAfterInfo());
    }
    if (/^location\s*\/\s*branches$/i.test(textRaw) || /^location$/i.test(textRaw)) {
      session.step = STEPS.IDLE;
      return reply(event, makeText("Locations — choose a city:"), qrLocationCities());
    }
    if (/^talk to staff$/i.test(textRaw)) {
      session.step = STEPS.BOOK_CONTACT;
      if (!session.data.service) session.data.service = "Quick question";
      if (!session.data.area) session.data.area = "-";
      if (!session.data.budget) session.data.budget = "-";
      if (!session.data.day) session.data.day = "-";
      if (!session.data.time) session.data.time = "-";
      return reply(event, makeText("Please send: Name, Phone (example: N, 0812345678)"));
    }

    return reply(event, makeText("Please choose one of the options below."), qrFaqMenu());
  }

  // 5) Booking flow
  if (session.step === STEPS.BOOK_SERVICE) {
    if (/^other$/i.test(textRaw)) {
      // ask for typed service
      session.step = STEPS.BOOK_SERVICE; // stay here; next typed becomes service
      return reply(event, makeText("Please type the service you want (e.g., HIFU / Pico laser / Thread lift)."));
    }

    session.data.service = textRaw;
    session.step = STEPS.BOOK_AREA;
    return reply(event, makeText("Booking — step 2/5\nWhich area?"), qrBookingArea());
  }

  if (session.step === STEPS.BOOK_AREA) {
    if (/^other$/i.test(textRaw)) {
      session.step = STEPS.BOOK_AREA; // stay; next typed becomes area
      return reply(event, makeText("Please type the area you want (e.g., cheeks, under-eye, full face)."));
    }

    session.data.area = textRaw;
    session.step = STEPS.BOOK_BUDGET;
    return reply(event, makeText("Booking — step 3/5\nWhat is your budget range?"), qrBookingBudget());
  }

  if (session.step === STEPS.BOOK_BUDGET) {
    if (/^other$/i.test(textRaw)) {
      session.step = STEPS.BOOK_BUDGET; // stay; next typed becomes budget
      return reply(event, makeText("Please type your budget (e.g., 12,000 THB or “under 20k”)."));
    }

    session.data.budget = textRaw;
    session.step = STEPS.BOOK_DAY;
    return reply(event, makeText("Booking — step 4/5\nWhich day would you like to come?"), qrBookingDay());
  }

  if (session.step === STEPS.BOOK_DAY) {
    if (/^other$/i.test(textRaw)) {
      session.step = STEPS.BOOK_DAY; // stay; next typed becomes day
      return reply(event, makeText("Please type your preferred day/date (e.g., “Friday” or “Mar 7”)."));
    }

    session.data.day = textRaw;
    session.step = STEPS.BOOK_TIME;
    return reply(event, makeText("Booking — step 5/5\nWhich time?"), qrBookingTime());
  }

  if (session.step === STEPS.BOOK_TIME) {
    if (/^other$/i.test(textRaw)) {
      session.step = STEPS.BOOK_TIME; // stay; next typed becomes time
      return reply(event, makeText("Please type your preferred time (e.g., 3:30pm)."));
    }

    session.data.time = textRaw;
    session.step = STEPS.BOOK_CONTACT;
    return reply(event, makeText("Please send: Name, Phone (example: N, 0812345678)"));
  }

  if (session.step === STEPS.BOOK_CONTACT) {
    // Accept both "Name, Phone" and "Name Phone"
    let name = null;
    let phone = null;

    if (textRaw.includes(",")) {
      const parts = textRaw.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        name = parts[0];
        phone = validatePhone(parts.slice(1).join(" "));
      }
    } else {
      const maybePhone = validatePhone(textRaw);
      if (!maybePhone) {
        // try "Name 081..." format
        const m = textRaw.match(/^(.+?)\s+(\+?\d[\d\s-]{7,})$/);
        if (m) {
          name = m[1].trim();
          phone = validatePhone(m[2]);
        }
      } else {
        // phone-only is not enough
        name = null;
        phone = maybePhone;
      }
    }

    if (!name || !phone) {
      return reply(event, makeText("Phone number looks invalid. Please resend (example: N, 0812345678)."));
    }

    session.data.name = name;
    session.data.phone = phone;
    session.step = STEPS.BOOK_CONFIRM;

    const summary =
      `Please confirm:\n\n` +
      `• Service: ${session.data.service || "-"}\n` +
      `• Area: ${session.data.area || "-"}\n` +
      `• Budget: ${session.data.budget || "-"}\n` +
      `• Day: ${session.data.day || "-"}\n` +
      `• Time: ${session.data.time || "-"}\n` +
      `• Name: ${session.data.name}\n` +
      `• Phone: ${session.data.phone}\n\n` +
      `YES / EDIT`;

    return reply(event, makeText(summary), qrConfirm());
  }

  if (session.step === STEPS.BOOK_CONFIRM) {
    if (/^yes$/i.test(textRaw)) {
      const lead = {
        ts_iso: new Date().toISOString(),
        userId,
        service: session.data.service || "-",
        area: session.data.area || "-",
        budget: session.data.budget || "-",
        day: session.data.day || "-",
        time: session.data.time || "-",
        name: session.data.name || "-",
        phone: session.data.phone || "-",
        source: "line",
      };

      await sendLeadToSheet(lead);

      // Go back to tiles-only
      session.step = STEPS.IDLE;
      return reply(event, makeText("Booked (demo) ✅ Staff will contact you shortly."), qrAfterInfo());
    }

    if (/^edit$/i.test(textRaw)) {
      // restart booking but do NOT show menu pills
      session.data.service = null;
      session.data.area = null;
      session.data.budget = null;
      session.data.day = null;
      session.data.time = null;
      session.data.name = null;
      session.data.phone = null;

      session.step = STEPS.BOOK_SERVICE;
      return reply(event, makeText("Booking — step 1/5\nWhat service do you want?"), qrBookingService());
    }

    return reply(event, makeText("Please choose YES or EDIT."), qrConfirm());
  }

  // 6) IDLE: user typed something random — keep it simple (don’t spam pills)
  if (session.step === STEPS.IDLE) {
    return reply(event, makeText("Use the menu tiles below to continue (Book / Prices / Promotions / Location / Talk to staff)."));
  }
}

// --------------------
// Admin: Create Rich Menu (protected)
// --------------------
// Why ADMIN_KEY: prevents random people from hitting your /admin endpoint and overwriting your rich menu.
function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;
  const key = req.query.key || req.headers["x-admin-key"];

  if (!adminKey) return res.status(500).send("ADMIN_KEY missing on server");
  if (!key || key !== adminKey) return res.status(403).send("Forbidden");
  next();
}

// Create + upload + set default rich menu
app.get("/admin/create-rich-menu", requireAdmin, async (req, res) => {
  try {
    // 2500x1686 (your tile image)
    const richMenu = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: "Beauty Clinic Menu",
      chatBarText: "Menu",
      areas: [
        // Row 1 (3 tiles)
        { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: "postback", data: "action=book" } },
        { bounds: { x: 833, y: 0, width: 833, height: 843 }, action: { type: "postback", data: "action=faq" } },
        { bounds: { x: 1666, y: 0, width: 834, height: 843 }, action: { type: "postback", data: "action=prices" } },

        // Row 2 (3 tiles)
        { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: "postback", data: "action=promo" } },
        { bounds: { x: 833, y: 843, width: 833, height: 843 }, action: { type: "postback", data: "action=location" } },
        { bounds: { x: 1666, y: 843, width: 834, height: 843 }, action: { type: "postback", data: "action=staff" } },
      ],
    };

    // NOTE: SDK versions differ:
    // - Some return string richMenuId
    // - Some return { richMenuId }
    const created = await client.createRichMenu(richMenu);
    const richMenuId = typeof created === "string" ? created : created?.richMenuId;

    if (!richMenuId) throw new Error("createRichMenu did not return a richMenuId");

    const imgPath = path.join(__dirname, "richmenu.png");
    if (!fs.existsSync(imgPath)) throw new Error("richmenu.png not found in project root");

    const img = fs.createReadStream(imgPath);

    // setRichMenuImage signature also varies by SDK version.
    // This form works in many Node SDK versions:
    await client.setRichMenuImage(richMenuId, img, "image/png");

    await client.setDefaultRichMenu(richMenuId);

    res.send(`✅ Rich menu created + default set. ID: ${richMenuId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Error: " + err.message);
  }
});

// --------------------
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LINE bot running on port ${port}`));
