require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const setupBotHandlers = require('./bot/handlers');
const createApiRoutes = require('./routes/api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 10000;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static('public'));

// बॉट और API लोड करें
setupBotHandlers(bot);
app.use('/api', createApiRoutes(bot));

// Safe Error Listeners
bot.on('polling_error', (error) => console.log('[Telegram Polling Error]:', error.message || error));
process.on('unhandledRejection', (reason) => console.log('[Unhandled Rejection]:', reason));

// डेटाबेस और सर्वर शुरू
mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('✅ Connected to MongoDB Successfully');
        
                bot.setMyCommands([
            { command: 'start', description: 'Open Movie Store' },
            { command: 'stats', description: 'View bot statistics' },
            { command: 'manage', description: 'Multi-Select Delete movies (Supports pages)' },
            { command: 'forcesub', description: 'Enable/Disable Join Lock' },
            { command: 'setchannel', description: 'Set Channel for Join Lock' },
            { command: 'setgroup', description: 'Set Group for Join Lock' },
            { command: 'shortener', description: 'Enable/Disable Shortener' },
            { command: 'setshortener', description: 'Set Shortener Domain & API' },
            { command: 'broadcast', description: 'Send message to all users' },
            { command: 'request', description: 'Request any movie/series' }
        ]).catch(() => {});
        

        app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
    })
    .catch((err) => console.error('❌ MongoDB Connection Error:', err.message));
