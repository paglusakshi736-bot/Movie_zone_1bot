const User = require('../models/User');
const Media = require('../models/Media');
const Settings = require('../models/Settings');
const { getDuplicatesForReview, cleanExactDuplicates } = require('../utils/duplicateCleaner');

/**
 * एडमिन पैनल का मुख्य मेनू
 */
async function showAdminPanel(ctx) {
  const adminId = process.env.ADMIN_ID;
  if (String(ctx.from.id) !== String(adminId)) {
    return ctx.reply('⛔ आपके पास एडमिन पैनल का एक्सेस नहीं है।');
  }

  const userCount = await User.countDocuments();
  const mediaCount = await Media.countDocuments();
  const vipCount = await User.countDocuments({ isVip: true });
  const settings = await Settings.findOne() || {};

  const statsText = `
👑 <b>MASTER ADMIN DASHBOARD</b>
━━━━━━━━━━━━━━━━━━━━
👥 <b>कुल यूज़र्स:</b> <code>${userCount}</code>
💎 <b>VIP मेंबर्स:</b> <code>${vipCount}</code>
🎬 <b>कुल मीडिया फाइल्स:</b> <code>${mediaCount}</code>

⚙️ <b>वर्तमान सेटिंग्स:</b>
⏱️ <b>ऑटो-डिलीट:</b> <code>${settings.autoDeleteMinutes || 15} मिनट</code>
🔗 <b>शॉर्टनर:</b> <code>${settings.shortenerEnabled ? '✅ चालू' : '❌ बंद'}</code>
📢 <b>ब्रॉडकास्ट चैनल:</b> <code>${settings.broadcastChannelId || 'सेट नहीं'}</code>
━━━━━━━━━━━━━━━━━━━━
<i>नीचे दिए गए बटनों से बॉट को कंट्रोल करें:</i>`;

  const keyboard = [
    [
      { text: '📊 रीफ़्रेश स्टैट्स', callback_data: 'admin_refresh' },
      { text: '🧹 चेक डुप्लीकेट्स', callback_data: 'admin_check_duplicates' }
    ],
    [
      { text: '⏱️ ऑटो-डिलीट टाइमर', callback_data: 'admin_timer_menu' },
      { text: '🔗 शॉर्टनर सेटिंग्स', callback_data: 'admin_shortener_toggle' }
    ],
    [
      { text: '❌ मेनू बंद करें', callback_data: 'admin_close' }
    ]
  ];

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(statsText, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (e) {
      // अगर मैसेज में कोई बदलाव न हुआ हो
    }
  } else {
    await ctx.reply(statsText, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

/**
 * एडमिन कॉलबैक क्वेरी हैंडलर
 */
async function handleAdminCallbacks(ctx) {
  const data = ctx.callbackQuery.data;
  const adminId = process.env.ADMIN_ID;

  if (String(ctx.from.id) !== String(adminId)) {
    return ctx.answerCbQuery('⛔ एक्सेस अस्वीकृत!');
  }

  // 1. रीफ़्रेश
  if (data === 'admin_refresh') {
    await ctx.answerCbQuery('स्टैट्स अपडेट हो गए!');
    return showAdminPanel(ctx);
  }

  // 2. ऑटो-डिलीट टाइमर मेनू
  if (data === 'admin_timer_menu') {
    const timerKeyboard = [
      [
        { text: '5 मिनट', callback_data: 'set_timer_5' },
        { text: '10 मिनट', callback_data: 'set_timer_10' },
        { text: '15 मिनट', callback_data: 'set_timer_15' }
      ],
      [
        { text: '30 मिनट', callback_data: 'set_timer_30' },
        { text: '🚫 OFF (बंद)', callback_data: 'set_timer_0' }
      ],
      [
        { text: '🔙 मुख्य मेनू', callback_data: 'admin_refresh' }
      ]
    ];

    await ctx.editMessageText('⏱️ <b>फ़ाइल ऑटो-डिलीट टाइमर चुनें:</b>\nयूज़र को फ़ाइल मिलने के कितनी देर बाद टेलीग्राम से डिलीट होनी चाहिए?', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: timerKeyboard }
    });
    return ctx.answerCbQuery();
  }

  // टाइमर सेट करना
  if (data.startsWith('set_timer_')) {
    const mins = parseInt(data.replace('set_timer_', ''));
    await Settings.findOneAndUpdate({}, { autoDeleteMinutes: mins }, { upsert: true });
    await ctx.answerCbQuery(`टाइमर ${mins === 0 ? 'बंद' : mins + ' मिनट'} पर सेट हुआ!`, { show_alert: true });
    return showAdminPanel(ctx);
  }

  // 3. शॉर्टनर ऑन/ऑफ टॉगल
  if (data === 'admin_shortener_toggle') {
    const settings = await Settings.findOne() || {};
    const newStatus = !settings.shortenerEnabled;
    await Settings.findOneAndUpdate({}, { shortenerEnabled: newStatus }, { upsert: true });
    await ctx.answerCbQuery(`शॉर्टनर ${newStatus ? 'चालू' : 'बंद'} कर दिया गया!`, { show_alert: true });
    return showAdminPanel(ctx);
  }

  // 4. डुप्लीकेट्स चेक करना
  if (data === 'admin_check_duplicates') {
    const duplicates = await getDuplicatesForReview();
    if (duplicates.length === 0) {
      await ctx.answerCbQuery('✨ डेटाबेस साफ़ है! कोई डुप्लीकेट नहीं मिला।', { show_alert: true });
      return;
    }

    let msg = `⚠️ <b>${duplicates.length} डुप्लीकेट ग्रुप मिले:</b>\n\n`;
    duplicates.slice(0, 5).forEach((d, idx) => {
      msg += `${idx + 1}. <b>${d._id.cleanTitle}</b> (${d.count} एंट्रीज़)\n`;
    });

    const dupKeyboard = [
      [{ text: '⚡ सभी डुप्लीकेट एक साथ साफ़ करें', callback_data: 'admin_clean_duplicates_confirm' }],
      [{ text: '🔙 मुख्य मेनू', callback_data: 'admin_refresh' }]
    ];

    await ctx.editMessageText(msg, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: dupKeyboard }
    });
    return ctx.answerCbQuery();
  }

  // डुप्लीकेट्स साफ़ करना
  if (data === 'admin_clean_duplicates_confirm') {
    const res = await cleanExactDuplicates();
    await ctx.answerCbQuery(`🧹 कुल ${res.removedCount} फालतू कॉपियाँ साफ़ कर दी गईं!`, { show_alert: true });
    return showAdminPanel(ctx);
  }

  // 5. मेनू बंद करना
  if (data === 'admin_close') {
    await ctx.deleteMessage();
    return ctx.answerCbQuery('एडमिन पैनल बंद!');
  }
}

module.exports = { showAdminPanel, handleAdminCallbacks };
