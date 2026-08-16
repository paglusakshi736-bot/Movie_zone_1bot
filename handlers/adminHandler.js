const Settings = require('../models/Settings');
const Media = require('../models/Media');
const User = require('../models/User');

function checkIsAdmin(userId) {
  if (!userId) return false;
  const adminList = (process.env.ADMIN_ID || '')
    .split(',')
    .map(id => id.trim().replace(/['"]/g, ''))
    .filter(Boolean);
  return adminList.includes(String(userId));
}

async function showAdminPanel(ctx) {
  if (!checkIsAdmin(ctx.from?.id)) {
    return ctx.reply('⛔ आपके पास एडमिन पैनल का एक्सेस नहीं है।');
  }

  const totalUsers = await User.countDocuments();
  const totalMedia = await Media.countDocuments();
  const settings = await Settings.findOne() || {};

  const text = `
🛠 <b>Movie Zone Admin Panel</b>

👥 <b>कुल यूज़र्स:</b> ${totalUsers}
🎬 <b>कुल मूवीज़/सीरीज़:</b> ${totalMedia}
⏱ <b>Auto-Delete टाइमर:</b> ${settings.autoDeleteMinutes || 15} मिनट
🔗 <b>Shortener स्टेटस:</b> ${settings.shortenerEnabled ? '✅ Active' : '❌ Disabled'}
`;

  const keyboard = [
    [
      { text: `⏱ Auto Delete (${settings.autoDeleteMinutes || 15}m)`, callback_data: 'admin_toggle_delete' },
      { text: `🔗 Shortener: ${settings.shortenerEnabled ? 'ON' : 'OFF'}`, callback_data: 'admin_toggle_shortener' }
    ],
    [
      { text: '📢 ब्रॉडकास्ट मैसेज', callback_data: 'admin_broadcast_prompt' }
    ],
    [
      { text: '🔄 पैनल रिफ्रेश करें', callback_data: 'admin_refresh' }
    ]
  ];

  if (ctx.callbackQuery) {
    ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } else {
    ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

async function handleAdminCallbacks(ctx) {
  if (!checkIsAdmin(ctx.from?.id)) {
    return ctx.answerCbQuery('⛔ एक्सेस अस्वीकृत!', { show_alert: true });
  }

  const data = ctx.callbackQuery.data;
  let settings = await Settings.findOne();
  if (!settings) settings = new Settings();

  if (data === 'admin_toggle_shortener') {
    settings.shortenerEnabled = !settings.shortenerEnabled;
    await settings.save();
    await ctx.answerCbQuery(`Shortener ${settings.shortenerEnabled ? 'चालू' : 'बंद'} कर दिया गया!`);
    return showAdminPanel(ctx);
  }

  if (data === 'admin_toggle_delete') {
    const timerKeyboard = [
      [
        { text: '0 मिनट (Off)', callback_data: 'set_timer_0' },
        { text: '5 मिनट', callback_data: 'set_timer_5' },
        { text: '10 मिनट', callback_data: 'set_timer_10' }
      ],
      [
        { text: '15 मिनट', callback_data: 'set_timer_15' },
        { text: '30 मिनट', callback_data: 'set_timer_30' },
        { text: '60 मिनट', callback_data: 'set_timer_60' }
      ],
      [
        { text: '🔙 वापस जाएँ', callback_data: 'admin_refresh' }
      ]
    ];

    return ctx.editMessageText('⏱ <b>Auto-Delete टाइमर चुनें:</b>', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: timerKeyboard }
    });
  }

  if (data.startsWith('set_timer_')) {
    const minutes = parseInt(data.replace('set_timer_', ''));
    settings.autoDeleteMinutes = minutes;
    await settings.save();
    await ctx.answerCbQuery(`टाइमर ${minutes} मिनट पर सेट हुआ!`);
    return showAdminPanel(ctx);
  }

  if (data === 'admin_refresh') {
    await ctx.answerCbQuery('पैनल रिफ्रेश हो गया!');
    return showAdminPanel(ctx);
  }
}

module.exports = {
  showAdminPanel,
  handleAdminCallbacks
};
