const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    username: String,
    firstName: String,
    joinedAt: { type: Date, default: Date.now }
});

const fileItemSchema = new mongoose.Schema({
    label: String,
    fileId: String,
    fileType: String,
    fileSize: String,
    addedAt: { type: Date, default: Date.now }
});

const movieSchema = new mongoose.Schema({
    title: { type: String, required: true, index: true },
    poster: { type: String, default: '' },
    rating: { type: String, default: '8.0' },
    year: { type: String, default: '2026' },
    category: { type: String, default: 'Movie' },
    viewsCount: { type: Number, default: 0 },
    thumbFileId: String,
    files: [fileItemSchema],
    updatedAt: { type: Date, default: Date.now }
});

const configSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    value: mongoose.Schema.Types.Mixed
});

module.exports = {
    User: mongoose.model('User', userSchema),
    Movie: mongoose.model('Movie', movieSchema),
    Config: mongoose.model('Config', configSchema)
};
