import "dotenv/config";
import { messagingApi } from "@line/bot-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!channelAccessToken) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN");
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({ channelAccessToken });

// ---- helper: LINE HTTP call (no SDK dependency) ----
async function lineFetch(url, { method = "GET", headers = {}, body } = {}) {
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      ...headers,
    },
    body,
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${method} ${url} -> ${r.status} ${t}`);
  }
  return r;
}

async function main() {
  // 1) Create rich menu
  const richMenu = {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "Beauty Clinic Menu",
    chatBarText: "Menu",
    areas: [
      { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: "postback", data: "action=book" } },
      { bounds: { x: 833, y: 0, width: 833, height: 843 }, action: { type: "postback", data: "action=faq" } },
      { bounds: { x: 1666, y: 0, width: 834, height: 843 }, action: { type: "postback", data: "action=prices" } },
      { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: "postback", data: "action=promo" } },
      { bounds: { x: 833, y: 843, width: 833, height: 843 }, action: { type: "postback", data: "action=location" } },
      { bounds: { x: 1666, y: 843, width: 834, height: 843 }, action: { type: "postback", data: "action=staff" } },
    ],
  };

  const created = await client.createRichMenu(richMenu);
  const richMenuId = typeof created === "string" ? created : created?.richMenuId;
  if (!richMenuId) throw new Error("createRichMenu did not return richMenuId");

  // 2) Find the image file
  // Your shell prompt shows /project/src — so the safest is:
  // - first try same folder as script
  // - then try repo root (one level up)
  const p1 = path.join(__dirname, "richmenu.png");
  const p2 = path.join(__dirname, "..", "richmenu.png");

  const imgPath = fs.existsSync(p1) ? p1 : fs.existsSync(p2) ? p2 : null;
  if (!imgPath) throw new Error("richmenu.png not found (checked src/ and repo root)");

  const imgBuffer = fs.readFileSync(imgPath);

  // 3) Upload image via raw HTTP
  await lineFetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: imgBuffer,
  });

  // 4) Set as default rich menu (applies to all users)
  await lineFetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST",
  });

  console.log("RICHMENU_ID=" + richMenuId);
}

main().catch((e) => {
  console.error("FAILED:", e?.message || e);
  process.exit(1);
});
