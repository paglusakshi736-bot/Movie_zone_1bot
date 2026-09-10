const express = require('express');
const { Movie, User, Config } = require('../models');

module.exports = function createApiRoutes(bot) {
    const router = express.Router();

    router.get('/movies', async (req, res) => {
        try {
            const { search, category, year, page = 1, limit = 20, userId } = req.query;[span_114](start_span)[span_114](end_span)
            const adminList = (process.env.ADMIN_ID || '').split(',').map(id => id.trim());[span_115](start_span)[span_115](end_span)
            const isAdmin = userId ? adminList.includes(userId.toString()) : false;[span_116](start_span)[span_116](end_span)

            let query = {};[span_117](start_span)[span_117](end_span)

            // 🔍 सर्च फ़िल्टर
            if (search && search.trim() !== '') {
                query.title = { $regex: search.trim(), $options: 'i' };[span_118](start_span)[span_118](end_span)
            }

            // 📅 साल फ़िल्टर
            if (year && year !== 'All') {
                query.year = year;[span_119](start_span)[span_119](end_span)
            }

            // 🏷️ स्मार्ट कैटेगरी और टैब फ़िल्टर
            if (category === 'Others') {
                if (!isAdmin) {
                    return res.json({ movies: [], totalPages: 0, currentPage: 1, isAdmin: false });[span_120](start_span)[span_120](end_span)
                }
                query.$or = [
                    { category: 'Others' },
                    { title: { $regex: /^Unknown_/i } },
                    { poster: null },
                    { poster: '' }
                ];[span_121](start_span)[span_121](end_span)
            } else if (category === 'needs_fix' || category === 'Fix Names') {
                query.$and = [
                    { category: { $ne: 'Others' } },
                    { title: { $not: { $regex: /^Unknown_/i } } },
                    { poster: { $ne: null } },
                    { poster: { $ne: '' } },
                    {
                        $or: [
                            { category: 'needs_fix' },
                            { poster: { $regex: 'api.telegram.org' } },
                            { poster: { $regex: 'placehold.co' } }
                        ]
                    }
                ];[span_122](start_span)[span_122](end_span)
            } else {
                query.$and = [
                    { category: { $ne: 'Others' } },
                    { title: { $not: { $regex: /^Unknown_/i } } },
                    { poster: { $ne: null } },
                    { poster: { $ne: '' } }
                ];[span_123](start_span)[span_123](end_span)

                if (category && category !== 'All' && category !== 'Latest') {
                    if (category === 'Web Series') {
                        query.$and.push({ $or: [{ category: 'Web Series' }, { isSeries: true }] });[span_124](start_span)[span_124](end_span)
                    } else if (category === 'Hindi' || category === 'Bollywood') {
                        query.$and.push({ $or: [{ category: 'Hindi' }, { category: 'Bollywood' }] });[span_125](start_span)[span_125](end_span)
                    } else {
                        query.$and.push({ category: { $regex: `^${category}$`, $options: 'i' } });[span_126](start_span)[span_126](end_span)
                    }
                }
            }

            // ⚡ सॉर्टिंग लॉजिक
            let sortOption = { updatedAt: -1 };[span_127](start_span)[span_127](end_span)
            if (category === 'Latest') {
                sortOption = { releaseDate: -1, year: -1, updatedAt: -1 };[span_128](start_span)[span_128](end_span)
            }

            const movies = await Movie.find(query)
                .sort(sortOption)
                .skip((page - 1) * limit)
                .limit(parseInt(limit));[span_129](start_span)[span_129](end_span)

            const total = await Movie.countDocuments(query);[span_130](start_span)[span_130](end_span)

            res.json({
                movies,
                totalPages: Math.ceil(total / limit),
                currentPage: parseInt(page),
                isAdmin
            });[span_131](start_span)[span_131](end_span)
        } catch (err) {
            res.status(500).json({ error: err.message });[span_132](start_span)[span_132](end_span)
        }
    });

    router.get('/bot-info', async (req, res) => {
        try {
            const botInfo = await bot.getMe();[span_133](start_span)[span_133](end_span)
            res.json({ username: botInfo.username });[span_134](start_span)[span_134](end_span)
        } catch (err) {
            res.status(500).json({ error: err.message });[span_135](start_span)[span_135](end_span)
        }
    });

    // ⚡ डायरेक्ट फ़ाइल डिलीवरी API
    router.post('/send-file', async (req, res) => {
        try {
            const { userId, fileId } = req.body;[span_136](start_span)[span_136](end_span)
            if (!userId || !fileId) {
                return res.status(400).json({ success: false, message: "Missing userId or fileId" });[span_137](start_span)[span_137](end_span)
            }

            const timerConfig = await Config.findOne({ key: 'auto_delete_timer' });[span_138](start_span)[span_138](end_span)
            const deleteMinutes = (timerConfig && timerConfig.value) ? parseInt(timerConfig.value) : 10;[span_139](start_span)[span_139](end_span)

            const backupConfig = await Config.findOne({ key: 'backup_channel_link' });[span_140](start_span)[span_140](end_span)
            const backupLink = (backupConfig && backupConfig.value) ? backupConfig.value : 'https://t.me/Moviezoneupdate';[span_141](start_span)[span_141](end_span)

            const movie = await Movie.findOne({ "files.fileId": fileId });[span_142](start_span)[span_142](end_span)
            let movieTitle = "Movie";[span_143](start_span)[span_143](end_span)
            let movieYear = "";[span_144](start_span)[span_144](end_span)
            let fileLabel = "HD";[span_145](start_span)[span_145](end_span)
            let fileType = "document";[span_146](start_span)[span_146](end_span)

            if (movie) {
                movieTitle = movie.title || "Movie";[span_147](start_span)[span_147](end_span)
                movieYear = movie.year ? ` (${movie.year})` : "";[span_148](start_span)[span_148](end_span)
                const matchedFile = movie.files.find(f => f.fileId === fileId);[span_149](start_span)[span_149](end_span)
                if (matchedFile) {
                    fileLabel = matchedFile.label || "HD";[span_150](start_span)[span_150](end_span)
                    fileType = matchedFile.fileType || "document";[span_151](start_span)[span_151](end_span)
                }
            }

            const caption = `🎬 <b>मूवी:</b> <a href="${backupLink}">${movieTitle}${movieYear}</a>\n` +
                            `📦 <b>क्वालिटी:</b> ${fileLabel}\n` +
                            `📢 <b>अपडेट्स:</b> @Moviezoneupdate\n\n` +
                            `⚠️ <i>यह फ़ाइल ${deleteMinutes} मिनट में डिलीट हो जाएगी, इसे तुरंत Saved Messages में फॉरवर्ड कर लें।</i>\n` +
                            `💬 <i>कोई समस्या है? हमारे ग्रुप में बताएं।</i>`;[span_152](start_span)[span_152](end_span)

            const sendMethod = fileType === 'video' ? 'sendVideo' : 'sendDocument';[span_153](start_span)[span_153](end_span)
            const sentMsg = await bot[sendMethod](userId, fileId, {
                caption: caption,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💬 Discussion Group', url: 'https://t.me/+DBD_fVL-Z5QwZWFl' }][span_154](start_span)[span_154](end_span)
                    ]
                }
            });[span_155](start_span)[span_155](end_span)

            setTimeout(async () => {
                try {
                    await bot.deleteMessage(userId, sentMsg.message_id);[span_156](start_span)[span_156](end_span)
                } catch (err) {
                    console.error('[Auto-Delete Error]:', err.message);[span_157](start_span)[span_157](end_span)
                }
            }, deleteMinutes * 60 * 1000);[span_158](start_span)[span_158](end_span)

            res.json({ success: true, message: "फ़ाइल आपके बॉट चैट में भेज दी गई है!" });[span_159](start_span)[span_159](end_span)
        } catch (err) {
            console.error('Send File API Error:', err.message);[span_160](start_span)[span_160](end_span)
            res.status(500).json({ success: false, message: "फ़ाइल भेजने में समस्या आई: " + err.message });[span_161](start_span)[span_161](end_span)
        }
    });

    // 📩 मिनी ऐप रिक्वेस्ट एंडपॉइंट (DM + Admin Group Support)
    router.post('/request', async (req, res) => {
        try {
            const { userId, movieName, username, firstName } = req.body;[span_162](start_span)[span_162](end_span)
            if (!userId || !movieName) {
                return res.status(400).json({ success: false, message: "मूवी का नाम और यूज़र आईडी ज़रूरी है!" });[span_163](start_span)[span_163](end_span)
            }

            const today = new Date().toISOString().split('T')[0];[span_164](start_span)[span_164](end_span)
            let user = await User.findOne({ userId: userId.toString() });[span_165](start_span)[span_165](end_span)

            if (!user) {
                user = new User({
                    userId: userId.toString(),
                    username: username || '',
                    firstName: firstName || ''
                });[span_166](start_span)[span_166](end_span)
                await user.save();[span_167](start_span)[span_167](end_span)
            }

            const inviteLink = `https://t.me/Movie_zone_1bot?start=ref_${userId}`;[span_168](start_span)[span_168](end_span)
            const hasUsedDailyFree = (user.lastRequestDate === today);[span_169](start_span)[span_169](end_span)

            if (hasUsedDailyFree) {
                if (!user.availableCredits || user.availableCredits < 1) {
                    return res.status(403).json({
                        success: false,
                        limitReached: true,
                        inviteLink: inviteLink,
                        message: "आपकी आज की 1 फ़्री रिक्वेस्ट पूरी हो चुकी है!\nऔर रिक्वेस्ट करने के लिए अपने दोस्तों को इनवाइट करें।"
                    });[span_170](start_span)[span_170](end_span)
                } else {
                    user.availableCredits -= 1;[span_171](start_span)[span_171](end_span)
                }
            } else {
                user.lastRequestDate = today;[span_172](start_span)[span_172](end_span)
            }

            await user.save();[span_173](start_span)[span_173](end_span)

            const targetChats = process.env.ADMIN_ID ? process.env.ADMIN_ID.split(',').map(id => id.trim()) : [];[span_174](start_span)[span_174](end_span)
            if (process.env.ADMIN_GROUP_ID && !targetChats.includes(process.env.ADMIN_GROUP_ID.trim())) {
                targetChats.push(process.env.ADMIN_GROUP_ID.trim());
            }

            const requestText = `📩 <b>नई मूवी रिक्वेस्ट (Mini App)!</b>\n\n` +
                                `🎬 <b>मूवी:</b> <code>${movieName}</code>\n` +
                                `👤 <b>यूज़र:</b> ${firstName || 'User'} (@${username || 'N/A'})\n` +
                                `🆔 <b>ID:</b> <code>${userId}</code>`;[span_175](start_span)[span_175](end_span)

            const reply_markup = {
                inline_keyboard: [
                    [
                        { text: '✅ Uploaded', callback_data: `req_done_${userId}_${encodeURIComponent(movieName)}` },[span_176](start_span)[span_176](end_span)
                        { text: '❌ Reject', callback_data: `req_rej_${userId}_${encodeURIComponent(movieName)}` }[span_177](start_span)[span_177](end_span)
                    ]
                ]
            };

            for (const id of targetChats) {
                if (id) {
                    await bot.sendMessage(id, requestText, { parse_mode: 'HTML', reply_markup }).catch((err) => {
                        console.error(`[Admin Request Send Error - ${id}]:`, err.message);[span_178](start_span)[span_178](end_span)
                    });
                }
            }

            res.json({
                success: true,
                usedCredit: hasUsedDailyFree,[span_179](start_span)[span_179](end_span)
                remainingCredits: user.availableCredits,[span_180](start_span)[span_180](end_span)
                message: hasUsedDailyFree 
                    ? `✅ रिक्वेस्ट भेज दी गई! (1 रेफरल क्रेडिट इस्तेमाल हुआ। बाकी: ${user.availableCredits})` 
                    : "✅ रिक्वेस्ट भेज दी गई! (आज की दैनिक फ़्री रिक्वेस्ट इस्तेमाल हुई)[span_181](start_span)"[span_181](end_span)
            });

        } catch (err) {
            res.status(500).json({ success: false, message: "सर्वर एरर: " + err.message });[span_182](start_span)[span_182](end_span)
        }
    });

    return router;[span_183](start_span)[span_183](end_span)
};
