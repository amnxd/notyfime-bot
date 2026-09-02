import mongoose from 'mongoose';

const UserReminderSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  contestId: { type: String, required: true },
  contestName: { type: String, required: true },
  platform: { type: String, required: true },
  startTime: { type: Date, required: true },
  
  // Single DM milestone
  notified15m: { type: Boolean, default: false }
}, { timestamps: true });

UserReminderSchema.index({ userId: 1, contestId: 1 }, { unique: true });

export const UserReminder = mongoose.model('UserReminder', UserReminderSchema);