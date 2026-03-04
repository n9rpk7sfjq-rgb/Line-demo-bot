import "dotenv/config";
import { messagingApi } from "@line/bot-sdk";
import fs from "fs";

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!channelAccessToken) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN");
  process.exit(1);
}

// v9: use MessagingApiClient for create/set default
const client = new messagingApi.MessagingApiClient({ channelAccessToken });

// v9: image upload is on the *Blob* client (this is the key fix)
const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken });

async function main() {
  try {
    console.log("createRichMenu.js started");

    // 2500 x 1686 (Large)
    const width = 2500;
    const height = 1686;

    // 4 equal tiles (2x2)
    const tileW = 1250;
    const tileH = 843;

    const richMenu = {
      size: { width, height },
      selected: true,
      name: "Demo Menu (4 tiles)",
      chatBarText: "Menu",
      areas: [
        // Top-left: Book consultation
        {
          bounds: { x: 0, y: 0, width: tileW, height: tileH },
          action: { type: "postback", data: "action=book", displayText: "Book consultation" },
        },
        // Top-right: Treatments
        {
          bounds: { x: tileW, y: 0, width: tileW, height: tileH },
          action: { type: "postback", data: "action=treatments", displayText: "Treatments" },
        },
        // Bottom-left: Promotions
        {
          bounds: { x: 0, y: tileH, width: tileW, height: tileH },
          action: { type: "postback", data: "action=promotions", displayText: "Current promotions" },
        },
        // Bottom-right: Contact clinic
        {
          bounds: { x: tileW, y: tileH, width: tileW, height: tileH },
          action: { type: "postback", data: "action=contact", displayText: "Contact clinic" },
        },
      ],
    };

    console.log("About to create rich menu...");
    const richMenuId = await client.createRichMenu(richMenu);
    console.log("Rich Menu created:", richMenuId);

    // Upload image (must be ./richmenu.png, 2500x1686, PNG)
    const imageBuffer = fs.readFileSync("./richmenu.png");

    // v9 blob upload
    await blobClient.setRichMenuImage(richMenuId, imageBuffer, "image/png");
    console.log("Image uploaded.");

    // Set default rich menu
    await client.setDefaultRichMenu(richMenuId);
    console.log("Set as default rich menu.");

    console.log("\nNEW DEFAULT_RICHMENU_ID =", richMenuId);
    console.log("Put that into Render env: DEFAULT_RICHMENU_ID (optional)");
  } catch (err) {
    console.error("Error:", err?.message || err);
    process.exit(1);
  }
}

main();
