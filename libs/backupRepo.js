const mysql = require('mysql2');
const { createReadStream } = require('node:fs');
const { open } = require('node:fs/promises');
const { pipeline } = require('node:stream/promises');
const { createGunzip } = require('node:zlib');

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 1,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    jsonStrings: true,
});

const tables = [
    'pixel_it_user',
    'pixel_it_bitmap',
    'pixel_it_hitcount',
    'pixel_it_telemetry',
    'pixel_it_reports',
    'pixel_it_moderation_audit',
    'pixel_it_github_names',
    'pixel_it_admin_audit',
    'pixel_it_moderators',
    'pixel_it_telegram',
    'pixel_it_icon_ratings',
    'pixel_it_icon_downloads',
    'pixel_it_icon_rating_submissions',
];
const format = 'pixelit-api-backup-v2';
const legacyFormat = 'pixelit-api-backup-v1';
const maxRecordBytes = 64 * 1024 * 1024;
const binaryTypes = new Set(['binary', 'varbinary', 'bit', 'tinyblob', 'blob', 'mediumblob', 'longblob']);

function backupError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

async function getSchema(connection) {
    const [rows] = await connection.query(`
        SELECT c.TABLE_NAME AS tableName, c.COLUMN_NAME AS columnName, c.COLUMN_TYPE AS columnType,
               c.DATA_TYPE AS dataType, c.IS_NULLABLE AS nullable, t.ENGINE AS engine
        FROM INFORMATION_SCHEMA.COLUMNS c
        JOIN INFORMATION_SCHEMA.TABLES t
            ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
        WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME IN (?)
            AND c.EXTRA NOT LIKE '%VIRTUAL GENERATED%' AND c.EXTRA NOT LIKE '%STORED GENERATED%'
        ORDER BY c.ORDINAL_POSITION
    `, [tables]);
    return tables.map((name) => {
        const columns = rows.filter((row) => row.tableName === name);
        if (!columns.length || columns.some((column) => column.engine !== 'InnoDB')) {
            throw backupError('UNSUPPORTED_BACKUP_SCHEMA');
        }
        return { name, columns };
    });
}

function describeColumns(columns) {
    return columns.map(({ columnName, columnType, nullable }) => [columnName, columnType, nullable]);
}

function columnList(columns) {
    return columns.map(({ columnName }) => mysql.escapeId(columnName)).join(', ');
}

async function* createBackup() {
    const rawConnection = await new Promise((resolve, reject) => {
        pool.getConnection((error, connection) => {
            if (error) {
                reject(error);
            } else {
                resolve(connection);
            }
        });
    });
    const connection = rawConnection.promise();
    let complete = false;
    try {
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query("SET SESSION time_zone = '+00:00'");
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        const schema = await getSchema(connection);
        const manifest = schema.map(({ name, columns }) => ({ name, columns: describeColumns(columns) }));
        yield JSON.stringify({ format, tables: manifest }) + '\n';
        for (const [index, { name, columns }] of schema.entries()) {
            const query = rawConnection.query({
                sql: `SELECT ${columnList(columns)} FROM ${mysql.escapeId(name)}`,
                rowsAsArray: true,
            });
            for await (const row of query.stream()) {
                const values = row.map((value) => Buffer.isBuffer(value) ? value.toString('hex') : value);
                const record = JSON.stringify([index, values]);
                if (Buffer.byteLength(record) > maxRecordBytes) {
                    throw backupError('BACKUP_RECORD_TOO_LARGE');
                }
                yield record + '\n';
            }
        }
        await connection.commit();
        complete = true;
        yield '{"end":true}\n';
    } finally {
        if (complete) {
            connection.release();
        } else {
            // Closing an interrupted query also releases the read transaction.
            rawConnection.destroy();
        }
    }
}

function parseRecord(bytes) {
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw backupError('INVALID_BACKUP');
    }
}

async function* splitRecords(source) {
    let fragments = [];
    let length = 0;
    for await (const chunk of source) {
        let start = 0;
        while (start < chunk.length) {
            const newline = chunk.indexOf(10, start);
            const end = newline === -1 ? chunk.length : newline;
            const part = chunk.subarray(start, end);
            length += part.length;
            if (length > maxRecordBytes) {
                throw backupError('BACKUP_RECORD_TOO_LARGE');
            }
            if (newline === -1) {
                fragments.push(part);
                break;
            }
            const record = fragments.length ? Buffer.concat([...fragments, part], length) : part;
            yield parseRecord(record);
            fragments = [];
            length = 0;
            start = newline + 1;
        }
    }
    if (length) {
        throw backupError('INVALID_BACKUP');
    }
}

async function* readRecords(path, compressed) {
    if (compressed) {
        // pipeline propagates read and gzip checksum failures before restore can commit.
        let pendingError;
        const gunzip = createGunzip();
        const decompress = pipeline(createReadStream(path), gunzip).catch((error) => {
            pendingError = error;
        });
        try {
            yield* splitRecords(gunzip);
            await decompress;
            if (pendingError) {
                throw pendingError;
            }
        } catch (error) {
            if (['Z_DATA_ERROR', 'Z_BUF_ERROR', 'Z_NEED_DICT'].includes(error.code)) {
                throw backupError('INVALID_BACKUP');
            }
            throw error;
        } finally {
            gunzip.destroy();
            await decompress;
        }
        return;
    }

    // Accept existing v1 exports, whose original writer limited them to 64 MiB.
    const file = await open(path, 'r');
    let backup;
    try {
        if ((await file.stat()).size > maxRecordBytes) {
            throw backupError('INVALID_BACKUP');
        }
        backup = parseRecord(await file.readFile());
    } finally {
        await file.close();
    }
    if (backup?.format !== legacyFormat || !Array.isArray(backup.tables)) {
        throw backupError('INVALID_BACKUP');
    }
    yield { format, tables: backup.tables.map((table) => ({ name: table?.name, columns: table?.columns })) };
    for (const [index, table] of backup.tables.entries()) {
        if (!Array.isArray(table.rows)) {
            throw backupError('INVALID_BACKUP');
        }
        for (const row of table.rows) {
            yield [index, row];
        }
    }
    yield { end: true };
}

function validateRow(columns, row) {
    if (!Array.isArray(row) || row.length !== columns.length) {
        throw backupError('INVALID_BACKUP');
    }
    for (const [index, value] of row.entries()) {
        const column = columns[index];
        let valid;
        if (value === null) {
            valid = column.nullable === 'YES';
        } else if (binaryTypes.has(column.dataType)) {
            valid = typeof value === 'string' && value.length % 2 === 0 && !/[^0-9a-f]/i.test(value);
        } else {
            valid = typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
        }
        if (!valid) {
            throw backupError('INVALID_BACKUP');
        }
    }
}

async function* readRows(path, compressed, schema) {
    const records = readRecords(path, compressed);
    try {
        const { value: manifest } = await records.next();
        const expected = schema.map(({ name, columns }) => ({ name, columns: describeColumns(columns) }));
        // Older backups may omit either or both of the trailing daily counter tables.
        const tableCount = manifest?.tables?.length;
        if (manifest?.format !== format || !Array.isArray(manifest.tables)
            || tableCount < expected.length - 2 || tableCount > expected.length
            || JSON.stringify(manifest.tables) !== JSON.stringify(expected.slice(0, tableCount))) {
            throw backupError('INVALID_BACKUP');
        }
        let lastIndex = 0;
        let complete = false;
        for await (const record of records) {
            if (complete) {
                throw backupError('INVALID_BACKUP');
            }
            if (record?.end === true) {
                complete = true;
                continue;
            }
            if (!Array.isArray(record) || record.length !== 2) {
                throw backupError('INVALID_BACKUP');
            }
            const [index, row] = record;
            if (!Number.isInteger(index) || index < lastIndex || index >= manifest.tables.length) {
                throw backupError('INVALID_BACKUP');
            }
            validateRow(schema[index].columns, row);
            lastIndex = index;
            yield { index, row };
        }
        if (!complete) {
            throw backupError('INVALID_BACKUP');
        }
    } finally {
        await records.return();
    }
}

async function insertRows(connection, { name, columns }, rows) {
    const placeholders = '(' + columns.map(() => '?').join(', ') + ')';
    const values = rows.flatMap((row) => row.map((value, index) =>
        value !== null && binaryTypes.has(columns[index].dataType) ? Buffer.from(value, 'hex') : value
    ));
    await connection.execute(
        `INSERT INTO ${mysql.escapeId(name)} (${columnList(columns)}) VALUES ${rows.map(() => placeholders).join(', ')}`,
        values
    );
}

async function applyRows(connection, schema, rows) {
    let tableIndex = 0;
    let batch = [];
    let batchBytes = 0;
    for await (const { index, row } of rows) {
        const rowBytes = Buffer.byteLength(JSON.stringify(row));
        if (batch.length && (index !== tableIndex || batch.length >= 100 || batchBytes + rowBytes > 512 * 1024)) {
            await insertRows(connection, schema[tableIndex], batch);
            batch = [];
            batchBytes = 0;
        }
        tableIndex = index;
        batch.push(row);
        batchBytes += rowBytes;
    }
    if (batch.length) {
        await insertRows(connection, schema[tableIndex], batch);
    }
}

async function restoreBackup(path) {
    const file = await open(path, 'r');
    const magic = Buffer.alloc(2);
    try {
        await file.read(magic, 0, magic.length, 0);
    } finally {
        await file.close();
    }
    const compressed = magic[0] === 0x1f && magic[1] === 0x8b;
    const connection = await pool.promise().getConnection();
    try {
        const schema = await getSchema(connection);
        // Validate the entire staged file before taking write locks.
        for await (const row of readRows(path, compressed, schema)) {
            // Row validation is performed by the reader.
        }
        await connection.query(`
            SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_ALL_TABLES', 'NO_AUTO_VALUE_ON_ZERO')
        `);
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query(compressed ? "SET SESSION time_zone = '+00:00'" : 'SET SESSION time_zone = DEFAULT');
        await connection.beginTransaction();
        for (const { name } of [...schema].reverse()) {
            await connection.query(`DELETE FROM ${mysql.escapeId(name)}`);
        }
        await applyRows(connection, schema, readRows(path, compressed, schema));
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = { createBackup, restoreBackup };
