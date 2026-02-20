import 'dotenv/config';
import express from 'express';
import line from '@line/bot-sdk';

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const app = express();

app.get('/', (_, res) => res.send('OK'));

app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

const DEMO_SLOTS = ['Today 6:30pm', 'Tomorrow 1:00pm', 'Tomorrow 7:15pm'];

function isPriceQuestion(text = '') {
  return /price|cost|how much|botox|filler|โปรโมชั่น|ราคา/i.test(text);
}
const makeReply = (text) => ({ type: 'text', text });

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  const userText = event.message.text.trim();

  if (isPriceQuestion(userText)) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [makeReply(
        `Thanks! Quick 3 questions so I can recommend the right option:\n` +
        `1) Main goal? (wrinkles / jawline / under-eye / lips)\n` +
        `2) When? (today / this week)\n` +
        `3) Budget? (5k–10k / 10k–20k / 20k+)\n\n` +
        `Final suitability is confirmed by the clinician.`
      )],
    });
  }

  if (/today|tomorrow|this week|weekend|วันนี้|พรุ่งนี้|อาทิตย์นี้/i.test(userText)) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [makeReply(
        `Got it. Here are 3 available times:\n` +
        `• ${DEMO_SLOTS[0]}\n• ${DEMO_SLOTS[1]}\n• ${DEMO_SLOTS[2]}\n\n` +
        `Reply with the slot + your name (e.g., "Tomorrow 1:00pm, Nina").`
      )],
    });
  }

  if (/(today|tomorrow|pm|am|:)\b/i.test(userText) && userText.includes(',')) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [makeReply(
        `Booked (demo)! ✅\nWe’ll send a reminder before your visit.\n\n` +
        `If you need to change time, message here.\nPayment is handled at the clinic.\n\n` +
        `Clinician confirms the final plan during consultation.`
      )],
    });
  }

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [makeReply(`Tell me what you’re interested in (Botox / filler / facial / anti-aging) and I’ll help book you.`)],
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LINE demo bot running on port ${port}`));
