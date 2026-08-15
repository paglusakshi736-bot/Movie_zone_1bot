const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

let allMedia = [];
let currentCategory = 'all';
let currentSort = 'latest';
let searchQuery = '';

const container = document.getElementById('media-container');
const searchInput = document.getElementById('search-input');
const sortFilter = document.getElementById('sort-filter');
const totalCount = document.getElementById('total-count');

// 1. एडमिन सेटिंग्स लोड करना (Live Dynamic Sync)
async function loadAppSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    if (settings) {
      const discBtn = document.getElementById('discussion-btn');
      const backupBtn = document.getElementById('backup-btn');
      const poweredBy = document.getElementById('powered-by-text');
      
      if (discBtn && settings.discussionGroup) discBtn.href = settings.discussionGroup;
      if (backupBtn) {
        if (settings.vipChannelLink) backupBtn.href = settings.vipChannelLink;
        if (settings.backupButtonText) backupBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${settings.backupButtonText}`;
      }
      if (poweredBy && settings.poweredByText) poweredBy.innerText = settings.poweredByText;
    }
  } catch (e) {
    console.log('Settings fallback mode');
  }
}

// 2. मीडिया डेटा फेच करना
async function fetchMedia() {
  try {
    const res = await fetch('/api/media');
    allMedia = await res.json();
    if (totalCount) totalCount.innerText = allMedia.length;
    renderMedia();
  } catch (err) {
    container.innerHTML = '<div class="loading-spinner">Movies load karne me dikkat hui.</div>';
  }
}

// 3. फ़िल्टर और सॉर्ट करके दिखाना
function renderMedia() {
  let filtered = allMedia.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase());
    
    let matchesCategory = true;
    if (currentCategory === 'series') matchesCategory = item.type === 'series';
    else if (currentCategory === 'bollywood') matchesCategory = item.genres?.includes('Bollywood') || item.language === 'hi';
    else if (currentCategory === 'south') matchesCategory = item.genres?.includes('South') || ['te', 'ta', 'kn', 'ml'].includes(item.language);
    else if (currentCategory === 'hindi-dubbed') matchesCategory = item.isDubbed === true;
    else if (currentCategory === 'watchlist') {
      const watchlist = JSON.parse(localStorage.getItem('mz_watchlist') || '[]');
      matchesCategory = watchlist.includes(item._id);
    }

    let matchesYear = true;
    if (['2026', '2025', '2024'].includes(currentSort)) {
      matchesYear = item.year == currentSort;
    } else if (currentSort === 'older') {
      matchesYear = item.year < 2024;
    }

    return matchesSearch && matchesCategory && matchesYear;
  });

  // Release Date & Rating सॉर्टिंग
  if (currentSort === 'latest') {
    filtered.sort((a, b) => new Date(b.releaseDate || `${b.year || 1970}-01-01`) - new Date(a.releaseDate || `${a.year || 1970}-01-01`));
  } else if (currentSort === 'rating') {
    filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="loading-spinner">Koi movie nahi mili.</div>';
    return;
  }

  container.innerHTML = filtered.map(item => {
    const watchlist = JSON.parse(localStorage.getItem('mz_watchlist') || '[]');
    const isFav = watchlist.includes(item._id);

    return `
      <div class="media-card">
        <div class="poster-wrap">
          <img src="${item.poster || 'https://placehold.co/500x750/111827/ffffff?text=Movie+Zone'}" alt="${item.title}" loading="lazy">
          <div class="card-rating"><i class="fa-solid fa-star"></i> ${item.rating || 'N/A'}</div>
          <button class="fav-btn ${isFav ? 'active' : ''}" onclick="toggleWatchlist('${item._id}')">
            <i class="fa-${isFav ? 'solid' : 'regular'} fa-heart"></i>
          </button>
        </div>
        <div class="card-info">
          <div>
            <h3 class="card-title">${item.title}</h3>
            <div class="card-meta">${item.year || ''} • ${(item.genres || []).slice(0, 2).join(', ')}</div>
          </div>
          <button class="get-btn" onclick="sendMediaToBot('${item._id}')">Get Files</button>
        </div>
      </div>
    `;
  }).join('');
}

// 4. बॉट को ट्रिगर करना
function sendMediaToBot(mediaId) {
  if (tg) {
    tg.sendData(JSON.stringify({ action: 'get_media', mediaId }));
    tg.close();
  } else {
    alert('Telegram App ke andar kholein.');
  }
}

// 5. वॉचलिस्ट टॉगल
function toggleWatchlist(mediaId) {
  let watchlist = JSON.parse(localStorage.getItem('mz_watchlist') || '[]');
  if (watchlist.includes(mediaId)) {
    watchlist = watchlist.filter(id => id !== mediaId);
  } else {
    watchlist.push(mediaId);
  }
  localStorage.setItem('mz_watchlist', JSON.stringify(watchlist));
  renderMedia();
}

// इवेंट लिसनर्स
searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderMedia();
});

sortFilter.addEventListener('change', (e) => {
  currentSort = e.target.value;
  renderMedia();
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.category;
    renderMedia();
  });
});

loadAppSettings();
fetchMedia();
