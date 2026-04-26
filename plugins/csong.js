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

// Channel link → JID
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

// YouTube link check
const isYouTubeUrl = (str) =>
  /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(str.trim());

// Audio → OGG voice note
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

Module({
  command: "csong",
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

    // Split by last comma
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

    // Resolve channel JID
    const channelJid = await resolveChannelJid(channelInput, message);
    if (!channelJid) {
      return message.send("❌ Invalid channel JID or link");
    }

    // Search or use direct URL
    let video;
    if (isYouTubeUrl(songInput)) {
      const res = await yts({ videoId: songInput.match(/(?:v=|youtu\.be\/)([^&?/]+)/)?.[1] || "" });
      video = res || null;
      // fallback: use URL directly
      if (!video?.title) {
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

    // API download
    const apiUrl =
      "https://newapi-rypa.onrender.com/api/song?url=" +
      encodeURIComponent(video.url);

    const { data } = await axios.get(apiUrl, { timeout: 30000 });

    if (!data || !data.status || !data.result?.audio) {
      return message.send("❌ Audio download failed");
    }

    // 1️⃣ Now Playing card → user chat
    await message.send({
      image: { url: video.thumbnail },
      caption: `🎵 *Now Playing*\n\nPᴏᴡᴇʀᴇᴅ Bʏ ᴍʀ ʀᴀʙʙɪᴛ\n\n📌 *Title:* ${video.title}\n👤 *Channel:* ${video.author.name}\n⏱️ *Duration:* ${video.timestamp}`.trim(),
      mimetype: "image/jpeg",
    });

    await message.react("🎙️");

    // Convert to voice note
    const { buffer: voiceBuffer, duration } = await toVoiceNote(data.result.audio);
    const waveform = generateWaveform();

    await message.react("📤");

    // 2️⃣ Only voice note → channel
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
