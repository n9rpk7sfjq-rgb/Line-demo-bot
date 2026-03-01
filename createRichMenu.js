import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { messagingApi } from "@line/bot-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!channelAccessToken) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN");
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({ channelAccessToken });

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

  // 2) Upload image
  const imgPath = path.join(__dirname, "richmenu.png");
  if (!fs.existsSync(imgPath)) throw new Error("richmenu.png not found in repo root");

  const imgStream = fs.createReadStream(imgPath);
  await client.setRichMenuImage(richMenuId, imgStream, "image/png");

  // 3) Set default
  await client.setDefaultRichMenu(richMenuId);

  console.log("✅ DONE");
  console.log("RICH_MENU_ID =", richMenuId);
  console.log("Now set Render env var DEFAULT_RICHMENU_ID to that value, then redeploy.");
}

main().catch((e) => {
  console.error("❌ FAILED:", e?.message || e);
  process.exit(1);
});
