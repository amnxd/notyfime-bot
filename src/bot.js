import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import cron from 'node-cron';
import express from 'express';
import 'dotenv/config';

import { connectDB } from './database/connect.js';
import { GuildConfig } from './database/GuildConfig.js';
import { UserReminder } from './database/UserReminder.js';
import { fetchUpcomingContests } from './services/clistService.js';
import { createContestEmbed } from './utils/embedBuilder.js';

// --- SET YOUR CUSTOM EMOJI HERE ---
// Paste the numeric ID of your :heartmc: emoji here
const CUSTOM_EMOJI_ID = 'YOUR_EMOJI_ID_HERE'; 

console.log('--- Environment Check ---');
console.log(`DISCORD_BOT_TOKEN: ${process.env.DISCORD_BOT_TOKEN ? 'Loaded' : '❌ MISSING'}`);
console.log(`MONGO_URI: ${process.env.MONGO_URI ? 'Loaded' : '❌ MISSING'}`);
console.log(`CLIST_USERNAME: ${process.env.CLIST_USERNAME ? 'Loaded' : '❌ MISSING'}`);
console.log(`CLIST_API_KEY: ${process.env.CLIST_API_KEY ? 'Loaded' : '❌ MISSING'}`);
console.log('-------------------------');

const app = express();
app.get('/', (req, res) => res.send('Notyfime is awake!'));
app.listen(process.env.PORT || 3000, () => console.log(`🌐 Ping server running`));

// Added Reaction Intents and Partials so the bot can see reactions on older messages
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
    const configs = await GuildConfig.find({ notificationChannelId: { $ne: null } });
    for (const config of configs) {
      if (!config.subscribedPlatforms || config.subscribedPlatforms.length === 0) continue;

      const channel = await client.channels.fetch(config.notificationChannelId).catch(() => null);
      if (!channel) continue;

      const contests = await fetchUpcomingContests(config.subscribedPlatforms, 336);
      let configChanged = false;

      for (const contest of contests) {
        if (!config.announcedContests.includes(contest.id.toString())) {
          const embed = createContestEmbed(contest);
          
          // Send message and instantly react with the custom emoji
          const sentMessage = await channel.send({ embeds: [embed] });
          await sentMessage.react(CUSTOM_EMOJI_ID).catch(() => sentMessage.react('✅')); 
          
          config.announcedContests.push(contest.id.toString());
          configChanged = true;
        }
      }
      if (configChanged) await config.save();
    }

    const reminders = await UserReminder.find({ startTime: { $gt: new Date() } });
    for (const rem of reminders) {
      const timeUntil = rem.startTime.getTime() - Date.now();
      if (timeUntil <= 0) continue;

      let targetField = null;
      let reminderLabel = '';

      if (timeUntil <= 15 * 60 * 1000 && !rem.notified15m) {
        targetField = 'notified15m'; reminderLabel = '15 MINS LEFT';
      } else if (timeUntil > 15 * 60 * 1000 && timeUntil <= 3 * 60 * 60 * 1000 && !rem.notified3h) {
        targetField = 'notified3h'; reminderLabel = '3 HOURS LEFT';
      } else if (timeUntil > 3 * 60 * 60 * 1000 && timeUntil <= 24 * 60 * 60 * 1000 && !rem.notified1d) {
        targetField = 'notified1d'; reminderLabel = '1 DAY LEFT';
      } else if (timeUntil > 24 * 60 * 60 * 1000 && timeUntil <= 3 * 24 * 60 * 60 * 1000 && !rem.notified3d) {
        targetField = 'notified3d'; reminderLabel = '3 DAYS LEFT';
      }

      if (targetField) {
        try {
          const user = await client.users.fetch(rem.userId);
          if (user) {
            // Ultra-minimal push notification layout
            const pushMessage = `**[ alert ]**\n\n**${rem.contestName}**\n\`${rem.platform}\`\n\n*${reminderLabel.toLowerCase()}*`;
            await user.send(pushMessage);
            
            rem[targetField] = true;
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

// === REACTION LISTENER (DM CONFIRMATION) ===
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return; // Ignore the bot's own reactions

  // Fetch older messages if they aren't currently cached
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Something went wrong when fetching the message:', error);
      return;
    }
  }

  // Ensure this is a reaction on our bot's embed
  if (reaction.message.author.id !== client.user.id) return;
  const embed = reaction.message.embeds[0];
  if (!embed) return;

  // Verify the user clicked the specific tracking emoji
  if (reaction.emoji.id !== CUSTOM_EMOJI_ID && reaction.emoji.name !== '✅') return;

  const contestName = embed.title || 'Unknown Contest';
  const platform = embed.fields?.find(f => f.name === 'Platform')?.value.replace(/`/g, '') || 'Unknown';
  const startsAtField = embed.fields?.find(f => f.name === 'Starts At')?.value || '';
  
  const unixMatch = startsAtField.match(/<t:(\d+):R>/);
  const startTime = unixMatch ? new Date(parseInt(unixMatch[1]) * 1000) : new Date(Date.now() + 86400000); 

  try {
    await UserReminder.updateOne(
      // We use the unique URL as the contest ID since we removed the buttons
      { userId: user.id, contestId: embed.url },
      { 
        $set: { contestName, platform, startTime },
        $setOnInsert: { notified3d: false, notified1d: false, notified3h: false, notified15m: false }
      },
      { upsert: true }
    );

    // Ultra-minimal confirmation layout
    const dmMessage = `**[ tracker enabled ]**\n\n**${contestName}**\n\`${platform}\`\n\n*ping scheduled 15m prior to start.*`;
    await user.send(dmMessage);
    
  } catch (error) {
    console.error('Could not set reminder or DM user. Ensure DMs are open.');
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
        // fetchReply allows us to grab the message object immediately so we can react to it
        const sentMessage = await interaction.followUp({ embeds: [embed], fetchReply: true });
        await sentMessage.react(CUSTOM_EMOJI_ID).catch(() => sentMessage.react('✅'));
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

// Securely pull the token from your configuration setup
const botToken = process.env.DISCORD_BOT_TOKEN ? process.env.DISCORD_BOT_TOKEN.trim() : null;
client.login(botToken).catch((error) => console.error('❌ FATAL LOGIN ERROR:', error));