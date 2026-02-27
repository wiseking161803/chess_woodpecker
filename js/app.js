/**
 * App V2 - Main application controller
 * Learn/Review tabs are per-chapter, not per-course
 */

class App {
    constructor(courseManager) {
        this.courseManager = courseManager;
        this.board = null;
        this.trainer = null;
        this.currentCourseId = null;
        this.currentChapterId = null;
        this.currentTab = 'learn';

        // Training queue
        this.trainingQueue = [];
        this.trainingQueueIndex = 0;
        this.trainingMode = 'learn';
    }

    async _init() {
        await this.courseManager.fetchCourses();
        this._handleRoute();
        window.addEventListener('hashchange', () => this._handleRoute());
    }

    // ========================
    // ROUTING
    // ========================

    _handleRoute() {
        const hash = window.location.hash.slice(1);
        const parts = hash.split('/');

        if (parts[0] === 'admin') {
            this._showAdminView();
        } else if (parts[0] === 'course' && parts[1]) {
            this.currentCourseId = parts[1];
            if (parts[2] === 'chapter' && parts[3]) {
                this.currentChapterId = parts[3];
                if (parts[4] === 'line' && parts[5] !== undefined) {
                    const lineIdx = parseInt(parts[5]);
                    const mode = parts[6] || 'learn';
                    this._showTrainingView(parts[3], lineIdx, mode);
                } else {
                    this._showChapterDetailView(parts[3]);
                }
            } else {
                this._showCourseDetailView(parts[1]);
            }
        } else {
            this._showCoursesView();
        }
    }

    navigate(view, params = {}) {
        switch (view) {
            case 'courses':
                window.location.hash = '';
                break;
            case 'course-detail':
                window.location.hash = `course/${params.courseId}`;
                break;
            case 'chapter-detail':
                window.location.hash = `course/${params.courseId}/chapter/${params.chapterId}`;
                break;
            case 'training':
                window.location.hash = `course/${params.courseId}/chapter/${params.chapterId}/line/${params.lineIndex}/${params.mode || 'learn'}`;
                break;
            case 'admin':
                window.location.hash = 'admin';
                break;
        }
    }

    _switchView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const view = document.getElementById(viewId);
        if (view) view.classList.add('active');
        document.getElementById('completion-overlay').classList.remove('active');
    }

    // ========================
    // COURSES VIEW
    // ========================

    async _showCoursesView() {
        this._switchView('view-courses');
        await this.courseManager.fetchCourses();
        this._renderCourses();
    }

    _renderCourses() {
        const grid = document.getElementById('course-grid');
        const courses = this.courseManager.courses;

        if (courses.length === 0) {
            grid.innerHTML = `
                <div class="empty-state-card">
                    <div class="empty-icon">📚</div>
                    <h3>Chưa có khóa học nào</h3>
                    <p>Vào phần Quản trị (⚙) để tạo khóa học và upload file PGN</p>
                    <button class="btn btn-primary" onclick="app.navigate('admin')">⚙ Quản trị</button>
                </div>
            `;
            return;
        }

        grid.innerHTML = courses.map(course => {
            const stats = this.courseManager.getCourseStats(course.id);
            const totalLearned = stats.learning + stats.review + stats.mastered;
            const progress = stats.total > 0 ? (totalLearned / stats.total) * 100 : 0;

            return `
                <div class="course-card" onclick="app.navigate('course-detail', { courseId: '${course.id}' })">
                    <div class="course-card-header">
                        <div class="course-card-icon">${course.icon || '♞'}</div>
                        <div class="course-card-info">
                            <div class="course-card-name">${course.name}</div>
                            <div class="course-card-desc">${course.description || ''}</div>
                        </div>
                    </div>
                    <div class="course-card-stats">
                        ${stats.total > 0 ? `
                            ${stats.new > 0 ? `<span class="stat-badge new">📘 ${stats.new} mới</span>` : ''}
                            ${stats.dueNow > 0 ? `<span class="stat-badge due">🔥 ${stats.dueNow} cần ôn</span>` : ''}
                            ${stats.mastered > 0 ? `<span class="stat-badge mastered">✅ ${stats.mastered}</span>` : ''}
                        ` : `<span class="stat-badge new">${course.chapters.length} chương</span>`}
                    </div>
                    <div class="progress-bar">
                        <div class="progress-bar-fill" style="width: ${progress}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ========================
    // COURSE DETAIL VIEW (chapter list only)
    // ========================

    async _showCourseDetailView(courseId) {
        this._switchView('view-course-detail');
        this.currentCourseId = courseId;

        await this.courseManager.fetchCourses();
        const course = this.courseManager.getCourse(courseId);
        if (!course) return;

        document.getElementById('detail-breadcrumb-name').textContent = course.name;
        document.getElementById('detail-course-name').textContent = course.name;
        document.getElementById('detail-course-desc').textContent = course.description || '';

        this._renderCourseChapters(course);
    }

    _renderCourseChapters(course) {
        const list = document.getElementById('course-chapter-list');

        if (course.chapters.length === 0) {
            list.innerHTML = `
                <div class="tab-panel-empty">
                    <div class="empty-icon">📑</div>
                    <div class="empty-text">Chưa có chương nào</div>
                    <div class="empty-subtext">Vào phần Quản trị (⚙) để thêm chương và upload PGN</div>
                </div>
            `;
            return;
        }

        list.innerHTML = course.chapters.map((chapter, idx) => {
            const stats = this.courseManager.getChapterStats(course.id, chapter.id, chapter.lineCount || 0);
            const totalLearned = stats.learning + stats.review + stats.mastered;
            const progress = stats.total > 0 ? (totalLearned / stats.total) * 100 : 0;

            return `
                <div class="chapter-item" onclick="app.navigate('chapter-detail', { courseId: '${course.id}', chapterId: '${chapter.id}' })">
                    <div class="chapter-number">${idx + 1}</div>
                    <div class="chapter-info">
                        <div class="chapter-title">${chapter.name}</div>
                        <div class="chapter-subtitle">
                            ${chapter.lineCount || 0} biến
                            ${stats.dueNow > 0 ? ` · <span style="color:var(--danger)">🔥 ${stats.dueNow} cần ôn</span>` : ''}
                            ${stats.new > 0 ? ` · <span style="color:var(--info)">📘 ${stats.new} mới</span>` : ''}
                        </div>
                    </div>
                    <div style="width:80px;">
                        <div class="progress-bar"><div class="progress-bar-fill" style="width:${progress}%"></div></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ========================
    // CHAPTER DETAIL VIEW (Learn / Review / Lines tabs)
    // ========================

    async _showChapterDetailView(chapterId) {
        this._switchView('view-chapter-detail');
        this.currentChapterId = chapterId;

        const course = this.courseManager.getCourse(this.currentCourseId);
        const chapter = course?.chapters.find(ch => ch.id === chapterId);
        if (!course || !chapter) return;

        document.getElementById('chapterdetail-breadcrumb-course').textContent = course.name;
        document.getElementById('chapterdetail-breadcrumb-name').textContent = chapter.name;
        document.getElementById('chapterdetail-name').textContent = chapter.name;
        document.getElementById('chapterdetail-desc').textContent =
            `${chapter.lineCount || 0} biến từ file ${chapter.originalName || 'PGN'}`;

        // Load PGN
        await this.courseManager.loadChapterPGN(chapterId);

        this._updateTabCounts();
        this.switchTab(this.currentTab);
    }

    _updateTabCounts() {
        const chapter = this._getCurrentChapter();
        if (!chapter) return;

        const stats = this.courseManager.getChapterStats(this.currentCourseId, this.currentChapterId, chapter.lineCount || 0);
        const newLines = this._getNewLinesForChapter();
        const dueLines = this._getDueLinesForChapter();

        document.getElementById('tab-learn-count').textContent = newLines.length;
        document.getElementById('tab-review-count').textContent = dueLines.length;
        document.getElementById('tab-lines-count').textContent = chapter.lineCount || 0;

        const reviewBadge = document.getElementById('tab-review-count');
        reviewBadge.classList.toggle('has-due', dueLines.length > 0);
    }

    _getCurrentChapter() {
        const course = this.courseManager.getCourse(this.currentCourseId);
        return course?.chapters.find(ch => ch.id === this.currentChapterId);
    }

    _getNewLinesForChapter() {
        const chapter = this._getCurrentChapter();
        if (!chapter) return [];
        const lines = [];
        for (let i = 0; i < (chapter.lineCount || 0); i++) {
            const cardId = `${this.currentCourseId}:${this.currentChapterId}:${i}`;
            const card = this.courseManager.sr.data.cards[cardId];
            if (!card || card.state === 'new') {
                lines.push({ cardId, courseId: this.currentCourseId, chapterId: this.currentChapterId, chapterName: chapter.name, lineIndex: i });
            }
        }
        return lines;
    }

    _getDueLinesForChapter() {
        const chapter = this._getCurrentChapter();
        if (!chapter) return [];
        const lines = [];
        const now = new Date();
        for (let i = 0; i < (chapter.lineCount || 0); i++) {
            const cardId = `${this.currentCourseId}:${this.currentChapterId}:${i}`;
            const card = this.courseManager.sr.data.cards[cardId];
            if (card && card.state !== 'new' && card.nextReview && new Date(card.nextReview) <= now) {
                lines.push({ cardId, courseId: this.currentCourseId, chapterId: this.currentChapterId, chapterName: chapter.name, lineIndex: i });
            }
        }
        lines.sort((a, b) => {
            const ca = this.courseManager.sr.data.cards[a.cardId];
            const cb = this.courseManager.sr.data.cards[b.cardId];
            return new Date(ca.nextReview) - new Date(cb.nextReview);
        });
        return lines;
    }

    switchTab(tabName) {
        this.currentTab = tabName;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        const tabEl = document.getElementById('tab-' + tabName);
        if (tabEl) tabEl.classList.add('active');

        switch (tabName) {
            case 'learn': this._renderLearnTab(); break;
            case 'review': this._renderReviewTab(); break;
            case 'lines': this._renderLinesTab(); break;
        }
    }

    _renderLearnTab() {
        const newLines = this._getNewLinesForChapter();
        const emptyEl = document.getElementById('learn-empty');
        const contentEl = document.getElementById('learn-content');

        if (newLines.length === 0) {
            emptyEl.style.display = 'flex';
            contentEl.style.display = 'none';
            return;
        }

        emptyEl.style.display = 'none';
        contentEl.style.display = 'block';
        document.getElementById('learn-info-text').textContent = `Còn ${newLines.length} biến mới cần học`;

        const listEl = document.getElementById('learn-lines-list');
        listEl.innerHTML = newLines.map((line, idx) => {
            const title = this.courseManager.getLineTitle(line.chapterId, line.lineIndex);
            return `
                <div class="line-item" onclick="app.startLearnLine(${line.lineIndex})">
                    <div class="line-number">${idx + 1}</div>
                    <div class="line-info">
                        <div class="line-title">${title}</div>
                        <div class="line-subtitle">Biến ${line.lineIndex + 1}</div>
                    </div>
                    <span class="chapter-state-label new">Mới</span>
                </div>
            `;
        }).join('');
    }

    _renderReviewTab() {
        const dueLines = this._getDueLinesForChapter();
        const emptyEl = document.getElementById('review-empty');
        const contentEl = document.getElementById('review-content');

        if (dueLines.length === 0) {
            emptyEl.style.display = 'flex';
            contentEl.style.display = 'none';
            return;
        }

        emptyEl.style.display = 'none';
        contentEl.style.display = 'block';
        document.getElementById('review-info-text').textContent = `${dueLines.length} biến cần ôn tập`;

        const listEl = document.getElementById('review-lines-list');
        listEl.innerHTML = dueLines.map((line, idx) => {
            const title = this.courseManager.getLineTitle(line.chapterId, line.lineIndex);
            const card = this.courseManager.sr.getCard(line.cardId);
            return `
                <div class="line-item" onclick="app.startReviewLine(${line.lineIndex})">
                    <div class="line-number">${idx + 1}</div>
                    <div class="line-info">
                        <div class="line-title">${title}</div>
                        <div class="line-subtitle">🔥${card.streak || 0} streak</div>
                    </div>
                    <span class="chapter-state-label due">Cần ôn</span>
                </div>
            `;
        }).join('');
    }

    _renderLinesTab() {
        const games = this.courseManager.pgnCache[this.currentChapterId] || [];
        const listEl = document.getElementById('all-lines-list');

        listEl.innerHTML = games.map((game, idx) => {
            const cardId = `${this.currentCourseId}:${this.currentChapterId}:${idx}`;
            const card = this.courseManager.sr.getCard(cardId);
            const isDue = this.courseManager.sr.isDue(cardId);
            const stateClass = isDue ? 'due' : (card.state || 'new');
            const stateLabel = isDue ? 'Cần ôn' : this._getStateLabel(card.state);
            const mode = card.state === 'new' ? 'learn' : 'review';

            return `
                <div class="line-item state-${stateClass}" onclick="app.navigate('training', { courseId: '${this.currentCourseId}', chapterId: '${this.currentChapterId}', lineIndex: ${idx}, mode: '${mode}' })">
                    <div class="line-number">${idx + 1}</div>
                    <div class="line-info">
                        <div class="line-title">${game.black || 'Biến ' + (idx + 1)}</div>
                        <div class="line-subtitle">${game.white || ''} ${game.eco ? '· ' + game.eco : ''}</div>
                    </div>
                    <div class="chapter-status">
                        ${card.streak > 0 ? `<span style="font-size:0.75rem;color:var(--text-muted);">🔥${card.streak}</span>` : ''}
                        <span class="chapter-state-label ${stateClass}">${stateLabel}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    _getStateLabel(state) {
        switch (state) {
            case 'learning': return 'Đang học';
            case 'review': return 'Ôn tập';
            case 'mastered': return 'Thành thạo';
            default: return 'Mới';
        }
    }

    // ========================
    // TRAINING VIEW
    // ========================

    async _showTrainingView(chapterId, lineIndex, mode) {
        this._switchView('view-training');
        this.currentChapterId = chapterId;

        const course = this.courseManager.getCourse(this.currentCourseId);
        const chapter = course?.chapters.find(ch => ch.id === chapterId);
        if (!course || !chapter) return;

        const games = await this.courseManager.loadChapterPGN(chapterId);
        const game = games[lineIndex];
        if (!game) return;

        const cardId = `${this.currentCourseId}:${chapterId}:${lineIndex}`;
        const lineTitle = game.black || `Biến ${lineIndex + 1}`;

        // Breadcrumbs
        document.getElementById('training-breadcrumb-course').textContent = course.name;
        document.getElementById('training-breadcrumb-chapter').textContent = chapter.name;
        document.getElementById('training-breadcrumb-line').textContent = lineTitle;
        document.getElementById('training-title').textContent = lineTitle;

        // Mode badge
        const badge = document.getElementById('training-mode-badge');
        badge.className = `training-mode-badge ${mode}`;
        badge.textContent = mode === 'learn' ? '📘 Học mới' : '🔄 Ôn tập';

        // Comment panel visibility
        document.getElementById('comment-panel').style.display = mode === 'learn' ? 'block' : 'none';

        // Queue
        const queueEl = document.getElementById('queue-counter');
        queueEl.textContent = this.trainingQueue.length > 1
            ? `${this.trainingQueueIndex + 1}/${this.trainingQueue.length}` : '';

        // Board setup
        const boardSize = Math.min(480, window.innerWidth - 40);
        if (!this.board) {
            this.board = new ChessBoard('chessboard', { size: boardSize, interactive: true, playerColor: 'w' });
        } else {
            this.board.resize(boardSize);
        }

        // Trainer
        this.trainer = new Trainer(this.board, this.courseManager.sr);
        this.trainer.onMoveCompleted = (data) => this._onMoveCompleted(data);
        this.trainer.onLineCompleted = (data) => this._onLineCompleted(data);
        this.trainer.onMistake = (data) => this._onMistake(data);
        this.trainer.onComment = (data) => this._onComment(data);
        this.trainer.onStatusChange = (data) => this._onStatusChange(data);

        // Clear
        document.getElementById('move-list').innerHTML = '';
        document.getElementById('comment-content').innerHTML = '<span class="comment-empty">Chọn nước đi để xem bình luận</span>';
        document.getElementById('status-message').textContent = 'Đang chuẩn bị...';
        document.getElementById('mistake-counter').textContent = '';
        document.getElementById('completion-overlay').classList.remove('active');

        if (mode === 'learn') {
            this.trainer.startLearn(game, cardId);
        } else {
            this.trainer.startReview(game, cardId);
        }
        this._renderMoveList();
    }

    // ========================
    // LEARN / REVIEW STARTERS (chapter-scoped)
    // ========================

    startNextLearn() {
        const newLines = this._getNewLinesForChapter();
        if (newLines.length === 0) {
            this.showToast('Đã học hết tất cả biến trong chương này! 🎉', 'success');
            return;
        }
        this.trainingQueue = newLines;
        this.trainingQueueIndex = 0;
        this.trainingMode = 'learn';
        const line = newLines[0];
        this.navigate('training', {
            courseId: this.currentCourseId,
            chapterId: this.currentChapterId,
            lineIndex: line.lineIndex,
            mode: 'learn'
        });
    }

    startReviewSession() {
        const dueLines = this._getDueLinesForChapter();
        if (dueLines.length === 0) {
            this.showToast('Không có biến nào cần ôn lúc này!', 'info');
            return;
        }
        this.trainingQueue = dueLines;
        this.trainingQueueIndex = 0;
        this.trainingMode = 'review';
        const line = dueLines[0];
        this.navigate('training', {
            courseId: this.currentCourseId,
            chapterId: this.currentChapterId,
            lineIndex: line.lineIndex,
            mode: 'review'
        });
    }

    startLearnLine(lineIndex) {
        this.trainingQueue = [{ chapterId: this.currentChapterId, lineIndex }];
        this.trainingQueueIndex = 0;
        this.trainingMode = 'learn';
        this.navigate('training', {
            courseId: this.currentCourseId,
            chapterId: this.currentChapterId,
            lineIndex: lineIndex,
            mode: 'learn'
        });
    }

    startReviewLine(lineIndex) {
        this.trainingQueue = [{ chapterId: this.currentChapterId, lineIndex }];
        this.trainingQueueIndex = 0;
        this.trainingMode = 'review';
        this.navigate('training', {
            courseId: this.currentCourseId,
            chapterId: this.currentChapterId,
            lineIndex: lineIndex,
            mode: 'review'
        });
    }

    continueTraining() {
        document.getElementById('completion-overlay').classList.remove('active');
        this.trainingQueueIndex++;

        if (this.trainingQueueIndex < this.trainingQueue.length) {
            const line = this.trainingQueue[this.trainingQueueIndex];
            this.navigate('training', {
                courseId: this.currentCourseId,
                chapterId: line.chapterId || this.currentChapterId,
                lineIndex: line.lineIndex,
                mode: this.trainingMode
            });
        } else {
            this.showToast(
                this.trainingMode === 'learn' ? 'Đã học xong!' : 'Đã ôn tập xong!',
                'success'
            );
            this.backToChapterDetail();
        }
    }

    // ========================
    // TRAINING CALLBACKS
    // ========================

    _onMoveCompleted(data) {
        this._renderMoveList();
        const moveList = document.getElementById('move-list');
        const currentEl = moveList.querySelector('.move-san.current');
        if (currentEl) currentEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        document.getElementById('mistake-counter').textContent =
            this.trainer.mistakes > 0 ? `❌ ${this.trainer.mistakes}` : '';
    }

    _onLineCompleted(data) {
        const overlay = document.getElementById('completion-overlay');
        const icon = document.getElementById('completion-icon');
        const title = document.getElementById('completion-title');
        const text = document.getElementById('completion-text');
        const stats = document.getElementById('completion-stats');

        const hasMore = this.trainingQueueIndex + 1 < this.trainingQueue.length;
        document.getElementById('btn-continue-training').textContent = hasMore ? 'Biến tiếp theo →' : 'Quay lại';

        if (data.mode === 'learn') {
            icon.textContent = '📚';
            title.textContent = 'Bài học hoàn thành!';
            text.textContent = 'Hệ thống sẽ nhắc bạn ôn lại biến này sau.';
            stats.innerHTML = `
                <div class="completion-stat">
                    <div class="completion-stat-value">${this.trainer.currentMoves.length}</div>
                    <div class="completion-stat-label">Nước đi</div>
                </div>
                <div class="completion-stat">
                    <div class="completion-stat-value">${data.mistakes}</div>
                    <div class="completion-stat-label">Sai lầm</div>
                </div>
            `;
        } else {
            const perfect = data.mistakes === 0;
            icon.textContent = perfect ? '🎉' : '💪';
            title.textContent = perfect ? 'Hoàn hảo!' : 'Ôn tập xong!';
            text.textContent = perfect ? 'Nhớ chính xác toàn bộ!' : `${data.mistakes} sai lầm.`;
            stats.innerHTML = `
                <div class="completion-stat">
                    <div class="completion-stat-value">${data.quality}</div>
                    <div class="completion-stat-label">Điểm</div>
                </div>
                <div class="completion-stat">
                    <div class="completion-stat-value">${data.mistakes}</div>
                    <div class="completion-stat-label">Sai lầm</div>
                </div>
            `;
        }
        overlay.classList.add('active');
    }

    _onMistake(data) {
        document.getElementById('mistake-counter').textContent = `❌ ${data.mistakes}`;
        if (data.hint) {
            const hintEl = document.getElementById('hint-flash');
            hintEl.textContent = `💡 Gợi ý: ${data.hint}`;
            hintEl.classList.add('active');
            setTimeout(() => hintEl.classList.remove('active'), 2500);
        } else {
            const statusEl = document.getElementById('status-message');
            statusEl.textContent = '❌ Nước đi chưa đúng!';
            statusEl.className = 'status-message error';
            setTimeout(() => {
                statusEl.textContent = '🤔 Đến lượt bạn';
                statusEl.className = 'status-message waiting';
            }, 1500);
        }
    }

    _onComment(data) {
        const content = document.getElementById('comment-content');
        content.innerHTML = `<div class="has-text">${data.text}</div>`;
    }

    _onStatusChange(data) {
        const statusEl = document.getElementById('status-message');
        if (data.completed) {
            statusEl.textContent = '✅ Hoàn thành!';
            statusEl.className = 'status-message success';
        } else if (data.isPlayerTurn) {
            statusEl.textContent = '🤔 Đến lượt bạn';
            statusEl.className = 'status-message waiting';
        } else {
            statusEl.textContent = '⏳ Đợi đối thủ...';
            statusEl.className = 'status-message info';
        }
    }

    _renderMoveList() {
        if (!this.trainer) return;
        const moveData = this.trainer.getMoveListData();
        const container = document.getElementById('move-list');
        let html = '';
        let currentPair = null;

        for (const move of moveData) {
            if (move.isWhite) {
                if (currentPair) html += '</div>';
                html += `<div class="move-row">`;
                html += `<span class="move-number">${move.moveNumber}.</span>`;
                currentPair = move.moveNumber;
            }

            const stateClass = move.isCurrent ? 'current' : (move.isPlayed ? 'played' : 'unplayed');
            const clickHandler = this.trainer.mode === 'learn'
                ? `onclick="app.trainer.goToMove(${move.index}); app._renderMoveList();"` : '';

            html += `<span class="move-san ${stateClass}" ${clickHandler}>${move.san}</span>`;

            if (this.trainer.mode === 'learn' && move.hasVariations && move.isPlayed) {
                for (const variation of move.variations) {
                    html += '<div class="variation-block">';
                    html += this._renderVariation(variation);
                    html += '</div>';
                }
            }

            if (!move.isWhite) {
                html += '</div>';
                currentPair = null;
            }
        }
        if (currentPair) html += '</div>';
        container.innerHTML = html;
    }

    _renderVariation(moves) {
        let html = '';
        for (const move of moves) {
            if (move.isWhite) html += `<span class="move-number">${move.moveNumber}.</span>`;
            else if (moves.indexOf(move) === 0) html += `<span class="move-number">${move.moveNumber}...</span>`;
            const nagStr = (move.nags || []).map(n => PGNParser.nagToSymbol(n)).join('');
            html += `<span class="move-san played">${move.san}${nagStr}</span> `;
            if (move.comment && this.trainer.mode === 'learn') {
                html += `<span style="color:var(--text-muted);font-size:0.78rem;font-style:italic;"> ${move.comment}</span> `;
            }
        }
        return html;
    }

    // ========================
    // BOARD CONTROLS
    // ========================

    flipBoard() { if (this.board) this.board.flip(); }

    goToStart() {
        if (this.trainer && this.trainer.mode === 'learn') {
            this.trainer.goToMove(-1); this._renderMoveList();
            document.getElementById('comment-content').innerHTML = '<span class="comment-empty">Vị trí xuất phát</span>';
        }
    }
    goBack() {
        if (this.trainer && this.trainer.mode === 'learn') {
            const newIdx = Math.max(-1, this.trainer.currentMoveIndex - 1);
            this.trainer.goToMove(newIdx); this._renderMoveList();
            if (newIdx >= 0) {
                const move = this.trainer.currentMoves[newIdx];
                if (move.comment) this._onComment({ text: move.comment, type: 'move' });
            }
        }
    }
    goForward() {
        if (this.trainer && this.trainer.mode === 'learn') {
            const newIdx = Math.min(this.trainer.currentMoves.length - 1, this.trainer.currentMoveIndex + 1);
            this.trainer.goToMove(newIdx); this._renderMoveList();
            const move = this.trainer.currentMoves[newIdx];
            if (move?.comment) this._onComment({ text: move.comment, type: 'move' });
        }
    }
    goToEnd() {
        if (this.trainer && this.trainer.mode === 'learn') {
            const lastIdx = this.trainer.currentMoves.length - 1;
            this.trainer.goToMove(lastIdx); this._renderMoveList();
            const move = this.trainer.currentMoves[lastIdx];
            if (move?.comment) this._onComment({ text: move.comment, type: 'move' });
        }
    }

    // ========================
    // ADMIN
    // ========================

    toggleAdmin() { this.navigate('admin'); }

    _showAdminView() {
        this._switchView('view-admin');
        admin.renderCourseList();
    }

    // ========================
    // NAVIGATION
    // ========================

    backToCourseDetail() {
        document.getElementById('completion-overlay').classList.remove('active');
        if (this.currentCourseId) {
            this.navigate('course-detail', { courseId: this.currentCourseId });
        } else {
            this.navigate('courses');
        }
    }

    backToChapterDetail() {
        document.getElementById('completion-overlay').classList.remove('active');
        if (this.currentCourseId && this.currentChapterId) {
            this.navigate('chapter-detail', { courseId: this.currentCourseId, chapterId: this.currentChapterId });
        } else {
            this.backToCourseDetail();
        }
    }

    // ========================
    // MODAL / TOAST
    // ========================

    openModal() { document.getElementById('modal-overlay').classList.add('active'); }
    closeModal() { document.getElementById('modal-overlay').classList.remove('active'); }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(40px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// Initialize
let app;
let admin;
document.addEventListener('DOMContentLoaded', () => {
    const cm = new CourseManager();
    app = new App(cm);
    admin = new Admin(cm);
    app._init();
});
