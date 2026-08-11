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
        // With a filter open, back should close it -- jumping out to the
        // sidebar and leaving it hanging open is what it did before.
        var dd = openDropdown();
        if (dd) {
            var menu = dd.closest('[class*="multiselect-menu"]');
            var button = menu ? menu.querySelector('[class*="multiselect-button"]') : null;
            if (button) {
                button.click();
                try { button.focus(); } catch (ex) {}
                return;
            }
        }
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
        '[class*="board-row"] [class*="meta-items-container"] > [class*="meta-item"]:nth-child(n+7){display:none !important}',
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

    function rowNeighbour(item, down) {
        // Home board: each row is its own flex container, so step board-rows.
        var row = item.closest('[class*="board-row"]');
        if (row) {
            var rows = Array.prototype.filter.call(
                document.querySelectorAll('[class*="board-row"]'),
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
    function openDropdown() {
        var dds = document.querySelectorAll('[class*="multiselect-menu"] [class*="dropdown"]');
        for (var i = 0; i < dds.length; i++) {
            var r = dds[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return dds[i];
        }
        return null;
    }

    document.addEventListener('keydown', function(e) {
        if (e.keyCode !== 38 && e.keyCode !== 40) return;
        var dd = openDropdown();
        if (!dd) return;
        var opts = Array.prototype.filter.call(dd.querySelectorAll('[class*="option-"]'), function(el) {
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
        if (!opts.length) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        var current = document.activeElement && document.activeElement.closest ?
            document.activeElement.closest('[class*="option-"]') : null;
        var i = current ? opts.indexOf(current) : -1;
        // Focus may still be on the button that opened it, so the first press
        // should land on the first option rather than stepping past it.
        var next = (i < 0) ? opts[0] :
            opts[Math.min(Math.max(i + (e.keyCode === 40 ? 1 : -1), 0), opts.length - 1)];
        next.setAttribute('tabindex', '0');
        try { next.focus(); } catch (ex) {}
        next.scrollIntoView({ block: 'nearest' });
    }, true);

    document.addEventListener('keydown', function(e) {
        if (e.keyCode !== 38 && e.keyCode !== 40) return;
        if (openDropdown()) return;   // the handler above owns this case
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
        var isOpen = !!openDropdown();
        if (dropdownWasOpen && !isOpen) {
            focusResultsUntil = Date.now() + FOCUS_RESULTS_WINDOW_MS;
        }
        dropdownWasOpen = isOpen;

        if (!focusResultsUntil || isOpen) return;
        if (Date.now() > focusResultsUntil) { focusResultsUntil = 0; return; }

        var active = document.activeElement;
        if (active && active.closest && active.closest(TILE)) {
            focusResultsUntil = 0;      // it stuck
            return;
        }
        var grid = largestTileGrid();
        if (!grid) return;
        var tiles = visibleTilesIn(grid);
        if (!tiles.length) return;
        tiles[0].setAttribute('tabindex', '0');
        try { tiles[0].focus(); } catch (ex) {}
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
