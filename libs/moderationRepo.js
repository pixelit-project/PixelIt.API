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
        await connection.execute(
            `INSERT INTO pixel_it_reports (icon_id, reason)
             SELECT ?, ?
             WHERE NOT EXISTS (
                 SELECT 1 FROM pixel_it_reports
                 WHERE icon_id = ? AND status IN ('pending', 'approved')
             )`,
            [iconId, reason, iconId]
        );
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

async function decide(reportId, action) {
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
        // Persist the decision and its audit event together.
        await connection.execute('INSERT INTO pixel_it_moderation_audit (report_id, action, actor) VALUES (?, ?, ?)', [
            reportId,
            action,
            'admin',
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

module.exports = {
    report,
    preview,
    list,
    decide,
};
