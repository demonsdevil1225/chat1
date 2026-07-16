require("dotenv").config();
const express = require("express");
const http = require("http");
const https = require("https");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ===== LOCAL FILE UPLOAD SETUP =====
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, uuidv4() + ext);
  },
});
const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images allowed"));
  },
});

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) fs.writeFileSync(p, "[]");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const testHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return hash === testHash;
}

// ===== TELEGRAM BOT API (used as persistent DB) =====
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TG_API = "https://api.telegram.org";

function tgApi(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(`${TG_API}/bot${TG_TOKEN}/${method}`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf));
          } catch {
            resolve({ ok: false, error: buf });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function tgSendText(msg) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    await tgApi("sendMessage", {
      chat_id: TG_CHAT_ID,
      text: msg,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error("TG sendMessage error:", err.message);
  }
}

async function tgSendPhoto(filePath, caption) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    const fileData = fs.readFileSync(filePath);
    const boundary = "----FormBoundary" + uuidv4();
    const fileName = path.basename(filePath);

    let body = "";
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="chat_id"\r\n\r\n${TG_CHAT_ID}\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="photo"; filename="${fileName}"\r\n`;
    body += `Content-Type: image/jpeg\r\n\r\n`;

    const bodyStart = Buffer.from(body, "utf-8");
    const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
    const fullBody = Buffer.concat([bodyStart, fileData, bodyEnd]);

    const url = new URL(`${TG_API}/bot${TG_TOKEN}/sendPhoto`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": fullBody.length,
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { JSON.parse(buf); } catch { console.error("TG sendPhoto response:", buf); }
        });
      }
    );
    req.on("error", (err) => console.error("TG sendPhoto error:", err.message));
    req.write(fullBody);
    req.end();
  } catch (err) {
    console.error("TG sendPhoto error:", err.message);
  }
}

// Format message for Telegram storage
function formatTgMessage(msg) {
  const time = new Date(msg.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  if (msg.type === "image") {
    return `[MSG|${msg.id}|${msg.room}|${msg.username}|image|${msg.timestamp}]`;
  }
  return `[MSG|${msg.id}|${msg.room}|${msg.username}|text|${msg.timestamp}]\n${msg.text}`;
}

// Store a message to Telegram
async function storeMessageToTelegram(msg) {
  const formatted = formatTgMessage(msg);
  if (msg.type === "image" && msg.imageUrl) {
    const filePath = path.join(__dirname, "public", msg.imageUrl);
    if (fs.existsSync(filePath)) {
      await tgSendPhoto(filePath, formatted);
      return;
    }
  }
  await tgSendText(formatted);
}

// Fetch messages from Telegram (parse from getUpdates)
async function fetchTgMessages(offset) {
  if (!TG_TOKEN || !TG_CHAT_ID) return [];
  try {
    const res = await tgApi("getUpdates", {
      offset: offset || 0,
      limit: 100,
      timeout: 1,
      allowed_updates: ["message"],
    });
    if (!res.ok) return [];
    const messages = [];
    for (const update of res.result) {
      const msg = update.message;
      if (!msg || msg.chat.id.toString() !== TG_CHAT_ID) continue;
      const text = msg.text || msg.caption || "";
      const parsed = text.match(/^\[MSG\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
      if (parsed) {
        const [, id, room, username, type, timestamp] = parsed;
        messages.push({
          id,
          room,
          username,
          type,
          timestamp,
          text: type === "text" ? text.replace(parsed[0], "").trim() : "",
          imageUrl: null,
          tgMessageId: msg.message_id,
        });
      }
    }
    return { messages, lastUpdateId: res.result.length ? res.result[res.result.length - 1].update_id : 0 };
  } catch (err) {
    console.error("TG fetch error:", err.message);
    return { messages: [], lastUpdateId: offset || 0 };
  }
}

// REST API — register
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Username and password required" });
  if (username.length < 2)
    return res.status(400).json({ error: "Username must be at least 2 characters" });
  if (password.length < 4)
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  const users = readJSON("users.json");
  if (users.find((u) => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: "Username already taken" });
  const user = {
    id: uuidv4(),
    username,
    password: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeJSON("users.json", users);
  res.json({ id: user.id, username: user.username, createdAt: user.createdAt });
});

// REST API — login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Username and password required" });
  const users = readJSON("users.json");
  const user = users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );
  if (!user) return res.status(401).json({ error: "User not found" });
  if (!verifyPassword(password, user.password))
    return res.status(401).json({ error: "Invalid password" });
  res.json({ id: user.id, username: user.username, createdAt: user.createdAt });
});

app.get("/api/users", (_req, res) => {
  const users = readJSON("users.json");
  res.json(users.map(({ password, ...u }) => u));
});

// REST API — messages
app.get("/api/messages/:room", (req, res) => {
  const messages = readJSON("messages.json");
  res.json(messages.filter((m) => m.room === req.params.room).slice(-200));
});

// REST API — rooms
app.get("/api/rooms", (_req, res) => {
  res.json(readJSON("rooms.json"));
});

app.post("/api/rooms", (req, res) => {
  const { name, createdBy } = req.body;
  if (!name) return res.status(400).json({ error: "Room name required" });
  const rooms = readJSON("rooms.json");
  if (rooms.find((r) => r.name === name))
    return res.status(409).json({ error: "Room exists" });
  const room = {
    id: uuidv4(),
    name,
    createdBy,
    createdAt: new Date().toISOString(),
  };
  rooms.push(room);
  writeJSON("rooms.json", rooms);
  res.json(room);
});

app.delete("/api/rooms/:id", (req, res) => {
  const rooms = readJSON("rooms.json");
  const roomIndex = rooms.findIndex((r) => r.id === req.params.id);
  if (roomIndex === -1)
    return res.status(404).json({ error: "Room not found" });

  const roomName = rooms[roomIndex].name;
  rooms.splice(roomIndex, 1);
  writeJSON("rooms.json", rooms);

  const messages = readJSON("messages.json");
  const filteredMessages = messages.filter((m) => m.room !== roomName);
  writeJSON("messages.json", filteredMessages);

  io.to(roomName).emit("room:deleted", { roomName, roomId: req.params.id });

  res.json({ success: true, roomName });
});

// REST API — upload image locally
app.post("/api/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image provided" });
  const imageUrl = `/uploads/${req.file.filename}`;
  console.log("Image uploaded:", req.file.filename);
  res.json({ url: imageUrl });
});

// REST API — Telegram webhook (receives messages from TG group → pushes to app)
let tgUpdateOffset = 0;
app.post("/api/telegram/webhook", async (req, res) => {
  const update = req.body;
  if (!update || !update.message) return res.sendStatus(200);

  const msg = update.message;
  if (msg.chat.id.toString() !== TG_CHAT_ID) return res.sendStatus(200);

  const text = msg.text || msg.caption || "";
  const parsed = text.match(/^\[MSG\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
  if (parsed) {
    const [, id, room, username, type, timestamp] = parsed;
    const existing = readJSON("messages.json");
    if (!existing.find((m) => m.id === id)) {
      const newMsg = {
        id,
        room,
        username,
        type,
        text: type === "text" ? text.replace(parsed[0], "").trim() : "",
        imageUrl: null,
        timestamp,
        source: "telegram",
      };
      existing.push(newMsg);
      writeJSON("messages.json", existing);
      io.to(room).emit("chat:message", newMsg);
    }
  }

  tgUpdateOffset = update.update_id + 1;
  res.sendStatus(200);
});

// REST API — set Telegram webhook
app.get("/api/telegram/set-webhook", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "url query param required" });
  try {
    const result = await tgApi("setWebhook", {
      url: url + "/api/telegram/webhook",
      allowed_updates: ["message"],
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST API — fetch recent messages from Telegram (for restore after restart)
app.get("/api/telegram/fetch-recent", async (req, res) => {
  const { messages, lastUpdateId } = await fetchTgMessages(0);
  if (messages.length === 0) return res.json({ fetched: 0 });

  const existing = readJSON("messages.json");
  const existingIds = new Set(existing.map((m) => m.id));
  let added = 0;
  for (const msg of messages) {
    if (!existingIds.has(msg.id)) {
      existing.push({ ...msg, source: "telegram" });
      added++;
    }
  }
  if (added > 0) writeJSON("messages.json", existing);
  tgUpdateOffset = lastUpdateId + 1;
  res.json({ fetched: added, total: existing.length });
});

// REST API — delete message
app.delete("/api/messages/:id", (req, res) => {
  const messages = readJSON("messages.json");
  const msgIndex = messages.findIndex((m) => m.id === req.params.id);
  if (msgIndex === -1) return res.status(404).json({ error: "Message not found" });

  const msg = messages[msgIndex];

  // Delete local image file if it exists
  if (msg.type === "image" && msg.imageUrl) {
    try {
      const filePath = path.join(__dirname, "public", msg.imageUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log("Deleted local image:", msg.imageUrl);
      }
    } catch (err) {
      console.error("Failed to delete image:", err.message);
    }
  }

  messages.splice(msgIndex, 1);
  writeJSON("messages.json", messages);

  io.to(msg.room).emit("chat:deleted", { id: msg.id, room: msg.room });

  res.json({ success: true });
});

// Socket.io
const onlineUsers = new Map();
const roomUsers = new Map();
const userSockets = new Map();

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on("user:join", (user) => {
    onlineUsers.set(socket.id, user);
    userSockets.set(user.id, socket.id);
    io.emit("users:online", Array.from(onlineUsers.values()));
  });

  socket.on("room:join", (roomName) => {
    socket.join(roomName);
    const users = roomUsers.get(roomName) || [];
    const user = onlineUsers.get(socket.id);
    if (user && !users.find((u) => u.id === user.id)) users.push(user);
    roomUsers.set(roomName, users);
    io.to(roomName).emit("room:users", users);
    console.log(`${user?.username} joined room ${roomName}`);
  });

  socket.on("room:leave", (roomName) => {
    socket.leave(roomName);
    const users = roomUsers.get(roomName) || [];
    const user = onlineUsers.get(socket.id);
    const updated = users.filter((u) => u.id !== user?.id);
    roomUsers.set(roomName, updated);
    io.to(roomName).emit("room:users", updated);
  });

  socket.on("chat:message", (data) => {
    const msg = {
      id: uuidv4(),
      room: data.room,
      userId: data.userId,
      username: data.username,
      text: data.text || "",
      type: data.type || "text",
      imageUrl: data.imageUrl || null,
      timestamp: new Date().toISOString(),
    };
    const messages = readJSON("messages.json");
    messages.push(msg);
    writeJSON("messages.json", messages);
    io.to(data.room).emit("chat:message", msg);
    storeMessageToTelegram(msg).catch(() => {});
  });

  // Call chat messages (during video call)
  socket.on("call:chat-message", (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const msg = {
      id: uuidv4(),
      userId: user.id,
      username: user.username,
      text: data.text,
      callId: data.callId,
      timestamp: new Date().toISOString(),
    };
    const targetSocketId = userSockets.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("call:chat-message", msg);
    }
    // Also send back to sender
    socket.emit("call:chat-message", { ...msg, self: true });
  });

  // Seen receipts — track which messages a user has seen per room
  socket.on("messages:seen", ({ room, userId, lastMsgId }) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    // Store seen state in a file for persistence
    const seenFile = "seen.json";
    const seen = readJSON(seenFile);
    // Remove old entry for this user+room
    const filtered = seen.filter(
      (s) => !(s.userId === userId && s.room === room)
    );
    filtered.push({
      userId,
      room,
      lastMsgId,
      seenAt: new Date().toISOString(),
    });
    writeJSON(seenFile, filtered);
    // Notify others in the room
    socket.to(room).emit("messages:seen", {
      userId,
      username: user.username,
      room,
      lastMsgId,
    });
  });

  // Get seen status for a room
  socket.on("messages:get-seen", ({ room }) => {
    const seen = readJSON("seen.json");
    const roomSeen = seen.filter((s) => s.room === room);
    socket.emit("messages:get-seen", { room, seen: roomSeen });
  });

  socket.on("chat:delete", ({ id, room }) => {
    const messages = readJSON("messages.json");
    const msgIndex = messages.findIndex((m) => m.id === id);
    if (msgIndex === -1) return;

    const msg = messages[msgIndex];
    if (msg.type === "image" && msg.imageUrl) {
      try {
        const filePath = path.join(__dirname, "public", msg.imageUrl);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log("Deleted local image:", msg.imageUrl);
        }
      } catch (err) {
        console.error("Failed to delete image:", err.message);
      }
    }

    messages.splice(msgIndex, 1);
    writeJSON("messages.json", messages);
    io.to(room).emit("chat:deleted", { id, room });
  });

  // WebRTC signaling
  socket.on("call:offer", ({ to, from, offer, callType }) => {
    const callerUser = onlineUsers.get(socket.id);
    const targetSocketId = userSockets.get(to);
    console.log(`call:offer from ${callerUser?.username} (userId:${from}) to userId:${to}, targetSocketId:${targetSocketId}`);
    if (targetSocketId) {
      io.to(targetSocketId).emit("call:offer", {
        from,
        offer,
        callType,
        callerSocketId: socket.id,
        callerUserId: callerUser?.id,
      });
    } else {
      console.log(`call:offer DROPPED — no socket found for userId:${to}`);
    }
  });

  socket.on("call:answer", ({ to, from, answer }) => {
    const targetSocketId = userSockets.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("call:answer", {
        from,
        answer,
        socketId: socket.id,
      });
    }
  });

  socket.on("call:ice-candidate", ({ to, candidate }) => {
    const targetSocketId = userSockets.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("call:ice-candidate", {
        candidate,
        socketId: socket.id,
      });
    }
  });

  socket.on("call:hangup", ({ to }) => {
    const targetSocketId = userSockets.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("call:hangup", { socketId: socket.id });
    }
  });

  socket.on("disconnect", () => {
    const user = onlineUsers.get(socket.id);
    if (user) userSockets.delete(user.id);
    onlineUsers.delete(socket.id);

    for (const [room, users] of roomUsers) {
      roomUsers.set(room, users.filter((u) => u.id !== user?.id));
      io.to(room).emit("room:users", roomUsers.get(room));
    }
    io.emit("users:online", Array.from(onlineUsers.values()));
    console.log("disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

const rooms = readJSON("rooms.json");
if (rooms.length === 0) {
  rooms.push({
    id: uuidv4(),
    name: "General",
    createdBy: "system",
    createdAt: new Date().toISOString(),
  });
  writeJSON("rooms.json", rooms);
  console.log("Created default 'General' room");
}

server.listen(PORT, async () => {
  console.log(`Kadhaipoma server running on http://localhost:${PORT}`);

  // Restore messages from Telegram on startup
  if (TG_TOKEN && TG_CHAT_ID) {
    try {
      const { messages, lastUpdateId } = await fetchTgMessages(0);
      if (messages.length > 0) {
        const existing = readJSON("messages.json");
        const existingIds = new Set(existing.map((m) => m.id));
        let added = 0;
        for (const msg of messages) {
          if (!existingIds.has(msg.id)) {
            existing.push({ ...msg, source: "telegram" });
            added++;
          }
        }
        if (added > 0) {
          writeJSON("messages.json", existing);
          console.log(`Restored ${added} messages from Telegram`);
        }
      }
      tgUpdateOffset = lastUpdateId + 1;
    } catch (err) {
      console.error("Telegram restore failed:", err.message);
    }
  }
});
