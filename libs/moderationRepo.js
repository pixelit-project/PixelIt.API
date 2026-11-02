const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 3,
});

async function report(iconId, reason) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        // Lock the icon so concurrent reports cannot create multiple open requests.
        const [icons] = await connection.query('SELECT id FROM pixel_it_bitmap WHERE id = ? FOR UPDATE', [iconId]);
        if (!icons.length) {
            await connection.rollback();
            return false;
        }
        const [inserted] = await connection.execute(
            `INSERT INTO pixel_it_reports (icon_id, reason)
             SELECT ?, ?
             WHERE NOT EXISTS (
                 SELECT 1 FROM pixel_it_reports
                 WHERE icon_id = ? AND status IN ('pending', 'approved')
             )`,
            [iconId, reason, iconId]
        );
        if (inserted.affectedRows > 0) {
            // A compact durable counter per subscriber, committed with the new report.
            await connection.execute(`
                UPDATE pixel_it_telegram
                SET pending_count = LEAST(pending_count + 1, 1000000)
                WHERE chat_id IS NOT NULL
            `);
        }
        await connection.commit();
        return true;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function preview(iconId) {
    const [icons] = await pool.query(
        `SELECT sizex AS sizeX, sizey AS sizeY,
                LEFT(rgb565array, 100000) AS pixels
         FROM pixel_it_bitmap
         WHERE id = ?`,
        [iconId]
    );
    return icons[0];
}

async function list(before) {
    const [reports] = await pool.query(
        `SELECT r.id, r.icon_id, r.reason, r.status,
                r.created_at, r.processed_at, b.name
         FROM pixel_it_reports r
         LEFT JOIN pixel_it_bitmap b ON b.id = r.icon_id
         WHERE r.id < ?
         ORDER BY r.id DESC
         LIMIT 50`,
        [before]
    );
    return reports;
}

async function decide(reportId, action, actor = 'admin', actorLogin = null) {
    const connection = await pool.getConnection();
    const status = action === 'approve' ? 'approved' : 'rejected';
    const previousStatus = action === 'restore' ? 'approved' : 'pending';
    try {
        await connection.beginTransaction();
        const [result] = await connection.execute(
            `UPDATE pixel_it_reports
             SET status = ?, processed_at = CURRENT_TIMESTAMP
             WHERE id = ? AND status = ?`,
            [status, reportId, previousStatus]
        );
        if (!result.affectedRows) {
            await connection.rollback();
            return false;
        }
        if (actorLogin && actor.startsWith('github:')) {
            await rememberIdentity(actor.slice(7), actorLogin, connection);
        }
        // Persist the decision and its audit event together.
        await connection.execute('INSERT INTO pixel_it_moderation_audit (report_id, action, actor) VALUES (?, ?, ?)', [
            reportId,
            action,
            actor,
        ]);
        await connection.commit();
        return true;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function listModerators() {
    const [rows] = await pool.query(`
        SELECT m.github_id, n.github_login, m.created_by, m.created_at
        FROM pixel_it_moderators m
        LEFT JOIN pixel_it_github_names n ON n.actor = CONCAT('github:', m.github_id)
        ORDER BY m.created_at DESC
        LIMIT 100
    `);
    return rows;
}

async function isModerator(id) {
    const [rows] = await pool.execute(`
        SELECT github_id FROM pixel_it_moderators WHERE github_id = ?
    `, [id]);
    return rows.length > 0;
}

async function rememberIdentity(id, login, connection = pool) {
    await connection.execute(`
        INSERT INTO pixel_it_github_names (actor, github_login)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE github_login = VALUES(github_login)
    `, [`github:${id}`, login]);
}

async function setModerator(id, enabled, actor, login = null, actorLogin = null) {
    const connection = await pool.getConnection();
    let locked = false;
    let transaction = false;
    try {
        const [locks] = await connection.query("SELECT GET_LOCK('pixelit_moderators', 5) AS acquired");
        locked = Number(locks[0].acquired) === 1;
        if (!locked) {
            throw new Error('Moderator directory busy');
        }
        await connection.beginTransaction();
        transaction = true;
        const [existing] = await connection.execute(`
            SELECT m.github_id, n.github_login
            FROM pixel_it_moderators m
            LEFT JOIN pixel_it_github_names n ON n.actor = CONCAT('github:', m.github_id)
            WHERE m.github_id = ?
            FOR UPDATE
        `, [id]);
        const changed = enabled ? existing.length === 0 : existing.length > 0;
        if (enabled && changed) {
            const [counts] = await connection.query('SELECT COUNT(*) AS count FROM pixel_it_moderators');
            if (Number(counts[0].count) >= 100) {
                await connection.rollback();
                transaction = false;
                return false;
            }
            await connection.execute(`
                INSERT INTO pixel_it_moderators (github_id, created_by)
                VALUES (?, ?)
            `, [id, actor]);
        } else if (!enabled) {
            await connection.execute(`
                DELETE FROM pixel_it_telegram WHERE github_id = ?
            `, [id]);
            await connection.execute(`
                DELETE FROM pixel_it_moderators WHERE github_id = ?
            `, [id]);
        }
        if (login) {
            await rememberIdentity(id, login, connection);
        }
        if (changed) {
            await connection.execute(`
                INSERT INTO pixel_it_admin_audit (action, actor, actor_login, target_id, target_login)
                VALUES (?, ?, ?, ?, ?)
            `, [enabled ? 'moderator_added' : 'moderator_removed', actor, actorLogin, id, login || existing[0]?.github_login || null]);
        }
        await connection.commit();
        transaction = false;
        return true;
    } catch (error) {
        if (transaction) {
            await connection.rollback();
        }
        throw error;
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

async function listModerationAudit(before) {
    const [rows] = await pool.execute(`
        SELECT a.id, a.report_id, r.icon_id, a.action, a.actor,
               n.github_login AS actor_login, a.created_at
        FROM pixel_it_moderation_audit a
        LEFT JOIN pixel_it_reports r ON r.id = a.report_id
        LEFT JOIN pixel_it_github_names n ON n.actor = a.actor
        WHERE a.id < ?
        ORDER BY a.id DESC
        LIMIT 50
    `, [before]);
    return rows;
}

async function listAdminAudit(before) {
    const [rows] = await pool.execute(`
        SELECT id, action, actor, actor_login, target_id, target_login, created_at
        FROM pixel_it_admin_audit
        WHERE id < ?
        ORDER BY id DESC
        LIMIT 50
    `, [before]);
    return rows;
}

module.exports = {
    telegram: require('./telegramRepo')(pool),
    report,
    preview,
    list,
    decide,
    listModerators,
    isModerator,
    setModerator,
    rememberIdentity,
    listModerationAudit,
    listAdminAudit,
};
