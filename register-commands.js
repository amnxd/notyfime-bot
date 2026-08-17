import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import 'dotenv/config';
import { SUPPORTED_PLATFORMS } from './src/constants/platforms.js';

const platformChoices = Object.keys(SUPPORTED_PLATFORMS).map(key => ({
  name: `${key} (${SUPPORTED_PLATFORMS[key]})`,
  value: SUPPORTED_PLATFORMS[key]
}));

const commands = [
  new SlashCommandBuilder()
    .setName('set_channel')
    .setDescription('Set the current channel for automated contest notifications')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('Toggle notification subscription for a contest platform')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option.setName('platform')
        .setDescription('Select platform to subscribe/unsubscribe')
        .setRequired(true)
        .addChoices(...platformChoices.slice(0, 25))
    ),

  new SlashCommandBuilder()
    .setName('subscriptions')
    .setDescription('List all platforms currently subscribed to by this server'),

  new SlashCommandBuilder()
    .setName('upcoming')
    .setDescription('View upcoming contests across subscribed platforms')
    .addStringOption(option =>
      option.setName('platform')
        .setDescription('Optionally filter by a specific platform')
        .setRequired(false)
        .addChoices(...platformChoices.slice(0, 25))
    )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('Registering global application (/) commands...');
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log('Slash commands registered successfully.');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
})();