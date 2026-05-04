import { Module } from '../lib/plugins.js';
import axios from 'axios';
import FormData from 'form-data';

// mime helper
const mimeExtMap = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
  'application/pdf': 'pdf', 'text/plain': 'txt',
  'image/svg+xml': 'svg',
};

const mime = {
  extension: (type) =>
    mimeExtMap[type?.split(';')[0].trim()] || 'bin'
};

Module({
  command: "url",
  package: "converter",
  description: "Upload media to URL",
}, async (message) => {

  try {
    const quoted = message.quoted || message;

    const msgType =
      quoted.type ||
      Object.keys(quoted.message || {})[0];

    if (!msgType) return message.send("_Reply to media_");

    const supported = [
      "imageMessage",
      "videoMessage",
      "audioMessage",
      "documentMessage",
      "stickerMessage",
    ];

    if (!supported.includes(msgType)) {
      return message.send("❌ Unsupported media type");
    }

    await message.react("⏳");

    // ================= DOWNLOAD =================
    const buffer = await quoted.download().catch(() => null);
    if (!buffer) throw new Error("Media download failed");

    if (buffer.length > 200 * 1024 * 1024) {
      return message.send("❌ File too large (Max 200MB)");
    }

    // ================= MIME =================
    const mimeType =
      quoted.mimetype ||
      quoted.msg?.mimetype ||
      "application/octet-stream";

    const ext = mime.extension(mimeType);
    const fileName = `file_${Date.now()}.${ext}`;

    let mediaUrl = null;

    // ================= BANDHELI CDN (PRIMARY) =================
    try {
      const form = new FormData();
      form.append("file", buffer, {
        filename: fileName,
        contentType: mimeType
      });

      const res = await axios.post(
        "https://bandaheali-cdn.koyeb.app/quick-upload",
        form,
        {
          headers: {
            ...form.getHeaders()
          },
          timeout: 60000,
          maxBodyLength: Infinity
        }
      );

      if (!res.data || !res.data.success || !res.data.url) {
        throw new Error(res.data?.error || "Bandheli upload failed");
      }

      mediaUrl = res.data.url;

    } catch (bandErr) {

      // ================= CATBOX FALLBACK =================
      try {
        const form = new FormData();
        form.append("reqtype", "fileupload");
        form.append("fileToUpload", buffer, {
          filename: fileName,
          contentType: mimeType
        });

        const res = await axios.post(
          "https://catbox.moe/user/api.php",
          form,
          {
            headers: {
              ...form.getHeaders()
            },
            timeout: 60000,
            maxBodyLength: Infinity
          }
        );

        if (
          !res.data ||
          typeof res.data !== "string" ||
          res.data.toLowerCase().includes("error")
        ) {
          throw new Error(res.data || "Catbox failed");
        }

        mediaUrl = res.data.trim();

      } catch (catErr) {

        // ================= TELEGRAPH (LAST FALLBACK) =================
        if (mimeType.startsWith("image/")) {
          const form = new FormData();
          form.append("file", buffer, {
            filename: fileName,
            contentType: mimeType
          });

          const res = await axios.post(
            "https://telegra.ph/upload",
            form,
            {
              headers: {
                ...form.getHeaders()
              }
            }
          );

          if (res.data && res.data[0]?.src) {
            mediaUrl = "https://telegra.ph" + res.data[0].src;
          } else {
            throw new Error("Telegraph upload failed");
          }

        } else {
          throw new Error("All upload methods failed");
        }
      }
    }

    // ================= TYPE FORMAT =================
    let mediaType = "File";

    if (msgType === "imageMessage") mediaType = "Image";
    else if (msgType === "videoMessage") mediaType = "Video";
    else if (msgType === "audioMessage") mediaType = "Audio";
    else if (msgType === "documentMessage") mediaType = "Document";
    else if (msgType === "stickerMessage") mediaType = "Sticker";

    const styleMap = {
      Audio: "Aᴜᴅɪᴏ",
      Video: "Vɪᴅᴇᴏ",
      Image: "Iᴍᴀɢᴇ",
      Document: "Dᴏᴄᴜᴍᴇɴᴛ",
      Sticker: "Sᴛɪᴄᴋᴇʀ",
      File: "Fɪʟᴇ"
    };

    const styledType = styleMap[mediaType] || "Fɪʟᴇ";

    // ================= RESPONSE =================
    const msg = `
╭━━━「 *𝐔ᴘʟᴏᴀᴅ 𝐒ᴜᴄᴄᴇss* 」━━━┈⊷
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
    console.error("UPLOAD ERROR:", err);
    await message.react("❌");
    await message.send(`❌ Upload Failed\n\n_${err.message}_`);
  }
});
