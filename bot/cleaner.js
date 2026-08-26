const axios = require('axios');

function parseMediaInfo(rawText) {
    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
        return { cleanTitle: '', label: 'Standard Quality', isSeries: false, isDubbed: false, detectedYear: null };
    }

    let text = rawText.split('\n')[0].replace(/\.(mp4|mkv|avi|mov|zip|rar|\d{3})/gi, '');

    let yearMatch = text.match(/\b(19\d\d|20\d\d)\b/);
    let detectedYear = yearMatch ? yearMatch[0] : null;

    let isSeries = /(s\d+\s*e\d+|season\s*\d+|episode\s*\d+|ep\s*\d+|complete\s*series|web\s*series)/i.test(text);
    let isDubbed = /(hindi|dubbed|dual\s*audio)/i.test(text);

    let epMatch = text.match(/(s\d+\s*e\d+|season\s*\d+\s*ep\s*\d+|season\s*\d+|ep\s*\d+|episode\s*\d+|part\s*\d+|part\d+)/i);
    let episode = epMatch ? epMatch[0].toUpperCase() : '';

    let qualityMatch = text.match(/(2160p|4k|1080p|720p|480p|360p|240p|fhd|uhd|hd|sd)/i);
    let quality = qualityMatch ? qualityMatch[0].toUpperCase() : '';

    let codecMatch = text.match(/(hevc|x265|h[\s\._-]*265|x264|h[\s\._-]*264|10[\s\._-]*bit|8[\s\._-]*bit|hdr|bluray|blu[\s\._-]*ray|bdrip|web[\s\._-]*dl|webrip)/i);
    let codecInfo = codecMatch ? codecMatch[0].replace(/[\s\._-]+/g, '').toUpperCase() : '';

    let audioMatch = text.match(/(ddp[\s\._-]*5[\s\._-]*1|5[\s\._-]*1|2[\s\._-]*0|aac[\s\._-]*2[\s\._-]*0|aac|atmos|ac3)/i);
    let audioInfo = audioMatch ? audioMatch[0].replace(/[\s\._-]+/g, '.').toUpperCase() : '';

    let labelParts = [];
    if (episode) labelParts.push(episode);
    if (quality) labelParts.push(quality);
    if (codecInfo && !labelParts.includes(codecInfo)) labelParts.push(codecInfo);
    if (audioInfo && !labelParts.includes(audioInfo)) labelParts.push(audioInfo);
    let label = labelParts.length > 0 ? labelParts.join(' - ') : 'Standard Quality';

    // नाम साफ़ करने का सटीक क्रम (Blura और 10bi को पूरी तरह हटाने के लिए)
    let clean = text
        .replace(/\[.*?\]/g, ' ')
        .replace(/\(.*?\)/g, ' ')
        .replace(/(https?:\/\/[^\s]+|t\.me\/[^\s]+|www\.[^\s]+|@\w+)/gi, ' ')
        .replace(/[\._\-]/g, ' ')
        .replace(/\b(sample|preview|trailer|reloaded|version|uncut|extended|remastered)\b/gi, ' ')
        .replace(/\b(movies4u|bid|bolly4u|katmoviehd|vegamovies|filmyzilla|hdhub4u|uhdmovies|mkvcinemas|luxmovies|extramovies)\b/gi, ' ')
        .replace(/\b(blu\s*ray|bluray|bdrip|brrip|dvdrip|web\s*dl|webdl|webrip|hdrip|hdtc|predvd)\b/gi, ' ')
        .replace(/\b(10\s*bit|10bit|8\s*bit|8bit|hdr10|hdr|hevc|x265|x264|h265|h264|avc|remux|proper|hq)\b/gi, ' ')
        .replace(/\b(480p|720p|1080p|2160p|4k|fhd|uhd|hd|sd|360p|240p)\b/gi, ' ')
        .replace(/\b(ddp\s*5\s*1|5\s*1|2\s*0|aac\s*2\s*0|aac20|aac|dd\s*5\s*1|ddp20|ddp|dd|atmos|ac3)\b/gi, ' ')
        .replace(/\b(hindi|english|telugu|tamil|punjabi|korean|dubbed|multi|dual\s*audio|org|original|full|esub|subs?|subtitles?)\b/gi, ' ')
        .replace(/\b(south\s*movie|south|movie|complete\s*web\s*series|complete\s*series|web\s*series|series|combined|all\s*part|ds4k|ds|primex|prime|hotstar|zee5|sonyliv|jiocinema|clipmatezone|bulmoviee|bulmovie)\b/gi, ' ')
        .replace(/\b(v[0-9]|v\d+|hind|hin|eng|tam|tel|part\s*\d+|part\d+|line|lines|clean)\b/gi, ' ')
        .replace(/\b(s\d+\s*e\d+|season\s*\d+|ep\s*\d+|episode\s*\d+|s\d+|e\d+)\b/gi, ' ')
        .replace(/\b(19\d\d|20\d\d)\b/g, ' ')
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
    if (!TMDB_KEY || !title || title.trim().length < 2) return null;
    try {
        const endpoint = isSeries ? 'search/tv' : 'search/movie';
        const params = { api_key: TMDB_KEY, query: title.trim() };
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

        if (!res.data || !res.data.results || res.data.results.length === 0) {
            const altEndpoint = isSeries ? 'search/movie' : 'search/tv';
            res = await axios.get(`https://api.themoviedb.org/3/${altEndpoint}`, { params: { api_key: TMDB_KEY, query: title.trim() }, timeout: 6000 });
        }

        if (res.data && res.data.results && res.data.results.length > 0) {
            const results = res.data.results.filter(r => r.poster_path);
            let matched = results.find(r => (r.title || r.name || '').toLowerCase() === title.toLowerCase());

            if (!matched && results.length > 0) {
                results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
                matched = results[0];
            }

            if (!matched) matched = res.data.results[0];

            const releaseYear = (matched.release_date || matched.first_air_date || '').split('-')[0];
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
                year: releaseYear || year || '2026',
                category: tmdbCategory
            };
        }
    } catch (e) {
        console.error('[TMDB API Error]:', e.message);
    }
    return null;
}

module.exports = { parseMediaInfo, formatBytes, fetchTMDBData };
