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

// Set to false if you do NOT want to delete all old rich menus
const DELETE_ALL_OLD_MENUS = true;

function readImage() {
  const candidates = ["./richmenu.jpg", "./richmenu.jpeg", "./richmenu.png"];
  for (const p of candidates) {
    if (fs.existsSync(p)) return { path: p, buf: fs.readFileSync(p) };
  }
  throw new Error("Missing image file. Upload richmenu.jpg (recommended) into the repo root.");
}

function detectMime(path) {
  if (path.endsWith(".png")) return "image/png";
  return "image/jpeg"; // .jpg or .jpeg
}

async function deleteAllRichMenus() {
  const res = await client.getRichMenuList();
  const list = res?.richmenus || [];
  if (!list.length) {
    console.log("No existing rich menus to delete.");
    return;
  }

  console.log(`Deleting ${list.length} rich menus...`);
  for (const m of list) {
    try {
      // also remove default if it is this one
      await client.deleteRichMenu(m.richMenuId);
      console.log("Deleted:", m.richMenuId);
    } catch (e) {
      console.log("Skip delete (maybe already gone):", m.richMenuId, e?.message || e);
    }
  }
}

async function main() {
  try {
    console.log("createRichMenu.js started");

    if (DELETE_ALL_OLD_MENUS) {
      await deleteAllRichMenus();
    }

    // 2500 x 1686
    const width = 2500;
    const height = 1686;
    const tileW = 1250;
    const tileH = 843;

    const richMenu = {
      size: { width, height },
      selected: true,
      name: "Demo Menu (4 tiles)",
      chatBarText: "Menu",
      areas: [
        { bounds: { x: 0, y: 0, width: tileW, height: tileH },
          action: { type: "postback", data: "action=book", displayText: "Book consultation" } },
        { bounds: { x: tileW, y: 0, width: tileW, height: tileH },
          action: { type: "postback", data: "action=treatments", displayText: "Treatments" } },
        { bounds: { x: 0, y: tileH, width: tileW, height: tileH },
          action: { type: "postback", data: "action=promotions", displayText: "Current promotions" } },
        { bounds: { x: tileW, y: tileH, width: tileW, height: tileH },
          action: { type: "postback", data: "action=contact", displayText: "Contact clinic" } },
      ],
    };

    console.log("About to create rich menu...");
    const richMenuId = await client.createRichMenu(richMenu);
    console.log("Rich Menu created:", richMenuId);

    const { path, buf } = readImage();
    const mime = detectMime(path);

    console.log(`Uploading image ${path} (${mime}), bytes=${buf.length}`);
    await blobClient.setRichMenuImage(richMenuId, buf, mime);
    console.log("Image uploaded.");

    await client.setDefaultRichMenu(richMenuId);
    console.log("Set as default rich menu.");

    console.log("\nNEW DEFAULT_RICHMENU_ID =", richMenuId);
  } catch (err) {
    console.error("Error:", err?.message || err);
    process.exit(1);
  }
}

main();
