import axios from "axios";
import { Module } from "../lib/plugins.js";

Module({
  command: "boobs",
  desc: "Get random anime image",
  type: "fun",
})(async (message) => {
  try {
    const { data } = await axios({
      url: "https://api.dorratz.com/nsfw/tetas",
      method: "GET",
      responseType: "arraybuffer",
    });
    await message.send({
      image: Buffer.from(data),
      caption: "✨ Random Anime Image",
    });
  } catch (error) {
    console.error(error);
    await message.send("❌ Failed to fetch image!");
  }
});
