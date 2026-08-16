const User = require('../models/User');

/**
 * नए यूज़र को रेफ़रल लिंक से जोड़ना और पॉइंट्स देना
 * @param {String} newUserId - नए यूज़र की टेलीग्राम ID
 * @param {String} referrerId - इनवाइट करने वाले यूज़र की ID
 */
async function processReferral(newUserId, referrerId) {
  try {
    if (String(newUserId) === String(referrerId)) return false; // खुद को रेफ़र नहीं कर सकता

    const existingUser = await User.findOne({ telegramId: newUserId });
    if (existingUser && existingUser.createdAt) {
      return false; // पुराना यूज़र मान्य नहीं है
    }

    // इनवाइट करने वाले यूज़र को +1 पॉइंट देना
    const referrer = await User.findOneAndUpdate(
      { telegramId: referrerId },
      { $inc: { referralPoints: 1 } },
      { new: true, upsert: true }
    );

    // 5 रेफ़रल पूरे होने पर ऑटोमैटिक 7 दिन का VIP देना
    if (referrer.referralPoints >= 5 && !referrer.isVip) {
      const vipExpiry = new Date();
      vipExpiry.setDate(vipExpiry.getDate() + 7);
      
      referrer.isVip = true;
      referrer.vipExpiresAt = vipExpiry;
      await referrer.save();
    }

    return true;
  } catch (error) {
    console.error('[Referral Error]:', error.message);
    return false;
  }
}

/**
 * यूज़र को मैन्युअल VIP बनाना (एडमिन पैनल से)
 * @param {String} userId - टेलीग्राम यूज़र ID
 * @param {Number} days - VIP के दिन
 */
async function setVipUser(userId, days = 30) {
  try {
    const vipExpiry = new Date();
    vipExpiry.setDate(vipExpiry.getDate() + days);

    const user = await User.findOneAndUpdate(
      { telegramId: userId },
      { 
        isVip: true, 
        vipExpiresAt: vipExpiry 
      },
      { upsert: true, new: true }
    );

    return { success: true, expiryDate: vipExpiry.toLocaleDateString() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * चेक करना कि VIP एक्टिव है या एक्सपायर हो गया
 */
async function checkVipStatus(userId) {
  try {
    const user = await User.findOne({ telegramId: userId });
    if (!user || !user.isVip) return false;

    if (user.vipExpiresAt && new Date() > new Date(user.vipExpiresAt)) {
      user.isVip = false;
      user.vipExpiresAt = null;
      await user.save();
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

module.exports = { processReferral, setVipUser, checkVipStatus };
