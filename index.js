const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_ID = process.env.ADMIN_ID;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.use(cors());
app.use(express.json());

// MongoDB Schema
const movieSchema = new mongoose.Schema({
    title: String,
    fileId: String,
    thumbFileId: String,
    fileType: String,
    createdAt: { type: Date, default: Date.now }
});

const Movie = mongoose.model('Movie', movieSchema);

async function ensureDbConnected() {
    if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(MONGO_URI);
    }
}

// ----------------- FINAL CLEANER LOGIC -----------------
function cleanTitle(text) {
    if (!text) return 'Movie ' + new Date().toLocaleDateString('en-GB');

    // 1. सिर्फ पहली लाइन
    let clean = text.split('\n')[0];

    // 2. ब्रैकेट्स [ ] और ( ) के अंदर का पूरा कचरा हटाओ
    clean = clean.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');

    // 3. लिंक्स, @हैंडल्स और फाइल एक्सटेंशन हटाओ
    clean = clean.replace(/(https?:\/\/[^\s]+|t\.me\/[^\s]+|www\.[^\s]+|@\w+|\.(mp4|mkv|avi|mov|zip|rar))/gi, '');

    // 4. सारे फालतू टैग्स और इमोजी हटाओ
    clean = clean.replace(/(480p|720p|1080p|2160p|4k|webdl|web-dl|bluray|x264|x265|hevc|h264|h265|aac|esub|combined|amzn|ddp|hindi|english|korean|dubbed|paramount|official|official|hd|full)/gi, ' ');
    
    // 5. स्पेशल सिम्बल्स और इमोजी हटाओ (सिर्फ अक्षर और नंबर बचेंगे)
    clean = clean.replace(/[^\w\s]/gi, ' ');

    // 6. फालतू स्पेस हटाओ और टाइटल सुंदर बनाओ
    clean = clean.replace(/\s+/g, ' ').trim();
    
    if (clean.length < 3) return 'Movie ' + new Date().toLocaleDateString('en-GB');
    
    return clean.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

// ----------------- MESSAGE HANDLER -----------------
bot.on('message', async (msg) => {
    const userId = msg.from ? msg.from.id.toString() : '';
    const adminList = ADMIN_ID ? ADMIN_ID.split(',').map(id => id.trim()) : [];
    if (!adminList.includes(userId)) return;

    const file = msg.video || msg.document;
    if (!file) return;

    // कैप्शन या फ़ाइल नेम जो भी मिल जाए, उसे उठाओ
    let rawInput = msg.caption || file.file_name || '';
    let title = cleanTitle(rawInput);

    const fileId = file.file_id;
    const fileType = msg.video ? 'video' : 'document';
    let thumbFileId = file.thumbnail ? file.thumbnail.file_id : null;

    try {
        await ensureDbConnected();
        const newMovie = new Movie({ title, fileId, thumbFileId, fileType });
        await newMovie.save();
        await bot.sendMessage(msg.chat.id, `✅ मूवी सेव हुई!\n\n📌 *टाइटल:* ${title}`, { parse_mode: 'Markdown' });
    } catch (err) {
        await bot.sendMessage(msg.chat.id, "❌ एरर: " + err.message);
    }
});

// ---------------- API ENDPOINTS ----------------
app.get('/api/movies', async (req, res) => {
    try {
        await ensureDbConnected();
        const movies = await Movie.find().sort({ createdAt: -1 });
        res.json(movies);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/thumb/:fileId', async (req, res) => {
    try {
        const fileLink = await bot.getFileLink(req.params.fileId);
        res.redirect(fileLink);
    } catch (err) { res.status(404).send('Not Found'); }
});

app.post('/api/send-movie', async (req, res) => {
    const { movieId, chatId } = req.body;
    try {
        await ensureDbConnected();
        const movie = await Movie.findById(movieId);
        if (!movie) return res.status(404).json({ error: 'Movie not found' });

        const msg = await (movie.fileType === 'video' ? bot.sendVideo(chatId, movie.fileId, { caption: `🎬 ${movie.title}` }) : bot.sendDocument(chatId, movie.fileId, { caption: `🎬 ${movie.title}` }));
        
        res.json({ success: true });
        setTimeout(() => bot.deleteMessage(chatId, msg.message_id).catch(() => {}), 10 * 60 * 1000);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(process.env.PORT || 10000);
