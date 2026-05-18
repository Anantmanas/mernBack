const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const mongoose = require("mongoose");
const User = require("../models/User");
const authMiddleware = require("../middleware/auth");
const router = express.Router();
require("dotenv").config();

const memoryUsers = [];
const FRONTEND_ORIGIN =
  (process.env.FRONTEND_ORIGIN || "https://mernfront-agkd.onrender.com").replace(/\/$/, "");
const FRONTEND_SUCCESS_URL =
  process.env.FRONTEND_SUCCESS_URL || `${FRONTEND_ORIGIN}/auth/success`;
const hasGoogleOAuth =
  Boolean(process.env.GOOGLE_CLIENT_ID) &&
  Boolean(process.env.GOOGLE_CLIENT_SECRET);
const hasGithubOAuth =
  Boolean(process.env.GITHUB_CLIENT_ID) &&
  Boolean(process.env.GITHUB_CLIENT_SECRET);

// Generate JWT Token
const generateToken = (userId, name) => {
  const payload = { userId, name };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });
};

const useMongo = () => mongoose.connection.readyState === 1;

// Register
router.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).json({ msg: "Email and password are required" });
    }

    const safeEmail = String(email).toLowerCase().trim();
    const safeName = String(name || "").trim() || "User";

    if (useMongo()) {
      let user = await User.findOne({ email: safeEmail });
      if (user) return res.status(400).json({ msg: "User already exists" });

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      user = new User({ name: safeName, email: safeEmail, password: hashedPassword });
      await user.save();

      const token = generateToken(user.id, user.name);
      return res.json({ token });
    }

    const existingMemoryUser = memoryUsers.find((u) => u.email === safeEmail);
    if (existingMemoryUser) {
      return res.status(400).json({ msg: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const memoryUser = {
      id: new mongoose.Types.ObjectId().toString(),
      name: safeName,
      email: safeEmail,
      password: hashedPassword,
      customUsername: "",
    };
    memoryUsers.push(memoryUser);
    const token = generateToken(memoryUser.id, memoryUser.name);
    return res.json({ token });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).json({ msg: "Email and password are required" });
    }

    const safeEmail = String(email).toLowerCase().trim();
    let user = null;

    if (useMongo()) {
      user = await User.findOne({ email: safeEmail });
    } else {
      user = memoryUsers.find((u) => u.email === safeEmail) || null;
    }

    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    const token = generateToken(user.id || user._id.toString(), user.name);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// Validate Token
router.post("/validate-token", (req, res) => {
  const { token } = req.body;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true, userId: decoded.userId });
  } catch (err) {
    res.status(401).json({ valid: false, msg: "Invalid token" });
  }
});

// Set-username
router.post("/set-username", authMiddleware, async (req, res) => {
  const { username } = req.body;
  const userId = req.user.userId;

  if (!username) {
    return res.status(400).json({ msg: "Username is required" });
  }

  try {
    if (useMongo()) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ msg: "User not found" });
      }

      user.customUsername = username;
      await user.save();

      return res.json({ customUsername: username });
    }

    const index = memoryUsers.findIndex((u) => u.id === userId);
    if (index === -1) {
      return res.status(404).json({ msg: "User not found" });
    }

    memoryUsers[index].customUsername = username;
    return res.json({ customUsername: username });
  } catch (err) {
    console.error("Error setting username:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Check if user has a custom username
router.get("/check-username", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    if (useMongo()) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ msg: "User not found" });
      }

      return res.json({
        hasCustomUsername: !!user.customUsername,
        username: user.customUsername,
      });
    }

    const memoryUser = memoryUsers.find((u) => u.id === userId);
    if (!memoryUser) {
      return res.status(404).json({ msg: "User not found" });
    }

    return res.json({
      hasCustomUsername: !!memoryUser.customUsername,
      username: memoryUser.customUsername,
    });
  } catch (err) {
    console.error("Error checking username:", err); // Log the error for debugging
    res.status(500).json({ msg: "Server error" });
  }
});

// Google OAuth
router.get("/google", (req, res, next) => {
  if (!hasGoogleOAuth) {
    return res
      .status(503)
      .json({ msg: "Google OAuth not configured on this server." });
  }
  if (!useMongo()) {
    return res
      .status(503)
      .json({ msg: "Google OAuth unavailable while database is disconnected." });
  }
  return passport.authenticate("google", { scope: ["profile", "email"] })(
    req,
    res,
    next
  );
});

router.get("/google/callback", (req, res, next) => {
  if (!hasGoogleOAuth) {
    return res
      .status(503)
      .json({ msg: "Google OAuth not configured on this server." });
  }
  if (!useMongo()) {
    return res
      .status(503)
      .json({ msg: "Google OAuth unavailable while database is disconnected." });
  }
  return passport.authenticate("google", { session: false }, (err, user) => {
    if (err) {
      console.error("Google OAuth callback error:", err);
      return res.status(500).json({ msg: "Google authentication failed." });
    }
    if (!user) {
      return res.status(401).json({ msg: "Google authentication failed." });
    }
    const token = generateToken(user.id, user.name);
    return res.redirect(`${FRONTEND_SUCCESS_URL}?token=${token}&success=true`);
  })(req, res, next);
});

// GitHub OAuth
router.get("/github", (req, res, next) => {
  if (!hasGithubOAuth) {
    return res
      .status(503)
      .json({ msg: "GitHub OAuth not configured on this server." });
  }
  if (!useMongo()) {
    return res
      .status(503)
      .json({ msg: "GitHub OAuth unavailable while database is disconnected." });
  }
  return passport.authenticate("github", { scope: ["user:email"] })(
    req,
    res,
    next
  );
});

router.get("/github/callback", (req, res, next) => {
  if (!hasGithubOAuth) {
    return res
      .status(503)
      .json({ msg: "GitHub OAuth not configured on this server." });
  }
  if (!useMongo()) {
    return res
      .status(503)
      .json({ msg: "GitHub OAuth unavailable while database is disconnected." });
  }
  return passport.authenticate("github", { session: false }, (err, user) => {
    if (err) {
      console.error("GitHub OAuth callback error:", err);
      return res.status(500).json({ msg: "GitHub authentication failed." });
    }
    if (!user) {
      return res.status(401).json({ msg: "GitHub authentication failed." });
    }
    const token = generateToken(user.id, user.name);
    return res.redirect(`${FRONTEND_SUCCESS_URL}?token=${token}&success=true`);
  })(req, res, next);
});

// Logout
router.post("/logout", (req, res) => {
  try {
    res.status(200).json({ msg: "Logged out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ msg: "Server error during logout" });
  }
});

/** Used by server.js (memory mode) to resolve chat handle vs JWT display name */
router.findMemoryUserById = (userId) =>
  memoryUsers.find((u) => String(u.id) === String(userId)) || null;

module.exports = router;
