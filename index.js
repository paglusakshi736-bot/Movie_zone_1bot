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

// Ensure Database Connection
async function ensureDbConnected() {
    if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(MONGO_URI);
    }
}

// ---------------- AUTO CLEANER & SAVE (ADMIN ONLY) ----------------
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from ? msg.from.id.toString() : '';

    if (msg.text && msg.text.startsWith('/start')) return;
    
    // Multi-Admin Check (Supports multiple IDs separated by commas)
    const adminList = ADMIN_ID ? ADMIN_ID.split(',').map(id => id.trim()) : [];
    if (!adminList.includes(userId)) return;

    const file = msg.video || msg.document;
    if (!file) return;

    // Auto Name Cleaner + Link & Unwanted Tag Removal
    let rawName = msg.caption || file.file_name || 'Untitled Movie';
    
    let title = rawName
        .replace(/(https?:\/\/[^\s]+|t\.me\/[^\s]+|www\.[^\s]+)/gi, '') // Remove Links
        .replace(/\.(mp4|mkv|avi|mov|zip|rar)$/i, '')                   // Remove Extensions
        .replace(/[\._-]/g, ' ')                                         // Remove Underscores/Dots
        .replace(/(720p|1080p|4k|x264|x265|hevc|web-dl|bluray)/gi, '')   // Remove Quality Tags
        .trim();
    
    title = title.replace(/\b\w/g, c => c.toUpperCase()); // Capitalize first letters

    const fileId = file.file_id;
    const fileType = msg.video ? 'video' : 'document';
    let thumbFileId = file.thumbnail ? file.thumbnail.file_id : null;

    try {
        await ensureDbConnected();
        const newMovie = new Movie({ title, fileId, thumbFileId, fileType });
        await newMovie.save();
        await bot.sendMessage(chatId, `✅ मूवी सफलता से सेव हो गई!\n\n📌 *टाइटल:* ${title}`, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error("Database Save Error:", err);
        await bot.sendMessage(chatId, "❌ एरर: " + err.message);
    }
});

// ---------------- API ENDPOINTS ----------------

// Get All Movies for WebApp
app.get('/api/movies', async (req, res) => {
    try {
        await ensureDbConnected();
        const movies = await Movie.find().sort({ createdAt: -1 });
        res.json(movies);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Thumbnail Image URL
app.get('/api/thumb/:fileId', async (req, res) => {
    try {
        const fileLink = await bot.getFileLink(req.params.fileId);
        res.redirect(fileLink);
    } catch (err) {
        res.status(404).send('Thumbnail Not Found');
    }
});

// Send Movie to User with 10 Minutes Auto-Delete
app.post('/api/send-movie', async (req, res) => {
    const { movieId, chatId } = req.body;
    try {
        await ensureDbConnected();
        const movie = await Movie.findById(movieId);
        if (!movie) return res.status(404).json({ success: false, error: 'Movie not found' });

        const captionText = `🎬 *${movie.title}*\n\n⚠️ *नोट:* यह मूवी कॉपीराइट सुरक्षा कारणों से **10 मिनट** में अपने-आप डिलीट हो जाएगी। कृपया इसे तुरंत अपने *Saved Messages* में फॉरवर्ड कर लें!`;

        let sentMsg;
        if (movie.fileType === 'video') {
            sentMsg = await bot.sendVideo(chatId, movie.fileId, { caption: captionText, parse_mode: 'Markdown' });
        } else {
            sentMsg = await bot.sendDocument(chatId, movie.fileId, { caption: captionText, parse_mode: 'Markdown' });
        }

        res.json({ success: true });

        // --- 10 MINUTES AUTO-DELETE TIMER ---
        setTimeout(async () => {
            try {
                await bot.deleteMessage(chatId, sentMsg.message_id);
                console.log(`Message ${sentMsg.message_id} auto-deleted successfully after 10 minutes.`);
            } catch (delErr) {
                console.error("Auto-delete error:", delErr.message);
            }
        }, 10 * 60 * 1000); // 10 Minutes in milliseconds

    } catch (err) {
        console.error("Send Movie Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
