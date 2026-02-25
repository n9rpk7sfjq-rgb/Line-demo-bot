import 'dotenv/config';
import fs from 'fs';
import fetch from 'node-fetch';

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// 1) Rich menu layout (matches your 2x3 grid)
const richMenu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "Clinic Main Menu",
  chatBarText: "Menu",
  areas: [
    // Top row
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: "postback", data: "BOOK" }
    },
    {
      bounds: { x: 833, y: 0, width: 833, height: 843 },
      action: { type: "postback", data: "FAQ" }
    },
    {
      bounds: { x: 1666, y: 0, width: 834, height: 843 },
      action: { type: "postback", data: "PRICES" }
    },
    // Bottom row
    {
      bounds: { x: 0, y: 843, width: 833, height: 843 },
      action: { type: "postback", data: "PROMO" }
    },
    {
      bounds: { x: 833, y: 843, width: 833, height: 843 },
      action: { type: "postback", data: "LOCATIONS" }
    },
    {
      bounds: { x: 1666, y: 843, width: 834, height: 843 },
      action: { type: "postback", data: "TALK_STAFF" }
    }
  ]
};

// 2) Helper to call LINE API
async function lineApi(path, method = "GET", body = null, headers = {}) {
  const res = await fetch(`https://api.line.me/v2/bot${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      ...headers,
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${text}`);
  }
  return text;
}

async function main() {
  console.log("Creating rich menu...");

  // Create rich menu
  const createRes = await lineApi(
    "/richmenu",
    "POST",
    JSON.stringify(richMenu),
    { "Content-Type": "application/json" }
  );

  const { richMenuId } = JSON.parse(createRes);
  console.log("Rich menu created:", richMenuId);

  // Upload image (PUT YOUR IMAGE FILE NAME HERE)
  const imagePath = "./richmenu.png"; // <-- rename your menu image to this
  const imageBuffer = fs.readFileSync(imagePath);

  await lineApi(
    `/richmenu/${richMenuId}/content`,
    "POST",
    imageBuffer,
    { "Content-Type": "image/png" }
  );

  console.log("Image uploaded");

  // Set as default
  await lineApi(`/user/all/richmenu/${richMenuId}`, "POST");
  console.log("Rich menu set as default ✅");
}

main().catch(err => {
  console.error("Error:", err.message);
});
