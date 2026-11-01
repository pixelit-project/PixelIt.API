// Forward rejected async handlers to the application's central error handler.
function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve().then(() => handler(req, res, next)).catch(next);
    };
}

module.exports = asyncRoute;
