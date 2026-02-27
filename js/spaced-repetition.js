/**
 * Spaced Repetition Engine V2 - SM-2 based algorithm
 * Card ID format: courseId:chapterId:lineIndex
 */

class SpacedRepetition {
    constructor() {
        this.STORAGE_KEY = 'chess_sr_data_v2';
        this.data = this._load();
    }

    getCard(cardId) {
        if (!this.data.cards[cardId]) {
            this.data.cards[cardId] = {
                id: cardId,
                state: 'new',
                easeFactor: 2.5,
                interval: 0,
                repetitions: 0,
                nextReview: null,
                lastReview: null,
                totalAttempts: 0,
                correctAttempts: 0,
                streak: 0
            };
            this._save();
        }
        return this.data.cards[cardId];
    }

    markLearned(cardId) {
        const card = this.getCard(cardId);
        card.state = 'learning';
        card.interval = 0.007; // ~10 minutes
        card.nextReview = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        card.lastReview = new Date().toISOString();
        card.repetitions = 1;
        this._save();
        return card;
    }

    processReview(cardId, quality) {
        const card = this.getCard(cardId);
        card.totalAttempts++;
        card.lastReview = new Date().toISOString();

        if (quality >= 3) {
            card.correctAttempts++;
            card.streak++;

            if (card.repetitions === 0) {
                card.interval = 1;
            } else if (card.repetitions === 1) {
                card.interval = 3;
            } else {
                card.interval = Math.round(card.interval * card.easeFactor);
            }

            card.repetitions++;
            card.easeFactor = Math.max(1.3,
                card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
            );

            if (card.interval >= 21) {
                card.state = 'mastered';
            } else {
                card.state = 'review';
            }
        } else {
            card.streak = 0;
            card.repetitions = 0;
            card.interval = 0.007;
            card.state = 'learning';
        }

        card.nextReview = new Date(Date.now() + card.interval * 24 * 60 * 60 * 1000).toISOString();
        this._save();
        return card;
    }

    static calculateQuality(mistakes) {
        if (mistakes === 0) return 5;
        if (mistakes === 1) return 3;
        if (mistakes === 2) return 2;
        return 1;
    }

    isDue(cardId) {
        const card = this.data.cards[cardId];
        if (!card || card.state === 'new') return false;
        if (!card.nextReview) return true;
        return new Date(card.nextReview) <= new Date();
    }

    /**
     * Remove all cards for a specific chapter
     */
    removeCardsForChapter(courseId, chapterId) {
        const prefix = `${courseId}:${chapterId}:`;
        for (const key of Object.keys(this.data.cards)) {
            if (key.startsWith(prefix)) {
                delete this.data.cards[key];
            }
        }
        this._save();
    }

    /**
     * Remove all cards for a course
     */
    removeCardsForCourse(courseId) {
        const prefix = `${courseId}:`;
        for (const key of Object.keys(this.data.cards)) {
            if (key.startsWith(prefix)) {
                delete this.data.cards[key];
            }
        }
        this._save();
    }

    reset() {
        this.data = { cards: {}, version: 2 };
        this._save();
    }

    _load() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) return JSON.parse(stored);
        } catch (e) { console.warn('Failed to load SR data:', e); }
        return { cards: {}, version: 2 };
    }

    _save() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
        } catch (e) { console.warn('Failed to save SR data:', e); }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpacedRepetition;
}
