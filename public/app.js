const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  tg.ready();
}

let allMedia = [];
let watchlist = JSON.parse(localStorage.getItem('user_watchlist') || '[]');
let currentCategory = 'all';
let searchQuery = '';

const mediaGrid = document.getElementById('media-grid');
const trendingSlider = document.getElementById('trending-slider');
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const catTabs = document.querySelectorAll('.cat-tab');
const watchlistToggle = document.getElementById('watchlist-toggle');
const modal = document.getElementById('media-modal');
const modalBody = document.getElementById('modal-body');
const modalClose = document.getElementById('modal-close');

async function loadMedia() {
  const container = document.getElementById('media-grid') || document.getElementById('moviesContainer');
  try {
    const res = await fetch('/api/media');
    if (!res.ok) throw new Error('Network response was not ok');
    
    allMedia = await res.json();
    
    // अगर डेटाबेस में कोई मूवी नहीं है
    if (!allMedia || allMedia.length === 0) {
      if (container) {
        container.innerHTML = '<p style="grid-column: span 2; text-align:center; color:#aaa; padding: 20px;">अभी कोई मूवी उपलब्ध नहीं है। बॉट में फ़ाइल अपलोड करें!</p>';
      }
      return;
    }

    renderTrending(allMedia);
    renderGrid();
  } catch (err) {
    console.error('Error fetching media:', err);
    if (container) {
      container.innerHTML = '<p style="grid-column: span 2; text-align:center; color:#ff4d4d; padding: 20px;">डेटा लोड करने में त्रुटि! कृपया पुनः प्रयास करें।</p>';
    }
  }
}

function renderTrending(items) {
  if (!trendingSlider) return;
  const top10 = [...items]
    .sort((a, b) => (b.viewsCount || b.downloadsCount || 0) - (a.viewsCount || a.downloadsCount || 0))
    .slice(0, 10);

  if (top10.length === 0) {
    trendingSlider.parentElement.style.display = 'none';
    return;
  }

  trendingSlider.innerHTML = top10.map((item, index) => `
    <div class="trending-card" onclick="openDetails('${item._id}')">
      <span class="rank-badge">#${index + 1}</span>
      <img src="${item.poster || 'https://via.placeholder.com/150x220?text=No+Poster'}" alt="${item.title}" loading="lazy">
    </div>
  `).join('');
}

function renderGrid() {
  if (!mediaGrid) return;

  let filtered = allMedia.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase());
    let matchesCat = true;

    if (currentCategory === 'movie') matchesCat = item.type === 'movie';
    else if (currentCategory === 'series') matchesCat = item.type === 'series';
    else if (currentCategory === 'watchlist') matchesCat = watchlist.includes(item._id);

    return matchesSearch && matchesCat;
  });

  if (currentCategory === 'top_rated') {
    filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  if (filtered.length === 0) {
    mediaGrid.innerHTML = `<p style="grid-column: span 2; text-align:center; color:#777; padding: 20px 0;">कोई मूवी नहीं मिली।</p>`;
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
          <img src="${item.poster || 'https://via.placeholder.com/200x300?text=No+Poster'}" alt="${item.title}" loading="lazy">
          <span class="card-rating">⭐ ${item.rating ? item.rating.toFixed(1) : 'N/A'}</span>
        </div>
        <div class="card-info">
          <h4 class="card-title" onclick="openDetails('${item._id}')">${item.title}</h4>
          <div class="card-meta">📅 ${item.year || 'N/A'} | ${item.type === 'series' ? 'Web Series' : 'Movie'}</div>
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

  const botUser = window.BOT_USERNAME || '';
  const botDownloadLink = `https://t.me/${botUser}?start=media_${item._id}`;
  const streamUrl = `/api/stream/${item._id}`;
  const fastDlUrl = `/api/fast-download/${item._id}`;

  let contentHtml = `
    <h3 style="margin-bottom:8px; font-size:16px;">${item.title}</h3>
    <p style="font-size:12px; color:#aaa; margin-bottom:8px;">⭐ ${item.rating ? item.rating.toFixed(1) : 'N/A'} | 📅 ${item.year || 'N/A'} | 🎭 ${(item.genres || []).join(', ')}</p>
    <p style="font-size:13px; line-height:1.4; color:#ddd; margin-bottom:14px;">${item.overview || 'विवरण उपलब्ध नहीं है।'}</p>

    <!-- इन-ऐप वीडियो प्लेयर कंटेनर -->
    <div id="video-container" style="display:none; margin-bottom:15px;">
      <video id="html5-player" controls width="100%" style="border-radius:8px; background:#000;">
        <source id="video-source" src="" type="video/mp4">
        आपका ब्राउज़र वीडियो सपोर्ट नहीं करता।
      </video>
    </div>

    <div style="display:flex; flex-direction:column; gap:8px;">
      <button onclick="playOnlineVideo('${streamUrl}')" class="dl-btn" style="background:#28a745;">
        <i class="fa-solid fa-play"></i> ▶️ Watch Online (In-App Player)
      </button>

      <a href="${fastDlUrl}" target="_blank" class="dl-btn" style="background:#007bff;">
        <i class="fa-brands fa-chrome"></i> ⚡ Fast Download (Chrome)
      </a>

      <a href="${botDownloadLink}" class="dl-btn">
        <i class="fa-brands fa-telegram"></i> 📥 Get Telegram File
      </a>
    </div>
  `;

  modalBody.innerHTML = contentHtml;
  modal.style.display = 'flex';
}

// ऑनलाइन वीडियो चलाने का फ़ंक्शन (Adgram Ads इंटीग्रेशन के साथ)
function playOnlineVideo(streamUrl) {
  const videoContainer = document.getElementById('video-container');
  const player = document.getElementById('html5-player');
  const source = document.getElementById('video-source');

  // Adgram Ad कॉल (अगर उपलब्ध हो)
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

catTabs.forEach(tab => {
  tab.onclick = () => {
    catTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCategory = tab.dataset.category;
    renderGrid();
  };
});

loadMedia();
