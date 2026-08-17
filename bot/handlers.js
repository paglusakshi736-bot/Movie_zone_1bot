const { User, Movie, Config } = require('../models');
const { parseMediaInfo, formatBytes, fetchTMDBData } = require('./cleaner');

const ADMIN_ID = process.env.ADMIN_ID;
const adminDeleteSessions = {};
const PAGE_LIMIT = 8;
let uploadQueue = Promise.resolve();

function isAdmin(userId) {
    if (!userId) return false;
    const adminList = ADMIN_ID ? ADMIN_ID.split(',').map(id => id.trim()) : [];
    return adminList.includes(userId.toString());
}

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

module.exports = function setupBotHandlers(bot) {
    bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
        try {
            await User.findOneAndUpdate(
                { userId: msg.from.id.toString() },
                { userId: msg.from.id.toString(), username: msg.from.username || '', firstName: msg.from.first_name || '' },
                { upsert: true, new: true }
            );

            const payload = match[1];
            if (payload && payload.startsWith('file_')) {
                const fileId = payload.replace('file_', '');
                return bot.sendDocument(msg.chat.id, fileId, {
                    caption: "🎬 <b>आपकी अनलॉक की गई फ़ाइल!</b>\n\n⚠️ <i>यह फ़ाइल 10 मिनट में डिलीट हो जाएगी, इसे तुरंत Saved Messages में फॉरवर्ड कर लें।</i>",
                    parse_mode: 'HTML'
                });
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

    bot.onText(/\/stats/, async (msg) => {
        if (!isAdmin(msg.from.id)) return;
        try {
            const totalUsers = await User.countDocuments();
            const totalMovies = await Movie.countDocuments();
            const allMovies = await Movie.find();
            const totalFiles = allMovies.reduce((sum, m) => sum + (m.files ? m.files.length : 0), 0);

            bot.sendMessage(msg.chat.id, `📊 <b>लाइव स्टेटिस्टिक्स</b>\n\n👥 <b>कुल यूज़र्स:</b> ${totalUsers}\n🎬 <b>कुल मूवी कार्ड्स:</b> ${totalMovies}\n📂 <b>कुल फाइल्स:</b> ${totalFiles}`, { parse_mode: 'HTML' });
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
    });

    bot.onText(/\/broadcast (.+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        const textToSend = match[1];
        try {
            const users = await User.find();
            bot.sendMessage(msg.chat.id, `📢 ${users.length} यूज़र्स को ब्रॉडकास्ट भेजा जा रहा है...`);
            let success = 0;
            for (const u of users) {
                try {
                    await bot.sendMessage(u.userId, textToSend);
                    success++;
                    await new Promise(r => setTimeout(r, 40));
                } catch (err) {}
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
        if (!adminDeleteSessions[chatId]) adminDeleteSessions[chatId] = { selected: [], page: 1, searchQuery: '' };

        const session = adminDeleteSessions[chatId];

        if (data === 'noop') {
            return bot.answerCallbackQuery(query.id);
        } else if (data.startsWith('page_')) {
            const newPage = parseInt(data.replace('page_', ''));
            session.page = newPage;
            await renderDeletePanel(bot, chatId, messageId, newPage, session.searchQuery);
            await bot.answerCallbackQuery(query.id);
        } else if (data.startsWith('toggle_')) {
            const movieId = data.replace('toggle_', '');
            if (session.selected.includes(movieId)) {
                session.selected = session.selected.filter(id => id !== movieId);
            } else {
                session.selected.push(movieId);
            }
            await renderDeletePanel(bot, chatId, messageId, session.page, session.searchQuery);
            await bot.answerCallbackQuery(query.id);
        } else if (data === 'confirm_bulk_del') {
            if (session.selected.length === 0) {
                return bot.answerCallbackQuery(query.id, { text: "⚠️ कृपया पहले मूवी सेलेक्ट करें!", show_alert: true });
            }
            try {
                const result = await Movie.deleteMany({ _id: { $in: session.selected } });
                session.selected = [];
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
    });

    bot.onText(/\/rename (.+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        const parts = match[1].split('=');
        if (parts.length !== 2) return bot.sendMessage(msg.chat.id, "⚠️ तरीका: <code>/rename Purana = Naya</code>", { parse_mode: 'HTML' });

        try {
            const movie = await Movie.findOneAndUpdate(
                { title: new RegExp(`^${parts[0].trim()}$`, 'i') },
                { title: parts[1].trim() },
                { new: true }
            );
            if (movie) bot.sendMessage(msg.chat.id, `✅ नाम बदलकर <b>"${movie.title}"</b> कर दिया गया!`, { parse_mode: 'HTML' });
            else bot.sendMessage(msg.chat.id, `❌ मूवी नहीं मिली।`);
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
    });

    bot.on('photo', async (msg) => {
        if (!isAdmin(msg.from.id)) return;
        if (msg.caption && msg.caption.startsWith('/setposter')) {
            const movieName = msg.caption.replace('/setposter', '').trim();
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            try {
                const movie = await Movie.findOneAndUpdate(
                    { title: new RegExp(`^${movieName}$`, 'i') },
                    { thumbFileId: photoId },
                    { new: true }
                );
                if (movie) bot.sendMessage(msg.chat.id, `✅ <b>"${movie.title}"</b> का पोस्टर बदल दिया गया!`, { parse_mode: 'HTML' });
                else bot.sendMessage(msg.chat.id, `❌ मूवी नहीं मिली।`);
            } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
        }
    });

    bot.onText(/\/forcesub (on|off)/i, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        const status = match[1].toLowerCase() === 'on';
        try {
            await Config.findOneAndUpdate({ key: 'forcesub_enabled' }, { value: status }, { upsert: true });
            bot.sendMessage(msg.chat.id, `🔒 Force Sub: <b>${status ? 'चालू (ON)' : 'बंद (OFF)'}</b>`, { parse_mode: 'HTML' });
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
    });

    bot.onText(/\/setchannel (.+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        try {
            await Config.findOneAndUpdate({ key: 'forcesub_channel' }, { value: match[1].trim() }, { upsert: true });
            bot.sendMessage(msg.chat.id, `📢 चैनल सेट: <code>${match[1].trim()}</code>`, { parse_mode: 'HTML' });
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
    });

    bot.onText(/\/setgroup (.+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        try {
            await Config.findOneAndUpdate({ key: 'forcesub_group' }, { value: match[1].trim() }, { upsert: true });
            bot.sendMessage(msg.chat.id, `💬 ग्रुप सेट: <code>${match[1].trim()}</code>`, { parse_mode: 'HTML' });
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
    });

    bot.onText(/\/shortener (on|off)/i, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        const status = match[1].toLowerCase() === 'on';
        try {
            await Config.findOneAndUpdate({ key: 'shortener_enabled' }, { value: status }, { upsert: true });
            bot.sendMessage(msg.chat.id, `🔗 शॉर्टनर: <b>${status ? 'चालू (ON)' : 'बंद (OFF)'}</b>`, { parse_mode: 'HTML' });
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
    });

    bot.onText(/\/setshortener (.+)/, async (msg, match) => {
        if (!isAdmin(msg.from.id)) return;
        const input = match[1];
        const domainMatch = input.match(/domain=([^\s]+)/i);
        const apiMatch = input.match(/api=([^\s]+)/i);
        if (!domainMatch || !apiMatch) return bot.sendMessage(msg.chat.id, "⚠️ तरीका: <code>/setshortener domain=gplinks.in api=YOUR_API_KEY</code>", { parse_mode: 'HTML' });

        try {
            await Config.findOneAndUpdate({ key: 'shortener_domain' }, { value: domainMatch[1] }, { upsert: true });
            await Config.findOneAndUpdate({ key: 'shortener_api' }, { value: apiMatch[1] }, { upsert: true });
            bot.sendMessage(msg.chat.id, `✅ शॉर्टनर सेटिंग्स सेव हुईं!`, { parse_mode: 'HTML' });
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
    });

    // ऑटो अपलोड लिसनर
    bot.on('message', (msg) => {
        if (msg.text && msg.text.startsWith('/')) return;
        if (msg.photo && msg.caption && msg.caption.startsWith('/setposter')) return;

        const userId = msg.from ? msg.from.id.toString() : '';
        if (!isAdmin(userId)) return;

        const file = msg.video || msg.document;
        if (!file) return;

        uploadQueue = uploadQueue.then(async () => {
            let rawInput = msg.caption || file.file_name || '';
            const { cleanTitle, label, detectedCat, detectedYear } = parseMediaInfo(rawInput);

            const fileId = file.file_id;
            const fileType = msg.video ? 'video' : 'document';
            const fileSize = formatBytes(file.file_size);
            let thumbFileId = file.thumbnail ? file.thumbnail.file_id : null;

            try {
                const tmdbData = await fetchTMDBData(cleanTitle);
                const finalMovieTitle = tmdbData?.officialTitle || cleanTitle;
                const poster = tmdbData?.poster || `https://placehold.co/400x600/161b22/e50914?text=${encodeURIComponent(finalMovieTitle)}`;
                const rating = tmdbData?.rating || '8.0';
                const year = tmdbData?.year || detectedYear;

                let movie = await Movie.findOne({ 
                    $or: [
                        { title: new RegExp(`^${cleanTitle}$`, 'i') },
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
                    movie.updatedAt = new Date();
                    await movie.save();

                    await bot.sendMessage(
                        msg.chat.id,
                        `✅ <b>मौजूदा कार्ड में नया वर्ज़न जोड़ा गया!</b>\n\n🎬 <b>मूवी:</b> ${movie.title}\n📦 <b>क्वालिटी:</b> ${finalLabel}\n📂 <b>कुल फाइल्स:</b> ${movie.files.length}`,
                        { parse_mode: 'HTML' }
                    );
                } else {
                    movie = new Movie({
                        title: finalMovieTitle,
                        poster,
                        rating,
                        year,
                        category: detectedCat,
                        thumbFileId,
                        files: [{ label: finalLabel, fileId, fileType, fileSize }]
                    });
                    await movie.save();

                    await bot.sendMessage(
                        msg.chat.id,
                        `✅ <b>नया मूवी कार्ड बना!</b>\n\n🎬 <b>मूवी:</b> ${finalMovieTitle}\n📦 <b>क्वालिटी:</b> ${finalLabel}\n⭐ <b>रेटिंग:</b> ${rating}\n📅 <b>साल:</b> ${year}`,
                        { parse_mode: 'HTML' }
                    );
                }
            } catch (err) {
                await bot.sendMessage(msg.chat.id, "❌ एरर: " + err.message);
            }
        });
    });
};
