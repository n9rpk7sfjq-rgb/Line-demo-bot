import "dotenv/config";
import { messagingApi } from "@line/bot-sdk";
import fs from "fs";

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

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
      name: "Beauty Clinics Main Menu V2",
      chatBarText: "Menu",
      areas: [
        {
          bounds: { x: 0, y: 0, width: 400, height: 405 },
          action: {
            type: "postback",
            data: "action=book",
            displayText: "Book appointment",
          },
        },
        {
          bounds: { x: 400, y: 0, width: 400, height: 405 },
          action: {
            type: "postback",
            data: "action=faq",
            displayText: "Quick questions",
          },
        },
        {
          bounds: { x: 800, y: 0, width: 400, height: 405 },
          action: {
            type: "postback",
            data: "action=prices",
            displayText: "Prices",
          },
        },
        {
          bounds: { x: 0, y: 405, width: 400, height: 405 },
          action: {
            type: "postback",
            data: "action=promo",
            displayText: "Promotions",
          },
        },
        {
          bounds: { x: 400, y: 405, width: 400, height: 405 },
          action: {
            type: "postback",
            data: "action=location",
            displayText: "Location / Branches",
          },
        },
        {
          bounds: { x: 800, y: 405, width: 400, height: 405 },
          action: {
            type: "postback",
            data: "action=staff",
            displayText: "Talk to staff",
          },
        },
      ],
    });

    console.log("Rich Menu created:", richMenu.richMenuId);

    // 2️⃣ Upload image
    const imageBuffer = fs.readFileSync("./richmenu.png");

    await client.setRichMenuImage(
      richMenu.richMenuId,
      imageBuffer,
      "image/png"
    );

    console.log("Image uploaded.");

    // 3️⃣ Set as default
    await client.setDefaultRichMenu(richMenu.richMenuId);

    console.log("Set as default rich menu.");

    console.log("\nIMPORTANT:");
    console.log("Update your Render ENV:");
    console.log("DEFAULT_RICHMENU_ID =", richMenu.richMenuId);

  } catch (err) {
    console.error("Error creating rich menu:", err);
  }
}

main();
