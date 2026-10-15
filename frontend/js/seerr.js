/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Seerr search and requests for the Jellyfin web UI on old webOS TVs.
 *
 * Injected into the hosted Jellyfin web UI frame next to webOS.js. It talks
 * only to the Jellyfin server's Jellyfin Enhanced plugin endpoints
 * (/JellyfinEnhanced/jellyseerr/...) with the signed-in user's Jellyfin token,
 * so requests are made as that user's linked Seerr account. No API keys here.
 *
 * Must stay plain ES5: webOS 3.x runs Chromium 38 (no arrow functions,
 * let/const, template strings, fetch, Element.closest, String.includes ...).
*/

(function () {
    'use strict';

    if (window.SeerrOverlay) {
        return;
    }

    var KEY = {
        LEFT: 37,
        UP: 38,
        RIGHT: 39,
        DOWN: 40,
        ENTER: 13,
        ESC: 27,
        BACK: 461,
        GREEN: 404
    };

    var POSTER_BASE = 'https://image.tmdb.org/t/p/w185';
    var SEARCH_DEBOUNCE_MS = 700;
    var MIN_QUERY_LENGTH = 2;

    // Seerr MediaStatus values (mediaInfo.status)
    var STATUS = {
        UNKNOWN: 1,
        PENDING: 2,
        PROCESSING: 3,
        PARTIALLY_AVAILABLE: 4,
        AVAILABLE: 5,
        BLACKLISTED: 6,
        DELETED: 7
    };

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[Seerr]');
        console.log.apply(console, args);
    }

    /* ---------- helpers ---------- */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined && text !== null) {
            node.textContent = String(text);
        }
        return node;
    }

    function clear(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    function contains(str, part) {
        return String(str).indexOf(part) !== -1;
    }

    function ancestorWithClass(node, className, stopAt) {
        while (node && node !== stopAt && node.nodeType === 1) {
            if (node.classList && node.classList.contains(className)) {
                return node;
            }
            node = node.parentNode;
        }
        return null;
    }

    function isVisible(node) {
        return !!node && node.offsetWidth > 0 && node.offsetHeight > 0;
    }

    function titleOf(item) {
        return item.title || item.name || item.originalTitle || item.originalName || 'Untitled';
    }

    function yearOf(item) {
        var date = item.releaseDate || item.firstAirDate || '';
        return date ? date.substring(0, 4) : '';
    }

    function typeLabel(item) {
        return item.mediaType === 'tv' ? 'Series' : 'Movie';
    }

    function mediaStatus(item) {
        return item.mediaInfo && item.mediaInfo.status ? item.mediaInfo.status : STATUS.UNKNOWN;
    }

    // Returns { label, cls, requestable }
    function describeStatus(item) {
        switch (mediaStatus(item)) {
            case STATUS.AVAILABLE:
                return { label: 'In library', cls: 'available', requestable: false };
            case STATUS.PARTIALLY_AVAILABLE:
                return { label: 'Partly in library', cls: 'partial', requestable: item.mediaType === 'tv' };
            case STATUS.PROCESSING:
                return { label: 'Downloading', cls: 'processing', requestable: false };
            case STATUS.PENDING:
                return { label: 'Requested', cls: 'pending', requestable: false };
            case STATUS.BLACKLISTED:
                return { label: 'Blocklisted', cls: 'blocked', requestable: false };
            default:
                return { label: 'Not in library', cls: 'missing', requestable: true };
        }
    }

    /* ---------- API (Jellyfin Enhanced plugin proxy) ---------- */

    function getApiClient() {
        var client = window.ApiClient;
        if (!client || typeof client.accessToken !== 'function' || !client.accessToken()) {
            return null;
        }
        return client;
    }

    function apiUrl(client, path) {
        return client.getUrl('JellyfinEnhanced/jellyseerr/' + path);
    }

    function parseJson(text) {
        try {
            return text ? JSON.parse(text) : null;
        } catch (e) {
            return null;
        }
    }

    function errorMessage(xhr, data) {
        if (data && typeof data.message === 'string' && data.message) {
            return data.message;
        }
        if (typeof data === 'string' && data) {
            return data;
        }
        if (xhr.status === 0) {
            return 'Could not reach the Jellyfin server.';
        }
        if (xhr.status === 401) {
            return 'Not signed in to Jellyfin.';
        }
        if (xhr.status === 403) {
            return 'Your Jellyfin user is not linked to a Seerr user, or lacks the Request permission.';
        }
        if (xhr.status === 404) {
            return 'Jellyfin Enhanced plugin endpoints not found on the server.';
        }
        if (xhr.status === 503) {
            return 'Seerr integration is disabled in the Jellyfin Enhanced plugin.';
        }
        return 'Seerr request failed (HTTP ' + xhr.status + ').';
    }

    // callback(error, data)
    function api(method, path, body, callback) {
        var client = getApiClient();
        if (!client) {
            callback('Sign in to Jellyfin first.');
            return null;
        }

        var xhr = new XMLHttpRequest();
        xhr.open(method, apiUrl(client, path), true);
        xhr.setRequestHeader('Authorization', 'MediaBrowser Token="' + client.accessToken() + '"');
        xhr.setRequestHeader('Accept', 'application/json');
        if (body) {
            xhr.setRequestHeader('Content-Type', 'application/json');
        }
        xhr.timeout = 20000;

        var done = false;
        function finish(err, data) {
            if (!done) {
                done = true;
                callback(err, data);
            }
        }

        xhr.onload = function () {
            var data = parseJson(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
                finish(null, data);
            } else {
                finish(errorMessage(xhr, data !== null ? data : xhr.responseText));
            }
        };
        xhr.onerror = function () {
            finish(errorMessage(xhr, null));
        };
        xhr.ontimeout = function () {
            finish('Seerr took too long to answer.');
        };
        xhr.send(body ? JSON.stringify(body) : null);
        return xhr;
    }

    // callback(error, results[])
    function search(query, callback) {
        var lang = (navigator.language || 'en').split('-')[0];
        return api('GET', 'search?query=' + encodeURIComponent(query) + '&page=1&language=' + encodeURIComponent(lang), null, function (err, data) {
            if (err) {
                callback(err, []);
                return;
            }
            var results = [];
            var list = (data && data.results) || [];
            for (var i = 0; i < list.length; i++) {
                if (list[i].mediaType === 'movie' || list[i].mediaType === 'tv') {
                    results.push(list[i]);
                }
            }
            callback(null, results);
        });
    }

    function requestMedia(item, callback) {
        var body = {
            mediaType: item.mediaType,
            mediaId: parseInt(item.id, 10)
        };
        if (item.mediaType === 'tv') {
            body.seasons = 'all';
        }
        api('POST', 'request', body, callback);
    }

    /* ---------- spatial navigation ---------- */

    function center(rect) {
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function focusablesIn(root) {
        var nodes = root.querySelectorAll('[data-seerr-focus]');
        var result = [];
        for (var i = 0; i < nodes.length; i++) {
            if (isVisible(nodes[i]) && !nodes[i].disabled) {
                result.push(nodes[i]);
            }
        }
        return result;
    }

    function moveFocus(root, keyCode) {
        var candidates = focusablesIn(root);
        if (!candidates.length) {
            return;
        }
        var current = document.activeElement;
        if (candidates.indexOf(current) === -1) {
            focusNode(candidates[0]);
            return;
        }

        var from = center(current.getBoundingClientRect());
        var best = null;
        var bestScore = Infinity;

        for (var i = 0; i < candidates.length; i++) {
            var node = candidates[i];
            if (node === current) {
                continue;
            }
            var to = center(node.getBoundingClientRect());
            var dx = to.x - from.x;
            var dy = to.y - from.y;
            var primary;
            var secondary;

            if (keyCode === KEY.RIGHT) {
                primary = dx;
                secondary = dy;
            } else if (keyCode === KEY.LEFT) {
                primary = -dx;
                secondary = dy;
            } else if (keyCode === KEY.DOWN) {
                primary = dy;
                secondary = dx;
            } else {
                primary = -dy;
                secondary = dx;
            }

            if (primary <= 1) {
                continue;
            }
            var score = primary + Math.abs(secondary) * 3;
            if (score < bestScore) {
                bestScore = score;
                best = node;
            }
        }

        if (best) {
            focusNode(best);
        }
    }

    function focusNode(node) {
        if (!node) {
            return;
        }
        node.focus();
        if (node.scrollIntoViewIfNeeded) {
            node.scrollIntoViewIfNeeded(false);
        } else if (node.scrollIntoView) {
            node.scrollIntoView(false);
        }
    }

    function makeFocusable(node) {
        node.setAttribute('data-seerr-focus', '1');
        if (node.tagName !== 'BUTTON' && node.tagName !== 'INPUT') {
            node.setAttribute('tabindex', '-1');
        }
        // Magic Remote pointer: follow the pointer with focus
        node.addEventListener('mouseover', function () {
            if (document.activeElement !== node && node.tagName !== 'INPUT') {
                node.focus();
            }
        });
        return node;
    }

    /* ---------- toast ---------- */

    var toastTimer = null;

    function toast(message, isError) {
        var node = document.getElementById('seerr-toast');
        if (!node) {
            node = el('div');
            node.id = 'seerr-toast';
            document.body.appendChild(node);
        }
        node.textContent = message;
        node.className = isError ? 'seerr-toast-error seerr-toast-show' : 'seerr-toast-show';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            node.className = isError ? 'seerr-toast-error' : '';
        }, 5000);
    }

    /* ---------- overlay ---------- */

    var overlay = null;
    var refs = {};
    var state = {
        open: false,
        dialogItem: null,
        results: [],
        query: '',
        pending: null,
        returnFocus: null
    };

    function buildOverlay() {
        overlay = el('div');
        overlay.id = 'seerr-overlay';

        var header = el('div', 'seerr-header');
        header.appendChild(el('div', 'seerr-logo', 'Seerr'));

        var input = el('input', 'seerr-input');
        input.type = 'text';
        input.placeholder = 'Search movies and series';
        input.setAttribute('autocomplete', 'off');
        makeFocusable(input);
        header.appendChild(input);

        var searchButton = makeFocusable(el('button', 'seerr-button', 'Search'));
        searchButton.type = 'button';
        searchButton.addEventListener('click', function () {
            runSearch(input.value);
        });
        header.appendChild(searchButton);

        var closeButton = makeFocusable(el('button', 'seerr-button seerr-button-secondary', 'Close'));
        closeButton.type = 'button';
        closeButton.addEventListener('click', closeOverlay);
        header.appendChild(closeButton);

        overlay.appendChild(header);

        var message = el('div', 'seerr-message');
        overlay.appendChild(message);

        var grid = el('div', 'seerr-grid');
        overlay.appendChild(grid);

        overlay.appendChild(el('div', 'seerr-hint', 'Arrows: move · OK: details / request · Back: close'));

        // Detail dialog
        var dialog = el('div', 'seerr-dialog');
        var dialogBox = el('div', 'seerr-dialog-box');
        var dialogPoster = el('img', 'seerr-dialog-poster');
        var dialogBody = el('div', 'seerr-dialog-body');
        var dialogTitle = el('div', 'seerr-dialog-title');
        var dialogMeta = el('div', 'seerr-dialog-meta');
        var dialogOverview = el('div', 'seerr-dialog-overview');
        var dialogActions = el('div', 'seerr-dialog-actions');

        var requestButton = makeFocusable(el('button', 'seerr-button seerr-button-primary', 'Request'));
        requestButton.type = 'button';
        requestButton.addEventListener('click', function () {
            submitRequest(state.dialogItem);
        });

        var cancelButton = makeFocusable(el('button', 'seerr-button seerr-button-secondary', 'Back'));
        cancelButton.type = 'button';
        cancelButton.addEventListener('click', closeDialog);

        dialogActions.appendChild(requestButton);
        dialogActions.appendChild(cancelButton);
        dialogBody.appendChild(dialogTitle);
        dialogBody.appendChild(dialogMeta);
        dialogBody.appendChild(dialogOverview);
        dialogBody.appendChild(dialogActions);
        dialogBox.appendChild(dialogPoster);
        dialogBox.appendChild(dialogBody);
        dialog.appendChild(dialogBox);
        overlay.appendChild(dialog);

        document.body.appendChild(overlay);

        refs = {
            input: input,
            message: message,
            grid: grid,
            dialog: dialog,
            dialogPoster: dialogPoster,
            dialogTitle: dialogTitle,
            dialogMeta: dialogMeta,
            dialogOverview: dialogOverview,
            requestButton: requestButton,
            cancelButton: cancelButton
        };
    }

    function setMessage(text, isError) {
        refs.message.textContent = text || '';
        refs.message.className = 'seerr-message' + (isError ? ' seerr-message-error' : '');
    }

    function posterUrl(item) {
        var path = item.posterPath || item.poster_path;
        return path ? POSTER_BASE + path : '';
    }

    function renderCard(item, index) {
        var status = describeStatus(item);
        var card = makeFocusable(el('div', 'seerr-card'));
        card.setAttribute('data-index', String(index));

        var posterWrap = el('div', 'seerr-poster');
        var url = posterUrl(item);
        if (url) {
            var img = el('img');
            img.src = url;
            img.alt = '';
            posterWrap.appendChild(img);
        } else {
            posterWrap.appendChild(el('div', 'seerr-poster-empty', titleOf(item)));
        }
        posterWrap.appendChild(el('div', 'seerr-badge seerr-badge-' + status.cls, status.label));
        card.appendChild(posterWrap);

        card.appendChild(el('div', 'seerr-card-title', titleOf(item)));
        var meta = typeLabel(item) + (yearOf(item) ? ' · ' + yearOf(item) : '');
        card.appendChild(el('div', 'seerr-card-meta', meta));

        card.addEventListener('click', function () {
            openDialog(item);
        });
        return card;
    }

    function renderResults() {
        clear(refs.grid);
        for (var i = 0; i < state.results.length; i++) {
            refs.grid.appendChild(renderCard(state.results[i], i));
        }
    }

    function runSearch(query) {
        query = (query || '').replace(/^\s+|\s+$/g, '');
        refs.input.value = query;
        state.query = query;
        if (state.pending) {
            state.pending.abort();
            state.pending = null;
        }
        if (query.length < MIN_QUERY_LENGTH) {
            state.results = [];
            renderResults();
            setMessage('Type at least ' + MIN_QUERY_LENGTH + ' characters and press OK.');
            focusNode(refs.input);
            return;
        }

        setMessage('Searching Seerr for “' + query + '” …');
        state.pending = search(query, function (err, results) {
            state.pending = null;
            if (query !== state.query) {
                return;
            }
            if (err) {
                state.results = [];
                renderResults();
                setMessage(err, true);
                return;
            }
            state.results = results;
            renderResults();
            if (!results.length) {
                setMessage('No movies or series found for “' + query + '”.');
                return;
            }
            setMessage(results.length + ' results for “' + query + '”');
            // Leave the on-screen keyboard and jump into the results
            refs.input.blur();
            focusNode(refs.grid.querySelector('[data-seerr-focus]'));
        });
    }

    function openOverlay(query) {
        if (!overlay) {
            buildOverlay();
        }
        if (!state.open) {
            state.returnFocus = document.activeElement;
        }
        state.open = true;
        overlay.className = 'seerr-open';
        document.documentElement.classList.add('seerr-overlay-active');

        query = query || '';
        if (query && query !== state.query) {
            runSearch(query);
        } else if (state.results.length) {
            var first = refs.grid.querySelector('[data-seerr-focus]');
            focusNode(first || refs.input);
        } else {
            refs.input.value = query;
            setMessage(query ? '' : 'Type a title and press OK.');
            focusNode(refs.input);
            if (query) {
                runSearch(query);
            }
        }
    }

    function closeOverlay() {
        if (!overlay || !state.open) {
            return;
        }
        closeDialog();
        state.open = false;
        overlay.className = '';
        document.documentElement.classList.remove('seerr-overlay-active');
        if (refs.input) {
            refs.input.blur();
        }
        var target = state.returnFocus;
        state.returnFocus = null;
        if (target && target.focus && document.body.contains(target)) {
            target.focus();
        }
    }

    function openDialog(item) {
        var status = describeStatus(item);
        state.dialogItem = item;

        var url = posterUrl(item);
        refs.dialogPoster.style.display = url ? '' : 'none';
        refs.dialogPoster.src = url;
        refs.dialogTitle.textContent = titleOf(item);
        refs.dialogMeta.textContent = typeLabel(item) + (yearOf(item) ? ' · ' + yearOf(item) : '') + ' · ' + status.label;
        refs.dialogOverview.textContent = item.overview || '';

        refs.requestButton.disabled = !status.requestable;
        refs.requestButton.style.display = status.requestable ? '' : 'none';
        refs.requestButton.textContent = item.mediaType === 'tv' ? 'Request all seasons' : 'Request';

        refs.dialog.className = 'seerr-dialog seerr-dialog-open';
        focusNode(status.requestable ? refs.requestButton : refs.cancelButton);
    }

    function closeDialog() {
        if (!state.dialogItem) {
            return;
        }
        var index = state.results.indexOf(state.dialogItem);
        state.dialogItem = null;
        refs.dialog.className = 'seerr-dialog';
        var card = refs.grid.querySelector('[data-index="' + index + '"]');
        focusNode(card || refs.input);
    }

    function submitRequest(item) {
        if (!item || refs.requestButton.disabled) {
            return;
        }
        refs.requestButton.disabled = true;
        refs.requestButton.textContent = 'Requesting …';

        requestMedia(item, function (err) {
            if (err) {
                refs.requestButton.disabled = false;
                refs.requestButton.textContent = 'Try again';
                toast('Request failed: ' + err, true);
                return;
            }
            item.mediaInfo = item.mediaInfo || {};
            item.mediaInfo.status = STATUS.PENDING;
            toast('Requested “' + titleOf(item) + '”. It will appear in Jellyfin once downloaded.');

            // Refresh the card's badge, then return to the grid
            var index = state.results.indexOf(item);
            var oldCard = refs.grid.querySelector('[data-index="' + index + '"]');
            if (oldCard) {
                refs.grid.replaceChild(renderCard(item, index), oldCard);
            }
            closeDialog();
        });
    }

    /* ---------- keys ---------- */

    function isTextInput(node) {
        return !!node && node.tagName === 'INPUT' && node.type !== 'checkbox' && node.type !== 'button';
    }

    function isPlayingVideo() {
        var videos = document.getElementsByTagName('video');
        for (var i = 0; i < videos.length; i++) {
            if (!videos[i].paused) {
                return true;
            }
        }
        return false;
    }

    function swallow(evt) {
        evt.preventDefault();
        evt.stopPropagation();
        if (evt.stopImmediatePropagation) {
            evt.stopImmediatePropagation();
        }
    }

    function onKeyDown(evt) {
        var key = evt.keyCode;

        if (!state.open) {
            if (key === KEY.GREEN && !isPlayingVideo()) {
                swallow(evt);
                openOverlay(currentJellyfinQuery());
            }
            return;
        }

        var active = document.activeElement;
        var layer = state.dialogItem ? refs.dialog : overlay;

        // Keep every key away from jellyfin-web while the overlay is open
        if (key === KEY.BACK || key === KEY.ESC) {
            swallow(evt);
            if (state.dialogItem) {
                closeDialog();
            } else {
                closeOverlay();
            }
            return;
        }

        if (active === refs.input) {
            if (key === KEY.ENTER) {
                swallow(evt);
                runSearch(refs.input.value);
                return;
            }
            if (key === KEY.LEFT || key === KEY.RIGHT) {
                // Let the caret move inside the text field
                evt.stopPropagation();
                if (evt.stopImmediatePropagation) {
                    evt.stopImmediatePropagation();
                }
                var caret = active.selectionStart;
                var atEdge = key === KEY.RIGHT ? caret >= active.value.length : caret <= 0;
                if (!atEdge) {
                    return;
                }
                evt.preventDefault();
                moveFocus(layer, key);
                return;
            }
        }

        if (key === KEY.LEFT || key === KEY.RIGHT || key === KEY.UP || key === KEY.DOWN) {
            swallow(evt);
            if (focusablesIn(layer).indexOf(active) === -1) {
                var first = focusablesIn(layer)[0];
                focusNode(first);
            } else {
                moveFocus(layer, key);
            }
            return;
        }

        if (key === KEY.ENTER) {
            swallow(evt);
            if (active && layer.contains(active) && active !== refs.input) {
                active.click();
            }
            return;
        }

        // Typing inside the search field: let it reach the input, not jellyfin-web
        if (isTextInput(active) && overlay.contains(active)) {
            evt.stopPropagation();
            if (evt.stopImmediatePropagation) {
                evt.stopImmediatePropagation();
            }
            return;
        }

        swallow(evt);
    }

    /* ---------- Jellyfin search page integration ---------- */

    var bannerTimer = null;
    var bannerRequest = null;
    var bannerQuery = '';

    function isSearchPage() {
        return contains(window.location.hash || '', 'search') || contains(window.location.pathname || '', 'search');
    }

    function jellyfinSearchInput() {
        var candidates = document.querySelectorAll('#searchTextInput, .searchFields input, input[type="search"]');
        for (var i = 0; i < candidates.length; i++) {
            if (!overlay || !overlay.contains(candidates[i])) {
                if (isVisible(candidates[i])) {
                    return candidates[i];
                }
            }
        }
        return null;
    }

    function currentJellyfinQuery() {
        if (!isSearchPage()) {
            return '';
        }
        var input = jellyfinSearchInput();
        return input ? input.value : '';
    }

    function removeBanner() {
        var old = document.querySelectorAll('.seerr-search-banner');
        for (var i = 0; i < old.length; i++) {
            old[i].parentNode.removeChild(old[i]);
        }
    }

    function showBanner(input, query, results) {
        removeBanner();
        var missing = 0;
        for (var i = 0; i < results.length; i++) {
            if (describeStatus(results[i]).requestable) {
                missing++;
            }
        }

        var banner = el('button', 'seerr-search-banner raised emby-button');
        banner.type = 'button';
        var text = missing > 0
            ? missing + (missing === 1 ? ' title' : ' titles') + ' not in your library — request on Seerr'
            : 'Show ' + results.length + ' Seerr results for “' + query + '”';
        banner.appendChild(el('span', 'seerr-search-banner-text', text));
        banner.appendChild(el('span', 'seerr-search-banner-hint', 'OK or green button'));
        banner.addEventListener('click', function () {
            openOverlay(query);
        });

        // Place it right below jellyfin's search field container
        var page = ancestorWithClass(input, 'page', null) || document.body;
        var fields = ancestorWithClass(input, 'searchFields', page) || input.parentNode;
        if (fields.parentNode) {
            fields.parentNode.insertBefore(banner, fields.nextSibling);
        }
    }

    function checkSearchQuery() {
        if (!isSearchPage()) {
            removeBanner();
            return;
        }
        var input = jellyfinSearchInput();
        if (!input) {
            return;
        }
        var query = (input.value || '').replace(/^\s+|\s+$/g, '');
        if (query === bannerQuery) {
            return;
        }
        bannerQuery = query;
        if (bannerRequest) {
            bannerRequest.abort();
            bannerRequest = null;
        }
        if (query.length < MIN_QUERY_LENGTH) {
            removeBanner();
            return;
        }
        bannerRequest = search(query, function (err, results) {
            bannerRequest = null;
            if (query !== bannerQuery) {
                return;
            }
            if (err || !results.length) {
                removeBanner();
                if (err) {
                    log('banner search failed:', err);
                }
                return;
            }
            showBanner(input, query, results);
        });
    }

    function scheduleSearchCheck() {
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(checkSearchQuery, SEARCH_DEBOUNCE_MS);
    }

    function onInput(evt) {
        var target = evt.target;
        if (overlay && overlay.contains(target)) {
            return;
        }
        if (isTextInput(target) && isSearchPage()) {
            scheduleSearchCheck();
        }
    }

    function onRouteChange() {
        bannerQuery = '';
        if (!isSearchPage()) {
            removeBanner();
            closeOverlay();
        } else {
            scheduleSearchCheck();
        }
    }

    /* ---------- init ---------- */

    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('input', onInput, true);
    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    // jellyfin-web fires viewshow on every page change
    document.addEventListener('viewshow', onRouteChange);

    window.SeerrOverlay = {
        open: openOverlay,
        close: closeOverlay,
        search: search
    };

    log('Seerr overlay ready');
})();
