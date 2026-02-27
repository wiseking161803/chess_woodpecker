const express = require('express');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool, initDB, generateId } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health check endpoint (for Railway)
app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Serve Woodpecker app at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'woodpecker.html'));
});

app.use(express.static(path.join(__dirname)));

// Multer for PGN file uploads (memory storage — content saved to DB)
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.originalname.toLowerCase().endsWith('.pgn')) {
            cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận file PGN'));
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// ===== HELPERS =====
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ===== AUTH MIDDLEWARE =====
async function authMiddleware(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Cần đăng nhập' });

    try {
        const { rows: sessions } = await pool.query(
            'SELECT user_id, created_at FROM sessions WHERE token = $1', [token]
        );
        if (sessions.length === 0) return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' });

        const session = sessions[0];

        // Check expiry (7 days)
        if (Date.now() - new Date(session.created_at).getTime() > 7 * 24 * 60 * 60 * 1000) {
            await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
            return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
        }

        const { rows: users } = await pool.query(
            'SELECT id, username, role FROM users WHERE id = $1', [session.user_id]
        );
        if (users.length === 0) return res.status(401).json({ error: 'Người dùng không tồn tại' });

        req.user = users[0];
        next();
    } catch (err) {
        console.error('Auth error:', err);
        res.status(500).json({ error: 'Lỗi xác thực' });
    }
}

function adminMiddleware(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Cần quyền admin' });
    }
    next();
}

// ===== AUTH API =====

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Thiếu thông tin đăng nhập' });

    try {
        const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (rows.length === 0) return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });

        const user = rows[0];

        if (user.status === 'pending') {
            return res.status(403).json({ error: 'Tài khoản đang chờ admin duyệt. Vui lòng liên hệ admin.' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });

        const token = generateToken();
        await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);

        res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== SELF-REGISTRATION =====
app.post('/api/auth/register', async (req, res) => {
    const { fullName, username, password, confirmPassword, dateOfBirth } = req.body;

    if (!fullName || !username || !password || !confirmPassword || !dateOfBirth) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin' });
    }
    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Mật khẩu xác nhận không khớp' });
    }
    if (password.length < 4) {
        return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 4 ký tự' });
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({ error: 'Username chỉ chứa chữ, số, dấu gạch dưới (3-20 ký tự)' });
    }

    try {
        const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existing.length > 0) return res.status(400).json({ error: 'Username đã tồn tại' });

        const hash = await bcrypt.hash(password, 10);
        const id = generateId();
        await pool.query(
            `INSERT INTO users (id, username, full_name, password_hash, date_of_birth, role, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, username, fullName, hash, dateOfBirth, 'user', 'pending']
        );

        res.json({ success: true, message: 'Đăng ký thành công! Vui lòng chờ admin duyệt tài khoản.' });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    res.json({ success: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json(req.user);
});

// ===== ADMIN USER MANAGEMENT =====

app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        let query = 'SELECT id, username, full_name, date_of_birth, role, status, created_at FROM users';
        const params = [];
        if (req.query.status) {
            query += ' WHERE status = $1';
            params.push(req.query.status);
        }
        query += ' ORDER BY created_at ASC';
        const { rows } = await pool.query(query, params);
        res.json(rows.map(u => ({
            id: u.id, username: u.username, fullName: u.full_name || '',
            dateOfBirth: u.date_of_birth || '', role: u.role,
            status: u.status || 'active', createdAt: u.created_at
        })));
    } catch (err) {
        console.error('Get users error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.post('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Thiếu username hoặc password' });

    try {
        const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existing.length > 0) return res.status(400).json({ error: 'Username đã tồn tại' });

        const hash = await bcrypt.hash(password, 10);
        const id = generateId();
        await pool.query(
            `INSERT INTO users (id, username, full_name, password_hash, role, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, username, req.body.fullName || '', hash, role || 'user', 'active']
        );
        res.json({ id, username, role: role || 'user', status: 'active', createdAt: new Date().toISOString() });
    } catch (err) {
        console.error('Create user error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy user' });
        if (rows[0].role === 'admin') return res.status(400).json({ error: 'Không thể xóa admin' });

        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Approve pending user
app.post('/api/admin/users/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT username, status FROM users WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy user' });
        if (rows[0].status !== 'pending') return res.status(400).json({ error: 'User không ở trạng thái chờ duyệt' });

        await pool.query('UPDATE users SET status = $1 WHERE id = $2', ['active', req.params.id]);
        res.json({ success: true, message: `Đã duyệt user ${rows[0].username}` });
    } catch (err) {
        console.error('Approve error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Reject pending user
app.post('/api/admin/users/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT status FROM users WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy user' });
        if (rows[0].status !== 'pending') return res.status(400).json({ error: 'User không ở trạng thái chờ duyệt' });

        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'Đã từ chối đăng ký' });
    } catch (err) {
        console.error('Reject error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Admin: Get user detailed stats
app.get('/api/admin/users/:id/stats', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        // User info
        const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
        if (userRows.length === 0) return res.status(404).json({ error: 'User not found' });
        const u = userRows[0];

        // Streak
        const { rows: dcRows } = await pool.query(
            `SELECT completed_date FROM daily_completions WHERE user_id = $1 ORDER BY completed_date DESC`,
            [req.params.id]
        );
        const dates = dcRows.map(r => {
            const d = new Date(r.completed_date);
            return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        });
        const today = new Date();
        const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const oneDayMs = 86400000;
        const completedToday = dates.length > 0 && dates[0] === todayMs;

        let currentStreak = 0;
        if (dates.length > 0) {
            let checkDate = completedToday ? todayMs : todayMs - oneDayMs;
            for (const d of dates) {
                if (d === checkDate) { currentStreak++; checkDate -= oneDayMs; }
                else if (d < checkDate) break;
            }
            if (!completedToday && dates[0] !== todayMs - oneDayMs) currentStreak = 0;
        }
        let longestStreak = dates.length > 0 ? 1 : 0;
        let tempStreak = 1;
        for (let i = 1; i < dates.length; i++) {
            if (dates[i - 1] - dates[i] === oneDayMs) {
                tempStreak++;
                longestStreak = Math.max(longestStreak, tempStreak);
            } else { tempStreak = 1; }
        }

        // Puzzle sets progress
        const { rows: sets } = await pool.query(
            'SELECT id, name, puzzle_count FROM puzzle_sets WHERE assigned_to = $1', [req.params.id]
        );
        const setsProgress = [];
        for (const s of sets) {
            const { rows: cycles } = await pool.query(
                'SELECT id, cycle_number, completed_at FROM cycles WHERE set_id = $1 ORDER BY cycle_number', [s.id]
            );
            const completedCycles = cycles.filter(c => c.completed_at).length;
            const currentCycle = cycles.length > 0 ? cycles[cycles.length - 1].cycle_number : 0;

            // Count unique correct puzzles across all sessions in the current (latest) cycle
            let puzzlesSolved = 0;
            if (cycles.length > 0) {
                const latestCycleId = cycles[cycles.length - 1].id;
                const { rows: solvedRows } = await pool.query(
                    `SELECT COUNT(DISTINCT a.puzzle_index) AS solved
                     FROM attempts a
                     JOIN training_sessions ts ON a.session_id = ts.id
                     WHERE ts.cycle_id = $1 AND a.correct = true`,
                    [latestCycleId]
                );
                puzzlesSolved = parseInt(solvedRows[0].solved) || 0;
            }

            setsProgress.push({
                name: s.name, puzzleCount: s.puzzle_count,
                completedCycles, currentCycle, totalCycles: cycles.length,
                puzzlesSolved
            });
        }

        // Total sessions & attempts
        const { rows: sessionStats } = await pool.query(`
            SELECT COUNT(DISTINCT ts.id) AS total_sessions,
                   COALESCE(SUM(ts.puzzles_attempted), 0) AS total_attempted,
                   COALESCE(SUM(ts.puzzles_solved), 0) AS total_solved,
                   COALESCE(SUM(ts.duration), 0) AS total_time
            FROM training_sessions ts
            JOIN cycles c ON ts.cycle_id = c.id
            JOIN puzzle_sets ps ON c.set_id = ps.id
            WHERE ps.assigned_to = $1
        `, [req.params.id]);

        const ss = sessionStats[0];
        const totalAttempted = parseInt(ss.total_attempted) || 0;
        const totalSolved = parseInt(ss.total_solved) || 0;
        const totalTimeMinutes = Math.round((parseInt(ss.total_time) || 0) / 60);
        const ppm = totalTimeMinutes > 0 ? (totalSolved / totalTimeMinutes).toFixed(2) : '0.00';

        res.json({
            user: {
                id: u.id, username: u.username, fullName: u.full_name,
                dateOfBirth: u.date_of_birth, createdAt: u.created_at
            },
            streak: {
                current: currentStreak, longest: longestStreak,
                totalDays: dates.length, completedToday
            },
            puzzleSets: setsProgress,
            stats: {
                totalSessions: parseInt(ss.total_sessions) || 0,
                totalAttempted, totalSolved,
                accuracy: totalAttempted > 0 ? (totalSolved / totalAttempted * 100).toFixed(1) : '0.0',
                totalTimeMinutes,
                ppm
            }
        });
    } catch (err) {
        console.error('Admin user stats error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== ADMIN PUZZLE SET MANAGEMENT =====

app.get('/api/admin/puzzle-sets', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { rows: sets } = await pool.query(`
            SELECT ps.*, u.username AS assigned_username
            FROM puzzle_sets ps
            LEFT JOIN users u ON ps.assigned_to = u.id
            ORDER BY ps.created_at DESC
        `);

        // Load cycles for each set
        const result = [];
        for (const s of sets) {
            const { rows: cycles } = await pool.query(
                'SELECT * FROM cycles WHERE set_id = $1 ORDER BY cycle_number', [s.id]
            );
            result.push({
                id: s.id, name: s.name, pgnFile: s.pgn_file,
                originalName: s.original_name, puzzleCount: s.puzzle_count,
                assignedTo: s.assigned_to, assignedUsername: s.assigned_username || 'Unknown',
                createdAt: s.created_at, cycles
            });
        }
        res.json(result);
    } catch (err) {
        console.error('Get puzzle sets error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.post('/api/admin/puzzle-sets', authMiddleware, adminMiddleware, upload.single('pgn'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Cần upload file PGN' });
    if (!req.body.assignedTo) return res.status(400).json({ error: 'Cần chọn user' });

    try {
        const pgnContent = req.file.buffer.toString('utf-8');
        const puzzleCount = (pgnContent.match(/\[Event\s/g) || []).length;

        let userIds;
        try {
            userIds = JSON.parse(req.body.assignedTo);
            if (!Array.isArray(userIds)) userIds = [userIds];
        } catch {
            userIds = [req.body.assignedTo];
        }

        const createdSets = [];
        for (const userId of userIds) {
            const id = generateId();
            await pool.query(
                `INSERT INTO puzzle_sets (id, name, pgn_file, pgn_content, original_name, puzzle_count, assigned_to)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [id, req.body.name || req.file.originalname.replace('.pgn', ''),
                    req.file.originalname, pgnContent, req.file.originalname, puzzleCount, userId]
            );
            createdSets.push({
                id, name: req.body.name || req.file.originalname.replace('.pgn', ''),
                pgnFile: req.file.originalname, originalName: req.file.originalname,
                puzzleCount, assignedTo: userId, createdAt: new Date().toISOString(), cycles: []
            });
        }

        res.json(createdSets.length === 1 ? createdSets[0] : createdSets);
    } catch (err) {
        console.error('Create puzzle set error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Assign existing puzzle set to additional users
app.post('/api/admin/puzzle-sets/:id/assign', authMiddleware, adminMiddleware, async (req, res) => {
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'Cần danh sách user IDs' });
    }

    try {
        const { rows } = await pool.query('SELECT * FROM puzzle_sets WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });
        const sourceSet = rows[0];

        const createdSets = [];
        for (const userId of userIds) {
            const { rows: existing } = await pool.query(
                'SELECT id FROM puzzle_sets WHERE original_name = $1 AND assigned_to = $2',
                [sourceSet.original_name, userId]
            );
            if (existing.length > 0) continue;

            const id = generateId();
            await pool.query(
                `INSERT INTO puzzle_sets (id, name, pgn_file, pgn_content, original_name, puzzle_count, assigned_to)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [id, sourceSet.name, sourceSet.pgn_file, sourceSet.pgn_content, sourceSet.original_name, sourceSet.puzzle_count, userId]
            );
            createdSets.push({ id, name: sourceSet.name });
        }

        res.json({ assigned: createdSets.length, sets: createdSets });
    } catch (err) {
        console.error('Assign error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.delete('/api/admin/puzzle-sets/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id FROM puzzle_sets WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

        await pool.query('DELETE FROM puzzle_sets WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete puzzle set error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== WOODPECKER USER API =====

const CYCLE_DAYS = [28, 14, 7, 4, 3, 2, 1];

// Helper: build full set object with cycles/sessions/attempts
async function buildSetWithCycles(setId) {
    const { rows: setRows } = await pool.query('SELECT * FROM puzzle_sets WHERE id = $1', [setId]);
    if (setRows.length === 0) return null;
    const set = setRows[0];

    const { rows: cycleRows } = await pool.query(
        'SELECT * FROM cycles WHERE set_id = $1 ORDER BY cycle_number', [setId]
    );

    const cycles = [];
    for (const c of cycleRows) {
        const { rows: sessionRows } = await pool.query(
            'SELECT * FROM training_sessions WHERE cycle_id = $1 ORDER BY started_at', [c.id]
        );

        const sessions = [];
        for (const s of sessionRows) {
            const { rows: attemptRows } = await pool.query(
                'SELECT puzzle_index, correct, time_ms, recorded_at FROM attempts WHERE session_id = $1 ORDER BY recorded_at',
                [s.id]
            );
            sessions.push({
                id: s.id, startedAt: s.started_at, endedAt: s.ended_at,
                duration: s.duration, puzzlesAttempted: s.puzzles_attempted,
                puzzlesSolved: s.puzzles_solved,
                attempts: attemptRows.map(a => ({
                    puzzleIndex: a.puzzle_index, correct: a.correct,
                    timeMs: a.time_ms, recordedAt: a.recorded_at
                }))
            });
        }

        cycles.push({
            cycleNumber: c.cycle_number, targetDays: c.target_days,
            startedAt: c.started_at, completedAt: c.completed_at, sessions
        });
    }

    return {
        id: set.id, name: set.name, pgnFile: set.pgn_file,
        originalName: set.original_name, puzzleCount: set.puzzle_count,
        assignedTo: set.assigned_to, createdAt: set.created_at, cycles
    };
}

app.get('/api/woodpecker/sets', authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id FROM puzzle_sets WHERE assigned_to = $1', [req.user.id]
        );
        const sets = [];
        for (const r of rows) {
            const set = await buildSetWithCycles(r.id);
            if (set) sets.push(set);
        }
        res.json(sets);
    } catch (err) {
        console.error('Get sets error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.get('/api/woodpecker/sets/:id', authMiddleware, async (req, res) => {
    try {
        const set = await buildSetWithCycles(req.params.id);
        if (!set || set.assignedTo !== req.user.id) {
            return res.status(404).json({ error: 'Không tìm thấy puzzle set' });
        }
        res.json(set);
    } catch (err) {
        console.error('Get set error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Leaderboard
app.get('/api/woodpecker/sets/:id/leaderboard', authMiddleware, async (req, res) => {
    try {
        const set = await buildSetWithCycles(req.params.id);
        if (!set || set.assignedTo !== req.user.id) {
            return res.status(404).json({ error: 'Không tìm thấy puzzle set' });
        }

        // Find all sets with the same name
        const { rows: relatedRows } = await pool.query(
            'SELECT id, assigned_to FROM puzzle_sets WHERE name = $1', [set.name]
        );

        const leaderboard = [];
        for (const rel of relatedRows) {
            const relSet = await buildSetWithCycles(rel.id);
            if (!relSet) continue;

            const { rows: userRows } = await pool.query('SELECT username FROM users WHERE id = $1', [rel.assigned_to]);
            const username = userRows.length > 0 ? userRows[0].username : 'Unknown';

            let totalAttempted = 0, totalSolved = 0, totalTimeMs = 0, totalDuration = 0, bestCycle = 0;
            relSet.cycles.forEach(cycle => {
                if (cycle.cycleNumber > bestCycle) bestCycle = cycle.cycleNumber;
                cycle.sessions.forEach(session => {
                    totalAttempted += session.puzzlesAttempted || 0;
                    totalSolved += session.puzzlesSolved || 0;
                    totalDuration += session.duration || 0;
                    session.attempts.forEach(a => { totalTimeMs += a.timeMs || 0; });
                });
            });

            if (totalAttempted === 0) continue;

            const accuracy = totalAttempted > 0 ? (totalSolved / totalAttempted * 100) : 0;
            const totalMinutes = totalDuration / 60;
            const ppm = totalMinutes > 0 ? (totalSolved / totalMinutes) : 0;

            leaderboard.push({
                userId: rel.assigned_to, username, totalAttempted, totalSolved,
                accuracy: Math.round(accuracy * 10) / 10,
                ppm: Math.round(ppm * 100) / 100,
                bestCycle, isMe: rel.assigned_to === req.user.id
            });
        }

        res.json(leaderboard);
    } catch (err) {
        console.error('Leaderboard error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.get('/api/woodpecker/sets/:id/pgn', authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT pgn_content FROM puzzle_sets WHERE id = $1 AND assigned_to = $2',
            [req.params.id, req.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });
        if (!rows[0].pgn_content) return res.status(404).json({ error: 'Nội dung PGN không tồn tại' });

        res.type('text/plain').send(rows[0].pgn_content);
    } catch (err) {
        console.error('Get PGN error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Request a new cycle (requires admin approval for cycle 2+)
app.post('/api/woodpecker/sets/:id/start-cycle', authMiddleware, async (req, res) => {
    try {
        const { rows: setRows } = await pool.query(
            'SELECT id FROM puzzle_sets WHERE id = $1 AND assigned_to = $2',
            [req.params.id, req.user.id]
        );
        if (setRows.length === 0) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

        const { rows: cycleRows } = await pool.query(
            'SELECT * FROM cycles WHERE set_id = $1 ORDER BY cycle_number DESC LIMIT 1',
            [req.params.id]
        );

        const nextCycleNum = cycleRows.length > 0 ? cycleRows[0].cycle_number + 1 : 1;
        if (nextCycleNum > 7) return res.status(400).json({ error: 'Đã hoàn thành tất cả 7 cycles' });

        if (cycleRows.length > 0 && !cycleRows[0].completed_at) {
            return res.status(400).json({ error: 'Cycle hiện tại chưa hoàn thành' });
        }

        // Cycle 1 is auto-approved
        if (nextCycleNum === 1) {
            const id = generateId();
            const { rows } = await pool.query(
                `INSERT INTO cycles (id, set_id, cycle_number, target_days)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [id, req.params.id, nextCycleNum, CYCLE_DAYS[nextCycleNum - 1]]
            );
            const cycle = rows[0];
            return res.json({
                cycleNumber: cycle.cycle_number, targetDays: cycle.target_days,
                startedAt: cycle.started_at, completedAt: cycle.completed_at, sessions: []
            });
        }

        // Cycle 2+ requires admin approval — check if already pending
        const { rows: existingReq } = await pool.query(
            `SELECT id, status FROM cycle_requests
             WHERE user_id = $1 AND set_id = $2 AND cycle_number = $3 AND status = 'pending'`,
            [req.user.id, req.params.id, nextCycleNum]
        );
        if (existingReq.length > 0) {
            return res.status(400).json({ error: 'Yêu cầu đã được gửi, đang chờ admin duyệt', pending: true });
        }

        // Check if already approved
        const { rows: approvedReq } = await pool.query(
            `SELECT id FROM cycle_requests
             WHERE user_id = $1 AND set_id = $2 AND cycle_number = $3 AND status = 'approved'`,
            [req.user.id, req.params.id, nextCycleNum]
        );
        if (approvedReq.length > 0) {
            // Already approved — create the cycle
            const id = generateId();
            const { rows } = await pool.query(
                `INSERT INTO cycles (id, set_id, cycle_number, target_days)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [id, req.params.id, nextCycleNum, CYCLE_DAYS[nextCycleNum - 1]]
            );
            const cycle = rows[0];
            return res.json({
                cycleNumber: cycle.cycle_number, targetDays: cycle.target_days,
                startedAt: cycle.started_at, completedAt: cycle.completed_at, sessions: []
            });
        }

        // Create pending request
        const reqId = generateId();
        await pool.query(
            `INSERT INTO cycle_requests (id, user_id, set_id, cycle_number)
             VALUES ($1, $2, $3, $4)`,
            [reqId, req.user.id, req.params.id, nextCycleNum]
        );

        res.json({
            pending: true,
            message: `Yêu cầu bắt đầu Cycle ${nextCycleNum} đã được gửi. Vui lòng chờ admin duyệt.`
        });
    } catch (err) {
        console.error('Start cycle error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Admin: List pending cycle requests
app.get('/api/admin/cycle-requests', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT cr.*, u.username, u.full_name, ps.name AS set_name
            FROM cycle_requests cr
            JOIN users u ON cr.user_id = u.id
            JOIN puzzle_sets ps ON cr.set_id = ps.id
            WHERE cr.status = 'pending'
            ORDER BY cr.created_at ASC
        `);
        res.json(rows.map(r => ({
            id: r.id, userId: r.user_id, username: r.username,
            fullName: r.full_name || r.username, setId: r.set_id,
            setName: r.set_name, cycleNumber: r.cycle_number,
            createdAt: r.created_at
        })));
    } catch (err) {
        console.error('Get cycle requests error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Admin: Approve a cycle request
app.post('/api/admin/cycle-requests/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM cycle_requests WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy yêu cầu' });
        if (rows[0].status !== 'pending') return res.status(400).json({ error: 'Yêu cầu đã được xử lý' });

        await pool.query('UPDATE cycle_requests SET status = $1 WHERE id = $2', ['approved', req.params.id]);
        res.json({ success: true, message: 'Đã duyệt yêu cầu' });
    } catch (err) {
        console.error('Approve cycle request error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Admin: Reject a cycle request
app.post('/api/admin/cycle-requests/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM cycle_requests WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy yêu cầu' });
        if (rows[0].status !== 'pending') return res.status(400).json({ error: 'Yêu cầu đã được xử lý' });

        await pool.query('DELETE FROM cycle_requests WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'Đã từ chối yêu cầu' });
    } catch (err) {
        console.error('Reject cycle request error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Admin: Approve ALL pending cycle requests
app.post('/api/admin/cycle-requests/approve-all', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { rowCount } = await pool.query(
            `UPDATE cycle_requests SET status = 'approved' WHERE status = 'pending'`
        );
        res.json({ success: true, approved: rowCount, message: `Đã duyệt ${rowCount} yêu cầu` });
    } catch (err) {
        console.error('Approve all error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Complete current cycle
app.post('/api/woodpecker/sets/:id/complete-cycle', authMiddleware, async (req, res) => {
    try {
        const { rows: setRows } = await pool.query(
            'SELECT id FROM puzzle_sets WHERE id = $1 AND assigned_to = $2',
            [req.params.id, req.user.id]
        );
        if (setRows.length === 0) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

        const { rows: cycleRows } = await pool.query(
            'SELECT * FROM cycles WHERE set_id = $1 AND completed_at IS NULL ORDER BY cycle_number DESC LIMIT 1',
            [req.params.id]
        );
        if (cycleRows.length === 0) return res.status(400).json({ error: 'Không có cycle đang hoạt động' });

        await pool.query('UPDATE cycles SET completed_at = NOW() WHERE id = $1', [cycleRows[0].id]);

        res.json({
            cycleNumber: cycleRows[0].cycle_number, targetDays: cycleRows[0].target_days,
            startedAt: cycleRows[0].started_at, completedAt: new Date().toISOString()
        });
    } catch (err) {
        console.error('Complete cycle error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Create a new session
app.post('/api/woodpecker/sessions', authMiddleware, async (req, res) => {
    const { setId } = req.body;
    try {
        const { rows: setRows } = await pool.query(
            'SELECT id FROM puzzle_sets WHERE id = $1 AND assigned_to = $2',
            [setId, req.user.id]
        );
        if (setRows.length === 0) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

        const { rows: cycleRows } = await pool.query(
            'SELECT * FROM cycles WHERE set_id = $1 AND completed_at IS NULL ORDER BY cycle_number DESC LIMIT 1',
            [setId]
        );
        if (cycleRows.length === 0) {
            return res.status(400).json({ error: 'Không có cycle đang hoạt động. Hãy bắt đầu cycle mới.' });
        }

        const sessionId = generateId();
        await pool.query(
            'INSERT INTO training_sessions (id, cycle_id) VALUES ($1, $2)',
            [sessionId, cycleRows[0].id]
        );

        res.json({
            session: {
                id: sessionId, startedAt: new Date().toISOString(), endedAt: null,
                duration: 0, puzzlesAttempted: 0, puzzlesSolved: 0, attempts: []
            },
            cycleNumber: cycleRows[0].cycle_number
        });
    } catch (err) {
        console.error('Create session error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Record a puzzle attempt
app.post('/api/woodpecker/sessions/:sessionId/attempt', authMiddleware, async (req, res) => {
    const { setId, puzzleIndex, correct, timeMs } = req.body;
    try {
        // Verify ownership
        const { rows: setRows } = await pool.query(
            'SELECT id FROM puzzle_sets WHERE id = $1 AND assigned_to = $2',
            [setId, req.user.id]
        );
        if (setRows.length === 0) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

        // Record attempt
        await pool.query(
            'INSERT INTO attempts (session_id, puzzle_index, correct, time_ms) VALUES ($1, $2, $3, $4)',
            [req.params.sessionId, puzzleIndex, correct, timeMs]
        );

        // Update session counts - count ALL attempts (including re-attempts of same puzzle)
        const { rows: counts } = await pool.query(
            `SELECT 
                COUNT(*) AS attempted,
                COUNT(CASE WHEN correct = true THEN 1 END) AS solved
             FROM attempts WHERE session_id = $1`,
            [req.params.sessionId]
        );

        await pool.query(
            'UPDATE training_sessions SET puzzles_attempted = $1, puzzles_solved = $2 WHERE id = $3',
            [parseInt(counts[0].attempted), parseInt(counts[0].solved), req.params.sessionId]
        );

        res.json({
            attempt: { puzzleIndex, correct, timeMs, recordedAt: new Date().toISOString() },
            session: {
                id: req.params.sessionId,
                puzzlesAttempted: parseInt(counts[0].attempted),
                puzzlesSolved: parseInt(counts[0].solved)
            }
        });
    } catch (err) {
        console.error('Record attempt error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// End a session
app.put('/api/woodpecker/sessions/:sessionId', authMiddleware, async (req, res) => {
    const { setId, duration } = req.body;
    try {
        const { rows: setRows } = await pool.query(
            'SELECT id FROM puzzle_sets WHERE id = $1 AND assigned_to = $2',
            [setId, req.user.id]
        );
        if (setRows.length === 0) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

        await pool.query(
            'UPDATE training_sessions SET ended_at = NOW(), duration = $1 WHERE id = $2',
            [duration || 0, req.params.sessionId]
        );

        // Record daily completion if session was full (>= 570 seconds ≈ 9.5 min)
        if (duration >= 570) {
            try {
                const dcId = generateId();
                await pool.query(
                    `INSERT INTO daily_completions (id, user_id, completed_date)
                     VALUES ($1, $2, CURRENT_DATE)
                     ON CONFLICT (user_id, completed_date) DO NOTHING`,
                    [dcId, req.user.id]
                );
            } catch (e) {
                console.warn('Daily completion record failed:', e.message);
            }
        }

        const { rows } = await pool.query('SELECT * FROM training_sessions WHERE id = $1', [req.params.sessionId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy session' });

        const s = rows[0];
        res.json({
            id: s.id, startedAt: s.started_at, endedAt: s.ended_at,
            duration: s.duration, puzzlesAttempted: s.puzzles_attempted, puzzlesSolved: s.puzzles_solved
        });
    } catch (err) {
        console.error('End session error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Get user's streak info
app.get('/api/woodpecker/streak', authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT completed_date FROM daily_completions
             WHERE user_id = $1 ORDER BY completed_date DESC`,
            [req.user.id]
        );

        if (rows.length === 0) {
            return res.json({ currentStreak: 0, longestStreak: 0, totalDays: 0, completedToday: false });
        }

        const dates = rows.map(r => {
            const d = new Date(r.completed_date);
            return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        });

        const today = new Date();
        const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const oneDayMs = 86400000;

        const completedToday = dates[0] === todayMs;

        // Calculate current streak (consecutive days ending at today or yesterday)
        let currentStreak = 0;
        let checkDate = completedToday ? todayMs : todayMs - oneDayMs;

        for (const d of dates) {
            if (d === checkDate) {
                currentStreak++;
                checkDate -= oneDayMs;
            } else if (d < checkDate) {
                break;
            }
        }

        // If streak doesn't start from today or yesterday, it's 0
        if (!completedToday && dates[0] !== todayMs - oneDayMs) {
            currentStreak = 0;
        }

        // Calculate longest streak
        let longestStreak = 1;
        let tempStreak = 1;
        for (let i = 1; i < dates.length; i++) {
            if (dates[i - 1] - dates[i] === oneDayMs) {
                tempStreak++;
                longestStreak = Math.max(longestStreak, tempStreak);
            } else {
                tempStreak = 1;
            }
        }

        res.json({
            currentStreak,
            longestStreak,
            totalDays: dates.length,
            completedToday
        });
    } catch (err) {
        console.error('Streak error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Beacon endpoint for saving session on page unload (F5 / close tab / logout)
app.post('/api/woodpecker/sessions/:sessionId/end', async (req, res) => {
    const { setId, duration, token } = req.body;
    if (!setId) return res.status(400).json({ error: 'Missing setId' });

    try {
        const { rows } = await pool.query(
            'SELECT id, ended_at FROM training_sessions WHERE id = $1', [req.params.sessionId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Session not found' });

        if (!rows[0].ended_at) {
            // Recalculate puzzles_attempted/puzzles_solved from actual attempts
            // (cached counts may be stale if F5 happened mid-puzzle)
            const { rows: counts } = await pool.query(
                `SELECT 
                    COUNT(*) AS attempted,
                    COUNT(CASE WHEN correct = true THEN 1 END) AS solved
                 FROM attempts WHERE session_id = $1`,
                [req.params.sessionId]
            );

            await pool.query(
                `UPDATE training_sessions 
                 SET ended_at = NOW(), duration = $1, puzzles_attempted = $2, puzzles_solved = $3 
                 WHERE id = $4`,
                [duration || 0, parseInt(counts[0].attempted), parseInt(counts[0].solved), req.params.sessionId]
            );

            // Record daily completion if session was long enough (>= 570s ≈ 9.5 min)
            if (token && duration >= 570) {
                try {
                    const { rows: sessionRows } = await pool.query(
                        'SELECT user_id FROM sessions WHERE token = $1', [token]
                    );
                    if (sessionRows.length > 0) {
                        const dcId = generateId();
                        await pool.query(
                            `INSERT INTO daily_completions (id, user_id, completed_date)
                             VALUES ($1, $2, CURRENT_DATE)
                             ON CONFLICT (user_id, completed_date) DO NOTHING`,
                            [dcId, sessionRows[0].user_id]
                        );
                    }
                } catch (e) {
                    console.warn('Beacon daily completion failed:', e.message);
                }
            }
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('Beacon end error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Get stats for a puzzle set
app.get('/api/woodpecker/stats/:setId', authMiddleware, async (req, res) => {
    try {
        const set = await buildSetWithCycles(req.params.setId);
        if (!set || set.assignedTo !== req.user.id) {
            return res.status(404).json({ error: 'Không tìm thấy puzzle set' });
        }

        let totalTime = 0, totalAttempted = 0, totalSolved = 0, totalSessions = 0;

        const cycleStats = set.cycles.map(cycle => {
            let cycleTime = 0, cycleAttempted = 0, cycleSolved = 0;

            const sessionStats = cycle.sessions.map(session => {
                const dur = session.duration || 0;
                cycleTime += dur;
                cycleAttempted += session.puzzlesAttempted;
                cycleSolved += session.puzzlesSolved;
                totalSessions++;

                return {
                    id: session.id, startedAt: session.startedAt,
                    puzzlesAttempted: session.puzzlesAttempted,
                    puzzlesSolved: session.puzzlesSolved,
                    successRate: session.puzzlesAttempted > 0
                        ? (session.puzzlesSolved / session.puzzlesAttempted * 100).toFixed(1) : '0.0',
                    duration: dur,
                    ppm: dur > 0 ? (session.puzzlesSolved / (dur / 60)).toFixed(2) : '0.00'
                };
            });

            totalTime += cycleTime;
            totalAttempted += cycleAttempted;
            totalSolved += cycleSolved;

            return {
                cycleNumber: cycle.cycleNumber, targetDays: cycle.targetDays,
                startedAt: cycle.startedAt, completedAt: cycle.completedAt,
                totalTime: cycleTime, puzzlesAttempted: cycleAttempted, puzzlesSolved: cycleSolved,
                successRate: cycleAttempted > 0 ? (cycleSolved / cycleAttempted * 100).toFixed(1) : '0.0',
                ppm: cycleTime > 0 ? (cycleSolved / (cycleTime / 60)).toFixed(2) : '0.00',
                sessions: sessionStats
            };
        });

        res.json({
            setId: set.id, setName: set.name, puzzleCount: set.puzzleCount,
            overall: {
                totalTime, totalSessions, puzzlesAttempted: totalAttempted, puzzlesSolved: totalSolved,
                successRate: totalAttempted > 0 ? (totalSolved / totalAttempted * 100).toFixed(1) : '0.0',
                ppm: totalTime > 0 ? (totalSolved / (totalTime / 60)).toFixed(2) : '0.00'
            },
            cycles: cycleStats,
            currentCycle: set.cycles.length > 0 ? set.cycles[set.cycles.length - 1].cycleNumber : 0,
            totalCycles: 7
        });
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== EXISTING COURSE API =====

app.get('/api/courses', async (req, res) => {
    try {
        const { rows: courses } = await pool.query('SELECT * FROM courses ORDER BY created_at ASC');
        const result = [];
        for (const c of courses) {
            const { rows: chapters } = await pool.query(
                'SELECT * FROM chapters WHERE course_id = $1 ORDER BY created_at ASC', [c.id]
            );
            result.push({
                id: c.id, name: c.name, description: c.description, icon: c.icon,
                createdAt: c.created_at,
                chapters: chapters.map(ch => ({
                    id: ch.id, name: ch.name, pgnFile: ch.pgn_file,
                    originalName: ch.original_name, lineCount: ch.line_count, createdAt: ch.created_at
                }))
            });
        }
        res.json(result);
    } catch (err) {
        console.error('Get courses error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.post('/api/courses', async (req, res) => {
    try {
        const id = generateId();
        const { rows } = await pool.query(
            `INSERT INTO courses (id, name, description, icon) VALUES ($1, $2, $3, $4) RETURNING *`,
            [id, req.body.name || 'Khóa học mới', req.body.description || '', req.body.icon || '♞']
        );
        const c = rows[0];
        res.json({ id: c.id, name: c.name, description: c.description, icon: c.icon, chapters: [], createdAt: c.created_at });
    } catch (err) {
        console.error('Create course error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.put('/api/courses/:id', async (req, res) => {
    try {
        const updates = [];
        const params = [];
        let idx = 1;
        if (req.body.name !== undefined) { updates.push(`name = $${idx++}`); params.push(req.body.name); }
        if (req.body.description !== undefined) { updates.push(`description = $${idx++}`); params.push(req.body.description); }
        if (req.body.icon !== undefined) { updates.push(`icon = $${idx++}`); params.push(req.body.icon); }

        if (updates.length === 0) return res.status(400).json({ error: 'Không có gì để cập nhật' });

        params.push(req.params.id);
        const { rows } = await pool.query(
            `UPDATE courses SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, params
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy khóa học' });

        const c = rows[0];
        res.json({ id: c.id, name: c.name, description: c.description, icon: c.icon, createdAt: c.created_at });
    } catch (err) {
        console.error('Update course error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.delete('/api/courses/:id', async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM courses WHERE id = $1', [req.params.id]);
        if (rowCount === 0) return res.status(404).json({ error: 'Không tìm thấy khóa học' });
        res.json({ success: true });
    } catch (err) {
        console.error('Delete course error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.get('/api/courses/:courseId/chapters', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM chapters WHERE course_id = $1 ORDER BY created_at ASC',
            [req.params.courseId]
        );
        res.json(rows.map(ch => ({
            id: ch.id, name: ch.name, pgnFile: ch.pgn_file,
            originalName: ch.original_name, lineCount: ch.line_count, createdAt: ch.created_at
        })));
    } catch (err) {
        console.error('Get chapters error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.post('/api/courses/:courseId/chapters', upload.single('pgn'), async (req, res) => {
    try {
        const { rows: courseCheck } = await pool.query('SELECT id FROM courses WHERE id = $1', [req.params.courseId]);
        if (courseCheck.length === 0) return res.status(404).json({ error: 'Không tìm thấy khóa học' });
        if (!req.file) return res.status(400).json({ error: 'Cần upload file PGN' });

        const pgnContent = req.file.buffer.toString('utf-8');
        const lineCount = (pgnContent.match(/\[Event\s/g) || []).length;

        const id = generateId();
        const name = req.body.name || req.file.originalname.replace('.pgn', '');
        await pool.query(
            `INSERT INTO chapters (id, course_id, name, pgn_file, pgn_content, original_name, line_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, req.params.courseId, name, req.file.originalname, pgnContent, req.file.originalname, lineCount]
        );

        res.json({ id, name, pgnFile: req.file.originalname, originalName: req.file.originalname, lineCount, createdAt: new Date().toISOString() });
    } catch (err) {
        console.error('Create chapter error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.put('/api/chapters/:id', upload.single('pgn'), async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM chapters WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy chương' });

        const updates = [];
        const params = [];
        let idx = 1;

        if (req.body.name !== undefined) { updates.push(`name = $${idx++}`); params.push(req.body.name); }

        if (req.file) {
            const pgnContent = req.file.buffer.toString('utf-8');
            const lineCount = (pgnContent.match(/\[Event\s/g) || []).length;

            updates.push(`pgn_file = $${idx++}`); params.push(req.file.originalname);
            updates.push(`pgn_content = $${idx++}`); params.push(pgnContent);
            updates.push(`original_name = $${idx++}`); params.push(req.file.originalname);
            updates.push(`line_count = $${idx++}`); params.push(lineCount);
        }

        if (updates.length > 0) {
            params.push(req.params.id);
            await pool.query(`UPDATE chapters SET ${updates.join(', ')} WHERE id = $${idx}`, params);
        }

        const { rows: updated } = await pool.query('SELECT * FROM chapters WHERE id = $1', [req.params.id]);
        const ch = updated[0];
        res.json({ id: ch.id, name: ch.name, pgnFile: ch.pgn_file, originalName: ch.original_name, lineCount: ch.line_count, createdAt: ch.created_at });
    } catch (err) {
        console.error('Update chapter error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.delete('/api/chapters/:id', async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM chapters WHERE id = $1', [req.params.id]);
        if (rowCount === 0) return res.status(404).json({ error: 'Không tìm thấy chương' });
        res.json({ success: true });
    } catch (err) {
        console.error('Delete chapter error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.get('/api/chapters/:id/pgn', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT pgn_content FROM chapters WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy chương' });
        if (!rows[0].pgn_content) return res.status(404).json({ error: 'Nội dung PGN không tồn tại' });

        res.type('text/plain').send(rows[0].pgn_content);
    } catch (err) {
        console.error('Get chapter PGN error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== START SERVER =====
async function start() {
    try {
        await initDB();
        console.log('  ✓ Database initialized');
    } catch (err) {
        console.error('  ✗ Database init failed:', err.message);
        console.log('  ℹ Make sure DATABASE_URL is set or PostgreSQL is running locally');
        process.exit(1);
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n  ♞ Chess Trainer Server`);
        console.log(`  → Main App:   http://localhost:${PORT}`);
        console.log(`  → Woodpecker: http://localhost:${PORT}/woodpecker.html\n`);
    });
}

start();
