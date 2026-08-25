const axios = require('axios');

function parseMediaInfo(rawText) {
    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
        return { cleanTitle: '', label: 'Standard Quality', isSeries: false, isDubbed: false, detectedYear: null };
    }

    let text = rawText.split('\n')[0].replace(/\.(mp4|mkv|avi|mov|zip|rar)/gi, '');

    // साल निकालना (1900-2099)
    let yearMatch = text.match(/\b(19\d\d|20\d\d)\b/);
    let detectedYear = yearMatch ? yearMatch[0] : null;

    let isSeries = /(s\d+|season|episode|ep\s*\d+|complete\s*series|series|web\s*series|all\s*part|part\s*\d+|ds)/i.test(text);
    let isDubbed = /(hindi|dubbed|dual\s*audio)/i.test(text);

    let qualityMatch = text.match(/(480p|720p|1080p|2160p|4k|hd|sd)/i);
    let quality = qualityMatch ? qualityMatch[0].toUpperCase() : '';

    let codecMatch = text.match(/(hevc|x265|h[\s\._-]*265|x264|h[\s\._-]*264|10bit|hdr|ddp[\s\._-]*5[\s\._-]*1|5[\s\._-]*1|2[\s\._-]*0)/i);
    let codecInfo = codecMatch ? codecMatch[0].replace(/[\s\._-]+/g, '').toUpperCase() : '';

    let epMatch = text.match(/(s\d+\s*e\d+|season\s*\d+|ep\s*\d+|episode\s*\d+|s\d+|complete\s*series|all\s*part)/i);
    let episode = epMatch ? epMatch[0].toUpperCase() : '';

    let labelParts = [];
    if (episode) labelParts.push(episode);
    if (quality) labelParts.push(quality);
    if (codecInfo && !labelParts.includes(codecInfo)) labelParts.push(codecInfo);
    let label = labelParts.length > 0 ? labelParts.join(' - ') : 'Standard Quality';

    let clean = text
        .replace(/\[.*?\]/g, ' ')
        .replace(/\(.*?\)/g, ' ')
        .replace(/[\._\-]/g, ' ')
        .replace(/(https?:\/\/[^\s]+|t\.me\/[^\s]+|www\.[^\s]+|@\w+)/gi, ' ')
        .replace(/(480p|720p|1080p|2160p|4k|webdl|web-dl|web\s*dl|webrip|bluray|hdrip|dvdrip|predvd|hdtc|esub|subs?|subtitles?)/gi, ' ')
        .replace(/(x264|x265|hevc|h[\s\._-]*264|h[\s\._-]*265|avc|10bit|hdr|dv|aac2[\s\._-]*0|aac|amzn|ddp5[\s\._-]*1|ddp2[\s\._-]*0|ddp|dd\+|hindi|english|telugu|tamil|korean|dubbed|multi|dual\s*audio|org|original|hq|hd|full|mkv|nf|uplay|paramount|official|cinema|south\s*movie|south|movie|complete\s*web\s*series|complete\s*series|web\s*series|series|combined|all\s*part|part\s*\d+|ds)/gi, ' ')
        .replace(/\b(s\d+|season\s*\d+|ep\s*\d+|episode\s*\d+)\b/gi, ' ')
        .replace(/\b(19\d\d|20\d\d)\b/g, ' ')
        .replace(/\b(2[\s\._-]*0|5[\s\._-]*1|7[\s\._-]*1)\b/gi, ' ')
        .replace(/\b265\b|\b264\b/gi, ' ')
        .replace(/\b[a-zA-Z0-9]{8,}\b/g, ' ')
        .replace(/[^\w\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    clean = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    return { cleanTitle: clean, label, isSeries, isDubbed, detectedYear: detectedYear || null };
}

function formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes === 0) return '';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

async function fetchTMDBData(title, year = null, isSeries = false) {
    const TMDB_KEY = process.env.TMDB_API_KEY;
    if (!TMDB_KEY || !title) return null;
    try {
        const endpoint = isSeries ? 'search/tv' : 'search/movie';
        const params = { api_key: TMDB_KEY, query: title };
        if (year) {
            if (isSeries) params.first_air_date_year = year;
            else params.primary_release_year = year;
        }

        let res = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, { params, timeout: 6000 });

        if ((!res.data || !res.data.results || res.data.results.length === 0) && year) {
            delete params.primary_release_year;
            delete params.first_air_date_year;
            res = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, { params, timeout: 6000 });
        }

        if (res.data && res.data.results && res.data.results.length > 0) {
            const results = res.data.results.filter(r => r.poster_path);
            let matched = results.find(r => (r.title || r.name || '').toLowerCase() === title.toLowerCase());

            if (!matched && results.length > 0) {
                results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
                matched = results[0];
            }

            if (!matched) matched = res.data.results[0];

            const officialTitle = matched.title || matched.name || title;
            const posterPath = matched.poster_path ? `https://image.tmdb.org/t/p/w500${matched.poster_path}` : null;
            const lang = (matched.original_language || '').toLowerCase();

            let tmdbCategory = isSeries ? 'Web Series' : 'Movie';
            if (!isSeries) {
                if (lang === 'en') tmdbCategory = 'Hollywood';
                else if (lang === 'hi') tmdbCategory = 'Hindi';
                else if (['te', 'ta', 'ml', 'kn'].includes(lang)) tmdbCategory = 'South';
            }

            return {
                officialTitle: officialTitle,
                poster: posterPath,
                rating: matched.vote_average ? matched.vote_average.toFixed(1) : '8.0',
                year: (matched.release_date || matched.first_air_date || '').split('-')[0] || year || '2026',
                category: tmdbCategory
            };
        }
    } catch (e) {
        console.error('[TMDB API Error]:', e.message);
    }
    return null;
}

module.exports = { parseMediaInfo, formatBytes, fetchTMDBData };
