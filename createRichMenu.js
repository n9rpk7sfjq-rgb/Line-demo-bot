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
    // 1) Create rich menu (4 tiles, 2x2) matching 2500x1686
    const richMenuId = await client.createRichMenu({
      size: { width: 2500, height: 1686 },
      selected: true,
      name: "Demo Menu (4 Tiles)",
      chatBarText: "Menu",
      areas: [
        // Top-left (0,0)
        {
          bounds: { x: 0, y: 0, width: 1250, height: 843 },
          action: { type: "postback", data: "action=book", displayText: "Book Consultation" },
        },
        // Top-right (1250,0)
        {
          bounds: { x: 1250, y: 0, width: 1250, height: 843 },
          action: { type: "postback", data: "action=treatments", displayText: "Treatments" },
        },
        // Bottom-left (0,843)
        {
          bounds: { x: 0, y: 843, width: 1250, height: 843 },
          action: { type: "postback", data: "action=promo", displayText: "Current Promotions" },
        },
        // Bottom-right (1250,843)
        {
          bounds: { x: 1250, y: 843, width: 1250, height: 843 },
          action: { type: "postback", data: "action=contact", displayText: "Contact Clinic" },
        },
      ],
    });

    console.log("Rich Menu created:", richMenuId);

    // 2) Upload image (must be ./richmenu.png and 2500x1686)
    const imageBuffer = fs.readFileSync("./richmenu.png");
    await client.setRichMenuImageBinary(richMenuId, imageBuffer, "image/png");
    console.log("Image uploaded.");

    // 3) Set as default rich menu
    await client.setDefaultRichMenu(richMenuId);
    console.log("Set as default rich menu.");

    console.log("\nNEW DEFAULT_RICHMENU_ID =", richMenuId);
    console.log("Put that into Render ENV: DEFAULT_RICHMENU_ID");
  } catch (err) {
    console.error("Error:", err?.message || err);
  }
}
