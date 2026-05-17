// ==UserScript==
// @name         Torn Market Attack Buttons
// @namespace    http://tampermonkey.net/
// @version      6.6
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
    const isInIframe = (() => {
        try {
            return window.self !== window.top;
        } catch {
            return true;
        }
    })();

    const REMOVE_SELECTORS = [
        '[class^="logStatsWrap___"]',
        '[class^="log___"]',
        '#header-root'
    ];

    const CHAT_SELECTORS = [
        '[class*="chatRoot"]',
        '[class*="chat-app"]',
        '[class*="chatBox"]',
        '[class*="chat-box"]',
        '[class*="chatWindow"]',
        '[class*="chat-window"]',
        '[class*="chatWrapper"]',
        '[class*="chat-wrapper"]',
        '[class*="chatSettings"]',
        '[class*="chat-settings"]',
        '[class*="chatIcons"]',
        '[class*="chat-icons"]',
        '[class*="messagesWrapper"]',
        '[class*="messagePanel"]',
        '[class*="conversation"]',
        '[class*="newChat"]',
        '[class*="floatingChat"]',
        '[id*="chat"]'
    ];

    const REMOVE_SELECTOR_STRING = REMOVE_SELECTORS.join(', ');
    const HIDE_SELECTOR_STRING = [...REMOVE_SELECTORS, ...CHAT_SELECTORS].join(', ');

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

    function removeStoredListener(target, eventName, handler, options) {
        if (target && handler) {
            target.removeEventListener(eventName, handler, options);
        }
    }

    if (isAttackPage) {
        if (!isInIframe) return;

        const styleId = 'attack-hide-ui-early';
        const css = `
            ${HIDE_SELECTOR_STRING} {
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

            .content-wrapper.logged-out.spring {
                margin-bottom: 0 !important;
            }

            html, body {
                overflow: hidden !important;
            }
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
                'display': 'block',
                'visibility': 'visible',
                'opacity': '1',
                'pointer-events': 'auto',
                'height': 'auto',
                'max-height': 'none',
                'overflow': 'visible'
            }, true);
        };

        const syncAttackIframeUi = () => {
            moveScouterBeforePlayersModel();
            document.querySelectorAll(REMOVE_SELECTOR_STRING).forEach(el => el.remove());

            const contentWrapper = document.querySelector('.content-wrapper.logged-out.spring');
            if (contentWrapper) {
                contentWrapper.style.setProperty('margin-bottom', '0', 'important');
            }
        };

        injectStyles();

        const startObserver = () => {
            if (!document.body) return;

            const debouncedSyncAttackIframeUi = debounce(syncAttackIframeUi, 25);

            syncAttackIframeUi();

            new MutationObserver(debouncedSyncAttackIframeUi).observe(document.body, {
                childList: true,
                subtree: true
            });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startObserver, { once: true });
        } else {
            startObserver();
        }

        return;
    }

    if (!isMarketPage) return;

    const overlays = new Set();
    const resizeTimers = new WeakMap();
    let highestZ = 999999;
    let previousUrl = location.href;

    const getCurrentItemId = () => new URL(location.href).searchParams.get('itemID');

    const isSameItemMarketView = () => {
        const url = new URL(location.href);
        return url.searchParams.get('sid') === 'ItemMarket' && url.searchParams.has('itemID');
    };

    function disposeOverlay(overlay) {
        if (!overlay || overlay._disposed) return;
        overlay._disposed = true;

        const frame = overlay._frame || overlay.querySelector('iframe');
        const header = overlay._header || null;
        const close = overlay._closeButton || null;

        const resizeTimer = resizeTimers.get(overlay);
        if (resizeTimer) {
            clearInterval(resizeTimer);
            resizeTimers.delete(overlay);
        }

        removeStoredListener(frame, 'load', overlay._frameResizeLoadHandler);
        removeStoredListener(overlay, 'mousedown', overlay._overlayMouseDownHandler);
        removeStoredListener(close, 'click', overlay._closeClickHandler);
        removeStoredListener(header, 'mousedown', overlay._headerMouseDownHandler);
        removeStoredListener(document, 'mousemove', overlay._documentMouseMoveHandler);
        removeStoredListener(document, 'mouseup', overlay._documentMouseUpHandler);

        overlay._frameResizeLoadHandler = null;
        overlay._overlayMouseDownHandler = null;
        overlay._closeClickHandler = null;
        overlay._headerMouseDownHandler = null;
        overlay._documentMouseMoveHandler = null;
        overlay._documentMouseUpHandler = null;

        if (overlay._rafId !== null && overlay._rafId !== undefined) {
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

    function clearAllOverlays() {
        overlays.forEach(disposeOverlay);
    }

    function bringToFront(overlay) {
        highestZ += 1;
        overlay.style.zIndex = String(highestZ);
    }

    function resizeOverlayToIframe(overlay, frame) {
        if (!overlay || !frame || overlay._disposed) return;

        try {
            const doc = frame.contentDocument || frame.contentWindow?.document;
            if (!doc?.body || !doc?.documentElement) return;

            const { body, documentElement: html } = doc;
            const contentHeight = Math.max(
                body.scrollHeight,
                body.offsetHeight,
                html.scrollHeight,
                html.offsetHeight,
                html.clientHeight
            );

            const headerHeight = 28;
            overlay.style.height = `${Math.max(220, contentHeight + headerHeight)}px`;
            frame.style.height = `${contentHeight}px`;
        } catch (err) {
            console.log('[AttackButtons] Could not resize overlay to iframe:', err);
        }
    }

    function scheduleResizeChecks(overlay, frame) {
        const oldTimer = resizeTimers.get(overlay);
        if (oldTimer) clearInterval(oldTimer);

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
        const overlay = document.createElement('div');
        const startX = 70 + overlays.size * 18;
        const startY = 70 + overlays.size * 18;

        overlay._disposed = false;
        overlay._rafId = null;

        setStyles(overlay, {
            'position': 'fixed',
            'left': `${startX}px`,
            'top': `${startY}px`,
            'width': '340px',
            'height': '420px',
            'min-width': '260px',
            'min-height': '220px',
            'background': '#111',
            'border': '1px solid #444',
            'border-radius': '6px',
            'box-shadow': '0 8px 20px rgba(0,0,0,0.5)',
            'display': 'block',
            'overflow': 'hidden',
            'resize': 'horizontal'
        });
        bringToFront(overlay);

        const header = document.createElement('div');
        setStyles(header, {
            'height': '28px',
            'background': '#222',
            'color': '#fff',
            'display': 'flex',
            'align-items': 'center',
            'justify-content': 'space-between',
            'padding': '0 8px',
            'cursor': 'move',
            'font-weight': '700',
            'font-size': '11px',
            'user-select': 'none'
        });

        const title = document.createElement('span');
        title.textContent = 'Attack';

        const close = document.createElement('button');
        close.textContent = '✕';
        setStyles(close, {
            'background': '#c62828',
            'color': '#fff',
            'border': 'none',
            'border-radius': '3px',
            'padding': '1px 6px',
            'font-size': '11px',
            'cursor': 'pointer',
            'line-height': '16px',
            'margin-left': 'auto'
        });

        const frame = document.createElement('iframe');
        setStyles(frame, {
            'display': 'block',
            'width': '100%',
            'height': '392px',
            'border': 'none',
            'background': '#000',
            'overflow': 'hidden'
        });
        frame.setAttribute('scrolling', 'no');
        frame.loading = 'eager';
        frame.src = url;

        overlay._header = header;
        overlay._closeButton = close;
        overlay._frame = frame;

        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let baseX = startX;
        let baseY = startY;
        let targetX = startX;
        let targetY = startY;

        const paint = () => {
            overlay._rafId = null;
            if (overlay._disposed) return;
            overlay.style.transform = `translate(${targetX - baseX}px, ${targetY - baseY}px)`;
        };

        const queuePaint = () => {
            if (overlay._disposed || overlay._rafId !== null) return;
            overlay._rafId = requestAnimationFrame(paint);
        };

        const onOverlayMouseDown = () => {
            bringToFront(overlay);
        };

        const onFrameResizeLoad = () => {
            if (overlay._disposed) return;
            resizeOverlayToIframe(overlay, frame);
            scheduleResizeChecks(overlay, frame);
        };

        const onCloseClick = () => {
            disposeOverlay(overlay);
        };

        const onHeaderMouseDown = (e) => {
            if (overlay._disposed) return;

            bringToFront(overlay);
            isDragging = true;

            const rect = overlay.getBoundingClientRect();
            baseX = rect.left;
            baseY = rect.top;
            targetX = rect.left;
            targetY = rect.top;
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;

            overlay.style.willChange = 'transform';
            frame.style.pointerEvents = 'none';
            document.body.style.userSelect = 'none';

            e.preventDefault();
        };

        const onMouseMove = (e) => {
            if (!isDragging || overlay._disposed) return;

            const maxLeft = window.innerWidth - overlay.offsetWidth;
            const maxTop = window.innerHeight - overlay.offsetHeight;

            targetX = Math.max(0, Math.min(e.clientX - dragOffsetX, Math.max(0, maxLeft)));
            targetY = Math.max(0, Math.min(e.clientY - dragOffsetY, Math.max(0, maxTop)));

            queuePaint();
        };

        const onMouseUp = () => {
            if (!isDragging || overlay._disposed) return;
            isDragging = false;

            if (overlay._rafId !== null) {
                cancelAnimationFrame(overlay._rafId);
                overlay._rafId = null;
            }

            overlay.style.transform = 'translate(0px, 0px)';
            overlay.style.left = `${targetX}px`;
            overlay.style.top = `${targetY}px`;
            overlay.style.willChange = '';

            frame.style.pointerEvents = 'auto';
            document.body.style.userSelect = '';
        };

        overlay._overlayMouseDownHandler = onOverlayMouseDown;
        overlay._frameResizeLoadHandler = onFrameResizeLoad;
        overlay._closeClickHandler = onCloseClick;
        overlay._headerMouseDownHandler = onHeaderMouseDown;
        overlay._documentMouseMoveHandler = onMouseMove;
        overlay._documentMouseUpHandler = onMouseUp;

        overlay.addEventListener('mousedown', onOverlayMouseDown);
        frame.addEventListener('load', onFrameResizeLoad);
        close.addEventListener('click', onCloseClick);
        header.addEventListener('mousedown', onHeaderMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        header.append(title, close);
        overlay.append(header, frame);
        document.body.appendChild(overlay);
        overlays.add(overlay);
    }

    function createAttackButtons() {
        if (!location.href.includes('itemID')) return;

        document.querySelectorAll('li[class*="rowWrapper"]').forEach((row) => {
            if (row.dataset.attackProcessed) return;
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
                'background': '#c62828',
                'color': '#fff',
                'padding': '0 6px',
                'border-radius': '4px',
                'font-size': '11px',
                'font-weight': '700',
                'text-decoration': 'none',
                'display': 'inline-flex',
                'align-items': 'center',
                'justify-content': 'center',
                'height': '22px',
                'line-height': '22px',
                'flex-shrink': '1',
                'white-space': 'nowrap',
                'cursor': 'pointer',
                'text-align': 'center',
                'box-sizing': 'border-box'
            });

            const wrapper = document.createElement('div');
            setStyles(wrapper, {
                'display': 'inline-flex',
                'align-items': 'center',
                'flex-shrink': '1',
                'min-width': '0',
                'margin-left': '4px',
                'margin-right': '4px'
            });

            wrapper.appendChild(button);
            priceElement.before(wrapper);
        });
    }

    function handleLocationMaybeChanged() {
        const currentUrl = location.href;
        if (currentUrl === previousUrl) return;

        const previousItemId = new URL(previousUrl).searchParams.get('itemID');
        const currentItemId = getCurrentItemId();

        if (!isSameItemMarketView() || previousItemId !== currentItemId) {
            clearAllOverlays();
        }

        previousUrl = currentUrl;
    }

    function installLocationChangeHooks() {
        const debouncedHandleLocationMaybeChanged = debounce(handleLocationMaybeChanged, 50);

        const wrapHistoryMethod = (methodName) => {
            const original = history[methodName];
            history[methodName] = function () {
                const result = original.apply(this, arguments);
                debouncedHandleLocationMaybeChanged();
                return result;
            };
        };

        wrapHistoryMethod('pushState');
        wrapHistoryMethod('replaceState');

        window.addEventListener('popstate', debouncedHandleLocationMaybeChanged);
    }

    function installMarketObserver() {
        const start = () => {
            const debouncedCreateAttackButtons = debounce(createAttackButtons, 50);

            createAttackButtons();
            if (!document.body) return;

            new MutationObserver(debouncedCreateAttackButtons).observe(document.body, {
                childList: true,
                subtree: true
            });
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