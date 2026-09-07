const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const passport = require("passport");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const http = require("http");
const socketIo = require("socket.io");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const authRoutes = require("./routes/auth");
const { v2: cloudinary } = require("cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
require("dotenv").config();
require("./config/passport");
const ChatMessage = require("./models/Chat");
const DirectMessage = require("./models/DirectMessage");
const Group = require("./models/Group");
const User = require("./models/User");
const authMiddleware = require("./middleware/auth");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "https://mernfront-agkd.onrender.com";
const uploadsDir = path.join(__dirname, "uploads");

const io = socketIo(server, {
  cors: {
    origin: FRONTEND_ORIGIN,
    credentials: true,
    methods: ["GET", "POST"],
  },
});

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const normalizeHandle = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();

async function chatHandleFromTokenUser(req) {
  const userId = req.user.userId;
  const fallback = String(req.user.name || "").trim();
  try {
    const u = await User.findById(userId).select("customUsername name").lean();
    if (!u) return fallback;
    return String(u.customUsername || u.name || "").trim() || fallback;
  } catch {
    return fallback;
  }
}

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);
app.use(morgan("dev"));

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json());
app.set("trust proxy", 1);
app.use("/uploads", express.static(uploadsDir));
app.use(passport.initialize());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: "Too many attempts from this IP, please try again after 15 minutes",
});
app.use("/auth/login", authLimiter);
app.use("/auth/signup", authLimiter);

const dburi = process.env.DB_URI;

app.use("/auth", authRoutes);

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const uploadStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "chat_uploads",
    resource_type: "auto",
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return cb(new Error("Unsupported file type"));
    }
    cb(null, true);
  },
});

const handleAvatarUpload = (req, res, next) => {
  upload.single("avatar")(req, res, (error) => {
    if (error)
      return res
        .status(400)
        .json({ error: error.message || "Avatar upload failed" });
    next();
  });
};

const authHeaders = (req) => String(req.user?.userId || "");

app.put("/api/user/profile", authMiddleware, async (req, res) => {
  try {
    const { displayName, bio = "", status = "online" } = req.body || {};
    const safeName = String(displayName || "").trim();
    if (!safeName)
      return res.status(400).json({ error: "Display name is required" });
    if (!["online", "away", "busy", "invisible"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const userId = authHeaders(req);
    if (
      mongoose.connection.readyState !== 1 ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      return res
        .status(503)
        .json({ error: "Profile persistence is unavailable" });
    }
    const user = await User.findByIdAndUpdate(
      userId,
      {
        name: safeName,
        customUsername: safeName,
        bio: String(bio).trim(),
        status,
      },
      { new: true, runValidators: true },
    ).select("name customUsername bio status avatarUrl");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ error: "Could not update profile" });
  }
});

app.post(
  "/api/user/avatar",
  authMiddleware,
  handleAvatarUpload,
  async (req, res) => {
    try {
      const userId = authHeaders(req);
      if (!req.file)
        return res.status(400).json({ error: "Avatar file is required" });
      if (
        mongoose.connection.readyState !== 1 ||
        !mongoose.Types.ObjectId.isValid(userId)
      ) {
        return res
          .status(503)
          .json({ error: "Avatar persistence is unavailable" });
      }
      const user = await User.findByIdAndUpdate(
        userId,
        { avatarUrl: req.file.path },
        { new: true },
      ).select("avatarUrl");
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json({ avatarUrl: user.avatarUrl });
    } catch (error) {
      console.error("Error updating avatar:", error);
      res.status(500).json({ error: "Could not update avatar" });
    }
  },
);

app.post("/api/groups/create", authMiddleware, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const memberIds = Array.isArray(req.body?.memberIds)
      ? req.body.memberIds.map(String).filter(Boolean)
      : [];
    const ownerId = authHeaders(req);
    if (!name) return res.status(400).json({ error: "Group name is required" });
    if (mongoose.connection.readyState !== 1) {
      return res
        .status(503)
        .json({ error: "Group persistence is unavailable" });
    }
    const groupId = `${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}-${crypto.randomBytes(3).toString("hex")}`;
    const inviteCode = crypto.randomBytes(16).toString("hex");
    const group = await Group.create({
      groupId,
      name,
      description,
      ownerId,
      memberIds: [...new Set([ownerId, ...memberIds])],
      inviteCode,
      inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    io.emit("group:created", { groupId: group.groupId, name: group.name });
    res
      .status(201)
      .json({ groupId: group.groupId, name: group.name, inviteCode });
  } catch (error) {
    console.error("Error creating group:", error);
    res.status(500).json({ error: "Could not create group" });
  }
});

app.get("/api/groups/:groupId/invite", authMiddleware, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1)
      return res
        .status(503)
        .json({ error: "Invite persistence is unavailable" });
    let group = await Group.findOne({ groupId: req.params.groupId });
    if (!group) {
      const name = String(req.params.groupId).trim() || "general";
      group = await Group.create({
        groupId: name,
        name,
        ownerId: authHeaders(req),
        memberIds: [authHeaders(req)],
        inviteCode: crypto.randomBytes(16).toString("hex"),
        inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    }
    if (group.inviteExpiresAt <= new Date()) {
      group.inviteCode = crypto.randomBytes(16).toString("hex");
      group.inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await group.save();
    }
    const origin = String(
      process.env.FRONTEND_ORIGIN || "http://localhost:3000",
    ).replace(/\/$/, "");
    res.json({
      inviteCode: group.inviteCode,
      inviteUrl: `${origin}/join/${group.inviteCode}`,
    });
  } catch (error) {
    console.error("Error generating invite:", error);
    res.status(500).json({ error: "Could not generate invite" });
  }
});

app.post("/api/groups/join/:code", authMiddleware, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1)
      return res
        .status(503)
        .json({ error: "Group persistence is unavailable" });
    const group = await Group.findOne({ inviteCode: req.params.code });
    if (!group || group.inviteExpiresAt <= new Date())
      return res.status(404).json({ error: "Invite is invalid or expired" });
    const userId = authHeaders(req);
    if (!group.memberIds.includes(userId)) {
      group.memberIds.push(userId);
      await group.save();
    }
    res.json({ groupId: group.groupId, name: group.name });
  } catch (error) {
    console.error("Error joining group:", error);
    res.status(500).json({ error: "Could not join group" });
  }
});

app.get("/messages", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const messages = await ChatMessage.find()
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    res.json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/messages", authMiddleware, async (req, res) => {
  try {
    const {
      user,
      message = "",
      fileUrl = "",
      fileName = "",
      fileType = "",
      fileSize = 0,
    } = req.body;
    const senderId = String(req.user?.userId || "");
    const chatHandle = await chatHandleFromTokenUser(req);
    const displayUser = String(user || chatHandle || "").trim();

    if (!displayUser || (!message.trim() && !fileUrl)) {
      return res
        .status(400)
        .json({ error: "User and either message or file are required" });
    }

    const chatMessage = new ChatMessage({
      user: displayUser,
      senderId,
      message,
      fileUrl,
      fileName,
      fileType,
      fileSize,
    });

    await chatMessage.save();

    io.emit("new_message", chatMessage);

    res.status(201).json(chatMessage);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const handleUpload = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File too large (max 10 MB)" });
      }
      return res.status(400).json({ error: err.message || "Upload failed" });
    }
    if (err) {
      console.error("Upload error details:", err);
      return res.status(400).json({
        error: err.message || err.toString() || "Upload failed",
        details: err,
      });
    }
    next();
  });
};

app.post("/messages/upload", authMiddleware, handleUpload, async (req, res) => {
  try {
    const user = await chatHandleFromTokenUser(req);
    const uploadedFile = req.file;
    const caption = (req.body?.message || "").trim();

    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!uploadedFile) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileUrl = uploadedFile.path;
    const fileMessage =
      caption || `Shared a file: ${uploadedFile.originalname}`;

    const chatMessage = new ChatMessage({
      user,
      senderId: String(req.user?.userId || ""),
      message: fileMessage,
      fileUrl,
      fileName: uploadedFile.originalname,
      fileType: uploadedFile.mimetype,
      fileSize: uploadedFile.size,
    });

    await chatMessage.save();

    io.emit("new_message", chatMessage);

    return res.status(201).json(chatMessage);
  } catch (error) {
    console.error("Error uploading file:", error);
    return res.status(500).json({ error: "File upload failed" });
  }
});

app.delete("/messages/:id", authMiddleware, async (req, res) => {
  try {
    const messageId = req.params.id;
    const chatHandle = await chatHandleFromTokenUser(req);
    const requesterId = String(req.user?.userId || "");

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: "Invalid message ID" });
    }

    const message = await ChatMessage.findById(messageId);
    if (!message) return res.status(404).json({ error: "Message not found" });

    const ownsById =
      message.senderId && String(message.senderId) === requesterId;
    const ownsLegacy =
      normalizeHandle(message.user) === normalizeHandle(chatHandle) ||
      normalizeHandle(message.user) === normalizeHandle(req.user?.name);

    if (!ownsById && !ownsLegacy) {
      return res
        .status(403)
        .json({ error: "Unauthorized to delete this message" });
    }

    await ChatMessage.findByIdAndDelete(messageId);

    io.emit("message_deleted", messageId);

    res.status(200).json({ success: "Message deleted successfully" });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/api/dm/:userId", authMiddleware, async (req, res) => {
  try {
    const currentUserId = String(req.user.userId);
    const otherUserId = String(req.params.userId);
    const messages = await DirectMessage.find({
      $or: [
        { fromUserId: currentUserId, toUserId: otherUserId },
        { fromUserId: otherUserId, toUserId: currentUserId },
      ],
    }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    console.error("Error loading direct messages:", error);
    res.status(500).json({ error: "Could not load private messages" });
  }
});

app.post("/api/dm/:userId/send", authMiddleware, async (req, res) => {
  try {
    const messageText = String(req.body?.message || "").trim();
    const fromUserId = String(req.user.userId);
    const toUserId = String(req.params.userId);
    if (!messageText)
      return res.status(400).json({ error: "Message is required" });
    if (fromUserId === toUserId)
      return res.status(400).json({ error: "Cannot message yourself" });

    const directMessage = await DirectMessage.create({
      fromUserId,
      toUserId,
      senderUsername: String(req.user.name || "User"),
      message: messageText,
    });
    const payload = directMessage.toJSON();
    emitToUser(toUserId, "dm:message", payload);
    emitToUser(fromUserId, "dm:message", payload);
    res.status(201).json(payload);
  } catch (error) {
    console.error("Error sending direct message:", error);
    res.status(500).json({ error: "Could not send private message" });
  }
});

const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.post("/api/get-suggestions", async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages)) {
    return res
      .status(400)
      .json({ error: "Invalid request format: messages array is required." });
  }

  if (!process.env.GROQ_API_KEY) {
    console.error("GROQ_API_KEY is not configured.");
    return res
      .status(500)
      .json({ error: "Smart reply service not configured." });
  }

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You generate smart reply suggestions for a chat app. Use only the provided conversation context and write replies the current user can send next. Return exactly 3 distinct, natural suggestions (2-6 words each), specific to the latest message, and avoid generic filler like 'Help you' or 'Answer questions'. Respond as JSON object with key 'suggestions' containing an array of strings.",
        },
        ...messages,
      ],
      model: "llama-3.1-8b-instant",
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const choice = chatCompletion?.choices?.[0];
    const rawContent = choice?.message?.content;
    const data =
      typeof rawContent === "string" ? JSON.parse(rawContent) : rawContent;

    if (!data || !Array.isArray(data.suggestions)) {
      console.error("Unexpected suggestion payload:", rawContent);
      return res
        .status(500)
        .json({ error: "Invalid response from smart reply service." });
    }

    res.json({ suggestions: data.suggestions });
  } catch (error) {
    console.error("/api/get-suggestions error:", error);
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

const connectedUsers = new Map();

function emitToUser(userId, event, payload) {
  const socketIds = connectedUsers.get(String(userId)) || [];
  socketIds.forEach((socketId) => io.to(socketId).emit(event, payload));
}

io.on("connection", (socket) => {
  console.log("New client connected", socket.id);
  let connectedUserId = "";
  const token = socket.handshake.auth?.token;
  try {
    connectedUserId = String(jwt.verify(token, process.env.JWT_SECRET).userId);
    const sockets = connectedUsers.get(connectedUserId) || [];
    connectedUsers.set(connectedUserId, [...sockets, socket.id]);
  } catch {
    socket.disconnect(true);
    return;
  }

  socket.on("dm:request", ({ toUserId, toUsername }) => {
    if (!toUserId || String(toUserId) === connectedUserId) return;
    emitToUser(toUserId, "dm:request", {
      fromUserId: connectedUserId,
      fromUsername: String(jwt.decode(token)?.name || "User"),
    });
  });

  socket.on("dm:accept", ({ toUserId }) => {
    if (!toUserId) return;
    emitToUser(toUserId, "dm:accepted", {
      byUserId: connectedUserId,
      byUsername: String(jwt.decode(token)?.name || "User"),
    });
  });

  socket.on("dm:decline", ({ toUserId }) => {
    if (!toUserId) return;
    emitToUser(toUserId, "dm:declined", {
      byUserId: connectedUserId,
      byUsername: String(jwt.decode(token)?.name || "User"),
    });
  });

  socket.on("typing", (username) => {
    socket.broadcast.emit("typing", username);
  });

  socket.on("stop_typing", () => {
    socket.broadcast.emit("stop_typing");
  });

  socket.on("disconnect", () => {
    const sockets = (connectedUsers.get(connectedUserId) || []).filter(
      (id) => id !== socket.id,
    );
    if (sockets.length) connectedUsers.set(connectedUserId, sockets);
    else connectedUsers.delete(connectedUserId);
    console.log("Client disconnected", socket.id);
  });
});

const startServer = async () => {
  if (!dburi) {
    console.error("DB_URI missing. Exiting...");
    process.exit(1);
  }

  try {
    await mongoose.connect(dburi, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log("MongoDB connected.");
  } catch (error) {
    console.error("MongoDB connection failed. Exiting...");
    console.error(error.message);
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();
