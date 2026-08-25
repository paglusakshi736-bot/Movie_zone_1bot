const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    username: { type: String, default: '' },
    firstName: { type: String, default: '' },
    referredBy: { type: String, default: null },
    referralCount: { type: Number, default: 0 },
    availableCredits: { type: Number, default: 0 },
    lastRequestDate: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

const movieSchema = new mongoose.Schema({
    title: { type: String, required: true },
    poster: { type: String, default: null },
    rating: { type: String, default: '8.0' },
    year: { type: String, default: '2026' },
    category: { type: String, default: 'Movie' },
    thumbFileId: { type: String, default: null },
    files: [{
        label: String,
        fileId: String,
        fileType: String,
        fileSize: String
    }],
    updatedAt: { type: Date, default: Date.now }
});

const configSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
});

const User = mongoose.model('User', userSchema);
const Movie = mongoose.model('Movie', movieSchema);
const Config = mongoose.model('Config', configSchema);

module.exports = { User, Movie, Config };
