const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
const apiHash = process.env.TELEGRAM_API_HASH || '';

if (!apiId || !apiHash) {
  console.error("❌ Error: TELEGRAM_API_ID or TELEGRAM_API_HASH is missing from your .env file.");
  console.error("Please go to https://my.telegram.org to get them and add them to your .env file.");
  process.exit(1);
}

const stringSession = new StringSession(''); // Empty string means new session

(async () => {
  console.log("Loading interactive Telegram Setup...");
  console.log("This will generate a secure session string so the agent can listen to signals in the background.");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text('Please enter your number (e.g., +1234567890): '),
    password: async () => await input.text('Please enter your 2FA password (leave blank if none): '),
    phoneCode: async () => await input.text('Please enter the code you received on Telegram: '),
    onError: (err) => console.log(err),
  });

  console.log('✅ Successfully connected to Telegram!');
  const sessionString = client.session.save();
  
  console.log('\n======================================================');
  console.log('YOUR TELEGRAM SESSION STRING (Keep this secret!):');
  console.log(sessionString);
  console.log('======================================================\n');
  
  // Try to append it to .env
  const envPath = path.resolve(__dirname, '../../.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  if (envContent.includes('TELEGRAM_SESSION=')) {
    console.log("⚠️ TELEGRAM_SESSION already exists in .env. Please replace it manually with the string above.");
  } else {
    fs.appendFileSync(envPath, `\n# Telegram GramJS Session\nTELEGRAM_SESSION=${sessionString}\n`);
    console.log("✅ Successfully saved TELEGRAM_SESSION to your .env file.");
  }

  await client.sendMessage('me', { message: 'AiTradingAgent Telegram Listener successfully configured!' });
  console.log('Test message sent to your Saved Messages.');
  
  process.exit(0);
})();
