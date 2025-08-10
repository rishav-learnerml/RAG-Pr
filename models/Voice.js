import mongoose from "mongoose";

export const VoiceSchema = new mongoose.Schema({
  instanceId: { type: String, required: true, unique: true },
  voiceUuid: { type: String, required: true },
  status: { type: String, required: true }, // e.g., "pending", "ready"
});

export const VoiceModel = mongoose.model("Voice", VoiceSchema);
