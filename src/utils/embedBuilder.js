import { EmbedBuilder } from 'discord.js';

export function createContestEmbed(contest, isReminder = false, reminderText = '') {
  const date = new Date(contest.start);
  const startUnix = Math.floor(date.getTime() / 1000);
  const durationHours = (contest.duration / 3600).toFixed(1);

  const titlePrefix = isReminder ? `Reminder (${reminderText}): ` : '';

  const istTime = date.toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata', weekday: 'long', month: 'long',
    day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  }) + ' IST';
  const utcTime = date.toLocaleTimeString('en-US', { 
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit' 
  }) + ' UTC';
  const estTime = date.toLocaleTimeString('en-US', { 
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' 
  }) + ' EST';

  const fullTimeString = `${istTime} / ${utcTime} / ${estTime}`;

  return new EmbedBuilder()
    .setTitle(`${titlePrefix}${contest.event}`)
    .setURL(contest.href)
    .setColor(isReminder ? 0xFEE75C : 0x2B2D31)
    .addFields(
      { name: 'Platform', value: `\`${contest.host}\``, inline: true },
      { name: 'Duration', value: `${durationHours} hrs`, inline: true },
      { name: 'Starts At', value: `${fullTimeString}\n( <t:${startUnix}:R> )`, inline: false }
    )
    // Removed the .setImage() transparent pixel hack to restore natural widths
    .setFooter({ text: 'wanna contribute? contact @amnxd' })
    .setTimestamp();
}