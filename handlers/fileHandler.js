const Media = require('../models/Media');
const Settings = require('../models/Settings');
const { searchTMDb } = require('../utils/tmdb');
const { broadcastNewMedia } = require('../utils/broadcaster');
const { parseSeriesInfo } = require('../utils/seriesParser');

const fileQueue = [];
let isProcessingQueue = false;

async function processQueue(bot) {
  if (isProcessingQueue || fileQueue.length === 0) return;

  isProcessingQueue = true;
  const item = fileQueue.shift();

  try {
    const { message, settings } = item;
    const document = message.document || message.video;
    const rawFileName = document.file_name || message.caption || 'Unknown Media';
    const fileId = document.file_id;
    const fileSize = (document.file_size / (1024 * 1024)).toFixed(1) + ' MB';

    const parsed = parseSeriesInfo(rawFileName);

    if (parsed.isSeries) {
      const tmdbData = await searchTMDb(parsed.seriesTitle, 'series');
      const seriesTitle = tmdbData ? tmdbData.title : parsed.seriesTitle;

      let media = await Media.findOne({ cleanTitle: seriesTitle.toLowerCase(), type: 'series' });

      if (!media) {
        media = new Media({
          title: seriesTitle,
          cleanTitle: seriesTitle.toLowerCase(),
          type: 'series',
          tmdbId: tmdbData?.tmdbId || null,
          year: tmdbData?.year || new Date().getFullYear(),
          rating: tmdbData?.rating || 0,
          genres: tmdbData?.genres || [],
          overview: tmdbData?.overview || 'Web series episodes.',
          poster: tmdbData?.poster || '',
          episodes: [{
            seasonNumber: parsed.seasonNumber,
            episodeNumber: parsed.episodeNumber,
            fileId: fileId,
            fileName: rawFileName,
            fileSize: fileSize
          }]
        });
        await media.save();
        await broadcastNewMedia(bot, media, settings);
      } else {
        const alreadyExists = media.episodes.some(
          ep => ep.seasonNumber === parsed.seasonNumber && ep.episodeNumber === parsed.episodeNumber
        );

        if (!alreadyExists) {
          media.episodes.push({
            seasonNumber: parsed.seasonNumber,
            episodeNumber: parsed.episodeNumber,
            fileId: fileId,
            fileName: rawFileName,
            fileSize: fileSize
          });
          media.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
          await media.save();
        }
      }
    } else {
      const tmdbData = await searchTMDb(parsed.seriesTitle, 'movie');
      const movieTitle = tmdbData ? tmdbData.title : parsed.seriesTitle;

      let media = await Media.findOne({ cleanTitle: movieTitle.toLowerCase(), type: 'movie' });

      if (!media) {
        media = new Media({
          title: movieTitle,
          cleanTitle: movieTitle.toLowerCase(),
          type: 'movie',
          tmdbId: tmdbData?.tmdbId || null,
          year: tmdbData?.year || null,
          rating: tmdbData?.rating || 0,
          genres: tmdbData?.genres || [],
          overview: tmdbData?.overview || 'Full Movie File.',
          poster: tmdbData?.poster || '',
          fileId: fileId,
          fileName: rawFileName,
          fileSize: fileSize
        });
        await media.save();
        await broadcastNewMedia(bot, media, settings);
      }
    }
  } catch (error) {
    console.error('[File Processing Error]:', error.message);
  } finally {
    isProcessingQueue = false;
    setTimeout(() => processQueue(bot), 1500);
  }
}

async function handleIncomingFile(ctx) {
  const settings = await Settings.findOne() || {};
  fileQueue.push({ message: ctx.message, settings });
  processQueue(ctx.telegram);
}

module.exports = { handleIncomingFile };
