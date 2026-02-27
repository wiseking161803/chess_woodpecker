/**
 * SoundManager - ASMR-style chess sound synthesizer
 * Soft, warm, satisfying sounds using Web Audio API
 */
class SoundManager {
    constructor() {
        this.ctx = null;
        this.enabled = true;
    }

    _getCtx() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        return this.ctx;
    }

    /**
     * Soft wooden piece placement — gentle "tok" with warm resonance
     */
    playMove() {
        if (!this.enabled) return;
        const ctx = this._getCtx();
        const now = ctx.currentTime;

        // Warm wooden tap - soft sine body
        const body = ctx.createOscillator();
        body.type = 'sine';
        body.frequency.setValueAtTime(420, now);
        body.frequency.exponentialRampToValueAtTime(280, now + 0.08);

        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.25, now);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        // Gentle click texture (filtered noise)
        const bufSize = ctx.sampleRate * 0.04;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) {
            const t = i / bufSize;
            d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 50) * 0.15;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buf;

        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = 2000;
        lpf.Q.value = 0.7;

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.2, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        body.connect(bodyGain);
        bodyGain.connect(ctx.destination);
        noise.connect(lpf);
        lpf.connect(noiseGain);
        noiseGain.connect(ctx.destination);

        body.start(now);
        body.stop(now + 0.12);
        noise.start(now);
        noise.stop(now + 0.04);
    }

    /**
     * Capture sound — satisfying deep thud with wooden resonance
     */
    playCapture() {
        if (!this.enabled) return;
        const ctx = this._getCtx();
        const now = ctx.currentTime;

        // Deep resonant body
        const body = ctx.createOscillator();
        body.type = 'sine';
        body.frequency.setValueAtTime(300, now);
        body.frequency.exponentialRampToValueAtTime(120, now + 0.15);

        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.35, now);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

        // Second harmonic for richness
        const harm = ctx.createOscillator();
        harm.type = 'sine';
        harm.frequency.setValueAtTime(600, now);
        harm.frequency.exponentialRampToValueAtTime(180, now + 0.1);

        const harmGain = ctx.createGain();
        harmGain.gain.setValueAtTime(0.12, now);
        harmGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

        // Soft impact noise
        const bufSize = ctx.sampleRate * 0.05;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) {
            const t = i / bufSize;
            d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 40) * 0.12;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buf;

        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = 1200;

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.18, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

        body.connect(bodyGain);
        bodyGain.connect(ctx.destination);
        harm.connect(harmGain);
        harmGain.connect(ctx.destination);
        noise.connect(lpf);
        lpf.connect(noiseGain);
        noiseGain.connect(ctx.destination);

        body.start(now);
        body.stop(now + 0.2);
        harm.start(now);
        harm.stop(now + 0.1);
        noise.start(now);
        noise.stop(now + 0.06);
    }

    /**
     * Correct puzzle — gentle ascending bell chime (ASMR wind chime)
     */
    playCorrect() {
        if (!this.enabled) return;
        const ctx = this._getCtx();
        const now = ctx.currentTime;

        // Pentatonic bell sequence - warm and rewarding
        const notes = [
            { freq: 523.25, delay: 0, dur: 0.6, vol: 0.18 }, // C5
            { freq: 659.25, delay: 0.12, dur: 0.5, vol: 0.15 }, // E5
            { freq: 783.99, delay: 0.24, dur: 0.55, vol: 0.14 }, // G5
            { freq: 1046.5, delay: 0.36, dur: 0.7, vol: 0.1 }, // C6 - sparkle
        ];

        notes.forEach(n => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = n.freq;

            // Gentle second harmonic for bell character
            const osc2 = ctx.createOscillator();
            osc2.type = 'sine';
            osc2.frequency.value = n.freq * 2.02; // Slight detuning for shimmer

            const gain = ctx.createGain();
            const start = now + n.delay;
            gain.gain.setValueAtTime(0.001, start);
            gain.gain.linearRampToValueAtTime(n.vol, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, start + n.dur);

            const gain2 = ctx.createGain();
            gain2.gain.setValueAtTime(0.001, start);
            gain2.gain.linearRampToValueAtTime(n.vol * 0.15, start + 0.02);
            gain2.gain.exponentialRampToValueAtTime(0.001, start + n.dur * 0.6);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);

            osc.start(start);
            osc.stop(start + n.dur);
            osc2.start(start);
            osc2.stop(start + n.dur);
        });
    }

    /**
     * Incorrect — soft gentle descending tone (not harsh)
     */
    playIncorrect() {
        if (!this.enabled) return;
        const ctx = this._getCtx();
        const now = ctx.currentTime;

        // Soft descending minor third — gentle "nope" feeling
        const osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(440, now);
        osc1.frequency.exponentialRampToValueAtTime(349, now + 0.2);

        const gain1 = ctx.createGain();
        gain1.gain.setValueAtTime(0.001, now);
        gain1.gain.linearRampToValueAtTime(0.15, now + 0.02);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

        // Second softer tone
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(370, now + 0.15);
        osc2.frequency.exponentialRampToValueAtTime(293, now + 0.35);

        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime(0.001, now + 0.15);
        gain2.gain.linearRampToValueAtTime(0.12, now + 0.17);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.3);
        osc2.start(now + 0.15);
        osc2.stop(now + 0.4);
    }
}

// Global instance
const soundManager = new SoundManager();
