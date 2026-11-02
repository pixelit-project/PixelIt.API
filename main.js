require('dotenv').config();
const express = require('express');
const useragent = require('express-useragent');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const log = require('./libs/logger');
const tools = require('./libs/tools');
const cache = require('./libs/cache');
const moderationRepo = require('./libs/moderationRepo');
const { apiLimiter } = require('./libs/rateLimit');
const startServer = require('./libs/startServer');
const migrate = require('./libs/migrations');
const registerBitmapRoutes = require('./routes/bitmaps');
const registerTelemetryRoutes = require('./routes/telemetry');
const registerStatisticsRoutes = require('./routes/statistics');
const registerReleaseRoutes = require('./routes/releases');
const registerModerationRoutes = require('./routes/moderation');

const port = process.env.PORT || 8080;

// defining the Express app
const app = express();
// Only explicitly configured proxy addresses may supply the client IP.
app.set('trust proxy', process.env.TRUSTED_PROXIES
    ? process.env.TRUSTED_PROXIES.split(',').map(value => value.trim()).filter(Boolean)
    : false);
app.use(useragent.express());
// adding Helmet to enhance your Rest API's security
app.use(helmet());
// using bodyParser to parse JSON bodies into JS objects
app.use(bodyParser.json());
// enabling CORS for all requests
app.use(cors());

app.use('/api/', apiLimiter);

registerBitmapRoutes(app);
registerTelemetryRoutes(app);
registerStatisticsRoutes(app);
registerReleaseRoutes(app);
const telegramNotifications = registerModerationRoutes(app, moderationRepo, cache);

app.use((error, req, res, next) => {
    if (req.path.toLowerCase().replace(/\/+$/, '') === '/api/telegram/webhook') {
        // Parser errors may contain the incoming body, including one-time linking codes.
        log.error('TelegramWebhook: request failed; details suppressed.', { sourceIP: tools.getIPFromRequest(req) });
    } else {
        log.error('Request failed: {error}', { error, sourceIP: tools.getIPFromRequest(req) });
    }
    if (res.headersSent) {
        return next(error);
    }
    const messages = {
        400: 'Not valid body',
        413: 'Not valid body',
        502: 'Upstream service unavailable',
        504: 'Upstream service timed out',
    };
    const status = Object.hasOwn(messages, error.status) ? error.status : 500;
    res.status(status).send(messages[status] || 'Internal server error');
});

if (require.main === module) {
    startServer(app, port, migrate)
        .then(() => {
            log.info('API listening on port {port}', { port });
            return telegramNotifications.start();
        })
        .catch(() => {
            // Never include connection configuration or credentials in startup logs.
            log.error('API startup failed. Check database availability, migration files and CREATE/SELECT/INSERT permissions.');
            process.exit(1);
        });
}

module.exports = app;
