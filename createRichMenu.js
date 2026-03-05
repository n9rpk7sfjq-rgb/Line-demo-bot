// createRichMenu.js
import "dotenv/config";
import { messagingApi } from "@line/bot-sdk";
import fs from "fs";
import path from "path";

// Node 18+ has global fetch. If your runtime is older, install node-fetch and uncomment:
// import fetch from "node-fetch";

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!channelAccessToken) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN");
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({ channelAccessToken });

function findImageFile() {
  // Prefer JPEG (smaller) but allow PNG too
  const candidates = ["./richmenu.jpeg", "./richmenu.jpg", "./richmenu.png"];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error(
    `Rich menu image not found. Put one of these in repo root: ${candidates.join(", ")}`
  );
}

function detectMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  throw new Error(`Unsupported image extension: ${ext}`);
}

async function uploadRichMenuImage(richMenuId, filePath) {
  const buf = fs.readFileSync(filePath);
  const mime = detectMime(filePath);

  console.log(`Uploading image ${filePath} (${mime}), bytes=${buf.length}`);

  // IMPORTANT: this is the correct upload endpoint
  const res = await fetch(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        "Content-Type": mime,
      },
      body: buf,
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Image upload failed: ${res.status} ${res.statusText} ${text}`);
  }

  console.log("Image uploaded.");
}

async function deleteAllRichMenus() {
  const list = await client.getRichMenuList();
  const menus = list?.richmenus || [];

  if (menus.length === 0) {
    console.log("No existing rich menus to delete.");
    return;
  }

  console.log(`Deleting ${menus.length} rich menu(s)...`);

  for (const m of menus) {
    try {
      await client.deleteRichMenu(m.richMenuId);
      console.log(`Deleted: ${m.richMenuId}`);
    } catch (e) {
      console.log(`Delete failed for ${m.richMenuId}: ${e?.message || e}`);
    }
  }
}

async function main() {
  try {
    console.log("createRichMenu.js started");

    // Optional: wipe all old menus so nothing conflicts/caches
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
        // Top-left: Book consultation
        {
          bounds: { x: 0, y: 0, width: tileW, height: tileH },
          action: {
            type: "postback",
            data: "action=book",
            displayText: "Book consultation",
          },
        },
        // Top-right: Treatments
        {
          bounds: { x: tileW, y: 0, width: tileW, height: tileH },
          action: {
            type: "postback",
            data: "action=treatments",
            displayText: "Treatments",
          },
        },
        // Bottom-left: Promotions
        {
          bounds: { x: 0, y: tileH, width: tileW, height: tileH },
          action: {
            type: "postback",
            data: "action=promotions",
            displayText: "Current promotions",
          },
        },
        // Bottom-right: Contact clinic
        {
          bounds: { x: tileW, y: tileH, width: tileW, height: tileH },
          action: {
            type: "postback",
            data: "action=contact",
            displayText: "Contact clinic",
          },
        },
      ],
    };

    console.log("About to create rich menu...");
    const richMenuId = await client.createRichMenu(richMenu);
    console.log("Rich Menu created:", richMenuId);

    // Upload image (richmenu.jpeg/jpg/png) using correct endpoint
    const imgPath = findImageFile();
    await uploadRichMenuImage(richMenuId, imgPath);

    // Set default rich menu
    await client.setDefaultRichMenu(richMenuId);
    console.log("Set as default rich menu.");

    console.log("\nNEW DEFAULT_RICHMENU_ID =", richMenuId);
    console.log("Put that into Render env: DEFAULT_RICHMENU_ID");
  } catch (err) {
    console.error("Error:", err?.message || err);
    process.exit(1);
  }
}

main();
