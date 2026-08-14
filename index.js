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
    referredBy: { type: String, default: null },
    referralsCount: { type: Number, default: 0 },
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
    cleanKey: { type: String, index: true },
    thumbFileId: String,
    files: [fileItemSchema],
    updatedAt: { type: Date, default: Date.now }
});

const requestSchema = new mongoose.Schema({
    userId: String,
    username: String,
    movieName: String,
    status: { type: String, default: 'Pending' },
    requestedAt: { type: Date, default: Date.now }
});

const configSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    value: mongoose.Schema.Types.Mixed
});

const User = mongoose.model('User', userSchema);
const Movie = mongoose.model('Movie', movieSchema);
const MovieRequest = mongoose.model('MovieRequest', requestSchema);
const Config = mongoose.model('Config', configSchema);

bot.on('polling_error', (error) => {
    console.log('[Telegram Polling Error]:', error.message || error);
});

process.on('unhandledRejection', (reason) => {
    console.log('[Unhandled Rejection]:', reason);
});

// 🔒 STRICT ADMIN CHECK
function isAdmin(userId) {
    if (!userId) return false;
    const adminList = ADMIN_ID ? ADMIN_ID.split(',').map(id => id.trim()) : [];
    return adminList.includes(userId.toString());
}

// ----------------- 100% SINGLE CARD TITLE CLEANER -----------------
function parseMediaInfo(rawText) {
    if (!rawText) return { cleanTitle: 'Movie ' + new Date().toLocaleDateString('en-GB'), cleanKey: 'movie', label: 'Standard' };

    let text = rawText.split('\n')[0];

    let qualityMatch = text.match(/(2160p|1080p|720p|540p|480p|360p|4k|hd|sd)/i);
    let quality = qualityMatch ? qualityMatch[0].toUpperCase() : '';

    let codecMatch = text.match(/(hevc|x265|h[\s\._-]*265|x264|h[\s\._-]*264|10bit|hdr|ddp[\s\._-]*5[\s\._-]*1|5[\s\._-]*1|2[\s\._-]*0)/i);
    let codecInfo = codecMatch ? codecMatch[0].replace(/[\s\._-]+/g, '').toUpperCase() : '';

    let epMatch = text.match(/(s\d+\s*e\d+|season\s*\d+|ep\s*\d+|episode\s*\d+|e\d+)/i);
    let episode = epMatch ? epMatch[0].toUpperCase() : '';

    let labelParts = [];
    if (episode) labelParts.push(episode);
    if (quality) labelParts.push(quality);
    if (codecInfo && !labelParts.includes(codecInfo)) labelParts.push(codecInfo);
    let label = labelParts.length > 0 ? labelParts.join(' - ') : 'Standard Quality';

    let clean = text
        .replace(/\[.*?\]/g, ' ')
        .replace(/\(.*?\)/g, ' ')
        .replace(/(https?:\/\/[^\s]+|t\.me\/[^\s]+|www\.[^\s]+|@\w+)/gi, ' ')
        .replace(/\.(mp4|mkv|avi|mov|zip|rar)/gi, ' ')
        .replace(/(2160p|1080p|720p|540p|480p|360p|4k|webdl|web-dl|webrip|bluray|hdrip|dvdrip|predvd|hdtc|esub|subs?|subtitles?)/gi, ' ')
        .replace(/(x264|x265|hevc|h[\s\._-]*264|h[\s\._-]*265|avc|10bit|hdr|dv|aac2[\s\._-]*0|aac|amzn|ddp5[\s\._-]*1|ddp2[\s\._-]*0|ddp|dd\+|hindi|english|telugu|tamil|korean|dubbed|multi|official|hd|full|mkv)/gi, ' ')
        .replace(/\b(nf|netflix|amzn|prime|hotstar|hs|zee5|sonyliv|jiocinema|jio|mx|paramount|hulu|disney|apple|aha)\b/gi, ' ')
        .replace(/\b(2[\s\._-]*0|5[\s\._-]*1|7[\s\._-]*1)\b/gi, ' ')
        .replace(/\b265\b|\b264\b/gi, ' ')
        .replace(/\b[a-zA-Z]\b/g, ' ')
        .replace(/[^\w\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (clean.length < 2) clean = 'Movie ' + new Date().toLocaleDateString('en-GB');
    clean = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    let cleanKey = clean.toLowerCase().replace(/\s+/g, '');

    return { cleanTitle: clean, cleanKey, label };
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
    } catch (e) { return true; }
}

// ----------------- PAGINATED & SEARCH DELETE PANEL -----------------
const adminDeleteSessions = {};
const PAGE_LIMIT = 8;

async function renderDeletePanel(chatId, messageId = null, page = 1, searchQuery = '') {
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

    let text = `⚙️ *मल्टी-सेलेक्ट डिलीट पैनल*\n`;
    if (searchQuery) text += `🔍 *सर्च फ़िल्टर:* \`${searchQuery}\`\n`;
    text += `📊 *कुल मूवीज़:* ${totalMovies} (Page ${page}/${totalPages})\n\nमूवीज़ पर क्लिक करके टिक (✅) लगाएं, फिर नीचे *Delete Selected* दबाएं:`;

    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
    } else {
        const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
        adminDeleteSessions[chatId].messageId = sent.message_id;
    }
}

// ----------------- PUBLIC COMMANDS (FOR ALL USERS) -----------------
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const userId = msg.from.id.toString();
    const param = match[1] ? match[1].trim() : '';

    try {
        let user = await User.findOne({ userId });

        if (!user) {
            let referrerId = null;
            if (param && param.startsWith('ref_')) {
                const potentialRef = param.replace('ref_', '');
                if (potentialRef !== userId) {
                    referrerId = potentialRef;
                    await User.findOneAndUpdate({ userId: referrerId }, { $inc: { referralsCount: 1 } });
                    bot.sendMessage(referrerId, `🎉 *बधाई हो!* आपके इनवाइट लिंक से एक नया यूज़र जुड़ा है! (+1 Refer Point)`, { parse_mode: 'Markdown' }).catch(() => {});
                }
            }

            user = new User({
                userId,
                username: msg.from.username || '',
                firstName: msg.from.first_name || '',
                referredBy: referrerId
            });
            await user.save();
        }

        bot.sendMessage(msg.chat.id, `👋 नमस्ते ${msg.from.first_name || 'दोस्त'}!\n\n🍿 हमारी Movie WebApp खोलने के लिए नीचे दिए गए बटन पर क्लिक करें।\n\n📌 *मूवी माँगने के लिए:* \`/request Movie Name\`\n🎁 *अपना रेफरल लिंक देखने के लिए:* \`/refer\``, { parse_mode: 'Markdown' });
    } catch (e) {}
});

bot.onText(/\/refer/, async (msg) => {
    const userId = msg.from.id.toString();
    try {
        const me = await bot.getMe();
        const user = await User.findOne({ userId });
        const refCount = user ? (user.referralsCount || 0) : 0;
        const refLink = `https://t.me/${me.username}?start=ref_${userId}`;

        bot.sendMessage(msg.chat.id, `🎁 *आपका रेफरल डैशबोर्ड*\n\n👥 *कुल रेफरल्स:* ${refCount} लोग\n🔗 *आपका इनवाइट लिंक:*\n\`${refLink}\`\n\n*(इस लिंक को अपने दोस्तों और ग्रुप्स में शेयर करें!)*`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/request (.+)/, async (msg, match) => {
    const movieReqName = match[1].trim();
    const userId = msg.from.id.toString();
    const username = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'User');

    try {
        const newReq = new MovieRequest({ userId, username, movieName: movieReqName });
        await newReq.save();

        bot.sendMessage(msg.chat.id, `✅ आपकी रिक्वेस्ट *"${movieReqName}"* एडमिन को भेज दी गई है! जैसे ही मूवी अपलोड होगी, आपको मैसेज मिल जाएगा।`, { parse_mode: 'Markdown' });

        const adminList = ADMIN_ID ? ADMIN_ID.split(',').map(id => id.trim()) : [];
        for (const admin of adminList) {
            bot.sendMessage(admin, `📩 *New Movie Request!*\n\n🎬 *मूवी:* ${movieReqName}\n👤 *यूज़र:* ${username} (\`${userId}\`)`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Notify Uploaded', callback_data: `req_done_${newReq._id}` },
                        { text: '❌ Reject', callback_data: `req_rej_${newReq._id}` }
                    ]]
                }
            }).catch(() => {});
        }
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

// ----------------- STRICT ADMIN COMMANDS ONLY -----------------
bot.onText(/\/topref/, async (msg) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    try {
        const topUsers = await User.find({ referralsCount: { $gt: 0 } }).sort({ referralsCount: -1 }).limit(10);
        if (topUsers.length === 0) return bot.sendMessage(msg.chat.id, "📊 अभी तक किसी यूज़र ने रेफर नहीं किया है।");

        let text = `🏆 *टॉप 10 रेफरल लीडरबोर्ड:*\n\n`;
        topUsers.forEach((u, i) => {
            text += `${i + 1}. ${u.firstName || 'User'} (${u.username ? '@' + u.username : u.userId}) — *${u.referralsCount} Referrals*\n`;
        });

        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setbtn_group (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    try {
        await Config.findOneAndUpdate({ key: 'btn_group_link' }, { value: match[1].trim() }, { upsert: true });
        bot.sendMessage(msg.chat.id, `✅ *Discussion Button लिंक सेट:* \`${match[1].trim()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setbtn_backup (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    try {
        await Config.findOneAndUpdate({ key: 'btn_backup_link' }, { value: match[1].trim() }, { upsert: true });
        bot.sendMessage(msg.chat.id, `✅ *Backup Button लिंक सेट:* \`${match[1].trim()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setbtn_premium (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    try {
        await Config.findOneAndUpdate({ key: 'btn_premium_link' }, { value: match[1].trim() }, { upsert: true });
        bot.sendMessage(msg.chat.id, `✅ *Premium Button लिंक सेट:* \`${match[1].trim()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setpowered (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    const newText = match[1].trim();
    const finalTag = newText.toLowerCase().startsWith('powered by') ? newText : `Powered by ${newText}`;
    try {
        await Config.findOneAndUpdate({ key: 'powered_by_text' }, { value: finalTag }, { upsert: true });
        bot.sendMessage(msg.chat.id, `✅ *Powered By टेक्स्ट सेट:* \`${finalTag}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setcaptionlink (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    try {
        await Config.findOneAndUpdate({ key: 'caption_channel_link' }, { value: match[1].trim() }, { upsert: true });
        bot.sendMessage(msg.chat.id, `✅ *मूवी हाइपरलिंक चैनल सेट:* \`${match[1].trim()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setinvitelink (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    try {
        await Config.findOneAndUpdate({ key: 'caption_invite_link' }, { value: match[1].trim() }, { upsert: true });
        bot.sendMessage(msg.chat.id, `✅ *Invite Line लिंक सेट:* \`${match[1].trim()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/adgram (on|off)/i, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    const status = match[1].toLowerCase() === 'on';
    try {
        await Config.findOneAndUpdate({ key: 'adgram_enabled' }, { value: status }, { upsert: true });
        bot.sendMessage(msg.chat.id, `📺 AdGram Video Ads: *${status ? 'चालू (ON)' : 'बंद (OFF)'}*`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setadgram (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    try {
        await Config.findOneAndUpdate({ key: 'adgram_block_id' }, { value: match[1].trim() }, { upsert: true });
        bot.sendMessage(msg.chat.id, `✅ AdGram Block ID सेट: \`${match[1].trim()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/shortener (on|off)/i, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    const status = match[1].toLowerCase() === 'on';
    try {
        await Config.findOneAndUpdate({ key: 'shortener_enabled' }, { value: status }, { upsert: true });
        bot.sendMessage(msg.chat.id, `🔗 शॉर्टनर: *${status ? 'चालू (ON)' : 'बंद (OFF)'}*`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setshortener (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    const input = match[1];
    const domainMatch = input.match(/domain=([^\s]+)/i);
    const apiMatch = input.match(/api=([^\s]+)/i);
    if (!domainMatch || !apiMatch) return bot.sendMessage(msg.chat.id, "⚠️ तरीका: `/setshortener domain=gplinks.in api=YOUR_API_KEY`", { parse_mode: 'Markdown' });

    try {
        await Config.findOneAndUpdate({ key: 'shortener_domain' }, { value: domainMatch[1] }, { upsert: true });
        await Config.findOneAndUpdate({ key: 'shortener_api' }, { value: apiMatch[1] }, { upsert: true });
        bot.sendMessage(msg.chat.id, `✅ शॉर्टनर सेटिंग्स सेव हुईं!`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/forcesub (on|off)/i, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    const status = match[1].toLowerCase() === 'on';
    try {
        await Config.findOneAndUpdate({ key: 'forcesub_enabled' }, { value: status }, { upsert: true });
        bot.sendMessage(msg.chat.id, `🔒 Force Sub: *${status ? 'चालू (ON)' : 'बंद (OFF)'}*`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setchannel (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    try {
        await Config.findOneAndUpdate({ key: 'forcesub_channel' }, { value: match[1].trim() }, { upsert: true });
        bot.sendMessage(msg.chat.id, `📢 चैनल सेट: \`${match[1].trim()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/setgroup (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    try {
        await Config.findOneAndUpdate({ key: 'forcesub_group' }, { value: match[1].trim() }, { upsert: true });
        bot.sendMessage(msg.chat.id, `💬 ग्रुप सेट: \`${match[1].trim()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/stats/, async (msg) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    try {
        const totalUsers = await User.countDocuments();
        const totalMovies = await Movie.countDocuments();
        const allMovies = await Movie.find();
        const totalFiles = allMovies.reduce((sum, m) => sum + (m.files ? m.files.length : 0), 0);
        bot.sendMessage(msg.chat.id, `📊 *लाइव स्टेटिस्टिक्स*\n\n👥 *कुल यूज़र्स:* ${totalUsers}\n🎬 *कुल मूवी कार्ड्स:* ${totalMovies}\n📂 *कुल फाइल्स:* ${totalFiles}`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ एरर: " + e.message); }
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
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
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    const searchQuery = match[2] ? match[2].trim() : '';
    adminDeleteSessions[msg.chat.id] = { selected: [], page: 1, searchQuery };
    await renderDeletePanel(msg.chat.id, null, 1, searchQuery);
});

bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (data.startsWith('req_done_')) {
        if (!isAdmin(userId)) return;
        const reqId = data.replace('req_done_', '');
        const reqDoc = await MovieRequest.findById(reqId);
        if (reqDoc) {
            reqDoc.status = 'Uploaded';
            await reqDoc.save();
            bot.sendMessage(reqDoc.userId, `🎉 *आपकी रिक्वेस्ट पूरी हो गई!*\n\nमूवी *"${reqDoc.movieName}"* अब Movie Zone Mini App पर उपलब्ध है! अभी जाकर डाउनलोड करें। 🍿`, { parse_mode: 'Markdown' }).catch(() => {});
            bot.editMessageText(`✅ *Uploaded & Notified:*\n🎬 ${reqDoc.movieName} for ${reqDoc.username}`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        }
        return bot.answerCallbackQuery(query.id);
    } else if (data.startsWith('req_rej_')) {
        if (!isAdmin(userId)) return;
        const reqId = data.replace('req_rej_', '');
        await MovieRequest.findByIdAndDelete(reqId);
        bot.editMessageText(`❌ *Request Rejected!*`, { chat_id: chatId, message_id: messageId });
        return bot.answerCallbackQuery(query.id);
    }

    if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: "❌ एक्सेस डिनाइड!", show_alert: true });
    if (!adminDeleteSessions[chatId]) adminDeleteSessions[chatId] = { selected: [], page: 1, searchQuery: '' };

    const session = adminDeleteSessions[chatId];

    if (data === 'noop') {
        return bot.answerCallbackQuery(query.id);
    } else if (data.startsWith('page_')) {
        const newPage = parseInt(data.replace('page_', ''));
        session.page = newPage;
        await renderDeletePanel(chatId, messageId, newPage, session.searchQuery);
        await bot.answerCallbackQuery(query.id);
    } else if (data.startsWith('toggle_')) {
        const movieId = data.replace('toggle_', '');
        if (session.selected.includes(movieId)) {
            session.selected = session.selected.filter(id => id !== movieId);
        } else {
            session.selected.push(movieId);
        }
        await renderDeletePanel(chatId, messageId, session.page, session.searchQuery);
        await bot.answerCallbackQuery(query.id);
    } else if (data === 'confirm_bulk_del') {
        if (session.selected.length === 0) {
            return bot.answerCallbackQuery(query.id, { text: "⚠️ कृपया पहले मूवी सेलेक्ट करें!", show_alert: true });
        }
        try {
            const result = await Movie.deleteMany({ _id: { $in: session.selected } });
            session.selected = [];
            await bot.answerCallbackQuery(query.id, { text: `✅ ${result.deletedCount} मूवीज़ डिलीट!` });
            await bot.editMessageText(`🗑️ *सफलता:* कुल **${result.deletedCount}** मूवीज़ हटा दी गईं।`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
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
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Access Denied! Admin Only.");
    const parts = match[1].split('=');
    if (parts.length !== 2) return bot.sendMessage(msg.chat.id, "⚠️ तरीका: `/rename Purana = Naya`", { parse_mode: 'Markdown' });

    try {
        const movie = await Movie.findOneAndUpdate(
            { title: new RegExp(`^${parts[0].trim()}$`, 'i') },
            { title: parts[1].trim(), cleanKey: parts[1].trim().toLowerCase().replace(/\s+/g, '') },
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

// ----------------- QUEUED BOT UPLOAD LISTENER (1-CARD STRICT MERGE) -----------------
let uploadQueue = Promise.resolve();

bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    if (msg.photo && msg.caption && msg.caption.startsWith('/setposter')) return;

    const userId = msg.from ? msg.from.id.toString() : '';
    if (!isAdmin(userId)) return;

    const file = msg.video || msg.document;
    if (!file) return;

    uploadQueue = uploadQueue.then(async () => {
        let rawInput = msg.caption || file.file_name || '';
        const { cleanTitle, cleanKey, label } = parseMediaInfo(rawInput);

        const fileId = file.file_id;
        const fileType = msg.video ? 'video' : 'document';
        const fileSize = formatBytes(file.file_size);
        let thumbFileId = file.thumbnail ? file.thumbnail.file_id : null;

        try {
            let movie = await Movie.findOne({
                $or: [
                    { cleanKey: cleanKey },
                    { title: new RegExp(`^${cleanTitle}$`, 'i') }
                ]
            });

            let finalLabel = label;
            if (fileSize) finalLabel += ` (${fileSize})`;

            if (movie) {
                const countSameLabel = movie.files.filter(f => f.label.startsWith(label)).length;
                if (countSameLabel > 0) finalLabel += ` [Option ${countSameLabel + 1}]`;

                movie.files.push({ label: finalLabel, fileId, fileType, fileSize });
                if (thumbFileId && !movie.thumbFileId) movie.thumbFileId = thumbFileId;
                movie.cleanKey = cleanKey;
                movie.updatedAt = new Date();
                await movie.save();

                await bot.sendMessage(msg.chat.id, `✅ *मौजूदा कार्ड में नया वर्ज़न जोड़ा गया!*\n\n🎬 *मूवी:* ${movie.title}\n📦 *क्वालिटी:* ${finalLabel}\n📂 *कुल फाइल्स:* ${movie.files.length}`, { parse_mode: 'Markdown' });
            } else {
                movie = new Movie({
                    title: cleanTitle,
                    cleanKey,
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
});

// ----------------- API ENDPOINTS -----------------
app.get('/api/movies', async (req, res) => {
    try {
        const movies = await Movie.find().sort({ updatedAt: -1 });
        res.json(movies);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/config', async (req, res) => {
    try {
        const poweredCfg = await Config.findOne({ key: 'powered_by_text' });
        const adgramCfg = await Config.findOne({ key: 'adgram_enabled' });
        const adgramBlock = await Config.findOne({ key: 'adgram_block_id' });

        const btnGroup = await Config.findOne({ key: 'btn_group_link' });
        const btnBackup = await Config.findOne({ key: 'btn_backup_link' });
        const btnPremium = await Config.findOne({ key: 'btn_premium_link' });

        res.json({
            powered_by: poweredCfg ? poweredCfg.value : 'Powered by @asumit669',
            adgram_enabled: adgramCfg ? adgramCfg.value : false,
            adgram_block_id: adgramBlock ? adgramBlock.value : '',
            btn_group: btnGroup ? btnGroup.value : '#',
            btn_backup: btnBackup ? btnBackup.value : '#',
            btn_premium: btnPremium ? btnPremium.value : '#'
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/request-movie', async (req, res) => {
    const { userId, username, movieName } = req.body;
    try {
        const newReq = new MovieRequest({ userId: userId.toString(), username: username || 'User', movieName });
        await newReq.save();

        const adminList = ADMIN_ID ? ADMIN_ID.split(',').map(id => id.trim()) : [];
        for (const admin of adminList) {
            bot.sendMessage(admin, `📩 *Mini App Movie Request!*\n\n🎬 *मूवी:* ${movieName}\n👤 *यूज़र:* ${username} (\`${userId}\`)`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Notify Uploaded', callback_data: `req_done_${newReq._id}` },
                        { text: '❌ Reject', callback_data: `req_rej_${newReq._id}` }
                    ]]
                }
            }).catch(() => {});
        }

        res.json({ success: true });
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
                const me = await bot.getMe();
                const targetUrl = `https://t.me/${me.username}?start=file_${fileId}`;
                const apiRes = await axios.get(`https://${domainCfg.value}/api?api=${apiCfg.value}&url=${encodeURIComponent(targetUrl)}`);
                if (apiRes.data && apiRes.data.shortenedUrl) {
                    await bot.sendMessage(chatId, `🔐 *आपकी डाउनलोड लिंक तैयार है:*\n\n[यहाँ क्लिक करके अनलॉक करें](${apiRes.data.shortenedUrl})`, { parse_mode: 'Markdown' });
                    return res.json({ success: true, short: true });
                }
            }
        }

        const captionChanCfg = await Config.findOne({ key: 'caption_channel_link' });
        const inviteLinkCfg = await Config.findOne({ key: 'caption_invite_link' });

        const channelLink = captionChanCfg ? captionChanCfg.value : 'https://t.me/your_backup_channel';
        const inviteLink = inviteLinkCfg ? inviteLinkCfg.value : 'https://t.me/your_bot_username';

        const captionText = `🎬 [${movieTitle}](${channelLink})\n📌 *क्वालिटी:* ${label}\n\n🍿 *To get more movies:* [Click Here to Join Bot](${inviteLink})\n\n⚠️ *नोट:* यह फ़ाइल **10 मिनट** में डिलीट हो जाएगी। इसे तुरंत *Saved Messages* में फॉरवर्ड कर लें!`;

        let sentMsg = fileType === 'video' 
            ? await bot.sendVideo(chatId, fileId, { caption: captionText, parse_mode: 'Markdown' })
            : await bot.sendDocument(chatId, fileId, { caption: captionText, parse_mode: 'Markdown' });

        res.json({ success: true });
        setTimeout(() => bot.deleteMessage(chatId, sentMsg.message_id).catch(() => {}), 10 * 60 * 1000);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ----------------- SECURE SERVER STARTUP -----------------
const PORT = process.env.PORT || 10000;

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('✅ Connected to MongoDB Successfully');
        
        bot.setMyCommands([
            { command: 'start', description: 'Open Movie Store' },
            { command: 'request', description: 'Request a movie (/request Name)' },
            { command: 'refer', description: 'Get your invite link & stats' }
        ]).catch(() => {});

        app.listen(PORT, () => {
            console.log(`🚀 Server running perfectly on port ${PORT}`);
        });
    })
    .catch((err) => {
        console.error('❌ MongoDB Connection Error:', err.message);
    });
