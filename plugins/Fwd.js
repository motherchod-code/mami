Module({
  command: "fwd",
  package: "owner",
  description: "Forward quoted message to a chat",
  usage: ".forward <number/jid>",
})(async (message, match) => {
  try {
    if (!message.isfromMe) return message.send(theme.isfromMe);
    if (!message.quoted)
      return message.send("❌ Reply to a message to forward");
    if (!match)
      return message.send(
        "❌ Provide target number or JID\n\nExample: .forward 1234567890\n.forward 1234567890@s.whatsapp.net\n.forward 123456789@g.us"
      );

    // Parse multiple JIDs/numbers (1st এর মতো multiple target support)
    const targets = match
      .trim()
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => {
        if (t.includes("@")) return t; // already a JID
        const num = t.replace(/[^0-9]/g, "");
        return num ? jidNormalizedUser(`${num}@s.whatsapp.net`) : null;
      })
      .filter(Boolean);

    if (!targets.length)
      return message.send("❌ Invalid number or JID provided");

    const rawMsg = message.quoted?.raw ?? message.quoted;
    if (!rawMsg) return message.send("❌ Could not read quoted message");

    await message.react("⏳");

    for (const targetJid of targets) {
      try {
        // preferred: built-in forward
        await message.conn.sendMessage(targetJid, {
          forward: rawMsg,
          force: true,
        });
      } catch {
        // fallback: relay the message content directly
        const qt = message.quoted?.type || "";
        const body = message.quoted?.body;
        if (body) {
          await message.conn.sendMessage(targetJid, { text: body });
        } else if (qt && qt !== "conversation") {
          try {
            const buf = await message.quoted.download();
            const mime = message.quoted.msg?.mimetype || "";
            const mediaKey = qt.replace("Message", "");
            await message.conn.sendMessage(targetJid, {
              [mediaKey]: buf,
              mimetype: mime,
            });
          } catch (e2) {
            console.error("Forward fallback failed for", targetJid, e2);
          }
        }
      }

      await sleep(1234); // 1st এর মতো delay
    }

    await message.react("✅");
    const sentTo = targets
      .map((j) => {
        const num = j.split("@")[0];
        return `@${num}`;
      })
      .join(", ");
    await message.send(`✅ Message forwarded to ${sentTo}`, {
      mentions: targets,
    });
  } catch (err) {
    console.error("Forward command error:", err);
    await message.react("❌");
    await message.send("❌ Failed to forward message");
  }
});
