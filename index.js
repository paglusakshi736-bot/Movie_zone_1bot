const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

// Configurations - ये सब Render Dashboard में Environment Variables में सेट करें
const token = process.env.BOT_TOKEN;
const mongoURI = process.env.MONGO_URI;
const ADMIN_ID = process.env.ADMIN_ID;

// MongoDB Database Connection
mongoose.connect(mongoURI)
  .then(() => console.log('Database connected successfully!'))
  .catch(err => console.error('Database connection error:', err));

// Define Schema for Saving User Messages
const MessageSchema = new mongoose.Schema({
  userId: String,
  username: String,
  text: String,
  date: { type: Date, default: Date.now }
});
const BotMessage = mongoose.model('BotMessage', MessageSchema);

// Initialize Telegram Bot
const bot = new TelegramBot(token, { polling: true });

// Message Handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  // 1. Check if user is Admin
  if (userId !== ADMIN_ID) {
    bot.sendMessage(chatId, "Access Restricted: You are not the admin.");
    return;
  }

  // 2. Save incoming data to MongoDB
  try {
    const userMessage = new BotMessage({
      userId: userId,
      username: msg.from.username || "unknown",
      text: msg.text
    });
    await userMessage.save();
    console.log("Data saved to database successfully.");
  } catch (err) {
    console.error("Database save error:", err);
  }

  // 3. Simple Command Logic
  if (msg.text === '/start') {
    bot.sendMessage(chatId, "Welcome Admin! Your bot is fully operational and saving data.");
  }
});

console.log('Bot is running...');
const http = require('http');
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!\n');
}).listen(port, () => console.log(Server listening on port ${port}));
