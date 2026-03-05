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
  const list = await client.getRichMenuList();
  const menus = list?.richmenus || [];
  console.log(`Deleting ${menus.length} rich menu(s)...`);
  for (const m of menus) {
    try {
      await client.deleteRichMenu(m.richMenuId);
      console.log("Deleted:", m.richMenuId);
    } catch (e) {
      console.log("Delete failed (ignored):", m.richMenuId, e?.message || e);
    }
  }
}

async function main() {
  try {
    console.log("createRichMenu.js started");

    // Ensure file exists
    const imagePath = "./richmenu.jpeg"; // <-- MUST match repo filename exactly
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Missing file: ${imagePath} (check filename + extension)`);
    }

    const imageBuffer = fs.readFileSync(imagePath);
    console.log(`Image bytes: ${imageBuffer.length}`);

    // Delete old menus (optional but you wanted this behavior)
    await deleteAllRichMenus();

    // 2500 x 1686 (Large)
    const width = 2500;
    const height = 1686;

    // 4 equal tiles (2x2)
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
    const richMenuId = await client.createRichMenu(richMenuObject);
    console.log("Rich menu created:", richMenuId);

    // ✅ v9 blob upload — pass a stream + contentType
    // This avoids the 415 caused by wrong body encoding / headers.
    const stream = fs.createReadStream(imagePath);
    await blobClient.setRichMenuImage(richMenuId, stream, "image/jpeg");
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
