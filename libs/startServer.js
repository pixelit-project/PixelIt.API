// Keep initialization separate so failure never exposes a partially migrated API.
async function startServer(app, port, migrate) {
    await migrate();
    return new Promise((resolve, reject) => {
        const server = app.listen(port);
        const requestTimeout = Number(process.env.API_REQUEST_TIMEOUT_MS);
        if (Number.isSafeInteger(requestTimeout) && requestTimeout > 0) {
            server.requestTimeout = requestTimeout;
        }
        server.once('error', reject);
        server.once('listening', () => {
            server.removeListener('error', reject);
            resolve(server);
        });
    });
}

module.exports = startServer;
