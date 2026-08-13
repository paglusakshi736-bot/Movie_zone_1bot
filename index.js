const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');

const token = process.env.BOT_TOKEN;
const mongoURI = process.env.MONGO_URI;
const ADMIN_ID = process.env.ADMIN_ID;

const app = express();
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

const PORT = process.env.PORT || 10000;

// Database Connection Helper
async function ensureDbConnected() {
    if (mongoose.connection.readyState !== 1) {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(mongoURI, {
            serverSelectionTimeoutMS: 10000
        });
    }
}

// Movie Schema
const movieSchema = new mongoose.Schema({
    title: String,
    fileId: String,
    thumbFileId: String,
    fileType: String,
    createdAt: { type: Date, default: Date.now }
});

const Movie = mongoose.model('Movie', movieSchema);

const bot = new TelegramBot(token, { polling: true });

// API to get all movies for Mini App
app.get('/api/movies', async (req, res) => {
    try {
        await ensureDbConnected();
        const movies = await Movie.find().sort({ createdAt: -1 });
        res.json(movies);
    } catch (err) {
        res.status(500).json({ error: "Server error: " + err.message });
    }
});

// API for thumbnail images
app.get('/api/thumb/:fileId', async (req, res) => {
    try {
        const file = await bot.getFile(req.params.fileId);
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        return res.redirect(fileUrl);
    } catch (err) {
        return res.redirect('https://via.placeholder.com/150x200?text=No+Poster');
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Telegram Bot Listener
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from ? msg.from.id.toString() : '';

    // 1. WebApp Data Handler (When user clicks "Get Movie" in Mini App)
    if (msg.web_app_data && msg.web_app_data.data) {
        const movieId = msg.web_app_data.data;
        try {
            await ensureDbConnected();
            const movie = await Movie.findById(movieId);
            if (movie) {
                if (movie.fileType === 'video') {
                    await bot.sendVideo(chatId, movie.fileId, { caption: `🎬 ${movie.title}` });
                } else {
                    await bot.sendDocument(chatId, movie.fileId, { caption: `🎬 ${movie.title}` });
                }
            } else {
                await bot.sendMessage(chatId, "❌ मूवी डेटाबेस में नहीं मिली!");
            }
        } catch (err) {
            console.error("Error sending movie:", err);
            await bot.sendMessage(chatId, "❌ मूवी भेजने में एरर आया: " + err.message);
        }
        return;
    }

    // 2. Admin Check (Only for saving forwarded movies)
    if (userId !== ADMIN_ID) return;

    // Save forwarded movie/video
    const fileId = msg.video ? msg.video.file_id : (msg.document ? msg.document.file_id : null);
    const fileType = msg.video ? 'video' : 'document';
    const title = msg.caption || (msg.document ? msg.document.file_name : 'Untitled Movie');

    if (!fileId) return;

    let thumbFileId = null;
    if (msg.video && msg.video.thumbnail) {
        thumbFileId = msg.video.thumbnail.file_id;
    } else if (msg.document && msg.document.thumbnail) {
        thumbFileId = msg.document.thumbnail.file_id;
    }

    try {
        await ensureDbConnected();

        const newMovie = new Movie({ title, fileId, thumbFileId, fileType });
        await newMovie.save();

        await bot.sendMessage(chatId, `✅ Movie saved to database successfully!\n\n📌 Title: ${title}`);
    } catch (err) {
        console.error("Database Save Error:", err);
        await bot.sendMessage(chatId, "❌ Error saving movie: " + err.message);
    }
});
