const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Data paths
const DATA_DIR = path.join(__dirname, 'data');
const PGN_DIR = path.join(DATA_DIR, 'pgn');
const COURSES_FILE = path.join(DATA_DIR, 'courses.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const WOODPECKER_FILE = path.join(DATA_DIR, 'woodpecker.json');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PGN_DIR)) fs.mkdirSync(PGN_DIR, { recursive: true });

// Initialize data files if not exists
if (!fs.existsSync(COURSES_FILE)) {
    fs.writeFileSync(COURSES_FILE, JSON.stringify({ courses: [] }, null, 2));
}
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [], sessions: {} }, null, 2));
}
if (!fs.existsSync(WOODPECKER_FILE)) {
    fs.writeFileSync(WOODPECKER_FILE, JSON.stringify({ puzzleSets: [] }, null, 2));
}

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

// Multer for PGN file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, PGN_DIR),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, uniqueName);
    }
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.originalname.toLowerCase().endsWith('.pgn')) {
            cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận file PGN'));
        }
    }
});

// ===== HELPERS =====
function readJSON(filepath) {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function writeJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

function readCourses() { return readJSON(COURSES_FILE); }
function writeCourses(data) { writeJSON(COURSES_FILE, data); }
function readUsers() { return readJSON(USERS_FILE); }
function writeUsers(data) { writeJSON(USERS_FILE, data); }
function readWoodpecker() { return readJSON(WOODPECKER_FILE); }
function writeWoodpecker(data) { writeJSON(WOODPECKER_FILE, data); }

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ===== AUTH MIDDLEWARE =====
function authMiddleware(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Cần đăng nhập' });

    const userData = readUsers();
    const sessionEntry = userData.sessions[token];
    if (!sessionEntry) return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' });

    // Check expiry (7 days)
    if (Date.now() - new Date(sessionEntry.createdAt).getTime() > 7 * 24 * 60 * 60 * 1000) {
        delete userData.sessions[token];
        writeUsers(userData);
        return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
    }

    const user = userData.users.find(u => u.id === sessionEntry.userId);
    if (!user) return res.status(401).json({ error: 'Người dùng không tồn tại' });

    req.user = { id: user.id, username: user.username, role: user.role };
    next();
}

function adminMiddleware(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Cần quyền admin' });
    }
    next();
}

// ===== AUTH API =====

// Create default admin if no users exist
(async function initAdmin() {
    const userData = readUsers();
    if (userData.users.length === 0) {
        const hash = await bcrypt.hash('admin123', 10);
        userData.users.push({
            id: generateId(),
            username: 'admin',
            fullName: 'Administrator',
            passwordHash: hash,
            role: 'admin',
            status: 'active',
            createdAt: new Date().toISOString()
        });
        writeUsers(userData);
        console.log('  ℹ Default admin created: admin / admin123');
    } else {
        // Migrate existing users: add status if missing
        let changed = false;
        userData.users.forEach(u => {
            if (!u.status) { u.status = 'active'; changed = true; }
        });
        if (changed) writeUsers(userData);
    }
})();

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Thiếu thông tin đăng nhập' });

    const userData = readUsers();
    const user = userData.users.find(u => u.username === username);
    if (!user) return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });

    // Block pending users
    if (user.status === 'pending') {
        return res.status(403).json({ error: 'Tài khoản đang chờ admin duyệt. Vui lòng liên hệ admin.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });

    const token = generateToken();
    userData.sessions[token] = { userId: user.id, createdAt: new Date().toISOString() };
    writeUsers(userData);

    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// ===== SELF-REGISTRATION =====
app.post('/api/auth/register', async (req, res) => {
    const { fullName, username, password, confirmPassword, dateOfBirth } = req.body;

    // Validate required fields
    if (!fullName || !username || !password || !confirmPassword || !dateOfBirth) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin' });
    }

    // Validate password match
    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Mật khẩu xác nhận không khớp' });
    }

    // Validate password length
    if (password.length < 4) {
        return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 4 ký tự' });
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({ error: 'Username chỉ chứa chữ, số, dấu gạch dưới (3-20 ký tự)' });
    }

    const userData = readUsers();

    // Check duplicate username
    if (userData.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username đã tồn tại' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = {
        id: generateId(),
        username,
        fullName,
        passwordHash: hash,
        dateOfBirth,
        role: 'user',
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    userData.users.push(user);
    writeUsers(userData);

    res.json({ success: true, message: 'Đăng ký thành công! Vui lòng chờ admin duyệt tài khoản.' });
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    const userData = readUsers();
    delete userData.sessions[token];
    writeUsers(userData);
    res.json({ success: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json(req.user);
});

// ===== ADMIN USER MANAGEMENT =====

app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
    const userData = readUsers();
    let users = userData.users;

    // Filter by status if query param provided
    if (req.query.status) {
        users = users.filter(u => u.status === req.query.status);
    }

    res.json(users.map(u => ({
        id: u.id, username: u.username, fullName: u.fullName || '', dateOfBirth: u.dateOfBirth || '',
        role: u.role, status: u.status || 'active', createdAt: u.createdAt
    })));
});

app.post('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Thiếu username hoặc password' });

    const userData = readUsers();
    if (userData.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username đã tồn tại' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = {
        id: generateId(),
        username,
        fullName: req.body.fullName || '',
        passwordHash: hash,
        role: role || 'user',
        status: 'active',
        createdAt: new Date().toISOString()
    };
    userData.users.push(user);
    writeUsers(userData);

    res.json({ id: user.id, username: user.username, role: user.role, status: user.status, createdAt: user.createdAt });
});

app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, (req, res) => {
    const userData = readUsers();
    const idx = userData.users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy user' });
    if (userData.users[idx].role === 'admin') {
        return res.status(400).json({ error: 'Không thể xóa admin' });
    }

    // Remove sessions for this user
    for (const [token, session] of Object.entries(userData.sessions)) {
        if (session.userId === req.params.id) delete userData.sessions[token];
    }

    userData.users.splice(idx, 1);
    writeUsers(userData);
    res.json({ success: true });
});

// Approve pending user
app.post('/api/admin/users/:id/approve', authMiddleware, adminMiddleware, (req, res) => {
    const userData = readUsers();
    const user = userData.users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
    if (user.status !== 'pending') return res.status(400).json({ error: 'User không ở trạng thái chờ duyệt' });

    user.status = 'active';
    writeUsers(userData);
    res.json({ success: true, message: `Đã duyệt user ${user.username}` });
});

// Reject pending user
app.post('/api/admin/users/:id/reject', authMiddleware, adminMiddleware, (req, res) => {
    const userData = readUsers();
    const idx = userData.users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy user' });
    if (userData.users[idx].status !== 'pending') return res.status(400).json({ error: 'User không ở trạng thái chờ duyệt' });

    userData.users.splice(idx, 1);
    writeUsers(userData);
    res.json({ success: true, message: 'Đã từ chối đăng ký' });
});

// ===== ADMIN PUZZLE SET MANAGEMENT =====

app.get('/api/admin/puzzle-sets', authMiddleware, adminMiddleware, (req, res) => {
    const data = readWoodpecker();
    const userData = readUsers();
    const sets = data.puzzleSets.map(s => {
        const user = userData.users.find(u => u.id === s.assignedTo);
        return { ...s, assignedUsername: user ? user.username : 'Unknown' };
    });
    res.json(sets);
});

app.post('/api/admin/puzzle-sets', authMiddleware, adminMiddleware, upload.single('pgn'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Cần upload file PGN' });
    if (!req.body.assignedTo) return res.status(400).json({ error: 'Cần chọn user' });

    const data = readWoodpecker();

    // Count puzzles in PGN
    let puzzleCount = 0;
    try {
        const content = fs.readFileSync(path.join(PGN_DIR, req.file.filename), 'utf-8');
        puzzleCount = (content.match(/\[Event\s/g) || []).length;
    } catch (e) {
        console.warn('Could not count puzzles:', e.message);
    }

    // Parse assignedTo — can be JSON array or single string
    let userIds;
    try {
        userIds = JSON.parse(req.body.assignedTo);
        if (!Array.isArray(userIds)) userIds = [userIds];
    } catch {
        userIds = [req.body.assignedTo];
    }

    const createdSets = [];
    for (const userId of userIds) {
        const puzzleSet = {
            id: generateId(),
            name: req.body.name || req.file.originalname.replace('.pgn', ''),
            pgnFile: req.file.filename,
            originalName: req.file.originalname,
            puzzleCount,
            assignedTo: userId,
            createdAt: new Date().toISOString(),
            cycles: []
        };
        data.puzzleSets.push(puzzleSet);
        createdSets.push(puzzleSet);
    }

    writeWoodpecker(data);
    res.json(createdSets.length === 1 ? createdSets[0] : createdSets);
});

// Assign existing puzzle set to additional users
app.post('/api/admin/puzzle-sets/:id/assign', authMiddleware, adminMiddleware, (req, res) => {
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'Cần danh sách user IDs' });
    }

    const data = readWoodpecker();
    const sourceSet = data.puzzleSets.find(s => s.id === req.params.id);
    if (!sourceSet) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

    const createdSets = [];
    for (const userId of userIds) {
        // Skip if user already has this PGN assigned
        const existing = data.puzzleSets.find(s => s.pgnFile === sourceSet.pgnFile && s.assignedTo === userId);
        if (existing) continue;

        const newSet = {
            id: generateId(),
            name: sourceSet.name,
            pgnFile: sourceSet.pgnFile,
            originalName: sourceSet.originalName,
            puzzleCount: sourceSet.puzzleCount,
            assignedTo: userId,
            createdAt: new Date().toISOString(),
            cycles: []
        };
        data.puzzleSets.push(newSet);
        createdSets.push(newSet);
    }

    writeWoodpecker(data);
    res.json({ assigned: createdSets.length, sets: createdSets });
});

app.delete('/api/admin/puzzle-sets/:id', authMiddleware, adminMiddleware, (req, res) => {
    const data = readWoodpecker();
    const idx = data.puzzleSets.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

    const pgnFile = data.puzzleSets[idx].pgnFile;
    data.puzzleSets.splice(idx, 1);

    // Only delete PGN file if no other sets reference it
    const otherRefs = data.puzzleSets.filter(s => s.pgnFile === pgnFile);
    if (otherRefs.length === 0) {
        const pgnPath = path.join(PGN_DIR, pgnFile);
        if (fs.existsSync(pgnPath)) fs.unlinkSync(pgnPath);
    }

    writeWoodpecker(data);
    res.json({ success: true });
});

// ===== WOODPECKER USER API =====

const CYCLE_DAYS = [28, 14, 7, 4, 3, 2, 1];

app.get('/api/woodpecker/sets', authMiddleware, (req, res) => {
    const data = readWoodpecker();
    const userSets = data.puzzleSets.filter(s => s.assignedTo === req.user.id);
    res.json(userSets);
});

app.get('/api/woodpecker/sets/:id', authMiddleware, (req, res) => {
    const data = readWoodpecker();
    const set = data.puzzleSets.find(s => s.id === req.params.id && s.assignedTo === req.user.id);
    if (!set) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });
    res.json(set);
});

// Leaderboard for a puzzle set (all users with same set name)
app.get('/api/woodpecker/sets/:id/leaderboard', authMiddleware, (req, res) => {
    const data = readWoodpecker();
    const userData = readUsers();

    // Find the requesting user's set
    const mySet = data.puzzleSets.find(s => s.id === req.params.id && s.assignedTo === req.user.id);
    if (!mySet) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

    // Find all sets with the same name (same puzzle set assigned to different users)
    const relatedSets = data.puzzleSets.filter(s => s.name === mySet.name);

    const leaderboard = relatedSets.map(set => {
        const user = userData.users.find(u => u.id === set.assignedTo);
        const username = user ? user.username : 'Unknown';

        let totalAttempted = 0;
        let totalSolved = 0;
        let totalTimeMs = 0;
        let totalDuration = 0;
        let bestCycle = 0;

        set.cycles.forEach(cycle => {
            if (cycle.cycleNumber > bestCycle) bestCycle = cycle.cycleNumber;
            cycle.sessions.forEach(session => {
                totalAttempted += session.puzzlesAttempted || 0;
                totalSolved += session.puzzlesSolved || 0;
                totalDuration += session.duration || 0;
                if (session.attempts) {
                    session.attempts.forEach(a => {
                        totalTimeMs += a.timeMs || 0;
                    });
                }
            });
        });

        const accuracy = totalAttempted > 0 ? (totalSolved / totalAttempted * 100) : 0;
        const totalMinutes = totalDuration / 60;
        const ppm = totalMinutes > 0 ? (totalSolved / totalMinutes) : 0;

        return {
            userId: set.assignedTo,
            username,
            totalAttempted,
            totalSolved,
            accuracy: Math.round(accuracy * 10) / 10,
            ppm: Math.round(ppm * 100) / 100,
            bestCycle,
            isMe: set.assignedTo === req.user.id
        };
    }).filter(entry => entry.totalAttempted > 0); // Only show users who have attempted

    res.json(leaderboard);
});

app.get('/api/woodpecker/sets/:id/pgn', authMiddleware, (req, res) => {
    const data = readWoodpecker();
    const set = data.puzzleSets.find(s => s.id === req.params.id && s.assignedTo === req.user.id);
    if (!set) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

    const pgnPath = path.join(PGN_DIR, set.pgnFile);
    if (!fs.existsSync(pgnPath)) return res.status(404).json({ error: 'File PGN không tồn tại' });

    res.type('text/plain').send(fs.readFileSync(pgnPath, 'utf-8'));
});

// Start a new cycle
app.post('/api/woodpecker/sets/:id/start-cycle', authMiddleware, (req, res) => {
    const data = readWoodpecker();
    const set = data.puzzleSets.find(s => s.id === req.params.id && s.assignedTo === req.user.id);
    if (!set) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

    const nextCycleNum = set.cycles.length + 1;
    if (nextCycleNum > 7) return res.status(400).json({ error: 'Đã hoàn thành tất cả 7 cycles' });

    // Check if current cycle is completed
    const currentCycle = set.cycles[set.cycles.length - 1];
    if (currentCycle && !currentCycle.completedAt) {
        return res.status(400).json({ error: 'Cycle hiện tại chưa hoàn thành' });
    }

    const newCycle = {
        cycleNumber: nextCycleNum,
        targetDays: CYCLE_DAYS[nextCycleNum - 1],
        startedAt: new Date().toISOString(),
        completedAt: null,
        sessions: []
    };

    set.cycles.push(newCycle);
    writeWoodpecker(data);
    res.json(newCycle);
});

// Complete current cycle
app.post('/api/woodpecker/sets/:id/complete-cycle', authMiddleware, (req, res) => {
    const data = readWoodpecker();
    const set = data.puzzleSets.find(s => s.id === req.params.id && s.assignedTo === req.user.id);
    if (!set) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

    const currentCycle = set.cycles[set.cycles.length - 1];
    if (!currentCycle || currentCycle.completedAt) {
        return res.status(400).json({ error: 'Không có cycle đang hoạt động' });
    }

    currentCycle.completedAt = new Date().toISOString();
    writeWoodpecker(data);
    res.json(currentCycle);
});

// Create a new session
app.post('/api/woodpecker/sessions', authMiddleware, (req, res) => {
    const { setId } = req.body;
    const data = readWoodpecker();
    const set = data.puzzleSets.find(s => s.id === setId && s.assignedTo === req.user.id);
    if (!set) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

    const currentCycle = set.cycles[set.cycles.length - 1];
    if (!currentCycle || currentCycle.completedAt) {
        return res.status(400).json({ error: 'Không có cycle đang hoạt động. Hãy bắt đầu cycle mới.' });
    }

    const session = {
        id: generateId(),
        startedAt: new Date().toISOString(),
        endedAt: null,
        duration: 0,
        puzzlesAttempted: 0,
        puzzlesSolved: 0,
        attempts: []
    };

    currentCycle.sessions.push(session);
    writeWoodpecker(data);
    res.json({ session, cycleNumber: currentCycle.cycleNumber });
});

// Record a puzzle attempt
app.post('/api/woodpecker/sessions/:sessionId/attempt', authMiddleware, (req, res) => {
    const { setId, puzzleIndex, correct, timeMs } = req.body;
    const data = readWoodpecker();
    const set = data.puzzleSets.find(s => s.id === setId && s.assignedTo === req.user.id);
    if (!set) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

    const currentCycle = set.cycles[set.cycles.length - 1];
    if (!currentCycle) return res.status(400).json({ error: 'Không có cycle đang hoạt động' });

    const session = currentCycle.sessions.find(s => s.id === req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Không tìm thấy session' });

    session.attempts.push({ puzzleIndex, correct, timeMs, recordedAt: new Date().toISOString() });
    session.puzzlesAttempted = session.attempts.length;
    session.puzzlesSolved = session.attempts.filter(a => a.correct).length;

    writeWoodpecker(data);
    res.json({ attempt: session.attempts[session.attempts.length - 1], session });
});

// End a session
app.put('/api/woodpecker/sessions/:sessionId', authMiddleware, (req, res) => {
    const { setId, duration } = req.body;
    const data = readWoodpecker();
    const set = data.puzzleSets.find(s => s.id === setId && s.assignedTo === req.user.id);
    if (!set) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

    const currentCycle = set.cycles[set.cycles.length - 1];
    if (!currentCycle) return res.status(400).json({ error: 'Không có cycle đang hoạt động' });

    const session = currentCycle.sessions.find(s => s.id === req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Không tìm thấy session' });

    session.endedAt = new Date().toISOString();
    session.duration = duration || Math.round((new Date(session.endedAt) - new Date(session.startedAt)) / 1000);

    writeWoodpecker(data);
    res.json(session);
});

// Beacon endpoint for saving session on page unload (no auth header possible)
app.post('/api/woodpecker/sessions/:sessionId/end', (req, res) => {
    const { setId, duration } = req.body;
    if (!setId) return res.status(400).json({ error: 'Missing setId' });

    const data = readWoodpecker();
    // Find the session across all puzzle sets (beacon can't send auth)
    for (const set of data.puzzleSets) {
        if (set.id !== setId) continue;
        const currentCycle = set.cycles[set.cycles.length - 1];
        if (!currentCycle) continue;
        const session = currentCycle.sessions.find(s => s.id === req.params.sessionId);
        if (!session) continue;
        if (!session.endedAt) {
            session.endedAt = new Date().toISOString();
            session.duration = duration || Math.round((new Date(session.endedAt) - new Date(session.startedAt)) / 1000);
            writeWoodpecker(data);
        }
        return res.json({ ok: true });
    }
    res.status(404).json({ error: 'Session not found' });
});

// Get stats for a puzzle set
app.get('/api/woodpecker/stats/:setId', authMiddleware, (req, res) => {
    const data = readWoodpecker();
    const set = data.puzzleSets.find(s => s.id === req.params.setId && s.assignedTo === req.user.id);
    if (!set) return res.status(404).json({ error: 'Không tìm thấy puzzle set' });

    let totalTime = 0;
    let totalAttempted = 0;
    let totalSolved = 0;
    let totalSessions = 0;

    const cycleStats = set.cycles.map(cycle => {
        let cycleTime = 0;
        let cycleAttempted = 0;
        let cycleSolved = 0;

        const sessionStats = cycle.sessions.map(session => {
            const dur = session.duration || 0;
            cycleTime += dur;
            cycleAttempted += session.puzzlesAttempted;
            cycleSolved += session.puzzlesSolved;
            totalSessions++;

            return {
                id: session.id,
                startedAt: session.startedAt,
                puzzlesAttempted: session.puzzlesAttempted,
                puzzlesSolved: session.puzzlesSolved,
                successRate: session.puzzlesAttempted > 0 ? (session.puzzlesSolved / session.puzzlesAttempted * 100).toFixed(1) : '0.0',
                duration: dur,
                ppm: dur > 0 ? (session.puzzlesSolved / (dur / 60)).toFixed(2) : '0.00'
            };
        });

        totalTime += cycleTime;
        totalAttempted += cycleAttempted;
        totalSolved += cycleSolved;

        return {
            cycleNumber: cycle.cycleNumber,
            targetDays: cycle.targetDays,
            startedAt: cycle.startedAt,
            completedAt: cycle.completedAt,
            totalTime: cycleTime,
            puzzlesAttempted: cycleAttempted,
            puzzlesSolved: cycleSolved,
            successRate: cycleAttempted > 0 ? (cycleSolved / cycleAttempted * 100).toFixed(1) : '0.0',
            ppm: cycleTime > 0 ? (cycleSolved / (cycleTime / 60)).toFixed(2) : '0.00',
            sessions: sessionStats
        };
    });

    res.json({
        setId: set.id,
        setName: set.name,
        puzzleCount: set.puzzleCount,
        overall: {
            totalTime,
            totalSessions,
            puzzlesAttempted: totalAttempted,
            puzzlesSolved: totalSolved,
            successRate: totalAttempted > 0 ? (totalSolved / totalAttempted * 100).toFixed(1) : '0.0',
            ppm: totalTime > 0 ? (totalSolved / (totalTime / 60)).toFixed(2) : '0.00'
        },
        cycles: cycleStats,
        currentCycle: set.cycles.length > 0 ? set.cycles[set.cycles.length - 1].cycleNumber : 0,
        totalCycles: 7
    });
});

// ===== EXISTING COURSE API (unchanged) =====

app.get('/api/courses', (req, res) => {
    const data = readCourses();
    res.json(data.courses);
});

app.post('/api/courses', (req, res) => {
    const data = readCourses();
    const course = {
        id: generateId(),
        name: req.body.name || 'Khóa học mới',
        description: req.body.description || '',
        icon: req.body.icon || '♞',
        chapters: [],
        createdAt: new Date().toISOString()
    };
    data.courses.push(course);
    writeCourses(data);
    res.json(course);
});

app.put('/api/courses/:id', (req, res) => {
    const data = readCourses();
    const course = data.courses.find(c => c.id === req.params.id);
    if (!course) return res.status(404).json({ error: 'Không tìm thấy khóa học' });

    if (req.body.name !== undefined) course.name = req.body.name;
    if (req.body.description !== undefined) course.description = req.body.description;
    if (req.body.icon !== undefined) course.icon = req.body.icon;
    writeCourses(data);
    res.json(course);
});

app.delete('/api/courses/:id', (req, res) => {
    const data = readCourses();
    const idx = data.courses.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy khóa học' });

    const course = data.courses[idx];
    for (const ch of course.chapters) {
        const pgnPath = path.join(PGN_DIR, ch.pgnFile);
        if (fs.existsSync(pgnPath)) fs.unlinkSync(pgnPath);
    }

    data.courses.splice(idx, 1);
    writeCourses(data);
    res.json({ success: true });
});

app.get('/api/courses/:courseId/chapters', (req, res) => {
    const data = readCourses();
    const course = data.courses.find(c => c.id === req.params.courseId);
    if (!course) return res.status(404).json({ error: 'Không tìm thấy khóa học' });
    res.json(course.chapters);
});

app.post('/api/courses/:courseId/chapters', upload.single('pgn'), (req, res) => {
    const data = readCourses();
    const course = data.courses.find(c => c.id === req.params.courseId);
    if (!course) return res.status(404).json({ error: 'Không tìm thấy khóa học' });

    if (!req.file) return res.status(400).json({ error: 'Cần upload file PGN' });

    const chapter = {
        id: generateId(),
        name: req.body.name || req.file.originalname.replace('.pgn', ''),
        pgnFile: req.file.filename,
        originalName: req.file.originalname,
        lineCount: 0,
        createdAt: new Date().toISOString()
    };

    try {
        const content = fs.readFileSync(path.join(PGN_DIR, req.file.filename), 'utf-8');
        const eventCount = (content.match(/\[Event\s/g) || []).length;
        chapter.lineCount = eventCount;
    } catch (e) {
        console.warn('Could not count lines:', e.message);
    }

    course.chapters.push(chapter);
    writeCourses(data);
    res.json(chapter);
});

app.put('/api/chapters/:id', upload.single('pgn'), (req, res) => {
    const data = readCourses();
    let chapter = null;

    for (const c of data.courses) {
        const ch = c.chapters.find(ch => ch.id === req.params.id);
        if (ch) { chapter = ch; break; }
    }

    if (!chapter) return res.status(404).json({ error: 'Không tìm thấy chương' });

    if (req.body.name !== undefined) chapter.name = req.body.name;

    if (req.file) {
        const oldPath = path.join(PGN_DIR, chapter.pgnFile);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

        chapter.pgnFile = req.file.filename;
        chapter.originalName = req.file.originalname;

        try {
            const content = fs.readFileSync(path.join(PGN_DIR, req.file.filename), 'utf-8');
            const eventCount = (content.match(/\[Event\s/g) || []).length;
            chapter.lineCount = eventCount;
        } catch (e) {
            console.warn('Could not count lines:', e.message);
        }
    }

    writeCourses(data);
    res.json(chapter);
});

app.delete('/api/chapters/:id', (req, res) => {
    const data = readCourses();

    for (const course of data.courses) {
        const idx = course.chapters.findIndex(ch => ch.id === req.params.id);
        if (idx !== -1) {
            const chapter = course.chapters[idx];
            const pgnPath = path.join(PGN_DIR, chapter.pgnFile);
            if (fs.existsSync(pgnPath)) fs.unlinkSync(pgnPath);

            course.chapters.splice(idx, 1);
            writeCourses(data);
            return res.json({ success: true });
        }
    }

    res.status(404).json({ error: 'Không tìm thấy chương' });
});

app.get('/api/chapters/:id/pgn', (req, res) => {
    const data = readCourses();
    let chapter = null;

    for (const c of data.courses) {
        const ch = c.chapters.find(ch => ch.id === req.params.id);
        if (ch) { chapter = ch; break; }
    }

    if (!chapter) return res.status(404).json({ error: 'Không tìm thấy chương' });

    const pgnPath = path.join(PGN_DIR, chapter.pgnFile);
    if (!fs.existsSync(pgnPath)) return res.status(404).json({ error: 'File PGN không tồn tại' });

    res.type('text/plain').send(fs.readFileSync(pgnPath, 'utf-8'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ♞ Chess Trainer Server`);
    console.log(`  → Main App:   http://localhost:${PORT}`);
    console.log(`  → Woodpecker: http://localhost:${PORT}/woodpecker.html\n`);
});
