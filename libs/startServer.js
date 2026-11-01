// Keep initialization separate so failure never exposes a partially migrated API.
async function startServer(app, port, migrate) {
    await migrate();
    return new Promise((resolve, reject) => {
        const server = app.listen(port);
        server.once('error', reject);
        server.once('listening', () => {
            server.removeListener('error', reject);
            resolve(server);
        });
    });
}

module.exports = startServer;
