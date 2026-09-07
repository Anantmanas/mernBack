const mongoose = require("mongoose");

const directMessageSchema = new mongoose.Schema({
  fromUserId: { type: String, required: true, index: true },
  toUserId: { type: String, required: true, index: true },
  senderUsername: { type: String, required: true },
  message: { type: String, required: true, trim: true },
  timestamp: { type: Date, default: Date.now },
});

directMessageSchema.index({ fromUserId: 1, toUserId: 1, timestamp: 1 });

directMessageSchema.virtual("createdAt").get(function getCreatedAt() {
  return this.timestamp;
});

directMessageSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("DirectMessage", directMessageSchema);
