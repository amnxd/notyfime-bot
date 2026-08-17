import { Client, GatewayIntentBits, Events } from 'discord.js';
import cron from 'node-cron';
import express from 'express'; // Added for UptimeRobot
import 'dotenv/config';

import { connectDB } from './database/connect.js';
import { GuildConfig } from './database/GuildConfig.js';
import { fetchUpcomingContests } from './services/clistService.js';
import { createContestEmbed } from './utils/embedBuilder.js';

// --- 0. ENVIRONMENT SANITY CHECK ---
console.log('--- Environment Check ---');
console.log(`DISCORD_BOT_TOKEN: ${process.env.DISCORD_BOT_TOKEN ? 'Loaded (Length: ' + process.env.DISCORD_BOT_TOKEN.trim().length + ')' : '❌ MISSING'}`);
console.log(`MONGO_URI: ${process.env.MONGO_URI ? 'Loaded' : '❌ MISSING'}`);
console.log(`CLIST_USERNAME: ${process.env.CLIST_USERNAME ? 'Loaded' : '❌ MISSING'}`);
console.log(`CLIST_API_KEY: ${process.env.CLIST_API_KEY ? 'Loaded' : '❌ MISSING'}`);
console.log('-------------------------');

// --- 1. UPTIMEROBOT PING SERVER ---
const app = express();
app.get('/', (req, res) => res.send('Notyfime is awake!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Express ping server running on port ${PORT}`));

// --- 2. DISCORD BOT SETUP & DEBUGGING ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Discord Gateway Diagnostic Listeners
client.on('error', (err) => console.error('🚨 Discord Client Error:', err));
client.on('warn', (warn) => console.warn('⚠️ Discord Client Warning:', warn));
client.on('debug', (info) => console.log('🔍 [Debug]:', info));

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

// --- 3. COMMAND HANDLING ---
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guildId, channelId } = interaction;

  // Fetch or create the server's database configuration
  let config = await GuildConfig.findOne({ guildId });
  if (!config) {
    config = await GuildConfig.create({ guildId, notificationChannelId: channelId });
  }

  try {
    // COMMAND 1: /set_channel
    if (commandName === 'set_channel') {
      config.notificationChannelId = channelId;
      await config.save();
      return await interaction.reply({ content: `✅ Notifications set to <#${channelId}>.`, ephemeral: true });
    }

    // COMMAND 2: /subscribe
    if (commandName === 'subscribe') {
      const platform = interaction.options.getString('platform');
      if (!platform) {
        return await interaction.reply({ content: `❌ Please specify a platform to subscribe to.`, ephemeral: true });
      }

      if (config.subscribedPlatforms.includes(platform)) {
        config.subscribedPlatforms = config.subscribedPlatforms.filter(p => p !== platform);
        await config.save();
        return await interaction.reply({ content: `❌ Removed **${platform}** from notifications.`, ephemeral: true });
      } else {
        config.subscribedPlatforms.push(platform);
        await config.save();
        return await interaction.reply({ content: `✅ Added **${platform}** to notifications.`, ephemeral: true });
      }
    }

    // COMMAND 3: /subscriptions
    if (commandName === 'subscriptions') {
      if (!config.subscribedPlatforms || config.subscribedPlatforms.length === 0) {
        return await interaction.reply({ content: `ℹ️ This server is not subscribed to any platforms yet. Use \`/subscribe\` to add some!`, ephemeral: true });
      }
      const list = config.subscribedPlatforms.map(p => `• ${p}`).join('\n');
      return await interaction.reply({ content: `**Current Subscriptions:**\n${list}`, ephemeral: true });
    }

    // COMMAND 4: /upcoming (Extended to 14 days / 336 hours)
    if (commandName === 'upcoming') {
      await interaction.deferReply();
      const p = interaction.options.getString('platform');
      const targets = p ? [p] : config.subscribedPlatforms;
      
      if (!targets || targets.length === 0) {
        return await interaction.editReply('⚠️ No platforms selected. Please specify a platform or use `/subscribe` first.');
      }

      const contests = await fetchUpcomingContests(targets, 336);
      if (!contests || contests.length === 0) {
        return await interaction.editReply('ℹ️ No upcoming contests found for the selected platforms in the next 14 days.');
      }
      
      const embeds = contests.slice(0, 4).map(c => createContestEmbed(c, false));
      return await interaction.editReply({ embeds });
    }

    // Catch-all for any unrecognized commands
    return await interaction.reply({ content: `❌ Command not recognized.`, ephemeral: true });

  } catch (error) {
    console.error(`🚨 Error executing /${commandName}:`, error);
    const msg = '❌ An error occurred while executing this command. Please try again.';
    
    // Safely reply to the user even if the command encountered an issue midway
    if (interaction.deferred) {
      return await interaction.followUp({ content: msg, ephemeral: true });
    } else if (!interaction.replied) {
      return await interaction.reply({ content: msg, ephemeral: true });
    }
  }
});

// --- 4. AUTHENTICATION & LOGIN ---
const botToken = process.env.DISCORD_BOT_TOKEN ? process.env.DISCORD_BOT_TOKEN.trim() : null;

if (!botToken) {
  console.error('❌ FATAL: DISCORD_BOT_TOKEN is missing or undefined in your environment variables!');
} else {
  console.log('🔑 Attempting to authenticate with Discord Gateway...');
  client.login(botToken).catch((error) => {
    console.error('❌ FATAL LOGIN ERROR:', error);
  });
}