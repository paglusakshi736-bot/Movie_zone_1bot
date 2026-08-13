const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const http = require('http');

// Environment Variables
const token = process.env.BOT_TOKEN;
const mongoURI = process.env.MONGO_URI;
const ADMIN_ID = process.env.ADMIN_ID;

// Web Server for Render Port Check
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!\n');
}).listen(port, () => console.log('Server is running on port ' + port));

// MongoDB Connection
mongoose.connect(mongoURI)
  .then(() => console.log('Database connected successfully!'))
  .catch(err => console.error('Database connection error:', err));

// Schema Definition
const MessageSchema = new mongoose.Schema({
  userId: String,
  username: String,
  text: String,
  date: { type: Date, default: Date.now }
});
const BotMessage = mongoose.model('BotMessage', MessageSchema);

// Telegram Bot Setup
const bot = new TelegramBot(token, { polling: true });

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  // Admin Check
  if (userId !== ADMIN_ID) {
    bot.sendMessage(chatId, "Access Restricted: You are not the admin.");
    return;
  }

  // Save to Database
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

  // Commands
  if (msg.text === '/start') {
    bot.sendMessage(chatId, "Welcome Admin! Your bot is fully operational.");
  }
});

console.log('Bot process initialized...');
