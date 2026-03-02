import "dotenv/config";
import { messagingApi } from "@line/bot-sdk";
import fs from "fs";

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const imagePath = process.env.RICHMENU_IMAGE_PATH || "./richmenu.png";

if (!channelAccessToken) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN");
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({
  channelAccessToken,
});

async function main() {
  try {
    // 1️⃣ Create Rich Menu
    const richMenu = await client.createRichMenu({
      size: { width: 1200, height: 810 },
      selected: true,
      name: "Demo Main Menu",
      chatBarText: "Menu",
      areas: [
        { bounds: { x: 0, y: 0, width: 400, height: 405 }, action: { type: "postback", data: "action=book" } },
        { bounds: { x: 400, y: 0, width: 400, height: 405 }, action: { type: "postback", data: "action=faq" } },
        { bounds: { x: 800, y: 0, width: 400, height: 405 }, action: { type: "postback", data: "action=prices" } },
        { bounds: { x: 0, y: 405, width: 400, height: 405 }, action: { type: "postback", data: "action=promo" } },
        { bounds: { x: 400, y: 405, width: 400, height: 405 }, action: { type: "postback", data: "action=location" } },
        { bounds: { x: 800, y: 405, width: 400, height: 405 }, action: { type: "postback", data: "action=staff" } },
      ],
    });

    const richMenuId = richMenu.richMenuId;
    console.log("Rich menu created:", richMenuId);

    // 2️⃣ Upload image
    const imageBuffer = fs.readFileSync(imagePath);
    await client.setRichMenuImage(richMenuId, imageBuffer, "image/png");
    console.log("Image uploaded");

    // 3️⃣ Set as DEFAULT (no per-user linking)
    await client.setDefaultRichMenu(richMenuId);
    console.log("Default rich menu set");

    console.log("\nIMPORTANT:");
    console.log("Put this in Render ENV:");
    console.log("DEFAULT_RICHMENU_ID=" + richMenuId);

  } catch (err) {
    console.error("Rich menu setup failed:", err?.message || err);
    process.exit(1);
  }
}

main();
