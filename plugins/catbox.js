import { Module } from '../lib/plugins.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import FormData from 'form-data';
// FIX: inline mime helper (mime-types not in package.json)
const mimeExtMap = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
  'application/pdf': 'pdf', 'text/plain': 'txt',
  'image/svg+xml': 'svg',
};
const mime = { extension: (type) => mimeExtMap[type?.split(';')[0].trim()] || 'bin' };

// ==================== UTILS ====================

function formatBytes(bytes, decimals = 2) {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ==================== MAIN UPLOADER ====================

Module({
  command: "url",
  package: "converter",
  description: "Upload media to URL",
})(async (message) => {
  let tempFilePath;

  try {
    const quotedMsg = message.quoted || message;
    const mimeType = quotedMsg.content?.mimetype || "";

    if (!quotedMsg.type) {
      return message.send("_Reply to media_");
    }

    const supported = [
      "imageMessage",
      "videoMessage",
      "audioMessage",
      "documentMessage",
      "stickerMessage",
    ];

    if (!supported.includes(quotedMsg.type)) {
      return message.send("❌ Unsupported media");
    }

    await message.react("⏳");

    const buffer = await quotedMsg.download();

    if (!buffer || buffer.length === 0) {
      throw new Error("Download failed");
    }

    if (buffer.length > 200 * 1024 * 1024) {
      return message.send("❌ File too large (Max 200MB)");
    }

    // Extension
    const ext = mime.extension(mimeType) || "bin";
    const fileName = `file_${Date.now()}.${ext}`;

    tempFilePath = path.join(os.tmpdir(), fileName);
    fs.writeFileSync(tempFilePath, buffer);

    let mediaUrl;

    // ================= CATBOX =================
    try {
      const form = new FormData();
      form.append("fileToUpload", fs.createReadStream(tempFilePath));
      form.append("reqtype", "fileupload");

      const res = await axios.post(
        "https://catbox.moe/user/api.php",
        form,
        { headers: form.getHeaders(), timeout: 30000 }
      );

      if (!res.data || res.data.includes("error")) {
        throw new Error("Catbox failed");
      }

      mediaUrl = res.data.trim();

    } catch {
      // ================= TELEGRAPH FALLBACK =================
      if (quotedMsg.type === "imageMessage") {
        const form = new FormData();
        form.append("file", fs.createReadStream(tempFilePath));

        const res = await axios.post(
          "https://telegra.ph/upload",
          form,
          { headers: form.getHeaders() }
        );

        if (res.data && res.data[0]?.src) {
          mediaUrl = "https://telegra.ph" + res.data[0].src;
        } else {
          throw new Error("Upload failed");
        }
      } else {
        throw new Error("Catbox failed");
      }
    }

    // ================= MEDIA TYPE =================

    let mediaType = "File";
    if (quotedMsg.type === "imageMessage") mediaType = "Image";
    else if (quotedMsg.type === "videoMessage") mediaType = "Video";
    else if (quotedMsg.type === "audioMessage") mediaType = "Audio";
    else if (quotedMsg.type === "documentMessage") mediaType = "Document";
    else if (quotedMsg.type === "stickerMessage") mediaType = "Sticker";

    // Stylish mapping
    const styleMap = {
      Audio: "Aᴜᴅɪᴏ",
      Video: "Vᴇᴅɪᴏ",
      Image: "Iᴍᴀɢᴇ",
      Document: "Dᴏᴄᴜᴍᴇɴᴛ",
      Sticker: "Sᴛɪᴄᴋᴇʀ",
      File: "Fɪʟᴇ"
    };

    const styledType = styleMap[mediaType] || "Fɪʟᴇ";

    // ================= MESSAGE =================

    const msg = `
╭━━━「 *𝐔ᴘʟᴏᴀᴅ 𝐒ᴜᴄsᴇss* 」━━━┈⊷
┃
┃ ✅ *${styledType} Uᴘʟᴏᴀᴅᴇᴅ*
┃
┃ 🔗 *𝐔ʀʟ*
┃ ${mediaUrl}
┃
╰━━━━━━━━━━━━━━━━━━━┈⊷`.trim();

    await message.send(msg);
    await message.react("✅");

  } catch (err) {
    console.error(err);
    await message.react("❌");
    await message.send(`❌ Upload Failed\n\n_${err.message}_`);

  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
});
