import mongoose from 'mongoose';

const UserReminderSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  contestId: { type: String, required: true },
  contestName: { type: String, required: true },
  platform: { type: String, required: true },
  startTime: { type: Date, required: true },
  
  // Opt-in milestone trackers for the user
  notified3d: { type: Boolean, default: false },
  notified1d: { type: Boolean, default: false },
  notified3h: { type: Boolean, default: false },
  notified30m: { type: Boolean, default: false }
}, { timestamps: true });

// Ensure a user can only subscribe to a specific contest once
UserReminderSchema.index({ userId: 1, contestId: 1 }, { unique: true });

export const UserReminder = mongoose.model('UserReminder', UserReminderSchema);