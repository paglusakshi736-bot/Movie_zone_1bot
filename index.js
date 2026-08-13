const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');

const token = process.env.BOT_TOKEN;
const mongoURI = process.env.MONGO_URI;
const ADMIN_ID = process.env.ADMIN_ID;

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

const port = process.env.PORT || 3000;

// Helper to ensure database connection before operations
async function ensureDbConnected() {
  if (mongoose.connection.readyState !== 1) {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 10000
    });
  }
}

const MovieSchema = new mongoose.Schema({
  title: String,
  fileId: String,
  thumbFileId: String,
  fileType: String,
  date: { type: Date, default: Date.now }
});
const Movie = mongoose.model('Movie', MovieSchema);

const bot = new TelegramBot(token, { polling: true });

app.get('/api/movies', async (req, res) => {
  try {
    await ensureDbConnected();
    const movies = await Movie.find().sort({ date: -1 });
    res.json(movies);
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

app.get('/api/thumb/:fileId', async (req, res) => {
  try {
    const fId = req.params.fileId;
    const fileLink = await bot.getFileLink(fId);
    return res.redirect(fileLink);
  } catch (err) {
    return res.redirect('https://via.placeholder.com/150x200?text=No+Poster');
  }
});

app.listen(port, () => console.log('Server running on port ' + port));

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  if (msg.web_app_data) {
    const movieId = msg.web_app_data.data;
    try {
      await ensureDbConnected();
      const movie = await Movie.findById(movieId);
      if (movie) {
        if (movie.fileType === 'video') {
          await bot.sendVideo(chatId, movie.fileId, { caption: '🎬 ' + movie.title });
        } else {
          await bot.sendDocument(chatId, movie.fileId, { caption: '🎬 ' + movie.title });
        }
      }
    } catch (err) {
      bot.sendMessage(chatId, 'Failed to send requested movie: ' + err.message);
    }
    return;
  }

  if (userId !== ADMIN_ID) return;

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
      // Connect first before saving
      await ensureDbConnected();

      const newMovie = new Movie({ title, fileId, thumbFileId, fileType });
      await newMovie.save();
      bot.sendMessage(chatId, '✅ Movie saved to database successfully!\n\n📌 Title: ' + title);
    } catch (err) {
      console.error("Database Save Error:", err);
      bot.sendMessage(chatId, '❌ Error saving movie:\n' + err.message);
    }
  }
});
