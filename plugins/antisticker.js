// plugins/antisticker.js
import { Module } from "../lib/plugins.js";
import { db } from "../lib/client.js";

const DEBUG = true;
const debug = (...args) => DEBUG && console.debug("[antisticker]", ...args);

// ===== UTIL =====
function getBotNumberFromConn(conn) {
  const id = conn?.user?.id || conn?.user?.jid || conn?.user || null;
  if (!id) return "unknown";
  return String(id).split("@")[0];
}

function enabledKeyFor(groupJid) {
  return `antisticker:${groupJid}:enabled`;
}
function modeKeyFor(groupJid) {
  return `antisticker:${groupJid}:mode`;
}

// ===== COMMAND =====
Module({
  command: "antisticker",
  package: "owner",
  aliases: ["antistick", "nosticker"],
  description: "Enable/disable anti-sticker or set mode",
})(async (message, match) => {
  try {
    if (!(message.isFromMe || message.isfromMe)) {
      return message.send("_Only bot owner can use this command._");
    }

    if (!message.isGroup)
      return message.send("❌ This command works only in groups.");

    await message.loadGroupInfo?.();

    const botNumber = getBotNumberFromConn(message.conn);
    const groupJid = message.from;
    const raw = (match || "").trim().toLowerCase();

    const enabledKey = enabledKeyFor(groupJid);
    const modeKey = modeKeyFor(groupJid);

    // 📊 STATUS
    if (!raw) {
      const isEnabled = db.get(botNumber, enabledKey, false) === true;
      const mode = String(db.get(botNumber, modeKey, "delete") || "delete");
      return message.send(
        `⚙️ AntiSticker\n• Status: ${isEnabled ? "✅ ON" : "❌ OFF"}\n• Mode: ${mode.toUpperCase()}\n\nUsage:\n.antisticker on\n.antisticker off\n.antisticker kick\n.antisticker delete\n.antisticker warn\n.antisticker null`
      );
    }

    // ON
    if (raw === "on") {
      db.setHot(botNumber, enabledKey, true);

      let mode = db.get(botNumber, modeKey, null);
      if (!mode) {
        mode = "delete";
        db.setHot(botNumber, modeKey, mode);
      }

      return message.send(`✅ AntiSticker enabled (${mode.toUpperCase()})`);
    }

    // OFF
    if (raw === "off") {
      db.setHot(botNumber, enabledKey, false);
      return message.send("❌ AntiSticker disabled");
    }

    // MODE
    if (["kick", "delete", "warn", "null", "remove"].includes(raw)) {
      const mode = raw === "remove" ? "kick" : raw;
      db.setHot(botNumber, modeKey, mode);

      const isEnabled = db.get(botNumber, enabledKey, false);
      if (!isEnabled) db.setHot(botNumber, enabledKey, true);

      return message.send(`✅ Mode set to ${mode.toUpperCase()}`);
    }

    return message.send("Invalid option");
  } catch (err) {
    console.error("AntiSticker command error:", err);
  }
});

// ===== ENFORCEMENT =====
Module({
  on: "message",
  package: "group",
  description: "Anti-sticker enforcement",
})(async (message) => {
  try {
    if (!message || !message.isGroup) return;

    // ✅ STICKER DETECT (Baileys safe)
    const isSticker =
      message.type === "stickerMessage" ||
      message.message?.stickerMessage;

    if (!isSticker) return;

    debug("Sticker detected");

    const botNumber = getBotNumberFromConn(message.conn);
    const groupJid = message.from;

    const enabled = db.get(botNumber, enabledKeyFor(groupJid), false);
    if (!enabled) return;

    await message.loadGroupInfo?.();

    // ✅ ADMIN CHECK
    const participants = message.groupMetadata?.participants || [];
    const botId = message.conn.user.id;

    const botIsAdmin = participants.find(p => p.id === botId)?.admin;
    const senderIsAdmin = participants.find(p => p.id === message.sender)?.admin;

    if (!botIsAdmin) return;
    if (senderIsAdmin) return;

    // ✅ DELETE MESSAGE
    try {
      await message.conn.sendMessage(message.from, {
        delete: {
          remoteJid: message.from,
          fromMe: false,
          id: message.key.id,
          participant: message.key.participant || message.sender,
        },
      });
    } catch (e) {
      debug("Delete failed", e);
    }

    const senderJid = message.sender;
    const senderNum = senderJid.split("@")[0];

    let mode = db.get(botNumber, modeKeyFor(groupJid), "delete");

    // ===== MODES =====

    if (mode === "null") return;

    if (mode === "delete") {
      await message.send(
        `🚫 @${senderNum}, stickers not allowed!`,
        { mentions: [senderJid] }
      );
      return;
    }

    if (mode === "warn") {
      await message.send(
        `⚠️ @${senderNum}, warning! No stickers allowed.`,
        { mentions: [senderJid] }
      );
      return;
    }

    if (mode === "kick") {
      await message.send(
        `🚫 @${senderNum} will be removed (sticker violation)`,
        { mentions: [senderJid] }
      );

      await new Promise(r => setTimeout(r, 800));

      try {
        await message.conn.groupParticipantsUpdate(
          message.from,
          [senderJid],
          "remove"
        );
      } catch (err) {
        console.error("Kick failed:", err);

        await message.send(
          `❌ Failed to remove @${senderNum}`,
          { mentions: [senderJid] }
        );
      }
    }

  } catch (err) {
    console.error("AntiSticker enforcement error:", err);
  }
});
