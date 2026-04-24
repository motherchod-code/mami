import axios from "axios";
import yts from "yt-search";
import { Module } from "../lib/plugins.js";

Module({
  command: "play",
  package: "youtube",
  description: "Play song from YouTube",
})(async (message, match) => {
  try {
    if (!match) return message.send("❌ Enter song name\n\n.play love nwantiti");

    await message.react("🔍");

    const res = await yts(match);
    if (!res.videos || res.videos.length === 0)
      return message.send("❌ Song not found");

    const video = res.videos[0];

    const caption = `🎵 *Now Playing*\n\nPᴏᴡᴇʀᴇᴅ Bʏ sᴀʏᴀɴ - xᴍᴅ\n\n📌 *Title:* ${video.title}\n👤 *Channel:* ${video.author.name}\n⏱️ *Duration:* ${video.timestamp}\n\n⬇️ *Downloading audio...*`.trim();

    await message.send({
      image: { url: video.thumbnail },
      caption,
      mimetype: "image/jpeg",
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: "120363418088880523@newsletter",
          newsletterName: "sᴀʏᴀɴ -Xᴍᴅ",
          serverMessageId: 6,
        },
      },
    });

    // New API: https://newapi-rypa.onrender.com/download/audio?url=...
    // Response: { status: true, creator: "...", link: "...mp3" }
    const apiUrl = `https://newapi-rypa.onrender.com/download/api/song?url=${encodeURIComponent(video.url)}`;
    const { data } = await axios.get(apiUrl, { timeout: 40000 });

    if (!data?.status || !data?.link)
      return message.send("❌ Audio download failed");

    await message.send({
      audio: { url: data.link },
      mimetype: "audio/mpeg",
      fileName: `${video.title}.mp3`,
      contextInfo: {
        externalAdReply: {
          title: video.title,
          body: "Powered By sᴀʏᴀɴ - xᴍᴅ",
          mediaType: 2,
          sourceUrl: video.url,
          thumbnailUrl: video.thumbnail,
        },
      },
    });

    await message.react("🎧");
  } catch (err) {
    console.error("[PLAY ERROR]", err);
    await message.send("⚠️ Play failed");
  }
});
