/**
 * Course Manager V2 - API-based course/chapter management
 */

class CourseManager {
    constructor() {
        this.courses = [];
        this.sr = new SpacedRepetition();
        this.pgnCache = {}; // chapterId -> parsed games
    }

    // ===== API CALLS =====

    async fetchCourses() {
        const res = await fetch('/api/courses');
        this.courses = await res.json();
        return this.courses;
    }

    async createCourse(data) {
        const res = await fetch('/api/courses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    }

    async updateCourse(id, data) {
        const res = await fetch(`/api/courses/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    }

    async deleteCourse(id) {
        await fetch(`/api/courses/${id}`, { method: 'DELETE' });
    }

    async createChapter(courseId, name, pgnFile) {
        const formData = new FormData();
        formData.append('name', name);
        formData.append('pgn', pgnFile);
        const res = await fetch(`/api/courses/${courseId}/chapters`, {
            method: 'POST',
            body: formData
        });
        return res.json();
    }

    async updateChapter(chapterId, name, pgnFile) {
        const formData = new FormData();
        if (name) formData.append('name', name);
        if (pgnFile) formData.append('pgn', pgnFile);
        const res = await fetch(`/api/chapters/${chapterId}`, {
            method: 'PUT',
            body: formData
        });
        return res.json();
    }

    async deleteChapter(chapterId) {
        await fetch(`/api/chapters/${chapterId}`, { method: 'DELETE' });
    }

    // ===== PGN LOADING =====

    async loadChapterPGN(chapterId) {
        if (this.pgnCache[chapterId]) return this.pgnCache[chapterId];

        const res = await fetch(`/api/chapters/${chapterId}/pgn`);
        const text = await res.text();
        const games = PGNParser.parseMultipleGames(text);
        this.pgnCache[chapterId] = games;
        return games;
    }

    clearPGNCache(chapterId) {
        if (chapterId) {
            delete this.pgnCache[chapterId];
        } else {
            this.pgnCache = {};
        }
    }

    // ===== COURSE DATA =====

    getCourse(courseId) {
        return this.courses.find(c => c.id === courseId);
    }

    // ===== STATS =====

    /**
     * Get stats for a course across all chapters
     */
    getCourseStats(courseId) {
        const course = this.getCourse(courseId);
        if (!course) return { total: 0, new: 0, learning: 0, review: 0, mastered: 0, dueNow: 0 };

        let total = 0, newCount = 0, learning = 0, review = 0, mastered = 0, dueNow = 0;

        for (const chapter of course.chapters) {
            total += chapter.lineCount || 0;
            for (let i = 0; i < (chapter.lineCount || 0); i++) {
                const cardId = `${courseId}:${chapter.id}:${i}`;
                const card = this.sr.data.cards[cardId];
                if (!card || card.state === 'new') {
                    newCount++;
                } else {
                    switch (card.state) {
                        case 'learning': learning++; break;
                        case 'review': review++; break;
                        case 'mastered': mastered++; break;
                    }
                    if (this.sr.isDue(cardId)) dueNow++;
                }
            }
        }

        return { total, new: newCount, learning, review, mastered, dueNow };
    }

    /**
     * Get chapter stats
     */
    getChapterStats(courseId, chapterId, lineCount) {
        let newCount = 0, learning = 0, review = 0, mastered = 0, dueNow = 0;
        for (let i = 0; i < lineCount; i++) {
            const cardId = `${courseId}:${chapterId}:${i}`;
            const card = this.sr.data.cards[cardId];
            if (!card || card.state === 'new') {
                newCount++;
            } else {
                switch (card.state) {
                    case 'learning': learning++; break;
                    case 'review': review++; break;
                    case 'mastered': mastered++; break;
                }
                if (this.sr.isDue(cardId)) dueNow++;
            }
        }
        return { total: lineCount, new: newCount, learning, review, mastered, dueNow };
    }

    // ===== LEARN / REVIEW QUERIES =====

    /**
     * Get all new (unlearned) lines for a course, in order
     */
    getNewLines(courseId) {
        const course = this.getCourse(courseId);
        if (!course) return [];
        const lines = [];
        for (const chapter of course.chapters) {
            for (let i = 0; i < (chapter.lineCount || 0); i++) {
                const cardId = `${courseId}:${chapter.id}:${i}`;
                const card = this.sr.data.cards[cardId];
                if (!card || card.state === 'new') {
                    lines.push({ cardId, courseId, chapterId: chapter.id, chapterName: chapter.name, lineIndex: i });
                }
            }
        }
        return lines;
    }

    /**
     * Get all due review lines for a course
     */
    getDueLines(courseId) {
        const course = this.getCourse(courseId);
        if (!course) return [];
        const lines = [];
        const now = new Date();
        for (const chapter of course.chapters) {
            for (let i = 0; i < (chapter.lineCount || 0); i++) {
                const cardId = `${courseId}:${chapter.id}:${i}`;
                const card = this.sr.data.cards[cardId];
                if (card && card.state !== 'new' && card.nextReview && new Date(card.nextReview) <= now) {
                    lines.push({ cardId, courseId, chapterId: chapter.id, chapterName: chapter.name, lineIndex: i });
                }
            }
        }
        // Sort by next review date (oldest first)
        lines.sort((a, b) => {
            const ca = this.sr.data.cards[a.cardId];
            const cb = this.sr.data.cards[b.cardId];
            return new Date(ca.nextReview) - new Date(cb.nextReview);
        });
        return lines;
    }

    /**
     * Get line info with game title from PGN cache
     */
    getLineTitle(chapterId, lineIndex) {
        const games = this.pgnCache[chapterId];
        if (games && games[lineIndex]) {
            return games[lineIndex].black || `Biến ${lineIndex + 1}`;
        }
        return `Biến ${lineIndex + 1}`;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CourseManager;
}
