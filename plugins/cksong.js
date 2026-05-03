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
  Array.from({ length: 80 }, () => Math.floor(Math.random() * 100));

// 🔗 Resolve Channel
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
  } catch {}
  return null;
};

const isYouTubeUrl = (str) =>
  /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(str.trim());

// 🎧 Convert + watermark
const toVoiceNote = async (audioUrl) => {
  const id = Date.now();
  const inFile = path.join(os.tmpdir(), `in_${id}.mp3`);
  const tagFile = path.join(os.tmpdir(), `tag_${id}.mp3`);
  const outFile = path.join(os.tmpdir(), `out_${id}.ogg`);

  // download main audio
  const { data } = await axios.get(audioUrl, {
    responseType: "stream",
  });

  const writer = fs.createWriteStream(inFile);
  data.pipe(writer);
  await new Promise((res, rej) => {
    writer.on("finish", res);
    writer.on("error", rej);
  });

  // 🔊 watermark TTS
  try {
    const text = "Powered by Rabbit Bot";
    const tts = await axios.get(
      `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
        text
      )}&tl=en&client=tw-ob`,
      { responseType: "stream" }
    );

    const ttsWriter = fs.createWriteStream(tagFile);
    tts.data.pipe(ttsWriter);
    await new Promise((r) => ttsWriter.on("finish", r));
  } catch {
    console.log("TTS failed");
  }

  // duration
  const duration = await new Promise((resolve) => {
    ffmpeg.ffprobe(inFile, (err, meta) => {
      resolve(!err ? Math.ceil(meta?.format?.duration || 10) : 10);
    });
  });

  // 🎛️ ffmpeg mix
  await new Promise((resolve, reject) => {
    let cmd = ffmpeg(inFile).audioCodec("libopus").format("ogg");

    if (fs.existsSync(tagFile)) {
      cmd = cmd
        .input(tagFile)
        .complexFilter([
          "[1:a]adelay=1000|1000,volume=1.8[tag]",
          "[0:a][tag]amix=inputs=2:duration=first",
        ]);
    }

    cmd
      .on("end", resolve)
      .on("error", reject)
      .save(outFile);
  });

  const stream = fs.createReadStream(outFile);

  // cleanup later
  return {
    stream,
    duration,
    files: [inFile, tagFile, outFile],
  };
};

Module({
  command: "cksong",
  package: "youtube",
  description: "Song → voice note → channel (with watermark)",
  usage: ".csong song , channel",
})(async (message, match) => {
  let tempFiles = [];

  try {
    if (!match || !match.includes(",")) {
      return message.send(
        "❌ Example:\n.csong love nwantiti , https://whatsapp.com/channel/xxx"
      );
    }

    const [songInput, channelInput] = match.split(",").map((s) => s.trim());

    await message.react("🔍");

    const channelJid = await resolveChannelJid(channelInput, message);
    if (!channelJid) return message.send("❌ Invalid channel");

    let video;

    if (isYouTubeUrl(songInput)) {
      const res = await yts({ videoId: songInput.split("v=")[1] });
      video = res;
    } else {
      const res = await yts(songInput);
      if (!res.videos.length) return message.send("❌ Not found");
      video = res.videos[0];
    }

    await message.react("⬇️");

    const api =
      "https://newapi-536w.onrender.com/api/song?url=" +
      encodeURIComponent(video.url);

    const { data } = await axios.get(api);

    if (!data?.result?.audio) return message.send("❌ Download failed");

    // 🎴 Card
    const card = {
      image: { url: video.thumbnail },
      caption: `🎵 *Now Playing*\n\n📌 ${video.title}\n👤 ${video.author.name}\n⏱️ ${video.timestamp}`,
    };

    await message.send(card);
    await message.conn.sendMessage(channelJid, card);

    await message.react("🎙️");

    // 🎧 Convert
    const { stream, duration, files } = await toVoiceNote(
      data.result.audio
    );
    tempFiles.push(...files);

    await message.react("📤");

    await message.conn.sendMessage(channelJid, {
      audio: stream,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
      seconds: duration,
      waveform: generateWaveform(),
    });

    await message.react("✅");
    await message.send(`✅ Sent: ${video.title}`);

  } catch (err) {
    console.error(err);
    message.send("❌ Error: " + err.message);
  } finally {
    tempFiles.forEach((f) => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
  }
});
