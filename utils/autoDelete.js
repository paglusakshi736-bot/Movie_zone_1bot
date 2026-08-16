const Settings = require('../models/Settings');

/**
 * मैसेज को दिए गए मिनटों बाद ऑटो-डिलीट करना
 */
function scheduleAutoDelete(bot, chatId, messageId, minutes) {
  if (!minutes || minutes <= 0) return;
  
  setTimeout(async () => {
    try {
      await bot.telegram.deleteMessage(chatId, messageId);
      console.log(`[AutoDelete] Message ${messageId} deleted in chat ${chatId}`);
    } catch (e) {
      // अगर यूज़र ने पहले ही डिलीट कर दिया हो तो इग्नोर करें
    }
  }, minutes * 60 * 1000);
}

module.exports = { 
  scheduleAutoDelete, 
  sendFileWithAutoDelete: scheduleAutoDelete 
};
