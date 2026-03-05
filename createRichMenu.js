import "dotenv/config";
import { messagingApi } from "@line/bot-sdk";
import fs from "fs";

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!channelAccessToken) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN");
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({ channelAccessToken });

async function uploadRichMenuImage(richMenuId, imageBuffer) {
  const url = `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      "Content-Type": "image/jpeg",
    },
    body: imageBuffer,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Image upload failed: ${res.status} ${res.statusText} ${text}`.trim());
  }
}

async function main() {
  try {
    console.log("createRichMenu.js started (clean, JPEG)");

    const imagePath = "./richmenu.jpeg";
    if (!fs.existsSync(imagePath)) throw new Error(`Missing file: ${imagePath}`);

    const imageBuffer = fs.readFileSync(imagePath);
    console.log("Image bytes:", imageBuffer.length);

    // 2500 x 1686 (Large), 4 equal tiles (2x2)
    const width = 2500;
    const height = 1686;
    const tileW = 1250;
    const tileH = 843;

    const richMenuObject = {
      size: { width, height },
      selected: true,
      name: "Demo Menu (4 tiles)",
      chatBarText: "Menu",
      areas: [
        { bounds: { x: 0, y: 0, width: tileW, height: tileH }, action: { type: "postback", data: "action=book", displayText: "Book consultation" } },
        { bounds: { x: tileW, y: 0, width: tileW, height: tileH }, action: { type: "postback", data: "action=treatments", displayText: "Treatments" } },
        { bounds: { x: 0, y: tileH, width: tileW, height: tileH }, action: { type: "postback", data: "action=promotions", displayText: "Current promotions" } },
        { bounds: { x: tileW, y: tileH, width: tileW, height: tileH }, action: { type: "postback", data: "action=contact", displayText: "Contact clinic" } },
      ],
    };

    console.log("Creating rich menu...");
    const createRes = await client.createRichMenu(richMenuObject);

    // SDK v9 returns { richMenuId: "..." }
    const richMenuId = createRes.richMenuId ?? createRes;
    if (!richMenuId || typeof richMenuId !== "string") {
      throw new Error(`Unexpected createRichMenu response: ${JSON.stringify(createRes)}`);
    }

    console.log("Rich menu created:", richMenuId);

    console.log("Uploading image...");
    await uploadRichMenuImage(richMenuId, imageBuffer);
    console.log("Image uploaded.");

    await client.setDefaultRichMenu(richMenuId);
    console.log("Set as default rich menu.");

    console.log("\nDEFAULT_RICHMENU_ID =", richMenuId);
  } catch (err) {
    console.error("Error:", err?.message || err);
    process.exit(1);
  }
}

main();
