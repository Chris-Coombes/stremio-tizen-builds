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
