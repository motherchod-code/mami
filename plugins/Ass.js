import axios from "axios";
import yts from "yt-search";
import { Module } from "../lib/plugins.js";
import fs from "fs";
import path from "path";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { parsedJid, sleep } from "../lib/functions.js";
import { forwardOrBroadCast } from "../lib/serialize.js";

ffmpeg.setFfmpegPath(ffmpegPath);

// 🔊 waveform
const generateWaveform = (len = 60) =>
  Array.from({ length: len }, (_, i) =>
    Math.floor(Math.sin(i / 3) * 50 + 50)
  );

// 🎧 convert to voice note
const toVoiceNote = async (audioUrl) => {
  const inFile = path.join(os.tmpdir(), `in_${Date.now()}.mp3`);
  const outFile = path.join(os.tmpdir(), `out_${Date.now()}.ogg`);

  try {
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
        .audioBitrate("32k")
        .outputOptions(["-vbr on", "-compression_level 10"])
        .format("ogg")
        .on("end", resolve)
        .on("error", reject)
        .save(outFile);
    });

    const buffer = fs.readFileSync(outFile);

    return { buffer, duration };

  } finally {
    [inFile, outFile].forEach(f => {
      try { fs.existsSync(f) && fs.unlinkSync(f); } catch {}
    });
  }
};

// 🌐 fallback API
const fetchAudio = async (url) => {
  const apis = [
    "https://newapi-536w.onrender.com/api/song?url=",
    "https://api.savetube.me/audio?url="
  ];

  for (let api of apis) {
    try {
      const { data } = await axios.get(api + encodeURIComponent(url), { timeout: 20000 });
      if (data?.result?.audio) return data.result.audio;
    } catch {}
  }

  return null;
};

const isYouTubeUrl = (str) =>
  /youtube\.com|youtu\.be/.test(str);

Module({
  command: "chsong",
  package: "youtube",
  description: "Song → voice → forward to channel",
})(async (message, match) => {
  try {
    if (!match || !match.includes(",")) {
      return message.send(
        "❌ Example:\n.csong tum hi ho , 120xxx@newsletter"
      );
    }

    const [songInput, jidInput] = match.split(",").map(s => s.trim());

    const jids = parsedJid(jidInput);
    if (!jids.length) return message.send("❌ Invalid JID");

    await message.react("🔍");

    // 🔎 search video
    let video;
    if (isYouTubeUrl(songInput)) {
      const res = await yts(songInput);
      if (!res.videos.length) return message.send("❌ Invalid link");
      video = res.videos[0];
    } else {
      const res = await yts(songInput);
      if (!res.videos.length) return message.send("❌ Song not found");
      video = res.videos[0];
    }

    await message.react("⬇️");

    const audioUrl = await fetchAudio(video.url);
    if (!audioUrl) return message.send("❌ Audio fetch failed");

    // 🎴 card
    const cardMsg = await message.send({
      image: { url: video.thumbnail },
      caption:
`🎵 *Now Playing*

📌 *Title:* ${video.title}
👤 *Channel:* ${video.author.name}
⏱️ *Duration:* ${video.timestamp}`
    });

    // 📡 forward card
    for (const jid of jids) {
      await forwardOrBroadCast(jid, cardMsg);
      await sleep(1200);
    }

    await message.react("🎙️");

    // 🎧 voice
    const { buffer, duration } = await toVoiceNote(audioUrl);

    const voiceMsg = await message.send({
      audio: buffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
      seconds: duration,
      waveform: generateWaveform()
    });

    // 📡 forward voice
    for (const jid of jids) {
      await forwardOrBroadCast(jid, voiceMsg);
      await sleep(1200);
    }

    await message.react("✅");
    await message.send("✅ Sent successfully via forward!");

  } catch (err) {
    console.error("CSONG ERROR:", err);
    await message.send("❌ Error: " + err.message);
  }
});
