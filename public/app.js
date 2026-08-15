const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  tg.ready();
}

let allMedia = [];
let watchlist = JSON.parse(localStorage.getItem('user_watchlist') || '[]');
let currentCategory = 'all';
let searchQuery = '';

// DOM Elements
const mediaGrid = document.getElementById('media-grid');
const trendingSlider = document.getElementById('trending-slider');
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const catTabs = document.querySelectorAll('.cat-tab');
const watchlistToggle = document.getElementById('watchlist-toggle');
const modal = document.getElementById('media-modal');
const modalBody = document.getElementById('modal-body');
const modalClose = document.getElementById('modal-close');

// 1. डेटा लोड करना
async function loadMedia() {
  try {
    const res = await fetch('/api/media');
    allMedia = await res.json();
    renderTrending(allMedia);
    renderGrid();
  } catch (err) {
    console.error('Error fetching media:', err);
    if (mediaGrid) {
      mediaGrid.innerHTML = `<p style="grid-column: span 2; text-align:center; color:#ff334b; padding: 20px 0;">डेटा लोड करने में समस्या आई।</p>`;
    }
  }
}

// 2. Trending / Top 10 रेंडर करना
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

// 3. मुख्य ग्रिड रेंडर करना
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
        <img src="${item.poster || 'https://via.placeholder.com/200x300?text=No+Poster'}" onclick="openDetails('${item._id}')" loading="lazy">
        <div class="media-info" onclick="openDetails('${item._id}')">
          <h4>${item.title}</h4>
          <div class="media-meta">
            <span>⭐ ${item.rating ? item.rating.toFixed(1) : 'N/A'}</span>
            <span>📅 ${item.year || 'N/A'}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// 4. वॉचलिस्ट टॉगल (❤️)
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

// 5. मूवी/सीरीज़ डिटेल्स पॉपअप (Modal)
function openDetails(id) {
  const item = allMedia.find(m => m._id === id);
  if (!item || !modal || !modalBody) return;

  const botUser = window.BOT_USERNAME || '';
  const directBotLink = `https://t.me/${botUser}?start=media_${item._id}`;

  let contentHtml = `
    <h3 style="margin-bottom:8px; font-size:16px;">${item.title}</h3>
    <p style="font-size:12px; color:#aaa; margin-bottom:8px;">⭐ ${item.rating ? item.rating.toFixed(1) : 'N/A'} | 📅 ${item.year || 'N/A'} | 🎭 ${(item.genres || []).join(', ')}</p>
    <p style="font-size:13px; line-height:1.4; color:#ddd; margin-bottom:14px;">${item.overview || 'विवरण उपलब्ध नहीं है।'}</p>
  `;

  if (item.type === 'series' && item.episodes && item.episodes.length > 0) {
    contentHtml += `<h4 style="font-size:13px; margin: 10px 0 6px 0; color:#ff334b;">एपिसोड्स:</h4><div style="display:flex; flex-direction:column; gap:6px; max-height:180px; overflow-y:auto;">`;
    item.episodes.forEach(ep => {
      contentHtml += `
        <a href="https://t.me/${botUser}?start=ep_${item._id}_${ep.episodeNumber}" class="dl-btn" style="margin:0; padding:8px; font-size:12px; background:#222533; border:1px solid #33384c;">
          ▶️ Season ${ep.seasonNumber || 1} - Episode ${ep.episodeNumber} (${ep.fileSize || 'HD'})
        </a>
      `;
    });
    contentHtml += `</div>`;
  } else {
    contentHtml += `
      <a href="${directBotLink}" class="dl-btn">
        <i class="fa-solid fa-download"></i> Get Movie Files / Download
      </a>
    `;
  }

  modalBody.innerHTML = contentHtml;
  modal.style.display = 'flex';
}

if (modalClose) {
  modalClose.onclick = () => { modal.style.display = 'none'; };
}

// 6. सर्च इवेंट्स
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

// 7. टैब फ़िल्टर इवेंट्स
catTabs.forEach(tab => {
  tab.onclick = () => {
    catTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCategory = tab.dataset.category;
    renderGrid();
  };
});

if (watchlistToggle) {
  watchlistToggle.onclick = () => {
    catTabs.forEach(t => t.classList.remove('active'));
    currentCategory = currentCategory === 'watchlist' ? 'all' : 'watchlist';
    if (currentCategory === 'all') {
      document.querySelector('.cat-tab[data-category="all"]')?.classList.add('active');
    }
    renderGrid();
  };
}

loadMedia();
