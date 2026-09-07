const mongoose = require("mongoose");

const groupSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    ownerId: { type: String, required: true },
    memberIds: { type: [String], default: [] },
    inviteCode: { type: String, required: true, unique: true, index: true },
    inviteExpiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Group", groupSchema);
