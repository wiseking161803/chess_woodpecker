const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Use DATABASE_URL from Railway or local PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
        ? { rejectUnauthorized: false }
        : false
});

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            -- Users
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                full_name TEXT DEFAULT '',
                password_hash TEXT NOT NULL,
                date_of_birth TEXT DEFAULT '',
                role TEXT DEFAULT 'user',
                status TEXT DEFAULT 'active',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            -- Auth sessions
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            -- Puzzle sets
            CREATE TABLE IF NOT EXISTS puzzle_sets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                pgn_file TEXT DEFAULT '',
                pgn_content TEXT DEFAULT '',
                original_name TEXT DEFAULT '',
                puzzle_count INTEGER DEFAULT 0,
                assigned_to TEXT REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            -- Add pgn_content column if not exists (migration)
            ALTER TABLE puzzle_sets ADD COLUMN IF NOT EXISTS pgn_content TEXT DEFAULT '';

            -- Cycles
            CREATE TABLE IF NOT EXISTS cycles (
                id TEXT PRIMARY KEY,
                set_id TEXT REFERENCES puzzle_sets(id) ON DELETE CASCADE,
                cycle_number INTEGER NOT NULL,
                target_days INTEGER NOT NULL,
                started_at TIMESTAMPTZ DEFAULT NOW(),
                completed_at TIMESTAMPTZ
            );

            -- Training sessions
            CREATE TABLE IF NOT EXISTS training_sessions (
                id TEXT PRIMARY KEY,
                cycle_id TEXT REFERENCES cycles(id) ON DELETE CASCADE,
                started_at TIMESTAMPTZ DEFAULT NOW(),
                ended_at TIMESTAMPTZ,
                duration INTEGER DEFAULT 0,
                puzzles_attempted INTEGER DEFAULT 0,
                puzzles_solved INTEGER DEFAULT 0
            );

            -- Attempts
            CREATE TABLE IF NOT EXISTS attempts (
                id SERIAL PRIMARY KEY,
                session_id TEXT REFERENCES training_sessions(id) ON DELETE CASCADE,
                puzzle_index INTEGER NOT NULL,
                correct BOOLEAN NOT NULL,
                time_ms INTEGER DEFAULT 0,
                recorded_at TIMESTAMPTZ DEFAULT NOW()
            );

            -- Courses
            CREATE TABLE IF NOT EXISTS courses (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                icon TEXT DEFAULT '♞',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            -- Chapters
            CREATE TABLE IF NOT EXISTS chapters (
                id TEXT PRIMARY KEY,
                course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                pgn_file TEXT DEFAULT '',
                pgn_content TEXT DEFAULT '',
                original_name TEXT DEFAULT '',
                line_count INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            -- Add pgn_content column if not exists (migration)
            ALTER TABLE chapters ADD COLUMN IF NOT EXISTS pgn_content TEXT DEFAULT '';
        `);

        // Create default admin if no users exist
        const { rows } = await client.query('SELECT COUNT(*) FROM users');
        if (parseInt(rows[0].count) === 0) {
            const hash = await bcrypt.hash('admin123', 10);
            const id = generateId();
            await client.query(
                `INSERT INTO users (id, username, full_name, password_hash, role, status)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [id, 'admin', 'Administrator', hash, 'admin', 'active']
            );
            console.log('  ℹ Default admin created: admin / admin123');
        }
    } finally {
        client.release();
    }
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

module.exports = { pool, initDB, generateId };
