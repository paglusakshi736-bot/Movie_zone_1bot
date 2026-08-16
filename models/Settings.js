const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  mainChannel: { type: String, default: '' },
  broadcastChannelId: { type: String, default: '' }, // index.js के साथ मैच करने के लिए
  discussionGroup: { type: String, default: '' },
  storageChannel: { type: String, default: '' },
  vipChannelLink: { type: String, default: '' },
  poweredByText: { type: String, default: 'Movie Zone' },
  backupButtonText: { type: String, default: 'Updates' },
  
  // ऑटो-ब्रॉडकास्टर सेटिंग्स
  autoBroadcast: { type: Boolean, default: true },
  broadcastMode: { type: String, default: 'smart' }, // smart, latest, high_rated, all
  maxDailyPosts: { type: Number, default: 8 },
  postIntervalHours: { type: Number, default: 2 },
  
  // ऑटो-डिलीट टाइमर (मिनटों में, 0 = बंद)
  autoDeleteMinutes: { type: Number, default: 15 },
  
  // डायरेक्ट क्रोम डाउनलोड टॉगल
  fastDownloadEnabled: { type: Boolean, default: true },
  
  // शॉर्टनर और कमाई सेटिंग्स
  shortenerEnabled: { type: Boolean, default: false },
  shortenerDomain: { type: String, default: '' },
  shortenerApi: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Settings', SettingsSchema);
