const Media = require('../models/Media');

/**
 * चेक करना कि मीडिया मेन चैनल पर जाने लायक है या नहीं
 */
function isEligibleForBroadcast(mediaData, settings) {
  if (!settings || settings.autoBroadcast === false) return false;

  const currentYear = new Date().getFullYear();
  const mediaYear = parseInt(mediaData.year) || 0;
  const rating = parseFloat(mediaData.rating) || 0;
  const mode = settings.broadcastMode || 'smart'; // smart, latest, high_rated, all

  if (mode === 'all') return true;
  if (mode === 'latest') return (currentYear - mediaYear) <= 1; // सिर्फ इसी साल या पिछले साल की
  if (mode === 'high_rated') return rating >= 7.0; // सिर्फ 7+ रेटिंग वाली

  // 'smart' मोड: या तो बिल्कुल नई हो (2025/2026) या फिर रेटिंग 7.0 से ऊपर हो
  return ((currentYear - mediaYear) <= 1) || (rating >= 7.0);
}

/**
 * मेन चैनल पर ऑटो-पोस्ट भेजने का मुख्य फ़ंक्शन
 * @param {Object} bot - Telegraf Bot Instance
 * @param {Object} mediaData - TMDb और मीडिया की जानकारी
 * @param {Object} settings - Bot Settings Document
 */
async function broadcastNewMedia(bot, mediaData, settings) {
  try {
    if (!settings || !settings.mainChannel || !mediaData) return;

    // अगर पहले से पोस्ट हो चुकी है तो दोबारा न भेजें
    if (mediaData.isBroadcasted) {
      console.log(`[Broadcaster] Skipping "${mediaData.title}" - Already broadcasted.`);
      return;
    }

    // स्मार्ट फ़िल्टर चेक
    if (!isEligibleForBroadcast(mediaData, settings)) {
      console.log(`[Broadcaster] Skipping "${mediaData.title}" - Did not meet filter criteria.`);
      return;
    }

    const channelId = settings.mainChannel;
    const botUsername = (await bot.telegram.getMe()).username;
    const deepLink = `https://t.me/${botUsername}?start=media_${mediaData._id}`;

    const genresText = (mediaData.genres || []).slice(0, 3).join(', ');
    const ratingText = mediaData.rating ? `⭐ <b>Rating:</b> ${mediaData.rating}/10` : '';
    const yearText = mediaData.year ? `📅 <b>Year:</b> ${mediaData.year}` : '';

    const caption = `🎬 <b>${mediaData.title}</b>\n\n` +
      `${yearText ? yearText + '\n' : ''}` +
      `${ratingText ? ratingText + '\n' : ''}` +
      `🎭 <b>Genres:</b> ${genresText || 'Movies / Series'}\n\n` +
      `📝 <i>${(mediaData.overview || 'Available now on Movie Zone. Click below to get files.').slice(0, 180)}...</i>\n\n` +
      `⚡ <b>Uploaded & Ready to Watch!</b>`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '🎬 Get File / Watch Now', url: deepLink }
        ]
      ]
    };

    if (mediaData.poster && mediaData.poster.startsWith('http')) {
      await bot.telegram.sendPhoto(channelId, mediaData.poster, {
        caption: caption,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      });
    } else {
      await bot.telegram.sendMessage(channelId, caption, {
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      });
    }

    // डेटाबेस में मार्क करें कि यह पोस्ट हो चुकी है
    await Media.findByIdAndUpdate(mediaData._id, {
      isBroadcasted: true,
      broadcastedAt: new Date()
    });

    console.log(`[Broadcaster] Successfully posted "${mediaData.title}" to channel: ${channelId}`);
  } catch (error) {
    console.error('[Broadcaster Error]:', error.message);
  }
}

module.exports = { 
  broadcastNewMedia, 
  postToChannel: broadcastNewMedia, 
  isEligibleForBroadcast 
};

