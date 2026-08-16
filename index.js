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

// मल्टीपल एडमिन चेक करने का हेल्पर फ़ंक्शन
function checkIsAdmin(userId) {
  if (!userId) return false;
  const adminList = (process.env.ADMIN_ID || '')
    .split(',')
    .map(id => id.trim().replace(/['"]/g, ''))
    .filter(Boolean);
  return adminList.includes(String(userId));
}

// --- 1. MONGODB कनेक्शन ---
mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Database Connected Successfully!'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err.message));

// --- 2. मिनी ऐप (WEBAPP) API रूट्स ---

// हेल्थ चेक रूट (Render Port Binding के लिए)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// सभी मीडिया लिस्ट (सर्च, फ़िल्टर और मिनी ऐप लोड के लिए)
app.get('/api/media', async (req, res) => {
  try {
    const media = await Media.find().sort({ createdAt: -1 });
    res.json(media || []);
  } catch (err) {
    console.error('Error fetching media:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// इन-ऐप प्लेयर वीडियो स्ट्रीमिंग रूट
app.get('/api/stream/:id', async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);
    const fileId = media?.fileId || media?.file_id;
    if (!media || !fileId) {
      return res.status(404).send('मीडिया नहीं मिला');
    }

    await Media.findByIdAndUpdate(req.params.id, { $inc: { viewsCount: 1 } });

    const directUrl = await getTelegramDirectUrl(process.env.BOT_TOKEN, fileId);
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
    const fileId = media?.fileId || media?.file_id;
    if (!media || !fileId) {
      return res.status(404).send('फ़ाइल नहीं मिली');
    }

    await Media.findByIdAndUpdate(req.params.id, { $inc: { downloadsCount: 1 } });

    const directUrl = await getTelegramDirectUrl(process.env.BOT_TOKEN, fileId);
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

  try {
    await User.findOneAndUpdate(
      { userId: Number(userId) },
      { 
        $set: {
          userId: Number(userId),
          telegramId: userId,
          username: ctx.from.username || '',
          firstName: ctx.from.first_name || ''
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (uErr) {
    console.error('User save error:', uErr.message);
  }

  // रेफ़रल हैंडलिंग
  if (payload && payload.startsWith('ref_')) {
    const referrerId = payload.replace('ref_', '');
    if (typeof processReferral === 'function') {
      await processReferral(userId, referrerId);
    }
  }

  // डायरेक्ट मीडिया फ़ाइल रिक्वेस्ट
  if (payload && payload.startsWith('media_')) {
    const mediaId = payload.replace('media_', '');
    return sendMediaToUser(ctx, mediaId);
  }

  const webAppUrl = process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || 'https://movie-zone-1bot.onrender.com';
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

// /admin कमांड (Multiple Admins Supported)
bot.command('admin', async (ctx) => {
  if (!checkIsAdmin(ctx.from?.id)) {
    return ctx.reply('⛔ आपके पास एडमिन पैनल का एक्सेस नहीं है।');
  }
  if (typeof showAdminPanel === 'function') {
    showAdminPanel(ctx);
  }
});

// एडमिन कॉलबैक क्वेरी हैंडलर
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith('admin_') || data.startsWith('set_timer_')) {
    if (!checkIsAdmin(ctx.from?.id)) {
      return ctx.answerCbQuery('⛔ एक्सेस अस्वीकृत!', { show_alert: true });
    }
    if (typeof handleAdminCallbacks === 'function') {
      return handleAdminCallbacks(ctx);
    }
  }
});

// मीडिया फ़ाइल भेजने का फ़ंक्शन
async function sendMediaToUser(ctx, mediaId) {
  try {
    const media = await Media.findById(mediaId);
    if (!media) return ctx.reply('❌ यह फ़ाइल उपलब्ध नहीं है या हटा दी गई है।');

    const fileId = media.fileId || media.file_id;
    if (!fileId) return ctx.reply('❌ डेटाबेस में फ़ाइल आईडी नहीं मिली।');

    const isVip = typeof checkVipStatus === 'function' ? await checkVipStatus(ctx.from.id) : false;
    const settings = await Settings.findOne() || {};

    if (settings.shortenerEnabled && !isVip && typeof createShortLink === 'function') {
      const originalBotLink = `https://t.me/${ctx.botInfo.username}?start=media_${media._id}`;
      const shortUrl = await createShortLink(originalBotLink);

      return ctx.reply(
        `🔒 <b>फ़ाइल अनलॉक करने के लिए नीचे दिए गए लिंक पर क्लिक करें:</b>\n\n👉 <a href="${shortUrl}">Click Here to Unlock</a>`,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }
      );
    }

    const captionText = `🎬 <b>${media.title}</b> ${media.year ? `(${media.year})` : ''}\n⭐ <b>Rating:</b> ${media.rating || 'N/A'}`;
    let sentMsg;

    // 1. पहले वीडियो के रूप में भेजने का प्रयास
    try {
      sentMsg = await ctx.replyWithVideo(fileId, {
        caption: captionText,
        parse_mode: 'HTML'
      });
    } catch (vErr) {
      // 2. अगर वीडियो फेल हुआ तो डॉक्यूमेंट के रूप में प्रयास
      try {
        sentMsg = await ctx.replyWithDocument(fileId, {
          caption: captionText,
          parse_mode: 'HTML'
        });
      } catch (dErr) {
        console.error('Document send also failed:', dErr.message);
      }
    }

    await Media.findByIdAndUpdate(mediaId, { $inc: { downloadsCount: 1 } });

    if (settings.autoDeleteMinutes && settings.autoDeleteMinutes > 0 && sentMsg && typeof scheduleAutoDelete === 'function') {
      scheduleAutoDelete(bot, ctx.chat.id, sentMsg.message_id, settings.autoDeleteMinutes);
    }
  } catch (err) {
    console.error('Error sending media:', err.message);
    ctx.reply('❌ फ़ाइल भेजने में समस्या आई!');
  }
}

// ऑटो अपलोड और TMDb/फ़ॉलबैक हैंडलर
bot.on(['video', 'document'], async (ctx) => {
  try {
    const isSenderAdmin = checkIsAdmin(ctx.from?.id);
    const isStorageChannel = String(ctx.channelPost?.chat?.id) === String(process.env.STORAGE_CHANNEL_ID || '');

    if (!isSenderAdmin && !isStorageChannel) {
      return;
    }

    const doc = ctx.message?.document || ctx.message?.video || ctx.channelPost?.document || ctx.channelPost?.video;
    if (!doc) return;

    const rawName = doc.file_name || ctx.message?.caption || ctx.channelPost?.caption || 'New Video';
    const fileId = doc.file_id;

    if (ctx.chat?.type === 'private') {
      ctx.reply(`⏳ फ़ाइल प्रोसेस हो रही है: <b>${rawName}</b>`, { parse_mode: 'HTML' });
    }

    // 1. नाम साफ़ करना
    const cleanTitle = rawName
      .replace(/\.[^/.]+$/, "")
      .replace(/[\._]/g, ' ')
      .replace(/\b(480p|720p|1080p|2160p|4k|hevc|hdrip|webrip|bluray|x264|x265|hindi|dual audio)\b/gi, '')
      .trim();

    // 2. वीडियो का टेलीग्राम थंबनेल चेक करना
    let posterUrl = '';
    const thumbObj = doc.thumb || doc.thumbnail;
    if (thumbObj?.file_id) {
      try {
        const thumbLink = await ctx.telegram.getFileLink(thumbObj.file_id);
        posterUrl = thumbLink.href;
      } catch (tErr) {
        console.error('Thumb error:', tErr.message);
      }
    }

    // 3. TMDb डेटा
    let tmdbData = {};
    try {
      if (typeof fetchTMDbDetails === 'function') {
        const seriesInfo = typeof parseSeriesDetails === 'function' ? parseSeriesDetails(rawName) : { isSeries: false, cleanTitle: cleanTitle };
        tmdbData = await fetchTMDbDetails(seriesInfo.isSeries ? seriesInfo.cleanTitle : cleanTitle);
      }
    } catch (e) {
      console.log('TMDB not found, using fallback.');
    }

    // 4. फ़ाइनल डेटा (TMDB -> Telegram Thumb -> Auto Poster)
    const finalTitle = tmdbData?.title || cleanTitle || rawName;
    const finalPoster = tmdbData?.poster || posterUrl || `https://via.placeholder.com/300x450/1e293b/ffffff?text=${encodeURIComponent(finalTitle.substring(0, 20))}`;
    const quality = typeof extractQuality === 'function' ? extractQuality(rawName) : 'HD';

    const newMedia = new Media({
      title: finalTitle,
      cleanTitle: finalTitle.toLowerCase().trim(),
      type: tmdbData?.type || (rawName.toLowerCase().includes('s0') || rawName.toLowerCase().includes('season') ? 'series' : 'movie'),
      fileId: fileId,
      file_id: fileId,
      quality: quality,
      poster: finalPoster,
      rating: tmdbData?.rating || '8.0',
      year: tmdbData?.year || new Date().getFullYear().toString(),
      overview: tmdbData?.overview || `${finalTitle} फ़ाइल अब Movie Zone पर उपलब्ध है।`,
      genres: tmdbData?.genres || ['Entertainment']
    });

    await newMedia.save();

    // ब्रॉडकास्ट
    const settings = await Settings.findOne() || {};
    if (settings.broadcastChannelId && typeof postToChannel === 'function') {
      await postToChannel(bot, settings.broadcastChannelId, newMedia, ctx.botInfo?.username);
    }

    if (ctx.chat?.type === 'private') {
      ctx.reply(`✅ <b>${finalTitle}</b> डेटाबेस में सेव हो गई!`, { parse_mode: 'HTML' });
    }
  } catch (uploadErr) {
    console.error('Upload Error:', uploadErr.message);
  }
});

// --- 4. सर्वर शुरू करना (Render 0.0.0.0 Binding Fix) ---
const PORT = process.env.PORT || 10000;

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Web Server is running on port ${PORT}`);
  
  try {
    await bot.launch();
    console.log('🤖 Telegram Bot Engine is Live!');
  } catch (err) {
    console.error('Bot launch error:', err.message);
  }
});

// सुरक्षित शटडाउन (बिना क्रैश हुए)
process.once('SIGINT', () => {
  try { bot.stop('SIGINT'); } catch (e) {}
});
process.once('SIGTERM', () => {
  try { bot.stop('SIGTERM'); } catch (e) {}
});
  
