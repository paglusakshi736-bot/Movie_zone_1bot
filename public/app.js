const tg = window.Telegram?.WebApp;
if (tg) { tg.expand(); tg.ready(); }

const BACKEND_URL = window.location.origin;

let allMovies = [];
let watchlist = JSON.parse(localStorage.getItem('user_watchlist') || '[]');
let currentPendingFile = null;
let selectedCategory = 'all';
let selectedYear = 'all';

function setupYearDropdown() {
    const dropdown = document.getElementById('yearDropdown');
    const currentYear = 2026;
    for (let y = currentYear; y >= 1990; y--) {
        const opt = document.createElement('option');
        opt.value = y.toString();
        opt.innerText = y.toString();
        dropdown.appendChild(opt);
    }
}
setupYearDropdown();

async function fetchMovies() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/movies`);
        if (!res.ok) throw new Error('Network response failed');
        allMovies = await res.json();
        renderTrending();
        renderFilteredMovies();
    } catch (err) {
        document.getElementById('moviesContainer').innerHTML = '<div class="loader" style="color:#ff4e50"><i class="fas fa-exclamation-circle"></i> Error loading movies.</div>';
    }
}

function renderTrending() {
    const slider = document.getElementById('trendingSlider');
    if (!slider) return;
    const topItems = [...allMovies].sort((a, b) => (b.viewsCount || 0) - (a.viewsCount || 0)).slice(0, 8);
    if (topItems.length === 0) {
        document.getElementById('trendingSection').style.display = 'none';
        return;
    }
    document.getElementById('trendingSection').style.display = 'block';
    slider.innerHTML = topItems.map((m, idx) => `
        <div class="trending-card" onclick='openSheet(${JSON.stringify(m).replace(/'/g, "&apos;")})'>
            <span class="rank-badge">#${idx + 1}</span>
            <img src="${m.poster || m.thumbFileId ? `${BACKEND_URL}/api/thumb/${m.thumbFileId}` : 'https://placehold.co/400x600/161b22/e50914?text=Poster'}" alt="${m.title}">
        </div>
    `).join('');
}

function renderFilteredMovies() {
    const searchVal = document.getElementById('searchInput').value.toLowerCase().trim();

    let filtered = allMovies.filter(m => {
        const titleLower = m.title.toLowerCase();
        const matchesSearch = titleLower.includes(searchVal);
        
        let matchesCategory = true;
        if (selectedCategory === 'watchlist') matchesCategory = watchlist.includes(m._id);
        else if (selectedCategory !== 'all') matchesCategory = (m.category || '').toLowerCase() === selectedCategory.toLowerCase();

        const matchesYear = (selectedYear === 'all') || String(m.year) === selectedYear;
        return matchesSearch && matchesCategory && matchesYear;
    });

    renderMovies(filtered);
}

function renderMovies(movies) {
    const container = document.getElementById('moviesContainer');
    if (!movies || movies.length === 0) {
        container.innerHTML = '<div class="loader">No Movies Found</div>';
        return;
    }

    container.innerHTML = movies.map(m => {
        const fileCount = m.files ? m.files.length : 1;
        const posterUrl = m.poster || (m.thumbFileId ? `${BACKEND_URL}/api/thumb/${m.thumbFileId}` : 'https://placehold.co/400x600/161b22/e50914?text=Poster');
        const isFav = watchlist.includes(m._id);

        return `
            <div class="movie-card">
                <button class="fav-btn ${isFav ? 'active' : ''}" onclick="toggleWatchlist(event, '${m._id}')">
                    <i class="fas fa-heart"></i>
                </button>
                <div class="poster-box" onclick='openSheet(${JSON.stringify(m).replace(/'/g, "&apos;")})'>
                    <img src="${posterUrl}" alt="${m.title}" loading="lazy">
                    <span class="file-badge">${fileCount} Files</span>
                </div>
                <div class="card-details">
                    <h3 class="movie-title">${m.title}</h3>
                    <div class="card-meta">
                        <span>⭐ ${m.rating || '8.0'}</span>
                        <span>📅 ${m.year || '2026'}</span>
                    </div>
                    <button class="get-btn" onclick='openSheet(${JSON.stringify(m).replace(/'/g, "&apos;")})'>
                        <i class="fas fa-download"></i> Get Files
                    </button>
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
    renderFilteredMovies();
}

function openSheet(movie) {
    document.getElementById('sheetTitle').innerText = movie.title;
    const filesList = document.getElementById('filesList');
    
    // वीडियो प्लेयर छुपाएं और रोकें
    const player = document.getElementById('sheetVideoPlayer');
    player.pause();
    player.style.display = 'none';

    filesList.innerHTML = movie.files.map(f => `
        <div class="file-item">
            <span class="file-label">${f.label}</span>
            <div class="action-btns">
                <button class="stream-action-btn" onclick='playInlineStream("${f.fileId}")'>
                    <i class="fas fa-play"></i> Watch
                </button>
                <button class="dl-action-btn" onclick='downloadFile("${f.fileId}", "${f.fileType}", "${movie.title.replace(/'/g, "\\'")}", "${f.label}")'>
                    <i class="fas fa-download"></i> Get
                </button>
            </div>
        </div>
    `).join('');

    document.getElementById('sheetOverlay').classList.add('active');
    document.getElementById('bottomSheet').classList.add('active');
}

function playInlineStream(fileId) {
    const player = document.getElementById('sheetVideoPlayer');
    player.src = `${BACKEND_URL}/api/stream/${fileId}`;
    player.style.display = 'block';
    player.play();
}

function closeSheet() {
    const player = document.getElementById('sheetVideoPlayer');
    if (player) {
        player.pause();
        player.src = '';
    }
    document.getElementById('sheetOverlay').classList.remove('active');
    document.getElementById('bottomSheet').classList.remove('active');
}

async function downloadFile(fileId, fileType, movieTitle, label) {
    const chatId = tg?.initDataUnsafe?.user?.id;
    if (!chatId) {
        alert("Please open this app inside Telegram!");
        return;
    }

    currentPendingFile = { fileId, fileType, movieTitle, label };

    try {
        const res = await fetch(`${BACKEND_URL}/api/send-file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId, fileType, movieTitle, label, chatId })
        });

        const data = await res.json();

        if (res.status === 403 && data.forceSubRequired) {
            closeSheet();
            showJoinModal(data.channel, data.group);
            return;
        }

        if (data.success && !data.short) {
            closeSheet();
            if (tg) tg.showPopup({ title: 'Success', message: 'File sent to your Telegram chat!' });
        }
    } catch (err) {
        alert("Error sending file: " + err.message);
    }
}

function showJoinModal(channel, group) {
    const container = document.getElementById('joinLinksContainer');
    container.innerHTML = '';
    if (channel) container.innerHTML += `<a href="https://t.me/${channel.replace('@','')}" target="_blank" class="join-link-btn">📢 Join Channel</a>`;
    if (group) container.innerHTML += `<a href="https://t.me/${group.replace('@','')}" target="_blank" class="join-link-btn" style="background:#ff0844">💬 Join Group</a>`;
    document.getElementById('joinModal').classList.add('active');
    document.getElementById('sheetOverlay').classList.add('active');
}

function retryDownload() {
    document.getElementById('joinModal').classList.remove('active');
    document.getElementById('sheetOverlay').classList.remove('active');
    if (currentPendingFile) {
        downloadFile(currentPendingFile.fileId, currentPendingFile.fileType, currentPendingFile.movieTitle, currentPendingFile.label);
    }
}

document.getElementById('searchInput').addEventListener('input', renderFilteredMovies);

function handleYearChange(year) {
    selectedYear = year;
    renderFilteredMovies();
}

function applyCategoryFilter(cat, el) {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    selectedCategory = cat;
    renderFilteredMovies();
}

fetchMovies();
