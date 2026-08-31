const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { ingestTelegramMessage } = require('./telegramNotifier');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
const apiHash = process.env.TELEGRAM_API_HASH || '';
const sessionString = process.env.TELEGRAM_SESSION || '';

if (!apiId || !apiHash || !sessionString) {
  logger.warn('⚠️ Telegram Listener disabled: TELEGRAM_API_ID, TELEGRAM_API_HASH, or TELEGRAM_SESSION missing from .env');
  logger.info('To enable, run: node src/notifications/setupTelegram.js');
  process.exit(0);
}

const stringSession = new StringSession(sessionString);
const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

async function startTelegramListener() {
  try {
    logger.info('Connecting to Telegram MTProto as user client...');
    await client.connect();
    
    // Test if session is still valid
    const me = await client.getMe();
    logger.info(`✅ Telegram Listener connected successfully as ${me.username || me.firstName}`);
    
    // Listen for new messages
    client.addEventHandler(async (event) => {
      try {
        const message = event.message;
        const chat = await message.getChat();
        
        // Ensure chat has a title (channels/groups)
        const chatTitle = chat.title || '';
        const text = message.message || '';
        
        if (!text) return;
        
        // Check if message is from the target channel (case insensitive)
        const normTitle = chatTitle.toLowerCase();
        if (normTitle.includes('intelligent') && normTitle.includes('signal')) {
            logger.info(`🚨 [TELEGRAM SIGNAL] Received new message from ${chatTitle}`);
            
            // Send to system ingestion pipeline
            ingestTelegramMessage(text, chatTitle);
        }
      } catch (err) {
        logger.error(`Error processing Telegram event: ${err.message}`);
      }
    }, new NewMessage({}));
    
  } catch (err) {
    logger.error(`❌ Telegram Listener failed to connect: ${err.message}`);
    logger.info('Your session string may be expired. Run setupTelegram.js again.');
  }
}

// Start the listener if called directly
if (require.main === module) {
    startTelegramListener();
}

module.exports = { startTelegramListener };
