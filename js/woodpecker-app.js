/**
 * Woodpecker App - Main SPA controller
 * Handles auth, routing, dashboard, stats, admin, and training views
 */

class WoodpeckerApp {
    constructor() {
        this.token = localStorage.getItem('wp_token');
        this.user = null;
        this.board = null;
        this.trainer = null;
        this.currentSetId = null;
        this.currentSet = null;
        this.currentSessionId = null;
        this.solvedPuzzleIndices = new Set();
    }

    async init() {
        this._setupBeforeUnload();
        if (this.token) {
            try {
                const res = await this._api('/api/auth/me');
                this.user = res;
                this._showDashboard();
            } catch {
                this.token = null;
                localStorage.removeItem('wp_token');
                this._showLogin();
            }
        } else {
            this._showLogin();
        }
    }

    // ===== API HELPER =====
    async _api(url, options = {}) {
        const headers = { ...options.headers };
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
        if (options.body && !(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(options.body);
        }
        const res = await fetch(url, { ...options, headers });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Lỗi không xác định' }));
            throw new Error(err.error || 'Request failed');
        }
        return res.json();
    }

    // ===== VIEW SWITCHING =====
    _switchView(viewId) {
        document.querySelectorAll('.wp-view').forEach(v => v.classList.remove('active'));
        const el = document.getElementById(viewId);
        if (el) el.classList.add('active');
    }

    _updateHeader() {
        const headerRight = document.getElementById('wp-header-right');
        const theme = document.documentElement.getAttribute('data-theme') || 'dark';
        const themeIcon = theme === 'dark' ? '☀️' : '🌙';

        if (!this.user) {
            const lang = typeof i18n !== 'undefined' ? i18n.currentLang : 'vi';
            headerRight.innerHTML = `
                <button class="wp-theme-btn" onclick="wpApp.toggleTheme()" title="Toggle theme">${themeIcon}</button>
                <div class="wp-lang-toggle">
                    <button class="wp-lang-btn ${lang === 'vi' ? 'active' : ''}" onclick="wpApp.switchLang('vi')">VI</button>
                    <button class="wp-lang-btn ${lang === 'en' ? 'active' : ''}" onclick="wpApp.switchLang('en')">EN</button>
                </div>
            `;
            return;
        }
        const initial = this.user.username[0].toUpperCase();
        const lang = typeof i18n !== 'undefined' ? i18n.currentLang : 'vi';
        const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
        headerRight.innerHTML = `
            <button class="wp-theme-btn" onclick="wpApp.toggleTheme()" title="Toggle theme">${themeIcon}</button>
            <div class="wp-lang-toggle">
                <button class="wp-lang-btn ${lang === 'vi' ? 'active' : ''}" onclick="wpApp.switchLang('vi')">VI</button>
                <button class="wp-lang-btn ${lang === 'en' ? 'active' : ''}" onclick="wpApp.switchLang('en')">EN</button>
            </div>
            ${this.user.role === 'admin' ? `<button class="wp-btn wp-btn-ghost wp-btn-sm" onclick="wpApp.showAdmin()">⚙ ${t('nav_admin')}</button>` : ''}
            <div class="wp-user-menu" onclick="wpApp._toggleUserMenu(event)">
                <div class="wp-user-badge">
                    <div class="user-avatar">${initial}</div>
                    <span>${this.user.username}</span>
                    <span class="wp-user-chevron">▾</span>
                </div>
                <div class="wp-user-dropdown" id="wp-user-dropdown">
                    <button onclick="wpApp.logout()">🚪 ${t('logout_btn')}</button>
                </div>
            </div>
        `;
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('ttc-theme', next);
        this._updateHeader();

        // Update chessboard colors if board exists
        if (this.board) {
            const cs = getComputedStyle(document.documentElement);
            this.board.lightColor = cs.getPropertyValue('--board-light').trim();
            this.board.darkColor = cs.getPropertyValue('--board-dark').trim();
            this.board.highlightFromColor = cs.getPropertyValue('--board-highlight').trim();
            this.board.highlightToColor = cs.getPropertyValue('--board-highlight').trim();
            this.board._drawBoard();
            if (this.board.position) this.board._drawPieces(false);
        }
    }

    _toggleUserMenu(e) {
        e.stopPropagation();
        const dropdown = document.getElementById('wp-user-dropdown');
        if (!dropdown) return;
        dropdown.classList.toggle('open');

        // Close on outside click
        const close = () => {
            dropdown.classList.remove('open');
            document.removeEventListener('click', close);
        };
        if (dropdown.classList.contains('open')) {
            setTimeout(() => document.addEventListener('click', close), 0);
        }
    }

    switchLang(lang) {
        if (typeof i18n !== 'undefined') {
            i18n.setLang(lang);
        }
        this._updateHeader();
        this._applyI18n();
    }

    _applyI18n() {
        if (typeof i18n === 'undefined') return;
        const t = (k) => i18n.t(k);

        // Login view
        const loginTitle = document.querySelector('#view-login h1');
        if (loginTitle) loginTitle.textContent = t('login_title');
        const loginSub = document.querySelector('.login-subtitle');
        if (loginSub) loginSub.textContent = t('login_subtitle');
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn && !loginBtn.disabled) loginBtn.textContent = t('login_btn');

        // Dashboard
        const dashTitle = document.querySelector('#view-dashboard .wp-section-title');
        if (dashTitle) dashTitle.textContent = t('dash_title');
        const dashSub = document.querySelector('#view-dashboard .wp-section-subtitle');
        if (dashSub) dashSub.textContent = t('dash_subtitle');

        // Training view
        const endBtn = document.querySelector('#view-training .wp-btn-danger');
        if (endBtn) endBtn.textContent = t('train_end_session');

        // Training quick stats - update labels
        const quickStatLabels = document.querySelectorAll('#wp-session-quick-stats .quick-stat-label');
        if (quickStatLabels.length >= 3) {
            quickStatLabels[0].textContent = t('train_solved');
            quickStatLabels[1].textContent = t('train_accuracy');
            quickStatLabels[2].textContent = t('train_ppm');
        }

        // Training status text
        const statusEl = document.getElementById('wp-training-status');
        if (statusEl && statusEl.classList.contains('thinking')) {
            statusEl.textContent = t('train_your_turn');
        }
    }

    // ===== AUTH =====
    _showLogin() {
        this._switchView('view-login');
        this._updateHeader();
        this._applyI18n();
    }

    showRegister() {
        this._switchView('view-register');
        this._updateHeader();
    }

    async register() {
        const fullName = document.getElementById('reg-fullname').value.trim();
        const username = document.getElementById('reg-username').value.trim();
        const password = document.getElementById('reg-password').value;
        const confirmPassword = document.getElementById('reg-confirm-password').value;
        const dateOfBirth = document.getElementById('reg-dob').value;
        const errorEl = document.getElementById('reg-error');

        // Client-side validation
        if (!fullName || !username || !password || !confirmPassword || !dateOfBirth) {
            errorEl.textContent = 'Vui lòng điền đầy đủ thông tin';
            return;
        }
        if (password !== confirmPassword) {
            errorEl.textContent = 'Mật khẩu xác nhận không khớp';
            return;
        }
        if (password.length < 4) {
            errorEl.textContent = 'Mật khẩu phải có ít nhất 4 ký tự';
            return;
        }

        errorEl.textContent = '';
        const btn = document.getElementById('reg-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="wp-spinner"></span> Đang đăng ký...';

        try {
            await this._api('/api/auth/register', {
                method: 'POST',
                body: { fullName, username, password, confirmPassword, dateOfBirth }
            });
            this._switchView('view-register-success');
        } catch (err) {
            errorEl.textContent = err.message;
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Đăng ký';
        }
    }

    async login() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');

        if (!username || !password) {
            errorEl.textContent = 'Nhập đầy đủ thông tin';
            return;
        }

        errorEl.textContent = '';
        const btn = document.getElementById('login-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="wp-spinner"></span> Đang đăng nhập...';

        try {
            const data = await this._api('/api/auth/login', {
                method: 'POST',
                body: { username, password }
            });
            this.token = data.token;
            this.user = data.user;
            localStorage.setItem('wp_token', this.token);
            this._showDashboard();
        } catch (err) {
            errorEl.textContent = err.message;
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Đăng nhập';
        }
    }

    async logout() {
        try { await this._api('/api/auth/logout', { method: 'POST' }); } catch { }
        this.token = null;
        this.user = null;
        localStorage.removeItem('wp_token');
        this._showLogin();
    }

    // ===== DASHBOARD =====
    async _showDashboard() {
        this._updateHeader();
        this._switchView('view-dashboard');
        const t = (k, ...a) => typeof i18n !== 'undefined' ? i18n.t(k, ...a) : k;

        const grid = document.getElementById('wp-sets-grid');
        grid.innerHTML = `<div class="wp-loading"><span class="wp-spinner"></span> ${t('loading')}</div>`;

        try {
            const sets = await this._api('/api/woodpecker/sets');

            if (sets.length === 0) {
                grid.innerHTML = `
                    <div class="wp-empty">
                        <div class="empty-icon">📋</div>
                        <div class="empty-text">Chưa có bộ puzzle nào</div>
                        <div class="empty-sub">Liên hệ admin để được gán bộ puzzle</div>
                    </div>
                `;
                return;
            }

            grid.innerHTML = sets.map(set => {
                const currentCycle = set.cycles.length > 0 ? set.cycles[set.cycles.length - 1] : null;
                const cycleNum = currentCycle ? currentCycle.cycleNumber : 0;
                const isActive = currentCycle && !currentCycle.completedAt;
                const progress = (cycleNum / 7 * 100).toFixed(0);

                let badgeClass = 'pending';
                let badgeText = 'Chưa bắt đầu';
                if (cycleNum >= 7 && currentCycle?.completedAt) {
                    badgeClass = 'completed';
                    badgeText = 'Hoàn thành!';
                } else if (isActive) {
                    badgeClass = 'active';
                    badgeText = `${t('cycle_badge', cycleNum)}`;
                } else if (cycleNum > 0) {
                    badgeClass = 'pending';
                    badgeText = `${t('cycle_ready', cycleNum + 1)}`;
                }

                return `
                    <div class="wp-set-card" onclick="wpApp.showSetDetail('${set.id}')">
                        <div class="wp-set-card-header">
                            <div class="wp-set-card-name">${set.name}</div>
                            <span class="wp-set-card-badge ${badgeClass}">${badgeText}</span>
                        </div>
                        <div class="wp-set-card-meta">
                            <span>🧩 ${set.puzzleCount} puzzles</span>
                            <span>🔄 ${cycleNum}/7 cycles</span>
                        </div>
                        <div class="wp-set-card-progress">
                            <div class="wp-set-card-progress-fill" style="width:${progress}%"></div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            grid.innerHTML = `<div class="wp-empty"><div class="empty-text">Lỗi: ${err.message}</div></div>`;
        }
    }

    // ===== SET DETAIL (Stats + Start Cycle) =====
    async showSetDetail(setId) {
        this.currentSetId = setId;
        this._switchView('view-set-detail');

        const container = document.getElementById('wp-set-detail-content');
        container.innerHTML = '<div class="wp-loading"><span class="wp-spinner"></span> Đang tải...</div>';

        try {
            const [set, stats] = await Promise.all([
                this._api(`/api/woodpecker/sets/${setId}`),
                this._api(`/api/woodpecker/stats/${setId}`)
            ]);

            this.currentSet = set;
            this._renderSetDetail(set, stats);
        } catch (err) {
            container.innerHTML = `<div class="wp-empty"><div class="empty-text">Lỗi: ${err.message}</div></div>`;
        }
    }

    _renderSetDetail(set, stats) {
        const t = (k, ...a) => typeof i18n !== 'undefined' ? i18n.t(k, ...a) : k;
        const container = document.getElementById('wp-set-detail-content');
        const currentCycle = set.cycles.length > 0 ? set.cycles[set.cycles.length - 1] : null;
        const isActive = currentCycle && !currentCycle.completedAt;
        const canStartNew = !isActive && set.cycles.length < 7;
        const allDone = set.cycles.length >= 7 && (!currentCycle || currentCycle.completedAt);

        const CYCLE_DAYS = [28, 14, 7, 4, 3, 2, 1];

        // Header
        let html = `
            <div class="wp-breadcrumb">
                <a onclick="wpApp._showDashboard()">${t('nav_dashboard')}</a>
                <span class="sep">›</span>
                <span class="current">${set.name}</span>
            </div>
            
            <div class="wp-set-header">
                <div class="wp-set-header-info">
                    <h1>${set.name}</h1>
                    <p>🧩 ${set.puzzleCount} ${t('detail_puzzles')} · ${set.originalName || ''}</p>
                </div>
                <div class="wp-set-header-actions">
                    ${isActive ? `<button class="wp-btn wp-btn-primary wp-btn-lg" onclick="wpApp.startSession()">${t('detail_start_session')}</button>` : ''}
                    ${canStartNew ? `<button class="wp-btn wp-btn-success wp-btn-lg" onclick="wpApp.startNewCycle()">${t('detail_start_cycle')} ${set.cycles.length + 1}</button>` : ''}
                    ${allDone ? `<span class="wp-set-card-badge completed" style="font-size:1rem;padding:8px 16px;">${t('detail_all_done')}</span>` : ''}
                </div>
            </div>
        `;

        // Cycle Timeline
        html += '<div class="wp-cycle-timeline">';
        for (let i = 0; i < 7; i++) {
            const cycle = set.cycles[i];
            let cls = 'locked';
            let checkIcon = '';
            if (cycle && cycle.completedAt) {
                cls = 'completed';
                checkIcon = '<div class="check-icon">✓</div>';
            } else if (cycle && !cycle.completedAt) {
                cls = 'active';
            }
            html += `
                <div class="wp-cycle-step ${cls}">
                    ${checkIcon}
                    <div class="wp-cycle-step-number">C${i + 1}</div>
                    <div class="wp-cycle-step-days">${CYCLE_DAYS[i]} ${t('detail_days')}</div>
                </div>
            `;
        }
        html += '</div>';

        // Overall Performance
        html += `
            <div class="wp-stats-section">
                <div class="wp-stats-title">${t('stat_overall')}</div>
                <div class="wp-stats-grid">
                    <div class="wp-stat-card gradient">
                        <div class="wp-stat-icon"><span class="icon-badge">${t('stat_total_time')}</span></div>
                        <div class="wp-stat-value">${this._formatTime(stats.overall.totalTime)}</div>
                        <div class="wp-stat-label">⏱</div>
                    </div>
                    <div class="wp-stat-card gradient">
                        <div class="wp-stat-icon"><span class="icon-badge">${t('stat_overall_ppm')}</span></div>
                        <div class="wp-stat-value">${stats.overall.ppm}</div>
                        <div class="wp-stat-label">⚡ ${t('stat_puzzles_min')}</div>
                    </div>
                    <div class="wp-stat-card">
                        <div class="wp-stat-icon">🎯</div>
                        <div class="wp-stat-value">${stats.overall.successRate}%</div>
                        <div class="wp-stat-label">${t('stat_success_rate')}</div>
                    </div>
                    <div class="wp-stat-card">
                        <div class="wp-stat-icon">📈</div>
                        <div class="wp-stat-value">${stats.overall.totalSessions}</div>
                        <div class="wp-stat-label">${t('stat_total_sessions')}</div>
                    </div>
                    <div class="wp-stat-card">
                        <div class="wp-stat-icon">✅</div>
                        <div class="wp-stat-value">${stats.overall.puzzlesSolved}</div>
                        <div class="wp-stat-label">${t('stat_solved_of')} ${stats.overall.puzzlesAttempted} ${t('stat_attempted')}</div>
                    </div>
                </div>
            </div>
        `;

        // Cycle Breakdown
        if (stats.cycles.length > 0) {
            html += `<div class="wp-stats-section"><div class="wp-stats-title">${t('stat_cycle_breakdown')}</div>`;

            stats.cycles.forEach((cycle, idx) => {
                const isOpen = idx === stats.cycles.length - 1;
                html += `
                    <div class="wp-cycle-breakdown">
                        <div class="wp-cycle-header" onclick="wpApp._toggleCycle(${idx})">
                            <div class="wp-cycle-header-left">
                                <span class="toggle-icon ${isOpen ? 'open' : ''}" id="cycle-toggle-${idx}">▼</span>
                                <strong>${t('train_cycle')} ${cycle.cycleNumber}</strong>
                                <span style="opacity:0.7;font-size:0.85rem;">(${cycle.targetDays} ${t('detail_days')})</span>
                            </div>
                            <div class="wp-cycle-header-right">
                                <div class="mini-stat">
                                    <span class="label">${t('tbl_time')}</span>
                                    <strong>${this._formatTime(cycle.totalTime)}</strong>
                                </div>
                                <div class="mini-stat">
                                    <span class="label">${t('tbl_ppm')}</span>
                                    <strong>${cycle.ppm}</strong>
                                </div>
                                <span class="solved-badge">${cycle.puzzlesSolved}/${cycle.puzzlesAttempted} ${t('tbl_solved_count')}</span>
                                <span class="accuracy-badge">${cycle.successRate}%</span>
                            </div>
                        </div>
                        <div class="wp-cycle-body ${isOpen ? 'open' : ''}" id="cycle-body-${idx}">
                            <table class="wp-session-table">
                                <thead>
                                    <tr>
                                        <th>${t('tbl_session')}</th>
                                        <th>${t('tbl_attempted')}</th>
                                        <th>${t('tbl_solved')}</th>
                                        <th>${t('tbl_success_rate')}</th>
                                        <th>${t('tbl_duration')}</th>
                                        <th>${t('tbl_ppm')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${cycle.sessions.map((s, si) => `
                                        <tr>
                                            <td><span class="wp-session-link">${t('tbl_session')} ${si + 1}</span></td>
                                            <td>${s.puzzlesAttempted}</td>
                                            <td>${s.puzzlesSolved}</td>
                                            <td><strong>${s.successRate}%</strong></td>
                                            <td>${this._formatTime(s.duration)}</td>
                                            <td>${s.ppm}</td>
                                        </tr>
                                    `).join('')}
                                    ${cycle.sessions.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">${t('stat_no_sessions')}</td></tr>` : ''}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            });

            html += '</div>';
        }

        // Leaderboard section
        html += `
            <div class="wp-section" style="margin-top:24px;">
                <h3 class="wp-section-title">🏆 ${t('leaderboard_title')}</h3>
                <div id="wp-leaderboard" class="wp-leaderboard-container">
                    <div class="wp-loading"><span class="wp-spinner"></span></div>
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Load leaderboard asynchronously
        this._loadLeaderboard(set.id);
    }

    async _loadLeaderboard(setId) {
        const t = (k, ...a) => typeof i18n !== 'undefined' ? i18n.t(k, ...a) : k;
        const container = document.getElementById('wp-leaderboard');
        if (!container) return;

        try {
            const data = await this._api(`/api/woodpecker/sets/${setId}/leaderboard`);
            this._leaderboardData = data;

            if (!data || data.length === 0) {
                container.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:20px;">${t('leaderboard_empty')}</div>`;
                return;
            }

            this._renderLeaderboard('ppm');
        } catch (err) {
            container.innerHTML = `<div style="color:var(--danger);padding:12px;">${err.message}</div>`;
        }
    }

    _renderLeaderboard(sortBy) {
        const t = (k, ...a) => typeof i18n !== 'undefined' ? i18n.t(k, ...a) : k;
        const container = document.getElementById('wp-leaderboard');
        if (!container || !this._leaderboardData) return;

        const data = [...this._leaderboardData];
        if (sortBy === 'ppm') {
            data.sort((a, b) => b.ppm - a.ppm);
        } else {
            data.sort((a, b) => b.accuracy - a.accuracy);
        }

        const medals = ['🥇', '🥈', '🥉'];

        let html = `
            <div class="wp-leaderboard-tabs">
                <button class="wp-lb-tab ${sortBy === 'ppm' ? 'active' : ''}" onclick="wpApp.switchLeaderboardTab('ppm')">⚡ PPM</button>
                <button class="wp-lb-tab ${sortBy === 'accuracy' ? 'active' : ''}" onclick="wpApp.switchLeaderboardTab('accuracy')">🎯 ${t('leaderboard_accuracy')}</button>
            </div>
            <div class="wp-leaderboard-list">
        `;

        data.forEach((entry, i) => {
            const rank = i + 1;
            const medal = rank <= 3 ? medals[i] : `#${rank}`;
            const highlight = entry.isMe ? ' wp-lb-me' : '';
            const mainStat = sortBy === 'ppm' ? entry.ppm.toFixed(2) : `${entry.accuracy}%`;
            const subStat = sortBy === 'ppm' ? `${entry.accuracy}% ${t('leaderboard_acc_short')}` : `${entry.ppm.toFixed(2)} PPM`;

            html += `
                <div class="wp-lb-row${highlight}">
                    <div class="wp-lb-rank">${medal}</div>
                    <div class="wp-lb-user">
                        <div class="wp-lb-avatar">${entry.username[0].toUpperCase()}</div>
                        <div class="wp-lb-info">
                            <div class="wp-lb-name">${entry.username}${entry.isMe ? ' ⭐' : ''}</div>
                            <div class="wp-lb-sub">Cycle ${entry.bestCycle} · ${entry.totalSolved} ${t('leaderboard_solved')}</div>
                        </div>
                    </div>
                    <div class="wp-lb-stats">
                        <div class="wp-lb-main">${mainStat}</div>
                        <div class="wp-lb-secondary">${subStat}</div>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    switchLeaderboardTab(tab) {
        this._renderLeaderboard(tab);
    }

    _toggleCycle(idx) {
        const body = document.getElementById(`cycle-body-${idx}`);
        const toggle = document.getElementById(`cycle-toggle-${idx}`);
        if (body) body.classList.toggle('open');
        if (toggle) toggle.classList.toggle('open');
    }

    // ===== START NEW CYCLE =====
    async startNewCycle() {
        if (!this.currentSetId) return;

        try {
            await this._api(`/api/woodpecker/sets/${this.currentSetId}/start-cycle`, { method: 'POST' });
            this.showToast('Đã bắt đầu cycle mới!', 'success');
            this.showSetDetail(this.currentSetId);
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    // ===== TRAINING SESSION =====
    async startSession() {
        if (!this.currentSetId) return;

        this._switchView('view-training');
        const statusEl = document.getElementById('wp-training-status');
        statusEl.textContent = 'Đang tải puzzles...';
        statusEl.className = 'wp-training-status thinking';

        try {
            // Create session
            const sessionData = await this._api('/api/woodpecker/sessions', {
                method: 'POST',
                body: { setId: this.currentSetId }
            });
            this.currentSessionId = sessionData.session.id;

            // Load PGN
            const res = await fetch(`/api/woodpecker/sets/${this.currentSetId}/pgn`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const pgnText = await res.text();
            const games = PGNParser.parseMultipleGames(pgnText);

            // Determine already solved puzzles in this cycle
            this.solvedPuzzleIndices = new Set();
            const set = await this._api(`/api/woodpecker/sets/${this.currentSetId}`);
            this.currentSet = set;
            const currentCycle = set.cycles[set.cycles.length - 1];
            if (currentCycle) {
                for (const session of currentCycle.sessions) {
                    // Don't count current session
                    if (session.id === this.currentSessionId) continue;
                    for (const attempt of session.attempts) {
                        if (attempt.correct) {
                            this.solvedPuzzleIndices.add(attempt.puzzleIndex);
                        }
                    }
                }
            }

            // Initialize board if needed
            if (!this.board) {
                const boardContainer = document.getElementById('wp-chessboard');
                const boardSize = Math.min(480, boardContainer.parentElement.clientWidth);
                this.board = new ChessBoard('wp-chessboard', { size: boardSize });
            }

            // Initialize trainer
            this.trainer = new WoodpeckerTrainer(this.board);
            this.trainer.loadPuzzles(games);

            // Setup callbacks
            this.trainer.onTimerUpdate = (remaining) => this._updateTimer(remaining);
            this.trainer.onPuzzleStart = (data) => this._onPuzzleStart(data);
            this.trainer.onPuzzleComplete = (data) => this._onPuzzleComplete(data);
            this.trainer.onSessionComplete = (data) => this._onSessionComplete(data);
            this.trainer.onStatusChange = (data) => this._onStatusChange(data);
            this.trainer.onMoveCompleted = (data) => this._onMoveCompleted(data);

            // Start timer
            this.trainer.startTimer();

            // Update title
            document.getElementById('wp-training-set-name').textContent = set.name;
            document.getElementById('wp-training-cycle-badge').textContent =
                `${typeof i18n !== 'undefined' ? i18n.t('train_cycle') : 'Cycle'} ${currentCycle ? currentCycle.cycleNumber : 1}`;

            // Start first puzzle
            this._startNextPuzzle();

        } catch (err) {
            this.showToast('Lỗi: ' + err.message, 'error');
            this._showDashboard();
        }
    }

    _startNextPuzzle() {
        const nextIdx = this.trainer.getNextPuzzleIndex(this.solvedPuzzleIndices);

        if (nextIdx === -1) {
            // All puzzles solved in this cycle!
            this.trainer.endSession('all_solved');
            return;
        }

        this.trainer.startPuzzle(nextIdx);
        this._updateProgress();
    }

    _updateProgress() {
        const total = this.trainer.puzzles.length;
        const solved = this.solvedPuzzleIndices.size;
        const pct = total > 0 ? (solved / total * 100).toFixed(0) : 0;

        const bar = document.getElementById('wp-progress-fill');
        const text = document.getElementById('wp-progress-text');
        if (bar) bar.style.width = pct + '%';
        if (text) text.textContent = `${solved}/${total}`;
    }

    _updateTimer(remaining) {
        const timerEl = document.getElementById('wp-timer-value');
        const timerContainer = document.getElementById('wp-timer');
        if (!timerEl) return;

        const min = Math.floor(remaining / 60);
        const sec = remaining % 60;
        timerEl.textContent = `${min}:${sec.toString().padStart(2, '0')}`;

        if (timerContainer) {
            timerContainer.className = 'wp-timer';
            if (remaining <= 60) timerContainer.classList.add('danger');
            else if (remaining <= 180) timerContainer.classList.add('warning');
        }
    }

    _onPuzzleStart(data) {
        const counterEl = document.getElementById('wp-puzzle-counter');
        const statusEl = document.getElementById('wp-training-status');

        if (counterEl) counterEl.textContent = `${typeof i18n !== 'undefined' ? i18n.t('train_puzzle') : 'Puzzle'} ${data.puzzleIndex + 1}/${data.totalPuzzles}`;
        if (statusEl) {
            statusEl.textContent = typeof i18n !== 'undefined' ? i18n.t('train_your_turn_hint') : 'Lượt của bạn!';
            statusEl.className = 'wp-training-status thinking';
        }

        this._updateSessionQuickStats();
    }

    async _onPuzzleComplete(data) {
        const statusEl = document.getElementById('wp-training-status');

        if (data.correct) {
            this.solvedPuzzleIndices.add(data.puzzleIndex);
            if (statusEl) {
                statusEl.textContent = typeof i18n !== 'undefined' ? i18n.t('train_complete') : '✓ Hoàn thành puzzle!';
                statusEl.className = 'wp-training-status correct';
            }
        } else {
            if (statusEl) {
                statusEl.textContent = typeof i18n !== 'undefined' ? i18n.t('train_complete_mistakes', data.mistakes) : `✓ Puzzle hoàn thành (${data.mistakes} lỗi)`;
                statusEl.className = 'wp-training-status incorrect';
            }
        }

        // Record attempt to server
        try {
            await this._api(`/api/woodpecker/sessions/${this.currentSessionId}/attempt`, {
                method: 'POST',
                body: {
                    setId: this.currentSetId,
                    puzzleIndex: data.puzzleIndex,
                    correct: data.correct,
                    timeMs: data.timeMs
                }
            });
        } catch (err) {
            console.warn('Failed to record attempt:', err);
        }

        this._updateProgress();
        this._updateSessionQuickStats();

        // Move to next puzzle after delay
        setTimeout(() => {
            if (this.trainer.isActive || this.trainer.remainingSeconds > 0) {
                this._startNextPuzzle();
            }
        }, 1500);
    }

    async _onSessionComplete(data) {
        // Save session to server
        try {
            await this._api(`/api/woodpecker/sessions/${this.currentSessionId}`, {
                method: 'PUT',
                body: {
                    setId: this.currentSetId,
                    duration: data.duration
                }
            });
        } catch (err) {
            console.warn('Failed to save session:', err);
        }

        // Check if all puzzles in cycle are solved
        const allSolved = this.solvedPuzzleIndices.size >= this.trainer.puzzles.length;
        if (allSolved) {
            try {
                await this._api(`/api/woodpecker/sets/${this.currentSetId}/complete-cycle`, { method: 'POST' });
            } catch { }
        }

        // Show summary
        this._showSessionSummary(data, allSolved);
    }

    _showSessionSummary(data, cycleComplete) {
        const t = (k, ...a) => typeof i18n !== 'undefined' ? i18n.t(k, ...a) : k;
        const ppm = data.duration > 0 ? (data.puzzlesSolved / (data.duration / 60)).toFixed(2) : '0.00';
        const rate = data.puzzlesAttempted > 0
            ? (data.puzzlesSolved / data.puzzlesAttempted * 100).toFixed(1) : '0.0';

        let reasonText = '';
        switch (data.reason) {
            case 'timeout': reasonText = t('summary_timeout'); break;
            case 'all_solved': reasonText = t('summary_all_solved'); break;
            default: reasonText = t('summary_ended');
        }

        this._openModal(t('summary_title'), `
            <div class="wp-session-summary">
                <div class="summary-icon">${cycleComplete ? '🎉' : data.reason === 'timeout' ? '⏰' : '✅'}</div>
                <div class="summary-title">${cycleComplete ? t('summary_cycle_done') : t('summary_session_end')}</div>
                <div class="summary-subtitle">${reasonText}</div>
                <div class="summary-stats">
                    <div class="summary-stat">
                        <div class="summary-stat-value">${data.puzzlesSolved}/${data.puzzlesAttempted}</div>
                        <div class="summary-stat-label">${t('summary_solved')}</div>
                    </div>
                    <div class="summary-stat">
                        <div class="summary-stat-value">${rate}%</div>
                        <div class="summary-stat-label">${t('summary_accuracy')}</div>
                    </div>
                    <div class="summary-stat">
                        <div class="summary-stat-value">${ppm}</div>
                        <div class="summary-stat-label">${t('summary_ppm')}</div>
                    </div>
                </div>
                <div class="summary-actions">
                    <button class="wp-btn wp-btn-secondary" onclick="wpApp.backToSetDetail()">${t('summary_view_stats')}</button>
                    ${!cycleComplete ? `<button class="wp-btn wp-btn-primary" onclick="wpApp.closeModal();wpApp.startSession();">${t('summary_continue')}</button>` : ''}
                </div>
            </div>
        `);
    }

    _onStatusChange(data) {
        const statusEl = document.getElementById('wp-training-status');
        if (!statusEl) return;

        switch (data.status) {
            case 'your_turn':
                statusEl.textContent = typeof i18n !== 'undefined' ? i18n.t('train_your_turn') : 'Lượt của bạn!';
                statusEl.className = 'wp-training-status thinking';
                break;
            case 'incorrect':
                statusEl.textContent = typeof i18n !== 'undefined' ? i18n.t('train_wrong_retry', data.mistakes) : `Sai! (${data.mistakes} lỗi)`;
                statusEl.className = 'wp-training-status incorrect';
                break;
        }
    }

    _onMoveCompleted(data) {
        // Visual feedback handled by trainer
    }

    _updateSessionQuickStats() {
        if (!this.trainer) return;
        const stats = this.trainer.getSessionStats();

        const el = document.getElementById('wp-session-quick-stats');
        if (el) {
            const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
            el.innerHTML = `
                <div class="quick-stat">
                    <div class="quick-stat-value">${stats.solved}/${stats.attempted}</div>
                    <div class="quick-stat-label">${t('train_solved')}</div>
                </div>
                <div class="quick-stat">
                    <div class="quick-stat-value">${stats.successRate}%</div>
                    <div class="quick-stat-label">${t('train_accuracy')}</div>
                </div>
                <div class="quick-stat">
                    <div class="quick-stat-value">${stats.ppm}</div>
                    <div class="quick-stat-label">${t('train_ppm')}</div>
                </div>
            `;
        }
    }

    backToSetDetail() {
        this.closeModal();
        if (this.trainer) {
            this.trainer.reset();
        }
        if (this.currentSetId) {
            this.showSetDetail(this.currentSetId);
        } else {
            this._showDashboard();
        }
    }

    endSessionManual() {
        if (!this.trainer) return;
        const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;

        // Show custom confirmation modal instead of native confirm()
        this._openModal(t('end_title'), `
            <div style="text-align:center;padding:16px;">
                <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
                <p style="margin-bottom:24px;color:var(--text-secondary);">${t('end_msg')}</p>
                <div style="display:flex;gap:12px;justify-content:center;">
                    <button class="wp-btn wp-btn-secondary" onclick="wpApp.closeModal()">${t('end_cancel')}</button>
                    <button class="wp-btn wp-btn-danger" onclick="wpApp._confirmEndSession()">${t('end_confirm')}</button>
                </div>
            </div>
        `);
    }

    async _confirmEndSession() {
        this.closeModal();

        if (!this.trainer) return;

        // Stop the timer and mark inactive immediately
        if (this.trainer.timerInterval) {
            clearInterval(this.trainer.timerInterval);
            this.trainer.timerInterval = null;
        }
        this.trainer.isActive = false;

        const duration = Math.floor((Date.now() - this.trainer.sessionStartTime) / 1000);
        const sessionData = {
            reason: 'manual',
            duration: Math.min(duration, this.trainer.SESSION_DURATION),
            attempts: this.trainer.sessionAttempts,
            puzzlesAttempted: this.trainer.sessionAttempts.length,
            puzzlesSolved: this.trainer.sessionAttempts.filter(a => a.correct).length
        };

        // Save session to server (await to ensure data is persisted)
        try {
            await this._api(`/api/woodpecker/sessions/${this.currentSessionId}`, {
                method: 'PUT',
                body: {
                    setId: this.currentSetId,
                    duration: sessionData.duration
                }
            });
        } catch (err) {
            console.warn('Failed to save session:', err);
        }

        // Check if all puzzles in cycle are solved
        const allSolved = this.solvedPuzzleIndices.size >= this.trainer.puzzles.length;
        if (allSolved) {
            try {
                await this._api(`/api/woodpecker/sets/${this.currentSetId}/complete-cycle`, { method: 'POST' });
            } catch { }
        }

        // Show summary
        this._showSessionSummary(sessionData, allSolved);
    }

    /**
     * Save session on page unload (F5 / close tab)
     */
    _setupBeforeUnload() {
        window.addEventListener('beforeunload', () => {
            if (this.trainer && this.trainer.isActive && this.currentSessionId) {
                const duration = Math.floor((Date.now() - this.trainer.sessionStartTime) / 1000);
                // Use sendBeacon for reliable delivery during unload
                const payload = JSON.stringify({
                    setId: this.currentSetId,
                    duration: Math.min(duration, this.trainer.SESSION_DURATION)
                });
                navigator.sendBeacon(
                    `/api/woodpecker/sessions/${this.currentSessionId}/end`,
                    new Blob([payload], { type: 'application/json' })
                );
            }
        });
    }

    // ===== ADMIN VIEW =====
    async showAdmin() {
        if (!this.user || this.user.role !== 'admin') return;
        this._switchView('view-admin');
        await this._loadAdminData();
    }

    async _loadAdminData() {
        const usersContainer = document.getElementById('wp-admin-users-list');
        const setsContainer = document.getElementById('wp-admin-sets-list');
        const pendingContainer = document.getElementById('wp-admin-pending-list');
        const pendingSection = document.getElementById('wp-admin-pending-section');
        const pendingCount = document.getElementById('wp-pending-count');

        try {
            const [users, sets] = await Promise.all([
                this._api('/api/admin/users'),
                this._api('/api/admin/puzzle-sets')
            ]);

            // Separate pending and active users
            const pendingUsers = users.filter(u => u.status === 'pending');
            const activeUsers = users.filter(u => u.status !== 'pending');

            // Render pending users section
            if (pendingUsers.length > 0) {
                pendingSection.style.display = '';
                pendingCount.textContent = pendingUsers.length;
                pendingContainer.innerHTML = pendingUsers.map(u => `
                    <div class="wp-admin-item wp-pending-item">
                        <div class="wp-admin-item-icon">⏳</div>
                        <div class="wp-admin-item-info">
                            <div class="wp-admin-item-name">${u.fullName || u.username} <span class="wp-status-badge pending">Chờ duyệt</span></div>
                            <div class="wp-admin-item-meta">@${u.username} · Sinh: ${u.dateOfBirth ? new Date(u.dateOfBirth).toLocaleDateString('vi') : 'N/A'} · Đăng ký: ${new Date(u.createdAt).toLocaleDateString('vi')}</div>
                        </div>
                        <div class="wp-admin-item-actions">
                            <button class="wp-btn wp-btn-success wp-btn-sm" onclick="wpApp.approveUser('${u.id}')" title="Duyệt">✓ Duyệt</button>
                            <button class="wp-btn wp-btn-danger wp-btn-sm" onclick="wpApp.rejectUser('${u.id}')" title="Từ chối">✕ Từ chối</button>
                        </div>
                    </div>
                `).join('');
            } else {
                pendingSection.style.display = 'none';
            }

            // Render active users
            usersContainer.innerHTML = activeUsers.map(u => `
                <div class="wp-admin-item">
                    <div class="wp-admin-item-icon">${u.role === 'admin' ? '👑' : '👤'}</div>
                    <div class="wp-admin-item-info">
                        <div class="wp-admin-item-name">${u.username}${u.fullName ? ` <span style="opacity:0.6;font-size:0.85em;">(${u.fullName})</span>` : ''}</div>
                        <div class="wp-admin-item-meta">${u.role} · ${new Date(u.createdAt).toLocaleDateString('vi')}</div>
                    </div>
                    <div class="wp-admin-item-actions">
                        ${u.role !== 'admin' ? `<button class="wp-btn wp-btn-danger wp-btn-sm" onclick="wpApp.deleteUser('${u.id}')">🗑</button>` : ''}
                    </div>
                </div>
            `).join('');

            setsContainer.innerHTML = sets.length > 0 ? sets.map(s => `
                <div class="wp-admin-item">
                    <div class="wp-admin-item-icon">🧩</div>
                    <div class="wp-admin-item-info">
                        <div class="wp-admin-item-name">${s.name}</div>
                        <div class="wp-admin-item-meta">${s.puzzleCount} puzzles · Gán cho: ${s.assignedUsername} · ${s.cycles.length} cycles</div>
                    </div>
                    <div class="wp-admin-item-actions">
                        <button class="wp-btn wp-btn-secondary wp-btn-sm" onclick="wpApp.showAssignSetForm('${s.id}', '${s.name.replace(/'/g, "\\\'")}', '${s.pgnFile}')" title="Gán thêm User">👥+</button>
                        <button class="wp-btn wp-btn-danger wp-btn-sm" onclick="wpApp.deletePuzzleSet('${s.id}')">🗑</button>
                    </div>
                </div>
            `).join('') : '<div class="wp-empty"><div class="empty-sub">Chưa có puzzle set nào</div></div>';
        } catch (err) {
            usersContainer.innerHTML = `<div class="wp-empty"><div class="empty-text">Lỗi: ${err.message}</div></div>`;
        }
    }

    showCreateUserForm() {
        this._openModal('Tạo User Mới', `
            <div class="wp-form-group">
                <label>Username</label>
                <input class="wp-input" id="new-user-username" placeholder="Nhập username">
            </div>
            <div class="wp-form-group">
                <label>Password</label>
                <input class="wp-input" id="new-user-password" type="password" placeholder="Nhập password">
            </div>
            <div class="wp-form-group">
                <label>Role</label>
                <select class="wp-input" id="new-user-role">
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
                <button class="wp-btn wp-btn-secondary" onclick="wpApp.closeModal()">Hủy</button>
                <button class="wp-btn wp-btn-primary" onclick="wpApp.createUser()">Tạo</button>
            </div>
        `);
    }

    async createUser() {
        const username = document.getElementById('new-user-username').value.trim();
        const password = document.getElementById('new-user-password').value;
        const role = document.getElementById('new-user-role').value;

        if (!username || !password) {
            this.showToast('Nhập đầy đủ thông tin', 'error');
            return;
        }

        try {
            await this._api('/api/admin/users', {
                method: 'POST',
                body: { username, password, role }
            });
            this.closeModal();
            this.showToast('Đã tạo user mới!', 'success');
            this._loadAdminData();
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    async approveUser(userId) {
        try {
            const data = await this._api(`/api/admin/users/${userId}/approve`, { method: 'POST' });
            this.showToast(data.message || 'Đã duyệt user!', 'success');
            this._loadAdminData();
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    async rejectUser(userId) {
        this._openModal('Xác nhận từ chối', `
            <p style="margin-bottom:16px;">Bạn có chắc muốn từ chối đăng ký này? Tài khoản sẽ bị xóa.</p>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button class="wp-btn wp-btn-secondary" onclick="wpApp.closeModal()">Hủy</button>
                <button class="wp-btn wp-btn-danger" onclick="wpApp._confirmRejectUser('${userId}')">Từ chối</button>
            </div>
        `);
    }

    async _confirmRejectUser(userId) {
        try {
            const data = await this._api(`/api/admin/users/${userId}/reject`, { method: 'POST' });
            this.closeModal();
            this.showToast(data.message || 'Đã từ chối đăng ký!', 'success');
            this._loadAdminData();
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    deleteUser(userId) {
        const t = typeof i18n !== 'undefined' ? (k) => i18n.t(k) : (k) => k;
        this._openModal(t('admin_delete_user_title'), `
            <div style="text-align:center;padding:16px;">
                <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
                <p style="margin-bottom:24px;color:var(--text-secondary);">${t('admin_delete_user_msg')}</p>
                <div style="display:flex;gap:12px;justify-content:center;">
                    <button class="wp-btn wp-btn-secondary" onclick="wpApp.closeModal()">${t('admin_cancel')}</button>
                    <button class="wp-btn wp-btn-danger" onclick="wpApp._confirmDeleteUser('${userId}')">${t('admin_delete')}</button>
                </div>
            </div>
        `);
    }

    async _confirmDeleteUser(userId) {
        this.closeModal();
        try {
            await this._api(`/api/admin/users/${userId}`, { method: 'DELETE' });
            this.showToast('Đã xóa user', 'info');
            this._loadAdminData();
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    async showCreatePuzzleSetForm() {
        let users = [];
        try {
            users = await this._api('/api/admin/users');
        } catch { }

        const userCheckboxes = users.filter(u => u.role !== 'admin').map(u =>
            `<label class="wp-checkbox-label">
                <input type="checkbox" name="assignUsers" value="${u.id}"> ${u.username}
            </label>`
        ).join('');

        this._openModal('Tạo Puzzle Set Mới', `
            <div class="wp-form-group">
                <label>Tên Set</label>
                <input class="wp-input" id="new-set-name" placeholder="Ví dụ: Tactics Level 1">
            </div>
            <div class="wp-form-group">
                <label>Gán cho Users (chọn nhiều)</label>
                <div class="wp-checkbox-group" id="new-set-users">
                    ${userCheckboxes || '<span style="color:var(--text-muted)">Chưa có user nào</span>'}
                </div>
            </div>
            <div class="wp-form-group">
                <label>File PGN</label>
                <div class="wp-file-upload" id="wp-file-upload">
                    <input type="file" id="new-set-pgn" accept=".pgn">
                    <div class="upload-icon">📁</div>
                    <div class="upload-text">Kéo thả file PGN hoặc click để chọn</div>
                    <div class="upload-filename" id="upload-filename"></div>
                </div>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
                <button class="wp-btn wp-btn-secondary" onclick="wpApp.closeModal()">Hủy</button>
                <button class="wp-btn wp-btn-primary" onclick="wpApp.createPuzzleSet()">Tạo</button>
            </div>
        `);

        // File change listener
        setTimeout(() => {
            const fileInput = document.getElementById('new-set-pgn');
            if (fileInput) {
                fileInput.addEventListener('change', (e) => {
                    const name = e.target.files[0]?.name || '';
                    document.getElementById('upload-filename').textContent = name;
                });
            }
        }, 100);
    }

    async createPuzzleSet() {
        const name = document.getElementById('new-set-name').value.trim();
        const checkboxes = document.querySelectorAll('#new-set-users input[name="assignUsers"]:checked');
        const selectedUsers = Array.from(checkboxes).map(cb => cb.value);
        const fileInput = document.getElementById('new-set-pgn');

        if (selectedUsers.length === 0) {
            this.showToast('Chọn ít nhất 1 user', 'error');
            return;
        }

        if (!fileInput.files[0]) {
            this.showToast('Chọn file PGN', 'error');
            return;
        }

        try {
            const formData = new FormData();
            formData.append('pgn', fileInput.files[0]);
            formData.append('name', name || fileInput.files[0].name.replace('.pgn', ''));
            // Send multiple users as JSON array
            formData.append('assignedTo', JSON.stringify(selectedUsers));

            await this._api('/api/admin/puzzle-sets', {
                method: 'POST',
                body: formData
            });
            this.closeModal();
            this.showToast('Đã tạo puzzle set!', 'success');
            this._loadAdminData();
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    deletePuzzleSet(setId) {
        const t = typeof i18n !== 'undefined' ? (k) => i18n.t(k) : (k) => k;
        this._openModal(t('admin_delete_set_title'), `
            <div style="text-align:center;padding:16px;">
                <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
                <p style="margin-bottom:24px;color:var(--text-secondary);">${t('admin_delete_set_msg')}</p>
                <div style="display:flex;gap:12px;justify-content:center;">
                    <button class="wp-btn wp-btn-secondary" onclick="wpApp.closeModal()">${t('admin_cancel')}</button>
                    <button class="wp-btn wp-btn-danger" onclick="wpApp._confirmDeletePuzzleSet('${setId}')">${t('admin_delete')}</button>
                </div>
            </div>
        `);
    }

    async _confirmDeletePuzzleSet(setId) {
        this.closeModal();
        try {
            await this._api(`/api/admin/puzzle-sets/${setId}`, { method: 'DELETE' });
            this.showToast('Đã xóa puzzle set', 'info');
            this._loadAdminData();
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    async showAssignSetForm(setId, setName, pgnFile) {
        let users = [];
        try {
            users = await this._api('/api/admin/users');
        } catch { }

        // Get existing assignments for this PGN file
        let allSets = [];
        try {
            allSets = await this._api('/api/admin/puzzle-sets');
        } catch { }
        const assignedUserIds = allSets.filter(s => s.pgnFile === pgnFile).map(s => s.assignedTo);

        const userCheckboxes = users.filter(u => u.role !== 'admin').map(u => {
            const checked = assignedUserIds.includes(u.id) ? 'checked disabled' : '';
            return `<label class="wp-checkbox-label">
                <input type="checkbox" name="assignUsers" value="${u.id}" ${checked}> ${u.username}
                ${assignedUserIds.includes(u.id) ? '<span style="font-size:0.75rem;color:var(--text-muted);">(đã gán)</span>' : ''}
            </label>`;
        }).join('');

        this._openModal(`Gán "${setName}" cho Users`, `
            <div class="wp-form-group">
                <label>Chọn users để gán thêm</label>
                <div class="wp-checkbox-group" id="assign-set-users">
                    ${userCheckboxes}
                </div>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
                <button class="wp-btn wp-btn-secondary" onclick="wpApp.closeModal()">Hủy</button>
                <button class="wp-btn wp-btn-primary" onclick="wpApp._confirmAssignSet('${setId}')">Gán</button>
            </div>
`);
    }

    async _confirmAssignSet(sourceSetId) {
        const checkboxes = document.querySelectorAll('#assign-set-users input[name="assignUsers"]:checked:not(:disabled)');
        const newUserIds = Array.from(checkboxes).map(cb => cb.value);

        if (newUserIds.length === 0) {
            this.showToast('Chọn ít nhất 1 user mới', 'error');
            return;
        }

        this.closeModal();
        try {
            await this._api(`/api/admin/puzzle-sets/${sourceSetId}/assign`, {
                method: 'POST',
                body: { userIds: newUserIds }
            });
            this.showToast(`Đã gán cho ${newUserIds.length} user(s)`, 'success');
            this._loadAdminData();
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    // ===== MODAL =====
    _openModal(title, bodyHtml) {
        document.getElementById('wp-modal-title').textContent = title;
        document.getElementById('wp-modal-body').innerHTML = bodyHtml;
        document.getElementById('wp-modal-overlay').classList.add('active');
    }

    closeModal() {
        document.getElementById('wp-modal-overlay').classList.remove('active');
    }

    // ===== TOAST =====
    showToast(message, type = 'info') {
        const container = document.getElementById('wp-toast-container');
        const toast = document.createElement('div');
        toast.className = `wp-toast ${type}`;
        toast.innerHTML = `
            <span>${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
            <span>${message}</span>
        `;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    // ===== UTILS =====
    _formatTime(totalSeconds) {
        if (!totalSeconds) return '0m 0s';
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m ${s}s`;
    }
}

// Initialize app
let wpApp;
document.addEventListener('DOMContentLoaded', () => {
    wpApp = new WoodpeckerApp();
    wpApp.init();
});
