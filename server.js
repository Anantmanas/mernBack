const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const passport = require("passport");
const session = require("express-session");
const authRoutes = require("./routes/auth");
require("dotenv").config();
require("./config/passport");
const ChatMessage = require("./models/Chat");
const jwt = require("jsonwebtoken");
const authMiddleware = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000";

let isMongoConnected = false;
const memoryMessages = [];

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === "production" },
  })
);
app.use(passport.initialize());
app.use(passport.session());

const dburi = process.env.DB_URI;

app.use("/auth", authRoutes);

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

app.post("/messages", async (req, res) => {
  try {
    const { user, message } = req.body;

    if (!user || !message) {
      return res.status(400).json({ error: "User and message are required" });
    }

    if (!isMongoConnected) {
      const newMessage = {
        _id: new mongoose.Types.ObjectId().toString(),
        user,
        message,
        timestamp: new Date().toISOString(),
      };
      memoryMessages.push(newMessage);
      return res.status(201).json(newMessage);
    }

    const chatMessage = new ChatMessage({
      user,
      message,
    });

    await chatMessage.save();

    res.status(201).json(chatMessage);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.delete("/messages/:id", authMiddleware, async (req, res) => {
  try {
    const messageId = req.params.id;
    const username = req.user.name;

    if (!isMongoConnected) {
      const messageIndex = memoryMessages.findIndex((m) => m._id === messageId);
      if (messageIndex === -1) {
        return res.status(404).json({ error: "Message not found" });
      }
      if (memoryMessages[messageIndex].user !== username) {
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

    if (message.user !== username) {
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

const startServer = async () => {
  if (dburi) {
    try {
      await mongoose.connect(dburi, {
        serverSelectionTimeoutMS: 8000,
      });
      isMongoConnected = true;
      console.log("MongoDB connected.");
    } catch (error) {
      isMongoConnected = false;
      console.warn("MongoDB connection failed, switching to local memory mode.");
      console.warn(error.message);
    }
  } else {
    console.warn("DB_URI missing, starting in local memory mode.");
  }

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();
