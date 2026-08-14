const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_ID = process.env.ADMIN_ID;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.use(cors());
app.use(express.json());

// ----------------- MONGODB SCHEMAS -----------------
const userSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    username: String,
    firstName: String,
    joinedAt: { type: Date, default: Date.now }
});

const fileItemSchema = new mongoose.Schema({
    label: String,
    fileId: String,
    fileType: String,
    fileSize: String,
    addedAt: { type: Date, default: Date.now }
});

const movieSchema = new mongoose.Schema({
    title: { type: String, required: true, index: true },
    thumbFileId: String,
    files: [fileItemSchema],
    updatedAt: { type: Date, default: Date.now }
});

const configSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    value: mongoose.Schema.Types.Mixed
});

const User = mongoose.model('User', userSchema);
const Movie = mongoose.model('Movie', movieSchema);
const Config = mongoose.model('Config', configSchema);

async function ensureDbConnected() {
    if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(MONGO_URI);
    }
}

function isAdmin(userId) {
    const adminList = ADMIN_ID ? ADMIN_ID.split(',').map(id => id.trim()) : [];
    return adminList.includes(userId.toString());
}

// ----------------- AUTO REGISTER COMMANDS IN TELEGRAM MENU -----------------
bot.setMyCommands([
    { command: 'start', description: 'Open Movie Store' },
    { command: 'stats', description: 'View bot statistics (Admin)' },
    { command: 'manage', description: 'Multi-Select Delete movies (Admin)' },
    { command: 'forcesub', description: 'Enable/Disable Join Lock (Admin)' },
    { command: 'setchannel', description: 'Set Channel for Join Lock (Admin)' },
    { command: 'setgroup', description: 'Set Group for Join Lock (Admin)' },
    { command: 'shortener', description: 'Enable/Disable Shortener (Admin)' },
    { command: 'setshortener', description: 'Set Shortener Domain & API (Admin)' },
    { command: 'broadcast', description: 'Send message to all users (Admin)' }
]).catch(err => console.error("Commands register warning:", err.message));

// ----------------- SUPER SMART CLEANER & PARSER -----------------
function parseMediaInfo(rawText) {
    if (!rawText) return { cleanTitle: 'Movie ' + new Date().toLocaleDateString('en-GB'), label: 'Standard' };

    let text = rawText.split('\n')[0];

    // 1. Detect Quality
    let qualityMatch = text.match(/(480p|720p|1080p|2160p|4k|hd|sd)/i);
    let quality = qualityMatch ? qualityMatch[0].toUpperCase() : '';

    // 2. Detect Codec / Audio Details
    let codecMatch = text.match(/(hevc|x265|h\s*265|x264|h\s*264|10bit|hdr|ddp\s*5\s*1|5\s*1|2\s*0)/i);
    let codecInfo = codecMatch ? codecMatch[0].replace(/\s+/g, '').toUpperCase() : '';

    // 3. Detect Episode / Season
    let epMatch = text.match(/(s\d+\s*e\d+|season\s*\d+|ep\s*\d+|episode\s*\d+|e\d+)/i);
    let episode = epMatch ? epMatch[0].toUpperCase() : '';

    // Build Label
    let labelParts = [];
    if (episode) labelParts.push(episode);
    if (quality) labelParts.push(quality);
    if (codecInfo && !labelParts.includes(codecInfo)) labelParts.push(codecInfo);
    let label = labelParts.length > 0 ? labelParts.join(' - ') : 'Standard Quality';

    // 4. Aggressive Clean for Main Card Title
    let clean = text
        .replace(/\[.*?\]/g, ' ')
        .replace(/\(.*?\)/g, ' ')
        .replace(/(https?:\/\/[^\s]+|t\.me\/[^\s]+|www\.[^\s]+|@\w+|\.(mp4|mkv|avi|mov|zip|rar))/gi, ' ')
        .replace(/(480p|720p|1080p|2160p|4k|webdl|web-dl|webrip|bluray|hdrip|dvdrip|predvd|hdtc)/gi, ' ')
        .replace(/(x264|x265|hevc|h\s*264|h\s*265|avc|10bit|hdr|dv|aac2\s*0|aac|esub|sub|combined|amzn|ddp5\s*1|ddp\s*2\s*0|ddp|dd\+|hindi|english|telugu|tamil|korean|dubbed|multi|paramount|official|hd|full)/gi, ' ')
        .replace(/\b(2\s*0|5\s*1|7\s*1)\b/gi, ' ')
        .replace(/[^\w\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (clean.length < 2) clean = 'Movie ' + new Date().toLocaleDateString('en-GB');
    clean = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    return { cleanTitle: clean, label };
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

async function checkMemberStatus(chatIdentifier, userId) {
    if (!chatIdentifier) return true;
    try {
        const member = await bot.getChatMember(chatIdentifier, userId);
        return ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
    } catch (e) {
        return true;
    }
}

// ----------------- MULTI-SELECT BULK DELETE SYSTEM -----------------
const adminDeleteSessions = {};

async function renderDeletePanel(chatId, messageId = null, selectedIds = []) {
    await ensureDbConnected();
    const movies = await Movie.find().sort({ updatedAt: -1 }).limit(10);
    
    if (movies.length === 0) {
        if (messageId) return bot.editMessageText("डेटाबेस में कोई मूवी नहीं है।", { chat_id: chatId, message_id: messageId });
        return bot.sendMessage(chatId, "डेटाबेस में कोई मूवी नहीं है।");
    }

    let inline_keyboard = movies.map(m => {
        const isSelected = selectedIds.includes(m._id.toString());
        return [{
            text: `${isSelected ? '✅' : '⬜'} ${m.title} (${m.files ? m.files.length : 1})`,
            callback_data: `toggle_${m._id}`
        }];
    });

    inline_keyboard.push([
        { text: `🗑️ Delete Selected (${selectedIds.length})`, callback_data: `confirm_bulk_del` },
        { text: `❌ Cancel`, callback_data: `cancel_del` }
    ]);

    const text = `⚙️ *मल्टी-सेलेक्ट डिलीट पैनल*\n\nजिन मूवीज़ को हटाना है उन पर क्लिक करें (✅ टिक लगेगा), फिर नीचे *Delete Selected* दबाएं:`;

    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
    } else {
        const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
        adminDeleteSessions[chatId] = { messageId: sent.message_id, selected: [] };
    }
}

// ----------------- ADMIN COMMANDS -----------------
bot.onText(/\/start/, async (msg) => {
    try {
        await ensureDbConnected();
        await User.findOneAndUpdate(
            { userId: msg.from.id.toString() },
            { userId: msg.from.id.toString(), username: msg.from.username || '', firstName: msg.from.first_name || '' },
            { upsert: true, new: true }
        );
        bot.sendMessage(msg.chat.id, `👋 नमस्ते ${msg.from.first_name || 'दोस्त'}!\n\n🍿 हमारी Movie WebApp खोलने के लिए नीचे दिए गए बटन पर क्लिक करें।`);
    } catch (e) {}
});

bot.onText(/\/stats/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    try {
        await ensureDbConnected();
        const totalUsers = await User.countDocuments();
        const totalMovies = await Movie.countDocuments();
        const allMovies = await Movie.find();
        const totalFiles = allMovies.reduce((sum, m) => sum + (m.files ? m.files.length : 0), 0);

        bot.sendMessage(msg.chat.id, `📊 *लाइव स्टेटिस्टिक्स*\n\n👥 *कुल यूज़र्स:* ${totalUsers}\n🎬 *कुल मूवी कार्ड्स:* ${totalMovies}\n📂 *कुल फाइल्स:* ${totalFiles}`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const textToSend = match[1];
    try {
        await ensureDbConnected();
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

bot.onText(/\/manage|\/delete/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    adminDeleteSessions[msg.chat.id] = { selected: [] };
    await renderDeletePanel(msg.chat.id);
});

bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: "❌ एक्सेस डिनाइड!", show_alert: true });
    if (!adminDeleteSessions[chatId]) adminDeleteSessions[chatId] = { selected: [] };

    if (data.startsWith('toggle_')) {
        const movieId = data.replace('toggle_', '');
        let list = adminDeleteSessions[chatId].selected;
        if (list.includes(movieId)) list = list.filter(id => id !== movieId);
        else list.push(movieId);
        adminDeleteSessions[chatId].selected = list;
        await renderDeletePanel(chatId, messageId, list);
        await bot.answerCallbackQuery(query.id);
    } else if (data === 'confirm_bulk_del') {
        const list = adminDeleteSessions[chatId].selected;
        if (list.length === 0) return bot.answerCallbackQuery(query.id, { text: "⚠️ कृपया पहले मूवी सेलेक्ट करें!", show_alert: true });

        try {
            await ensureDbConnected();
            const result = await Movie.deleteMany({ _id: { $in: list } });
            adminDeleteSessions[chatId].selected = [];
            await bot.answerCallbackQuery(query.id, { text: `✅ ${result.deletedCount} मूवीज़ डिलीट!` });
            await bot.editMessageText(`🗑️ *सफलता:* कुल **${result.deletedCount}** मूवीज़ डेटाबेस और ऐप से हटा दी गई हैं।`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        } catch (err) { bot.answerCallbackQuery(query.id, { text: "एरर: " + err.message }); }
    } else if (data === 'cancel_del') {
        delete adminDeleteSessions[chatId];
        await bot.editMessageText("❌ डिलीट ऑपरेशन रद्द (Cancelled)।", { chat_id: chatId, message_id: messageId });
        await bot.answerCallbackQuery(query.id);
    }
});

bot.onText(/\/rename (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const parts = match[1].split('=');
    if (parts.length !== 2) return bot.sendMessage(msg.chat.id, "⚠️ तरीका: `/rename Purana = Naya`", { parse_mode: 'Markdown' });

    try {
        await ensureDbConnected();
        const movie = await Movie.findOneAndUpdate(
            { title: new RegExp(`^${parts[0].trim()}$`, 'i') },
            { title: parts[1].trim() },
            { new: true }
        );
        if (movie) bot.sendMessage(msg.chat.id, `✅ नाम बदलकर *"${movie.title}"* कर दिया गया!`, { parse_mode: 'Markdown' });
        else bot.sendMessage(msg.chat.id, `❌ मूवी नहीं मिली।`);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.on('photo', async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    if (msg.caption && msg.caption.startsWith('/setposter')) {
        const movieName = msg.caption.replace('/setposter', '').trim();
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        try {
            await ensureDbConnected();
            const movie = await Movie.findOneAndUpdate(
                { title: new RegExp(`^${movieName}$`, 'i') },
                { thumbFileId: photoId },
                { new: true }
            );
            if (movie) bot.sendMessage(msg.chat.id, `✅ *"${movie.title}"* का पोस्टर बदल दिया गया!`, { parse_mode: 'Markdown' });
            else bot.sendMessage(msg.chat.id, `❌ मूवी नहीं मिली।`);
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
    }
});

bot.onText(/\/forcesub (on|off)/i, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const status = match[1].toLowerCase() === 'on';
    try {
        await ensureDbConnected();
        await Config.findOneAndUpdate({ key: 'forcesub_enabled' }, { value: status }, { upsert: true });
        bot.sendMessage(msg.chat.id, `🔒 Force Sub: *${status ? 'चालू (ON)' : 'बंद (OFF)'}*`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setchannel (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    try {
        await ensureDbConnected();
        await Config.findOneAndUpdate({ key: 'forcesub_channel' }, { value: match[1].trim() }, { upsert: true });
        bot.sendMessage(msg.chat.id, `📢 चैनल सेट: \`${match[1].trim()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setgroup (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    try {
        await ensureDbConnected();
        await Config.findOneAndUpdate({ key: 'forcesub_group' }, { value: match[1].trim() }, { upsert: true });
        bot.sendMessage(msg.chat.id, `💬 ग्रुप सेट: \`${match[1].trim()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/shortener (on|off)/i, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const status = match[1].toLowerCase() === 'on';
    try {
        await ensureDbConnected();
        await Config.findOneAndUpdate({ key: 'shortener_enabled' }, { value: status }, { upsert: true });
        bot.sendMessage(msg.chat.id, `🔗 शॉर्टनर: *${status ? 'चालू (ON)' : 'बंद (OFF)'}*`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setshortener (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const input = match[1];
    const domainMatch = input.match(/domain=([^\s]+)/i);
    const apiMatch = input.match(/api=([^\s]+)/i);
    if (!domainMatch || !apiMatch) return bot.sendMessage(msg.chat.id, "⚠️ तरीका: `/setshortener domain=gplinks.in api=YOUR_API_KEY`", { parse_mode: 'Markdown' });

    try {
        await ensureDbConnected();
        await Config.findOneAndUpdate({ key: 'shortener_domain' }, { value: domainMatch[1] }, { upsert: true });
        await Config.findOneAndUpdate({ key: 'shortener_api' }, { value: apiMatch[1] }, { upsert: true });
        bot.sendMessage(msg.chat.id, `✅ शॉर्टनर सेटिंग्स सेव हुईं!\n\n🌐 डोमेन: \`${domainMatch[1]}\`\n🔑 API: \`${apiMatch[1]}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

// ----------------- BOT UPLOAD LISTENER -----------------
bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    if (msg.photo && msg.caption && msg.caption.startsWith('/setposter')) return;

    const userId = msg.from ? msg.from.id.toString() : '';
    if (!isAdmin(userId)) return;

    const file = msg.video || msg.document;
    if (!file) return;

    let rawInput = msg.caption || file.file_name || '';
    const { cleanTitle, label } = parseMediaInfo(rawInput);

    const fileId = file.file_id;
    const fileType = msg.video ? 'video' : 'document';
    const fileSize = formatBytes(file.file_size);
    let thumbFileId = file.thumbnail ? file.thumbnail.file_id : null;

    try {
        await ensureDbConnected();

        let movie = await Movie.findOne({ title: new RegExp(`^${cleanTitle}$`, 'i') });
        let finalLabel = label;
        if (fileSize) finalLabel += ` (${fileSize})`;

        if (movie) {
            const countSameLabel = movie.files.filter(f => f.label.startsWith(label)).length;
            if (countSameLabel > 0) finalLabel += ` [Option ${countSameLabel + 1}]`;

            movie.files.push({ label: finalLabel, fileId, fileType, fileSize });
            if (thumbFileId && !movie.thumbFileId) movie.thumbFileId = thumbFileId;
            movie.updatedAt = new Date();
            await movie.save();

            await bot.sendMessage(msg.chat.id, `✅ *मौजूदा कार्ड में नया वर्ज़न जोड़ा गया!*\n\n🎬 *मूवी:* ${movie.title}\n📦 *क्वालिटी:* ${finalLabel}\n📂 *कुल फाइल्स:* ${movie.files.length}`, { parse_mode: 'Markdown' });
        } else {
            movie = new Movie({
                title: cleanTitle,
                thumbFileId,
                files: [{ label: finalLabel, fileId, fileType, fileSize }]
            });
            await movie.save();

            await bot.sendMessage(msg.chat.id, `✅ *नया मूवी कार्ड बना!* \n\n🎬 *मूवी:* ${cleanTitle}\n📦 *क्वालिटी:* ${finalLabel}`, { parse_mode: 'Markdown' });
        }
    } catch (err) {
        await bot.sendMessage(msg.chat.id, "❌ एरर: " + err.message);
    }
});

// ----------------- API ENDPOINTS -----------------
app.get('/api/movies', async (req, res) => {
    try {
        await ensureDbConnected();
        const movies = await Movie.find().sort({ updatedAt: -1 });
        res.json(movies);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/thumb/:fileId', async (req, res) => {
    try {
        const fileLink = await bot.getFileLink(req.params.fileId);
        res.redirect(fileLink);
    } catch (err) { res.status(404).send('Not Found'); }
});

app.post('/api/send-file', async (req, res) => {
    const { fileId, fileType, movieTitle, label, chatId } = req.body;
    try {
        await ensureDbConnected();

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

        const shortConfig = await Config.findOne({ key: 'shortener_enabled' });
        if (shortConfig && shortConfig.value === true) {
            const domainCfg = await Config.findOne({ key: 'shortener_domain' });
            const apiCfg = await Config.findOne({ key: 'shortener_api' });

            if (domainCfg && apiCfg) {
                const targetUrl = `https://t.me/${(await bot.getMe()).username}?start=file_${fileId}`;
                const apiRes = await axios.get(`https://${domainCfg.value}/api?api=${apiCfg.value}&url=${encodeURIComponent(targetUrl)}`);
                if (apiRes.data && apiRes.data.shortenedUrl) {
                    await bot.sendMessage(chatId, `🔐 *आपकी डाउनलोड लिंक तैयार है:*\n\n[यहाँ क्लिक करके अनलॉक करें](${apiRes.data.shortenedUrl})`, { parse_mode: 'Markdown' });
                    return res.json({ success: true, short: true });
                }
            }
        }

        const captionText = `🎬 *${movieTitle}*\n📌 *क्वालिटी:* ${label}\n\n⚠️ *नोट:* यह फ़ाइल **10 मिनट** में डिलीट हो जाएगी। इसे तुरंत *Saved Messages* में फॉरवर्ड कर लें!`;

        let sentMsg = fileType === 'video' 
            ? await bot.sendVideo(chatId, fileId, { caption: captionText, parse_mode: 'Markdown' })
            : await bot.sendDocument(chatId, fileId, { caption: captionText, parse_mode: 'Markdown' });

        res.json({ success: true });
        setTimeout(() => bot.deleteMessage(chatId, sentMsg.message_id).catch(() => {}), 10 * 60 * 1000);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
