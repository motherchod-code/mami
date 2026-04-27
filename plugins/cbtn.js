
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

const toVoiceNote = async (audioUrl) => {
  const inFile = path.join(os.tmpdir(), `play_in_${Date.now()}.mp3`);
  const outFile = path.join(os.tmpdir(), `play_out_${Date.now()}.ogg`);

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
  command: "uplay",
  package: "youtube",
  description: "Play song from YouTube (voice note + waveform + preview)",
})(async (message, match) => {
  try {
    if (!match) {
      return message.send("❌ Enter song name\n\n.play love nwantiti");
    }

    await message.react("🔍");

    // Search YouTube
    const res = await yts(match);
    if (!res.videos || res.videos.length === 0) {
      return message.send("❌ Song not found");
    }

    const video = res.videos[0];

    // 1️⃣ Thumbnail card
    await message.send({
      image: { url: video.thumbnail },
      caption: `🎵 *Now Playing*\n\nPᴏᴡᴇʀᴇᴅ Bʏ ᴍʀ ʀᴀʙʙɪᴛ\n\n📌 *Title:* ${video.title}\n👤 *Channel:* ${video.author.name}\n⏱️ *Duration:* ${video.timestamp}\n\n⬇️ *Downloading...*`.trim(),
      mimetype: "image/jpeg",
    });

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

    // Thumbnail buffer download
    const thumbBuffer = await axios
      .get(video.thumbnail, { responseType: "arraybuffer", timeout: 10000 })
      .then((r) => Buffer.from(r.data))
      .catch(() => undefined);

    // 2️⃣ Voice note + waveform + linkPreview
    await message.conn.sendMessage(message.key.remoteJid, {
      audio: voiceBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
      seconds: duration,
      waveform: waveform,
      contextInfo: {
        externalAdReply: {
          title: video.title,
          body: `Pᴏᴡᴇʀᴇᴅ Bʏ ᴍʀ ʀᴀʙʙɪᴛ`,
          mediaType: 1,
          thumbnailUrl: video.thumbnail,
          thumbnail: thumbBuffer,
          sourceUrl: video.url,
          showAdAttribution: false,
          renderLargerThumbnail: true,
          containsAutoReply: false,
        },
        forwardingScore: 0,
        isForwarded: false,
      },
    });

    await message.react("🎧");

  } catch (err) {
    console.error("[PLAY ERROR]", err);
    if (err.code === "ECONNABORTED") {
      await message.send("⏳ Server timeout, try again");
    } else {
      await message.send("⚠️ Play failed: " + err.message);
    }
  }
});
```
