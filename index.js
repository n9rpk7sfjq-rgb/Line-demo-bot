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
  MENU: 'menu',

  INTENT: 'intent',
  INTENT_OTHER: 'intent_other',

  AREA: 'area',
  AREA_OTHER: 'area_other',

  BUDGET: 'budget',
  BUDGET_OTHER: 'budget_other',

  DAY: 'day',
  DAY_OTHER: 'day_other',

  TIME_OF_DAY: 'time_of_day',
  TIME_EXACT: 'time_exact',

  CONTACT: 'contact',
  CONFIRM: 'confirm',
  DONE: 'done',

  FAQ: 'faq',
};

// --------------------
// Copy (Thai + English)
// --------------------
const T = {
  en: {
    chooseLang: 'Please choose your language:',
    menuTitle: 'What would you like to do?',
    menuBook: 'Book an appointment',
    menuFaq: 'Quick questions',

    welcome: 'Welcome! What service are you interested in?',
    askOtherService: 'Please type the service you want (e.g., HIFU / Pico laser / Thread lift).',

    askArea: 'Which area?',
    askOtherArea: 'Please type the area you want (e.g., cheeks, nose, under-eye, full face).',

    askBudget: 'What is your budget range?',
    askOtherBudget: 'Please type your budget (e.g., 12,000 THB or “under 20k”).',

    askDay: 'Which day would you like to come?',
    askOtherDay: 'Please type your preferred day/date (e.g., “Friday” or “Mar 7”).',

    askTimeOfDay: 'Which time of day?',
    askExactTime: 'Please type your preferred time (e.g., 3:30pm).',

    askContact: 'Please send: Name, Phone (example: N, 0812345678)',
    confirmTitle: 'Please confirm your booking:',
    yes: 'YES',
    edit: 'EDIT',
    booked: 'Booked (demo) ✅ We’ll contact you shortly.',
    invalidPhone: 'Phone number looks invalid. Please resend (example: N, 0812345678).',
    needPick: 'Please choose one of the options below.',
    reset: 'Reset ✅ Let’s start again.',

    faqTitle: 'Quick questions — choose one:',
    faqLocation: 'Location / Branches',
    faqPrices: 'Typical prices',
    faqPromo: 'Promotions',
    faqDoctor: 'Doctor & safety',
    faqAftercare: 'Aftercare',
    faqTalkHuman: 'Talk to staff',

    faqBookNow: 'Book appointment',
    faqBackMenu: 'Back to menu',

    faqAnswers: {
      location: 'Demo answer: We can operate for clinics in Bangkok. Share your branch address and we’ll customize.',
      prices: 'Demo answer: Pricing depends on product/area/units. Tell me service + area and I’ll estimate a range.',
      promo: 'Demo answer: Promotions vary weekly. Tell me the service you want and your budget.',
      doctor: 'Demo answer: Always ask for certified doctor, product authenticity, and clear aftercare.',
      aftercare: 'Demo answer: Avoid alcohol, heavy workout 24h; follow clinic instructions; report unusual swelling/pain.',
      talkHuman: 'Demo answer: Please leave your name + phone and a staff member will call you back.',
    },
  },

  th: {
    chooseLang: 'กรุณาเลือกภาษาของคุณ:',
    menuTitle: 'คุณต้องการทำอะไร?',
    menuBook: 'จองคิว',
    menuFaq: 'คำถามด่วน',

    welcome: 'ยินดีต้อนรับ! คุณสนใจบริการอะไร?',
    askOtherService: 'กรุณาพิมพ์บริการที่ต้องการ (เช่น HIFU / Pico laser / ร้อยไหม)',

    askArea: 'ต้องการทำบริเวณไหน?',
    askOtherArea: 'กรุณาพิมพ์บริเวณที่ต้องการ (เช่น แก้ม จมูก ใต้ตา ทั้งหน้า)',

    askBudget: 'งบประมาณเท่าไหร่?',
    askOtherBudget: 'กรุณาพิมพ์งบประมาณ (เช่น 12,000 บาท หรือ “ไม่เกิน 20k”)',

    askDay: 'ต้องการมาวันไหน?',
    askOtherDay: 'กรุณาพิมพ์วัน/วันที่ต้องการ (เช่น “ศุกร์” หรือ “7 มี.ค.”)',

    askTimeOfDay: 'ต้องการช่วงเวลาไหน?',
    askExactTime: 'กรุณาพิมพ์เวลาที่ต้องการ (เช่น 15:30)',

    askContact: 'กรุณาส่ง: ชื่อ, เบอร์โทร (เช่น N, 0812345678)',
    confirmTitle: 'กรุณายืนยันการจอง:',
    yes: 'ยืนยัน',
    edit: 'แก้ไข',
    booked: 'จองเรียบร้อย (เดโม) ✅ ทางคลินิกจะติดต่อกลับ',
    invalidPhone: 'เบอร์โทรไม่ถูกต้อง กรุณาส่งใหม่ (เช่น N, 0812345678)',
    needPick: 'กรุณาเลือกจากตัวเลือกด้านล่าง',
    reset: 'รีเซ็ตแล้ว ✅ เริ่มใหม่อีกครั้ง',

    faqTitle: 'คำถามด่วน — เลือกได้เลย:',
    faqLocation: 'สาขา / โลเคชัน',
    faqPrices: 'ราคาประมาณ',
    faqPromo: 'โปรโมชัน',
    faqDoctor: 'หมอและความปลอดภัย',
    faqAftercare: 'การดูแลหลังทำ',
    faqTalkHuman: 'คุยกับพนักงาน',

    faqBookNow: 'จองคิวเลย',
    faqBackMenu: 'กลับเมนู',

    faqAnswers: {
      location: 'คำตอบเดโม: สามารถทำได้สำหรับคลินิกในกรุงเทพฯ ส่งที่อยู่สาขาแล้วเราจะปรับให้เข้ากับคุณ',
      prices: 'คำตอบเดโม: ราคาขึ้นกับตัวยา/บริเวณ/จำนวนยูนิต บอกบริการ+บริเวณ แล้วจะประเมินช่วงราคาให้',
      promo: 'คำตอบเดโม: โปรโมชันเปลี่ยนทุกสัปดาห์ บอกบริการที่สนใจและงบประมาณได้เลย',
      doctor: 'คำตอบเดโม: ควรถามใบประกอบวิชาชีพ แหล่งผลิตภัณฑ์แท้ และคำแนะนำหลังทำที่ชัดเจน',
      aftercare: 'คำตอบเดโม: งดแอลกอฮอล์/ออกกำลังหนัก 24 ชม. ทำตามคำแนะนำคลินิก หากบวม/ปวดผิดปกติให้ติดต่อทันที',
      talkHuman: 'คำตอบเดโม: กรุณาทิ้งชื่อ+เบอร์โทร แล้วเจ้าหน้าที่จะติดต่อกลับ',
    },
  },
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

  const fresh = {
    step: STEPS.LANG,
    data: {
      lang: null,
      intent: null,
      area: null,
      budget: null,
      day: null,
      timeWindow: null,
      timeExact: null,
      name: null,
      phone: null,
      path: null,
      faqLastKey: null,
    },
    updatedAt: Date.now(),
  };

  sessions.set(userId, fresh);
  return fresh;
}

function resetSession(userId) {
  sessions.set(userId, {
    step: STEPS.LANG,
    data: { lang: null, path: null, faqLastKey: null },
    updatedAt: Date.now(),
  });
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

function isOther(text) {
  return /^other$/i.test(text) || /^อื่น/i.test(text);
}

function bangkokTimes() {
  const now = new Date();
  const bkk = now.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
  return { iso: now.toISOString(), bangkok: bkk };
}

// ✅ get text from message OR postback (rich menu can be either)
function getEventText(event) {
  if (event.type === 'message' && event.message?.type === 'text') {
    return normalize(event.message.text);
  }
  if (event.type === 'postback') {
    // If you set rich menu action = postback, put text in data
    return normalize(event.postback?.data || '');
  }
  return '';
}

// ✅ global router for rich menu labels (short labels supported)
function classifyCommand(raw) {
  const s = (raw || '').trim().toLowerCase();

  // EN
  if (s === 'book appointment' || s === 'book an appointment' || s === 'book' || s === 'appointment') return 'BOOK';
  if (s === 'quick questions' || s === 'questions' || s === 'quick') return 'FAQ';
  if (s === 'prices' || s === 'typical prices' || s === 'price') return 'FAQ_PRICES';
  if (s === 'promotions' || s === 'promo' || s === 'promotion') return 'FAQ_PROMO';
  if (s === 'location' || s === 'locations' || s === 'branches' || s === 'location / branches') return 'FAQ_LOCATION';
  if (s === 'talk to staff' || s === 'staff' || s === 'talk') return 'STAFF';

  // TH
  if (s === 'จองคิว' || s === 'จองคิวเลย') return 'BOOK';
  if (s === 'คำถามด่วน') return 'FAQ';
  if (s === 'ราคาประมาณ' || s === 'ราคา') return 'FAQ_PRICES';
  if (s === 'โปรโมชัน' || s === 'โปรโมชั่น') return 'FAQ_PROMO';
  if (s === 'สาขา' || s === 'สาขา / โลเคชัน' || s === 'โลเคชัน') return 'FAQ_LOCATION';
  if (s === 'คุยกับพนักงาน' || s === 'พนักงาน') return 'STAFF';

  return null;
}

function forceFaqAnswerKey(session, key) {
  const lang = session.data.lang || 'en';
  const answer = (T[lang].faqAnswers[key] || T.en.faqAnswers[key] || 'Demo');
  session.step = STEPS.FAQ;
  session.data.path = 'faq';
  session.data.faqLastKey = key;
  return { answer, quick: faqQuickReply(session) };
}

// --------------------
// Google Sheets sender (Apps Script Web App)
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
  // START TRIGGER: follow/join
  if (event.type === 'follow' || event.type === 'join') {
    const userId = getUserId(event);
    if (!userId) return;
    resetSession(userId);
    return reply(event, makeText("Please choose your language / กรุณาเลือกภาษา"), langQuickReply());
  }

  const userId = getUserId(event);
  if (!userId) return;

  const userText = getEventText(event);
  if (!userText) return;

  if (isReset(userText)) {
    resetSession(userId);
    return reply(event, makeText("Please choose your language / กรุณาเลือกภาษา"), langQuickReply());
  }

  const session = getSession(userId);
  touch(session);

  // ✅ GLOBAL RICH MENU ROUTING (works from anywhere)
  const cmd = classifyCommand(userText);
  if (cmd) {
    // If no language chosen yet, ask language first (rich menu can be tapped immediately)
    if (session.step === STEPS.LANG && !session.data.lang) {
      // If they tapped Thai/English it will be handled below; otherwise prompt language.
      if (!/^english$/i.test(userText) && !/^ภาษาไทย$/i.test(userText)) {
        return reply(event, makeText("Please choose your language / กรุณาเลือกภาษา"), langQuickReply());
      }
    } else {
      if (cmd === 'BOOK') {
        session.data.path = 'book';
        session.step = STEPS.INTENT;
        return reply(event, makeText(t(session, 'welcome')), intentQuickReply(session));
      }

      if (cmd === 'FAQ') {
        session.data.path = 'faq';
        session.step = STEPS.FAQ;
        return reply(event, makeText(t(session, 'faqTitle')), faqQuickReply(session));
      }

      if (cmd === 'FAQ_PRICES') {
        const { answer, quick } = forceFaqAnswerKey(session, 'prices');
        return reply(event, makeText(answer), quick);
      }

      if (cmd === 'FAQ_PROMO') {
        const { answer, quick } = forceFaqAnswerKey(session, 'promo');
        return reply(event, makeText(answer), quick);
      }

      if (cmd === 'FAQ_LOCATION') {
        const { answer, quick } = forceFaqAnswerKey(session, 'location');
        return reply(event, makeText(answer), quick);
      }

      if (cmd === 'STAFF') {
        session.step = STEPS.CONTACT;
        session.data.path = session.data.path || 'faq';
        session.data.intent = 'Quick Question';
        session.data.area = '-';
        session.data.budget = '-';
        session.data.day = '-';
        session.data.timeWindow = '-';
        session.data.timeExact = '-';
        return reply(event, makeText(t(session, 'askContact')));
      }
    }
  }

  // “Wake” into language chooser on any first text
  if (session.step === STEPS.LANG) {
    const kick = /^(hi|hello|hey|start|test|สวัสดี|เริ่ม|เริ่มต้น)$/i.test(userText);
    if (kick || userText.length > 0) {
      if (!/^english$/i.test(userText) && !/^ภาษาไทย$/i.test(userText)) {
        return reply(event, makeText("Please choose your language / กรุณาเลือกภาษา"), langQuickReply());
      }
    }
  }

  // --------------------
  // STEP: Language
  // --------------------
  if (session.step === STEPS.LANG) {
    if (/^english$/i.test(userText)) {
      session.data.lang = 'en';
      session.step = STEPS.MENU;
      return reply(event, makeText(t(session, 'menuTitle')), menuQuickReply(session));
    }
    if (/^ภาษาไทย$/i.test(userText)) {
      session.data.lang = 'th';
      session.step = STEPS.MENU;
      return reply(event, makeText(t(session, 'menuTitle')), menuQuickReply(session));
    }
    return reply(event, makeText("Please choose your language / กรุณาเลือกภาษา"), langQuickReply());
  }

  // --------------------
  // STEP: Menu
  // --------------------
  if (session.step === STEPS.MENU) {
    const lang = session.data.lang || 'en';

    const bookRegex = lang === 'th' ? /^จองคิว$/i : /^book( an)? appointment$/i;
    const faqRegex = lang === 'th' ? /^คำถามด่วน$/i : /^quick questions$/i;

    if (bookRegex.test(userText)) {
      session.data.path = 'book';
      session.step = STEPS.INTENT;
      return reply(event, makeText(t(session, 'welcome')), intentQuickReply(session));
    }

    if (faqRegex.test(userText)) {
      session.data.path = 'faq';
      session.step = STEPS.FAQ;
      return reply(event, makeText(t(session, 'faqTitle')), faqQuickReply(session));
    }

    return reply(event, makeText(t(session, 'needPick')), menuQuickReply(session));
  }

  // --------------------
  // STEP: FAQ
  // --------------------
  if (session.step === STEPS.FAQ) {
    const lang = session.data.lang || 'en';

    const bookNowText = lang === 'th' ? T.th.faqBookNow : T.en.faqBookNow;
    const backMenuText = lang === 'th' ? T.th.faqBackMenu : T.en.faqBackMenu;

    if (userText === backMenuText) {
      session.step = STEPS.MENU;
      return reply(event, makeText(t(session, 'menuTitle')), menuQuickReply(session));
    }

    if (userText === bookNowText) {
      session.data.path = 'book';
      session.step = STEPS.INTENT;
      return reply(event, makeText(t(session, 'welcome')), intentQuickReply(session));
    }

    // Accept both long and short labels here too
    const map = lang === 'th'
      ? {
          [T.th.faqLocation]: 'location',
          ['สาขา']: 'location',
          [T.th.faqPrices]: 'prices',
          ['ราคา']: 'prices',
          [T.th.faqPromo]: 'promo',
          ['โปรโมชั่น']: 'promo',
          [T.th.faqDoctor]: 'doctor',
          [T.th.faqAftercare]: 'aftercare',
          [T.th.faqTalkHuman]: 'talkHuman',
        }
      : {
          [T.en.faqLocation]: 'location',
          ['Locations']: 'location',
          ['Location']: 'location',
          [T.en.faqPrices]: 'prices',
          ['Prices']: 'prices',
          ['Price']: 'prices',
          [T.en.faqPromo]: 'promo',
          ['Promo']: 'promo',
          ['Promotion']: 'promo',
          [T.en.faqDoctor]: 'doctor',
          [T.en.faqAftercare]: 'aftercare',
          [T.en.faqTalkHuman]: 'talkHuman',
        };

    const key = map[userText];

    if (!key) {
      return reply(event, makeText(t(session, 'needPick')), faqQuickReply(session));
    }

    session.data.faqLastKey = key;

    if (key === 'talkHuman') {
      session.step = STEPS.CONTACT;
      session.data.intent = 'Quick Question';
      session.data.area = '-';
      session.data.budget = '-';
      session.data.day = '-';
      session.data.timeWindow = '-';
      session.data.timeExact = '-';
      return reply(event, makeText(t(session, 'askContact')));
    }

    const answer = (T[lang].faqAnswers[key] || T.en.faqAnswers[key] || 'Demo');
    return reply(event, makeText(answer), faqQuickReply(session));
  }

  // --------------------
  // BOOKING FLOW
  // --------------------
  if (session.step === STEPS.INTENT) {
    if (isOther(userText)) {
      session.step = STEPS.INTENT_OTHER;
      return reply(event, makeText(t(session, 'askOtherService')));
    }

    session.data.intent = userText;
    session.step = STEPS.AREA;
    return reply(event, makeText(t(session, 'askArea')), areaQuickReply(session));
  }

  if (session.step === STEPS.INTENT_OTHER) {
    session.data.intent = userText;
    session.step = STEPS.AREA;
    return reply(event, makeText(t(session, 'askArea')), areaQuickReply(session));
  }

  if (session.step === STEPS.AREA) {
    if (isOther(userText)) {
      session.step = STEPS.AREA_OTHER;
      return reply(event, makeText(t(session, 'askOtherArea')));
    }

    session.data.area = userText;
    session.step = STEPS.BUDGET;
    return reply(event, makeText(t(session, 'askBudget')), budgetQuickReply(session));
  }

  if (session.step === STEPS.AREA_OTHER) {
    session.data.area = userText;
    session.step = STEPS.BUDGET;
    return reply(event, makeText(t(session, 'askBudget')), budgetQuickReply(session));
  }

  if (session.step === STEPS.BUDGET) {
    if (isOther(userText)) {
      session.step = STEPS.BUDGET_OTHER;
      return reply(event, makeText(t(session, 'askOtherBudget')));
    }

    session.data.budget = userText;
    session.step = STEPS.DAY;
    return reply(event, makeText(t(session, 'askDay')), dayQuickReply(session));
  }

  if (session.step === STEPS.BUDGET_OTHER) {
    session.data.budget = userText;
    session.step = STEPS.DAY;
    return reply(event, makeText(t(session, 'askDay')), dayQuickReply(session));
  }

  if (session.step === STEPS.DAY) {
    if (isOther(userText)) {
      session.step = STEPS.DAY_OTHER;
      return reply(event, makeText(t(session, 'askOtherDay')));
    }

    session.data.day = userText;
    session.step = STEPS.TIME_OF_DAY;
    return reply(event, makeText(t(session, 'askTimeOfDay')), timeOfDayQuickReply(session));
  }

  if (session.step === STEPS.DAY_OTHER) {
    session.data.day = userText;
    session.step = STEPS.TIME_OF_DAY;
    return reply(event, makeText(t(session, 'askTimeOfDay')), timeOfDayQuickReply(session));
  }

  if (session.step === STEPS.TIME_OF_DAY) {
    session.data.timeWindow = userText;

    if (isOther(userText)) {
      session.step = STEPS.TIME_EXACT;
      return reply(event, makeText(t(session, 'askExactTime')));
    }

    session.data.timeExact = userText;
    session.step = STEPS.CONTACT;
    return reply(event, makeText(t(session, 'askContact')));
  }

  if (session.step === STEPS.TIME_EXACT) {
    session.data.timeExact = userText;
    session.step = STEPS.CONTACT;
    return reply(event, makeText(t(session, 'askContact')));
  }

  if (session.step === STEPS.CONTACT) {
    const parts = userText.split(',').map((p) => p.trim()).filter(Boolean);
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

  if (session.step === STEPS.CONFIRM) {
    if (/^yes$|^ยืนยัน$/i.test(userText)) {
      const ts = bangkokTimes();

      const lead = {
        ts_iso: ts.iso,
        ts_bkk: ts.bangkok,

        userId,
        intent: session.data.intent || '-',
        area: session.data.area || '-',
        budget: session.data.budget || '-',

        day: session.data.day || '-',
        timeWindow: session.data.timeWindow || '-',
        timeExact: session.data.timeExact || '-',

        timing: session.data.day || '-',
        slot: session.data.timeExact || session.data.timeWindow || '-',

        name: session.data.name || '-',
        phone: session.data.phone || '-',

        path: session.data.path || '-',
        source: 'line',
      };

      await sendLeadToSheet(lead);
      session.step = STEPS.DONE;
      return reply(event, makeText(t(session, 'booked')));
    }

    if (/^edit$|^แก้ไข$/i.test(userText)) {
      resetSession(userId);
      return reply(event, makeText("Please choose your language / กรุณาเลือกภาษา"), langQuickReply());
    }

    return reply(event, makeText(t(session, 'needPick')), confirmQuickReply(session));
  }

  if (session.step === STEPS.DONE) {
    return reply(event, makeText("Type RESET to start a new booking."));
  }
}

// --------------------
// Quick replies
// --------------------
function langQuickReply() {
  return makeQuickReply([
    { label: 'English', text: 'English' },
    { label: 'ภาษาไทย', text: 'ภาษาไทย' },
  ]);
}

function menuQuickReply(session) {
  const lang = session.data.lang || 'en';
  if (lang === 'th') {
    return makeQuickReply([
      { label: T.th.menuBook, text: T.th.menuBook },
      { label: T.th.menuFaq, text: T.th.menuFaq },
    ]);
  }
  return makeQuickReply([
    { label: T.en.menuBook, text: T.en.menuBook },
    { label: T.en.menuFaq, text: T.en.menuFaq },
  ]);
}

function intentQuickReply(session) {
  const lang = session.data.lang || 'en';
  const items = [
    { en: 'Botox', th: 'โบท็อกซ์' },
    { en: 'Filler', th: 'ฟิลเลอร์' },
    { en: 'HIFU', th: 'HIFU' },
    { en: 'Thermage', th: 'Thermage' },
    { en: 'Ultherapy', th: 'Ultherapy' },
    { en: 'Laser (Pico/IPL)', th: 'เลเซอร์ (Pico/IPL)' },
    { en: 'Acne scar treatment', th: 'รักษาหลุมสิว' },
    { en: 'Skin booster', th: 'สกินบูสเตอร์' },
    { en: 'Thread lift', th: 'ร้อยไหม' },
    { en: 'Facial', th: 'ทรีทเมนต์หน้า' },
    { en: 'Other', th: 'อื่น ๆ' },
  ];

  return makeQuickReply(
    items.map((x) => ({
      label: lang === 'th' ? x.th : x.en,
      text: x.en === 'Other' ? 'Other' : x.en,
    }))
  );
}

function areaQuickReply(session) {
  const lang = session.data.lang || 'en';
  const items = [
    { en: 'Forehead', th: 'หน้าผาก' },
    { en: 'Jawline', th: 'กราม' },
    { en: 'Under-eye', th: 'ใต้ตา' },
    { en: 'Lips', th: 'ปาก' },
    { en: 'Cheeks', th: 'แก้ม' },
    { en: 'Chin', th: 'คาง' },
    { en: 'Nose', th: 'จมูก' },
    { en: 'Full face', th: 'ทั้งหน้า' },
    { en: 'Other', th: 'อื่น ๆ' },
  ];

  return makeQuickReply(
    items.map((x) => ({
      label: lang === 'th' ? x.th : x.en,
      text: x.en === 'Other' ? 'Other' : x.en,
    }))
  );
}

function budgetQuickReply(session) {
  const lang = session.data.lang || 'en';
  const items = [
    { en: '< 5k', th: '< 5k' },
    { en: '5k–10k', th: '5k–10k' },
    { en: '10k–20k', th: '10k–20k' },
    { en: '20k–40k', th: '20k–40k' },
    { en: '40k+', th: '40k+' },
    { en: 'Other', th: 'อื่น ๆ' },
  ];

  return makeQuickReply(
    items.map((x) => ({
      label: lang === 'th' ? x.th : x.en,
      text: x.en === 'Other' ? 'Other' : x.en,
    }))
  );
}

function dayQuickReply(session) {
  const lang = session.data.lang || 'en';
  const items = [
    { en: 'Monday', th: 'จันทร์' },
    { en: 'Tuesday', th: 'อังคาร' },
    { en: 'Wednesday', th: 'พุธ' },
    { en: 'Thursday', th: 'พฤหัส' },
    { en: 'Friday', th: 'ศุกร์' },
    { en: 'Saturday', th: 'เสาร์' },
    { en: 'Sunday', th: 'อาทิตย์' },
    { en: 'Other', th: 'อื่น ๆ' },
  ];

  return makeQuickReply(
    items.map((x) => ({
      label: lang === 'th' ? x.th : x.en,
      text: x.en === 'Other' ? 'Other' : x.en,
    }))
  );
}

function timeOfDayQuickReply(session) {
  const lang = session.data.lang || 'en';
  const items = [
    { en: 'Morning (10–12)', th: 'เช้า (10–12)' },
    { en: 'Afternoon (12–15)', th: 'บ่าย (12–15)' },
    { en: 'Late (15–18)', th: 'เย็น (15–18)' },
    { en: 'Evening (18–20)', th: 'ค่ำ (18–20)' },
    { en: 'Other', th: 'อื่น ๆ' },
  ];

  return makeQuickReply(
    items.map((x) => ({
      label: lang === 'th' ? x.th : x.en,
      text: x.en === 'Other' ? 'Other' : x.en,
    }))
  );
}

function faqQuickReply(session) {
  const lang = session.data.lang || 'en';
  if (lang === 'th') {
    return makeQuickReply([
      { label: T.th.faqLocation, text: T.th.faqLocation },
      { label: T.th.faqPrices, text: T.th.faqPrices },
      { label: T.th.faqPromo, text: T.th.faqPromo },
      { label: T.th.faqDoctor, text: T.th.faqDoctor },
      { label: T.th.faqAftercare, text: T.th.faqAftercare },
      { label: T.th.faqTalkHuman, text: T.th.faqTalkHuman },
      { label: T.th.faqBookNow, text: T.th.faqBookNow },
      { label: T.th.faqBackMenu, text: T.th.faqBackMenu },
    ]);
  }

  return makeQuickReply([
    { label: T.en.faqLocation, text: T.en.faqLocation },
    { label: T.en.faqPrices, text: T.en.faqPrices },
    { label: T.en.faqPromo, text: T.en.faqPromo },
    { label: T.en.faqDoctor, text: T.en.faqDoctor },
    { label: T.en.faqAftercare, text: T.en.faqAftercare },
    { label: T.en.faqTalkHuman, text: T.en.faqTalkHuman },
    { label: T.en.faqBookNow, text: T.en.faqBookNow },
    { label: T.en.faqBackMenu, text: T.en.faqBackMenu },
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
import fs from 'fs';

// One-time endpoint to create rich menu
app.get('/create-rich-menu', async (req, res) => {
  try {
    const richMenu = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: "Clinic Menu",
      chatBarText: "Menu",
      areas: [
        {
          bounds: { x: 0, y: 0, width: 1250, height: 843 },
          action: { type: "postback", data: "action=book" }
        },
        {
          bounds: { x: 1250, y: 0, width: 1250, height: 843 },
          action: { type: "postback", data: "action=faq" }
        },
        {
          bounds: { x: 0, y: 843, width: 1250, height: 843 },
          action: { type: "postback", data: "action=promo" }
        },
        {
          bounds: { x: 1250, y: 843, width: 1250, height: 843 },
          action: { type: "postback", data: "action=contact" }
        }
      ]
    };

    const result = await client.createRichMenu(richMenu);
    const richMenuId = result.richMenuId;

    const image = fs.readFileSync('./richmenu.png');
    await client.setRichMenuImage(richMenuId, image, 'image/png');
    await client.setDefaultRichMenu(richMenuId);

    res.send(`✅ Rich menu created and set as default! ID: ${richMenuId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Error creating rich menu: " + err.message);
  }
});app.listen(port, () => console.log(`LINE bot running on port ${port}`));
