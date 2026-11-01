'use strict';

const getElement = (id) => document.getElementById(id);
const statusLabels = {
    pending: 'Offen',
    approved: 'Ausgeblendet',
    rejected: 'Abgelehnt',
};
let reports = [];
let beforeReportId;
let statusFilter = 'all';
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
            401: 'Bitte melde dich an. Deine Sitzung ist möglicherweise abgelaufen.',
            403: 'Die Anfrage wurde nicht zugelassen. Bitte öffne die konfigurierte HTTPS-Adresse.',
            409: 'Diese Meldung wurde bereits bearbeitet. Bitte aktualisiere die Ansicht.',
            429: 'Zu viele Anfragen. Bitte versuche es später erneut.',
            503: 'Die Administration ist noch nicht eingerichtet.',
        };
        throw new Error(texts[response.status] || 'Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.');
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
        : new Intl.DateTimeFormat('de-DE', {
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
        throw new Error('Vorschau nicht verfügbar.');
    }
    const pixels = JSON.parse(icon.pixels.slice(0, icon.pixels.indexOf(']') + 1));
    if (
        !Array.isArray(pixels) ||
        pixels.length !== icon.sizeX * icon.sizeY ||
        pixels.some((value) => !Number.isInteger(value) || value < 0 || value > 65535)
    ) {
        throw new Error('Vorschau nicht verfügbar.');
    }
    const canvasElement = document.createElement('canvas');
    canvasElement.width = icon.sizeX;
    canvasElement.height = icon.sizeY;
    canvasElement.setAttribute('role', 'img');
    canvasElement.setAttribute('aria-label', 'Icon-Vorschau, erstes Bild');
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
            'Icon ausblenden?',
            '„' +
                (report.name || 'Icon #' + report.icon_id) +
                '“ wird aus der öffentlichen Gallery entfernt. Du kannst es später wiederherstellen.',
            'Ausblenden',
        ],
        reject: [
            'Meldung ablehnen?',
            'Das Icon bleibt in der Gallery sichtbar. Die Meldung wird als abgelehnt abgeschlossen.',
            'Meldung ablehnen',
        ],
        restore: [
            'Icon wiederherstellen?',
            'Das Icon wird wieder in der öffentlichen Gallery sichtbar.',
            'Wiederherstellen',
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
                ? 'Icon ausgeblendet. Du kannst es im Filter „Ausgeblendet“ wiederherstellen.'
                : action === 'restore'
                ? 'Icon wiederhergestellt.'
                : 'Meldung abgelehnt.'
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
    button.setAttribute('aria-label', 'Große Vorschau für ' + (report.name || report.icon_id));
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
            preview.textContent = 'Keine Vorschau';
        }
    } else {
        const button = createElement('button', '', '▦ Vorschau');
        button.setAttribute('aria-label', 'Vorschau für ' + (report.name || report.icon_id));
        button.onclick = async () => {
            button.disabled = true;
            button.textContent = 'Lädt …';
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
                button.textContent = 'Erneut laden';
                showMessage(error.message, true);
            }
        };
        preview.append(button);
    }
    article.append(preview);
    const body = createElement('div', 'report-body');
    body.append(
        createElement('h3', '', report.name || 'Icon nicht vorhanden'),
        createElement('p', 'report-id', 'ICON #' + report.icon_id + '  /  MELDUNG #' + report.id),
        createElement('p', 'reason', report.reason)
    );
    const bottom = createElement('div', 'report-bottom');
    bottom.append(createElement('span', '', 'Eingegangen · ' + formatDate(report.created_at)));
    body.append(bottom);
    const details = createElement('details', 'report-details');
    details.append(createElement('summary', '', 'Details anzeigen'));
    details.append(
        createElement(
            'p',
            '',
            'Bearbeitet: ' +
                formatDate(report.processed_at) +
                '\nIcon-ID: ' +
                report.icon_id +
                ' · Meldungs-ID: ' +
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
                  ['reject', 'Ablehnen', 'secondary'],
                  ['approve', 'Ausblenden', 'danger'],
              ]
            : report.status === 'approved'
            ? [['restore', 'Wiederherstellen', 'secondary']]
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
    const search = getElement('search').value.trim().toLocaleLowerCase('de');
    const selected = reports
        .filter(
            (report) =>
                (statusFilter === 'all' || report.status === statusFilter) &&
                [report.name, report.icon_id, report.reason, report.id].some((value) =>
                    String(value ?? '')
                        .toLocaleLowerCase('de')
                        .includes(search)
                )
        )
        .sort((leftReport, rightReport) =>
            getElement('sort').value === 'old' ? leftReport.id - rightReport.id : rightReport.id - leftReport.id
        );
    getElement('reports').replaceChildren(...selected.map(createReportCard));
    getElement('empty').hidden = selected.length > 0;
    getElement('result-count').textContent = selected.length + ' ' + (selected.length === 1 ? 'Meldung' : 'Meldungen');
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
        showMessage('Du bist abgemeldet.');
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
    getElement('statistics-updated').textContent = 'Noch nicht geladen';
}

function renderDistribution(id, entries, total) {
    const container = getElement(id);
    container.replaceChildren();
    if (!entries.length) {
        container.append(createElement('p', 'distribution-empty', 'Keine Telemetriedaten in diesem Zeitraum.'));
        return;
    }
    const formatter = new Intl.NumberFormat('de-DE');
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
        meter.setAttribute('aria-label', entry.label + ': ' + formatter.format(count) + ' Geräte');
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
    getElement('statistics-message').textContent = 'Statistik wird geladen …';
    getElement('statistics-message').hidden = false;
    getElement('statistics-view').setAttribute('aria-busy', 'true');
    getElement('refresh').disabled = true;
    try {
        const statistics = await requestAdmin('statistics');
        if (generation !== sessionGeneration) {
            return;
        }
        const formatter = new Intl.NumberFormat('de-DE');
        getElement('telemetry-24h').textContent = formatter.format(statistics.active24h);
        getElement('telemetry-7d').textContent = formatter.format(statistics.active7d);
        getElement('telemetry-30d').textContent = formatter.format(statistics.active30d);
        getElement('telemetry-total').textContent = formatter.format(statistics.total);
        renderDistribution('telemetry-versions', statistics.versions, statistics.active30d);
        renderDistribution('telemetry-hardware', statistics.hardware, statistics.active30d);
        renderDistribution('telemetry-matrices', statistics.matrices, statistics.active30d);
        getElement('statistics-updated').textContent =
            'Stand: ' +
            formatDate(statistics.generatedAt) +
            ' · Letzte Gerätemeldung: ' +
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
    getElement('moderation-view').hidden = statisticsVisible;
    getElement('statistics-view').hidden = !statisticsVisible;
    getElement('reports-tab').setAttribute('aria-pressed', String(!statisticsVisible));
    getElement('statistics-tab').setAttribute('aria-pressed', String(statisticsVisible));
    getElement('page-title').textContent = statisticsVisible ? 'Statistik' : 'Icon-Meldungen';
    getElement('page-subtitle').textContent = statisticsVisible
        ? 'Telemetrie und Geräteverteilung im Überblick.'
        : 'Meldungen prüfen und Icons verwalten.';
}

// Bind page controls after all handlers have been defined.
getElement('logout').onclick = logout;
getElement('statistics-logout').onclick = logout;
getElement('refresh').onclick = () => (currentView === 'statistics' ? loadStatistics() : loadReports());
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

loadReports();
