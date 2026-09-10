const { User, Movie, Config } = require('../models');
const { parseMediaInfo, formatBytes, fetchTMDBData } = require('./cleaner');

const ADMIN_ID = process.env.ADMIN_ID;
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;
const UPDATE_CHANNEL_ID = '@Moviezoneupdate';
const UPDATE_CHANNEL_LINK = 'https://t.me/Moviezoneupdate';
const DISCUSS_GROUP_LINK = 'https://t.me/+DBD_fVL-Z5QwZWFl';

const adminDeleteSessions = {};
const adminBroadcastSessions = {};
const PAGE_LIMIT = 8;

// ⚡ बल्क अपलोड कतार और काउंटर
let uploadQueue = Promise.resolve();
const adminFileQueue = {};
let bulkProcessedCount = 0;
let bulkNotificationTimer = null;

async function processNextPendingFile(bot, chatId) {
    if (!adminFileQueue[chatId] || adminFileQueue[chatId].length === 0) return;
    const current = adminFileQueue[chatId][0];
    await bot.sendMessage(
        chatId,
        `⚠️ <b>फ़ाइल (${current.fileSize || 'Unknown Size'}) का नाम नहीं मिला!</b>\n(कतार में शेष फ़ाइलें: ${adminFileQueue[chatId].length})\n\nकृपया इस मूवी/सीरीज़ का नाम लिखकर भेजें:`,
        { parse_mode: 'HTML' }
    );
}

function isAdmin(userId) {
    if (!userId) return false;
    const adminList = ADMIN_ID ? ADMIN_ID.split(',').map(id => id.trim()) : [];
    return adminList.includes(userId.toString());
}

// 🗑️ डिलीट पैनल रेंडरर
async function renderDeletePanel(bot, chatId, messageId = null, page = 1, searchQuery = '') {
    const query = searchQuery ? { title: new RegExp(searchQuery, 'i') } : {};
    const totalMovies = await Movie.countDocuments(query);
    const totalPages = Math.ceil(totalMovies / PAGE_LIMIT) || 1;

    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;

    const movies = await Movie.find(query)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * PAGE_LIMIT)
        .limit(PAGE_LIMIT);

    if (!adminDeleteSessions[chatId]) {
        adminDeleteSessions[chatId] = { selected: [], page: 1, searchQuery: '' };
    }
    adminDeleteSessions[chatId].page = page;
    adminDeleteSessions[chatId].searchQuery = searchQuery;

    const selectedIds = adminDeleteSessions[chatId].selected;

    if (totalMovies === 0) {
        const noText = searchQuery ? `❌ "${searchQuery}" नाम से कोई मूवी नहीं मिली।` : "डेटाबेस में कोई मूवी नहीं है।";
        if (messageId) return bot.editMessageText(noText, { chat_id: chatId, message_id: messageId });
        return bot.sendMessage(chatId, noText);
    }

    let inline_keyboard = movies.map(m => {
        const isSelected = selectedIds.includes(m._id.toString());
        return [{
            text: `${isSelected ? '✅' : '⬜'} ${m.title} (${m.files ? m.files.length : 1})`,
            callback_data: `toggle_${m._id}`
        }];
    });

    let navRow = [];
    if (page > 1) navRow.push({ text: `⬅️ Back`, callback_data: `page_${page - 1}` });
    navRow.push({ text: `📄 ${page}/${totalPages}`, callback_data: `noop` });
    if (page < totalPages) navRow.push({ text: `Next ➡️`, callback_data: `page_${page + 1}` });
    inline_keyboard.push(navRow);

    inline_keyboard.push([
        { text: `🗑️ Delete Selected (${selectedIds.length})`, callback_data: `confirm_bulk_del` },
        { text: `❌ Cancel`, callback_data: `cancel_del` }
    ]);

    let text = `⚙️ <b>मल्टी-सेलेक्ट डिलीट पैनल</b>\n`;
    if (searchQuery) text += `🔍 <b>सर्च फ़िल्टर:</b> <code>${searchQuery}</code>\n`;
    text += `📊 <b>कुल मूवीज़:</b> ${totalMovies} (Page ${page}/${totalPages})\n\nमूवीज़ पर क्लिक करके टिक (✅) लगाएं, फिर नीचे <b>Delete Selected</b> दबाएं:`;

    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard } });
    } else {
        const sent = await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
        adminDeleteSessions[chatId].messageId = sent.message_id;
    }
}

// 📢 स्मार्ट ब्रॉडकास्ट डाइजेस्ट पैनल रेंडरर
async function renderBroadcastDigest(bot, chatId, messageId = null) {
    let pendingMovies = await Movie.find({ broadcastStatus: 'pending' }).sort({ updatedAt: -1 }).limit(10);

    if (pendingMovies.length === 0) {
        pendingMovies = await Movie.find().sort({ updatedAt: -1 }).limit(10);
    }

    if (pendingMovies.length === 0) {
        const emptyText = "❌ <b>डेटाबेस पूरी तरह खाली है!</b>\nपहले कुछ मूवीज़/सीरीज़ अपलोड करें।";
        if (messageId) return bot.editMessageText(emptyText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });
        return bot.sendMessage(chatId, emptyText, { parse_mode: 'HTML' });
    }

    if (!adminBroadcastSessions[chatId]) {
        adminBroadcastSessions[chatId] = { selected: pendingMovies.map(m => m._id.toString()) };
    }

    const selectedIds = adminBroadcastSessions[chatId].selected;

    let inline_keyboard = pendingMovies.map(m => {
        const isSelected = selectedIds.includes(m._id.toString());
        return [{
            text: `${isSelected ? '✅' : '⬜'} ${m.title} (⭐ ${m.rating})`,
            callback_data: `b_toggle_${m._id}`
        }];
    });

    inline_keyboard.push([
        { text: `🚀 Send Selected (${selectedIds.length})`, callback_data: `b_send_selected` },
        { text: `❌ Dismiss All`, callback_data: `b_dismiss_all` }
    ]);

    let text = `📊 <b>स्मार्ट ब्रॉडकास्ट पैनल</b>\n\n` +
               `उपलब्ध मूवीज़: <b>${pendingMovies.length}</b>\n\n` +
               `मूवीज़ पर क्लिक करके सेलेक्ट/अनसेलेक्ट करें, फिर <b>Send Selected</b> दबाएं:`;

    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard } });
    } else {
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
    }
}

module.exports = function setupBotHandlers(bot) {
    // 1. Start Command with Referral Tracking & Channel/Group Buttons
    bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
        try {
            const currentUserId = msg.from.id.toString();
            const payload = match[1] ? match[1].trim() : '';

            let user = await User.findOne({ userId: currentUserId });

            if (!user) {
                let referredBy = null;
                if (payload.startsWith('ref_')) {
                    const referrerId = payload.replace('ref_', '');
                    if (referrerId !== currentUserId) {
                        referredBy = referrerId;
                        const referrer = await User.findOneAndUpdate(
                            { userId: referrerId },
                            { $inc: { referralCount: 1, availableCredits: 1 } },
                            { new: true }
                        );
                        if (referrer) {
                            bot.sendMessage(
                                referrerId,
                                `🎉 <b>बधाई हो!</b> आपके इनवाइट लिंक से <b>${msg.from.first_name || 'नया यूज़र'}</b> जुड़ा है।\nआपको <b>+1 एक्स्ट्रा रिक्वेस्ट क्रेडिट</b> मिला!`,
                                { parse_mode: 'HTML' }
                            ).catch(() => {});
                        }
                    }
                }

                user = new User({
                    userId: currentUserId,
                    username: msg.from.username || '',
                    firstName: msg.from.first_name || '',
                    referredBy: referredBy
                });
                await user.save();
            }

            if (payload && payload.startsWith('file_')) {
                const fileId = payload.replace('file_', '');

                const timerConfig = await Config.findOne({ key: 'auto_delete_timer' });
                const deleteMinutes = (timerConfig && timerConfig.value) ? parseInt(timerConfig.value) : 10;

                const sentMsg = await bot.sendDocument(msg.chat.id, fileId, {
                    caption: `🎬 <b>आपकी अनलॉक की गई फ़ाइल!</b>\n\n⚠️ <i>यह फ़ाइल ${deleteMinutes} मिनट में डिलीट हो जाएगी, इसे तुरंत Saved Messages में फॉरवर्ड कर लें।</i>\n\n💬 <i>फ़ाइल डाउनलोड या प्ले करने में कोई समस्या है तो ग्रुप में बताएं।</i>`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💬 Discussion Group', url: DISCUSS_GROUP_LINK }]
                        ]
                    }
                });

                setTimeout(async () => {
                    try {
                        await bot.deleteMessage(msg.chat.id, sentMsg.message_id);
                    } catch (err) {
                        console.error('[Auto-Delete Error]:', err.message);
                    }
                }, deleteMinutes * 60 * 1000);

                return;
            }
            
            const appUrl = process.env.RENDER_EXTERNAL_URL || 'https://movie-zone-1bot.onrender.com';
            bot.sendMessage(msg.chat.id, `👋 नमस्ते <b>${msg.from.first_name || 'दोस्त'}</b>!\n\n🍿 Movie Zone Store खोलने के लिए नीचे दिए गए बटन पर क्लिक करें:`, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Open Movie Mini App', web_app: { url: appUrl } }],
                        [
                            { text: '📢 Update Channel', url: UPDATE_CHANNEL_LINK },
                            { text: '💬 Discussion Group', url: DISCUSS_GROUP_LINK }
                        ]
                    ]
                }
            });
        } catch (e) {
            console.error('[Start Error]:', e.message);
        }
    });

    // 2. Invite / Refer Command
    bot.onText(/\/(invite|refer)/, async (msg) => {
        try {
            const user = await User.findOne({ userId: msg.from.id.toString() });
            const botInfo = await bot.getMe();
            const inviteLink = `https://t.me/${botInfo.username}?start=ref_${msg.from.id}`;
            const credits = user ? (user.availableCredits || 0) : 0;
            const totalRef = user ? (user.referralCount || 0) : 0;

            const text = `🎁 <b>रेफरल प्रोग्राम (Refer & Earn)</b>\n\n` +
                `📌 <b>नियम:</b> हर यूज़र प्रतिदिन <b>1 फ़्री मूवी रिक्वेस्ट</b> कर सकता है। अतिरिक्त रिक्वेस्ट करने के लिए अपने दोस्तों को इनवाइट करें!\n\n` +
                `📊 <b>आपका स्टेट्स:</b>\n` +
                `• कुल इनवाइट: <b>${totalRef}</b>\n` +
                `• उपलब्ध एक्स्ट्रा क्रेडिट्स: <b>${credits}</b>\n\n` +
                `🔗 <b>आपका इनवाइट लिंक:</b>\n<code>${inviteLink}</code>\n\n` +
                `<i>(हर 1 नए दोस्त के जुड़ने पर आपको +1 रिक्वेस्ट क्रेडिट मिलेगा!)</i>`;

            bot.sendMessage(msg.chat.id, text, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📤 Share Invite Link', url: `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Join Movie Zone for latest movies!')}` }]
                    ]
                }
            });
        } catch (e) {
            bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message);
        }
    });

    // 3. Request Command (Personal DM + Admin Group Support)
    bot.onText(/\/request(?:\s+(.+))?/, async (msg, match) => {
        const reqMovie = match[1] ? match[1].trim() : '';
        if (!reqMovie) {
            return bot.sendMessage(msg.chat.id, "⚠️ <b>तरीका:</b> <code>/request Movie Ka Naam</code>", { parse_mode: 'HTML' });
        }

        const userId = msg.from.id.toString();
        const today = new Date().toISOString().split('T')[0];

        try {
            let user = await User.findOne({ userId });
            if (!user) {
                user = new User({ userId, username: msg.from.username || '', firstName: msg.from.first_name || '' });
                await user.save();
            }

            const botInfo = await bot.getMe();
            const inviteLink = `https://t.me/${botInfo.username}?start=ref_${userId}`;
            const hasUsedDailyFree = (user.lastRequestDate === today);

            if (hasUsedDailyFree) {
                if (!user.availableCredits || user.availableCredits < 1) {
                    return bot.sendMessage(
                        msg.chat.id,
                        `⚠️ <b>आपकी आज की 1 फ़्री रिक्वेस्ट पूरी हो चुकी है!</b>\n\n` +
                        `आज और रिक्वेस्ट करने के लिए दोस्तों को इनवाइट करें। हर इनवाइट पर 1 एक्स्ट्रा रिक्वेस्ट मिलेगी!\n\n` +
                        `🔗 <b>आपका इनवाइट लिंक:</b>\n<code>${inviteLink}</code>`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📤 Invite Friends', url: `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Join Movie Zone!')}` }]
                                ]
                            }
                        }
                    );
                } else {
                    user.availableCredits -= 1;
                }
            } else {
                user.lastRequestDate = today;
            }

            await user.save();

            const targetChats = ADMIN_ID ? ADMIN_ID.split(',').map(id => id.trim()) : [];
            if (ADMIN_GROUP_ID && !targetChats.includes(ADMIN_GROUP_ID.trim())) {
                targetChats.push(ADMIN_GROUP_ID.trim());
            }

            const requestText = `📩 <b>नई मूवी रिक्वेस्ट!</b>\n\n` +
                                `🎬 <b>मूवी:</b> <code>${reqMovie}</code>\n` +
                                `👤 <b>यूज़र:</b> ${msg.from.first_name || 'User'} (@${msg.from.username || 'N/A'})\n` +
                                `🆔 <b>ID:</b> <code>${userId}</code>`;

            const reply_markup = {
                inline_keyboard: [
                    [
                        { text: '✅ Uploaded', callback_data: `req_done_${userId}_${encodeURIComponent(reqMovie)}` },
                        { text: '❌ Reject', callback_data: `req_rej_${userId}_${encodeURIComponent(reqMovie)}` }
                    ]
                ]
            };

            for (const id of targetChats) {
                if (id) {
                    await bot.sendMessage(id, requestText, { parse_mode: 'HTML', reply_markup }).catch(() => {});
                }
            }
            
            bot.sendMessage(
                msg.chat.id,
                `✅ आपकी रिक्वेस्ट <b>"${reqMovie}"</b> एडमिन को भेज दी गई है!\n\n` +
                (hasUsedDailyFree ? `🎟️ <i>(1 रेफरल क्रेडिट इस्तेमाल हुआ। शेष क्रेडिट: ${user.availableCredits})</i>` : `🎁 <i>(दैनिक फ़्री रिक्वेस्ट इस्तेमाल हुई)</i>`) +
                `\n\n📢 <i>मूवी अपलोड होते ही सबसे पहले हमारे <a href="${UPDATE_CHANNEL_LINK}">Update Channel</a> में नोटिफिकेशन आएगा!</i>`,
                { 
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📢 Check Update Channel', url: UPDATE_CHANNEL_LINK }]
                        ]
                    }
                }
            );
        } catch (e) {
            bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message);
        }
    });

    bot.onText(/\/stats/, async (msg) => {
        if (!isAdmin(msg.from.id)) return;
        try {
            const totalUsers = await User.countDocuments();
            const totalMovies = await Movie.countDocuments();
            const allMovies = await Movie.find();
            const totalFiles = allMovies.reduce((sum, m) => sum + (m.files ? m.files.length : 0), 0);
            const pendingBroadcasts = await Movie.countDocuments({ broadcastStatus: 'pending' });

            bot.sendMessage(msg.chat.id, `📊 <b>लाइव स्टेटिस्टिक्स</b>\n\n👥 <b>कुल यूज़र्स:</b> ${totalUsers}\n🎬 <b>कुल मूवी कार्ड्स:</b> ${totalMovies}\n📂 <b>कुल फाइल्स:</b> ${totalFiles}\n📢 <b>पेंडिंग ब्रॉडकास्ट:</b> ${pendingBroadcasts}`, { parse_mode: 'HTML' });
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
    });

    bot.onText(/\/cleardb/, async (msg) => {
        if (!isAdmin(msg.from.id)) return;
        try {
            const result = await Movie.deleteMany({});
            bulkProcessedCount = 0;
            bot.sendMessage(msg.chat.id, `🗑️ <b>डेटाबेस पूरा साफ़ हो गया!</b>\nकुल <b>${result.deletedCount}</b> मूवीज़ हटा दी गईं।`, { parse_mode: 'HTML' });
        } catch (e) { 
            bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); 
        }
    });

    // 🧹 बल्क डुप्लिकेट क्लीनर कमांड
    bot.onText(/\/dedup/, async (msg) => {
        if (!isAdmin(msg.from.id)) return;
        
        await bot.sendMessage(msg.chat.id, '⏳ <b>डेटाबेस क्लीनिंग शुरू हो रही है...</b>\nकृपया कुछ सेकंड इंतज़ार करें।', { parse_mode: 'HTML' });

        try {
            const movies = await Movie.find();
            let totalCleanedFiles = 0;
            let updatedCards = 0;

            for (const movie of movies) {
                if (!movie.files || movie.files.length <= 1) continue;

                const seenFiles = new Set();
                const uniqueFiles = [];

                for (const file of movie.files) {
                    const isEpisode = /(s\d+|ep?\d+|part\s*\d+)/i.test(file.label || '');
                    
                    const uniqueKey = isEpisode 
                        ? `${file.fileId}` 
                        : `${file.label.replace(/\s*\[Option\s*\d+\]/i, '').trim()}_${file.fileSize || ''}`;

                    if (!seenFiles.has(uniqueKey)) {
                        seenFiles.add(uniqueKey);
                        file.label = file.label.replace(/\s*\[Option\s*\d+\]/i, '').trim();
                        uniqueFiles.push(file);
                    } else {
                        totalCleanedFiles++;
                    }
                }

                if (uniqueFiles.length !== movie.files.length) {
                    movie.files = uniqueFiles;
                    movie.updatedAt = new Date();
                    await movie.save();
                    updatedCards++;
                }
            }

            bot.sendMessage(
                msg.chat.id,
                `✅ <b>डेटाबेस क्लीनिंग पूरी हुई!</b>\n\n` +
                `🗑️ हटाई गईं डुप्लिकेट फाइल्स: <b>${totalCleanedFiles}</b>\n` +
                `🎬 सुधारे गए मूवी कार्ड्स: <b>${updatedCards}</b>\n\n` +
                `डेटाबेस एकदम हल्का और व्यवस्थित हो चुका है!`,
                { parse_mode: 'HTML' }
            );
        } catch (err) {
            console.error('[Dedup Error]:', err);
            bot.sendMessage(msg.chat.id, '❌ एरर: ' + err.message);
        }
    });

    // 🏷️ स्मार्ट रीनेम, साल और कस्टम पोस्टर सपोर्ट
    bot.onText(/\/rename (.+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        const parts = match[1].split('=');
        if (parts.length < 2) {
            return bot.sendMessage(msg.chat.id, "⚠️ <b>तरीका:</b>\n1. <code>/rename Purana = Naya Title</code>\n2. <code>/rename Purana = Naya Title (2026)</code>\n3. <code>/rename Purana = Naya Title | Poster_Image_URL</code>", { parse_mode: 'HTML' });
        }

        const oldTitle = parts[0].trim();
        let rightSide = parts[1].trim();

        let customPoster = null;
        if (rightSide.includes('|')) {
            const splitData = rightSide.split('|');
            rightSide = splitData[0].trim();
            customPoster = splitData[1].trim();
        }

        let cleanNewTitle = rightSide.replace(/\((19\d\d|20\d\d)\)/g, '').trim();
        let targetYear = (rightSide.match(/\b(19\d\d|20\d\d)\b/) || [])[0] || null;

        try {
            const oldMovie = await Movie.findOne({ title: new RegExp(`^${oldTitle}$`, 'i') });
            if (!oldMovie) {
                return bot.sendMessage(msg.chat.id, `❌ "${oldTitle}" नाम से कोई मूवी नहीं मिली।`);
            }

            const tmdbData = await fetchTMDBData(cleanNewTitle, targetYear);
            const finalTitle = tmdbData?.officialTitle || cleanNewTitle;
            const poster = customPoster || tmdbData?.poster || oldMovie.poster;
            const rating = tmdbData?.rating || oldMovie.rating || '8.0';
            const year = targetYear || tmdbData?.year || oldMovie.year || '2026';
            const category = tmdbData?.category || (oldMovie.category === 'Others' ? 'Hindi' : oldMovie.category);

            let existingMovie = await Movie.findOne({ 
                title: new RegExp(`^${finalTitle}$`, 'i'),
                _id: { $ne: oldMovie._id }
            });

            if (existingMovie) {
                existingMovie.files = existingMovie.files.concat(oldMovie.files || []);
                if (poster) existingMovie.poster = poster;
                existingMovie.updatedAt = new Date();
                await existingMovie.save();
                await Movie.deleteOne({ _id: oldMovie._id });

                bot.sendMessage(
                    msg.chat.id, 
                    `✅ <b>"${oldTitle}"</b> की फाइल्स को <b>"${existingMovie.title}"</b> में मर्ज कर दिया गया!\n📂 <b>कुल फाइल्स:</b> ${existingMovie.files.length}`, 
                    { parse_mode: 'HTML' }
                );
            } else {
                oldMovie.title = finalTitle;
                oldMovie.poster = poster;
                oldMovie.rating = rating;
                oldMovie.year = year;
                oldMovie.category = category;
                oldMovie.updatedAt = new Date();
                await oldMovie.save();

                bot.sendMessage(msg.chat.id, `✅ <b>अपडेट सफल!</b>\n🎬 <b>टाइटल:</b> ${oldMovie.title}\n📅 <b>वर्ष:</b> ${oldMovie.year}\n🏷️ <b>कैटेगरी:</b> ${oldMovie.category}`, { parse_mode: 'HTML' });
            }
        } catch (e) { 
            bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); 
        }
    });

    // 📢 ब्रॉडकास्ट डाइजेस्ट कमांड
    bot.onText(/\/broadcast_digest/, async (msg) => {
        const userId = msg.from.id.toString();
        if (!isAdmin(userId)) {
            return bot.sendMessage(msg.chat.id, `❌ आपकी ID (<code>${userId}</code>) एडमिन लिस्ट में नहीं है!`, { parse_mode: 'HTML' });
        }
        adminBroadcastSessions[msg.chat.id] = null;
        await renderBroadcastDigest(bot, msg.chat.id);
    });

    bot.onText(/\/broadcast (.+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        const textToSend = match[1];
        try {
            const users = await User.find({ isBlocked: { $ne: true } });
            bot.sendMessage(msg.chat.id, `📢 ${users.length} यूज़र्स और अपडेट चैनल को ब्रॉडकास्ट भेजा जा रहा है...`);
            
            try {
                await bot.sendMessage(UPDATE_CHANNEL_ID, textToSend, { parse_mode: 'HTML' });
            } catch (err) {
                console.error('[Update Channel Post Error]:', err.message);
            }

            let success = 0;
            for (const u of users) {
                try {
                    await bot.sendMessage(u.userId, textToSend, { parse_mode: 'HTML' });
                    success++;
                    await new Promise(r => setTimeout(r, 40));
                } catch (err) {
                    if (err.message && err.message.includes('bot was blocked')) {
                        await User.updateOne({ userId: u.userId }, { isBlocked: true });
                    }
                }
            }
            bot.sendMessage(msg.chat.id, `✅ ब्रॉडकास्ट पूरा हुआ!\n📢 चैनल में पोस्ट हो गया।\n👥 यूज़र्स को भेजा गया: ${success}/${users.length}`);
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
    });

    bot.onText(/\/(manage|delete)(?:\s+(.+))?/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        const searchQuery = match[2] ? match[2].trim() : '';
        adminDeleteSessions[msg.chat.id] = { selected: [], page: 1, searchQuery };
        await renderDeletePanel(bot, msg.chat.id, null, 1, searchQuery);
    });

    bot.on('callback_query', async (query) => {
        const userId = query.from.id;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;

        if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: "❌ एक्सेस डिनाइड!", show_alert: true });

        // 🗑️ Delete Panel Callbacks
        if (data === 'noop') {
            return bot.answerCallbackQuery(query.id);
        } else if (data.startsWith('page_')) {
            const session = adminDeleteSessions[chatId] || { selected: [], page: 1, searchQuery: '' };
            const newPage = parseInt(data.replace('page_', ''));
            session.page = newPage;
            await renderDeletePanel(bot, chatId, messageId, newPage, session.searchQuery);
            await bot.answerCallbackQuery(query.id);
        } else if (data.startsWith('toggle_')) {
            const session = adminDeleteSessions[chatId] || { selected: [], page: 1, searchQuery: '' };
            const movieId = data.replace('toggle_', '');
            if (session.selected.includes(movieId)) {
                session.selected = session.selected.filter(id => id !== movieId);
            } else {
                session.selected.push(movieId);
            }
            await renderDeletePanel(bot, chatId, messageId, session.page, session.searchQuery);
            await bot.answerCallbackQuery(query.id);
        } else if (data === 'confirm_bulk_del') {
            const session = adminDeleteSessions[chatId] || { selected: [] };
            if (session.selected.length === 0) {
                return bot.answerCallbackQuery(query.id, { text: "⚠️ कृपया पहले मूवी सेलेक्ट करें!", show_alert: true });
            }
            try {
                const result = await Movie.deleteMany({ _id: { $in: session.selected } });
                delete adminDeleteSessions[chatId];
                await bot.answerCallbackQuery(query.id, { text: `✅ ${result.deletedCount} मूवीज़ डिलीट!` });
                await bot.editMessageText(`🗑️ <b>सफलता:</b> कुल <b>${result.deletedCount}</b> मूवीज़ हटा दी गईं।`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });
            } catch (err) {
                bot.answerCallbackQuery(query.id, { text: "एरर: " + err.message });
            }
        } else if (data === 'cancel_del') {
            delete adminDeleteSessions[chatId];
            await bot.editMessageText("❌ डिलीट ऑपरेशन रद्द।", { chat_id: chatId, message_id: messageId });
            await bot.answerCallbackQuery(query.id);
        }

        // 📢 Broadcast Panel Callbacks (सभी मूवीज़ के अलग-अलग पोस्टर्स)
        else if (data.startsWith('b_toggle_')) {
            const movieId = data.replace('b_toggle_', '');
            if (!adminBroadcastSessions[chatId]) {
                const pendingMovies = await Movie.find({ broadcastStatus: 'pending' });
                adminBroadcastSessions[chatId] = { selected: pendingMovies.map(m => m._id.toString()) };
            }
            const session = adminBroadcastSessions[chatId];
            if (session.selected.includes(movieId)) {
                session.selected = session.selected.filter(id => id !== movieId);
            } else {
                session.selected.push(movieId);
            }
            await renderBroadcastDigest(bot, chatId, messageId);
            await bot.answerCallbackQuery(query.id);
        } else if (data === 'b_dismiss_all') {
            await Movie.updateMany({ broadcastStatus: 'pending' }, { broadcastStatus: 'ignored' });
            delete adminBroadcastSessions[chatId];
            await bot.editMessageText("❌ सभी पेंडिंग ब्रॉडकास्ट रद्द कर दिए गए।", { chat_id: chatId, message_id: messageId });
            await bot.answerCallbackQuery(query.id);
        } else if (data === 'b_send_selected') {
            const session = adminBroadcastSessions[chatId];
            if (!session || session.selected.length === 0) {
                return bot.answerCallbackQuery(query.id, { text: "⚠️ कोई मूवी सेलेक्ट नहीं की गई है!", show_alert: true });
            }

            const moviesToBroadcast = await Movie.find({ _id: { $in: session.selected } });
            if (moviesToBroadcast.length === 0) return bot.answerCallbackQuery(query.id, { text: "मूवीज़ नहीं मिलीं!" });

            await bot.answerCallbackQuery(query.id, { text: "🚀 ब्रॉडकास्ट शुरू हो रहा है..." });
            await bot.editMessageText("⏳ <b>सभी मूवीज़ के अलग-अलग पोस्टर्स भेजे जा रहे हैं...</b> कृपया इंतज़ार करें।", { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });

            const appUrl = process.env.RENDER_EXTERNAL_URL || 'https://movie-zone-1bot.onrender.com';
            const users = await User.find({ isBlocked: { $ne: true } });

            // 1. सबसे पहले Update Channel में सभी मूवीज़ एक-एक करके भेजें
            for (const m of moviesToBroadcast) {
                const directMovieUrl = `${appUrl}?search=${encodeURIComponent(m.title)}`;
                const cardCaption = `🎬 <b>${m.title}</b> (${m.year || '2026'})\n\n` +
                                    `⭐ <b>रेटिंग:</b> ${m.rating || '8.0'}/10\n` +
                                    `🏷️ <b>कैटेगरी:</b> ${m.category}\n` +
                                    `📂 <b>उपलब्ध क्वालिटीज़:</b> ${m.files ? m.files.length : 1} फ़ाइल्स\n\n` +
                                    `👇 <i>नीचे क्लिक करके तुरंत देखें:</i>`;

                const reply_markup = {
                    inline_keyboard: [
                        [{ text: `🚀 Open "${m.title}"`, web_app: { url: directMovieUrl } }],
                        [{ text: '💬 Discussion Group', url: DISCUSS_GROUP_LINK }]
                    ]
                };

                const hasValidPoster = m.poster && !m.poster.includes('placehold.co');

                try {
                    if (hasValidPoster) {
                        await bot.sendPhoto(UPDATE_CHANNEL_ID, m.poster, { caption: cardCaption, parse_mode: 'HTML', reply_markup });
                    } else {
                        await bot.sendMessage(UPDATE_CHANNEL_ID, cardCaption, { parse_mode: 'HTML', reply_markup });
                    }
                } catch (err) {
                    console.error(`[Channel Post Error - ${m.title}]:`, err.message);
                }
                await new Promise(r => setTimeout(r, 200));
            }

            // 2. फिर सभी यूज़र्स को पर्सनल DM में भेजें
            let success = 0;
            for (const u of users) {
                try {
                    for (const m of moviesToBroadcast) {
                        const directMovieUrl = `${appUrl}?search=${encodeURIComponent(m.title)}`;
                        const cardCaption = `🎬 <b>${m.title}</b> (${m.year || '2026'})\n\n` +
                                            `⭐ <b>रेटिंग:</b> ${m.rating || '8.0'}/10\n` +
                                            `🏷️ <b>कैटेगरी:</b> ${m.category}\n\n` +
                                            `👇 <i>नीचे क्लिक करके सीधे डाउनलोड करें:</i>`;

                        const reply_markup = {
                            inline_keyboard: [
                                [{ text: `🚀 Open "${m.title}"`, web_app: { url: directMovieUrl } }]
                            ]
                        };

                        const hasValidPoster = m.poster && !m.poster.includes('placehold.co');

                        if (hasValidPoster) {
                            await bot.sendPhoto(u.userId, m.poster, { caption: cardCaption, parse_mode: 'HTML', reply_markup });
                        } else {
                            await bot.sendMessage(u.userId, cardCaption, { parse_mode: 'HTML', reply_markup });
                        }
                        await new Promise(r => setTimeout(r, 100));
                    }
                    success++;
                } catch (err) {
                    if (err.message && err.message.includes('bot was blocked')) {
                        await User.updateOne({ userId: u.userId }, { isBlocked: true });
                    }
                }
            }

            await Movie.updateMany({ _id: { $in: session.selected } }, { broadcastStatus: 'sent' });
            delete adminBroadcastSessions[chatId];

            await bot.sendMessage(chatId, `✅ <b>ब्रॉडकास्ट पूरा हुआ!</b>\n📢 कुल <b>${moviesToBroadcast.length}</b> मूवीज़ के अलग-अलग पोस्टर्स चैनल में शेयर हो गए!\n👥 यूज़र्स को डिलीवर: <b>${success}/${users.length}</b>`, { parse_mode: 'HTML' });
        }
        // 📩 मूवी रिक्वेस्ट एक्शन्स (डायरेक्ट डीप लिंक के साथ)
        else if (data.startsWith('req_done_')) {
            const parts = data.replace('req_done_', '').split('_');[span_2](start_span)[span_2](end_span)
            const targetUserId = parts[0];[span_3](start_span)[span_3](end_span)
            const requestedTitle = decodeURIComponent(parts.slice(1).join('_'));[span_4](start_span)[span_4](end_span)
            const appUrl = process.env.RENDER_EXTERNAL_URL || 'https://movie-zone-1bot.onrender.com';[span_5](start_span)[span_5](end_span)
            const directMovieUrl = `${appUrl}?search=${encodeURIComponent(requestedTitle)}`;

            try {
                await bot.sendMessage(
                    targetUserId,
                    `🎉 <b>आपकी रिक्वेस्ट पूरी हो गई है!</b>\n\n🎬 मूवी/सीरीज़: <b>${requestedTitle}</b> अब स्टोर में उपलब्ध है।\n\n👇 नीचे क्लिक करके सीधे देखें:`,
                    {
                        parse_mode: 'HTML',[span_6](start_span)[span_6](end_span)
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: `🚀 Open "${requestedTitle}"`, web_app: { url: directMovieUrl } }]
                            ]
                        }
                    }
                );

                await bot.answerCallbackQuery(query.id, { text: "✅ यूज़र को डायरेक्ट लिंक भेज दिया गया!" });[span_7](start_span)[span_7](end_span)
                await bot.editMessageText(
                    `${query.message.text}\n\n✅ <b>स्टेटस:</b> अपलोड पूरा हुआ और यूज़र को डायरेक्ट लिंक भेजा गया।`,
                    { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }[span_8](start_span)[span_8](end_span)
                );
            } catch (err) {
                await bot.answerCallbackQuery(query.id, { text: "⚠️ यूज़र को मैसेज नहीं भेजा जा सका!" });[span_9](start_span)[span_9](end_span)
            }
        } else if (data.startsWith('req_rej_')) {
            const parts = data.replace('req_rej_', '').split('_');[span_10](start_span)[span_10](end_span)
            const targetUserId = parts[0];[span_11](start_span)[span_11](end_span)
            const requestedTitle = decodeURIComponent(parts.slice(1).join('_'));[span_12](start_span)[span_12](end_span)

            try {
                await bot.sendMessage(
                    targetUserId,
                    `⚠️ <b>माफ़ी चाहते हैं!</b>\n\nआपकी रिक्वेस्ट की गई सामग्री <b>"${requestedTitle}"</b> वर्तमान में उपलब्ध नहीं कराई जा सकी।`,
                    { parse_mode: 'HTML' }[span_13](start_span)[span_13](end_span)
                );

                await bot.answerCallbackQuery(query.id, { text: "❌ रिक्वेस्ट रिजेक्ट कर दी गई!" });[span_14](start_span)[span_14](end_span)
                await bot.editMessageText(
                    `${query.message.text}\n\n❌ <b>स्टेटस:</b> रिजेक्ट कर दिया गया।`,
                    { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }[span_15](start_span)[span_15](end_span)
                );
            } catch (err) {
                await bot.answerCallbackQuery(query.id, { text: "एरर: " + err.message });[span_16](start_span)[span_16](end_span)
            }
        }
    });

    bot.onText(/\/settimer\s+(\d+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;[span_17](start_span)[span_17](end_span)
        const minutes = parseInt(match[1]);[span_18](start_span)[span_18](end_span)
        if (minutes < 1) return bot.sendMessage(msg.chat.id, "⚠️ टाइमर कम से कम 1 मिनट होना चाहिए।");[span_19](start_span)[span_19](end_span)

        try {
            await Config.findOneAndUpdate({ key: 'auto_delete_timer' }, { value: minutes }, { upsert: true });[span_20](start_span)[span_20](end_span)
            bot.sendMessage(msg.chat.id, `⏱️ <b>ऑटो-डिलीट टाइमर सेट:</b> <code>${minutes} मिनट</code>`, { parse_mode: 'HTML' });[span_21](start_span)[span_21](end_span)
        } catch (e) {
            bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message);[span_22](start_span)[span_22](end_span)
        }
    });
    
    bot.onText(/\/setbackup\s+(.+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;[span_23](start_span)[span_23](end_span)
        const link = match[1].trim();[span_24](start_span)[span_24](end_span)
        try {
            await Config.findOneAndUpdate({ key: 'backup_channel_link' }, { value: link }, { upsert: true });[span_25](start_span)[span_25](end_span)
            bot.sendMessage(msg.chat.id, `📢 <b>बैकअप चैनल लिंक सेट:</b> <code>${link}</code>`, { parse_mode: 'HTML' });[span_26](start_span)[span_26](end_span)
        } catch (e) {
            bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message);[span_27](start_span)[span_27](end_span)
        }
    });

    // ⚡ साइलेंट व तेज़ डेटाबेस सेवर
    async function saveMovieToDB(bot, chatId, titleToUse, fileData) {
        const { fileId, fileType, fileSize, thumbFileId, label, isSeries, isDubbed, detectedYear, isOther } = fileData;[span_28](start_span)[span_28](end_span)
        try {
            const tmdbData = await fetchTMDBData(titleToUse, detectedYear, isSeries);[span_29](start_span)[span_29](end_span)
            const finalMovieTitle = tmdbData?.officialTitle || titleToUse;[span_30](start_span)[span_30](end_span)
            let poster = tmdbData?.poster || null;[span_31](start_span)[span_31](end_span)
            const rating = tmdbData?.rating || '8.0';[span_32](start_span)[span_32](end_span)
            const year = tmdbData?.year || detectedYear || '2026';[span_33](start_span)[span_33](end_span)
            const releaseDate = tmdbData?.releaseDate ? new Date(tmdbData.releaseDate) : null;[span_34](start_span)[span_34](end_span)

            if (!poster && thumbFileId) {
                try {
                    const fileObj = await bot.getFile(thumbFileId);[span_35](start_span)[span_35](end_span)
                    if (fileObj && fileObj.file_path) {
                        poster = `https://api.telegram.org/file/bot${bot.token}/${fileObj.file_path}`;[span_36](start_span)[span_36](end_span)
                    }
                } catch (e) {}
            }

            let finalCategory = isOther ? 'Others' : (tmdbData?.category || (isSeries ? 'Web Series' : 'Movie'));[span_37](start_span)[span_37](end_span)
            if (!isSeries && isDubbed && finalCategory !== 'Hindi' && !isOther) {
                finalCategory = 'Hindi';[span_38](start_span)[span_38](end_span)
            }

            let isEligible = false;[span_39](start_span)[span_39](end_span)
            if (parseFloat(rating) >= 9.0) {
                isEligible = true;[span_40](start_span)[span_40](end_span)
            } else if (releaseDate) {
                const diffDays = Math.floor((new Date() - releaseDate) / (1000 * 60 * 60 * 24));[span_41](start_span)[span_41](end_span)
                if (diffDays >= 0 && diffDays <= 30) isEligible = true;[span_42](start_span)[span_42](end_span)
            }

            let movie = await Movie.findOne({ 
                $or: [
                    { title: new RegExp(`^${titleToUse}$`, 'i') },
                    { title: new RegExp(`^${finalMovieTitle}$`, 'i') }
                ]
            });[span_43](start_span)[span_43](end_span)

            let finalLabel = label;[span_44](start_span)[span_44](end_span)
            if (fileSize) finalLabel += ` (${fileSize})`;[span_45](start_span)[span_45](end_span)

            if (movie) {
                const countSameLabel = movie.files.filter(f => f.label.startsWith(label)).length;[span_46](start_span)[span_46](end_span)
                if (countSameLabel > 0) finalLabel += ` [Option ${countSameLabel + 1}]`;[span_47](start_span)[span_47](end_span)

                movie.files.push({ label: finalLabel, fileId, fileType, fileSize });[span_48](start_span)[span_48](end_span)
                if (thumbFileId && !movie.thumbFileId) movie.thumbFileId = thumbFileId;[span_49](start_span)[span_49](end_span)
                if (poster && (!movie.poster || movie.poster.includes('placehold.co'))) movie.poster = poster;[span_50](start_span)[span_50](end_span)
                if (isEligible && movie.broadcastStatus !== 'sent') {
                    movie.broadcastStatus = 'pending';[span_51](start_span)[span_51](end_span)
                    movie.isEligibleForBroadcast = true;[span_52](start_span)[span_52](end_span)
                }
                movie.updatedAt = new Date();[span_53](start_span)[span_53](end_span)
                await movie.save();[span_54](start_span)[span_54](end_span)

                console.log(`[Auto-Merged]: ${movie.title} -> ${finalLabel}`);[span_55](start_span)[span_55](end_span)
            } else {
                movie = new Movie({
                    title: finalMovieTitle,
                    poster: poster,
                    rating,
                    year,
                    releaseDate,
                    category: finalCategory,
                    thumbFileId,
                    broadcastStatus: isEligible ? 'pending' : 'ignored',
                    isEligibleForBroadcast: isEligible,
                    files: [{ label: finalLabel, fileId, fileType, fileSize }]
                });[span_56](start_span)[span_56](end_span)
                await movie.save();[span_57](start_span)[span_57](end_span)

                console.log(`[Created]: ${finalMovieTitle} -> ${finalCategory}`);[span_58](start_span)[span_58](end_span)
            }

            bulkProcessedCount++;[span_59](start_span)[span_59](end_span)
            if (bulkProcessedCount % 100 === 0 && chatId) {
                bot.sendMessage(
                    chatId,
                    `📊 <b>[बल्क अपलोड स्टेटस]:</b> कुल <b>${bulkProcessedCount}</b> फ़ाइलें सफलतापूर्वक प्रोसेस और सेव हो चुकी हैं!`,
                    { parse_mode: 'HTML' }[span_60](start_span)[span_60](end_span)
                ).catch(() => {});
            }

            if (bulkNotificationTimer) clearTimeout(bulkNotificationTimer);[span_61](start_span)[span_61](end_span)
            bulkNotificationTimer = setTimeout(async () => {
                try {
                    const totalMovies = await Movie.countDocuments();[span_62](start_span)[span_62](end_span)
                    if (chatId) {
                        bot.sendMessage(
                            chatId,
                            `🎉 <b>बल्क अपलोड पूरा हुआ!</b>\n\n📥 हाल में प्रोसेस की गईं फ़ाइलें: <b>${bulkProcessedCount}</b>\n🎬 डेटाबेस में कुल कार्ड्स: <b>${totalMovies}</b>`,
                            { parse_mode: 'HTML' }[span_63](start_span)[span_63](end_span)
                        ).catch(() => {});
                    }
                    bulkProcessedCount = 0;[span_64](start_span)[span_64](end_span)
                } catch (e) {}
            }, 5000);[span_65](start_span)[span_65](end_span)

        } catch (err) {
            console.error('[DB Save Error]:', err.message);[span_66](start_span)[span_66](end_span)
        }
    }

    // ⚡ साझा मीडिया हैंडलर
    async function handleIncomingFile(msg, isChannel = false) {
        const file = msg.video || msg.document;[span_67](start_span)[span_67](end_span)
        if (!file) return;[span_68](start_span)[span_68](end_span)

        uploadQueue = uploadQueue.then(async () => {
            let rawInput = msg.caption || file.file_name || '';[span_69](start_span)[span_69](end_span)

            if (!rawInput && file.file_id) {
                try {
                    const fileInfo = await bot.getFile(file.file_id);[span_70](start_span)[span_70](end_span)
                    if (fileInfo && fileInfo.file_path) {
                        const extracted = fileInfo.file_path.split('/').pop().replace(/\.[^/.]+$/, "");[span_71](start_span)[span_71](end_span)
                        if (!extracted.startsWith('file_')) {
                            rawInput = extracted;[span_72](start_span)[span_72](end_span)
                        }
                    }
                } catch (e) {}
            }

            const { cleanTitle, label, isSeries, isDubbed, detectedYear, isOther } = parseMediaInfo(rawInput);[span_73](start_span)[span_73](end_span)
            const fileId = file.file_id;[span_74](start_span)[span_74](end_span)
            const fileType = msg.video ? 'video' : 'document';[span_75](start_span)[span_75](end_span)
            const fileSize = formatBytes(file.file_size);[span_76](start_span)[span_76](end_span)
            let thumbFileId = file.thumbnail ? file.thumbnail.file_id : null;[span_77](start_span)[span_77](end_span)

            const fileData = { fileId, fileType, fileSize, thumbFileId, label, isSeries, isDubbed, detectedYear, isOther };[span_78](start_span)[span_78](end_span)

            const notifyChatId = isChannel ? (ADMIN_ID ? ADMIN_ID.split(',')[0].trim() : null) : msg.chat.id;[span_79](start_span)[span_79](end_span)

            if (!cleanTitle) {
                if (!isChannel) {
                    if (!adminFileQueue[msg.chat.id]) adminFileQueue[msg.chat.id] = [];[span_80](start_span)[span_80](end_span)
                    adminFileQueue[msg.chat.id].push(fileData);[span_81](start_span)[span_81](end_span)
                    
                    if (adminFileQueue[msg.chat.id].length === 1) {
                        await processNextPendingFile(bot, msg.chat.id);[span_82](start_span)[span_82](end_span)
                    }
                }
                return;[span_83](start_span)[span_83](end_span)
            }

            await saveMovieToDB(bot, notifyChatId, cleanTitle, fileData);[span_84](start_span)[span_84](end_span)
            await new Promise(r => setTimeout(r, 120));[span_85](start_span)[span_85](end_span)
        });
    }

    // 📢 1. चैनल पोस्ट लिसनर
    bot.on('channel_post', async (msg) => {
        if (msg.document || msg.video) {
            await handleIncomingFile(msg, true);[span_86](start_span)[span_86](end_span)
        }
    });

    // 👤 2. पर्सनल चैट लिसनर
    bot.on('message', async (msg) => {
        if (msg.chat && (msg.chat.type === 'group' || msg.chat.type === 'supergroup')) {
            if (msg.text && !msg.text.startsWith('/')) {
                const queryText = msg.text.trim();[span_87](start_span)[span_87](end_span)
                if (queryText.length > 3 && !msg.from.is_bot) {
                    const matchedMovie = await Movie.findOne({ title: new RegExp(queryText, 'i') });[span_88](start_span)[span_88](end_span)
                    if (matchedMovie) {
                        const appUrl = process.env.RENDER_EXTERNAL_URL || 'https://movie-zone-1bot.onrender.com';[span_89](start_span)[span_89](end_span)
                        bot.sendMessage(
                            msg.chat.id,
                            `🍿 <b>"${matchedMovie.title}"</b> हमारे स्टोर में उपलब्ध है!\n\n👇 नीचे क्लिक करके तुरंत देखें:`,
                            {
                                reply_to_message_id: msg.message_id,[span_90](start_span)[span_90](end_span)
                                parse_mode: 'HTML',[span_91](start_span)[span_91](end_span)
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '🚀 Open Mini App', web_app: { url: appUrl } }][span_92](start_span)[span_92](end_span)
                                    ]
                                }
                            }
                        ).catch(() => {});
                    }
                }
            }
            return;[span_93](start_span)[span_93](end_span)
        }

        const userId = msg.from ? msg.from.id.toString() : '';[span_94](start_span)[span_94](end_span)
        if (!isAdmin(userId)) return;[span_95](start_span)[span_95](end_span)

        // 🖼️ फ़ोटो अपलोड करके डायरेक्ट पोस्टर अपडेट करना
        if (msg.photo && msg.caption && msg.caption.startsWith('/setposter')) {
            const movieTitle = msg.caption.replace('/setposter', '').trim();[span_96](start_span)[span_96](end_span)
            if (!movieTitle) {
                return bot.sendMessage(msg.chat.id, '⚠️ <b>तरीका:</b> फ़ोटो के कैप्शन में मूवी का नाम लिखें:\n<code>/setposter Movie Ka Naam</code>', { parse_mode: 'HTML' });[span_97](start_span)[span_97](end_span)
            }

            try {
                const photoId = msg.photo[msg.photo.length - 1].file_id;[span_98](start_span)[span_98](end_span)
                const fileObj = await bot.getFile(photoId);[span_99](start_span)[span_99](end_span)
                const posterUrl = `https://api.telegram.org/file/bot${bot.token}/${fileObj.file_path}`;[span_100](start_span)[span_100](end_span)

                const movie = await Movie.findOne({ title: new RegExp(`^${movieTitle}$`, 'i') });[span_101](start_span)[span_101](end_span)
                if (!movie) {
                    return bot.sendMessage(msg.chat.id, `❌ "${movieTitle}" नाम से कोई मूवी डेटाबेस में नहीं मिली।`);[span_102](start_span)[span_102](end_span)
                }

                movie.poster = posterUrl;[span_103](start_span)[span_103](end_span)
                await movie.save();[span_104](start_span)[span_104](end_span)

                return bot.sendMessage(msg.chat.id, `✅ <b>"${movie.title}"</b> का पोस्टर सफलतापूर्वक बदल दिया गया!`, { parse_mode: 'HTML' });[span_105](start_span)[span_105](end_span)
            } catch (err) {
                return bot.sendMessage(msg.chat.id, '❌ एरर: ' + err.message);[span_106](start_span)[span_106](end_span)
            }
        }

        if (msg.text && !msg.text.startsWith('/') && adminFileQueue[msg.chat.id] && adminFileQueue[msg.chat.id].length > 0) {
            const fileData = adminFileQueue[msg.chat.id].shift();[span_107](start_span)[span_107](end_span)
            const enteredTitle = msg.text.trim();[span_108](start_span)[span_108](end_span)
            
            uploadQueue = uploadQueue.then(async () => {
                await saveMovieToDB(bot, msg.chat.id, enteredTitle, fileData);[span_109](start_span)[span_109](end_span)
                if (adminFileQueue[msg.chat.id] && adminFileQueue[msg.chat.id].length > 0) {
                    await processNextPendingFile(bot, msg.chat.id);[span_110](start_span)[span_110](end_span)
                }
            });
            return;[span_111](start_span)[span_111](end_span)
        }

        if (msg.text && msg.text.startsWith('/')) return;[span_112](start_span)[span_112](end_span)

        if (msg.video || msg.document) {
            await handleIncomingFile(msg, false);[span_113](start_span)[span_113](end_span)
        }
    });
};
