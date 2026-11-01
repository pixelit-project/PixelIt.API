const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const log = require('./logger');

async function createMigrationHistory(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS pixel_it_schema_migrations (
            name VARCHAR(128) NOT NULL PRIMARY KEY,
            checksum CHAR(64) NOT NULL,
            applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function applyMigration(connection, directory, name) {
    const source = await fs.readFile(path.join(directory, name), 'utf8');
    const checksum = crypto.createHash('sha256').update(source).digest('hex');
    const [applied] = await connection.execute('SELECT checksum FROM pixel_it_schema_migrations WHERE name = ?', [
        name,
    ]);
    if (applied.length) {
        if (applied[0].checksum !== checksum) {
            const error = new Error('Applied migration was modified');
            error.code = 'MIGRATION_CHECKSUM_MISMATCH';
            throw error;
        }
        log.info('Migration {migration}: already applied.', { migration: name });
        return;
    }

    log.info('Migration {migration}: applying.', { migration: name });
    // MySQL DDL auto-commits. Files must contain simple, idempotent DDL so retries are safe.
    const sql = source.replace(/^\s*--.*$/gm, '');
    const statements = sql
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
    for (const statement of statements) {
        await connection.query(statement);
    }
    await connection.execute('INSERT INTO pixel_it_schema_migrations (name, checksum) VALUES (?, ?)', [name, checksum]);
    log.info('Migration {migration}: applied successfully.', { migration: name });
}

async function migrate() {
    let connection;
    let locked = false;
    let currentMigration = 'initialization';
    log.info('Database migrations: checking schema.');
    try {
        connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            connectTimeout: 10000,
        });

        // Advisory locks belong to a connection; keep this connection until all files are applied.
        log.info('Database migrations: waiting for migration lock.');
        const [rows] = await connection.query("SELECT GET_LOCK('pixelit_api_migrations', 30) AS acquired");
        if (Number(rows[0]?.acquired) !== 1) {
            const error = new Error('Migration lock unavailable');
            error.code = 'MIGRATION_LOCK_UNAVAILABLE';
            throw error;
        }
        locked = true;
        await createMigrationHistory(connection);
        const directory = path.join(__dirname, '..', 'migrations');
        const files = (await fs.readdir(directory)).filter((name) => /^\d+[a-zA-Z0-9_-]*\.sql$/.test(name)).sort();
        for (const name of files) {
            currentMigration = name;
            await applyMigration(connection, directory, name);
        }
        log.info('Database migrations: schema ready; {count} files checked.', { count: files.length });
    } catch (error) {
        const errorCode =
            typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'UNKNOWN';
        // Do not log SQL, connection settings or arbitrary driver error messages.
        log.error('Database migrations failed at {migration}: {errorCode}', {
            migration: currentMigration,
            errorCode,
        });
        throw error;
    } finally {
        if (connection) {
            try {
                if (locked) {
                    await connection.query("SELECT RELEASE_LOCK('pixelit_api_migrations')");
                }
            } finally {
                await connection.end();
            }
        }
    }
}

module.exports = migrate;
