const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');

const token = process.env.BOT_TOKEN;
const mongoURI = process.env.MONGO_URI;
const ADMIN_ID = process.env.ADMIN_ID;

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

// Database Schema
const MovieSchema = new mongoose.Schema({
  title: String,
  fileId: String,
  thumbFileId: String,
  fileType: String,
  date: { type: Date, default: Date.now }
});
const Movie = mongoose.model('Movie', MovieSchema);

// MongoDB Connection
mongoose.connect(mongoURI)
  .then(() => console.log('Database connected successfully!'))
  .catch(err => console.error('Database connection error:', err));

// Bot Instance
const bot = new TelegramBot(token, { polling: true });

// API: Fetch movies list for Mini App
app.get('/api/movies', async (req, res) => {
  try {
    const movies = await Movie.find().sort({ date: -1 });
    res.json(movies);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// API Proxy: Convert Telegram thumbnail ID to Image Link
app.get('/api/thumb/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId  fileId === 'null'  fileId === 'undefined') {
      return res.redirect('https://via.placeholder.com/150x200?text=No+Poster');
    }
    const fileLink = await bot.getFileLink(fileId);
    res.redirect(fileLink);
  } catch (err) {
    res.redirect('https://via.placeholder.com/150x200?text=No+Poster');
  }
});

app.listen(port, () => console.log('Server running on port ' + port));

// Bot Message Handling
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  // Mini App Trigger
  if (msg.web_app_data) {
    const movieId = msg.web_app_data.data;
    try {
      const movie = await Movie.findById(movieId);
      if (movie) {
        if (movie.fileType === 'video') {
          await bot.sendVideo(chatId, movie.fileId, { caption: '🎬 ' + movie.title });
        } else {
          await bot.sendDocument(chatId, movie.fileId, { caption: '🎬 ' + movie.title });
        }
      }
    } catch (err) {
      bot.sendMessage(chatId, 'Failed to send the requested file.');
    }
    return;
  }

  // Admin Restriction
  if (userId !== ADMIN_ID) return;

  // File Upload Handling
  if (msg.video || msg.document) {
    const fileId = msg.video ? msg.video.file_id : msg.document.file_id;
    const fileType = msg.video ? 'video' : 'document';
    const title = msg.caption || (msg.document ? msg.document.file_name : 'Untitled Movie');

    let thumbFileId = null;
    if (msg.video && msg.video.thumbnail) {
      thumbFileId = msg.video.thumbnail.file_id;
    } else if (msg.document && msg.document.thumbnail) {
      thumbFileId = msg.document.thumbnail.file_id;
    }

    try {
      const newMovie = new Movie({ title, fileId, thumbFileId, fileType });
      await newMovie.save();
      bot.sendMessage(chatId, '✅ Movie saved to database successfully!\n\n📌 Title: ' + title);
    } catch (err) {
      bot.sendMessage(chatId, '❌ Error saving movie to database!');
    }
  }
});
