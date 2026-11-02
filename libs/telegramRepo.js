function createTelegramRepo(pool) {
    async function status(id) {
        const [rows] = await pool.execute(`
            SELECT chat_id IS NOT NULL AS connected,
                   link_hash IS NOT NULL AND link_expires_at > UTC_TIMESTAMP() AS pending
            FROM pixel_it_telegram WHERE github_id = ?
        `, [id]);
        return { connected: Boolean(rows[0]?.connected), pending: Boolean(rows[0]?.pending) };
    }

    async function link(id, hash, ownerId) {
        // Membership changes use the same lock. Keep the directory bounded to active accounts.
        const connection = await pool.getConnection();
        let locked = false;
        try {
            const [locks] = await connection.query("SELECT GET_LOCK('pixelit_moderators', 5) AS acquired");
            locked = Number(locks[0].acquired) === 1;
            if (!locked) {
                throw new Error('Telegram directory busy');
            }
            await connection.execute(`
                DELETE t FROM pixel_it_telegram t
                LEFT JOIN pixel_it_moderators m ON m.github_id = t.github_id
                WHERE t.github_id <> ? AND m.github_id IS NULL
            `, [ownerId]);
            const [result] = await connection.execute(`
                INSERT INTO pixel_it_telegram (github_id, link_hash, link_expires_at)
                SELECT ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)
                WHERE ? = ? OR EXISTS (SELECT 1 FROM pixel_it_moderators WHERE github_id = ?)
                ON DUPLICATE KEY UPDATE link_hash = VALUES(link_hash), link_expires_at = VALUES(link_expires_at)
            `, [id, hash, id, ownerId, id]);
            return result.affectedRows > 0;
        } finally {
            try {
                if (locked) {
                    await connection.query("SELECT RELEASE_LOCK('pixelit_moderators')");
                }
            } finally {
                connection.release();
            }
        }
    }

    async function connect(hash, chatId, ownerId) {
        const [result] = await pool.execute(`
            UPDATE pixel_it_telegram t
            SET chat_id = ?, link_hash = NULL, link_expires_at = NULL, pending_count = 0
            WHERE link_hash = ? AND link_expires_at > UTC_TIMESTAMP()
              AND (github_id = ? OR EXISTS (
                  SELECT 1 FROM pixel_it_moderators m WHERE m.github_id = t.github_id
              ))
        `, [chatId, hash, ownerId]);
        return result.affectedRows === 1;
    }

    async function disconnect(id) {
        await pool.execute(`
            DELETE FROM pixel_it_telegram WHERE github_id = ?
        `, [id]);
    }

    async function stop(chatId) {
        await pool.execute(`
            DELETE FROM pixel_it_telegram WHERE chat_id = ?
        `, [chatId]);
    }

    async function recipients(ownerId) {
        const [rows] = await pool.execute(`
            SELECT t.github_id, t.chat_id
            FROM pixel_it_telegram t
            WHERE t.chat_id IS NOT NULL AND t.pending_count > 0
              AND (t.last_attempt_at IS NULL OR t.last_attempt_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE))
              AND (t.github_id = ? OR EXISTS (
                  SELECT 1 FROM pixel_it_moderators m WHERE m.github_id = t.github_id
              ))
            ORDER BY t.last_attempt_at, t.github_id
            LIMIT 10
        `, [ownerId]);
        return rows;
    }

    async function claim(id, chatId, ownerId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.execute(`
                SELECT pending_count
                FROM pixel_it_telegram t
                WHERE github_id = ? AND chat_id = ? AND pending_count > 0
                  AND (last_attempt_at IS NULL OR last_attempt_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE))
                  AND (github_id = ? OR EXISTS (
                      SELECT 1 FROM pixel_it_moderators m WHERE m.github_id = t.github_id
                  ))
                FOR UPDATE
            `, [id, chatId, ownerId]);
            if (!rows.length) {
                await connection.rollback();
                return 0;
            }
            // At-most-once attempts: uncertain network outcomes must not duplicate messages.
            await connection.execute(`
                UPDATE pixel_it_telegram SET pending_count = 0, last_attempt_at = UTC_TIMESTAMP()
                WHERE github_id = ?
            `, [id]);
            await connection.commit();
            return Number(rows[0].pending_count);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async function connected(id, chatId, ownerId) {
        const [rows] = await pool.execute(`
            SELECT github_id FROM pixel_it_telegram t
            WHERE github_id = ? AND chat_id = ?
              AND (github_id = ? OR EXISTS (
                  SELECT 1 FROM pixel_it_moderators m WHERE m.github_id = t.github_id
              ))
        `, [id, chatId, ownerId]);
        return rows.length > 0;
    }

    return { status, link, connect, disconnect, stop, recipients, claim, connected };
}

module.exports = createTelegramRepo;
