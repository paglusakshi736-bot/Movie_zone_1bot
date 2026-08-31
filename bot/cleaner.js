const axios = require('axios');

function parseMediaInfo(rawText) {
    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
        return { cleanTitle: 'Unnamed Media', label: 'Standard Quality', isSeries: false, isDubbed: false, detectedYear: null, isOther: true, needsFix: true };
    }

    let text = rawText.split('\n')[0].replace(/\.(mp4|mkv|avi|mov|zip|rar|\d{3})/gi, '');

    // 🚩 रैंडम हेक्स कोड चेक (जैसे 209e7f3cc17c4745b9109...)
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

    // ⚡ 1. सबसे पहले डॉट्स, अंडरस्कोर और ब्रैकेट्स को अलग-अलग शब्दों में बदलें
    // इससे Alpha.2026.720p.NF आपस में चिपकने के बजाय 'Alpha 2026 720p NF' बन जाएगा
    text = text
        .replace(/[\._\-]/g, ' ')
        .replace(/\[.*?\]/g, ' ')
        .replace(/\(.*?\)/g, ' ')
        .replace(/(https?:\/\/[^\s]+|t\.me\/[^\s]+|www\.[^\s]+|@\w+)/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // 2. लेबल के लिए मेटाडेटा (क्वालिटी, सीरीज़, ऑडियो) निकालें
    let yearMatch = text.match(/\b(19\d\d|20\d\d)\b/);
    let detectedYear = yearMatch ? yearMatch[0] : null;

    let isSeries = /(s\d+\s*e\d+|season\s*\d+|episode\s*\d+|ep\s*\d+|complete\s*series|web\s*series|c\s*\d+|c\d+)/i.test(text);
    let isDubbed = /(hindi|dubbed|dual\s*audio)/i.test(text);

    let epMatch = text.match(/(s\d+\s*e\d+|season\s*\d+\s*ep\s*\d+|season\s*\d+|ep\s*\d+|episode\s*\d+|c\s*\d+|c\d+|part\s*\d+|part\d+)/i);
    let episode = epMatch ? epMatch[0].toUpperCase() : '';

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

    // ⚡ 3. परफेक्ट एंकर कटिंग: साल, रेजोल्यूशन, सीज़न, या OTT कोड्स दिखते ही आगे का पूरा हिस्सा साफ़
    let anchorRegex = /\b(19\d\d|20\d\d|2160p|4k|1080p|720p|480p|360p|240p|s\d+|season|episode|ep\d+|complete|nf|netflix|amzn|prime|hotstar|zee5|sonyliv|jiocinema|aac|ddp|x264|x265|hevc|web\s*dl|bluray|hdrip)\b/i;
    let matchIdx = text.search(anchorRegex);
    if (matchIdx !== -1 && matchIdx > 2) {
        text = text.substring(0, matchIdx);
    }

    // 🧹 4. वेबसाइट वॉटरमार्क और अतिरिक्त सिंबल हटाकर शुद्ध टाइटल तैयार करें
    let clean = text
        .replace(/\b(sample|preview|trailer|reloaded|version|uncut|extended|remastered)\b/gi, ' ')
        .replace(/\b(movies4u|bid|bolly4u|katmoviehd|vegamovies|filmyzilla|hdhub4u|uhdmovies|mkvcinemas|luxmovies|extramovies)\b/gi, ' ')
        .replace(/\b(hindi|english|telugu|tamil|punjabi|korean|dubbed|multi|dual\s*audio|org|original|full|esubs?|esub|subs?|subtitles?)\b/gi, ' ')
        .replace(/\b(south\s*movie|south|movie)\b/gi, ' ')
        .replace(/[^\w\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

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

// 🎯 सुपर-एडवांस प्रोग्रेसिव TMDB इंजन
async function fetchTMDBData(title, year = null, isSeries = false) {
    const TMDB_KEY = process.env.TMDB_API_KEY;
    if (!TMDB_KEY || !title || title.trim().length < 2 || title.startsWith('Unknown_') || title === 'Unnamed Media') return null;

    // 1. नाम के अंत में बचे अनचाहे कोड्स हटाएँ
    let sanitized = title
        .replace(/\b(nf|netflix|amzn|prime|hotstar|zee5|sonyliv|jiocinema|aac\d*|ddp\d*|x264|x265|hevc|hd|rip|esub)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!sanitized) sanitized = title;

    // 2. प्रोग्रेसिव वर्ड्स एटेम्पट्स (पूरा नाम -> 1 शब्द कम -> 2 शब्द कम)
    let words = sanitized.split(/\s+/);
    let attempts = [];
    attempts.push(words.join(' '));
    if (words.length > 2) attempts.push(words.slice(0, -1).join(' '));
    if (words.length > 3) attempts.push(words.slice(0, -2).join(' '));
    if (words.length > 4) attempts.push(words.slice(0, -3).join(' '));

    attempts = [...new Set(attempts)];

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

            // अगर साल के साथ 0 रिज़ल्ट आए, तो साल हटाकर तुरंत सर्च करें
            if ((!res.data || !res.data.results || res.data.results.length === 0) && year) {
                delete params.primary_release_year;
                delete params.first_air_date_year;
                res = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, { params, timeout: 5000 });
            }

            // अगर प्राइमरी में न मिले, तो उल्टे एंडपॉइंट (Movie <-> TV) पर ऑटो-चेक करें
            if (!res.data || !res.data.results || res.data.results.length === 0) {
                const altEndpoint = isSeries ? 'search/movie' : 'search/tv';
                res = await axios.get(`https://api.themoviedb.org/3/${altEndpoint}`, { params: { api_key: TMDB_KEY, query: query.trim() }, timeout: 5000 });
            }

            if (res.data && res.data.results && res.data.results.length > 0) {
                // केवल वही चुनें जिनमें पोस्टर मौजूद हो
                let validResults = res.data.results.filter(r => r.poster_path);
                if (validResults.length === 0) validResults = res.data.results;

                let matched = validResults.find(r => (r.title || r.name || '').toLowerCase() === query.toLowerCase());
                if (!matched) {
                    validResults.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
                    matched = validResults[0];
                }

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
        } catch (e) {
            // अगले प्रयास पर जारी रखें
        }
    }

    return null;
}

module.exports = { parseMediaInfo, formatBytes, fetchTMDBData };
