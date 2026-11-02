'use strict';

const getElement = (id) => document.getElementById(id);
const statusLabels = {
    pending: 'Pending',
    approved: 'Hidden',
    rejected: 'Rejected',
};
let reports = [];
let beforeReportId;
let statusFilter = 'pending';
let isLoading = false;
let isSaving = false;
let currentView = 'reports';
let statisticsLoading = false;
let sessionGeneration = 0;
const iconPreviews = new Map();

function showMessage(text, error = false) {
    getElement('message').textContent = text;
    getElement('message').hidden = !text;
    getElement('message').classList.toggle('error', error);
}

function showLogin() {
    sessionGeneration++;
    window.location.replace('/admin/');
}

async function requestAdmin(path, body) {
    const response = await fetch('/api/admin/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        ...(body === undefined
            ? {}
            : {
                  body: JSON.stringify(body),
              }),
    });
    if (!response.ok) {
        if (response.status === 401) {
            showLogin();
        }
        const texts = {
            400: 'Invalid input. Please check the GitHub username or request.',
            404: 'GitHub account not found.',
            401: 'Please sign in. Your session may have expired.',
            403: 'You do not have permission for this action, or the request origin is not allowed.',
            409: path.startsWith('moderators')
                ? 'You can add up to 100 moderators.'
                : 'This report has already been processed. Please refresh the page.',
            429: 'Too many requests. Please try again later.',
            503: 'The service is temporarily unavailable. Please try again later.',
        };
        throw new Error(texts[response.status] || 'The request failed. Please try again.');
    }
    return response.status === 204 ? null : response.json();
}

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

function formatDate(value) {
    if (!value) {
        return '–';
    }
    const parsedDate = new Date(value);
    return Number.isNaN(parsedDate.valueOf())
        ? String(value)
        : new Intl.DateTimeFormat('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
          }).format(parsedDate);
}

function createIconCanvas(icon) {
    if (
        !Number.isInteger(icon.sizeX) ||
        !Number.isInteger(icon.sizeY) ||
        icon.sizeX < 1 ||
        icon.sizeY < 1 ||
        icon.sizeX > 256 ||
        icon.sizeY > 256 ||
        typeof icon.pixels !== 'string'
    ) {
        throw new Error('Preview unavailable.');
    }
    const pixels = JSON.parse(icon.pixels.slice(0, icon.pixels.indexOf(']') + 1));
    if (
        !Array.isArray(pixels) ||
        pixels.length !== icon.sizeX * icon.sizeY ||
        pixels.some((value) => !Number.isInteger(value) || value < 0 || value > 65535)
    ) {
        throw new Error('Preview unavailable.');
    }
    const canvasElement = document.createElement('canvas');
    canvasElement.width = icon.sizeX;
    canvasElement.height = icon.sizeY;
    canvasElement.setAttribute('role', 'img');
    canvasElement.setAttribute('aria-label', 'Icon preview, first frame');
    const context = canvasElement.getContext('2d');
    const image = context.createImageData(canvasElement.width, canvasElement.height);
    pixels.forEach((value, i) => {
        image.data[i * 4] = Math.round((((value >> 11) & 31) * 255) / 31);
        image.data[i * 4 + 1] = Math.round((((value >> 5) & 63) * 255) / 63);
        image.data[i * 4 + 2] = Math.round(((value & 31) * 255) / 31);
        image.data[i * 4 + 3] = 255;
    });
    context.putImageData(image, 0, 0);
    return canvasElement;
}

function confirmAction(report, action) {
    const options = {
        approve: [
            'Hide this icon?',
            '“' +
                (report.name || 'Icon #' + report.icon_id) +
                '” will be hidden from the public gallery. You can restore it later.',
            'Hide',
        ],
        reject: [
            'Reject this report?',
            'The icon will remain visible in the gallery. The report will be marked as rejected.',
            'Reject report',
        ],
        restore: [
            'Restore this icon?',
            'The icon will be visible in the public gallery again.',
            'Restore',
        ],
    };
    const [title, text, label] = options[action];
    getElement('confirm-title').textContent = title;
    getElement('confirm-text').textContent = text;
    getElement('confirm-action').textContent = label;
    const dialog = getElement('confirm-dialog');
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) =>
        dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {
            once: true,
        })
    );
}

async function submitDecision(report, action) {
    if (isSaving || !(await confirmAction(report, action)) || isSaving) {
        return;
    }
    isSaving = true;
    renderReports();
    try {
        await requestAdmin('reports/' + report.id + '/' + action, {});
        report.status = action === 'approve' ? 'approved' : 'rejected';
        report.processed_at = new Date().toISOString();
        showMessage(
            action === 'approve'
                ? 'Icon hidden. You can restore it using the Hidden filter.'
                : action === 'restore'
                ? 'Icon restored.'
                : 'Report rejected.'
        );
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        isSaving = false;
        renderReports();
    }
}

function createPreviewButton(icon, report) {
    const button = createElement('button', 'preview-open');
    button.setAttribute('aria-label', 'Large preview for ' + (report.name || report.icon_id));
    button.append(createIconCanvas(icon));
    button.onclick = () => {
        getElement('preview-title').textContent = (report.name || 'Icon') + ' · #' + report.icon_id;
        getElement('large-preview').replaceChildren(createIconCanvas(icon));
        getElement('preview-dialog').showModal();
    };
    return button;
}

function createReportCard(report) {
    const article = createElement('article', 'report');
    const preview = createElement('div', 'preview');
    if (iconPreviews.has(report.icon_id)) {
        try {
            preview.append(createPreviewButton(iconPreviews.get(report.icon_id), report));
        } catch {
            preview.textContent = 'No preview';
        }
    } else {
        const button = createElement('button', '', '▦ Preview');
        button.setAttribute('aria-label', 'Preview for ' + (report.name || report.icon_id));
        button.onclick = async () => {
            button.disabled = true;
            button.textContent = 'Loading…';
            try {
                const icon = await requestAdmin('icons/' + report.icon_id);
                const drawing = createPreviewButton(icon, report);
                if (iconPreviews.size >= 200) {
                    iconPreviews.delete(iconPreviews.keys().next().value);
                }
                iconPreviews.set(report.icon_id, icon);
                preview.replaceChildren(drawing);
            } catch (error) {
                button.disabled = false;
                button.textContent = 'Try again';
                showMessage(error.message, true);
            }
        };
        preview.append(button);
    }
    article.append(preview);
    const body = createElement('div', 'report-body');
    body.append(
        createElement('h3', '', report.name || 'Icon unavailable'),
        createElement('p', 'report-id', 'ICON #' + report.icon_id + '  /  REPORT #' + report.id),
        createElement('p', 'reason', report.reason)
    );
    const bottom = createElement('div', 'report-bottom');
    bottom.append(createElement('span', '', 'Received · ' + formatDate(report.created_at)));
    body.append(bottom);
    const details = createElement('details', 'report-details');
    details.append(createElement('summary', '', 'Show details'));
    details.append(
        createElement(
            'p',
            '',
            'Processed: ' +
                formatDate(report.processed_at) +
                '\nIcon ID: ' +
                report.icon_id +
                ' · Report ID: ' +
                report.id
        )
    );
    body.append(details);
    article.append(body);
    const right = createElement('div', 'report-right');
    const badge = createElement('span', 'badge ' + report.status);
    badge.append(
        createElement('i', 'dot ' + report.status),
        document.createTextNode(statusLabels[report.status] || report.status)
    );
    right.append(badge);
    const actions = createElement('div', 'actions');
    const available =
        report.status === 'pending'
            ? [
                  ['reject', 'Reject', 'secondary'],
                  ['approve', 'Hide', 'danger'],
              ]
            : report.status === 'approved'
            ? [['restore', 'Restore', 'secondary']]
            : [];
    for (const [action, label, style] of available) {
        const button = createElement('button', style, label);
        button.disabled = isSaving;
        button.onclick = () => submitDecision(report, action);
        actions.append(button);
    }
    right.append(actions);
    article.append(right);
    return article;
}

function renderReports() {
    for (const status of ['all', 'pending', 'approved', 'rejected']) {
        getElement('count-' + status).textContent =
            status === 'all' ? reports.length : reports.filter((report) => report.status === status).length;
    }
    const search = getElement('search').value.trim().toLocaleLowerCase('en');
    const selected = reports
        .filter(
            (report) =>
                (statusFilter === 'all' || report.status === statusFilter) &&
                [report.name, report.icon_id, report.reason, report.id].some((value) =>
                    String(value ?? '')
                        .toLocaleLowerCase('en')
                        .includes(search)
                )
        )
        .sort((leftReport, rightReport) =>
            getElement('sort').value === 'old' ? leftReport.id - rightReport.id : rightReport.id - leftReport.id
        );
    getElement('reports').replaceChildren(...selected.map(createReportCard));
    getElement('empty').hidden = selected.length > 0;
    getElement('result-count').textContent = selected.length + ' ' + (selected.length === 1 ? 'Report' : 'Reports');
    for (const button of document.querySelectorAll('[data-filter]')) {
        button.setAttribute('aria-pressed', String(button.dataset.filter === statusFilter));
    }
}

async function loadReports(reset = true) {
    if (isLoading || isSaving) {
        return;
    }
    isLoading = true;
    getElement('refresh').disabled = true;
    getElement('more').disabled = true;
    getElement('reports').setAttribute('aria-busy', 'true');
    try {
        const result = await requestAdmin('reports' + (!reset && beforeReportId ? '?before=' + beforeReportId : ''));
        reports = reset ? result : [...new Map([...reports, ...result].map((report) => [report.id, report])).values()];
        beforeReportId = result.at(-1)?.id;
        getElement('more').hidden = result.length < 50;
        getElement('panel').hidden = false;
        getElement('refresh').hidden = false;
        getElement('reports-tab').disabled = false;
        getElement('statistics-tab').disabled = false;
        showView(currentView);
        showMessage('');
        renderReports();
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        isLoading = false;
        getElement('refresh').disabled = false;
        getElement('more').disabled = false;
        getElement('reports').removeAttribute('aria-busy');
    }
}


async function logout() {
    try {
        await requestAdmin('logout', {});
        showLogin();
        showMessage('You have signed out.');
    } catch (error) {
        showMessage(error.message, true);
    }
}
function clearStatistics() {
    for (const id of ['24h', '7d', '30d', 'total']) {
        getElement('telemetry-' + id).textContent = '–';
    }
    for (const group of ['versions', 'hardware', 'matrices']) {
        getElement('telemetry-' + group).replaceChildren();
    }
    getElement('statistics-updated').textContent = 'Not loaded yet';
}

function renderDistribution(id, entries, total) {
    const container = getElement(id);
    container.replaceChildren();
    if (!entries.length) {
        container.append(createElement('p', 'distribution-empty', 'No telemetry data for this period.'));
        return;
    }
    const formatter = new Intl.NumberFormat('en-GB');
    for (const entry of entries) {
        const row = createElement('div', 'distribution-row');
        const heading = createElement('div', 'distribution-heading');
        const count = Number(entry.count);
        const percentage = total > 0 ? Math.min(100, (count / total) * 100) : 0;
        heading.append(
            createElement('span', '', entry.label),
            createElement('strong', '', formatter.format(count) + ' · ' + Math.round(percentage) + ' %')
        );
        const meter = createElement('meter');
        meter.min = 0;
        meter.max = 100;
        meter.value = percentage;
        meter.setAttribute('aria-label', entry.label + ': ' + formatter.format(count) + ' devices');
        row.append(heading, meter);
        container.append(row);
    }
}

async function loadStatistics() {
    if (statisticsLoading) {
        return;
    }
    statisticsLoading = true;
    const generation = sessionGeneration;
    clearStatistics();
    getElement('statistics-message').textContent = 'Loading statistics…';
    getElement('statistics-message').hidden = false;
    getElement('statistics-view').setAttribute('aria-busy', 'true');
    getElement('refresh').disabled = true;
    try {
        const statistics = await requestAdmin('statistics');
        if (generation !== sessionGeneration) {
            return;
        }
        const formatter = new Intl.NumberFormat('en-GB');
        getElement('telemetry-24h').textContent = formatter.format(statistics.active24h);
        getElement('telemetry-7d').textContent = formatter.format(statistics.active7d);
        getElement('telemetry-30d').textContent = formatter.format(statistics.active30d);
        getElement('telemetry-total').textContent = formatter.format(statistics.total);
        renderDistribution('telemetry-versions', statistics.versions, statistics.active30d);
        renderDistribution('telemetry-hardware', statistics.hardware, statistics.active30d);
        renderDistribution('telemetry-matrices', statistics.matrices, statistics.active30d);
        getElement('statistics-updated').textContent =
            'Updated: ' +
            formatDate(statistics.generatedAt) +
            ' · Last device report: ' +
            formatDate(statistics.lastSeen);
        getElement('statistics-message').hidden = true;
    } catch (error) {
        getElement('statistics-message').textContent = error.message;
    } finally {
        statisticsLoading = false;
        getElement('statistics-view').removeAttribute('aria-busy');
        getElement('refresh').disabled = false;
    }
}

function showView(view) {
    currentView = view;
    const statisticsVisible = view === 'statistics';
    getElement('moderation-view').hidden = view !== 'reports';
    getElement('moderators-view').hidden = view !== 'moderators';
    getElement('audit-view').hidden = !['moderation-audit', 'admin-audit'].includes(view);
    getElement('moderation-audit-tab').setAttribute('aria-pressed', String(view === 'moderation-audit'));
    getElement('admin-audit-tab').setAttribute('aria-pressed', String(view === 'admin-audit'));
    getElement('notifications-view').hidden = view !== 'notifications';
    getElement('notifications-tab').setAttribute('aria-pressed', String(view === 'notifications'));
    getElement('moderators-tab').setAttribute('aria-pressed', String(view === 'moderators'));
    getElement('statistics-view').hidden = !statisticsVisible;
    getElement('reports-tab').setAttribute('aria-pressed', String(view === 'reports'));
    getElement('statistics-tab').setAttribute('aria-pressed', String(statisticsVisible));
    const titles = {
        reports: ['Icon reports', 'Review reports and manage icons.'],
        statistics: ['Statistics', 'An overview of device activity and distributions.'],
        moderators: ['Moderators', 'Add moderators and manage access.'],
        'moderation-audit': ['Moderation log', 'See who reviewed each report.'],
        'admin-audit': ['Admin log', 'Track changes to moderator access.'],
        notifications: ['Notifications', 'Your personal Telegram settings.'],
    };
    getElement('breadcrumb').textContent = titles[view][0];
    getElement('page-title').textContent = titles[view][0];
    getElement('page-subtitle').textContent = titles[view][1];
}

// Bind page controls after all handlers have been defined.
getElement('logout').onclick = logout;
getElement('statistics-logout').onclick = logout;
getElement('refresh').onclick = function refreshCurrentView() {
    const loaders = {
        'moderation-audit': loadAudit,
        'admin-audit': loadAudit,
        notifications: loadTelegramStatus,
        moderators: loadModerators,
        statistics: loadStatistics,
        reports: loadReports,
    };
    loaders[currentView]();
};
getElement('reports-tab').onclick = () => showView('reports');
getElement('statistics-tab').onclick = () => {
    showView('statistics');
    loadStatistics();
};
getElement('more').onclick = () => loadReports(false);
getElement('search').oninput = renderReports;
getElement('sort').onchange = renderReports;
for (const button of document.querySelectorAll('[data-filter]')) {
    button.onclick = () => {
        statusFilter = button.dataset.filter;
        renderReports();
    };
}

async function loadModerators() {
    try {
        const members = await requestAdmin('moderators');
        const rows = members.map((member) => {
            const row = createElement('article', 'member-row');
            const label = member.github_login ? '@' + member.github_login : 'GitHub-ID ' + member.github_id;
            const avatar = createElement('span', 'avatar', (member.github_login || '?').slice(0, 1).toUpperCase());
            const details = createElement('div', 'member-details');
            details.append(createElement('strong', '', label), createElement('small', '', 'Moderator · Gallery management'));
            row.append(avatar, details);
            const button = createElement('button', 'secondary', 'Remove');
            button.onclick = async () => {
                if (!window.confirm('Remove moderator ' + label + ' and revoke their access?')) {
                    return;
                }
                button.disabled = true;
                try {
                    await requestAdmin('moderators', { githubId: member.github_id, enabled: false });
                    await loadModerators();
                } catch (error) {
                    showMessage(error.message, true);
                    button.disabled = false;
                }
            };
            row.append(button);
            return row;
        });
        getElement('moderator-list').replaceChildren(...rows);
        showMessage(members.length ? '' : 'No moderators have been added yet.');
    } catch (error) {
        showMessage(error.message, true);
    }
}

getElement('moderators-logout').onclick = logout;
getElement('moderators-tab').onclick = () => {
    showView('moderators');
    loadModerators();
};
getElement('moderator-form').onsubmit = async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
        await requestAdmin('moderators', { githubLogin: getElement('github-login').value.trim(), enabled: true });
        getElement('github-login').value = '';
        await loadModerators();
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
};

let auditCursor;
let auditKind;
let auditRequestGeneration = 0;

async function loadAudit(reset = true) {
    const kind = currentView === 'admin-audit' ? 'admin' : 'moderation';
    const generation = ++auditRequestGeneration;
    const cursor = !reset && auditKind === kind ? auditCursor : null;
    getElement('audit-heading').textContent = kind === 'admin' ? 'Admin log' : 'Moderation log';
    getElement('audit-description').textContent = kind === 'admin'
        ? 'Moderator additions and removals. Up to 50 entries per page.'
        : 'Icons hidden or restored and reports rejected by moderators and admins. Up to 50 entries per page.';
    getElement('audit-list').replaceChildren(createElement('p', '', 'Loading audit log…'));
    getElement('audit-more').hidden = true;
    try {
        const entries = await requestAdmin('audit/' + kind + (cursor ? '?before=' + cursor : ''));
        if (generation !== auditRequestGeneration || currentView !== kind + '-audit') {
            return;
        }
        auditKind = kind;
        auditCursor = entries.at(-1)?.id;
        const labels = {
            approve: 'Icon hidden',
            reject: 'Report rejected',
            restore: 'Icon restored',
            moderator_added: 'Moderator added',
            moderator_removed: 'Moderator removed',
        };
        const rows = entries.map((entry) => {
            const row = createElement('article', 'audit-entry');
            const actor = entry.actor_login ? '@' + entry.actor_login : entry.actor;
            const target = kind === 'admin'
                ? entry.target_login ? '@' + entry.target_login : 'GitHub-ID ' + entry.target_id
                : 'Report #' + entry.report_id + (entry.icon_id ? ' · Icon #' + entry.icon_id : '');
            row.append(
                createElement('h3', '', labels[entry.action] || entry.action),
                createElement('p', '', actor + ' · ' + target),
                createElement('small', '', formatDate(entry.created_at) + ' · Event #' + entry.id)
            );
            return row;
        });
        getElement('audit-list').replaceChildren(...rows);
        if (!entries.length) {
            getElement('audit-list').append(createElement('p', '', 'No more recorded actions.'));
        }
        getElement('audit-more').hidden = entries.length < 50;
        showMessage('');
    } catch (error) {
        if (generation === auditRequestGeneration && currentView === kind + '-audit') {
            getElement('audit-list').replaceChildren(createElement('p', '', error.message));
        }
    }
}

getElement('audit-logout').onclick = logout;
getElement('audit-more').onclick = () => loadAudit(false);
for (const kind of ['moderation', 'admin']) {
    getElement(kind + '-audit-tab').onclick = () => {
        showView(kind + '-audit');
        loadAudit();
    };
}

async function loadTelegramStatus() {
    const status = getElement('telegram-status');
    getElement('telegram-link').hidden = true;
    getElement('telegram-link').removeAttribute('href');
    getElement('telegram-connect').hidden = true;
    getElement('telegram-disconnect').hidden = true;
    try {
        const result = await requestAdmin('telegram');
        status.dataset.state = result.connected ? 'connected' : result.pending ? 'pending' : 'disconnected';
        if (!result.available) {
            status.textContent = 'Telegram is unavailable on this server. You can still remove existing connections.';
        } else if (result.connected) {
            status.textContent = 'Connected · Notifications are enabled.';
        } else if (result.pending) {
            status.textContent = 'Connection pending. Start the bot using your link or create a new link.';
        } else {
            status.textContent = 'Not connected · Notifications are disabled.';
        }
        getElement('telegram-connect').hidden = !result.available;
        getElement('telegram-connect').textContent = result.connected || result.pending ? 'Create a new connection link' : 'Connect Telegram';
        getElement('telegram-disconnect').hidden = !result.connected && !result.pending;
    } catch (error) {
        status.textContent = error.message;
    }
}

getElement('notifications-logout').onclick = logout;
getElement('notifications-tab').onclick = () => {
    showView('notifications');
    loadTelegramStatus();
};
getElement('telegram-connect').onclick = async () => {
    const button = getElement('telegram-connect');
    button.disabled = true;
    try {
        const result = await requestAdmin('telegram/link', {});
        const link = getElement('telegram-link');
        link.href = result.url;
        link.hidden = false;
        getElement('telegram-disconnect').hidden = false;
        getElement('telegram-status').textContent = 'Open the bot using the link and press Start. Then refresh this page.';
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
};
getElement('telegram-disconnect').onclick = async () => {
    const button = getElement('telegram-disconnect');
    button.disabled = true;
    try {
        await requestAdmin('telegram/disconnect', {});
        await loadTelegramStatus();
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
};

async function initializeDashboard() {
    try {
        const identity = await requestAdmin('me');
        getElement('notifications-tab').hidden = !identity.id;
        getElement('admin-audit-tab').hidden = identity.role !== 'admin';
        getElement('identity').textContent = identity.login + ' · ' + (identity.role === 'admin' ? 'Admin' : 'Moderator');
        document.querySelector('.sidebar-footer .avatar').textContent = identity.login.slice(0, 1).toUpperCase();
        getElement('moderators-tab').hidden = identity.role !== 'admin' || !identity.id;
        await loadReports();
    } catch (error) {
        showMessage(error.message, true);
    }
}

initializeDashboard();
