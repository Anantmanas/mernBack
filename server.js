const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const passport = require("passport");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const authRoutes = require("./routes/auth");
require("dotenv").config();
require("./config/passport");
const ChatMessage = require("./models/Chat");
const User = require("./models/User");
const authMiddleware = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "https://mernfront-agkd.onrender.com";
const uploadsDir = path.join(__dirname, "uploads");

// #region agent log helper
const _dbgLog = (payload) => {
  try {
    const line = JSON.stringify({ sessionId: "7fa3ab", timestamp: Date.now(), ...payload }) + "\n";
    fs.appendFileSync(path.join(__dirname, "../debug-7fa3ab.log"), line);
  } catch (_) {}
};
// #endregion

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

let isMongoConnected = false;
const memoryMessages = [];

const normalizeHandle = (s) => String(s || "").trim().toLowerCase();

/** Chat display name: custom username when set, else account name (matches client + delete checks) */
async function chatHandleFromTokenUser(req) {
  const userId = req.user.userId;
  const fallback = String(req.user.name || "").trim();
  if (!isMongoConnected) {
    const mem =
      typeof authRoutes.findMemoryUserById === "function"
        ? authRoutes.findMemoryUserById(userId)
        : null;
    if (!mem) return fallback;
    return String(mem.customUsername || mem.name || "").trim() || fallback;
  }
  try {
    const u = await User.findById(userId).select("customUsername name").lean();
    if (!u) return fallback;
    return String(u.customUsername || u.name || "").trim() || fallback;
  } catch {
    return fallback;
  }
}

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json());
app.set("trust proxy", 1);
app.use("/uploads", express.static(uploadsDir));
app.use(
  session({
    secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || "chatroom_session_secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());

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

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
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

app.get("/messages", async (req, res) => {
  try {
    if (!isMongoConnected) {
      return res.json([...memoryMessages].reverse());
    }

    const messages = await ChatMessage.find().sort({ timestamp: -1 });
    res.json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/messages", authMiddleware, async (req, res) => {
  try {
    const { user, message = "", fileUrl = "", fileName = "", fileType = "", fileSize = 0 } =
      req.body;
    const senderId = String(req.user?.userId || "");
    const chatHandle = await chatHandleFromTokenUser(req);
    const displayUser = String(user || chatHandle || "").trim();

    // #region agent log
    _dbgLog({ runId: "initial", hypothesisId: "H4", location: "server.js:POST /messages", message: "message POST payload", data: { hasUser: !!user, hasMessage: !!(message || "").trim(), hasFileUrl: !!fileUrl, isMongoConnected, dburiConfigured: !!dburi } });
    // #endregion
    if (!displayUser || (!message.trim() && !fileUrl)) {
      return res
        .status(400)
        .json({ error: "User and either message or file are required" });
    }

    if (!isMongoConnected) {
      const newMessage = {
        _id: new mongoose.Types.ObjectId().toString(),
        user: displayUser,
        senderId,
        message,
        fileUrl,
        fileName,
        fileType,
        fileSize,
        timestamp: new Date().toISOString(),
      };
      memoryMessages.push(newMessage);
      return res.status(201).json(newMessage);
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

    res.status(201).json(chatMessage);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const handleUpload = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    // #region agent log
    if (err) _dbgLog({ runId: "initial", hypothesisId: "H3", location: "server.js:handleUpload", message: "multer error", data: { errCode: err?.code || null, errMessage: (err?.message || "").slice(0, 200) } });
    // #endregion
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File too large (max 10 MB)" });
      }
      return res.status(400).json({ error: err.message || "Upload failed" });
    }
    if (err) {
      return res.status(400).json({
        error: err.message === "Unsupported file type" ? err.message : "Upload failed",
      });
    }
    next();
  });
};

app.post(
  "/messages/upload",
  authMiddleware,
  handleUpload,
  async (req, res) => {
    try {
      const user = await chatHandleFromTokenUser(req);
      const uploadedFile = req.file;
      const caption = (req.body?.message || "").trim();

      // #region agent log
      _dbgLog({ runId: "initial", hypothesisId: "H3", location: "server.js:POST /messages/upload", message: "upload handler inputs", data: { hasUser: !!user, usernameLen: (user || "").length, hasFile: !!uploadedFile, fileMime: uploadedFile?.mimetype || null, isMongoConnected } });
      // #endregion

      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!uploadedFile) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${uploadedFile.filename}`;
      const fileMessage = caption || `Shared a file: ${uploadedFile.originalname}`;

      if (!isMongoConnected) {
        const newMessage = {
          _id: new mongoose.Types.ObjectId().toString(),
          user,
          senderId: String(req.user?.userId || ""),
          message: fileMessage,
          fileUrl,
          fileName: uploadedFile.originalname,
          fileType: uploadedFile.mimetype,
          fileSize: uploadedFile.size,
          timestamp: new Date().toISOString(),
        };
        memoryMessages.push(newMessage);
        return res.status(201).json(newMessage);
      }

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
      return res.status(201).json(chatMessage);
    } catch (error) {
      console.error("Error uploading file:", error);
      return res.status(500).json({ error: "File upload failed" });
    }
  },
);

app.delete("/messages/:id", authMiddleware, async (req, res) => {
  try {
    const messageId = req.params.id;
    const chatHandle = await chatHandleFromTokenUser(req);
    const requesterId = String(req.user?.userId || "");

    if (!isMongoConnected) {
      const messageIndex = memoryMessages.findIndex((m) => m._id === messageId);
      if (messageIndex === -1) {
        return res.status(404).json({ error: "Message not found" });
      }
      const message = memoryMessages[messageIndex];
      const ownsById = message.senderId && String(message.senderId) === requesterId;
      const ownsLegacy =
        normalizeHandle(message.user) === normalizeHandle(chatHandle) ||
        normalizeHandle(message.user) === normalizeHandle(req.user?.name);
      if (!ownsById && !ownsLegacy) {
        return res
          .status(403)
          .json({ error: "Unauthorized to delete this message" });
      }
      memoryMessages.splice(messageIndex, 1);
      return res.status(200).json({ success: "Message deleted successfully" });
    }

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: "Invalid message ID" });
    }

    const message = await ChatMessage.findById(messageId);
    if (!message) return res.status(404).json({ error: "Message not found" });

    const ownsById = message.senderId && String(message.senderId) === requesterId;
    const ownsLegacy =
      normalizeHandle(message.user) === normalizeHandle(chatHandle) ||
      normalizeHandle(message.user) === normalizeHandle(req.user?.name);

    if (!ownsById && !ownsLegacy) {
      return res
        .status(403)
        .json({ error: "Unauthorized to delete this message" });
    }

    await ChatMessage.findByIdAndDelete(messageId);

    res.status(200).json({ success: "Message deleted successfully" });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.post("/api/get-suggestions", async (req, res) => {
  const { messages } = req.body;

  // #region agent log
  _dbgLog({ runId: "initial", hypothesisId: "H2", location: "server.js:POST /api/get-suggestions", message: "suggestions preflight", data: { messagesIsArray: Array.isArray(messages), messagesCount: Array.isArray(messages) ? messages.length : null, groqApiKeyConfigured: !!process.env.GROQ_API_KEY } });
  // #endregion

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
    // #region agent log
    _dbgLog({ runId: "initial", hypothesisId: "H2", location: "server.js:POST /api/get-suggestions:catch", message: "suggestions handler failed", data: { errorName: error?.name || null, errorMessage: (error?.message || "").slice(0, 200) } });
    // #endregion
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

const startServer = async () => {
  if (dburi) {
    try {
      await mongoose.connect(dburi, {
        serverSelectionTimeoutMS: 8000,
      });
      isMongoConnected = true;
      console.log("MongoDB connected.");
      // #region agent log
      _dbgLog({ runId: "initial", hypothesisId: "H4", location: "server.js:startServer:success", message: "MongoDB connected", data: { isMongoConnected: true, dburiConfigured: !!dburi } });
      // #endregion
    } catch (error) {
      isMongoConnected = false;
      console.warn("MongoDB connection failed, switching to local memory mode.");
      console.warn(error.message);
      // #region agent log
      _dbgLog({ runId: "initial", hypothesisId: "H4", location: "server.js:startServer:failure", message: "MongoDB connect failed", data: { isMongoConnected: false, dburiConfigured: !!dburi, errorName: error?.name || null, errorMessage: (error?.message || "").slice(0, 200) } });
      // #endregion
    }
  } else {
    console.warn("DB_URI missing, starting in local memory mode.");
  }

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();
