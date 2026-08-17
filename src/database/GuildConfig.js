import mongoose from 'mongoose';
import { DEFAULT_PLATFORMS } from '../constants/platforms.js';

const GuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  notificationChannelId: { type: String, default: null },
  subscribedPlatforms: { type: [String], default: DEFAULT_PLATFORMS },
  
  // New milestone trackers
  notified1w: { type: [Number], default: [] },
  notified3d: { type: [Number], default: [] },
  notified24h: { type: [Number], default: [] },
  notified1h: { type: [Number], default: [] }
}, { timestamps: true });

export const GuildConfig = mongoose.model('GuildConfig', GuildConfigSchema);