'use strict';

const getElement = (id) => document.getElementById(id);
const statusLabels = {
    pending: 'Pending',
    approved: 'Hidden',
    blocked: 'Blocked',
    rejected: 'Rejected',
};
let reports = [];
let reportCounts = {};
let beforeReportId;
let statusFilter = 'pending';
let isLoading = false;
let isSaving = false;
let currentView = 'reports';
let statisticsLoading = false;
let sessionGeneration = 0;
const iconPreviews = new Map();
const previewRequests = new Map();
const queuedPreviews = new Map();
let loadingPreviews = false;

async function loadQueuedPreviews() {
    if (loadingPreviews) {
        return;
    }
    loadingPreviews = true;
    while (queuedPreviews.size) {
        const batch = [...queuedPreviews.entries()].slice(0, 8);
        const ids = batch.map(([id]) => id);
        for (const id of ids) {
            queuedPreviews.delete(id);
        }
        try {
            const icons = await requestAdmin('icons?ids=' + ids.join(','));
            const byId = new Map(icons.map((icon) => [String(icon.id), icon]));
            for (const [id, { resolve }] of batch) {
                const icon = byId.get(String(id)) ?? null;
                if (iconPreviews.size >= 50) {
                    iconPreviews.delete(iconPreviews.keys().next().value);
                }
                iconPreviews.set(id, icon);
                resolve(icon);
            }
        } catch (error) {
            for (const [, { reject }] of batch) {
                reject(error);
            }
        }
    }
    loadingPreviews = false;
}

function loadIconPreview(id) {
    if (!previewRequests.has(id)) {
        const request = new Promise((resolve, reject) => {
            queuedPreviews.set(id, { resolve, reject });
        });
        previewRequests.set(id, request.finally(() => previewRequests.delete(id)));
        queueMicrotask(loadQueuedPreviews);
    }
    return previewRequests.get(id);
}
const previewObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (entry.isIntersecting && entry.target.isConnected) {
            previewObserver.unobserve(entry.target);
            entry.target.click();
        }
    }
});
const animationDrawers = new WeakMap();
const visibleAnimations = new Set();
const animationObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (entry.isIntersecting && entry.target.isConnected) {
            visibleAnimations.add(entry.target);
        } else {
            visibleAnimations.delete(entry.target);
        }
    }
});
setInterval(() => {
    if (document.hidden) {
        return;
    }
    const dialog = getElement('preview-dialog');
    for (const canvas of visibleAnimations) {
        if (!dialog.open || dialog.contains(canvas)) {
            animationDrawers.get(canvas)();
        }
    }
}, 250);

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
    const source = icon.pixels.trim().replace(/,$/, '');
    const frames = JSON.parse('[' + source + ']');
    if (
        !frames.length ||
        frames.some((pixels) =>
            !Array.isArray(pixels) ||
            pixels.length !== icon.sizeX * icon.sizeY ||
            pixels.some((value) => !Number.isInteger(value) || value < 0 || value > 65535)
        )
    ) {
        throw new Error('Preview unavailable.');
    }
    const canvasElement = document.createElement('canvas');
    canvasElement.width = icon.sizeX;
    canvasElement.height = icon.sizeY;
    canvasElement.setAttribute('role', 'img');
    canvasElement.setAttribute('aria-label', 'Icon preview');
    const context = canvasElement.getContext('2d');
    const image = context.createImageData(canvasElement.width, canvasElement.height);
    let frameIndex = 0;
    function drawFrame() {
        frames[frameIndex].forEach((value, index) => {
            image.data[index * 4] = Math.round((((value >> 11) & 31) * 255) / 31);
            image.data[index * 4 + 1] = Math.round((((value >> 5) & 63) * 255) / 63);
            image.data[index * 4 + 2] = Math.round(((value & 31) * 255) / 31);
            image.data[index * 4 + 3] = 255;
        });
        context.putImageData(image, 0, 0);
        frameIndex = (frameIndex + 1) % frames.length;
    }
    drawFrame();
    if (icon.animated && frames.length > 1) {
        animationDrawers.set(canvasElement, drawFrame);
        animationObserver.observe(canvasElement);
    }
    return canvasElement;
}

function stopPreviewAnimations(container) {
    for (const canvas of container.querySelectorAll('canvas')) {
        animationObserver.unobserve(canvas);
        visibleAnimations.delete(canvas);
    }
}

getElement('preview-dialog').addEventListener('close', () => {
    const preview = getElement('large-preview');
    stopPreviewAnimations(preview);
    preview.replaceChildren();
});

function confirmAction(report, action) {
    const options = {
        approve: [
            'Hide this icon?',
            '“' +
                (report.name || 'Icon #' + report.icon_id) +
                '” will be hidden from the public gallery. You can restore it later.',
            'Hide',
        ],
        block: [
            'Block this icon?',
            'The icon will become unavailable through the public API.',
            'Block',
        ],
        unblock: [
            'Unblock this icon?',
            'Direct access will be restored. The icon will stay hidden from the gallery.',
            'Unblock',
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
    return confirmDialog(...options[action]);
}

function confirmDialog(title, text, label) {
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
        const decisions = {
            approve: ['approved', 'Icon hidden from the gallery.'],
            reject: ['rejected', 'Report rejected.'],
            restore: ['rejected', 'Icon restored to the gallery.'],
            block: ['blocked', 'Icon blocked from the public API.'],
            unblock: ['approved', 'Icon unblocked. It is still hidden from the gallery.'],
        };
        const [status, message] = decisions[action];
        reportCounts[report.status]--;
        reportCounts[status]++;
        report.status = status;
        report.processed_at = new Date().toISOString();
        showMessage(message);
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
    } else if (!report.name) {
        preview.textContent = 'No preview';
    } else {
        const button = createElement('button', 'preview-load', 'Load preview');
        button.onclick = async () => {
            previewObserver.unobserve(button);
            button.disabled = true;
            button.textContent = 'Loading…';
            try {
                const icon = await loadIconPreview(report.icon_id);
                if (preview.isConnected) {
                    if (icon) {
                        preview.replaceChildren(createPreviewButton(icon, report));
                    } else {
                        preview.textContent = 'No preview';
                    }
                }
            } catch (error) {
                button.disabled = false;
                button.textContent = 'Retry preview';
                button.title = error.message;
            }
        };
        preview.append(button);
        previewObserver.observe(button);
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
                  ['approve', 'Hide', 'secondary'],
                  ['block', 'Block', 'danger'],
              ]
            : report.status === 'approved'
            ? [['restore', 'Restore', 'secondary'], ['block', 'Block', 'danger']]
            : report.status === 'blocked'
            ? [['unblock', 'Unblock', 'secondary']]
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
    for (const status of ['all', 'pending', 'approved', 'blocked', 'rejected']) {
        getElement('count-' + status).textContent = reportCounts[status] ?? 0;
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
    previewObserver.disconnect();
    const container = getElement('reports');
    stopPreviewAnimations(container);
    container.replaceChildren(...selected.map(createReportCard));
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
        const cursor = !reset && beforeReportId ? '&before=' + beforeReportId : '';
        const { reports: result, counts } = await requestAdmin('reports?includeCounts=1' + cursor);
        reportCounts = counts;
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

let iconDownloadRequest = 0;

function renderDownloadTrend(daily, peak, formatter) {
    const chart = getElement('icon-download-chart');
    const currentValue = getElement('icon-download-chart-value');
    let selectedBar;

    function selectDay(bar, label, count) {
        selectedBar?.setAttribute('aria-pressed', 'false');
        bar.setAttribute('aria-pressed', 'true');
        selectedBar = bar;
        const formattedCount = formatter.format(count);
        currentValue.textContent = label + ' · ' + formattedCount + (count === 1 ? ' download' : ' downloads');
    }

    const columns = daily.toReversed().map(({ label, count }) => {
        const column = createElement('button', 'icon-trend-column');
        column.type = 'button';
        column.setAttribute('aria-label', label + ' · ' + formatter.format(count));
        column.setAttribute('aria-pressed', 'false');
        const bar = createElement('span', 'icon-trend-bar');
        bar.style.height = (peak ? count * 100 / peak : 0) + '%';
        column.append(bar);
        column.onclick = () => selectDay(column, label, count);
        return column;
    });
    chart.replaceChildren(...columns);
    getElement('icon-download-start').textContent = daily.at(-1).label;
    getElement('icon-download-end').textContent = daily[0].label;
    selectDay(columns.at(-1), daily[0].label, daily[0].count);
}

function renderDownloadCounts(containerId, rows) {
    const container = getElement(containerId);
    if (!rows.length) {
        container.replaceChildren(createElement('p', '', 'No downloads recorded.'));
        return;
    }
    const formatter = new Intl.NumberFormat('en-GB');
    const maxCount = Math.max(...rows.map(({ count }) => count));
    container.replaceChildren(...rows.map(({ label, count }) => {
        const row = createElement('div', 'distribution-row');
        const heading = createElement('div', 'distribution-heading');
        heading.append(createElement('span', '', label), createElement('strong', '', formatter.format(count)));
        const meter = createElement('meter');
        meter.max = maxCount || 1;
        meter.value = count;
        meter.setAttribute('aria-label', label + ' · ' + formatter.format(count) + ' downloads');
        row.append(heading, meter);
        return row;
    }));
}

async function loadIconDownloads() {
    const request = ++iconDownloadRequest;
    const days = getElement('icon-download-days').value;
    const message = getElement('icon-download-message');
    const results = getElement('icon-download-results');
    message.textContent = 'Loading icon downloads…';
    message.hidden = false;
    results.hidden = true;
    try {
        const data = await requestAdmin('statistics/icons?days=' + days);
        if (request !== iconDownloadRequest) {
            return;
        }
        const counts = new Map(data.daily.map(({ day, count }) => [day, count]));
        const today = new Date(data.through + 'T00:00:00Z');
        const daily = Array.from({ length: data.days }, (_, index) => {
            const date = new Date(today);
            date.setUTCDate(date.getUTCDate() - index);
            const day = date.toISOString().slice(0, 10);
            return { label: day, count: counts.get(day) ?? 0 };
        });
        const total = daily.reduce((sum, { count }) => sum + count, 0);
        const peak = daily.reduce((best, day) => day.count > best.count ? day : best);
        const formatter = new Intl.NumberFormat('en-GB');
        getElement('icon-download-total').textContent = formatter.format(total);
        getElement('icon-download-today').textContent = formatter.format(daily[0].count);
        getElement('icon-download-peak').textContent = formatter.format(peak.count);
        getElement('icon-download-peak-date').textContent = peak.count ? peak.label : '';
        renderDownloadTrend(daily, peak.count, formatter);
        renderDownloadCounts('icon-download-daily', daily);
        renderDownloadCounts('icon-download-top', data.top.map(({ iconId, name, count }, index) => ({
            label: (index + 1) + '. ' + (name ? name + ' · #' + iconId : '#' + iconId),
            count,
        })));
        results.hidden = false;
        message.hidden = true;
    } catch (error) {
        if (request === iconDownloadRequest) {
            message.textContent = error.message;
        }
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
    getElement('backup-view').hidden = view !== 'backup';
    getElement('backup-tab').setAttribute('aria-pressed', String(view === 'backup'));
    getElement('refresh').hidden = view === 'backup';
    getElement('notifications-tab').setAttribute('aria-pressed', String(view === 'notifications'));
    getElement('moderators-tab').setAttribute('aria-pressed', String(view === 'moderators'));
    getElement('statistics-view').hidden = !statisticsVisible;
    getElement('reports-tab').setAttribute('aria-pressed', String(view === 'reports'));
    getElement('statistics-tab').setAttribute('aria-pressed', String(statisticsVisible));
    const titles = {
        backup: ['Backup & Restore', 'Export or restore the API database.'],
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
        statistics: () => {
            loadStatistics();
            loadIconDownloads();
        },
        reports: loadReports,
    };
    loaders[currentView]?.();
};
getElement('reports-tab').onclick = () => showView('reports');
getElement('statistics-tab').onclick = () => {
    showView('statistics');
    loadStatistics();
    loadIconDownloads();
};
getElement('icon-download-days').onchange = loadIconDownloads;
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
        : 'Icon visibility changes and rejected reports. Up to 50 entries per page.';
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
            block: 'Icon blocked',
            unblock: 'Icon unblocked',
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

getElement('backup-tab').onclick = () => {
    showMessage('');
    showView('backup');
};
getElement('backup-logout').onclick = logout;

function setBackupBusy(busy) {
    getElement('backup-download').toggleAttribute('inert', busy);
    getElement('backup-restore').disabled = busy;
    getElement('backup-file').disabled = busy;
}

async function uploadBackup(file) {
    const response = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-PixelIt-Confirm-Restore': 'replace',
        },
        body: file,
    });
    if (response.status === 401) {
        showLogin();
    }
    if (!response.ok) {
        throw new Error(await response.text());
    }
}

getElement('backup-restore-form').onsubmit = async (event) => {
    event.preventDefault();
    const input = getElement('backup-file');
    const file = input.files[0];
    if (!file || !await confirmDialog(
        'Replace the API database?',
        'Restore “' + file.name + '” and replace the current API database contents.',
        'Restore database'
    )) {
        return;
    }
    setBackupBusy(true);
    showMessage('Restoring the backup…');
    try {
        await uploadBackup(file);
        input.value = '';
        iconPreviews.clear();
        await loadReports();
        showMessage('Database restored.');
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        setBackupBusy(false);
    }
};

async function initializeDashboard() {
    try {
        const identity = await requestAdmin('me');
        getElement('notifications-tab').hidden = !identity.id;
        getElement('admin-audit-tab').hidden = identity.role !== 'admin';
        getElement('backup-tab').hidden = identity.role !== 'admin';
        getElement('identity').textContent = identity.login + ' · ' + (identity.role === 'admin' ? 'Admin' : 'Moderator');
        document.querySelector('.sidebar-footer .avatar').textContent = identity.login.slice(0, 1).toUpperCase();
        getElement('moderators-tab').hidden = identity.role !== 'admin' || !identity.id;
        await loadReports();
    } catch (error) {
        showMessage(error.message, true);
    }
}

initializeDashboard();
