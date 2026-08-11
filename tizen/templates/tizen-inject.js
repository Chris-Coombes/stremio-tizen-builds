/**
 * tizen-inject.js — Samsung TV integration for Stremio Web
 *
 * Injected into stremio-web source builds to add:
 * - TV remote key handling (back, exit, media keys)
 * - Tizen lifecycle management
 * - Samsung TV input device registration
 */
(function() {
    'use strict';

    // ── Register Samsung TV remote keys ─────────────────────────────────
    try {
        var keys = [
            'MediaPlayPause', 'MediaPlay', 'MediaPause',
            'MediaStop', 'MediaRewind', 'MediaFastForward',
            'MediaTrackPrevious', 'MediaTrackNext',
            'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
            'Info', 'Guide'
        ];
        keys.forEach(function(key) {
            try { tizen.tvinputdevice.registerKey(key); } catch(e) {}
        });
    } catch(e) {
        // Not running on Tizen — silently ignore
    }

    // ── Back / Exit key handling ────────────────────────────────────────
    var KEY_BACK = 10009;
    var KEY_EXIT = 10182;

    document.addEventListener('keydown', function(e) {
        if (e.keyCode === KEY_EXIT) {
            e.preventDefault();
            try { tizen.application.getCurrentApplication().exit(); } catch(ex) {}
        }
    });

    // Back was declared above and then never handled, so the key did nothing at
    // all. Samsung's own Stremio app uses back as "jump to the sidebar" rather
    // than as a history control, so that you don't have to walk left across a
    // whole row of tiles just to change section. Match that: back from the
    // content area focuses the sidebar, back from the sidebar goes back in
    // history.
    //
    // Registered at CAPTURE phase, and stopping dispatch outright: stremio-web
    // components bind their own keydown handlers (the player in particular), and
    // at bubble phase this never runs if one of them stops propagation first.
    function visibleSidebarTab() {
        var tabs = document.querySelectorAll('[class*="nav-tab-button"]');
        var selected = null;
        for (var i = 0; i < tabs.length; i++) {
            var r = tabs[i].getBoundingClientRect();
            // The player route keeps nav tabs in the DOM but hidden. Focusing one
            // of those would silently do nothing and read as a dead back button.
            if (r.width === 0 || r.height === 0) continue;
            if (!selected) selected = tabs[i];
            if (/\bselected\b/.test(tabs[i].className)) return tabs[i];
        }
        return selected;
    }

    document.addEventListener('keydown', function(e) {
        if (e.keyCode !== KEY_BACK) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        // With a filter or the account menu open, back should close it --
        // jumping out to the sidebar and leaving it hanging open is what it did
        // before, and the account menu had no way out at all.
        var overlay = openOverlay();
        if (overlay && closeOverlay(overlay)) return;
        var inSidebar = document.activeElement &&
            document.activeElement.closest &&
            document.activeElement.closest('[class*="nav-tab-button"]');
        if (!inSidebar) {
            var tab = visibleSidebarTab();
            if (tab) {
                tab.setAttribute('tabindex', '0');
                try { tab.focus(); } catch (ex) {}
                return;
            }
        }
        if (location.hash && location.hash !== '#/') {
            history.back();
        }
    }, true);

    // ── Make the chrome reachable by the remote ─────────────────────────
    // Tizen's WebKit spatial navigation only moves focus between elements it
    // considers focusable. stremio-web ships its sidebar tabs, top bar buttons
    // and "see all" links with tabindex="-1" (they are mouse targets on
    // desktop), so on a TV the remote can only ever reach the content grid —
    // the sidebar and top bar are unreachable. Promote them to tabindex="0".
    //
    // Done on each arrow press rather than via MutationObserver: stremio-web
    // re-renders constantly, and this way the pass is both always current and
    // only paid for when someone is actually navigating.
    var NAV_SEL = [
        '[class*="nav-tab-button"]',
        '[class*="button-container"]',
        '[class*="see-all-container"]',
        '[class*="label-container"]'
    ].join(',');

    function promoteNavTargets() {
        var els = document.querySelectorAll(NAV_SEL);
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (el.getAttribute('tabindex') !== '-1') continue;
            // Skip candidates nested inside another candidate. The selectors are
            // substring matches, so "label-container" also catches the
            // "menu-label-container" inside every meta-item tile; promoting both
            // would put a second focus stop inside each tile and make crossing a
            // row of films take two presses per film.
            if (el.parentElement && el.parentElement.closest(NAV_SEL)) continue;
            var r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) el.setAttribute('tabindex', '0');
        }
    }

    document.addEventListener('keydown', function(e) {
        // 37 left, 38 up, 39 right, 40 down
        if (e.keyCode >= 37 && e.keyCode <= 40) promoteNavTargets();
    }, true);

    // Also promote proactively on load and on each route change, so the very
    // first arrow press after navigating somewhere new doesn't have to rely on
    // the promotion landing before the browser picks its focus candidate.
    document.addEventListener('DOMContentLoaded', promoteNavTargets);
    window.addEventListener('hashchange', function() {
        setTimeout(promoteNavTargets, 0);
    });

    // ── Size the UI for a TV rather than a desktop monitor ──────────────
    // stremio-web has no UI scale setting. Two separate things make it small on
    // a 1080p TV, and they need different fixes:
    //
    // 1. Root font size comes from width breakpoints (18px above 2800px, 16px
    //    to 2800, 15px to 2200, 14px to 1600). A 1920-wide TV lands on 15px --
    //    sized for a monitor at arm's length. Everything else is rem (1470 rem
    //    values against 186 px in the stylesheet), so one override scales the
    //    lot.
    //
    // 2. Tile size does NOT follow the font. The home rows are flex and always
    //    render CATALOG_PREVIEW_SIZE = 10 items, so each tile is just row width
    //    / 10 no matter the screen; raising the font only made the titles
    //    outgrow their tiles and truncate. Hiding the overflow items lets flex
    //    give the rest more room.
    //
    // The catalog grids are a different mechanism again -- fixed column counts
    // per breakpoint (repeat(9,1fr) on Library, repeat(7,1fr) on Discover) --
    // so those get a column override instead, which reflows and hides nothing.
    //
    // 🚨 The hide rule MUST stay scoped to board rows. Unscoped it also matches
    // the catalog grids, where it hid 115 of 121 Library items and 426 of 432
    // on Discover while looking fine on the home screen.
    var UI_SCALE_CSS = [
        'html{font-size:20px !important}',
        // Search uses the same fixed-count flex carousel as the home board, but
        // under "search-row" rather than "board-row", so it needs naming too or
        // it keeps the stock 9-per-row while everything else is 6.
        '[class*="board-row"] [class*="meta-items-container"] > [class*="meta-item"]:nth-child(n+7),' +
        '[class*="search-row"] [class*="meta-items-container"] > [class*="meta-item"]:nth-child(n+7)' +
        '{display:none !important}',
        '[class*="meta-items-container"]{grid-template-columns:repeat(6,1fr) !important}',
        // Discover's grid sits in a narrower column because of the side panel,
        // so 6 there would be noticeably smaller than everywhere else.
        '[class*="discover-container"] [class*="meta-items-container"]{grid-template-columns:repeat(4,1fr) !important}'
    ].join('');

    (function applyUiScale() {
        var style = document.createElement('style');
        style.id = 'tv-ui-scale';
        style.textContent = UI_SCALE_CSS;
        var attach = function() {
            (document.head || document.documentElement).appendChild(style);
        };
        if (document.head) attach();
        else document.addEventListener('DOMContentLoaded', attach);
    })();

    // ── Jump a whole row on up/down, instead of scrolling toward one ────
    // WebKit's spatial navigation scrolls toward an off-screen candidate rather
    // than jumping to it, so with TV-sized tiles the next row is usually out of
    // view and each press only nudges the page -- it takes several to actually
    // change row. Handle up/down on tiles ourselves: move to the same column in
    // the adjacent row and let the page follow the focus.
    //
    // Only tiles are intercepted. Anywhere else (the stream list, settings, the
    // sidebar) falls through to the native behaviour, which is fine there
    // because those are single columns of short rows.
    //
    // Note the ":not([class*=meta-items])" -- "meta-item" is a substring of
    // "meta-items-container", so the loose selector matches the row container
    // itself and focus lands on the whole row.
    var TILE = '[class*="meta-item-"]:not([class*="meta-items"])';

    function visibleTilesIn(root) {
        return Array.prototype.filter.call(root.querySelectorAll(TILE), function(el) {
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
    }

    // Home board and Search both lay results out as one flex carousel per row.
    // Search must be included here as well as in the CSS above: without it the
    // grid branch below runs on a flex container, computes a single column and
    // steps one tile at a time instead of a whole row.
    var CAROUSEL_ROW = '[class*="board-row"],[class*="search-row"]';

    function rowNeighbour(item, down) {
        var row = item.closest(CAROUSEL_ROW);
        if (row) {
            var rows = Array.prototype.filter.call(
                document.querySelectorAll(CAROUSEL_ROW),
                function(el) {
                    var r = el.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                });
            var next = rows[rows.indexOf(row) + (down ? 1 : -1)];
            if (!next) return null;
            var col = visibleTilesIn(row).indexOf(item);
            var into = visibleTilesIn(next);
            if (!into.length) return null;
            // Rows hold different numbers of items; clamp to the last one.
            return into[Math.min(Math.max(col, 0), into.length - 1)];
        }
        // Library / Discover: one grid, so a row is the column count.
        var grid = item.closest('[class*="meta-items-container"]');
        if (!grid) return null;
        var tiles = visibleTilesIn(grid);
        var cols = (getComputedStyle(grid).gridTemplateColumns || '').split(' ')
            .filter(Boolean).length || 1;
        var target = tiles.indexOf(item) + (down ? cols : -cols);
        return (target >= 0 && target < tiles.length) ? tiles[target] : null;
    }

    // ── Keep up/down inside an open filter dropdown ─────────────────────
    // The Discover filter dropdowns are position:absolute and overlap the
    // catalog behind them, so WebKit's spatial navigation picks a TILE showing
    // through the dropdown rather than an option in it. The row-jump handler
    // below then takes over and walks the catalog, so the filter can never be
    // navigated and just sits there open. Drive the options explicitly, and
    // make the row jump stand down while a dropdown is open.
    // Covers both popups that behave this way: the Discover filter dropdowns
    // and the account menu. The account menu is worse -- it sits at z-index 1
    // over the catalog, so tiles behind it stay perfectly good navigation
    // candidates and it could be opened but never entered or dismissed.
    var OVERLAY_SEL = '[class*="multiselect-menu"] [class*="dropdown"], [class*="menu-container"]';

    function openOverlay() {
        var els = document.querySelectorAll(OVERLAY_SEL);
        // Document order, so the outermost container comes first.
        for (var i = 0; i < els.length; i++) {
            var r = els[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return els[i];
        }
        return null;
    }

    // Both menus mark their items tabindex="0", so one rule serves both rather
    // than needing a selector per menu type.
    function overlayOptions(overlay) {
        return Array.prototype.filter.call(overlay.querySelectorAll('[tabindex="0"]'), function(el) {
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
    }

    function closeOverlay(overlay) {
        var multiselect = overlay.closest('[class*="multiselect-menu"]');
        if (multiselect) {
            var button = multiselect.querySelector('[class*="multiselect-button"]');
            if (button) {
                button.click();
                try { button.focus(); } catch (ex) {}
                return true;
            }
        }
        // The account menu is a child of the control that toggles it, so walk
        // out to the nearest focusable ancestor and click that.
        var toggle = overlay.parentElement;
        while (toggle && !(toggle.getAttribute && toggle.getAttribute('tabindex') === '0')) {
            toggle = toggle.parentElement;
        }
        if (toggle) {
            toggle.click();
            try { toggle.focus(); } catch (ex) {}
            return true;
        }
        return false;
    }

    document.addEventListener('keydown', function(e) {
        if (e.keyCode !== 38 && e.keyCode !== 40) return;
        var overlay = openOverlay();
        if (!overlay) return;
        var opts = overlayOptions(overlay);
        if (!opts.length) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        var active = document.activeElement;
        var i = -1;
        for (var n = 0; n < opts.length; n++) {
            if (opts[n] === active || opts[n].contains(active)) { i = n; break; }
        }
        // Focus may still be on the control that opened it, so the first press
        // should land on the first option rather than stepping past it.
        var next = (i < 0) ? opts[0] :
            opts[Math.min(Math.max(i + (e.keyCode === 40 ? 1 : -1), 0), opts.length - 1)];
        next.setAttribute('tabindex', '0');
        try { next.focus(); } catch (ex) {}
        next.scrollIntoView({ block: 'nearest' });
    }, true);

    // Down out of a text field goes to the first result. Search deliberately
    // keeps focus in the input (you land there ready to type, and the focus
    // helper below refuses to steal from a text field), so without this there
    // is no clean way into the results at all.
    document.addEventListener('keydown', function(e) {
        if (e.keyCode !== 40) return;
        var field = document.activeElement;
        if (!field || (field.tagName !== 'INPUT' && field.tagName !== 'TEXTAREA')) return;
        var first = firstResult();
        if (!first) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        first.setAttribute('tabindex', '0');
        try { first.focus(); } catch (ex) {}
        first.scrollIntoView({ block: 'center' });
    }, true);

    document.addEventListener('keydown', function(e) {
        if (e.keyCode !== 38 && e.keyCode !== 40) return;
        if (openOverlay()) return;   // the handler above owns this case
        var active = document.activeElement;
        if (!active || !active.closest) return;
        var item = active.closest(TILE);
        if (!item) return;
        var target = rowNeighbour(item, e.keyCode === 40);
        if (!target) return;
        // Stop the native handler too, or it scrolls on top of our jump.
        e.preventDefault();
        e.stopImmediatePropagation();
        target.setAttribute('tabindex', '0');
        try { target.focus(); } catch (ex) {}
        target.scrollIntoView({ block: 'center' });
    }, true);

    // After a filter closes, put focus on the first result rather than leaving
    // it on the filter row -- otherwise choosing a genre means pressing right
    // twice and down again before you can pick anything.
    //
    // This has to RETRY rather than fire once on the close. Applying a filter
    // re-renders the catalog immediately afterwards, which destroys whatever
    // was focused; a single attempt on the open->closed edge lands focus and
    // then loses it to BODY a few hundred ms later, which looks exactly like
    // the fix not working at all. Keep trying until focus is actually sitting
    // on a tile, then stand down.
    var FOCUS_RESULTS_WINDOW_MS = 5000;
    var dropdownWasOpen = false;
    var focusResultsUntil = 0;

    // Cold start needs a much longer window than a route change: the app has to
    // come up and the catalogs have to answer before there is anything to focus.
    var FOCUS_RESULTS_STARTUP_MS = 45000;

    function armResultsFocus(ms) {
        focusResultsUntil = Date.now() + (ms || FOCUS_RESULTS_WINDOW_MS);
    }

    // No hashchange fires on a cold start, so nothing armed the retry and the
    // home page came up with nothing focused.
    armResultsFocus(FOCUS_RESULTS_STARTUP_MS);

    // Any keypress means the user is driving, so stop trying to place focus.
    // Without this the long startup window would yank focus back to a tile
    // while they were part-way into the sidebar waiting for catalogs to load.
    document.addEventListener('keydown', function() {
        focusResultsUntil = 0;
    }, true);

    // Switching section from the sidebar has the same problem as filtering:
    // the new page renders with nothing focused, so it takes several presses
    // to get to the first title. Arm the same retry on route changes.
    //
    // Detail and player are excluded deliberately. Detail has its own focus
    // rule for the stream list, and both would otherwise be fought over.
    window.addEventListener('hashchange', function() {
        var hash = location.hash || '';
        if (hash.indexOf('#/detail') === 0 || hash.indexOf('#/player') === 0) {
            focusResultsUntil = 0;
            return;
        }
        armResultsFocus();
    });

    // Addons has no tile grid at all -- its rows are the results, and they are
    // already focusable. Search does use tiles, so it needs nothing extra
    // beyond the text-field guard below.
    var ADDON_ROW = '[class*="addon-"][tabindex="0"]';
    var RESULT_SEL = TILE + ',' + ADDON_ROW;

    function firstResult() {
        var grid = largestTileGrid();
        if (grid) {
            var tiles = visibleTilesIn(grid);
            if (tiles.length) return tiles[0];
        }
        var rows = document.querySelectorAll(ADDON_ROW);
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return rows[i];
        }
        return null;
    }

    function largestTileGrid() {
        // Routes leave earlier containers mounted at zero size, and the catalog
        // is not always the first match -- pick whichever actually holds the
        // most visible tiles.
        var conts = document.querySelectorAll('[class*="meta-items-container"]');
        var best = null, bestCount = 0;
        for (var i = 0; i < conts.length; i++) {
            var count = visibleTilesIn(conts[i]).length;
            if (count > bestCount) { bestCount = count; best = conts[i]; }
        }
        return best;
    }

    setInterval(function() {
        var overlay = openOverlay();
        var isOpen = !!overlay;
        // Only a filter closing should send focus to the results. Closing the
        // account menu shouldn't yank you off to the first tile.
        var isFilter = isOpen && !!overlay.closest('[class*="multiselect-menu"]');
        if (dropdownWasOpen && !isOpen) {
            armResultsFocus();
        }
        dropdownWasOpen = isFilter;

        if (!focusResultsUntil || isOpen) return;
        if (Date.now() > focusResultsUntil) { focusResultsUntil = 0; return; }

        var active = document.activeElement;
        // Never pull focus out of a text field. Searching updates the query in
        // the hash on every keystroke, which arms this -- without the guard it
        // would drag the user out of the search box and into the results
        // mid-word.
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            return;
        }
        if (active && active.closest && active.closest(RESULT_SEL)) {
            focusResultsUntil = 0;      // it stuck
            return;
        }
        var target = firstResult();
        if (!target) return;
        target.setAttribute('tabindex', '0');
        try { target.focus(); } catch (ex) {}
    }, 250);

    // ── Put focus on the stream list, like the Samsung app does ─────────
    // Opening a title leaves focus wherever it was, so reaching the streams
    // meant right, right, down every single time; and picking a provider from
    // the filter dropped focus back out to the page, so you had to do it again.
    // Whenever the stream list's contents change, move focus to the first
    // stream -- unless focus is already somewhere inside the list, which is
    // what stops this fighting the user mid-scroll and stops it stealing focus
    // out of the open filter dropdown (that dropdown renders inside the list).
    //
    // ponytail: polled rather than observed. The list is torn down and rebuilt
    // on every route change, so a MutationObserver would need re-attaching each
    // time; a 400ms poll that does nothing off the detail route is less code and
    // self-healing. Swap to an observer only if this ever shows up in profiling.
    var STREAMS_LIST = '[class*="streams-list"]';
    var STREAM_ROWS = '[class*="streams-container"] > [class*="label-container"]';
    var lastStreamsKey = null;

    setInterval(function() {
        if (location.hash.indexOf('#/detail') !== 0) { lastStreamsKey = null; return; }
        var list = document.querySelector(STREAMS_LIST);
        if (!list) { lastStreamsKey = null; return; }
        var rows = list.querySelectorAll(STREAM_ROWS);
        if (!rows.length) return;

        // Addons answer one at a time, so the list is rebuilt several times
        // after opening a title. Key on the contents so each genuine change
        // re-focuses once, rather than every tick.
        var key = rows.length + '|' + (rows[0].textContent || '').slice(0, 40);
        if (key === lastStreamsKey) return;
        lastStreamsKey = key;

        if (document.activeElement && document.activeElement.closest &&
            document.activeElement.closest(STREAMS_LIST)) return;

        rows[0].setAttribute('tabindex', '0');
        try { rows[0].focus(); } catch (ex) {}
    }, 400);

    // ── Visibility change (TV sleep / wake) ─────────────────────────────
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            // TV went to sleep — pause any playing media
            var videos = document.querySelectorAll('video');
            videos.forEach(function(v) { v.pause(); });
        }
    });

    // ── Prevent context menu on long press ──────────────────────────────
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    });

    console.log('[Stremio Tizen] TV integration loaded');
})();
