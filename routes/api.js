const express = require('express');
const axios = require('axios');
const { Movie, Config } = require('../models');

module.exports = function createApiRoutes(bot) {
    const router = express.Router();

    async function checkMemberStatus(chatIdentifier, userId) {
        if (!chatIdentifier) return true;
        try {
            const member = await bot.getChatMember(chatIdentifier, userId);
            return ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
        } catch (e) {
            return true;
        }
    }

    router.get('/movies', async (req, res) => {
        try {
            const movies = await Movie.find().sort({ updatedAt: -1 });
            res.json(movies);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.get('/thumb/:fileId', async (req, res) => {
        try {
            const fileLink = await bot.getFileLink(req.params.fileId);
            res.redirect(fileLink);
        } catch (err) { res.status(404).send('Not Found'); }
    });

    router.get('/stream/:fileId', async (req, res) => {
        try {
            const fileLink = await bot.getFileLink(req.params.fileId);
            res.redirect(fileLink);
        } catch (err) { res.status(404).send('Stream Link Not Found'); }
    });

      // Mini App से मूवी रिक्वेस्ट प्राप्त करने के लिए (सभी एडमिन्स को)
  router.post('/request-movie', async (req, res) => {
    try {
      const { movieName, user } = req.body;
      const adminIds = process.env.ADMIN_ID ? process.env.ADMIN_ID.split(',').map(id => id.trim()) : [];

      if (!movieName) {
        return res.status(400).json({ success: false, message: 'Movie name is required' });
      }

      if (adminIds.length > 0) {
        const requestText = `📩 <b>Mini App से नई रिक्वेस्ट!</b>\n\n🎬 <b>मूवी:</b> ${movieName}\n👤 <b>यूज़र:</b> ${user?.first_name || 'User'} (@${user?.username || 'N/A'})\n🆔 <b>ID:</b> <code>${user?.id || 'N/A'}</code>`;

        for (const id of adminIds) {
          await bot.sendMessage(id, requestText, { parse_mode: 'HTML' }).catch(() => {});
        }

        return res.json({ success: true });
      }
      res.status(500).json({ success: false, message: 'Admin ID not configured' });
    } catch (e) {
      console.error('[Request Movie Error]:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

    

    router.post('/send-file', async (req, res) => {
        const { fileId, fileType, movieTitle, label, chatId } = req.body;
        try {
            const forceSubCfg = await Config.findOne({ key: 'forcesub_enabled' });
            if (forceSubCfg && forceSubCfg.value === true) {
                const channelCfg = await Config.findOne({ key: 'forcesub_channel' });
                const groupCfg = await Config.findOne({ key: 'forcesub_group' });

                const channelJoined = channelCfg ? await checkMemberStatus(channelCfg.value, chatId) : true;
                const groupJoined = groupCfg ? await checkMemberStatus(groupCfg.value, chatId) : true;

                if (!channelJoined || !groupJoined) {
                    return res.status(403).json({
                        success: false,
                        forceSubRequired: true,
                        channel: channelJoined ? null : channelCfg?.value,
                        group: groupJoined ? null : groupCfg?.value
                    });
                }
            }

            // व्यूज काउंट अपडेट
            await Movie.updateOne({ "files.fileId": fileId }, { $inc: { viewsCount: 1 } });

            const shortConfig = await Config.findOne({ key: 'shortener_enabled' });
            if (shortConfig && shortConfig.value === true) {
                const domainCfg = await Config.findOne({ key: 'shortener_domain' });
                const apiCfg = await Config.findOne({ key: 'shortener_api' });

                if (domainCfg && apiCfg) {
                    const me = await bot.getMe();
                    const targetUrl = `https://t.me/${me.username}?start=file_${fileId}`;
                    const apiRes = await axios.get(`https://${domainCfg.value}/api?api=${apiCfg.value}&url=${encodeURIComponent(targetUrl)}`);
                    if (apiRes.data && apiRes.data.shortenedUrl) {
                        await bot.sendMessage(chatId, `🔐 <b>आपकी डाउनलोड लिंक तैयार है:</b>\n\n👉 <a href="${apiRes.data.shortenedUrl}">यहाँ क्लिक करके अनलॉक करें</a>`, { parse_mode: 'HTML' });
                        return res.json({ success: true, short: true });
                    }
                }
            }

            const captionText = `🎬 <b>${movieTitle}</b>\n📌 <b>क्वालिटी:</b> ${label}\n\n⚠️ <b>नोट:</b> यह फ़ाइल <b>10 मिनट</b> में डिलीट हो जाएगी। इसे तुरंत <i>Saved Messages</i> में फॉरवर्ड कर लें!`;

            let sentMsg = fileType === 'video' 
                ? await bot.sendVideo(chatId, fileId, { caption: captionText, parse_mode: 'HTML' })
                : await bot.sendDocument(chatId, fileId, { caption: captionText, parse_mode: 'HTML' });

            res.json({ success: true });
            setTimeout(() => bot.deleteMessage(chatId, sentMsg.message_id).catch(() => {}), 10 * 60 * 1000);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    return router;
};
