const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String },
  googleId: { type: String },
  githubId: { type: String },
  customUsername: { type: String },
  bio: { type: String, default: "" },
  status: {
    type: String,
    enum: ["online", "away", "busy", "invisible"],
    default: "online",
  },
  avatarUrl: { type: String, default: "" },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);
