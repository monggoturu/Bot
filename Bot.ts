import { Bot, Context } from "https://deno.land/x/grammy/mod.ts";
import { v4 as uuidv4 } from "https://deno.land/std@0.207.0/uuid/mod.ts";

// Variabel lingkungan dari Deno Deploy
const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
const CHANNEL_ID = Deno.env.get("CHANNEL_ID");
const OWNER_ID = Deno.env.get("OWNER_ID");
const DB_PATH = "./file_database.json";

if (!BOT_TOKEN || !CHANNEL_ID || !OWNER_ID) {
  throw new Error("BOT_TOKEN, CHANNEL_ID, dan OWNER_ID harus diatur.");
}

// Inisialisasi bot
const bot = new Bot(BOT_TOKEN);
let db = new Map();
let mediaGroups = new Map();

// Fungsi untuk memuat database
async function loadDatabase() {
  try {
    const data = await Deno.readTextFile(DB_PATH);
    db = new Map(JSON.parse(data));
    console.log("[LOG] Database loaded successfully.");
  } catch (error) {
    console.log("[LOG] No existing database found. Starting fresh.");
    db = new Map();
  }
}

// Fungsi untuk menyimpan database
async function saveDatabase() {
  try {
    await Deno.writeTextFile(DB_PATH, JSON.stringify([...db]));
    console.log("[LOG] Database saved.");
  } catch (error) {
    console.error(`[ERROR] Failed to save database: ${error.message}`);
  }
}

// Fungsi untuk menghasilkan UUID
function generateCustomId(fileType) {
  const randomPart = uuidv4.generate().slice(0, 8);
  return `${fileType}(${randomPart})`;
}

// Fungsi untuk membuat URL publik file
function getPublicFileUrl(botUsername, fileId) {
  return `https://t.me/${botUsername}?start=${fileId}`;
}

// Fungsi untuk mendapatkan URL download langsung dari API Telegram
async function getFileUrl(fileId) {
  try {
    const file = await bot.api.getFile(fileId);
    return `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  } catch (error) {
    console.error(`[ERROR] Failed to get file URL: ${error.message}`);
    return null;
  }
}

// Fungsi untuk mengunggah file ke channel database
async function forwardFileToDatabase(ctx, file, fileType, customId, username, uploadDate) {
  const publicUrl = getPublicFileUrl(bot.me.username, customId);
  const directUrl = await getFileUrl(file.file_id);

  const caption = [
    `📄 *File Uploaded:*`,
    `• Uploader: ${username}`,
    `• File ID: ${customId}`,
    `• Upload Date: ${uploadDate}`,
    `• Public Link: ${publicUrl}`,
    `• Direct Download URL: ${directUrl || "N/A"}`,
  ].join("\n");

  const options = { caption, parse_mode: "Markdown" };

  switch (fileType) {
    case "document":
      await bot.api.sendDocument(CHANNEL_ID, file.file_id, options);
      break;
    case "photo":
      await bot.api.sendPhoto(CHANNEL_ID, file.file_id, options);
      break;
    case "video":
      await bot.api.sendVideo(CHANNEL_ID, file.file_id, options);
      break;
    case "audio":
      await bot.api.sendAudio(CHANNEL_ID, file.file_id, options);
      break;
  }

  console.log(`[LOG] File ${customId} forwarded to channel.`);
}

// Command /start
bot.command("start", async (ctx) => {
  const fileId = ctx.match;
  if (fileId && db.has(fileId)) {
    const file = db.get(fileId);
    const publicUrl = getPublicFileUrl(bot.me.username, fileId);
    const directUrl = await getFileUrl(file.file_id);

    await ctx.reply(
      `📥 *File Downloaded:*\n` +
        `• File ID: ${fileId}\n` +
        `• Uploader: ${file.uploader}\n` +
        `• Upload Date: ${file.uploadDate}\n` +
        `• Type: ${file.fileType}\n` +
        `• Public Link: ${publicUrl}\n` +
        `• Direct Download URL: ${directUrl || "N/A"}`,
      { parse_mode: "Markdown" },
    );
  } else {
    await ctx.reply(
      "*Welcome to File Sharing Bot!*\n\n" +
        "Use /upload to share files and /download <file_id> to retrieve them.",
      { parse_mode: "Markdown" },
    );
  }
});

// Command /upload (Batch dan Single)
bot.on(
  ["message:document", "message:photo", "message:video", "message:audio"],
  async (ctx) => {
    const message = ctx.message;
    const uploadDate = new Date().toISOString();
    const mediaGroupId = message.media_group_id;

    if (mediaGroupId) {
      if (!mediaGroups.has(mediaGroupId)) {
        mediaGroups.set(mediaGroupId, { files: [], timer: null });
      }
      const group = mediaGroups.get(mediaGroupId);
      group.files.push(message);

      if (group.timer) {
        clearTimeout(group.timer);
      }

      group.timer = setTimeout(async () => {
        await processMediaGroup(ctx, mediaGroupId, uploadDate);
      }, 1000);
    } else {
      await processSingleUpload(ctx, message, uploadDate);
    }
  },
);

async function processSingleUpload(ctx, message, uploadDate) {
  const file =
    message.document || message.photo?.[0] || message.video || message.audio;
  const fileType = file.file_type || "unknown";
  const customId = generateCustomId(fileType);

  db.set(customId, {
    file_id: file.file_id,
    fileType,
    uploader: ctx.from.username || String(ctx.from.id),
    uploadDate,
  });
  await saveDatabase();

  const publicUrl = getPublicFileUrl(bot.me.username, customId);
  const directUrl = await getFileUrl(file.file_id);

  await ctx.reply(
    `✅ File uploaded!\n` +
      `• ID: ${customId}\n` +
      `• Public URL: ${publicUrl}\n` +
      `• Direct Download URL: ${directUrl || "N/A"}`,
  );
}

async function processMediaGroup(ctx, mediaGroupId, uploadDate) {
  const group = mediaGroups.get(mediaGroupId);
  if (!group) return;

  mediaGroups.delete(mediaGroupId);

  const summary = [];
  for (const message of group.files) {
    const file =
      message.document || message.photo?.[0] || message.video || message.audio;
    const fileType = file.file_type || "unknown";
    const customId = generateCustomId(fileType);

    db.set(customId, {
      file_id: file.file_id,
      fileType,
      uploader: ctx.from.username || String(ctx.from.id),
      uploadDate,
    });
    await saveDatabase();

    const publicUrl = getPublicFileUrl(bot.me.username, customId);
    const directUrl = await getFileUrl(file.file_id);
    summary.push(`• ID: ${customId}\n  Public: ${publicUrl}\n  Direct: ${directUrl}`);
  }

  await ctx.reply(`Batch upload completed:\n\n${summary.join("\n\n")}`);
}

// Command /delete - Menghapus file berdasarkan ID
bot.command("delete", async (ctx) => {
  const fileIds = ctx.match?.split(" ").filter(Boolean);
  if (!fileIds || fileIds.length === 0) {
    return ctx.reply("❌ Please provide at least one file ID to delete.");
  }

  for (const fileId of fileIds) {
    const fileRecord = db.get(fileId);

    if (!fileRecord) {
      await ctx.reply(`❌ File ID \`${fileId}\` not found.`, { parse_mode: "Markdown" });
      continue;
    }

    const { uploader } = fileRecord;
    const isOwner = ctx.from.id.toString() === OWNER_ID;
    const isUploader = uploader === (ctx.from.username || ctx.from.id.toString());

    if (isOwner || isUploader) {
      db.delete(fileId);
      await saveDatabase();
      console.log(`[LOG] File ${fileId} deleted by user ${ctx.from.id}.`);
      await ctx.reply(`✅ File \`${fileId}\` deleted successfully.`, { parse_mode: "Markdown" });
    } else {
      await ctx.reply(
        `❌ You do not have permission to delete file \`${fileId}\`.`,
        { parse_mode: "Markdown" },
      );
    }
  }
});

// Command /revoke - Membuat ulang ID file
bot.command("revoke", async (ctx) => {
  const fileIds = ctx.match?.split(" ").filter(Boolean);
  if (!fileIds || fileIds.length === 0) {
    return ctx.reply("❌ Please provide at least one file ID to revoke.");
  }

  for (const fileId of fileIds) {
    const fileRecord = db.get(fileId);

    if (!fileRecord) {
      await ctx.reply(`❌ File ID \`${fileId}\` not found.`, { parse_mode: "Markdown" });
      continue;
    }

    const { uploader, file_id, fileType, uploadDate } = fileRecord;
    const isOwner = ctx.from.id.toString() === OWNER_ID;
    const isUploader = uploader === (ctx.from.username || ctx.from.id.toString());

    if (isOwner || isUploader) {
      const newId = generateCustomId(fileType);
      db.delete(fileId);
      db.set(newId, { file_id, fileType, uploader, uploadDate });
      await saveDatabase();

      console.log(`[LOG] File ID ${fileId} revoked to ${newId} by user ${ctx.from.id}.`);
      const publicUrl = getPublicFileUrl(bot.me.username, newId);
      const directUrl = await getFileUrl(file_id);

      await ctx.reply(
        `✅ File ID \`${fileId}\` has been updated:\n` +
          `• New ID: \`${newId}\`\n` +
          `• Public URL: ${publicUrl}\n` +
          `• Direct Download URL: ${directUrl || "N/A"}`,
        { parse_mode: "Markdown" },
      );
    } else {
      await ctx.reply(
        `❌ You do not have permission to revoke file ID \`${fileId}\`.`,
        { parse_mode: "Markdown" },
      );
    }
  }
});

// Command /list - Melihat daftar file pengguna
bot.command("list", async (ctx) => {
  const userFiles = Array.from(db.entries())
    .filter(([_, data]) => data.uploader === (ctx.from.username || ctx.from.id.toString()))
    .map(([id, data]) => {
      return `• ID: \`${id}\`\n  Type: ${data.fileType}, Uploaded: ${data.uploadDate}`;
    });

  if (userFiles.length === 0) {
    return ctx.reply("📂 You have no uploaded files.", { parse_mode: "Markdown" });
  }

  const message = `📂 *Your Uploaded Files:*\n\n${userFiles.join("\n\n")}`;
  await ctx.reply(message, { parse_mode: "Markdown" });
});

// Command /listall - Melihat semua file (hanya admin/owner)
bot.command("listall", async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) {
    return ctx.reply("❌ You do not have permission to view all files.");
  }

  const allFiles = Array.from(db.entries()).map(([id, data]) => {
    return `• ID: \`${id}\`\n  Type: ${data.fileType}, Uploader: ${data.uploader}, Uploaded: ${data.uploadDate}`;
  });

  if (allFiles.length === 0) {
    return ctx.reply("📂 No files uploaded.", { parse_mode: "Markdown" });
  }

  // Jika terlalu panjang, kirim dalam beberapa pesan
  const chunkSize = 50; // Maksimal 50 file per pesan
  for (let i = 0; i < allFiles.length; i += chunkSize) {
    const chunk = allFiles.slice(i, i + chunkSize).join("\n\n");
    await ctx.reply(`📂 *All Uploaded Files:*\n\n${chunk}`, { parse_mode: "Markdown" });
  }
});

// Load database dan mulai bot
await loadDatabase();
bot.start();
console.log("[LOG] Bot is running!");
