import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import cron from 'node-cron';
import express from 'express';
import 'dotenv/config';

import { connectDB } from './database/connect.js';
import { GuildConfig } from './database/GuildConfig.js';
import { UserReminder } from './database/UserReminder.js';
import { fetchUpcomingContests } from './services/clistService.js';
import { createContestEmbed } from './utils/embedBuilder.js';

const CUSTOM_EMOJI_ID = '1544413375851929650'; 

// Time milestones
const FIFTEEN_MINS = 15 * 60 * 1000;
const TWO_HOURS = 2 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const THREE_DAYS = 3 * ONE_DAY;

console.log('--- Environment Check ---');
console.log(`DISCORD_BOT_TOKEN: ${process.env.DISCORD_BOT_TOKEN ? 'Loaded' : '❌ MISSING'}`);
console.log(`MONGO_URI: ${process.env.MONGO_URI ? 'Loaded' : '❌ MISSING'}`);
console.log(`CLIST_USERNAME: ${process.env.CLIST_USERNAME ? 'Loaded' : '❌ MISSING'}`);
console.log(`CLIST_API_KEY: ${process.env.CLIST_API_KEY ? 'Loaded' : '❌ MISSING'}`);
console.log('-------------------------');

const app = express();
app.get('/', (req, res) => res.send('Notyfime is awake!'));
app.listen(process.env.PORT || 3000, () => console.log(`🌐 Ping server running`));

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

client.on('error', (err) => console.error('🚨 Client Error:', err));

async function runContestNotificationJob() {
  try {
    // === PHASE 1: CHANNEL RECURRING ANNOUNCEMENTS (3d, 1d, 2h) ===
    const configs = await GuildConfig.find({ notificationChannelId: { $ne: null } });
    for (const config of configs) {
      if (!config.subscribedPlatforms || config.subscribedPlatforms.length === 0) continue;

      const channel = await client.channels.fetch(config.notificationChannelId).catch(() => null);
      if (!channel) continue;

      const contests = await fetchUpcomingContests(config.subscribedPlatforms, 336);
      let configChanged = false;

      for (const contest of contests) {
        const timeUntil = new Date(contest.start).getTime() - Date.now();
        if (timeUntil <= 0) continue; 

        let targetArray = null;
        let reminderLabel = '';

        if (timeUntil <= TWO_HOURS && !config.notified2h.includes(contest.id.toString())) {
          targetArray = 'notified2h'; reminderLabel = '2 HOURS LEFT';
        } else if (timeUntil > TWO_HOURS && timeUntil <= ONE_DAY && !config.notified1d.includes(contest.id.toString())) {
          targetArray = 'notified1d'; reminderLabel = '1 DAY LEFT';
        } else if (timeUntil > ONE_DAY && timeUntil <= THREE_DAYS && !config.notified3d.includes(contest.id.toString())) {
          targetArray = 'notified3d'; reminderLabel = '3 DAYS LEFT';
        }

        if (targetArray) {
          const embed = createContestEmbed(contest, true, reminderLabel);
          const sentMessage = await channel.send({ embeds: [embed] });
          await sentMessage.react(CUSTOM_EMOJI_ID).catch((err) => console.error('Emoji Error:', err.message)); 
          
          config[targetArray].push(contest.id.toString());
          configChanged = true;
        }
      }
      if (configChanged) await config.save();
    }

    // === PHASE 2: DIRECT MESSAGE PINGS (15 mins only) ===
    const reminders = await UserReminder.find({ startTime: { $gt: new Date() } });
    for (const rem of reminders) {
      const timeUntil = rem.startTime.getTime() - Date.now();
      if (timeUntil <= 0) continue;

      if (timeUntil <= FIFTEEN_MINS && !rem.notified15m) {
        try {
          const user = await client.users.fetch(rem.userId);
          if (user) {
            // Includes the physical @ping directly in the minimal DM
            const pushMessage = `<@${rem.userId}> **[ alert ]**\n\n**${rem.contestName}**\n\`${rem.platform}\`\n\n*starting in 15 mins.*`;
            await user.send(pushMessage);
            
            rem.notified15m = true;
            await rem.save();
          }
        } catch (err) {
          console.error(`Could not DM user ${rem.userId}`);
        }
      }
    }
  } catch (error) {
    console.error('Job Error:', error);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`🚀 Authenticated as ${c.user.tag}`);
  await connectDB();
  cron.schedule('*/5 * * * *', runContestNotificationJob);
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      return;
    }
  }

  if (reaction.message.author.id !== client.user.id) return;
  const embed = reaction.message.embeds[0];
  if (!embed) return;

  if (reaction.emoji.id !== CUSTOM_EMOJI_ID) return;

  const contestName = embed.title.replace(/Reminder \([A-Z0-9 ]+\): /g, '').trim() || 'Unknown Contest';
  const platform = embed.fields?.find(f => f.name === 'Platform')?.value.replace(/`/g, '') || 'Unknown';
  const startsAtField = embed.fields?.find(f => f.name === 'Starts At')?.value || '';
  
  const unixMatch = startsAtField.match(/<t:(\d+):R>/);
  const startTime = unixMatch ? new Date(parseInt(unixMatch[1]) * 1000) : new Date(Date.now() + 86400000); 

  try {
    await UserReminder.updateOne(
      { userId: user.id, contestId: embed.url },
      { 
        $set: { contestName, platform, startTime },
        $setOnInsert: { notified15m: false }
      },
      { upsert: true }
    );

    const dmMessage = `**[ tracker enabled ]**\n\n**${contestName}**\n\`${platform}\`\n\n*ping scheduled 15m prior to start.*`;
    await user.send(dmMessage);
    
  } catch (error) {
    console.error('Could not set reminder or DM user.');
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guildId, channelId } = interaction;

  let config = await GuildConfig.findOne({ guildId });
  if (!config) config = await GuildConfig.create({ guildId, notificationChannelId: channelId });

  try {
    if (commandName === 'set_channel') {
      config.notificationChannelId = channelId;
      await config.save();
      return await interaction.reply({ content: `✅ Notifications set to <#${channelId}>.`, ephemeral: true });
    }

    if (commandName === 'subscribe') {
      const platform = interaction.options.getString('platform');
      if (config.subscribedPlatforms.includes(platform)) {
        config.subscribedPlatforms = config.subscribedPlatforms.filter(p => p !== platform);
        await config.save();
        return await interaction.reply({ content: `❌ Removed **${platform}**.`, ephemeral: true });
      } else {
        config.subscribedPlatforms.push(platform);
        await config.save();
        return await interaction.reply({ content: `✅ Added **${platform}**.`, ephemeral: true });
      }
    }

    if (commandName === 'upcoming') {
      await interaction.deferReply();
      const p = interaction.options.getString('platform');
      const targets = p ? [p] : config.subscribedPlatforms;
      
      const contests = await fetchUpcomingContests(targets, 336);
      if (!contests || contests.length === 0) {
        return await interaction.editReply('ℹ️ No upcoming contests found.');
      }
      
      await interaction.deleteReply(); 
      for (const contest of contests.slice(0, 4)) {
        const embed = createContestEmbed(contest);
        const sentMessage = await interaction.followUp({ embeds: [embed], fetchReply: true });
        await sentMessage.react(CUSTOM_EMOJI_ID).catch((err) => console.error('Emoji Error:', err.message));
      }
      return;
    }

    return await interaction.reply({ content: `❌ Command not recognized.`, ephemeral: true });
  } catch (error) {
    console.error(`🚨 Error:`, error);
    const msg = '❌ An error occurred.';
    if (interaction.deferred) return await interaction.followUp({ content: msg, ephemeral: true });
    return await interaction.reply({ content: msg, ephemeral: true });
  }
});

const botToken = process.env.DISCORD_BOT_TOKEN ? process.env.DISCORD_BOT_TOKEN.trim() : null;
client.login(botToken).catch((error) => console.error('❌ FATAL LOGIN ERROR:', error));