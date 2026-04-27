import axios from "axios";
import yts from "yt-search";
import { Module } from "../lib/plugins.js";
import fs from "fs";
import path from "path";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

ffmpeg.setFfmpegPath(ffmpegPath);

const generateWaveform = () =>
  Array.from({ length: 100 }, () => Math.floor(Math.random() * 101));

const resolveChannelJid = async (input, message) => {
  input = input.trim();
  if (input.includes("@newsletter")) return input;
  try {
    const url = new URL(input);
    if (url.pathname.startsWith("/channel/")) {
      const code = url.pathname.split("/channel/")[1];
      const res = await message.conn.newsletterMetadata("invite", code, "GUEST");
      return res.id;
    }
  } catch (_) {}
  return null;
};

const isYouTubeUrl = (str) =>
  /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(str.trim());

const toVoiceNote = async (audioUrl) => {
  const inFile = path.join(os.tmpdir(), `csong_in_${Date.now()}.mp3`);
  const outFile = path.join(os.tmpdir(), `csong_out_${Date.now()}.ogg`);

  const { data } = await axios.get(audioUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
  });
  fs.writeFileSync(inFile, Buffer.from(data));

  const duration = await new Promise((resolve) => {
    ffmpeg.ffprobe(inFile, (err, meta) => {
      resolve(!err ? Math.ceil(meta?.format?.duration || 10) : 10);
    });
  });

  await new Promise((resolve, reject) => {
    ffmpeg(inFile)
      .audioCodec("libopus")
      .audioBitrate("48k")
      .noVideo()
      .format("ogg")
      .on("error", reject)
      .on("end", resolve)
      .save(outFile);
  });

  const buffer = fs.readFileSync(outFile);
  try { fs.unlinkSync(inFile); } catch {}
  try { fs.unlinkSync(outFile); } catch {}

  return { buffer, duration };
};

// ✏️ তোমার group invite link এখানে দাও
const GROUP_LINK = "https://chat.whatsapp.com/YOUR_GROUP_INVITE_LINK";

Module({
  command: "cbtn",
  package: "youtube",
  description: "Download song → voice note → send to channel",
  usage: ".csong <song name / yt link> , <channel jid / channel link>",
})(async (message, match) => {
  try {
    if (!match) {
      return message.send(
        "❌ Usage:\n.csong love nwantiti , 120363418088880523@newsletter\n.csong https://youtu.be/xxx , https://whatsapp.com/channel/xxx"
      );
    }

    const lastComma = match.lastIndexOf(",");
    if (lastComma === -1) {
      return message.send(
        "❌ Use comma to separate song and channel\n\nExample:\n.csong song name , channel_jid"
      );
    }

    const songInput = match.slice(0, lastComma).trim();
    const channelInput = match.slice(lastComma + 1).trim();

    if (!songInput) return message.send("❌ Enter song name or YouTube link");
    if (!channelInput) return message.send("❌ Enter channel JID or link");

    await message.react("🔍");

    const channelJid = await resolveChannelJid(channelInput, message);
    if (!channelJid) {
      return message.send("❌ Invalid channel JID or link");
    }

    let video;
    if (isYouTubeUrl(songInput)) {
      const videoId = songInput.match(/(?:v=|youtu\.be\/)([^&?/]+)/)?.[1] || "";
      const res = await yts({ videoId });
      if (res?.title) {
        video = {
          title: res.title,
          author: { name: res.author?.name || "Unknown" },
          timestamp: res.timestamp || "?",
          thumbnail: res.thumbnail || "",
          url: songInput,
        };
      } else {
        video = {
          title: "Unknown Title",
          author: { name: "Unknown" },
          timestamp: "?",
          thumbnail: "",
          url: songInput,
        };
      }
    } else {
      const res = await yts(songInput);
      if (!res.videos || res.videos.length === 0) {
        return message.send("❌ Song not found");
      }
      video = res.videos[0];
    }

    await message.react("⬇️");

    const apiUrl =
      "https://newapi-rypa.onrender.com/api/song?url=" +
      encodeURIComponent(video.url);

    const { data } = await axios.get(apiUrl, { timeout: 30000 });

    if (!data || !data.status || !data.result?.audio) {
      return message.send("❌ Audio download failed");
    }

    const channelInviteCode = channelJid.replace("@newsletter", "");
    const channelLink = `https://whatsapp.com/channel/${channelInviteCode}`;

    // Button card (inbox only)
    const cardProto = {
      buttonsMessage: {
        contentText: `🎵 *Now Playing*\n\nPᴏᴡᴇʀᴇᴅ Bʏ ᴍʀ ʀᴀʙʙɪᴛ\n\n📌 *Title:* ${video.title}\n👤 *Channel:* ${video.author.name}\n⏱️ *Duration:* ${video.timestamp}`,
        footerText: "🎵 Powered By ᴍʀ ʀᴀʙʙɪᴛ",
        buttons: [
          {
            buttonId: "btn1",
            buttonText: { displayText: "▶ Play On YouTube 🌻" },
            type: 5,
            nativeFlowInfo: {
              name: "cta_url",
              paramsJson: JSON.stringify({
                display_text: "▶ Play On YouTube 🌻",
                url: video.url,
              }),
            },
          },
          {
            buttonId: "btn2",
            buttonText: { displayText: "➡ WhatsApp Channel 🌷" },
            type: 5,
            nativeFlowInfo: {
              name: "cta_url",
              paramsJson: JSON.stringify({
                display_text: "➡ WhatsApp Channel 🌷",
                url: channelLink,
              }),
            },
          },
          {
            buttonId: "btn3",
            buttonText: { displayText: "⇌ Chat Group 🥹" },
            type: 5,
            nativeFlowInfo: {
              name: "cta_url",
              paramsJson: JSON.stringify({
                display_text: "⇌ Chat Group 🥹",
                url: GROUP_LINK,
              }),
            },
          },
        ],
        headerType: 4,
      },
    };

    // 1️⃣ Channel — image card (button ছাড়া)
    await message.conn.sendMessage(channelJid, {
      image: { url: video.thumbnail },
      caption: `🎵 *Now Playing*\n\nPᴏᴡᴇʀᴇᴅ Bʏ ᴍʀ ʀᴀʙʙɪᴛ\n\n📌 *Title:* ${video.title}\n👤 *Channel:* ${video.author.name}\n⏱️ *Duration:* ${video.timestamp}\n\n▶ ${video.url}`.trim(),
      contextInfo: {
        forwardingScore: 0,
        isForwarded: false,
      },
    });

    // 2️⃣ User inbox — button সহ card
    await message.sendButton(cardProto);

    await message.react("🎙️");

    // Convert to voice note
    const { buffer: voiceBuffer, duration } = await toVoiceNote(data.result.audio);
    const waveform = generateWaveform();

    await message.react("📤");

    // 3️⃣ Voice note → channel only
    await message.conn.sendMessage(channelJid, {
      audio: voiceBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
      seconds: duration,
      waveform: waveform,
      contextInfo: {
        forwardingScore: 0,
        isForwarded: false,
      },
    });

    await message.react("✅");
    await message.send(
      `✅ *Sent to channel!*\n\n🎵 *${video.title}*\n👤 ${video.author.name}\n⏱️ ${video.timestamp}`
    );

  } catch (err) {
    console.error("[CSONG ERROR]", err);
    if (err.code === "ECONNABORTED") {
      await message.send("⏳ Server timeout, try again");
    } else {
      await message.send("⚠️ csong failed: " + err.message);
    }
  }
});
