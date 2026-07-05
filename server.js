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
const User = require("./models/User");
const authMiddleware = require("./middleware/auth");

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
    methods: ["GET", "POST"]
  }
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

app.use(helmet({
  crossOriginResourcePolicy: false,
}));
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
    api_secret: process.env.CLOUDINARY_API_SECRET 
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
        details: err
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

io.on("connection", (socket) => {
  console.log("New client connected", socket.id);
  
  socket.on("typing", (username) => {
    socket.broadcast.emit("typing", username);
  });
  
  socket.on("stop_typing", () => {
    socket.broadcast.emit("stop_typing");
  });

  socket.on("disconnect", () => {
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
