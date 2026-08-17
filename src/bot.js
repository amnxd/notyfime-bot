import { Client, GatewayIntentBits, Events } from 'discord.js';
import cron from 'node-cron';
import express from 'express'; // Added for UptimeRobot
import 'dotenv/config';

import { connectDB } from './database/connect.js';
import { GuildConfig } from './database/GuildConfig.js';
import { fetchUpcomingContests } from './services/clistService.js';
import { createContestEmbed } from './utils/embedBuilder.js';

// --- 1. UPTIMEROBOT PING SERVER ---
const app = express();
app.get('/', (req, res) => res.send('Notyfime is awake!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Express ping server running on port ${PORT}`));

// --- 2. DISCORD BOT SETUP ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Time constants in milliseconds
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

async function runContestNotificationJob() {
  try {
    const configs = await GuildConfig.find({ notificationChannelId: { $ne: null } });
    if (configs.length === 0) return;

    for (const config of configs) {
      if (!config.subscribedPlatforms || config.subscribedPlatforms.length === 0) continue;

      const channel = await client.channels.fetch(config.notificationChannelId).catch(() => null);
      if (!channel) continue;

      // Fetch contests up to 8 days in advance (192 hours)
      const contests = await fetchUpcomingContests(config.subscribedPlatforms, 192);
      let configChanged = false;

      for (const contest of contests) {
        const timeUntil = new Date(contest.start).getTime() - Date.now();
        
        // Skip past contests
        if (timeUntil <= 0) continue; 

        let targetArray = null;
        let reminderLabel = '';

        // Check milestones from shortest to longest
        if (timeUntil <= ONE_HOUR && !config.notified1h.includes(contest.id)) {
          targetArray = 'notified1h';
          reminderLabel = '1 HOUR LEFT';
        } else if (timeUntil > ONE_HOUR && timeUntil <= ONE_DAY && !config.notified24h.includes(contest.id)) {
          targetArray = 'notified24h';
          reminderLabel = '24 HOURS LEFT';
        } else if (timeUntil > ONE_DAY && timeUntil <= 3 * ONE_DAY && !config.notified3d.includes(contest.id)) {
          targetArray = 'notified3d';
          reminderLabel = '3 DAYS LEFT';
        } else if (timeUntil > 3 * ONE_DAY && timeUntil <= 7 * ONE_DAY && !config.notified1w.includes(contest.id)) {
          targetArray = 'notified1w';
          reminderLabel = '1 WEEK LEFT';
        }

        // If a milestone is triggered, send the message and save to DB
        if (targetArray) {
          const embed = createContestEmbed(contest, true, reminderLabel);
          await channel.send({ embeds: [embed] });
          config[targetArray].push(contest.id);
          configChanged = true;
        }
      }

      if (configChanged) await config.save();
    }
  } catch (error) {
    console.error('Error in notification job:', error);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`🚀 Notyfime is online! Authenticated as ${c.user.tag}`);
  await connectDB();

  // Run the check every 15 minutes to catch the 1-hour window accurately
  cron.schedule('*/15 * * * *', async () => {
    console.log('🔄 Checking time-milestones for upcoming contests...');
    await runContestNotificationJob();
  });
});

// --- COMMAND HANDLING (Kept identical to your working setup) ---
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guildId, channelId } = interaction;

  let config = await GuildConfig.findOne({ guildId });
  if (!config) {
    config = await GuildConfig.create({ guildId, notificationChannelId: channelId });
  }

  try {
    if (commandName === 'set_channel') {
      config.notificationChannelId = channelId;
      await config.save();
      await interaction.reply({ content: `✅ Notifications set to <#${channelId}>.`, ephemeral: true });
    }
    if (commandName === 'subscribe') {
      const platform = interaction.options.getString('platform');
      if (config.subscribedPlatforms.includes(platform)) {
        config.subscribedPlatforms = config.subscribedPlatforms.filter(p => p !== platform);
        await config.save();
        await interaction.reply({ content: `❌ Removed **${platform}**.`, ephemeral: true });
      } else {
        config.subscribedPlatforms.push(platform);
        await config.save();
        await interaction.reply({ content: `✅ Added **${platform}**.`, ephemeral: true });
      }
    }
    if (commandName === 'upcoming') {
      await interaction.deferReply();
      const p = interaction.options.getString('platform');
      const targets = p ? [p] : config.subscribedPlatforms;
      const contests = await fetchUpcomingContests(targets, 72);
      if (contests.length === 0) return interaction.editReply('No contests found.');
      const embeds = contests.slice(0, 4).map(c => createContestEmbed(c, false));
      await interaction.editReply({ embeds });
    }
  } catch (error) {
    console.error(error);
    const msg = 'Error executing command.';
    if (interaction.deferred) await interaction.followUp({ content: msg, ephemeral: true });
    else await interaction.reply({ content: msg, ephemeral: true });
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);