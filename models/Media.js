const mongoose = require('mongoose');

const FileQualitySchema = new mongoose.Schema({
  quality: { type: String, default: 'HD' }, // 480p, 720p, 1080p, 4K
  fileId: { type: String, required: true },
  fileName: { type: String, default: '' },
  fileSize: { type: String, default: '' }
});

const EpisodeSchema = new mongoose.Schema({
  seasonNumber: { type: Number, default: 1 },
  episodeNumber: { type: Number, required: true },
  files: [FileQualitySchema]
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

  // डाउनलोड / व्यू काउंट (Trending & Top 10)
  viewsCount: { type: Number, default: 0 },
  downloadsCount: { type: Number, default: 0 },

  // मूवी के लिए मल्टी-क्वालिटी फाइल्स (480p, 720p, 1080p)
  files: [FileQualitySchema],

  // वेब सीरीज़ के एपिसोड्स लिस्ट
  episodes: [EpisodeSchema],

  // ऑटो-ब्रॉडकास्ट ट्रैकिंग
  isBroadcasted: { type: Boolean, default: false },
  broadcastedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Media', MediaSchema);
