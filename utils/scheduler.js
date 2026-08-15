const Media = require('../models/Media');
const Settings = require('../models/Settings');
const { broadcastNewMedia } = require('./broadcaster');

/**
 * ऑटो-शेड्यूलर जो दिन में बैकग्राउंड में चलेगा
 * @param {Object} bot - Telegraf Bot Instance
 */
async function runDailyScheduler(bot) {
  try {
    const settings = await Settings.findOne() || {};

    // अगर एडमिन ने ऑटो-ब्रॉडकास्ट बंद किया हुआ है
    if (settings.autoBroadcast === false) {
      console.log('[Scheduler] Auto-broadcast is disabled.');
      return;
    }

    const maxPostsPerDay = settings.maxDailyPosts || 8; // डिफ़ॉल्ट 8 पोस्ट प्रतिदिन

    // 1. चेक करें कि आज कितनी पोस्ट्स पहले ही हो चुकी हैं
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const postedTodayCount = await Media.countDocuments({
      isBroadcasted: true,
      broadcastedAt: { $gte: startOfDay }
    });

    if (postedTodayCount >= maxPostsPerDay) {
      console.log(`[Scheduler] Daily limit reached (${postedTodayCount}/${maxPostsPerDay}). Skipping.`);
      return;
    }

    // 2. Priority 1: अनपोस्टेड नई/लेटेस्ट मूवीज़ ढूंढें (2025/2026)
    const currentYear = new Date().getFullYear();
    let candidate = await Media.findOne({
      isBroadcasted: { $ne: true },
      year: { $gte: currentYear - 1 }
    }).sort({ createdAt: -1 });

    // 3. Priority 2: अगर नई खत्म हो गईं, तो डेटाबेस की बेस्ट अनपोस्टेड मूवी (High Rating)
    if (!candidate) {
      candidate = await Media.findOne({
        isBroadcasted: { $ne: true },
        rating: { $gte: 6.5 }
      }).sort({ rating: -1 });
    }

    // 4. Priority 3: अगर नॉर्मल अनपोस्टेड भी नहीं मिलीं, तो कोई भी बची हुई अनपोस्टेड
    if (!candidate) {
      candidate = await Media.findOne({
        isBroadcasted: { $ne: true }
      }).sort({ createdAt: -1 });
    }

    // 5. अगर अनपोस्टेड मूवी मिल गई, तो मेन चैनल पर पोस्ट करें
    if (candidate) {
      console.log(`[Scheduler] Broadcasting selected candidate: ${candidate.title}`);
      await broadcastNewMedia(bot, candidate, settings);
    } else {
      console.log('[Scheduler] All movies in database have already been broadcasted!');
    }

  } catch (error) {
    console.error('[Scheduler Error]:', error.message);
  }
}

/**
 * शेड्यूलर टाइमर शुरू करने का फ़ंक्शन (हर 2 घंटे में चेक करेगा)
 */
function startSchedulerTimer(bot) {
  // बॉट शुरू होने के 1 मिनट बाद पहला चेक
  setTimeout(() => runDailyScheduler(bot), 60 * 1000);

  // उसके बाद हर 2 घंटे में ऑटो-चेक (2 * 60 * 60 * 1000 ms)
  setInterval(() => runDailyScheduler(bot), 2 * 60 * 60 * 1000);
  
  console.log('[Scheduler] Smart Content Scheduler started successfully.');
}

module.exports = { runDailyScheduler, startSchedulerTimer };

