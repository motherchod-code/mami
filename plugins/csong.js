import axios from "axios";
import yts from "yt-search";
import { Module } from "../lib/plugins.js";
import { jidNormalizedUser } from "@whiskeysockets/baileys";
import fs from "fs";
import path from "path";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

ffmpeg.setFfmpegPath(ffmpegPath);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const generateWaveform = () =>
  Array.from({ length: 100 }, () => Math.floor(Math.random() * 101));

// Channel link → JID resolver
const resolveChannelJid = async (input, message) => {
  input = input.trim();

  // Already a JID
  if (input.includes("@newsletter")) return input;

  // Channel invite link
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

// Audio → OGG voice note converter
const toVoiceNote = async (audioUrl) => {
  const inFile = path.join(os.tmpdir(), `csong_in_${Date.now()}.mp3`);
  const outFile = path.join(os.tmpdir(), `csong_out_${Date.now()}.ogg`);

  const { data } = await axios.get(audioUrl, { responseType: "arraybuffer", timeout: 30000 });
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
  description: "Download song → voice note → forward to channel",
  usage: ".csong <song name> | <channel jid / channel link>",
})(async (message, match) => {
  try {
    if (!match) {
      return message.send(
        "❌ Usage:\n.csong love nwantiti | 120363418088880523@newsletter\n.csong song name | https://whatsapp.com/channel/xxxx"
      );
    }

    // Parse input: split by last "|"
    const lastPipe = match.lastIndexOf("|");
    if (lastPipe === -1) {
      return message.send("❌ Provide channel JID or link after `|`\n\nExample:\n.csong song name | 120363418088880523@newsletter");
    }

    const songName = match.slice(0, lastPipe).trim();
    const channelInput = match.slice(lastPipe + 1).trim();

    if (!songName) return message.send("❌ Enter song name");
    if (!channelInput) return message.send("❌ Enter channel JID or link");

    await message.react("🔍");

    // Resolve channel JID
    const channelJid = await resolveChannelJid(channelInput, message);
    if (!channelJid) {
      return message.send("❌ Invalid channel JID or link");
    }

    // Search YouTube
    const res = await yts(songName);
    if (!res.videos || res.videos.length === 0) {
      return message.send("❌ Song not found");
    }

    const video = res.videos[0];
    await message.react("⬇️");

    // API download
    const apiUrl =
      "https://newapi-rypa.onrender.com/api/song?url=" +
      encodeURIComponent(video.url);

    const { data } = await axios.get(apiUrl, { timeout: 30000 });

    if (!data || !data.status || !data.result?.audio) {
      return message.send("❌ Audio download failed");
    }

    await message.react("🎙️");

    // Convert to voice note
    const { buffer: voiceBuffer, duration } = await toVoiceNote(data.result.audio);
    const waveform = generateWaveform();

    await message.react("📤");

    // Send to channel WITHOUT forward tag
    await message.conn.sendMessage(channelJid, {
      audio: voiceBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
      seconds: duration,
      waveform: waveform,
      contextInfo: {
        externalAdReply: {
          title: video.title,
          body: `🎵 ${video.author.name} • ${video.timestamp}`,
          mediaType: 2,
          sourceUrl: video.url,
          thumbnailUrl: video.thumbnail,
        },
        forwardingScore: 0,
        isForwarded: false,
      },
    });

    await message.react("✅");
    await message.send(
      `✅ *Song sent to channel!*\n\n🎵 *${video.title}*\n👤 ${video.author.name}\n⏱️ ${video.timestamp}`
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
