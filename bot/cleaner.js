const axios = require('axios');

function parseMediaInfo(rawText) {
    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
        return { cleanTitle: 'Unnamed Media', label: 'Standard Quality', isSeries: false, isDubbed: false, detectedYear: null, isOther: true, needsFix: true };
    }

    // ⚡ 1. बॉर्डर/बॉक्स वाली खाली लाइनों को छोड़ें और असली टेक्स्ट वाली पहली लाइन ढूंढें
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let targetLine = lines.find(l => /[a-zA-Z0-9]/.test(l)) || lines[0] || '';

    let text = targetLine.replace(/\.(mp4|mkv|avi|mov|zip|rar|\d{3})/gi, '');

    // 🚩 रैंडम हेक्स कोड चेक
    const isRandomHex = /^[a-f0-9]{14,}$/i.test(text.trim()) || /^[a-z0-9_-]{18,}$/i.test(text.trim());
    if (isRandomHex) {
        const shortCode = text.trim().substring(0, 10);
        return {
            cleanTitle: `Unknown_${shortCode}`,
            label: 'Original File',
            isSeries: false,
            isDubbed: false,
            detectedYear: '2026',
            isOther: true,
            needsFix: false
        };
    }

    // ⚡ 2. इमोजी, स्पेशल सिंबल्स, बॉर्डर्स और लिंक्स साफ़ करें
    let normalized = text
        .replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, ' ')
        .replace(/[┏┓┗┛━┃│─]/g, ' ')
        .replace(/[\[\(\{].*?[\]\)\}]/g, ' ')
        .replace(/(https?:\/\/[^\s]+|t\.me\/[^\s]+|www\.[^\s]+|@\w+)/gi, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // 3. लेबल्स (सीरीज़, क्वालिटी, ऑडियो) निकालें
    let yearMatch = text.match(/\b(19\d\d|20\d\d)\b/);
    let detectedYear = yearMatch ? yearMatch[0] : null;

    let isSeries = /(s\d+\s*e\d+|season\s*\d+|episode\s*\d+|ep\s*\d+|complete\s*series|web\s*series|c\s*\d+|c\d+)/i.test(text);
    let isDubbed = /(hindi|dubbed|dual\s*audio)/i.test(text);

    let epMatch = text.match(/(s\d+\s*e\d+[\s\-_]*\d*|season\s*\d+\s*ep\s*\d+[\s\-_]*\d*|season\s*\d+|ep\s*\d+|episode\s*\d+|c\s*\d+|c\d+|part\s*\d+|part\d+)/i);
    let episode = epMatch ? epMatch[0].replace(/[\(\)\[\]]/g, '').trim().toUpperCase() : '';

    let qualityMatch = text.match(/\b(2160p|4k|1080p|720p|480p|360p|240p|fhd|uhd|hd|sd)\b/i);
    let quality = qualityMatch ? qualityMatch[0].toUpperCase() : '';

    let codecMatch = text.match(/\b(hevc|x265|h[\s]*265|x264|h[\s]*264|10[\s]*bit|8[\s]*bit|hdr|bluray|blu[\s]*ray|bdrip|web[\s]*dl|webrip)\b/i);
    let codecInfo = codecMatch ? codecMatch[0].replace(/[\s\._-]+/g, '').toUpperCase() : '';

    let audioMatch = text.match(/\b(ddp[\s]*5[\s]*1|5[\s]*1|2[\s]*0|aac[\s]*2[\s]*0|aac[\s]*5[\s]*1|aac|atmos|ac3)\b/i);
    let audioInfo = audioMatch ? audioMatch[0].replace(/[\s\._-]+/g, '.').toUpperCase() : '';

    let labelParts = [];
    if (episode) labelParts.push(episode);
    if (quality) labelParts.push(quality);
    if (codecInfo && !labelParts.includes(codecInfo)) labelParts.push(codecInfo);
    if (audioInfo && !labelParts.includes(audioInfo)) labelParts.push(audioInfo);
    let label = labelParts.length > 0 ? labelParts.join(' - ') : 'Standard Quality';

    // ⚡ 4. टोकन स्टॉप (S01, 2023, 720p दिखते ही आगे का सब कट)
    const stopPattern = /^(19\d\d|20\d\d|2160p|4k|1080p|720p|480p|360p|240p|fhd|uhd|hd|sd|s\d+|s\d+e\d+|season|episode|ep\d+|complete|nf|netflix|amzn|prime|hotstar|zee5|sonyliv|jiocinema|aac|ddp|x264|x265|hevc|web|bluray|hdrip|hindi|english|telugu|tamil|punjabi|dubbed|dual)$/i;

    let words = normalized.split(/\s+/);
    let titleWords = [];

    for (let w of words) {
        if (stopPattern.test(w)) {
            break;
        }
        titleWords.push(w);
    }

    let clean = titleWords.join(' ')
        .replace(/\b(sample|preview|trailer|reloaded|version|uncut|extended|remastered)\b/gi, ' ')
        .replace(/\b(movies4u|bid|bolly4u|katmoviehd|vegamovies|filmyzilla|hdhub4u|uhdmovies|mkvcinemas|luxmovies|extramovies)\b/gi, ' ')
        .replace(/\b(south\s*movie|south|movie)\b/gi, ' ')
        .replace(/[^\w\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!clean || clean.length < 2) {
        clean = normalized.replace(/\b(2160p|1080p|720p|480p|hevc|x264|x265|aac)\b/gi, '').trim();
    }

    clean = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    return { 
        cleanTitle: clean || 'Unnamed Media', 
        label, 
        isSeries, 
        isDubbed, 
        detectedYear: detectedYear || null,
        isOther: false,
        needsFix: false
    };
}

function formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes === 0) return '';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

// 🎯 TMDB इंजन
async function fetchTMDBData(title, year = null, isSeries = false) {
    const TMDB_KEY = process.env.TMDB_API_KEY;
    if (!TMDB_KEY || !title || title.trim().length < 2 || title.startsWith('Unknown_') || title === 'Unnamed Media') return null;

    let sanitized = title.trim();
    let words = sanitized.split(/\s+/);
    let attempts = [sanitized];
    if (words.length >= 4) {
        attempts.push(words.slice(0, -1).join(' '));
    }

    for (let query of attempts) {
        if (!query || query.length < 2) continue;

        try {
            const endpoint = isSeries ? 'search/tv' : 'search/movie';
            let params = { api_key: TMDB_KEY, query: query.trim() };
            if (year) {
                if (isSeries) params.first_air_date_year = year;
                else params.primary_release_year = year;
            }

            let res = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, { params, timeout: 5000 });

            if ((!res.data || !res.data.results || res.data.results.length === 0) && year) {
                delete params.primary_release_year;
                delete params.first_air_date_year;
                res = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, { params, timeout: 5000 });
            }

            if (!res.data || !res.data.results || res.data.results.length === 0) {
                const altEndpoint = isSeries ? 'search/movie' : 'search/tv';
                res = await axios.get(`https://api.themoviedb.org/3/${altEndpoint}`, { params: { api_key: TMDB_KEY, query: query.trim() }, timeout: 5000 });
            }

            if (res.data && res.data.results && res.data.results.length > 0) {
                let validResults = res.data.results.filter(r => r.poster_path);
                if (validResults.length === 0) validResults = res.data.results;

                let qLower = query.toLowerCase();
                let matched = validResults.find(r => {
                    let rTitle = (r.title || r.name || '').toLowerCase();
                    return rTitle === qLower || rTitle.includes(qLower) || qLower.includes(rTitle);
                });

                if (!matched) {
                    let top = validResults[0];
                    let topTitle = (top.title || top.name || '').toLowerCase();
                    if (topTitle.includes(words[0].toLowerCase())) {
                        matched = top;
                    }
                }

                if (!matched) continue;

                const rawReleaseDate = matched.release_date || matched.first_air_date || null;
                const releaseYear = rawReleaseDate ? rawReleaseDate.split('-')[0] : null;
                const officialTitle = matched.title || matched.name || query;
                const posterPath = matched.poster_path ? `https://image.tmdb.org/t/p/w500${matched.poster_path}` : null;
                const lang = (matched.original_language || '').toLowerCase();

                let tmdbCategory = (matched.name && !matched.title) ? 'Web Series' : (isSeries ? 'Web Series' : 'Movie');
                if (tmdbCategory !== 'Web Series') {
                    if (lang === 'en') tmdbCategory = 'Hollywood';
                    else if (lang === 'hi') tmdbCategory = 'Hindi';
                    else if (['te', 'ta', 'ml', 'kn'].includes(lang)) tmdbCategory = 'South';
                }

                return {
                    officialTitle: officialTitle,
                    poster: posterPath,
                    rating: matched.vote_average ? matched.vote_average.toFixed(1) : '8.0',
                    year: releaseYear || year || '2026',
                    releaseDate: rawReleaseDate,
                    category: tmdbCategory
                };
            }
        } catch (e) {}
    }

    return null;
}

module.exports = { parseMediaInfo, formatBytes, fetchTMDBData };
