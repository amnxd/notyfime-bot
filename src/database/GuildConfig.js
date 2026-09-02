import mongoose from 'mongoose';

const GuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  notificationChannelId: { type: String, default: null },
  subscribedPlatforms: { type: [String], default: [] },
  
  // Channel recurring milestones
  notified3d: { type: [String], default: [] },
  notified1d: { type: [String], default: [] },
  notified2h: { type: [String], default: [] }
}, { timestamps: true });

export const GuildConfig = mongoose.model('GuildConfig', GuildConfigSchema);