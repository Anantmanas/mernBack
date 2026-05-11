const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema({
  user: { type: String, required: true },
  message: { type: String, default: "" },
  fileUrl: { type: String, default: "" },
  fileName: { type: String, default: "" },
  fileType: { type: String, default: "" },
  fileSize: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
