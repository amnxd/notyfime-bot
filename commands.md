`npx pm2 logs notyfime` : Shows the live console output (great for debugging or checking if the cron job ran).

```npx pm2 restart notyfime``` : Restarts the bot (do this anytime you change the code in bot.js).

```npx pm2 stop notyfime```	: Takes the bot offline without deleting it from PM2.

```npx pm2 flush notyfime``` :	Clears all the old saved log files to free up space.