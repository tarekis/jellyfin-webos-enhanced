const http = require('http');
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const AUTH = 'MediaBrowser Token="tok123"';

const SEARCH_RESULTS = {
    results: [
        { id: 1, mediaType: 'person', name: 'Some Person' },
        { id: 101, mediaType: 'movie', title: 'Dune', releaseDate: '2021-09-15', overview: 'Sand.' },
        { id: 202, mediaType: 'tv', name: 'Dune: Prophecy', firstAirDate: '2024-11-17' },
        { id: 303, mediaType: 'movie', title: 'Dune Part Two', releaseDate: '2024-02-27', mediaInfo: { status: 5 } }
    ]
};

let server;
let baseUrl;
let searches;
let requests;
let requestMode;

function serveFile(res, file, type) {
    fs.readFile(file, function (err, buf) {
        if (err) {
            res.writeHead(404);
            res.end();
            return;
        }
        res.writeHead(200, { 'Content-Type': type });
        res.end(buf);
    });
}

test.beforeAll(async () => {
    server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/') {
            serveFile(res, path.join(__dirname, 'fixture.html'), 'text/html');
        } else if (url.pathname === '/frontend/js/seerr.js') {
            serveFile(res, path.join(ROOT, 'frontend/js/seerr.js'), 'application/javascript');
        } else if (url.pathname === '/frontend/css/seerr.css') {
            serveFile(res, path.join(ROOT, 'frontend/css/seerr.css'), 'text/css');
        } else if (url.pathname === '/JellyfinEnhanced/jellyseerr/search') {
            searches.push({ query: url.searchParams.get('query'), auth: req.headers.authorization });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(SEARCH_RESULTS));
        } else if (url.pathname === '/JellyfinEnhanced/jellyseerr/request' && req.method === 'POST') {
            let raw = '';
            req.on('data', (c) => { raw += c; });
            req.on('end', () => {
                requests.push({ method: req.method, auth: req.headers.authorization, body: JSON.parse(raw) });
                if (requestMode === 'forbidden') {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: 'no permission' }));
                } else {
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end('{}');
                }
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = 'http://127.0.0.1:' + server.address().port;
});

test.afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(async ({ page }) => {
    searches = [];
    requests = [];
    requestMode = 'ok';
    // Offline: only the local mock server may be reached
    await page.route('**/*', (route) => {
        const u = route.request().url();
        if (u.indexOf(baseUrl) === 0) {
            return route.continue();
        }
        return route.abort();
    });
    await page.goto(baseUrl + '/');
});

async function pressKey(page, keyCode) {
    await page.evaluate((code) => {
        const target = document.activeElement || document.body;
        const evt = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
        Object.defineProperty(evt, 'keyCode', { get: () => code });
        Object.defineProperty(evt, 'which', { get: () => code });
        target.dispatchEvent(evt);
    }, keyCode);
}

async function openOverlayWithDune(page) {
    await page.fill('#searchTextInput', 'dune');
    await expect(page.locator('.seerr-search-banner')).toBeVisible({ timeout: 3000 });
    await pressKey(page, 404);
    await expect(page.locator('#seerr-overlay.seerr-open')).toBeVisible();
    await expect(page.locator('.seerr-card')).toHaveCount(3);
    await expect(page.locator('.seerr-card[data-index="0"]')).toBeFocused();
}

test('1. banner appears after search fields with auth header', async ({ page }) => {
    await page.fill('#searchTextInput', 'dune');
    const banner = page.locator('.seerr-search-banner');
    await expect(banner).toBeVisible({ timeout: 3000 });
    const isNext = await page.evaluate(() =>
        document.querySelector('.searchFields').nextElementSibling ===
        document.querySelector('.seerr-search-banner'));
    expect(isNext).toBe(true);
    expect(searches.length).toBeGreaterThan(0);
    expect(searches[0].query).toBe('dune');
    expect(searches[0].auth).toBe(AUTH);
});

test('2. green key opens overlay prefilled with 3 cards, first focused', async ({ page }) => {
    await page.fill('#searchTextInput', 'dune');
    await pressKey(page, 404);
    await expect(page.locator('#seerr-overlay')).toHaveClass(/seerr-open/);
    await expect(page.locator('.seerr-input')).toHaveValue('dune');
    await expect(page.locator('.seerr-card')).toHaveCount(3);
    await expect(page.locator('.seerr-card[data-index="0"]')).toBeFocused();
});

test('3. arrows move focus between cards and keys do not leak', async ({ page }) => {
    await openOverlayWithDune(page);
    const before = await page.evaluate(() => window.__keyCount);
    await pressKey(page, 39);
    await expect(page.locator('.seerr-card[data-index="1"]')).toBeFocused();
    await pressKey(page, 37);
    await expect(page.locator('.seerr-card[data-index="0"]')).toBeFocused();
    const after = await page.evaluate(() => window.__keyCount);
    expect(after).toBe(before);
});

test('4. requesting a movie posts, toasts, closes dialog, updates badge', async ({ page }) => {
    await openOverlayWithDune(page);
    await pressKey(page, 13);
    await expect(page.locator('.seerr-dialog')).toHaveClass(/seerr-dialog-open/);
    await expect(page.locator('.seerr-button-primary')).toBeFocused();
    await pressKey(page, 13);
    await expect(page.locator('#seerr-toast')).toHaveClass(/seerr-toast-show/);
    await expect(page.locator('.seerr-dialog')).not.toHaveClass(/seerr-dialog-open/);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].auth).toBe(AUTH);
    expect(requests[0].body).toEqual({ mediaType: 'movie', mediaId: 101 });
    await expect(page.locator('.seerr-card[data-index="0"] .seerr-badge')).toHaveText('Requested');
});

test('5. tv request includes seasons all', async ({ page }) => {
    await openOverlayWithDune(page);
    await pressKey(page, 39);
    await pressKey(page, 13);
    await expect(page.locator('.seerr-dialog')).toHaveClass(/seerr-dialog-open/);
    await pressKey(page, 13);
    await expect(page.locator('#seerr-toast')).toHaveClass(/seerr-toast-show/);
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({ mediaType: 'tv', mediaId: 202, seasons: 'all' });
});

test('6. available item has no visible Request button', async ({ page }) => {
    await openOverlayWithDune(page);
    await pressKey(page, 39);
    await pressKey(page, 39);
    await expect(page.locator('.seerr-card[data-index="2"]')).toBeFocused();
    await pressKey(page, 13);
    await expect(page.locator('.seerr-dialog')).toHaveClass(/seerr-dialog-open/);
    await expect(page.locator('.seerr-button-primary')).toBeHidden();
    expect(requests).toHaveLength(0);
});

test('7. back closes dialog first, then overlay', async ({ page }) => {
    await openOverlayWithDune(page);
    await pressKey(page, 13);
    await expect(page.locator('.seerr-dialog')).toHaveClass(/seerr-dialog-open/);
    await pressKey(page, 461);
    await expect(page.locator('.seerr-dialog')).not.toHaveClass(/seerr-dialog-open/);
    await expect(page.locator('#seerr-overlay')).toHaveClass(/seerr-open/);
    await pressKey(page, 461);
    await expect(page.locator('#seerr-overlay')).not.toHaveClass(/seerr-open/);
    const inside = await page.evaluate(() =>
        document.getElementById('seerr-overlay').contains(document.activeElement));
    expect(inside).toBe(false);
});

test('8. request error shows error toast with server message', async ({ page }) => {
    requestMode = 'forbidden';
    await openOverlayWithDune(page);
    await pressKey(page, 13);
    await expect(page.locator('.seerr-dialog')).toHaveClass(/seerr-dialog-open/);
    await pressKey(page, 13);
    const toast = page.locator('#seerr-toast');
    await expect(toast).toHaveClass(/seerr-toast-error/);
    await expect(toast).toContainText('no permission');
});
