import mongoose from 'mongoose';

const GuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  notificationChannelId: { type: String, default: null },
  subscribedPlatforms: { type: [String], default: [] },
  
  // Tracks contests already announced to the channel so it doesn't spam
  announcedContests: { type: [String], default: [] }
}, { timestamps: true });

export const GuildConfig = mongoose.model('GuildConfig', GuildConfigSchema);