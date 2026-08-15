const Settings = require('../models/Settings');

/**
 * टाइमर के साथ फ़ाइल भेजना और ऑटो-डिलीट करना
 */
async function sendFileWithAutoDelete(bot, chatId, fileId, caption = '') {
  try {
    const settings = await Settings.findOne() || {};
    const deleteMins = settings.autoDeleteMinutes || 15;

    const sentMessage = await bot.sendDocument(chatId, fileId, {
      caption: caption ? `${caption}\n\n⚠️ <i>This file will self-destruct in ${deleteMins} mins!</i>` : undefined,
      parse_mode: 'HTML'
    });

    if (deleteMins > 0) {
      setTimeout(async () => {
        try {
          await bot.deleteMessage(chatId, sentMessage.message_id);
        } catch (e) {
          // अगर पहले से डिलीट हो चुका हो तो इग्नोर करें
        }
      }, deleteMins * 60 * 1000);
    }
  } catch (err) {
    console.error('[AutoDelete Error]:', err.message);
  }
}

module.exports = { sendFileWithAutoDelete };
