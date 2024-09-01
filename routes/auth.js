const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const User = require("../models/User");
const authMiddleware = require("../middleware/auth");
const router = express.Router();
require("dotenv").config();

// Generate JWT Token
const generateToken = (userId, name) => {
  const payload = { userId, name };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });
};

// Register
router.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ msg: "User already exists" });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    user = new User({ name, email, password: hashedPassword });

    await user.save();

    // Generate token
    const token = generateToken(user.id, user.name);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    const token = generateToken(user.id, user.name);
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
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    user.customUsername = username;
    await user.save();

    res.json({ customUsername: username });
  } catch (err) {
    console.error("Error setting username:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Check if user has a custom username
router.get("/check-username", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({
      hasCustomUsername: !!user.customUsername,
      username: user.customUsername,
    });
  } catch (err) {
    console.error("Error checking username:", err); // Log the error for debugging
    res.status(500).json({ msg: "Server error" });
  }
});

// Google OAuth
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/auth" }),
  (req, res) => {
    const token = generateToken(req.user.id, req.user.name);
    res.redirect(
      `http://localhost:3000/auth/success?token=${token}&success=true`
    );
  }
);

// GitHub OAuth
router.get(
  "/github",
  passport.authenticate("github", { scope: ["user:email"] })
);

router.get(
  "/github/callback",
  passport.authenticate("github", { failureRedirect: "/auth" }),
  (req, res) => {
    const token = generateToken(req.user.id, req.user.name);
    res.redirect(
      `http://localhost:3000/auth/success?token=${token}&success=true`
    );
  }
);

// Logout
router.post("/logout", (req, res) => {
  try {
    res.status(200).json({ msg: "Logged out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ msg: "Server error during logout" });
  }
});

module.exports = router;
