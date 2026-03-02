import "dotenv/config";
import { messagingApi } from "@line/bot-sdk";
import fs from "fs";

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!channelAccessToken) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN");
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({ channelAccessToken });

async function main() {
  try {
    // 1) Create rich menu (6 tiles)
    const richMenuId = await client.createRichMenu({
      size: { width: 1200, height: 810 },
      selected: true,
      name: "Demo Menu (Postback)",
      chatBarText: "Menu",
      areas: [
        // Row 1
        {
          bounds: { x: 0, y: 0, width: 400, height: 405 },
          action: { type: "postback", data: "action=book", displayText: "Book appointment" },
        },
        {
          bounds: { x: 400, y: 0, width: 400, height: 405 },
          action: { type: "postback", data: "action=faq", displayText: "Quick questions" },
        },
        {
          bounds: { x: 800, y: 0, width: 400, height: 405 },
          action: { type: "postback", data: "action=prices", displayText: "Prices" },
        },
        // Row 2
        {
          bounds: { x: 0, y: 405, width: 400, height: 405 },
          action: { type: "postback", data: "action=promo", displayText: "Promotions" },
        },
        {
          bounds: { x: 400, y: 405, width: 400, height: 405 },
          action: { type: "postback", data: "action=location", displayText: "Location / Branches" },
        },
        {
          bounds: { x: 800, y: 405, width: 400, height: 405 },
          action: { type: "postback", data: "action=staff", displayText: "Talk to staff" },
        },
      ],
    });

    console.log("Rich Menu created:", richMenuId);

    // 2) Upload image
    const imageBuffer = fs.readFileSync("./richmenu.png");
    await client.setRichMenuImage(richMenuId, imageBuffer, "image/png");
    console.log("Image uploaded.");

    // 3) Set default rich menu
    await client.setDefaultRichMenu(richMenuId);
    console.log("Set as default rich menu.");

    console.log("\nNEW DEFAULT_RICHMENU_ID =", richMenuId);
    console.log("Paste that into Render env DEFAULT_RICHMENU_ID");
  } catch (err) {
    console.error("Error:", err?.message || err);
  }
}

main();
