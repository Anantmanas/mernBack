require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
const DB_URI = process.env.DB_URI;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000";

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());

let useMongo = false;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    email: { type: String, unique: true, required: true, trim: true },
    password: { type: String, required: true },
    username: { type: String, default: "" },
  },
  { timestamps: true }
);

const messageSchema = new mongoose.Schema(
  {
    user: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
  },
  { timestamps: { createdAt: "timestamp", updatedAt: false } }
);

const User = mongoose.model("User", userSchema);
const Message = mongoose.model("Message", messageSchema);

const memoryUsers = [];
const memoryMessages = [];

const authMiddleware = (req, res, next) => {
  const token = req.header("x-auth-token");
  if (!token) {
    return res.status(401).json({ msg: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded.user;
    return next();
  } catch (_error) {
    return res.status(401).json({ msg: "Token is not valid" });
  }
};

const createToken = (userId) =>
  jwt.sign({ user: { id: userId } }, JWT_SECRET, { expiresIn: "7d" });

const findUserById = async (id) => {
  if (useMongo) {
    return User.findById(id);
  }
  return memoryUsers.find((u) => u._id === id) || null;
};

app.get("/health", (_req, res) => {
  res.json({ ok: true, storage: useMongo ? "mongo" : "memory" });
});

app.post("/auth/signup", async (req, res) => {
  try {
    const { name = "", email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ msg: "Email and password are required." });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    if (useMongo) {
      const existing = await User.findOne({ email: normalizedEmail });
      if (existing) {
        return res.status(400).json({ msg: "User already exists." });
      }

      const hashed = await bcrypt.hash(password, 10);
      const newUser = await User.create({
        name: String(name).trim(),
        email: normalizedEmail,
        password: hashed,
      });
      const token = createToken(newUser._id.toString());
      return res.json({ token });
    }

    const existing = memoryUsers.find((u) => u.email === normalizedEmail);
    if (existing) {
      return res.status(400).json({ msg: "User already exists." });
    }

    const hashed = await bcrypt.hash(password, 10);
    const newUser = {
      _id: new mongoose.Types.ObjectId().toString(),
      name: String(name).trim(),
      email: normalizedEmail,
      password: hashed,
      username: "",
    };
    memoryUsers.push(newUser);
    const token = createToken(newUser._id);
    return res.json({ token });
  } catch (error) {
    return res.status(500).json({ msg: "Server error", error: error.message });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ msg: "Email and password are required." });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    let user;
    if (useMongo) {
      user = await User.findOne({ email: normalizedEmail });
    } else {
      user = memoryUsers.find((u) => u.email === normalizedEmail) || null;
    }

    if (!user) {
      return res.status(400).json({ msg: "Invalid credentials." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid credentials." });
    }

    const token = createToken(user._id.toString());
    return res.json({ token });
  } catch (error) {
    return res.status(500).json({ msg: "Server error", error: error.message });
  }
});

app.post("/auth/validate-token", (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ msg: "Token is required." });
  }
  try {
    jwt.verify(token, JWT_SECRET);
    return res.json({ valid: true });
  } catch (_error) {
    return res.status(401).json({ valid: false, msg: "Invalid token." });
  }
});

app.get("/auth/check-username", authMiddleware, async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: "User not found." });
    }
    const username = user.username || "";
    return res.json({
      username,
      hasCustomUsername: Boolean(username),
    });
  } catch (error) {
    return res.status(500).json({ msg: "Server error", error: error.message });
  }
});

app.post("/auth/set-username", authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || !String(username).trim()) {
      return res.status(400).json({ msg: "Username is required." });
    }

    const safeUsername = String(username).trim();

    if (useMongo) {
      const updated = await User.findByIdAndUpdate(
        req.user.id,
        { username: safeUsername },
        { new: true }
      );
      if (!updated) {
        return res.status(404).json({ msg: "User not found." });
      }
      return res.json({ customUsername: updated.username });
    }

    const index = memoryUsers.findIndex((u) => u._id === req.user.id);
    if (index === -1) {
      return res.status(404).json({ msg: "User not found." });
    }

    memoryUsers[index].username = safeUsername;
    return res.json({ customUsername: safeUsername });
  } catch (error) {
    return res.status(500).json({ msg: "Server error", error: error.message });
  }
});

app.post("/auth/logout", (_req, res) => {
  return res.json({ msg: "Logged out successfully." });
});

app.get("/messages", async (_req, res) => {
  try {
    if (useMongo) {
      const messages = await Message.find({}).sort({ timestamp: 1 });
      return res.json(messages);
    }
    const ordered = [...memoryMessages].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );
    return res.json(ordered);
  } catch (error) {
    return res.status(500).json({ msg: "Server error", error: error.message });
  }
});

app.post("/messages", authMiddleware, async (req, res) => {
  try {
    const { user, message } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ msg: "Message is required." });
    }

    const sender = await findUserById(req.user.id);
    if (!sender) {
      return res.status(404).json({ msg: "User not found." });
    }

    const nameToSave = user || sender.username || sender.name || "User";

    if (useMongo) {
      const saved = await Message.create({
        user: String(nameToSave).trim(),
        message: String(message).trim(),
      });
      return res.status(201).json(saved);
    }

    const saved = {
      _id: new mongoose.Types.ObjectId().toString(),
      user: String(nameToSave).trim(),
      message: String(message).trim(),
      timestamp: new Date().toISOString(),
    };
    memoryMessages.push(saved);
    return res.status(201).json(saved);
  } catch (error) {
    return res.status(500).json({ msg: "Server error", error: error.message });
  }
});

app.delete("/messages/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    if (useMongo) {
      const deleted = await Message.findByIdAndDelete(id);
      if (!deleted) {
        return res.status(404).json({ msg: "Message not found." });
      }
      return res.json({ msg: "Message deleted." });
    }

    const index = memoryMessages.findIndex((m) => m._id === id);
    if (index === -1) {
      return res.status(404).json({ msg: "Message not found." });
    }
    memoryMessages.splice(index, 1);
    return res.json({ msg: "Message deleted." });
  } catch (error) {
    return res.status(500).json({ msg: "Server error", error: error.message });
  }
});

const start = async () => {
  if (DB_URI) {
    try {
      await mongoose.connect(DB_URI);
      useMongo = true;
      console.log("Connected to MongoDB.");
    } catch (error) {
      useMongo = false;
      console.warn("MongoDB connection failed, using in-memory storage.");
      console.warn(error.message);
    }
  } else {
    console.warn("DB_URI not set, using in-memory storage.");
  }

  app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });
};

start();
