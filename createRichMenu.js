// createRichMenu.js  (LINE SDK v9)  — uses ./richmenu.jpeg
import "dotenv/config";
import { messagingApi } from "@line/bot-sdk";
import fs from "fs";

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!channelAccessToken) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN");
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({ channelAccessToken });
const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken });

async function deleteAllRichMenus() {
  const list = await client.getRichMenuList(); // returns array of rich menus
  const menus = Array.isArray(list) ? list : (list?.richmenus ?? []);
  if (!menus.length) {
    console.log("No rich menus to delete.");
    return;
  }

  console.log(`Deleting ${menus.length} rich menu(s)...`);
  for (const m of menus) {
    const id = m.richMenuId || m.richMenuId;
    try {
      await client.deleteRichMenu(m.richMenuId || id);
      console.log("Deleted:", m.richMenuId || id);
    } catch (e) {
      console.log("Delete failed (skip):", m.richMenuId || id, e?.message || e);
    }
  }
}

async function main() {
  try {
    console.log("createRichMenu.js started");

    // OPTIONAL: wipe old menus first (recommended while testing)
    await deleteAllRichMenus();

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
        // Top-left
        {
          bounds: { x: 0, y: 0, width: tileW, height: tileH },
          action: { type: "postback", data: "action=book", displayText: "Book consultation" },
        },
        // Top-right
        {
          bounds: { x: tileW, y: 0, width: tileW, height: tileH },
          action: { type: "postback", data: "action=treatments", displayText: "Treatments" },
        },
        // Bottom-left
        {
          bounds: { x: 0, y: tileH, width: tileW, height: tileH },
          action: { type: "postback", data: "action=promotions", displayText: "Current promotions" },
        },
        // Bottom-right
        {
          bounds: { x: tileW, y: tileH, width: tileW, height: tileH },
          action: { type: "postback", data: "action=contact", displayText: "Contact clinic" },
        },
      ],
    };

    console.log("Creating rich menu...");
    const richMenuId = await client.createRichMenu(richMenu);
    console.log("Rich menu created:", richMenuId);

    // IMPORTANT: file name MUST match exactly and be in the same folder you run the command from
    const imagePath = "./richmenu.jpeg"; // <-- JPEG ONLY
    const imageBuffer = fs.readFileSync(imagePath);
    console.log(`Uploading image ${imagePath} (image/jpeg), bytes=${imageBuffer.length}`);

    // v9: upload via Blob client
    await blobClient.setRichMenuImage(richMenuId, imageBuffer, "image/jpeg");
    console.log("Image uploaded.");

    // Set as default
    await client.setDefaultRichMenu(richMenuId);
    console.log("Set as default rich menu.");

    console.log("\nNEW DEFAULT_RICHMENU_ID =", richMenuId);
    console.log("Put that into Render env: DEFAULT_RICHMENU_ID (optional)");
  } catch (err) {
    // show full error body if available
    const msg = err?.message || err;
    console.error("Error:", msg);
    if (err?.response?.data) console.error("Response data:", err.response.data);
    process.exit(1);
  }
}

main();
