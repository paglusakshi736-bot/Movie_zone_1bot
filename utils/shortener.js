const axios = require('axios');
const crypto = require('crypto');
const Settings = require('../models/Settings');
const User = require('../models/User');

/**
 * शॉर्टनर लिंक जनरेट करना
 * @param {String} userId - टेलीग्राम यूज़र ID
 * @param {String} botUsername - बॉट का यूज़रनेम
 */
async function generateShortLink(userId, botUsername) {
  try {
    const settings = await Settings.findOne() || {};

    // 1. अगर शॉर्टनर बंद है या API नहीं डाली गई है, तो बाईपास करें
    if (settings.shortenerEnabled === false || !settings.shortenerApi || !settings.shortenerDomain) {
      return null;
    }

    // 2. यूज़र के लिए यूनीक बाईपास टोकन बनाना
    const token = crypto.randomBytes(8).toString('hex');
    
    // टोकन को डेटाबेस में 24 घंटे की एक्सपायरी के साथ सेव करना
    await User.findOneAndUpdate(
      { telegramId: userId },
      { 
        verifyToken: token,
        tokenCreatedAt: new Date()
      },
      { upsert: true }
    );

    // बॉट का वेरिफिकेशन डीप-लिंक
    const destinationUrl = `https://t.me/${botUsername}?start=verify_${token}`;

    // 3. शॉर्टनर API को कॉल करना
    const apiUrl = `https://${settings.shortenerDomain}/api?api=${settings.shortenerApi}&url=${encodeURIComponent(destinationUrl)}`;
    const response = await axios.get(apiUrl);

    if (response.data && response.data.shortenedUrl) {
      return response.data.shortenedUrl;
    } else if (response.data && response.data.url) {
      return response.data.url;
    }

    return null;
  } catch (error) {
    console.error('[Shortener API Error]:', error.message);
    return null; // एरर आने पर यूज़र अटके नहीं, डायरेक्ट लिंक मिल जाए
  }
}

/**
 * चेक करना कि क्या यूज़र का वेरिफिकेशन अभी भी वैलिड है (24 घंटे तक)
 * @param {String} userId - टेलीग्राम यूज़र ID
 */
async function isUserVerified(userId) {
  try {
    const user = await User.findOne({ telegramId: userId });
    if (!user) return false;

    // अगर यूज़र VIP है तो हमेशा वेरिफ़ाई माने
    if (user.isVip) return true;

    // अगर फ्री यूज़र ने पिछले 24 घंटे के अंदर शॉर्टनर पार किया है
    if (user.lastVerifiedAt) {
      const hoursSinceVerify = (new Date() - new Date(user.lastVerifiedAt)) / (1000 * 60 * 60);
      if (hoursSinceVerify < 24) {
        return true;
      }
    }

    return false;
  } catch (error) {
    return false;
  }
}

module.exports = { 
  generateShortLink, 
  isUserVerified,
  createShortLink: async (url) => {
    return url;
  }
};

