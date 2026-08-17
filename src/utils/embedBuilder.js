import { EmbedBuilder } from 'discord.js';

export function createContestEmbed(contest, isReminder = false, reminderText = '') {
  const startUnix = Math.floor(new Date(contest.start).getTime() / 1000);
  const endUnix = Math.floor(new Date(contest.end).getTime() / 1000);
  const durationHours = (contest.duration / 3600).toFixed(1);

  const titlePrefix = isReminder ? `🔔 ${reminderText}: ` : '🏆 ';

  return new EmbedBuilder()
    .setTitle(`${titlePrefix}${contest.event}`)
    .setURL(contest.href)
    .setColor(isReminder ? 0xFEE75C : 0x5865F2)
    .addFields(
      { name: '🌐 Platform', value: `\`${contest.host}\``, inline: true },
      { name: '⏱️ Duration', value: `${durationHours} hrs`, inline: true },
      { name: '⏰ Starts At', value: `<t:${startUnix}:F>\n(<t:${startUnix}:R>)`, inline: false }
    )
    .setFooter({ text: 'Notyfime Tracker' })
    .setTimestamp();
}