const axios = require('axios');
const Settings = require('../models/Settings');

/**
 * टेलीग्राम फ़ाइल से डायरेक्ट स्ट्रीमिंग या डाउनलोड लिंक निकालना
 * @param {String} botToken - टेलीग्राम बॉट टोकन
 * @param {String} fileId - टेलीग्राम मीडिया फ़ाइल ID
 */
async function getTelegramDirectUrl(botToken, fileId) {
  try {
    const res = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    if (res.data && res.data.ok) {
      const filePath = res.data.result.file_path;
      return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    }
    return null;
  } catch (error) {
    console.error('[Stream Engine Error]:', error.message);
    return null;
  }
}

/**
 * क्रोम फ़ास्ट डाउनलोड लिंक तैयार करना (Admin Toggle Check)
 */
async function generateChromeDownloadLink(botToken, fileId) {
  try {
    const settings = await Settings.findOne() || {};
    
    // अगर एडमिन ने फ़ास्ट डाउनलोड बंद किया हो
    if (settings.fastDownloadEnabled === false) {
      return null;
    }

    return await getTelegramDirectUrl(botToken, fileId);
  } catch (err) {
    console.error('[Fast DL Error]:', err.message);
    return null;
  }
}

module.exports = { getTelegramDirectUrl, generateChromeDownloadLink };
