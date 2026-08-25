const axios = require('axios');

function parseMediaInfo(rawText) {
    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
        return { cleanTitle: '', label: 'Standard Quality', isSeries: false, isDubbed: false, detectedYear: null };
    }

    let text = rawText.split('\n')[0].replace(/\.(mp4|mkv|avi|mov|zip|rar)/gi, '');

    let yearMatch = text.match(/\b(19\d\d|20\d\d)\b/);
    let detectedYear = yearMatch ? yearMatch[0] : null;

    let isSeries = /(s\d+|season|episode|ep\s*\d+|e\s*\d+|part\s*\d+|all\s*part|complete\s*series|series|web\s*series)/i.test(text);
    let isDubbed = /(hindi|dubbed|dual\s*audio)/i.test(text);

    let epMatch = text.match(/(s\d+\s*e\d+|season\s*\d+\s*ep\s*\d+|season\s*\d+|ep\s*\d+|episode\s*\d+|e\s*\d+|part\s*\d+|s\d+)/i);
    let episode = epMatch ? epMatch[0].toUpperCase() : '';

    if (!episode) {
        let trailingNumMatch = text.match(/(?:^|\s)(?:ep|e|part)?\s*([0-9]{1,2})\s*$/i);
        if (trailingNumMatch) {
            episode = `EP ${trailingNumMatch[1]}`;
            isSeries = true;
        }
    }

    let qualityMatch = text.match(/(2160p|4k|1080p|720p|480p|fhd|uhd|hd|sd)/i);
    let quality = qualityMatch ? qualityMatch[0].toUpperCase() : '';

    let codecMatch = text.match(/(hevc|x265|h[\s\._-]*265|x264|h[\s\._-]*264|10bit|hdr|ddp[\s\._-]*5[\s\._-]*1|5[\s\._-]*1|2[\s\._-]*0|ds4k|ds)/i);
    let codecInfo = codecMatch ? codecMatch[0].replace(/[\s\._-]+/g, '').toUpperCase() : '';

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
        .replace(/\b(480p|720p|1080p|2160p|4k|fhd|uhd|hd|sd|webdl|web-dl|web\s*dl|webrip|bluray|hdrip|dvdrip|predvd|hdtc|esub|subs?|subtitles?)\b/gi, ' ')
        .replace(/\b(x264|x265|hevc|h264|h265|avc|10bit|hdr|dv|aac20|aac|amzn|ddp51|ddp20|ddp|dd|hindi|english|telugu|tamil|punjabi|korean|dubbed|multi|dual\s*audio|org|original|full|mkv|nf|uplay|paramount|official|cinema|south\s*movie|south|movie|complete\s*web\s*series|complete\s*series|web\s*series|series|combined|all\s*part|part\s*\d+|ds4k|ds|primex|prime|hotstar|zee5|sonyliv|jiocinema|clipmatezone|bulmoviee|bulmovie)\b/gi, ' ')
        .replace(/\b(s\d+\s*e\d+|season\s*\d+|ep\s*\d+|episode\s*\d+|part\s*\d+|s\d+|e\d+)\b/gi, ' ')
        .replace(/\b(19\d\d|20\d\d)\b/g, ' ')
        .replace(/\b(20|51|71)\b/g, ' ')
        .replace(/\b265\b|\b264\b/gi, ' ')
        .replace(/\b[a-zA-Z0-9]{9,}\b/g, ' ')
        .replace(/\b[0-9]{1,2}$/g, ' ')
        .replace(/\b[a-zA-Z]\b/g, ' ')
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
            if (!year && releaseYear && parseInt(releaseYear) < 1980) return null;

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
