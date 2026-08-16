const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  telegramId: { type: String },
  username: { type: String, default: '' },
  firstName: { type: String, default: '' },

  // VIP और प्रीमियम सिस्टम
  isVip: { type: Boolean, default: false },
  vipExpiresAt: { type: Date, default: null },

  // रेफरल पॉइंट्स
  referredBy: { type: String, default: null },
  referralPoints: { type: Number, default: 0 },

  // यूज़र वॉचलिस्ट (पसंदीदा मूवीज़ की IDs)
  watchlist: [{ type: String }],

  // 24 घंटे का शॉर्टनर पास टोकन
  verifyToken: { type: String, default: null },
  tokenCreatedAt: { type: Date, default: null },
  lastVerifiedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
