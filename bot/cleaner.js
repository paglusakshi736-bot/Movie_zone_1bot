const axios = require('axios');

function parseMediaInfo(rawText) {
    if (!rawText) return { cleanTitle: 'Movie ' + new Date().toLocaleDateString('en-GB'), label: 'Standard', detectedCat: 'Movie', detectedYear: '2026' };

    let text = rawText.split('\n')[0];
    text = text.replace(/[\._\-]/g, ' ');

    let yearMatch = text.match(/\b(19\d\d|20\d\d)\b/);
    let detectedYear = yearMatch ? yearMatch[0] : '2026';

    let isSeries = /(s\d+|season|episode|ep\s*\d+|complete\s*series|series|web\s*series)/i.test(text);
    let isHindi = /(hindi|dubbed)/i.test(text);
    let isSouth = /(telugu|tamil|kannada|malayalam)/i.test(text);

    let detectedCat = 'Movie';
    if (isSeries) detectedCat = 'Web Series';
    else if (isHindi) detectedCat = 'Hindi';
    else if (isSouth) detectedCat = 'South';

    let qualityMatch = text.match(/(480p|720p|1080p|2160p|4k|hd|sd)/i);
    let quality = qualityMatch ? qualityMatch[0].toUpperCase() : '';

    let codecMatch = text.match(/(hevc|x265|h[\s\._-]*265|x264|h[\s\._-]*264|10bit|hdr|ddp[\s\._-]*5[\s\._-]*1|5[\s\._-]*1|2[\s\._-]*0)/i);
    let codecInfo = codecMatch ? codecMatch[0].replace(/[\s\._-]+/g, '').toUpperCase() : '';

    let epMatch = text.match(/(s\d+\s*e\d+|season\s*\d+|ep\s*\d+|episode\s*\d+|s\d+|complete\s*series)/i);
    let episode = epMatch ? epMatch[0].toUpperCase() : '';

    let labelParts = [];
    if (episode) labelParts.push(episode);
    if (quality) labelParts.push(quality);
    if (codecInfo && !labelParts.includes(codecInfo)) labelParts.push(codecInfo);
    let label = labelParts.length > 0 ? labelParts.join(' - ') : 'Standard Quality';

    // साफ़ और सटीक टाइटल निकालना ताकि TMDB पर 100% सर्च मैच हो
    let clean = text
        .replace(/\[.*?\]/g, ' ')
        .replace(/\(.*?\)/g, ' ')
        .replace(/(https?:\/\/[^\s]+|t\.me\/[^\s]+|www\.[^\s]+|@\w+)/gi, ' ')
        .replace(/\.(mp4|mkv|avi|mov|zip|rar)/gi, ' ')
        .replace(/(480p|720p|1080p|2160p|4k|webdl|web-dl|web\s*dl|webrip|bluray|hdrip|dvdrip|predvd|hdtc|esub|subs?|subtitles?)/gi, ' ')
        .replace(/(x264|x265|hevc|h[\s\._-]*264|h[\s\._-]*265|avc|10bit|hdr|dv|aac2[\s\._-]*0|aac|amzn|ddp5[\s\._-]*1|ddp2[\s\._-]*0|ddp|dd\+|hindi|english|telugu|tamil|korean|dubbed|multi|paramount|official|hd|full|mkv|nf|uplay|complete\s*web\s*series|complete\s*series|web\s*series)/gi, ' ')
        .replace(/\b(s\d+|season\s*\d+|ep\s*\d+|episode\s*\d+)\b/gi, ' ')
        .replace(/\b(19\d\d|20\d\d)\b/g, ' ')
        .replace(/\b(2[\s\._-]*0|5[\s\._-]*1|7[\s\._-]*1)\b/gi, ' ')
        .replace(/\b265\b|\b264\b/gi, ' ')
        .replace(/\b[a-zA-Z]\b/g, ' ')
        .replace(/[^\w\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (clean.length < 2) clean = 'Movie ' + new Date().toLocaleDateString('en-GB');
    clean = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    return { cleanTitle: clean, label, detectedCat, detectedYear };
}

function formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes === 0) return '';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

async function fetchTMDBData(title) {
    const TMDB_KEY = process.env.TMDB_API_KEY;
    if (!TMDB_KEY) return null;
    try {
        const res = await axios.get(`https://api.themoviedb.org/3/search/multi`, {
            params: {
                api_key: TMDB_KEY,
                query: title
            },
            timeout: 5000
        });

        if (res.data && res.data.results && res.data.results.length > 0) {
            const first = res.data.results[0];
            const officialTitle = first.title || first.name || title;
            // प्रॉक्सी URL ताकि भारत के किसी भी नेटवर्क पर बिना ब्लॉक के पोस्टर दिखे
            const posterPath = first.poster_path ? `https://wsrv.nl/?url=https://image.tmdb.org/t/p/w500${first.poster_path}` : null;

            return {
                officialTitle: officialTitle,
                poster: posterPath,
                rating: first.vote_average ? first.vote_average.toFixed(1) : '8.0',
                year: (first.release_date || first.first_air_date || '').split('-')[0] || '2026'
            };
        }
    } catch (e) {
        console.error('[TMDB API Error]:', e.message);
    }
    return null;
}

module.exports = { parseMediaInfo, formatBytes, fetchTMDBData };
