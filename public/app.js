let botUsername = '';
let currentCategory = 'All';
let currentSearch = '';

const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
}

async function initApp() {
    try {
        const res = await fetch('/api/bot-info');
        const data = await res.json();
        botUsername = data.username || '';
    } catch (e) {
        console.error('Failed to get bot info:', e);
    }
    loadMovies();
}

async function loadMovies() {
    const grid = document.getElementById('movieGrid');
    if (!grid) return;
    grid.innerHTML = '<div style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:20px;">लोड हो रहा है...</div>';

    try {
        const url = `/api/movies?category=${encodeURIComponent(currentCategory)}&search=${encodeURIComponent(currentSearch)}`;
        const res = await fetch(url);
        const data = await res.json();

        if (!data.movies || data.movies.length === 0) {
            grid.innerHTML = '<div style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:40px;">कोई मूवी/सीरीज़ नहीं मिली।</div>';
            return;
        }

        grid.innerHTML = '';
        data.movies.forEach(movie => {
            const card = document.createElement('div');
            card.className = 'movie-card';
            const posterSrc = movie.poster || 'https://placehold.co/300x450/1e293b/ffffff?text=No+Poster';
            
            card.innerHTML = `
                <div class="poster-container">
                    <img src="${posterSrc}" alt="${movie.title}" loading="lazy">
                    <div class="badge-count">${movie.files ? movie.files.length : 1} Files</div>
                </div>
                <div class="movie-info">
                    <div class="movie-title">${movie.title}</div>
                    <div class="movie-meta">
                        <span>⭐ ${movie.rating || '8.0'}</span>
                        <span>📅 ${movie.year || '2026'}</span>
                    </div>
                    <button class="get-files-btn" onclick='openDownloadModal(${JSON.stringify(movie).replace(/'/g, "&apos;")})'>📥 Get Files</button>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (err) {
        grid.innerHTML = '<div style="color:#ef4444;grid-column:1/-1;text-align:center;padding:20px;">डेटा लोड करने में एरर आया!</div>';
    }
}

function openDownloadModal(movie) {
    const modal = document.getElementById('movieModal');
    const modalBody = document.getElementById('modalBody');
    if (!modal || !modalBody) return;

    if (movie.category === 'Web Series' || movie.isSeries) {
        const seasons = {};
        
        movie.files.forEach(file => {
            const sMatch = file.label.match(/S(\d+)/i) || file.label.match(/Season\s*(\d+)/i);
            const seasonNum = sMatch ? `Season ${parseInt(sMatch[1])}` : 'Season 1';

            if (!seasons[seasonNum]) {
                seasons[seasonNum] = [];
            }
            seasons[seasonNum].push(file);
        });

        const seasonKeys = Object.keys(seasons);
        let currentSeason = seasonKeys[0] || 'Season 1';

        function renderSeasonView(activeSeason) {
            let tabsHtml = `<div class="season-tabs">`;
            seasonKeys.forEach(sName => {
                tabsHtml += `<button class="tab-btn ${sName === activeSeason ? 'active' : ''}" onclick="switchSeason('${sName}')">${sName}</button>`;
            });
            tabsHtml += `</div>`;

            let episodesHtml = `<div class="episode-list">`;
            seasons[activeSeason].forEach(f => {
                episodesHtml += `
                    <div class="episode-item">
                        <span class="episode-name">${f.label}</span>
                        <a href="https://t.me/${botUsername}?start=file_${f.fileId}" class="episode-dl-btn" target="_blank">Get File</a>
                    </div>
                `;
            });
            episodesHtml += `</div>`;

            modalBody.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <div>
                        <h3 style="margin:0;color:#fff;font-size:16px;">${movie.title}</h3>
                        <p style="font-size:12px;color:#94a3b8;margin:4px 0 8px 0;">⭐ ${movie.rating || '8.0'} | 📅 ${movie.year || '2026'}</p>
                    </div>
                    <button class="close-btn" onclick="closeModal()">✕</button>
                </div>
                ${tabsHtml}
                ${episodesHtml}
            `;
        }

        window.switchSeason = function(sName) {
            renderSeasonView(sName);
        };

        renderSeasonView(currentSeason);
    } else {
        let filesHtml = `<div class="episode-list">`;
        movie.files.forEach(f => {
            filesHtml += `
                <div class="episode-item">
                    <span class="episode-name">${f.label}</span>
                    <a href="https://t.me/${botUsername}?start=file_${f.fileId}" class="episode-dl-btn" target="_blank">Get File</a>
                </div>
            `;
        });
        filesHtml += `</div>`;

        modalBody.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                    <h3 style="margin:0;color:#fff;font-size:16px;">${movie.title}</h3>
                    <p style="font-size:12px;color:#94a3b8;margin:4px 0 12px 0;">⭐ ${movie.rating || '8.0'} | 📅 ${movie.year || '2026'}</p>
                </div>
                <button class="close-btn" onclick="closeModal()">✕</button>
            </div>
            ${filesHtml}
        `;
    }

    modal.style.display = 'flex';
}

function closeModal() {
    const modal = document.getElementById('movieModal');
    if (modal) modal.style.display = 'none';
}

async function submitMovieRequest() {
    const inputField = document.getElementById('requestInput');
    const movieName = inputField ? inputField.value.trim() : '';

    const user = tg?.initDataUnsafe?.user;

    if (!user || !user.id) {
        alert("⚠️ कृपया यह मिनी ऐप सीधे टेलीग्राम बॉट के अंदर से खोलें!");
        return;
    }

    if (!movieName) {
        alert("⚠️ कृपया मूवी का नाम दर्ज करें!");
        return;
    }

    try {
        const response = await fetch('/api/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: user.id,
                username: user.username || '',
                firstName: user.first_name || '',
                movieName: movieName
            })
        });

        const data = await response.json();

        if (data.limitReached) {
            const userChoice = confirm(
                `⚠️ ${data.message}\n\nक्या आप अभी अपना इनवाइट लिंक दोस्तों के साथ शेयर करना चाहते हैं?`
            );
            if (userChoice) {
                const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(data.inviteLink)}&text=${encodeURIComponent('Join Movie Zone for latest movies and series!')}`;
                if (tg && tg.openTelegramLink) {
                    tg.openTelegramLink(shareUrl);
                } else {
                    window.open(shareUrl, '_blank');
                }
            }
        } else if (data.success) {
            alert(data.message);
            if (inputField) inputField.value = '';
        } else {
            alert(data.message || "अनुरोध भेजने में विफल!");
        }
    } catch (e) {
        alert("सर्वर से कनेक्ट करने में समस्या आई!");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initApp();

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearch = e.target.value.trim();
            loadMovies();
        });
    }

    const catButtons = document.querySelectorAll('.cat-btn');
    catButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            catButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentCategory = e.target.getAttribute('data-cat') || 'All';
            loadMovies();
        });
    });
});
