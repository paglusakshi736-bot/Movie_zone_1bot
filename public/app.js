const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  tg.ready();
}

let allMedia = [];
let watchlist = JSON.parse(localStorage.getItem('user_watchlist') || '[]');
let currentCategory = 'all';
let searchQuery = '';
let currentSort = 'latest';

const mediaGrid = document.getElementById('media-grid');
const trendingSlider = document.getElementById('trending-slider');
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const catTabs = document.querySelectorAll('.cat-tab');
const sortFilter = document.getElementById('sort-filter');
const totalCountSpan = document.getElementById('total-count');
const modal = document.getElementById('media-modal');
const modalBody = document.getElementById('modal-body');
const modalClose = document.getElementById('modal-close');

// आपका लाइव Render डोमेन
const BASE_URL = 'https://movie-zone-1bot.onrender.com';

async function loadMedia() {
  try {
    const res = await fetch(`${BASE_URL}/api/media`);
    if (!res.ok) throw new Error('Network error');
    
    allMedia = await res.json();
    
    if (totalCountSpan) {
      totalCountSpan.innerText = allMedia.length;
    }

    if (!allMedia || allMedia.length === 0) {
      if (mediaGrid) {
        mediaGrid.innerHTML = '<p style="grid-column: span 2; text-align:center; color:#aaa; padding: 40px 20px;">डेटाबेस में कोई मूवी नहीं मिली। बॉट में नई फाइल भेजें!</p>';
      }
      return;
    }

    renderTrending(allMedia);
    renderGrid();
  } catch (err) {
    console.error('Error fetching media:', err);
    if (mediaGrid) {
      mediaGrid.innerHTML = '<p style="grid-column: span 2; text-align:center; color:#ff4d4d; padding: 40px 20px;">डेटा लोड करने में त्रुटि! कृपया ऐप दोबारा खोलें।</p>';
    }
  }
}

function renderTrending(items) {
  if (!trendingSlider) return;
  const top10 = [...items]
    .sort((a, b) => (b.viewsCount || b.downloadsCount || 0) - (a.viewsCount || a.downloadsCount || 0))
    .slice(0, 10);

  if (top10.length === 0) {
    if (trendingSlider.parentElement) trendingSlider.parentElement.style.display = 'none';
    return;
  }

  if (trendingSlider.parentElement) trendingSlider.parentElement.style.display = 'block';
  trendingSlider.innerHTML = top10.map((item, index) => `
    <div class="trending-card" onclick="openDetails('${item._id}')">
      <span class="rank-badge">#${index + 1}</span>
      <img src="${item.poster || 'https://placehold.co/400x600/161b22/e50914?text=Poster'}" alt="${item.title}" loading="lazy">
    </div>
  `).join('');
}

function renderGrid() {
  if (!mediaGrid) return;

  let filtered = allMedia.filter(item => {
    const title = (item.title || '').toLowerCase();
    const matchesSearch = title.includes(searchQuery.toLowerCase());
    let matchesCat = true;

    if (currentCategory === 'movie') matchesCat = item.type === 'movie';
    else if (currentCategory === 'series') matchesCat = item.type === 'series';
    else if (currentCategory === 'hindi' || currentCategory === 'hindi-dubbed') {
      matchesCat = title.includes('hindi') || (item.genres && item.genres.includes('Hindi'));
    }
    else if (currentCategory === 'watchlist') matchesCat = watchlist.includes(item._id);

    return matchesSearch && matchesCat;
  });

  // Sorting
  if (currentSort === 'rating') {
    filtered.sort((a, b) => parseFloat(b.rating || 0) - parseFloat(a.rating || 0));
  } else if (currentSort === '2026') {
    filtered = filtered.filter(i => String(i.year) === '2026');
  } else if (currentSort === '2025') {
    filtered = filtered.filter(i => String(i.year) === '2025');
  } else if (currentSort === '2024') {
    filtered = filtered.filter(i => String(i.year) === '2024');
  } else if (currentSort === 'older') {
    filtered = filtered.filter(i => parseInt(i.year || 0) < 2024);
  }

  if (filtered.length === 0) {
    mediaGrid.innerHTML = `<p style="grid-column: span 2; text-align:center; color:#777; padding: 30px 0;">कोई मूवी नहीं मिली।</p>`;
    return;
  }

  mediaGrid.innerHTML = filtered.map(item => {
    const isFav = watchlist.includes(item._id);
    return `
      <div class="media-card">
        <button class="fav-btn ${isFav ? 'active' : ''}" onclick="toggleWatchlist(event, '${item._id}')">
          <i class="fa-solid fa-heart"></i>
        </button>
        <div class="poster-wrap" onclick="openDetails('${item._id}')">
          <img src="${item.poster || 'https://placehold.co/400x600/161b22/e50914?text=Poster'}" alt="${item.title}" loading="lazy">
          <span class="card-rating">⭐ ${item.rating ? item.rating : '8.0'}</span>
        </div>
        <div class="card-info">
          <h4 class="card-title" onclick="openDetails('${item._id}')">${item.title}</h4>
          <div class="card-meta">📅 ${item.year || '2026'} | ${item.type === 'series' ? 'Web Series' : 'Movie'}</div>
          <button class="get-btn" onclick="openDetails('${item._id}')">View & Play</button>
        </div>
      </div>
    `;
  }).join('');
}

function toggleWatchlist(e, id) {
  e.stopPropagation();
  if (watchlist.includes(id)) {
    watchlist = watchlist.filter(item => item !== id);
  } else {
    watchlist.push(id);
  }
  localStorage.setItem('user_watchlist', JSON.stringify(watchlist));
  renderGrid();
}

function openDetails(id) {
  const item = allMedia.find(m => m._id === id);
  if (!item || !modal || !modalBody) return;

  const botUsername = 'Movie_zone_1bot';
  const botDeepLink = `https://t.me/${botUsername}?start=media_${item._id}`;
  const streamUrl = `${BASE_URL}/api/stream/${item._id}`;
  const fastDlUrl = `${BASE_URL}/api/fast-download/${item._id}`;

  modalBody.innerHTML = `
    <div style="text-align: center; margin-bottom: 15px;">
      <img src="${item.poster || 'https://placehold.co/400x600/161b22/e50914?text=Poster'}" style="width: 140px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
      <h3 style="margin-top: 10px; color: #fff;">${item.title || 'Movie'}</h3>
      <p style="color: #aaa; font-size: 13px;">⭐ ${item.rating || '8.0'} | 📅 ${item.year || '2026'}</p>
    </div>

    <div id="video-container" style="display:none; margin-bottom: 15px;">
      <video id="html5-player" controls width="100%" style="border-radius: 8px; background:#000;">
        <source id="video-source" src="" type="video/mp4">
        आपका ब्राउज़र वीडियो सपोर्ट नहीं करता।
      </video>
    </div>

    <div style="display: flex; flex-direction: column; gap: 10px;">
      <button onclick="playOnlineVideo('${streamUrl}')" class="dl-btn" style="background: #28a745; border: none; padding: 10px; border-radius: 6px; color: #fff; font-weight: bold; cursor: pointer;">
        <i class="fa-solid fa-play"></i> Watch Online (In-App Player)
      </button>
      <a href="${fastDlUrl}" target="_blank" class="dl-btn" style="background: #007bff; text-decoration: none; text-align: center; padding: 10px; border-radius: 6px; color: #fff; font-weight: bold;">
        <i class="fa-brands fa-chrome"></i> Fast Download (Chrome)
      </a>
      <button onclick="downloadViaBot('${botDeepLink}')" class="dl-btn" style="background: #229ED9; border: none; padding: 10px; border-radius: 6px; color: #fff; font-weight: bold; cursor: pointer;">
        <i class="fa-brands fa-telegram"></i> Get Telegram File
      </button>
    </div>
  `;
  modal.style.display = 'flex';
}

function downloadViaBot(link) {
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(link);
  } else {
    window.open(link, '_blank');
  }
}

function playOnlineVideo(streamUrl) {
  const videoContainer = document.getElementById('video-container');
  const player = document.getElementById('html5-player');
  const source = document.getElementById('video-source');

  if (!videoContainer || !player || !source) return;

  if (window.Adgram && typeof window.Adgram.showAd === 'function') {
    window.Adgram.showAd({
      onAdClosed: () => {
        startStreaming(videoContainer, player, source, streamUrl);
      }
    });
  } else {
    startStreaming(videoContainer, player, source, streamUrl);
  }
}

function startStreaming(container, player, source, streamUrl) {
  container.style.display = 'block';
  source.src = streamUrl;
  player.load();
  player.play();
}

if (modalClose) {
  modalClose.onclick = () => {
    const player = document.getElementById('html5-player');
    if (player) player.pause();
    modal.style.display = 'none';
  };
}

if (searchInput) {
  searchInput.oninput = (e) => {
    searchQuery = e.target.value;
    if (clearSearchBtn) clearSearchBtn.style.display = searchQuery ? 'block' : 'none';
    renderGrid();
  };
}

if (clearSearchBtn) {
  clearSearchBtn.onclick = () => {
    searchInput.value = '';
    searchQuery = '';
    clearSearchBtn.style.display = 'none';
    renderGrid();
  };
}

if (sortFilter) {
  sortFilter.onchange = (e) => {
    currentSort = e.target.value;
    renderGrid();
  };
}

catTabs.forEach(tab => {
  tab.onclick = () => {
    catTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCategory = tab.dataset.category;
    renderGrid();
  };
});

// ऐप शुरू होना
loadMedia();
