const express = require('express');
const { Movie, User } = require('../models');

module.exports = function createApiRoutes(bot) {
    const router = express.Router();

    router.get('/movies', async (req, res) => {
        try {
            const { search, category, page = 1, limit = 20 } = req.query;
            let query = {};

            if (search) {
                query.title = { $regex: search, $options: 'i' };
            }
            if (category && category !== 'All') {
                query.category = category;
            }

            const movies = await Movie.find(query)
                .sort({ updatedAt: -1 })
                .skip((page - 1) * limit)
                .limit(parseInt(limit));

            const total = await Movie.countDocuments(query);

            res.json({
                movies,
                totalPages: Math.ceil(total / limit),
                currentPage: parseInt(page)
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/bot-info', async (req, res) => {
        try {
            const botInfo = await bot.getMe();
            res.json({ username: botInfo.username });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ⚡ डायरेक्ट फ़ाइल डिलीवरी API
    router.post('/send-file', async (req, res) => {
        try {
            const { userId, fileId } = req.body;
            if (!userId || !fileId) {
                return res.status(400).json({ success: false, message: "Missing userId or fileId" });
            }

            await bot.sendDocument(userId, fileId, {
                caption: "🎬 <b>आपकी फ़ाइल तैयार है!</b>\n\n⚠️ <i>कृपया इसे तुरंत Saved Messages में फॉरवर्ड कर लें।</i>",
                parse_mode: 'HTML'
            });

            res.json({ success: true, message: "फ़ाइल आपके बॉट चैट में भेज दी गई है!" });
        } catch (err) {
            console.error('Send File API Error:', err.message);
            res.status(500).json({ success: false, message: "फ़ाइल भेजने में समस्या आई: " + err.message });
        }
    });

    router.post('/request', async (req, res) => {
        try {
            const { userId, movieName, username, firstName } = req.body;
            if (!userId || !movieName) {
                return res.status(400).json({ success: false, message: "मूवी का नाम और यूज़र आईडी ज़रूरी है!" });
            }

            const today = new Date().toISOString().split('T')[0];
            let user = await User.findOne({ userId: userId.toString() });

            if (!user) {
                user = new User({
                    userId: userId.toString(),
                    username: username || '',
                    firstName: firstName || ''
                });
                await user.save();
            }

            const botInfo = await bot.getMe();
            const inviteLink = `https://t.me/${botInfo.username}?start=ref_${userId}`;

            const hasUsedDailyFree = (user.lastRequestDate === today);

            if (hasUsedDailyFree) {
                if (!user.availableCredits || user.availableCredits < 1) {
                    return res.status(403).json({
                        success: false,
                        limitReached: true,
                        inviteLink: inviteLink,
                        message: "आपकी आज की 1 फ़्री रिक्वेस्ट पूरी हो चुकी है!\nऔर रिक्वेस्ट करने के लिए अपने दोस्तों को इनवाइट करें।"
                    });
                } else {
                    user.availableCredits -= 1;
                }
            } else {
                user.lastRequestDate = today;
            }

            await user.save();

            const adminIds = process.env.ADMIN_ID ? process.env.ADMIN_ID.split(',').map(id => id.trim()) : [];
            const requestText = `📩 <b>नई मूवी रिक्वेस्ट (Mini App)!</b>\n\n🎬 <b>मूवी:</b> ${movieName}\n👤 <b>यूज़र:</b> ${firstName || 'User'} (@${username || 'N/A'})\n🆔 <b>ID:</b> <code>${userId}</code>`;

            for (const id of adminIds) {
                await bot.sendMessage(id, requestText, { parse_mode: 'HTML' }).catch(() => {});
            }

            res.json({
                success: true,
                usedCredit: hasUsedDailyFree,
                remainingCredits: user.availableCredits,
                message: hasUsedDailyFree 
                    ? `✅ रिक्वेस्ट भेज दी गई! (1 रेफरल क्रेडिट इस्तेमाल हुआ। बाकी: ${user.availableCredits})` 
                    : "✅ रिक्वेस्ट भेज दी गई! (आज की दैनिक फ़्री रिक्वेस्ट इस्तेमाल हुई)"
            });

        } catch (err) {
            res.status(500).json({ success: false, message: "सर्वर एरर: " + err.message });
        }
    });

    return router;
};
