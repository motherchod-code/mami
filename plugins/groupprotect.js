// plugins/groupprotect.js — Complete Group Protection Suite
// AntiBot, AntiSticker, AntiWord, AntiLink (delete), Full Warn System

import { Module } from "../lib/plugins.js";
import { db } from "../lib/client.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getBotNum(conn) {
  const raw = conn?.user?.id || conn?.user?.jid || "";
  return String(raw).split("@")[0].split(":")[0].replace(/\D/g, "") || null;
}

function gKey(feature, groupJid) {
  return `${feature}:${groupJid}`;
}

function isOwner(message) {
  return message.isFromMe || message.isfromMe;
}

function isAdminOrOwner(message) {
  return isOwner(message) || message.isAdmin || message.isGroupAdmin || message.isBotAdmin;
}

async function checkAdmin(message) {
  if (!isAdminOrOwner(message)) {
    await message.send("❌ _Only group admins can use this command_");
    return false;
  }
  return true;
}

async function deleteMsg(message) {
  try {
    await message.conn.sendMessage(message.from, { delete: message.key });
  } catch {
    try { await message.send({ delete: message.key }); } catch {}
  }
}

function getSender(message) {
  return message.sender
    || message.key?.participant
    || message.key?.remoteJid
    || null;
}

async function applyAction(message, senderJid, reason, action, botNum) {
  const senderNum = (senderJid || "").split("@")[0];
  const warnKey   = gKey(`warn:${senderJid}`, message.from);

  // Always delete the message first
  await deleteMsg(message);

  if (action === "delete") {
    // Just delete, notify softly
    await message.send(
      `⚠️ @${senderNum} — ${reason}`,
      { mentions: [senderJid] }
    ).catch(() => {});
    return;
  }

  if (action === "warn") {
    const warns = (db.get(botNum, warnKey, 0) || 0) + 1;
    db.setHot(botNum, warnKey, warns);
    if (warns >= 3) {
      db.delHot(botNum, warnKey);
      await message.send(
        `🚫 @${senderNum} — ${reason}\n*3/3 Warnings reached — Removing!*`,
        { mentions: [senderJid] }
      ).catch(() => {});
      await new Promise(r => setTimeout(r, 500));
      await message.removeParticipant([senderJid]).catch(async () => {
        await message.conn.groupParticipantsUpdate(message.from, [senderJid], "remove").catch(() => {});
      });
    } else {
      await message.send(
        `⚠️ *Warning ${warns}/3* — @${senderNum}: ${reason}`,
        { mentions: [senderJid] }
      ).catch(() => {});
    }
    return;
  }

  // kick (default)
  await message.send(
    `🚫 @${senderNum} — ${reason}. *Removing...*`,
    { mentions: [senderJid] }
  ).catch(() => {});
  await new Promise(r => setTimeout(r, 500));
  await message.removeParticipant([senderJid]).catch(async () => {
    await message.conn.groupParticipantsUpdate(message.from, [senderJid], "remove").catch(() => {});
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ── ANTIBOT ──────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

Module({
  command: "antibot",
  package: "group",
  description: "Block bots from joining. .antibot on/off/kick/warn/delete",
})(async (message, match) => {
  if (!(await checkAdmin(message))) return;
  if (!message.isGroup) return message.send("❌ _Groups only_");

  const botNum = getBotNum(message.conn);
  if (!botNum) return message.send("❌ Bot number not found.");

  const input      = (match || "").trim().toLowerCase();
  const enabledKey = gKey("antibot:enabled", message.from);
  const modeKey    = gKey("antibot:mode",    message.from);

  if (!input) {
    const on   = db.get(botNum, enabledKey, false) === true;
    const mode = db.get(botNum, modeKey, "kick");
    return message.send(
      `🤖 *AntiBot*\n> Status: ${on ? "✅ ON" : "❌ OFF"}\n> Mode: ${mode.toUpperCase()}\n\n` +
      `Use:\n• .antibot on\n• .antibot off\n• .antibot kick\n• .antibot warn\n• .antibot delete`
    );
  }
  if (input === "on")  { db.setHot(botNum, enabledKey, true); if (!db.get(botNum, modeKey)) db.setHot(botNum, modeKey, "kick"); return message.send("✅ *AntiBot ON*"); }
  if (input === "off") { db.setHot(botNum, enabledKey, false); return message.send("✅ *AntiBot OFF*"); }
  if (["kick","warn","delete"].includes(input)) {
    db.setHot(botNum, modeKey, input);
    db.setHot(botNum, enabledKey, true);
    return message.send(`✅ *AntiBot mode: ${input.toUpperCase()}*`);
  }
  return message.send("Usage: .antibot on/off/kick/warn/delete");
});

// AntiBot enforcement via group-participants.update
Module({
  on: "group-participants.update",
  package: "group",
  description: "AntiBot enforcement on join",
})(async (message, event, sock) => {
  try {
    if (!event || event.action !== "add") return;
    const groupJid = event.id;
    if (!sock?.user?.id) return;
    const botNum = sock.user.id.split("@")[0].split(":")[0].replace(/\D/g, "");

    const enabledKey = gKey("antibot:enabled", groupJid);
    const modeKey    = gKey("antibot:mode",    groupJid);
    if (db.get(botNum, enabledKey) !== true) return;
    const mode = db.get(botNum, modeKey, "kick");

    for (const jid of event.participants) {
      // Bots typically have device suffix like :xx@ or special patterns
      const isBot = /:\d+@s\.whatsapp\.net/.test(jid) || jid.includes(":0@");
      if (!isBot) continue;
      const num = jid.split("@")[0];
      if (mode === "kick") {
        await sock.groupParticipantsUpdate(groupJid, [jid], "remove").catch(() => {});
        await sock.sendMessage(groupJid, {
          text: `🤖 Bot *@${num}* detected and removed.`,
          mentions: [jid],
        }).catch(() => {});
      } else {
        await sock.sendMessage(groupJid, {
          text: `⚠️ Bot *@${num}* detected. Please review.`,
          mentions: [jid],
        }).catch(() => {});
      }
    }
  } catch {}
});

// ══════════════════════════════════════════════════════════════════════════════
// ── ANTISTICKER ──────────────────────────────────────────════════════════════
// ══════════════════════════════════════════════════════════════════════════════

Module({
  command: "antisticker",
  package: "group",
  description: "Block stickers in group. .antisticker on/off/kick/warn/delete",
})(async (message, match) => {
  if (!(await checkAdmin(message))) return;
  if (!message.isGroup) return message.send("❌ _Groups only_");

  const botNum = getBotNum(message.conn);
  if (!botNum) return message.send("❌ Bot number not found.");

  const input      = (match || "").trim().toLowerCase();
  const enabledKey = gKey("antisticker:enabled", message.from);
  const modeKey    = gKey("antisticker:mode",    message.from);

  if (!input) {
    const on   = db.get(botNum, enabledKey, false) === true;
    const mode = db.get(botNum, modeKey, "delete");
    return message.send(
      `🎭 *AntiSticker*\n> Status: ${on ? "✅ ON" : "❌ OFF"}\n> Mode: ${mode.toUpperCase()}\n\n` +
      `Use:\n• .antisticker on\n• .antisticker off\n• .antisticker kick\n• .antisticker warn\n• .antisticker delete`
    );
  }
  if (input === "on")  { db.setHot(botNum, enabledKey, true); if (!db.get(botNum, modeKey)) db.setHot(botNum, modeKey, "delete"); return message.send("✅ *AntiSticker ON*"); }
  if (input === "off") { db.setHot(botNum, enabledKey, false); return message.send("✅ *AntiSticker OFF*"); }
  if (["kick","warn","delete"].includes(input)) {
    db.setHot(botNum, modeKey, input);
    db.setHot(botNum, enabledKey, true);
    return message.send(`✅ *AntiSticker mode: ${input.toUpperCase()}*`);
  }
  return message.send("Usage: .antisticker on/off/kick/warn/delete");
});

// AntiSticker enforcement
Module({
  on: "text",
  package: "group",
  description: "AntiSticker enforcement",
})(async (message) => {
  try {
    if (!message?.isGroup) return;
    if (isOwner(message)) return;
    if (message.isAdmin || message.isGroupAdmin) return;

    // Check message type — stickerMessage
    const msgType = message.type || message.mtype || "";
    if (msgType !== "stickerMessage" && !message.body?.includes?.("stickerMessage")) return;
    // Also check raw message
    if (!message.raw?.message?.stickerMessage && msgType !== "stickerMessage") return;

    const botNum = getBotNum(message.conn);
    if (!botNum) return;
    const enabledKey = gKey("antisticker:enabled", message.from);
    if (db.get(botNum, enabledKey) !== true) return;
    if (!message.isBotAdmin) return;

    const mode      = db.get(botNum, gKey("antisticker:mode", message.from), "delete");
    const senderJid = getSender(message);
    if (!senderJid) return;

    await applyAction(message, senderJid, "Stickers are not allowed here", mode, botNum);
  } catch {}
});

// ══════════════════════════════════════════════════════════════════════════════
// ── ANTIWORD ─────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

Module({
  command: "antiword",
  package: "group",
  description: "Block words in group. .antiword add/remove/list/on/off/kick/warn/delete",
})(async (message, match) => {
  if (!(await checkAdmin(message))) return;
  if (!message.isGroup) return message.send("❌ _Groups only_");

  const botNum = getBotNum(message.conn);
  if (!botNum) return message.send("❌ Bot number not found.");

  const input      = (match || "").trim().toLowerCase();
  const enabledKey = gKey("antiword:enabled", message.from);
  const modeKey    = gKey("antiword:mode",    message.from);
  const wordsKey   = gKey("antiword:words",   message.from);

  if (!input) {
    const on    = db.get(botNum, enabledKey, false) === true;
    const mode  = db.get(botNum, modeKey, "delete");
    const words = db.get(botNum, wordsKey, []) || [];
    return message.send(
      `🔤 *AntiWord*\n> Status: ${on ? "✅ ON" : "❌ OFF"}\n> Mode: ${mode.toUpperCase()}\n` +
      `> Words (${words.length}): ${words.length ? words.join(", ") : "none"}\n\n` +
      `Use:\n• .antiword add <word>\n• .antiword remove <word>\n• .antiword list\n• .antiword on/off/kick/warn/delete`
    );
  }

  if (input === "on")  { db.setHot(botNum, enabledKey, true);  return message.send("✅ *AntiWord ON*"); }
  if (input === "off") { db.setHot(botNum, enabledKey, false); return message.send("✅ *AntiWord OFF*"); }
  if (["kick","warn","delete"].includes(input)) {
    db.setHot(botNum, modeKey, input); db.setHot(botNum, enabledKey, true);
    return message.send(`✅ *AntiWord mode: ${input.toUpperCase()}*`);
  }
  if (input === "list") {
    const words = db.get(botNum, wordsKey, []) || [];
    return message.send(`📋 *Blocked Words (${words.length}):*\n${words.length ? words.map((w,i) => `${i+1}. ${w}`).join("\n") : "None"}`);
  }

  const parts = input.split(" ");
  const sub   = parts[0];
  const word  = parts.slice(1).join(" ").trim();

  if (sub === "add" && word) {
    const words = db.get(botNum, wordsKey, []) || [];
    if (words.includes(word)) return message.send(`ℹ️ _"${word}" already blocked_`);
    words.push(word);
    db.setHot(botNum, wordsKey, words);
    db.setHot(botNum, enabledKey, true);
    return message.send(`✅ Word blocked: \`${word}\``);
  }
  if (sub === "remove" && word) {
    let words = db.get(botNum, wordsKey, []) || [];
    if (!words.includes(word)) return message.send(`ℹ️ _"${word}" not in list_`);
    words = words.filter(w => w !== word);
    db.setHot(botNum, wordsKey, words);
    return message.send(`✅ Word removed: \`${word}\``);
  }

  return message.send("Usage: .antiword add <word> | remove <word> | list | on/off/kick/warn/delete");
});

// AntiWord enforcement
Module({
  on: "text",
  package: "group",
  description: "AntiWord enforcement",
})(async (message) => {
  try {
    if (!message?.isGroup) return;
    if (isOwner(message)) return;
    if (message.isAdmin || message.isGroupAdmin) return;
    if (!message.body) return;

    const botNum = getBotNum(message.conn);
    if (!botNum) return;
    const enabledKey = gKey("antiword:enabled", message.from);
    if (db.get(botNum, enabledKey) !== true) return;
    if (!message.isBotAdmin) return;

    const words = db.get(botNum, gKey("antiword:words", message.from), []) || [];
    if (!words.length) return;

    const body    = message.body.toLowerCase();
    const matched = words.find(w => body.includes(w.toLowerCase()));
    if (!matched) return;

    const mode      = db.get(botNum, gKey("antiword:mode", message.from), "delete");
    const senderJid = getSender(message);
    if (!senderJid) return;

    await applyAction(message, senderJid, `Blocked word detected: "${matched}"`, mode, botNum);
  } catch {}
});

// ══════════════════════════════════════════════════════════════════════════════
// ── WARN SYSTEM ──────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

Module({
  command: "warn",
  package: "group",
  description: "Warn a user (3 warns = kick). .warn @user [reason]",
})(async (message, match) => {
  try {
    if (!(await checkAdmin(message))) return;
    if (!message.isGroup) return message.send("❌ _Groups only_");
    if (!message.isBotAdmin) return message.send("❌ _Bot must be admin to warn users_");

    const senderJid = message.mentions?.[0] || message.quoted?.sender || message.quoted?.participant;
    if (!senderJid) return message.send("❌ _Tag or reply to a user to warn_");

    const botNum = getBotNum(message.conn);
    if (!botNum) return message.send("❌ Bot number not found.");

    const reason  = (match || "").replace(/@\d+/g, "").trim() || "Rule violation";
    const warnKey = gKey(`warn:${senderJid}`, message.from);
    const warns   = (db.get(botNum, warnKey, 0) || 0) + 1;
    db.setHot(botNum, warnKey, warns);
    const num = senderJid.split("@")[0];

    if (warns >= 3) {
      db.delHot(botNum, warnKey);
      await message.send(
        `🚫 @${num} — *3/3 Warnings reached!*\nReason: ${reason}\n\n_Removing from group..._`,
        { mentions: [senderJid] }
      );
      await new Promise(r => setTimeout(r, 600));
      await message.removeParticipant([senderJid]).catch(async () => {
        await message.conn.groupParticipantsUpdate(message.from, [senderJid], "remove").catch(() => {});
      });
    } else {
      await message.send(
        `⚠️ *Warning ${warns}/3* for @${num}\n📝 Reason: ${reason}`,
        { mentions: [senderJid] }
      );
    }
    await message.react("✅");
  } catch {
    await message.react("❌");
    await message.send("❌ _Failed to warn user_");
  }
});

Module({
  command: "warnreset",
  package: "group",
  aliases: ["resetwarn", "clearwarn"],
  description: "Reset warns for a user",
})(async (message) => {
  if (!(await checkAdmin(message))) return;
  if (!message.isGroup) return message.send("❌ _Groups only_");

  const senderJid = message.mentions?.[0] || message.quoted?.sender || message.quoted?.participant;
  if (!senderJid) return message.send("❌ _Tag or reply to a user_");

  const botNum = getBotNum(message.conn);
  if (!botNum) return message.send("❌ Bot number not found.");

  db.delHot(botNum, gKey(`warn:${senderJid}`, message.from));
  return message.send(`✅ Warnings cleared for @${senderJid.split("@")[0]}`, { mentions: [senderJid] });
});

Module({
  command: "warncount",
  package: "group",
  aliases: ["warns", "checkwarn"],
  description: "Check warns for a user",
})(async (message) => {
  if (!message.isGroup) return message.send("❌ _Groups only_");

  const senderJid = message.mentions?.[0] || message.quoted?.sender || message.quoted?.participant;
  if (!senderJid) return message.send("❌ _Tag or reply to a user_");

  const botNum = getBotNum(message.conn);
  if (!botNum) return message.send("❌ Bot number not found.");

  const warns = db.get(botNum, gKey(`warn:${senderJid}`, message.from), 0) || 0;
  return message.send(
    `⚠️ *Warn Count for @${senderJid.split("@")[0]}:* ${warns}/3`,
    { mentions: [senderJid] }
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// ── ANTIGHOST ────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

Module({
  command: "antighost",
  package: "group",
  aliases: ["antifake"],
  description: "Enable/disable antighost for group. .antighost on/off",
})(async (message, match) => {
  if (!(await checkAdmin(message))) return;
  if (!message.isGroup) return message.send("❌ _Groups only_");

  const botNum = getBotNum(message.conn);
  if (!botNum) return message.send("❌ Bot number not found.");

  const input = (match || "").trim().toLowerCase();
  const key   = gKey("antighost:enabled", message.from);

  if (input === "on")  { db.setHot(botNum, key, true);  return message.send("✅ *AntiGhost ON*\n_Members who ghost will be warned_"); }
  if (input === "off") { db.setHot(botNum, key, false); return message.send("✅ *AntiGhost OFF*"); }

  const on = db.get(botNum, key, false) === true;
  return message.send(`👻 *AntiGhost*\n> Status: ${on ? "✅ ON" : "❌ OFF"}\n\nUse: .antighost on/off`);
});

// ══════════════════════════════════════════════════════════════════════════════
// ── PROTECTION STATUS ─────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

Module({
  command: "protection",
  package: "group",
  aliases: ["gpstatus", "groupprotect"],
  description: "Show all group protection settings",
})(async (message) => {
  if (!message.isGroup) return message.send("❌ _Groups only_");

  const botNum = getBotNum(message.conn);
  if (!botNum) return message.send("❌ Bot number not found.");
  const g = message.from;

  const flag = k => db.get(botNum, k, false) === true ? "✅" : "❌";
  const mode = k => db.get(botNum, k, "—") || "—";

  const antilink = db.get(botNum, `antilink:${g}:enabled`, false) === true;

  return message.send(
    `🛡️ *Group Protection Status*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔗 AntiLink:    ${antilink ? "✅" : "❌"} │ Mode: ${mode(`antilink:${g}:mode`)}\n` +
    `🤖 AntiBot:     ${flag(gKey("antibot:enabled", g))} │ Mode: ${mode(gKey("antibot:mode", g))}\n` +
    `🎭 AntiSticker: ${flag(gKey("antisticker:enabled", g))} │ Mode: ${mode(gKey("antisticker:mode", g))}\n` +
    `🔤 AntiWord:    ${flag(gKey("antiword:enabled", g))} │ Mode: ${mode(gKey("antiword:mode", g))}\n` +
    `👻 AntiGhost:   ${flag(gKey("antighost:enabled", g))}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*Commands:*\n` +
    `.antilink | .antibot | .antisticker | .antiword | .antighost | .warn | .protection`
  );
});
