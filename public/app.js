let botUsername = '';
let currentCategory = 'All';
let currentSearch = '';
let currentYear = 'All';
let currentPage = 1;
let totalPages = 1;
let isLoading = false;

const tg = window.Telegram?.WebApp;
if (tg) {
    try {
        tg.ready();
        tg.expand();
    } catch (e) {}
}

function populateYears() {
    const yearSelect = document.getElementById('yearDropdown');
    if (!yearSelect) return;
    
    let html = '<option value="all">📅 All Years</option>';
    const thisYear = 2026;
    for (let y = thisYear; y >= 2010; y--) {
        html += `<option value="${y}">${y}</option>`;
    }
    yearSelect.innerHTML = html;
}

// 🔥 ट्रेंडिंग मूवीज स्लाइडर
async function loadTrendingMovies() {
    const section = document.getElementById('trendingSection');
    const slider = document.getElementById('trendingSlider');
    if (!section || !slider) return;

    try {
        const res = await fetch('/api/movies?limit=15');
        const data = await res.json();
        const movies = Array.isArray(data) ? data : (data.movies || []);

        const trendingList = movies.filter(m => parseFloat(m.rating || 0) >= 7.0 || m.isSeries).slice(0, 8);

        if (trendingList.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        let html = '<div class="trending-scroll-container" style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;">';

        trendingList.forEach((movie, idx) => {
            const posterSrc = movie.poster || 'https://placehold.co/200x300/1e293b/ffffff?text=Poster';
            html += `
                <div class="trending-card" style="flex:0 0 120px;border-radius:10px;overflow:hidden;background:#1e293b;border:1px solid #334155;cursor:pointer;" onclick='openDownloadModal(${JSON.stringify(movie)})'>
                    <div style="position:relative;width:100%;aspect-ratio:2/3;overflow:hidden;">
                        <img src="${posterSrc}" alt="${movie.title}" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy">
                        <div style="position:absolute;top:6px;left:6px;background:linear-gradient(135deg,#e11d48,#be123c);color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;">TOP #${idx + 1}</div>
                    </div>
                    <div style="padding:6px 8px;">
                        <div style="font-size:11px;font-weight:600;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;">${movie.title}</div>
                        <div style="font-size:10px;color:#fbbf24;display:flex;justify-content:space-between;">
                            <span>⭐ ${movie.rating || '8.0'}</span>
                            <span style="color:#94a3b8;">${movie.year || '2026'}</span>
                        </div>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        slider.innerHTML = html;
    } catch (err) {
        section.style.display = 'none';
    }
}

async function initApp() {
    populateYears();
    loadTrendingMovies();
    try {
        const res = await fetch('/api/bot-info');
        const data = await res.json();
        if (data && data.username) {
            botUsername = data.username;
        }
    } catch (e) {
        console.error('Failed to get bot info:', e);
    }
    loadMovies(true);
}

function getGridElement() {
    return document.getElementById('moviesContainer') || 
           document.getElementById('movies-grid') || 
           document.getElementById('movieGrid') || 
           document.querySelector('.movies-grid') || 
           document.querySelector('.movie-grid');
}

// 🏷️ कैटेगरी फ़िल्टर
window.applyCategoryFilter = function(category, element) {
    document.querySelectorAll('.filter-chip').forEach(el => el.classList.remove('active'));
    if (element) {
        element.classList.add('active');
    }

    const catMap = {
        'all': 'All',
        'latest': 'Latest',
        'watchlist': 'Watchlist',
        'hollywood': 'Hollywood',
        'hindi': 'Hindi',
        'web series': 'Web Series',
        'south': 'South',
        'others': 'Others',
        'needs_fix': 'needs_fix'
    };

    currentCategory = catMap[category.toLowerCase()] || category;
    currentPage = 1;
    loadMovies(true);
};

// 📅 साल फ़िल्टर
window.handleYearChange = function(yearValue) {
    currentYear = (yearValue === 'all' || !yearValue) ? 'All' : yearValue;
    currentPage = 1;
    loadMovies(true);
};

// 🎬 मूवीज लोड करना (Pagination / Load More)
async function loadMovies(reset = false) {
    if (isLoading) return;
    isLoading = true;

    const grid = getGridElement();
    if (!grid) {
        isLoading = false;
        return;
    }

    if (reset) {
        currentPage = 1;
        grid.innerHTML = '<div style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:30px;">लोड हो रहा है...</div>';
    }

    const oldBtn = document.getElementById('loadMoreBtnContainer');
    if (oldBtn) oldBtn.remove();

    try {
        let url = `/api/movies?category=${encodeURIComponent(currentCategory)}&search=${encodeURIComponent(currentSearch)}&page=${currentPage}&limit=30`;
        if (currentYear && currentYear !== 'All') {
            url += `&year=${encodeURIComponent(currentYear)}`;
        }

        const res = await fetch(url);
        const data = await res.json();

        const moviesList = Array.isArray(data) ? data : (data.movies || []);
        totalPages = data.totalPages || 1;

        if (reset) grid.innerHTML = '';

        if (moviesList.length === 0 && currentPage === 1) {
            if (currentSearch) {
                grid.innerHTML = `
                    <div style="grid-column:1/-1;text-align:center;padding:35px 15px;background:#1e293b;border-radius:12px;border:1px dashed #475569;margin:10px 0;">
                        <div style="font-size:36px;margin-bottom:8px;">🎬</div>
                        <h4 style="color:#f1f5f9;margin:0 0 6px 0;font-size:15px;">"${currentSearch}" उपलब्ध नहीं है</h4>
                        <p style="color:#94a3b8;font-size:12px;margin:0 0 16px 0;">क्या आप चाहते हैं कि हम इसे जल्द से जल्द अपलोड करें?</p>
                        <button onclick="requestSearchedMovie('${currentSearch.replace(/'/g, "\\'")}', this)" 
                                style="background:#e11d48;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(225,29,72,0.3);">
                            📩 "${currentSearch}" के लिए रिक्वेस्ट भेजें
                        </button>
                    </div>
                `;
            } else {
                const emptyMsg = currentCategory === 'needs_fix' 
                    ? '✅ किसी भी मूवी के नाम में कोई एरर नहीं है!' 
                    : (currentCategory === 'Others' ? '📁 कोई अननेम्ड फ़ाइल नहीं है।' : 'कोई मूवी/सीरीज़ नहीं मिली।');
                grid.innerHTML = `<div style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:40px;">${emptyMsg}</div>`;
            }
            isLoading = false;
            return;
        }

        moviesList.forEach(movie => {
            const card = document.createElement('div');
            card.className = 'movie-card';
            const posterSrc = movie.poster || 'https://placehold.co/300x450/1e293b/ffffff?text=No+Poster';
            const fileCount = movie.files ? movie.files.length : 1;

            card.innerHTML = `
                <div class="poster-container" style="position:relative;width:100%;aspect-ratio:3/4;background:#1e293b;overflow:hidden;border-radius:10px 10px 0 0;">
                    <img src="${posterSrc}" alt="${movie.title}" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy">
                    <div class="badge-count" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.8);color:#f43f5e;font-size:11px;font-weight:700;padding:3px 7px;border-radius:6px;border:1px solid rgba(244,63,94,0.6);backdrop-filter:blur(4px);">${fileCount} Files</div>
                </div>
                <div class="movie-info" style="padding:10px;display:flex;flex-direction:column;flex-grow:1;justify-content:space-between;">
                    <div class="movie-title" style="font-size:13px;font-weight:600;color:#f1f5f9;margin-bottom:6px;line-height:1.4;height:36px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;">${movie.title}</div>
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

        // ➕ अगर और पेज बाकी हैं तो "और देखें (Load More)" बटन जोड़ें
        if (currentPage < totalPages) {
            const btnContainer = document.createElement('div');
            btnContainer.id = 'loadMoreBtnContainer';
            btnContainer.style.cssText = 'grid-column: 1 / -1; text-align: center; margin: 20px 0 30px 0;';
            btnContainer.innerHTML = `
                <button id="loadMoreBtn" style="background:#1e293b;color:#f1f5f9;border:1px solid #475569;padding:10px 24px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;">
                    🔄 और देखें (Load More)
                </button>
            `;
            btnContainer.querySelector('#loadMoreBtn').addEventListener('click', () => {
                currentPage++;
                loadMovies(false);
            });
            grid.appendChild(btnContainer);
        }

    } catch (err) {
        grid.innerHTML = '<div style="color:#ef4444;grid-column:1/-1;text-align:center;padding:20px;">डेटा लोड करने में एरर आया!</div>';
    } finally {
        isLoading = false;
    }
}

async function requestSearchedMovie(movieName, btnElement) {
    const user = tg?.initDataUnsafe?.user;

    if (!user || !user.id) {
        alert("⚠️ कृपया यह मिनी ऐप सीधे टेलीग्राम बॉट के अंदर से खोलें!");
        return;
    }

    if (btnElement) {
        btnElement.innerText = "भेजा जा रहा है...";
        btnElement.disabled = true;
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
                if (tg && tg.openTelegramLink) tg.openTelegramLink(shareUrl);
                else window.open(shareUrl, '_blank');
            }
            if (btnElement) {
                btnElement.innerText = `📩 "${movieName}" के लिए रिक्वेस्ट भेजें`;
                btnElement.disabled = false;
            }
        } else if (data.success) {
            alert(data.message || "✅ रिक्वेस्ट एडमिन को भेज दी गई है!");
            if (btnElement) {
                btnElement.innerText = "✅ Request Sent!";
                btnElement.style.background = "#10b981";
            }
        } else {
            alert(data.message || "अनुरोध भेजने में विफल!");
            if (btnElement) {
                btnElement.innerText = `📩 "${movieName}" के लिए रिक्वेस्ट भेजें`;
                btnElement.disabled = false;
            }
        }
    } catch (e) {
        alert("सर्वर से कनेक्ट करने में समस्या आई!");
        if (btnElement) {
            btnElement.innerText = `📩 "${movieName}" के लिए रिक्वेस्ट भेजें`;
            btnElement.disabled = false;
        }
    }
}

async function triggerDownload(fileId, btnElement) {
    const user = tg?.initDataUnsafe?.user;

    if (!user || !user.id) {
        const targetUrl = `https://t.me/${botUsername}?start=file_${fileId}`;
        if (tg && tg.openTelegramLink) tg.openTelegramLink(targetUrl);
        else window.location.href = targetUrl;
        return;
    }

    if (btnElement) {
        btnElement.innerText = "भेजा जा रहा है...";
        btnElement.disabled = true;
    }

    try {
        const res = await fetch('/api/send-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: user.id,
                fileId: fileId
            })
        });

        const result = await res.json();
        if (result.success) {
            if (btnElement) btnElement.innerText = "✅ Sent to Bot!";
            if (tg && tg.close) {
                setTimeout(() => tg.close(), 600);
            }
        } else {
            alert(result.message || "समस्या आई!");
            if (btnElement) {
                btnElement.innerText = "Get File";
                btnElement.disabled = false;
            }
        }
    } catch (e) {
        alert("फ़ाइल भेजने में समस्या आई!");
        if (btnElement) {
            btnElement.innerText = "Get File";
            btnElement.disabled = false;
        }
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
                        <button onclick="triggerDownload('${f.fileId}', this)" class="episode-dl-btn" style="background:#2563eb;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Get File</button>
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
                    <button onclick="triggerDownload('${f.fileId}', this)" class="episode-dl-btn" style="background:#2563eb;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Get File</button>
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

document.addEventListener('DOMContentLoaded', () => {
    initApp();

    const searchInput = document.getElementById('searchInput') || document.querySelector('input[type="search"]') || document.querySelector('.search-box input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearch = e.target.value.trim();
            currentPage = 1;
            loadMovies(true);
        });
    }

    // 📜 ऑटोमैटिक इन्फिनिट स्क्रॉल
    window.addEventListener('scroll', () => {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 300) {
            if (!isLoading && currentPage < totalPages) {
                currentPage++;
                loadMovies(false);
            }
        }
    });
});
