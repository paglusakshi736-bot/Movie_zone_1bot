const { User, Movie, Config } = require('../models');
const { parseMediaInfo, formatBytes, fetchTMDBData } = require('./cleaner');

const ADMIN_ID = process.env.ADMIN_ID;
const adminDeleteSessions = {};
const adminBroadcastSessions = {};
const PAGE_LIMIT = 8;
let uploadQueue = Promise.resolve();
const adminFileQueue = {};

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
    const pendingMovies = await Movie.find({ broadcastStatus: 'pending' }).sort({ updatedAt: -1 }).limit(10);

    if (pendingMovies.length === 0) {
        const emptyText = "✅ <b>कोई पेंडिंग ब्रॉडकास्ट नहीं है!</b>\n(30 दिन के अंदर रिलीज़ हुई या 9.0+ रेटिंग वाली नई मूवीज़ यहाँ दिखेंगी)";
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

    let text = `📊 <b>दैनिक स्मार्ट ब्रॉडकास्ट डाइजेस्ट</b>\n\n` +
               `फ़िल्टर शर्तें: <i>रिलीज़ ≤ 30 दिन या रेटिंग ≥ 9.0</i>\n` +
               `पेंडिंग मूवीज़: <b>${pendingMovies.length}</b>\n\n` +
               `मूवीज़ पर क्लिक करके सेलेक्ट/अनसेलेक्ट करें, फिर <b>Send Selected</b> दबाएं:`;

    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard } });
    } else {
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
    }
}

module.exports = function setupBotHandlers(bot) {
    // 1. Start Command with Referral Tracking
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
                    caption: `🎬 <b>आपकी अनलॉक की गई फ़ाइल!</b>\n\n⚠️ <i>यह फ़ाइल ${deleteMinutes} मिनट में डिलीट हो जाएगी, इसे तुरंत Saved Messages में फॉरवर्ड कर लें।</i>`,
                    parse_mode: 'HTML'
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
                        [{ text: '🚀 Open Movie Mini App', web_app: { url: appUrl } }]
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

    // 3. Request Command
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

            const adminIds = ADMIN_ID ? ADMIN_ID.split(',').map(id => id.trim()) : [];
            const requestText = `📩 <b>नई मूवी रिक्वेस्ट!</b>\n\n🎬 <b>मूवी:</b> ${reqMovie}\n👤 <b>यूज़र:</b> ${msg.from.first_name || 'User'} (@${msg.from.username || 'N/A'})\n🆔 <b>ID:</b> <code>${userId}</code>`;

            for (const id of adminIds) {
                await bot.sendMessage(id, requestText, { parse_mode: 'HTML' }).catch(() => {});
            }

            bot.sendMessage(
                msg.chat.id,
                `✅ आपकी रिक्वेस्ट <b>"${reqMovie}"</b> एडमिन को भेज दी गई है!\n\n` +
                (hasUsedDailyFree ? `🎟️ <i>(1 रेफरल क्रेडिट इस्तेमाल हुआ। शेष क्रेडिट: ${user.availableCredits})</i>` : `🎁 <i>(दैनिक फ़्री रिक्वेस्ट इस्तेमाल हुई)</i>`),
                { parse_mode: 'HTML' }
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
            bot.sendMessage(msg.chat.id, `🗑️ <b>डेटाबेस पूरा साफ़ हो गया!</b>\nकुल <b>${result.deletedCount}</b> मूवीज़ हटा दी गईं।`, { parse_mode: 'HTML' });
        } catch (e) { 
            bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); 
        }
    });

    // 📢 ब्रॉडकास्ट डाइजेस्ट कमांड
    bot.onText(/\/broadcast_digest/, async (msg) => {
        if (!isAdmin(msg.from.id)) return;
        adminBroadcastSessions[msg.chat.id] = null;
        await renderBroadcastDigest(bot, msg.chat.id);
    });

    bot.onText(/\/broadcast (.+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        const textToSend = match[1];
        try {
            const users = await User.find({ isBlocked: { $ne: true } });
            bot.sendMessage(msg.chat.id, `📢 ${users.length} यूज़र्स को ब्रॉडकास्ट भेजा जा रहा है...`);
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
            bot.sendMessage(msg.chat.id, `✅ ब्रॉडकास्ट पूरा हुआ! सफलता: ${success}/${users.length}`);
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

        // 📢 Broadcast Panel Callbacks
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
            await bot.editMessageText("⏳ <b>ब्रॉडकास्ट भेजा जा रहा है...</b> कृपया इंतज़ार करें।", { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });

            const appUrl = process.env.RENDER_EXTERNAL_URL || 'https://movie-zone-1bot.onrender.com';
            let broadcastText = `🔥 <b>ताज़ा और टॉप-रेटेड रिलीज़ेस जुड़ चुकी हैं!</b>\n\n`;

            moviesToBroadcast.forEach((m, idx) => {
                broadcastText += `${idx + 1}. 🎬 <b>${m.title}</b> (${m.year || '2026'})\n` +
                                 `   ⭐ रेटिंग: <b>${m.rating || '8.0'}/10</b> | 🏷️ <b>${m.category}</b>\n\n`;
            });

            broadcastText += `👇 <i>अभी मिनी ऐप खोलकर फ़ाइल डाउनलोड करें:</i>`;

            const reply_markup = {
                inline_keyboard: [
                    [{ text: '🚀 Open in Movie Mini App', web_app: { url: appUrl } }]
                ]
            };

            const users = await User.find({ isBlocked: { $ne: true } });
            let success = 0;

            for (const u of users) {
                try {
                    await bot.sendMessage(u.userId, broadcastText, { parse_mode: 'HTML', reply_markup });
                    success++;
                    await new Promise(r => setTimeout(r, 40));
                } catch (err) {
                    if (err.message && err.message.includes('bot was blocked')) {
                        await User.updateOne({ userId: u.userId }, { isBlocked: true });
                    }
                }
            }

            // मार्क एज़ सेंट
            await Movie.updateMany({ _id: { $in: session.selected } }, { broadcastStatus: 'sent' });
            delete adminBroadcastSessions[chatId];

            await bot.sendMessage(chatId, `✅ <b>ब्रॉडकास्ट पूरा हुआ!</b>\nसफलतापूर्वक भेजा गया: <b>${success}/${users.length} यूज़र्स</b>`, { parse_mode: 'HTML' });
        }
    });

    bot.onText(/\/settimer\s+(\d+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        const minutes = parseInt(match[1]);
        if (minutes < 1) return bot.sendMessage(msg.chat.id, "⚠️ टाइमर कम से कम 1 मिनट होना चाहिए।");

        try {
            await Config.findOneAndUpdate({ key: 'auto_delete_timer' }, { value: minutes }, { upsert: true });
            bot.sendMessage(msg.chat.id, `⏱️ <b>ऑटो-डिलीट टाइमर सेट:</b> <code>${minutes} मिनट</code>`, { parse_mode: 'HTML' });
        } catch (e) {
            bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message);
        }
    });
    
    bot.onText(/\/setbackup\s+(.+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        const link = match[1].trim();
        try {
            await Config.findOneAndUpdate({ key: 'backup_channel_link' }, { value: link }, { upsert: true });
            bot.sendMessage(msg.chat.id, `📢 <b>बैकअप चैनल लिंक सेट:</b> <code>${link}</code>`, { parse_mode: 'HTML' });
        } catch (e) {
            bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message);
        }
    });

    async function saveMovieToDB(bot, chatId, titleToUse, fileData) {
        const { fileId, fileType, fileSize, thumbFileId, label, isSeries, isDubbed, detectedYear } = fileData;
        try {
            const tmdbData = await fetchTMDBData(titleToUse, detectedYear, isSeries);
            const finalMovieTitle = tmdbData?.officialTitle || titleToUse;
            let poster = tmdbData?.poster || null;
            const rating = tmdbData?.rating || '8.0';
            const year = tmdbData?.year || detectedYear || '2026';
            const releaseDate = tmdbData?.releaseDate ? new Date(tmdbData.releaseDate) : null;

            if (!poster && thumbFileId) {
                try {
                    const fileObj = await bot.getFile(thumbFileId);
                    if (fileObj && fileObj.file_path) {
                        poster = `https://api.telegram.org/file/bot${bot.token}/${fileObj.file_path}`;
                    }
                } catch (e) {
                    console.error('[Telegram Thumb Fetch Error]:', e.message);
                }
            }

            let finalCategory = tmdbData?.category || (isSeries ? 'Web Series' : 'Movie');
            if (!isSeries && isDubbed && finalCategory !== 'Hindi') {
                finalCategory = 'Hindi';
            }

            // 🎯 स्मार्ट फ़िल्टरिंग: 30 दिन या 9.0+ रेटिंग
            let isEligible = false;
            if (parseFloat(rating) >= 9.0) {
                isEligible = true;
            } else if (releaseDate) {
                const diffDays = Math.floor((new Date() - releaseDate) / (1000 * 60 * 60 * 24));
                if (diffDays >= 0 && diffDays <= 30) isEligible = true;
            }

            let movie = await Movie.findOne({ 
                $or: [
                    { title: new RegExp(`^${titleToUse}$`, 'i') },
                    { title: new RegExp(`^${finalMovieTitle}$`, 'i') }
                ]
            });

            let finalLabel = label;
            if (fileSize) finalLabel += ` (${fileSize})`;

            if (movie) {
                const countSameLabel = movie.files.filter(f => f.label.startsWith(label)).length;
                if (countSameLabel > 0) finalLabel += ` [Option ${countSameLabel + 1}]`;

                movie.files.push({ label: finalLabel, fileId, fileType, fileSize });
                if (thumbFileId && !movie.thumbFileId) movie.thumbFileId = thumbFileId;
                if (poster && (!movie.poster || movie.poster.includes('placehold.co'))) movie.poster = poster;
                if (isEligible && movie.broadcastStatus !== 'sent') {
                    movie.broadcastStatus = 'pending';
                    movie.isEligibleForBroadcast = true;
                }
                movie.updatedAt = new Date();
                await movie.save();

                await bot.sendMessage(
                    chatId,
                    `✅ <b>मौजूदा कार्ड में नया वर्ज़न जोड़ा गया!</b>\n\n🎬 <b>मूवी:</b> ${movie.title}\n📦 <b>क्वालिटी:</b> ${finalLabel}\n📂 <b>कुल फाइल्स:</b> ${movie.files.length}` +
                    (isEligible ? `\n📢 <i>(स्मार्ट ब्रॉडकास्ट कतार में जोड़ी गई)</i>` : ''),
                    { parse_mode: 'HTML' }
                );
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
                });
                await movie.save();

                await bot.sendMessage(
                    chatId,
                    `✅ <b>नया कार्ड बना!</b>\n\n🎬 <b>मूवी:</b> ${finalMovieTitle}\n🏷️ <b>कैटेगरी:</b> ${finalCategory}\n📦 <b>क्वालिटी:</b> ${finalLabel}\n⭐ <b>रेटिंग:</b> ${rating}\n📅 <b>साल:</b> ${year}` +
                    (isEligible ? `\n📢 <i>(स्मार्ट ब्रॉडकास्ट कतार में जोड़ी गई)</i>` : ''),
                    { parse_mode: 'HTML' }
                );
            }
        } catch (err) {
            await bot.sendMessage(chatId, "❌ एरर: " + err.message);
        }
    }

    bot.on('message', async (msg) => {
        const userId = msg.from ? msg.from.id.toString() : '';
        if (!isAdmin(userId)) return;

        if (msg.text && !msg.text.startsWith('/') && adminFileQueue[msg.chat.id] && adminFileQueue[msg.chat.id].length > 0) {
            const fileData = adminFileQueue[msg.chat.id].shift();
            const enteredTitle = msg.text.trim();
            
            uploadQueue = uploadQueue.then(async () => {
                await saveMovieToDB(bot, msg.chat.id, enteredTitle, fileData);
                if (adminFileQueue[msg.chat.id] && adminFileQueue[msg.chat.id].length > 0) {
                    await processNextPendingFile(bot, msg.chat.id);
                }
            });
            return;
        }

        if (msg.text && msg.text.startsWith('/')) return;
        if (msg.photo && msg.caption && msg.caption.startsWith('/setposter')) return;

        const file = msg.video || msg.document;
        if (!file) return;

        uploadQueue = uploadQueue.then(async () => {
            let rawInput = msg.caption || file.file_name || '';

            if (!rawInput && file.file_id) {
                try {
                    const fileInfo = await bot.getFile(file.file_id);
                    if (fileInfo && fileInfo.file_path) {
                        const extracted = fileInfo.file_path.split('/').pop().replace(/\.[^/.]+$/, "");
                        if (!extracted.startsWith('file_')) {
                            rawInput = extracted;
                        }
                    }
                } catch (e) {}
            }

            const { cleanTitle, label, isSeries, isDubbed, detectedYear } = parseMediaInfo(rawInput);
            const fileId = file.file_id;
            const fileType = msg.video ? 'video' : 'document';
            const fileSize = formatBytes(file.file_size);
            let thumbFileId = file.thumbnail ? file.thumbnail.file_id : null;

            const fileData = { fileId, fileType, fileSize, thumbFileId, label, isSeries, isDubbed, detectedYear };

            if (!cleanTitle) {
                if (!adminFileQueue[msg.chat.id]) adminFileQueue[msg.chat.id] = [];
                adminFileQueue[msg.chat.id].push(fileData);
                
                if (adminFileQueue[msg.chat.id].length === 1) {
                    await processNextPendingFile(bot, msg.chat.id);
                }
                return;
            }

            await saveMovieToDB(bot, msg.chat.id, cleanTitle, fileData);
        });
    });
};
