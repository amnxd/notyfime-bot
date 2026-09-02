import { Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import cron from 'node-cron';
import express from 'express';
import 'dotenv/config';

import { connectDB } from './database/connect.js';
import { GuildConfig } from './database/GuildConfig.js';
import { UserReminder } from './database/UserReminder.js'; // The new DB Model
import { fetchUpcomingContests } from './services/clistService.js';
import { createContestEmbed } from './utils/embedBuilder.js';

// --- 0. ENVIRONMENT SANITY CHECK ---
console.log('--- Environment Check ---');
console.log(`DISCORD_BOT_TOKEN: ${process.env.DISCORD_BOT_TOKEN ? 'Loaded' : '❌ MISSING'}`);
console.log(`MONGO_URI: ${process.env.MONGO_URI ? 'Loaded' : '❌ MISSING'}`);
console.log(`CLIST_USERNAME: ${process.env.CLIST_USERNAME ? 'Loaded' : '❌ MISSING'}`);
console.log(`CLIST_API_KEY: ${process.env.CLIST_API_KEY ? 'Loaded' : '❌ MISSING'}`);
console.log('-------------------------');

const app = express();
app.get('/', (req, res) => res.send('Notyfime is awake!'));
app.listen(process.env.PORT || 3000, () => console.log(`🌐 Ping server running`));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.on('error', (err) => console.error('🚨 Client Error:', err));

async function runContestNotificationJob() {
  try {
    // === PART 1: POST NEW CONTESTS TO SERVER CHANNELS ===
    const configs = await GuildConfig.find({ notificationChannelId: { $ne: null } });
    for (const config of configs) {
      if (!config.subscribedPlatforms || config.subscribedPlatforms.length === 0) continue;

      const channel = await client.channels.fetch(config.notificationChannelId).catch(() => null);
      if (!channel) continue;

      const contests = await fetchUpcomingContests(config.subscribedPlatforms, 336);
      let configChanged = false;

      for (const contest of contests) {
        // If it's a brand new contest, post it to the channel with a button
        if (!config.announcedContests.includes(contest.id.toString())) {
          const embed = createContestEmbed(contest);
          
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`remind_${contest.id}`)
              .setLabel('1')
              .setEmoji('✅')
              .setStyle(ButtonStyle.Success)
          );

          await channel.send({ embeds: [embed], components: [row] });
          config.announcedContests.push(contest.id.toString());
          configChanged = true;
        }
      }
      if (configChanged) await config.save();
    }

    // === PART 2: SEND DIRECT MESSAGES TO OPT-IN USERS ===
    const reminders = await UserReminder.find({ startTime: { $gt: new Date() } });
    for (const rem of reminders) {
      const timeUntil = rem.startTime.getTime() - Date.now();
      if (timeUntil <= 0) continue;

      let targetField = null;
      let reminderLabel = '';

      // Check milestones
      if (timeUntil <= 30 * 60 * 1000 && !rem.notified30m) {
        targetField = 'notified30m'; reminderLabel = '30 MINS LEFT';
      } else if (timeUntil > 30 * 60 * 1000 && timeUntil <= 3 * 60 * 60 * 1000 && !rem.notified3h) {
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
            await user.send(`🔔 **${reminderLabel}**: \`${rem.platform}\` || **${rem.contestName}** is starting soon!`);
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
  cron.schedule('*/15 * * * *', runContestNotificationJob);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // === BUTTON CLICK HANDLER (DM CONFIRMATION) ===
  if (interaction.isButton() && interaction.customId.startsWith('remind_')) {
    const contestId = interaction.customId.split('_')[1];
    const embed = interaction.message.embeds[0];
    
    // We seamlessly scrape the event data directly off the embed they clicked
    const contestName = embed?.title || 'Unknown Contest';
    const platform = embed?.fields?.find(f => f.name === 'Platform')?.value.replace(/`/g, '') || 'Unknown';
    const startsAtField = embed?.fields?.find(f => f.name === 'Starts At')?.value || '';
    
    // Reverse engineer Discord's <t:12345:R> to get the exact database date[cite: 1]
    const unixMatch = startsAtField.match(/<t:(\d+):R>/);
    const startTime = unixMatch ? new Date(parseInt(unixMatch[1]) * 1000) : new Date(Date.now() + 86400000); 

    try {
      await UserReminder.updateOne(
        { userId: interaction.user.id, contestId: contestId },
        { 
          $set: { contestName, platform, startTime },
          $setOnInsert: { notified3d: false, notified1d: false, notified3h: false, notified30m: false }
        },
        { upsert: true }
      );

      await interaction.user.send(`Final Call Alarm Set. You are alloted **Final Call (All) - ${platform} || ${contestName}** which will be pinged 30 mins before the contest!`);
      return await interaction.reply({ content: '✅ Reminder set! I have sent you a DM.', ephemeral: true });
    } catch (error) {
      return await interaction.reply({ content: '❌ Could not set reminder. Please make sure your DMs are open!', ephemeral: true });
    }
  }

  // === STANDARD SLASH COMMANDS ===
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
      // Send individual messages for upcoming so we can attach the button to all of them
      for (const contest of contests.slice(0, 4)) {
        const embed = createContestEmbed(contest);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`remind_${contest.id}`).setEmoji('✅').setStyle(ButtonStyle.Success)
        );
        await interaction.followUp({ embeds: [embed], components: [row] });
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