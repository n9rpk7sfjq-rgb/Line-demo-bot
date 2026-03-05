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

const IMAGE_PATH = "./richmenu.jpeg";      // must exist in /opt/render/project/src
const IMAGE_MIME = "image/jpeg";           // IMPORTANT

async function deleteAllRichMenus() {
  const list = await client.getRichMenuList();
  const menus = Array.isArray(list) ? list : (list.richmenus || []);
  console.log(`Deleting ${menus.length} rich menu(s)...`);

  for (const m of menus) {
    const id = m.richMenuId || m.richMenuId?.richMenuId;
    if (!id) continue;
    await client.deleteRichMenu(id);
    console.log("Deleted:", id);
  }
}

async function main() {
  try {
    console.log("createRichMenu.js started");

    // 2500 x 1686 (Large)
    const width = 2500;
    const height = 1686;

    // 4 equal tiles (2x2)
    const tileW = 1250;
    const tileH = 843;

    // 1) clean up (optional but you want it)
    await deleteAllRichMenus();

    // 2) create menu
    const richMenu = {
      size: { width, height },
      selected: true,
      name: "Demo Menu (4 tiles)",
      chatBarText: "Menu",
      areas: [
        { bounds: { x: 0,      y: 0,      width: tileW, height: tileH }, action: { type: "postback", data: "action=book",        displayText: "Book consultation" } },
        { bounds: { x: tileW,  y: 0,      width: tileW, height: tileH }, action: { type: "postback", data: "action=treatments",  displayText: "Treatments" } },
        { bounds: { x: 0,      y: tileH,  width: tileW, height: tileH }, action: { type: "postback", data: "action=promotions",  displayText: "Current promotions" } },
        { bounds: { x: tileW,  y: tileH,  width: tileW, height: tileH }, action: { type: "postback", data: "action=contact",     displayText: "Contact clinic" } },
      ],
    };

    console.log("Creating rich menu...");
    const created = await client.createRichMenu(richMenu);

    // SDK v9 returns: { richMenuId: "richmenu-xxx" }
    const richMenuId = created.richMenuId;
    if (!richMenuId) throw new Error("createRichMenu() did not return richMenuId");
    console.log("Rich Menu created:", richMenuId);

    // 3) read image
    if (!fs.existsSync(IMAGE_PATH)) {
      throw new Error(`Image not found at ${IMAGE_PATH} (pwd must be /opt/render/project/src)`);
    }
    const imageBuffer = fs.readFileSync(IMAGE_PATH);
    console.log(`Uploading image ${IMAGE_PATH} (${IMAGE_MIME}), bytes=${imageBuffer.length}`);

    // 4) upload image (BLOB client)
    await blobClient.setRichMenuImage(richMenuId, imageBuffer, IMAGE_MIME);
    console.log("Image uploaded.");

    // 5) set default
    await client.setDefaultRichMenu(richMenuId);
    console.log("Set as default rich menu.");

    console.log("\nDEFAULT_RICHMENU_ID =", richMenuId);
    console.log("Put this in Render env DEFAULT_RICHMENU_ID (optional).");

  } catch (err) {
    console.error("Error:", err?.message || err);
    process.exit(1);
  }
}

main();
