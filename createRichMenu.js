import 'dotenv/config';
import fs from 'fs';
import { messagingApi } from '@line/bot-sdk';

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

async function main() {
  // 1. Create rich menu
  const richMenu = {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "Clinic Menu",
    chatBarText: "Menu",
    areas: [
      {
        bounds: { x: 0, y: 0, width: 1250, height: 843 },
        action: { type: "postback", data: "action=book" }
      },
      {
        bounds: { x: 1250, y: 0, width: 1250, height: 843 },
        action: { type: "postback", data: "action=faq" }
      },
      {
        bounds: { x: 0, y: 843, width: 1250, height: 843 },
        action: { type: "postback", data: "action=promo" }
      },
      {
        bounds: { x: 1250, y: 843, width: 1250, height: 843 },
        action: { type: "postback", data: "action=contact" }
      }
    ]
  };

  const res = await client.createRichMenu(richMenu);
  const richMenuId = res.richMenuId;

  console.log("Rich menu created:", richMenuId);

  // 2. Upload image
  const image = fs.readFileSync("./richmenu.png");
  await client.setRichMenuImage(richMenuId, image, "image/png");

  console.log("Image uploaded");

  // 3. Set as default
  await client.setDefaultRichMenu(richMenuId);
  console.log("Rich menu set as default");
}

main().catch(console.error);
