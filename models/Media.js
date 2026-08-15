const mongoose = require('mongoose');

const EpisodeSchema = new mongoose.Schema({
  seasonNumber: { type: Number, default: 1 },
  episodeNumber: { type: Number, required: true },
  fileId: { type: String, required: true },
  fileName: { type: String, default: '' },
  fileSize: { type: String, default: '' }
});

const MediaSchema = new mongoose.Schema({
  title: { type: String, required: true, index: true },
  cleanTitle: { type: String, default: '' },
  type: { type: String, enum: ['movie', 'series'], default: 'movie' },
  tmdbId: { type: Number, default: null },
  year: { type: Number, default: null },
  rating: { type: Number, default: 0 },
  genres: [{ type: String }],
  overview: { type: String, default: '' },
  poster: { type: String, default: '' },
  language: { type: String, default: 'hi' },
  isDubbed: { type: Boolean, default: false },
  
  // डाउनलोड / व्यू काउंट (Trending & Top 10 के लिए)
  viewsCount: { type: Number, default: 0 },
  downloadsCount: { type: Number, default: 0 },
  
  // फ़ाइल डेटा (मूवी के लिए)
  fileId: { type: String, default: null },
  fileName: { type: String, default: '' },
  fileSize: { type: String, default: '' },
  
  // वेब सीरीज़ के लिए एपिसोड्स लिस्ट
  episodes: [EpisodeSchema],
  
  // ऑटो-ब्रॉडकास्ट ट्रैकिंग
  isBroadcasted: { type: Boolean, default: false },
  broadcastedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Media', MediaSchema);
