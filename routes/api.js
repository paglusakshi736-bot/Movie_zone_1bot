const express = require('express');
const { Movie, User, Config } = require('../models');

module.exports = function createApiRoutes(bot) {
    const router = express.Router();

     router.get('/movies', async (req, res) => {
        try {
            const { search, category, year, page = 1, limit = 20 } = req.query;
            let query = {};

            // 🔍 सर्च फ़िल्टर
            if (search && search.trim() !== '') {
                query.title = { $regex: search.trim(), $options: 'i' };
            }

            // 📅 साल फ़िल्टर
            if (year && year !== 'All') {
                query.year = year;
            }

            // 🏷️ स्मार्ट कैटेगरी फ़िल्टर
            if (category && category !== 'All') {
                if (category === 'Latest') {
                    query.isBlocked = { $ne: true };
                } else if (category === 'Web Series') {
                    query.$or = [{ category: 'Web Series' }, { isSeries: true }];
                } else if (category === 'Hollywood') {
                    query.category = 'Hollywood';
                } else if (category === 'Hindi' || category === 'Bollywood') {
                    query.$or = [{ category: 'Hindi' }, { category: 'Bollywood' }];
                } else if (category === 'South') {
                    query.category = 'South';
                } else {
                    query.category = { $regex: `^${category}$`, $options: 'i' };
                }
            }

            let sortOption = { updatedAt: -1 };
            if (category === 'Latest') {
                sortOption = { _id: -1 };
            }

            const movies = await Movie.find(query)
                .sort(sortOption)
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

            // 1. डेटाबेस से टाइमर और बैकअप चैनल लिंक निकालें
            const timerConfig = await Config.findOne({ key: 'auto_delete_timer' });
            const deleteMinutes = (timerConfig && timerConfig.value) ? parseInt(timerConfig.value) : 10;

            const backupConfig = await Config.findOne({ key: 'backup_channel_link' });
            const backupLink = (backupConfig && backupConfig.value) ? backupConfig.value : 'https://t.me/telegram';

            // 2. फ़ाइल और मूवी का डेटा ढूँढें
            const movie = await Movie.findOne({ "files.fileId": fileId });
            let movieTitle = "Movie";
            let movieYear = "";
            let fileLabel = "HD";
            let fileType = "document";

            if (movie) {
                movieTitle = movie.title || "Movie";
                movieYear = movie.year ? ` (${movie.year})` : "";
                const matchedFile = movie.files.find(f => f.fileId === fileId);
                if (matchedFile) {
                    fileLabel = matchedFile.label || "HD";
                    fileType = matchedFile.fileType || "document";
                }
            }

            // 3. रिच HTML कैप्शन
            const caption = `🎬 <b>मूवी:</b> <a href="${backupLink}">${movieTitle}${movieYear}</a>\n` +
                            `📦 <b>क्वालिटी:</b> ${fileLabel}\n` +
                            `🤖 <b>बॉट:</b> @Movie_zone_1bot\n\n` +
                            `⚠️ <i>यह फ़ाइल ${deleteMinutes} मिनट में डिलीट हो जाएगी, इसे तुरंत Saved Messages में फॉरवर्ड कर लें।</i>`;

            // 4. फ़ाइल सेंड करें
            const sendMethod = fileType === 'video' ? 'sendVideo' : 'sendDocument';
            const sentMsg = await bot[sendMethod](userId, fileId, {
                caption: caption,
                parse_mode: 'HTML'
            });

            // 5. ऑटो-डिलीट टाइमर
            setTimeout(async () => {
                try {
                    await bot.deleteMessage(userId, sentMsg.message_id);
                } catch (err) {
                    console.error('[Auto-Delete Error]:', err.message);
                }
            }, deleteMinutes * 60 * 1000);

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

            const inviteLink = `https://t.me/Movie_zone_1bot?start=ref_${userId}`;

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
