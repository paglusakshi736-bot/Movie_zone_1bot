require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Telegraf } = require('telegraf');

// मॉडल्स
const Media = require('./models/Media');
const User = require('./models/User');
const Settings = require('./models/Settings');

// यूटिलिटीज़ और हैंडलर्स
const { fetchTMDbDetails } = require('./utils/tmdb');
const { createShortLink } = require('./utils/shortener');
const { postToChannel } = require('./utils/broadcaster');
const { parseSeriesDetails } = require('./utils/seriesParser');
const { scheduleAutoDelete } = require('./utils/autoDelete');
const { extractQuality } = require('./utils/qualityParser');
const { getTelegramDirectUrl } = require('./utils/streamEngine');
const { processReferral, checkVipStatus } = require('./utils/vipReferral');
const { showAdminPanel, handleAdminCallbacks } = require('./handlers/adminHandler');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const bot = new Telegraf(process.env.BOT_TOKEN);

// --- 1. MONGODB कनेक्शन ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Database Connected Successfully!'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err.message));

// --- 2. मिनी ऐप (WEBAPP) API रूट्स ---

// हेल्थ चेक रूट (Render Port Binding के लिए)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// सभी मीडिया लिस्ट (सर्च, फ़िल्टर और टॉप 10 के लिए)
app.get('/api/media', async (req, res) => {
  try {
    const media = await Media.find().sort({ createdAt: -1 });
    res.json(media);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// इन-ऐप प्लेयर वीडियो स्ट्रीमिंग रूट
app.get('/api/stream/:id', async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media || !media.fileId) {
      return res.status(404).send('मीडिया नहीं मिला');
    }

    // व्यू काउंट +1 करना
    await Media.findByIdAndUpdate(req.params.id, { $inc: { viewsCount: 1 } });

    const directUrl = await getTelegramDirectUrl(process.env.BOT_TOKEN, media.fileId);
    if (directUrl) {
      res.redirect(directUrl);
    } else {
      res.status(500).send('स्ट्रीम लिंक जनरेट नहीं हो सका');
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// क्रोम फ़ास्ट डाउनलोड रूट
app.get('/api/fast-download/:id', async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media || !media.fileId) {
      return res.status(404).send('फ़ाइल नहीं मिली');
    }

    await Media.findByIdAndUpdate(req.params.id, { $inc: { downloadsCount: 1 } });

    const directUrl = await getTelegramDirectUrl(process.env.BOT_TOKEN, media.fileId);
    if (directUrl) {
      res.redirect(directUrl);
    } else {
      res.status(500).send('डाउनलोड लिंक उपलब्ध नहीं है');
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// --- 3. TELEGRAM BOT कमांड्स & लॉजिक ---

// /start कमांड (रेफ़रल ट्रैकिंग और डीप-लिंकिंग)
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const payload = ctx.startPayload;

  await User.findOneAndUpdate(
    { telegramId: userId },
    { 
      username: ctx.from.username || '', 
      firstName: ctx.from.first_name || '' 
    },
    { upsert: true, new: true }
  );

  // रेफ़रल हैंडलिंग
  if (payload && payload.startsWith('ref_')) {
    const referrerId = payload.replace('ref_', '');
    await processReferral(userId, referrerId);
  }

  // डायरेक्ट मीडिया फ़ाइल रिक्वेस्ट
  if (payload && payload.startsWith('media_')) {
    const mediaId = payload.replace('media_', '');
    return sendMediaToUser(ctx, mediaId);
  }

  const webAppUrl = process.env.WEBAPP_URL || 'https://movie-zone-1bot.onrender.com';
  const refLink = `https://t.me/${ctx.botInfo.username}?start=ref_${userId}`;

  const welcomeText = `
👋 <b>नमस्ते ${ctx.from.first_name}!</b>

🎬 <b>Movie Zone Mini App</b> में आपका स्वागत है!
यहाँ आपको मिलेंगी सभी लेटेस्ट मूवीज़, वेब सीरीज़ और साउथ स्पेशल फ़िल्में।

🔗 <b>आपका रेफ़रल लिंक:</b>
<code>${refLink}</code>
<i>(5 दोस्तों को शेयर करें और 7 दिन के लिए फ्री VIP पाएं!)</i>`;

  const keyboard = [
    [{ text: '🚀 Open Movie Mini App', web_app: { url: webAppUrl } }],
    [
      { text: '📢 Updates Channel', url: process.env.UPDATES_CHANNEL || 'https://t.me' },
      { text: '💬 Discussion', url: process.env.DISCUSSION_GRP || 'https://t.me' }
    ]
  ];

  ctx.reply(welcomeText, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
});

// /admin कमांड
bot.command('admin', async (ctx) => {
  showAdminPanel(ctx);
});

// एडमिन कॉलबैक क्वेरी हैंडलर
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith('admin_') || data.startsWith('set_timer_')) {
    return handleAdminCallbacks(ctx);
  }
});

// मीडिया फ़ाइल भेजने का फ़ंक्शन
async function sendMediaToUser(ctx, mediaId) {
  try {
    const media = await Media.findById(mediaId);
    if (!media) return ctx.reply('❌ यह फ़ाइल उपलब्ध नहीं है या हटा दी गई है।');

    const isVip = await checkVipStatus(ctx.from.id);
    const settings = await Settings.findOne() || {};

    if (settings.shortenerEnabled && !isVip) {
      const originalBotLink = `https://t.me/${ctx.botInfo.username}?start=media_${media._id}`;
      const shortUrl = await createShortLink(originalBotLink);

      return ctx.reply(`
🔒 <b>फ़ाइल अनलॉक करने के लिए नीचे दिए गए लिंक पर क्लिक करें:</b>\n\n👉 <a href="${shortUrl}">Click Here to Unlock File</a>\n\n<i>💎 Ads हटाने के लिए VIP मेंबरशिप लें।</i>`, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    }

    const sentMsg = await ctx.replyWithDocument(media.fileId, {
      caption: `🎬 <b>${media.title}</b> (${media.year || ''})\n⭐ <b>Rating:</b> ${media.rating || 'N/A'}\n\n<i>⚠️ यह फ़ाइल ${settings.autoDeleteMinutes || 15} मिनट में अपने-आप डिलीट हो जाएगी।</i>`,
      parse_mode: 'HTML'
    });

    await Media.findByIdAndUpdate(mediaId, { $inc: { downloadsCount: 1 } });

    if (settings.autoDeleteMinutes !== 0) {
      scheduleAutoDelete(bot, ctx.chat.id, sentMsg.message_id, settings.autoDeleteMinutes || 15);
    }
  } catch (err) {
    console.error('Error sending media:', err.message);
    ctx.reply('❌ फ़ाइल भेजने में समस्या आई।');
  }
}

// ऑटो अपलोड और TMDb हैंडलर
bot.on(['video', 'document'], async (ctx) => {
  const adminId = process.env.ADMIN_ID;
  if (String(ctx.from?.id) !== String(adminId) && String(ctx.channelPost?.chat?.id) !== String(process.env.STORAGE_CHANNEL_ID)) {
    return;
  }

  const doc = ctx.message?.document || ctx.message?.video || ctx.channelPost?.document || ctx.channelPost?.video;
  const fileName = doc.file_name || ctx.message?.caption || ctx.channelPost?.caption || 'Unknown Movie';
  const fileId = doc.file_id;

  ctx.reply(`⏳ फ़ाइल प्रोसेस हो रही है: <b>${fileName}</b>`, { parse_mode: 'HTML' });

  const quality = extractQuality(fileName);
  const seriesInfo = parseSeriesDetails(fileName);
  const tmdbData = await fetchTMDbDetails(seriesInfo.isSeries ? seriesInfo.cleanTitle : fileName);

  const newMedia = new Media({
    title: tmdbData.title || fileName,
    cleanTitle: (tmdbData.title || fileName).toLowerCase().trim(),
    type: seriesInfo.isSeries ? 'series' : 'movie',
    fileId: fileId,
    quality: quality,
    poster: tmdbData.poster,
    rating: tmdbData.rating,
    year: tmdbData.year,
    overview: tmdbData.overview,
    genres: tmdbData.genres
  });

  await newMedia.save();

  const settings = await Settings.findOne() || {};
  if (settings.broadcastChannelId) {
    await postToChannel(bot, settings.broadcastChannelId, newMedia, ctx.botInfo.username);
  }

  ctx.reply(`✅ <b>${newMedia.title}</b> डेटाबेस में सेव हो गई और ब्रॉडकास्ट कर दी गई!`, { parse_mode: 'HTML' });
});

// --- 4. सर्वर शुरू करना (Render 0.0.0.0 Binding Fix) ---
const PORT = process.env.PORT || 10000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Web Server is running on port ${PORT}`);
  
  bot.launch()
    .then(() => console.log('🤖 Telegram Bot Engine is Live!'))
    .catch(err => {
      console.error('Bot launch error (Ignored if 409 Conflict):', err.message);
    });
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
