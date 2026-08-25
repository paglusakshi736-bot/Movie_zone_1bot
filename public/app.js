let botUsername = '';
let currentCategory = 'All';
let currentSearch = '';
let currentYear = 'All';

const tg = window.Telegram?.WebApp;
if (tg) {
    try {
        tg.ready();
        tg.expand();
    } catch (e) {}
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

function getGridElement() {
    return document.getElementById('movies-grid') || 
           document.getElementById('movieGrid') || 
           document.getElementById('moviesContainer') || 
           document.querySelector('.movie-grid') || 
           document.querySelector('.movies-grid');
}

async function loadMovies() {
    const grid = getGridElement();
    if (!grid) return;
    
    grid.innerHTML = '<div style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:30px;">लोड हो रहा है...</div>';

    try {
        let url = `/api/movies?category=${encodeURIComponent(currentCategory)}&search=${encodeURIComponent(currentSearch)}`;
        if (currentYear && currentYear !== 'All') {
            url += `&year=${encodeURIComponent(currentYear)}`;
        }

        const res = await fetch(url);
        const data = await res.json();

        const moviesList = Array.isArray(data) ? data : (data.movies || []);

        if (moviesList.length === 0) {
            grid.innerHTML = '<div style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:40px;">कोई मूवी/सीरीज़ नहीं मिली।</div>';
            return;
        }

        grid.innerHTML = '';
        moviesList.forEach(movie => {
            const card = document.createElement('div');
            card.className = 'movie-card';
            const posterSrc = movie.poster || 'https://placehold.co/300x450/1e293b/ffffff?text=No+Poster';
            const fileCount = movie.files ? movie.files.length : 1;

            card.innerHTML = `
                <div class="poster-container" style="position:relative;width:100%;aspect-ratio:2/3;background:#0f172a;">
                    <img src="${posterSrc}" alt="${movie.title}" style="width:100%;height:100%;object-fit:contain;background:#000;" loading="lazy">
                    <div class="badge-count" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.75);color:#f43f5e;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;border:1px solid #f43f5e;">${fileCount} Files</div>
                </div>
                <div class="movie-info" style="padding:10px;display:flex;flex-direction:column;flex-grow:1;justify-content:space-between;">
                    <div class="movie-title" style="font-size:13px;font-weight:600;color:#f1f5f9;margin-bottom:6px;line-height:1.3;">${movie.title}</div>
                    <div class="movie-meta" style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-bottom:8px;">
                        <span>⭐ ${movie.rating || '8.0'}</span>
                        <span>📅 ${movie.year || '2026'}</span>
                    </div>
                    <button class="get-files-btn" style="background:#e11d48;color:#fff;border:none;padding:8px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;width:100%;">📥 Get Files</button>
                </div>
            `;

            card.querySelector('.get-files-btn').addEventListener('click', () => {
                openDownloadModal(movie);
            });

            grid.appendChild(card);
        });
    } catch (err) {
        grid.innerHTML = '<div style="color:#ef4444;grid-column:1/-1;text-align:center;padding:20px;">डेटा लोड करने में एरर आया!</div>';
    }
}

function downloadFile(fileId) {
    const url = `https://t.me/${botUsername}?start=file_${fileId}`;
    if (tg && tg.openTelegramLink) {
        tg.openTelegramLink(url);
    } else {
        window.location.href = url;
    }
}

function openDownloadModal(movie) {
    let modal = document.getElementById('movieModal') || document.getElementById('downloadModal');
    let modalBody = document.getElementById('modalBody') || document.getElementById('modal-body');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'movieModal';
        modal.className = 'modal';
        modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:1000;justify-content:center;align-items:center;padding:16px;box-sizing:border-box;';
        
        modal.innerHTML = `
            <div class="modal-content" style="background:#1e293b;border-radius:14px;width:100%;max-width:420px;padding:16px;border:1px solid #334155;box-sizing:border-box;">
                <div id="modalBody"></div>
            </div>
        `;
        document.body.appendChild(modal);
        modalBody = modal.querySelector('#modalBody');
    }

    const isSeries = (movie.category === 'Web Series' || movie.isSeries);

    if (isSeries && movie.files && movie.files.length > 0) {
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
            let tabsHtml = `<div class="season-tabs" style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;margin:12px 0 8px 0;">`;
            seasonKeys.forEach(sName => {
                const isActive = sName === activeSeason;
                tabsHtml += `<button class="tab-btn ${isActive ? 'active' : ''}" style="background:${isActive ? '#e11d48' : '#0f172a'};color:${isActive ? '#fff' : '#94a3b8'};border:1px solid #334155;padding:6px 12px;border-radius:16px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;" onclick="switchSeason('${sName}')">${sName}</button>`;
            });
            tabsHtml += `</div>`;

            let episodesHtml = `<div class="episode-list" style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;margin-top:8px;">`;
            seasons[activeSeason].forEach(f => {
                episodesHtml += `
                    <div class="episode-item" style="display:flex;justify-content:space-between;align-items:center;background:#0f172a;border:1px solid #334155;padding:10px 12px;border-radius:8px;">
                        <span class="episode-name" style="font-size:12px;font-weight:500;color:#e2e8f0;">${f.label}</span>
                        <button onclick="downloadFile('${f.fileId}')" class="episode-dl-btn" style="background:#2563eb;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Get File</button>
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
                    <button class="close-btn" onclick="closeModal()" style="background:transparent;border:none;color:#94a3b8;font-size:20px;cursor:pointer;">✕</button>
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
        let filesHtml = `<div class="episode-list" style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;margin-top:8px;">`;
        (movie.files || []).forEach(f => {
            filesHtml += `
                <div class="episode-item" style="display:flex;justify-content:space-between;align-items:center;background:#0f172a;border:1px solid #334155;padding:10px 12px;border-radius:8px;">
                    <span class="episode-name" style="font-size:12px;font-weight:500;color:#e2e8f0;">${f.label}</span>
                    <button onclick="downloadFile('${f.fileId}')" class="episode-dl-btn" style="background:#2563eb;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Get File</button>
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
                <button class="close-btn" onclick="closeModal()" style="background:transparent;border:none;color:#94a3b8;font-size:20px;cursor:pointer;">✕</button>
            </div>
            ${filesHtml}
        `;
    }

    modal.style.display = 'flex';
}

function closeModal() {
    const modal = document.getElementById('movieModal') || document.getElementById('downloadModal');
    if (modal) modal.style.display = 'none';
}

async function submitMovieRequest() {
    const inputField = document.getElementById('requestInput') || document.querySelector('input[name="request"]');
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

    const searchInput = document.getElementById('searchInput') || document.querySelector('input[type="search"]') || document.querySelector('.search-box input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearch = e.target.value.trim();
            loadMovies();
        });
    }

    const catButtons = document.querySelectorAll('.cat-btn, .category-btn, .tab-item');
    catButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            catButtons.forEach(b => b.classList.remove('active'));
            const target = e.currentTarget;
            target.classList.add('active');
            
            let cat = target.getAttribute('data-cat') || target.innerText.trim();
            cat = cat.replace(/[^\w\s]/gi, '').trim();
            currentCategory = cat || 'All';
            loadMovies();
        });
    });
});
