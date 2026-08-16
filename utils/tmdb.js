const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

const DEFAULT_POSTER = 'https://placehold.co/500x750/111827/ffffff?text=Movie+Zone';

function cleanFileName(rawName) {
  if (!rawName) return '';
  
  let clean = rawName
    .replace(/\.[^/.]+$/, '')
    .replace(/@\w+/g, '')
    .replace(/\[.*?\]|\(.*?\)/g, '')
    .replace(/1080p|720p|480p|2160p|4k|hdrip|webrip|web-dl|bluray|x264|x265|hevc|aac|dual\s*audio|hindi|english/gi, '')
    .replace(/[\._\-]/g, ' ')
    .trim();

  const yearMatch = clean.match(/\b(19\d\d|20\d\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
  
  if (year) {
    clean = clean.replace(year.toString(), '').trim();
  }

  return { queryTitle: clean, year };
}

async function fetchTmdbMetadata(rawTitle, mediaType = 'movie') {
  const { queryTitle, year } = cleanFileName(rawTitle);
  
  if (!queryTitle || !TMDB_API_KEY) {
    return {
      title: queryTitle || rawTitle,
      year: year || null,
      rating: 0,
      genres: ['Other'],
      poster: DEFAULT_POSTER,
      overview: 'No description available.',
      tmdbId: null
    };
  }

  try {
    const endpoint = mediaType === 'series' ? '/search/tv' : '/search/movie';
    const params = {
      api_key: TMDB_API_KEY,
      query: queryTitle,
      language: 'en-US'
    };

    if (year) {
      if (mediaType === 'series') params.first_air_date_year = year;
      else params.year = year;
    }

    const response = await axios.get(`${TMDB_BASE_URL}${endpoint}`, { params });
    const result = response.data.results && response.data.results[0];

    if (!result) {
      return {
        title: queryTitle,
        year: year || null,
        rating: 0,
        genres: ['Action', 'Entertainment'],
        poster: DEFAULT_POSTER,
        overview: 'Auto-indexed file in Movie Zone.',
        tmdbId: null
      };
    }

    const genreMap = {
      28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
      99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
      27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
      53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10765: 'Sci-Fi & Fantasy'
    };

    const genres = (result.genre_ids || []).map(id => genreMap[id] || 'Movie').slice(0, 3);

    return {
      title: result.title || result.name || queryTitle,
      year: result.release_date ? parseInt(result.release_date.split('-')[0], 10) : (result.first_air_date ? parseInt(result.first_air_date.split('-')[0], 10) : year),
      rating: result.vote_average ? parseFloat(result.vote_average.toFixed(1)) : 0,
      genres: genres.length > 0 ? genres : ['Cinema'],
      poster: result.poster_path ? `${IMAGE_BASE_URL}${result.poster_path}` : DEFAULT_POSTER,
      overview: result.overview || 'Enjoy high quality stream and download on Movie Zone.',
      tmdbId: result.id
    };
  } catch (error) {
    return {
      title: queryTitle,
      year: year || null,
      rating: 0,
      genres: ['Cinema'],
      poster: DEFAULT_POSTER,
      overview: 'Movie Zone Media.',
      tmdbId: null
    };
  }
}

module.exports = { cleanFileName, fetchTmdbMetadata, fetchTMDbDetails: fetchTmdbMetadata };


