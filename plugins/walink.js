import axios from "axios";
import { Module } from "../lib/plugins.js";

Module({
  command: "walink",
  package: "tools",
  aliases: ["wlink", "wplink"],
  description: "Create WhatsApp link for any number. .walink 917439382677 hi there",
})(async (message, match) => {
  if (!match) return message.send(
    `❌ Usage:\n.walink <number> <message>\n\nExample:\n.walink 917439382677 Hello!`
  );

  const parts = match.trim().split(" ");
  const number = parts[0].replace(/[^0-9]/g, "");
  const text = parts.slice(1).join(" ") || "Hi";

  if (!number || number.length < 7)
    return message.send("❌ Invalid number");

  try {
    await message.react("⏳");

    // API: https://apiskeith.top/tools/walink?q=<msg>&number=<num>
    // Response: { status: true, result: { shortUrl: "https://wa.link/..." } }
    const { data } = await axios.get(
      `https://apiskeith.top/tools/walink?q=${encodeURIComponent(text)}&number=${number}`,
      { timeout: 15000 }
    );

    if (!data?.status || !data?.result?.shortUrl)
      return message.send("❌ Failed to create link");

    await message.send(
      `🔗 *WhatsApp Link Created!*\n\n` +
      `📱 *Number:* +${number}\n` +
      `💬 *Message:* ${text}\n\n` +
      `🌐 *Short Link:* ${data.result.shortUrl}\n\n` +
      `_Pᴏᴡᴇʀᴇᴅ ʙʏ sᴀʏᴀɴ-Xᴍᴅ_`
    );
    await message.react("✅");
  } catch (err) {
    console.error("[WALINK ERROR]", err?.message);
    await message.react("❌");
    await message.send("⚠️ Failed to create WhatsApp link");
  }
});
