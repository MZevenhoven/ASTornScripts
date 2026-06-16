// ==UserScript==
// @name         Torn Market Attack Buttons
// @namespace    http://tampermonkey.net/
// @version      6.7
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://www.torn.com/page.php?sid=attack*
// @description  none
// @grant        none
// @run-at       document-start
// ==/UserScript==
(function () {
    'use strict';

    const isAttackPage = location.href.includes('sid=attack');
    const isMarketPage = location.href.includes('sid=ItemMarket');
    const isInIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();

    const REMOVE_SELECTORS = [
        '[class^="logStatsWrap___"]',
        '[class^="log___"]',
        '#header-root'
    ];
    const HIDE_SELECTORS = [
        ...REMOVE_SELECTORS,
        '[class*="chatRoot"]', '[class*="chat-app"]', '[class*="chatBox"]',
        '[class*="chat-box"]', '[class*="chatWindow"]', '[class*="chat-window"]',
        '[class*="chatWrapper"]', '[class*="chat-wrapper"]', '[class*="chatSettings"]',
        '[class*="chat-settings"]', '[class*="chatIcons"]', '[class*="chat-icons"]',
        '[class*="messagesWrapper"]', '[class*="messagePanel"]', '[class*="conversation"]',
        '[class*="newChat"]', '[class*="floatingChat"]', '[id*="chat"]'
    ];
    const REMOVE_SEL = REMOVE_SELECTORS.join(', ');
    const HIDE_SEL = HIDE_SELECTORS.join(', ');

    function debounce(fn, delay = 50) {
        let timer = null;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function setStyles(el, styles, important = false) {
        if (!el) return;
        for (const [prop, value] of Object.entries(styles)) {
            el.style.setProperty(prop, value, important ? 'important' : '');
        }
    }

    // ─── Attack page (iframe) ───────────────────────────────────────────────────
    if (isAttackPage) {
        if (!isInIframe) return;

        const styleId = 'attack-hide-ui-early';
        const css = `
            ${HIDE_SEL} {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
                height: 0 !important;
                max-height: 0 !important;
                min-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
                border: 0 !important;
            }
            .content-wrapper.logged-out.spring { margin-bottom: 0 !important; }
            html, body { overflow: hidden !important; }
        `;

        const injectStyles = () => {
            if (document.getElementById(styleId)) return;
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
        };

        const moveScouterBeforePlayersModel = () => {
            const scouter = document.getElementById('ff-scouter-run-once');
            const playersModel = document.querySelector('[class^="playersModelWrap___"]');
            if (!scouter || !playersModel?.parentNode || playersModel.previousElementSibling === scouter) return;
            playersModel.parentNode.insertBefore(scouter, playersModel);
            setStyles(scouter, {
                'display': 'block', 'visibility': 'visible', 'opacity': '1',
                'pointer-events': 'auto', 'height': 'auto',
                'max-height': 'none', 'overflow': 'visible'
            }, true);
        };

        const syncAttackIframeUi = () => {
            moveScouterBeforePlayersModel();
            document.querySelectorAll(REMOVE_SEL).forEach(el => el.remove());
            document.querySelector('.content-wrapper.logged-out.spring')
                ?.style.setProperty('margin-bottom', '0', 'important');
        };

        injectStyles();

        const startObserver = () => {
            if (!document.body) return;
            syncAttackIframeUi();
            new MutationObserver(debounce(syncAttackIframeUi, 25)).observe(document.body, { childList: true, subtree: true });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startObserver, { once: true });
        } else {
            startObserver();
        }
        return;
    }

    if (!isMarketPage) return;

    // ─── Market page ────────────────────────────────────────────────────────────
    const overlays = new Set();
    const resizeTimers = new WeakMap();
    let highestZ = 999999;
    let previousUrl = location.href;

    const getCurrentItemId = () => new URL(location.href).searchParams.get('itemID');

    function disposeOverlay(overlay) {
        if (!overlay || overlay._disposed) return;
        overlay._disposed = true;

        const { _frame: frame, _header: header, _closeButton: close } = overlay;

        clearInterval(resizeTimers.get(overlay));
        resizeTimers.delete(overlay);

        frame?.removeEventListener('load', overlay._frameResizeLoadHandler);
        overlay.removeEventListener('mousedown', overlay._overlayMouseDownHandler);
        close?.removeEventListener('click', overlay._closeClickHandler);
        header?.removeEventListener('mousedown', overlay._headerMouseDownHandler);
        document.removeEventListener('mousemove', overlay._documentMouseMoveHandler);
        document.removeEventListener('mouseup', overlay._documentMouseUpHandler);

        if (overlay._rafId !== null) {
            cancelAnimationFrame(overlay._rafId);
            overlay._rafId = null;
        }

        if (frame) {
            frame.style.pointerEvents = 'auto';
            frame.src = 'about:blank';
        }
        document.body.style.userSelect = '';
        overlays.delete(overlay);
        overlay.remove();
    }

    const clearAllOverlays = () => overlays.forEach(disposeOverlay);

    function bringToFront(overlay) {
        overlay.style.zIndex = String(++highestZ);
    }

    function resizeOverlayToIframe(overlay, frame) {
        if (!overlay || !frame || overlay._disposed) return;
        try {
            const doc = frame.contentDocument || frame.contentWindow?.document;
            if (!doc?.body || !doc?.documentElement) return;
            const contentHeight = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
            overlay.style.height = `${Math.max(220, contentHeight + 28)}px`;
            frame.style.height = `${contentHeight}px`;
        } catch (err) {
            console.log('[AttackButtons] Could not resize overlay to iframe:', err);
        }
    }

    function scheduleResizeChecks(overlay, frame) {
        clearInterval(resizeTimers.get(overlay));
        let count = 0;
        const timer = setInterval(() => {
            if (overlay._disposed || !document.body.contains(overlay)) {
                clearInterval(timer);
                resizeTimers.delete(overlay);
                return;
            }
            resizeOverlayToIframe(overlay, frame);
            if (++count >= 20) {
                clearInterval(timer);
                resizeTimers.delete(overlay);
            }
        }, 300);
        resizeTimers.set(overlay, timer);
    }

    function createOverlay(url) {
        const offset = overlays.size * 18;
        const startX = 70 + offset;
        const startY = 70 + offset;

        const overlay = document.createElement('div');
        overlay._disposed = false;
        overlay._rafId = null;

        setStyles(overlay, {
            'position': 'fixed', 'left': `${startX}px`, 'top': `${startY}px`,
            'width': '340px', 'height': '420px',
            'min-width': '260px', 'min-height': '220px',
            'background': '#111', 'border': '1px solid #444',
            'border-radius': '6px', 'box-shadow': '0 8px 20px rgba(0,0,0,0.5)',
            'overflow': 'hidden', 'resize': 'horizontal'
        });
        bringToFront(overlay);

        const header = document.createElement('div');
        setStyles(header, {
            'height': '28px', 'background': '#222', 'color': '#fff',
            'display': 'flex', 'align-items': 'center',
            'padding': '0 8px', 'cursor': 'move',
            'font-weight': '700', 'font-size': '11px', 'user-select': 'none'
        });

        const title = document.createElement('span');
        title.textContent = 'Attack';

        const close = document.createElement('button');
        close.textContent = '✕';
        setStyles(close, {
            'background': '#c62828', 'color': '#fff', 'border': 'none',
            'border-radius': '3px', 'padding': '1px 6px',
            'font-size': '11px', 'cursor': 'pointer',
            'line-height': '16px', 'margin-left': 'auto'
        });

        const frame = document.createElement('iframe');
        setStyles(frame, { 'display': 'block', 'width': '100%', 'height': '392px', 'border': 'none', 'background': '#000', 'overflow': 'hidden' });
        frame.setAttribute('scrolling', 'no');
        frame.loading = 'eager';
        frame.src = url;

        overlay._header = header;
        overlay._closeButton = close;
        overlay._frame = frame;

        let isDragging = false;
        let dragOffsetX = 0, dragOffsetY = 0;
        let baseX = startX, baseY = startY;
        let targetX = startX, targetY = startY;

        const paint = () => {
            overlay._rafId = null;
            if (!overlay._disposed) overlay.style.transform = `translate(${targetX - baseX}px, ${targetY - baseY}px)`;
        };
        const queuePaint = () => {
            if (!overlay._disposed && overlay._rafId === null)
                overlay._rafId = requestAnimationFrame(paint);
        };

        overlay._overlayMouseDownHandler = () => bringToFront(overlay);
        overlay._frameResizeLoadHandler = () => {
            if (!overlay._disposed) { resizeOverlayToIframe(overlay, frame); scheduleResizeChecks(overlay, frame); }
        };
        overlay._closeClickHandler = () => disposeOverlay(overlay);
        overlay._headerMouseDownHandler = (e) => {
            if (overlay._disposed) return;
            bringToFront(overlay);
            isDragging = true;
            const rect = overlay.getBoundingClientRect();
            baseX = targetX = rect.left;
            baseY = targetY = rect.top;
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            overlay.style.willChange = 'transform';
            frame.style.pointerEvents = 'none';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        };
        overlay._documentMouseMoveHandler = (e) => {
            if (!isDragging || overlay._disposed) return;
            targetX = Math.max(0, Math.min(e.clientX - dragOffsetX, window.innerWidth - overlay.offsetWidth));
            targetY = Math.max(0, Math.min(e.clientY - dragOffsetY, window.innerHeight - overlay.offsetHeight));
            queuePaint();
        };
        overlay._documentMouseUpHandler = () => {
            if (!isDragging || overlay._disposed) return;
            isDragging = false;
            if (overlay._rafId !== null) { cancelAnimationFrame(overlay._rafId); overlay._rafId = null; }
            overlay.style.transform = 'translate(0px, 0px)';
            overlay.style.left = `${targetX}px`;
            overlay.style.top = `${targetY}px`;
            overlay.style.willChange = '';
            frame.style.pointerEvents = 'auto';
            document.body.style.userSelect = '';
        };

        overlay.addEventListener('mousedown', overlay._overlayMouseDownHandler);
        frame.addEventListener('load', overlay._frameResizeLoadHandler);
        close.addEventListener('click', overlay._closeClickHandler);
        header.addEventListener('mousedown', overlay._headerMouseDownHandler);
        document.addEventListener('mousemove', overlay._documentMouseMoveHandler);
        document.addEventListener('mouseup', overlay._documentMouseUpHandler);

        header.append(title, close);
        overlay.append(header, frame);
        document.body.appendChild(overlay);
        overlays.add(overlay);
    }

    function createAttackButtons() {
        if (!location.href.includes('itemID')) return;
        document.querySelectorAll('li[class*="rowWrapper"]:not([data-attack-processed])').forEach((row) => {
            row.dataset.attackProcessed = 'true';
            if (row.querySelector('[class*="anonymous"]')) return;
            const profileLink = row.querySelector('a[href*="profiles.php?XID="]');
            const priceElement = row.querySelector('[class*="price"]');
            const match = profileLink?.href.match(/XID=(\d+)/);
            if (!priceElement || !match) return;

            const button = document.createElement('a');
            button.href = '#';
            button.innerText = 'ATTACK';
            button.dataset.attackUrl = `https://www.torn.com/page.php?sid=attack&user2ID=${match[1]}`;
            setStyles(button, {
                'background': '#c62828', 'color': '#fff',
                'padding': '0 6px', 'border-radius': '4px',
                'font-size': '11px', 'font-weight': '700',
                'text-decoration': 'none', 'display': 'inline-flex',
                'align-items': 'center', 'justify-content': 'center',
                'height': '22px', 'line-height': '22px',
                'flex-shrink': '1', 'white-space': 'nowrap',
                'cursor': 'pointer', 'box-sizing': 'border-box'
            });

            const wrapper = document.createElement('div');
            setStyles(wrapper, {
                'display': 'inline-flex', 'align-items': 'center',
                'flex-shrink': '1', 'min-width': '0',
                'margin-left': '4px', 'margin-right': '4px'
            });
            wrapper.appendChild(button);
            priceElement.before(wrapper);
        });
    }

    function handleLocationMaybeChanged() {
        const currentUrl = location.href;
        if (currentUrl === previousUrl) return;
        const prev = new URL(previousUrl);
        const curr = new URL(currentUrl);
        if (curr.searchParams.get('sid') !== 'ItemMarket' ||
            !curr.searchParams.has('itemID') ||
            prev.searchParams.get('itemID') !== curr.searchParams.get('itemID')) {
            clearAllOverlays();
        }
        previousUrl = currentUrl;
    }

    function installLocationChangeHooks() {
        const onChange = debounce(handleLocationMaybeChanged, 50);
        const wrap = (method) => {
            const orig = history[method];
            history[method] = function () { const r = orig.apply(this, arguments); onChange(); return r; };
        };
        wrap('pushState');
        wrap('replaceState');
        window.addEventListener('popstate', onChange);
    }

    function installMarketObserver() {
        const start = () => {
            if (!document.body) return;
            createAttackButtons();
            new MutationObserver(debounce(createAttackButtons, 50)).observe(document.body, { childList: true, subtree: true });
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start, { once: true });
        } else {
            start();
        }
    }

    document.addEventListener('click', (e) => {
        const button = e.target.closest('a[data-attack-url]');
        if (!button) return;
        e.preventDefault();
        createOverlay(button.dataset.attackUrl);
    });

    installLocationChangeHooks();
    installMarketObserver();
})();