// plugins/antisticker.js
import { Module } from "../lib/plugins.js";
import { db } from "../lib/client.js";

const DEBUG = true;
const debug = (...args) => DEBUG && console.debug("[antisticker]", ...args);

// Utility: bot JID থেকে number বের করো
function getBotNumberFromConn(conn) {
  const id = conn?.user?.id || conn?.user?.jid || conn?.user || null;
  if (!id) return "unknown";
  return String(id).split("@")[0];
}

// DB key helpers
function enabledKeyFor(groupJid) {
  return `antisticker:${groupJid}:enabled`;
}
function modeKeyFor(groupJid) {
  return `antisticker:${groupJid}:mode`;
}

// ---------- Command handler ----------
Module({
  command: "antistick",
  package: "owner",
  aliases: ["antistick", "nosticker"],
  description:
    "Enable/disable anti-sticker for this group or set mode (kick/delete/warn/null). Default: delete",
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

    // Status দেখাও (কোনো argument ছাড়া)
    if (!raw) {
      const isEnabled = db.get(botNumber, enabledKey, false) === true;
      const mode = String(
        db.get(botNumber, modeKey, "delete") || "delete"
      ).toLowerCase();
      return message.send(
        `⚙️ *AntiSticker* for this group\n` +
          `• Status: ${isEnabled ? "✅ ON" : "❌ OFF"}\n` +
          `• Mode: ${mode.toUpperCase()}\n\n` +
          `*Usage:*\n` +
          `• .antisticker on\n` +
          `• .antisticker off\n` +
          `• .antisticker kick\n` +
          `• .antisticker delete\n` +
          `• .antisticker warn\n` +
          `• .antisticker null`
      );
    }

    // ON
    if (raw === "on") {
      const already = db.get(botNumber, enabledKey, false) === true;
      if (already)
        return message.send(`ℹ️ AntiSticker is already *ON* for this group.`);
      db.setHot(botNumber, enabledKey, true);
      let hasMode = db.get(botNumber, modeKey, null);
      if (hasMode === null || typeof hasMode === "undefined") {
        hasMode = "delete";
        db.setHot(botNumber, modeKey, hasMode);
      }
      return message.send(
        `✅ AntiSticker has been *ENABLED* for this group.\nDefault action: *${hasMode.toUpperCase()}*`
      );
    }

    // OFF
    if (raw === "off") {
      const currently = db.get(botNumber, enabledKey, false) === true;
      if (!currently)
        return message.send("ℹ️ AntiSticker is already *OFF* for this group.");
      db.setHot(botNumber, enabledKey, false);
      return message.send("✅ AntiSticker has been *DISABLED* for this group.");
    }

    // Mode set করো
    if (["kick", "remove", "delete", "warn", "null"].includes(raw)) {
      const normalized = raw === "remove" ? "kick" : raw;
      db.setHot(botNumber, modeKey, normalized);

      // mode set করলে auto-enable করো
      const isEnabled = db.get(botNumber, enabledKey, false) === true;
      if (!isEnabled) {
        db.setHot(botNumber, enabledKey, true);
        return message.send(
          `✅ AntiSticker mode set to *${normalized.toUpperCase()}* and AntiSticker has been automatically *ENABLED* for this group.`
        );
      }
      return message.send(
        `✅ AntiSticker mode updated to *${normalized.toUpperCase()}* for this group.`
      );
    }

    // Unknown argument
    return message.send(
      "Usage:\n.antisticker on\n.antisticker off\n.antisticker kick\n.antisticker delete\n.antisticker warn\n.antisticker null"
    );
  } catch (err) {
    console.error("[antisticker][command] error", err);
    return message.send("❌ An error occurred while processing the command.");
  }
});

// ---------- Enforcement handler ----------
Module({
  on: "sticker",           // ← শুধু sticker message এলে trigger হবে
  package: "group",
  description: "Enforce anti-sticker policy in groups",
})(async (message) => {
  try {
    if (!message || !message.isGroup) return;

    const botNumber = getBotNumberFromConn(message.conn);
    const groupJid = message.from;

    const enabledKey = enabledKeyFor(groupJid);
    const modeKey = modeKeyFor(groupJid);

    // Feature enabled আছে কিনা চেক করো
    const enabled = (() => {
      try {
        return db.get(botNumber, enabledKey, false) === true;
      } catch (e) {
        console.error("[antisticker] db.get failed", e);
        return false;
      }
    })();
    debug("enabled=", enabled);
    if (!enabled) return;

    // Group info লোড করো
    try {
      await message.loadGroupInfo?.();
    } catch (e) {
      debug("loadGroupInfo failed", e?.message || e);
    }

    const botIsAdmin = !!message.isBotAdmin;
    const senderIsAdmin = !!message.isAdmin;
    const senderIsOwnerOrFromMe = !!(message.isFromMe || message.isfromMe);

    // Bot admin না হলে কিছু করতে পারবে না
    if (!botIsAdmin) {
      debug("bot not admin -> cannot enforce");
      return;
    }

    // Admin / owner / bot নিজে sticker দিলে ignore করো
    if (senderIsAdmin || senderIsOwnerOrFromMe) {
      debug("sender is admin/owner/bot -> ignoring");
      return;
    }

    debug("sticker detected from non-admin user");

    // Mode পড়ো
    let mode = "delete";
    try {
      mode = String(
        db.get(botNumber, modeKey, "delete") || "delete"
      ).toLowerCase();
    } catch (e) {
      debug("error reading mode, defaulting to delete", e?.message || e);
      mode = "delete";
    }
    debug("mode=", mode);

    // Sticker message টা delete করো
    try {
      await message.conn
        .sendMessage(message.from, { delete: message.key })
        .catch(() => {});
    } catch (e) {
      debug("delete attempt threw", e?.message || e);
    }

    const senderJid =
      message.sender || message.key?.participant || message.key?.from || null;
    const senderNum = senderJid ? String(senderJid).split("@")[0] : "unknown";

    // Delete mode → notify করো, শেষ
    if (mode === "delete") {
      try {
        await message.send?.(
          `🚫 @${senderNum}, sticker sending is not allowed here!`,
          { mentions: senderJid ? [senderJid] : [] }
        );
      } catch {}
      return;
    }

    // Null mode → শুধু delete, কোনো notify নেই
    if (mode === "null") {
      debug("null mode: silently deleted sticker");
      return;
    }

    // Warn mode → delete + warning message
    if (mode === "warn") {
      try {
        await message.send?.(
          `⚠️ @${senderNum}, sending stickers is not allowed in this group. This is a *warning*.`,
          { mentions: senderJid ? [senderJid] : [] }
        );
        debug("warned user", senderNum);
      } catch (e) {
        debug("warn failed", e?.message || e);
      }
      return;
    }

    // Kick/remove mode → delete + notify + remove user
    if (mode === "kick" || mode === "remove") {
      try {
        await message.send?.(
          `🚫 @${senderNum} sent a sticker and will be removed from the group.`,
          { mentions: senderJid ? [senderJid] : [] }
        );
      } catch (e) {
        debug("notice failed", e?.message || e);
      }

      // Notice deliver হওয়ার জন্য একটু wait করো
      await new Promise((r) => setTimeout(r, 600));

      try {
        if (typeof message.removeParticipant === "function") {
          await message.removeParticipant([senderJid]);
          debug("removeParticipant succeeded for", senderJid);
        } else if (
          message.conn &&
          typeof message.conn.groupParticipantsUpdate === "function"
        ) {
          await message.conn.groupParticipantsUpdate(
            message.from,
            [senderJid],
            "remove"
          );
          debug("groupParticipantsUpdate succeeded for", senderJid);
        } else {
          throw new Error("no supported remove function");
        }
      } catch (err) {
        console.error("[antisticker] failed to remove participant", err);
        try {
          await message.send?.(
            `❌ Failed to remove @${senderNum}. Please remove them manually.`,
            { mentions: senderJid ? [senderJid] : [] }
          );
        } catch (e) {
          debug("notify manual removal failed", e?.message || e);
        }
      }
      return;
    }

    debug("unknown mode (no action)", mode);
  } catch (error) {
    console.error("[antisticker] enforcement error:", error);
  }
});
