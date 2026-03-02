import "dotenv/config";
import express from "express";
import { middleware, Client } from "@line/bot-sdk";

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);
const app = express();

/* =========================
   Simple session store
========================= */

const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: "idle",
      data: {}
    });
  }
  return sessions.get(userId);
}

/* =========================
   Helpers
========================= */

function reply(event, messages) {
  return client.replyMessage(event.replyToken, messages);
}

function textMessage(text) {
  return { type: "text", text };
}

function getEventInput(event) {
  if (event.type === "postback") {
    return event.postback.data;
  }
  if (event.type === "message" && event.message.type === "text") {
    return event.message.text.trim();
  }
  return null;
}

/* =========================
   Webhook
========================= */

app.post("/webhook", middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

/* =========================
   Core Logic
========================= */

async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  const session = getSession(userId);
  const input = getEventInput(event);
  if (!input) return;

  /* =========================
     Rich Menu Routing
  ========================= */

  if (input.startsWith("action=")) {
    const action = input.replace("action=", "");

    if (action === "book") {
      session.step = "ask_service";
      return reply(event, [textMessage("💉 What service do you want?")]);
    }

    if (action === "faq") {
      return reply(event, [textMessage("ℹ️ Ask me anything about treatments or pricing.")]);
    }

    if (action === "prices") {
      return reply(event, [textMessage("💰 Botox: 3,500–12,000 THB\nFiller: 9,900–25,000 THB / cc")]);
    }

    if (action === "promo") {
      return reply(event, [textMessage("🔥 Promotions change weekly. Ask staff for latest offers.")]);
    }

    if (action === "location") {
      return reply(event, [textMessage("📍 We have branches in Sukhumvit, Thonglor, and Siam.")]);
    }

    if (action === "staff") {
      session.step = "ask_contact";
      return reply(event, [textMessage("👤 Please send your name + phone number.")]);
    }
  }

  /* =========================
     Booking Flow
  ========================= */

  if (session.step === "ask_service") {
    session.data.service = input;
    session.step = "ask_day";
    return reply(event, [textMessage("🗓 Which day?")]);
  }

  if (session.step === "ask_day") {
    session.data.day = input;
    session.step = "ask_time";
    return reply(event, [textMessage("⏰ What time?")]);
  }

  if (session.step === "ask_time") {
    session.data.time = input;
    session.step = "ask_contact";
    return reply(event, [textMessage("👤 Send your name + phone number")]);
  }

  if (session.step === "ask_contact") {
    session.data.contact = input;
    session.step = "idle";

    const summary =
`My booking ✨

🗓 ${session.data.day}, ${session.data.time}
💉 ${session.data.service}

👤 ${session.data.contact}

✅ Staff will contact you shortly.`;

    return reply(event, [textMessage(summary)]);
  }

  return reply(event, [textMessage("Tap the Menu below to start.")]);
}

/* =========================
   Start Server
========================= */

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Bot running on port", port);
});
