// ==UserScript==
// @name         Torn Market Attack Buttons
// @namespace    http://tampermonkey.net/
// @version      7.1
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://www.torn.com/page.php?sid=attack*
// @description  Adds attack buttons to Item Market listings and opens them as a floating overlay, new tab, or in-page
// @author       AlbertoStegeman
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @run-at       document-start
// ==/UserScript==
(function () {
    'use strict';

    const isAttackPage = location.href.includes('sid=attack');
    const isMarketPage = location.href.includes('sid=ItemMarket');
    const isTornPDA = /tornpda/i.test(navigator.userAgent);

    const isInIframe = (() => {
        try {
            return window.self !== window.top;
        } catch {
            return true;
        }
    })();

    // ─── GM API wrappers with localStorage fallback for Torn PDA ───────────────

    function getValue(key, defaultValue) {
        if (typeof GM_getValue !== 'undefined') {
            return GM_getValue(key, defaultValue);
        }
        return localStorage.getItem(key) ?? defaultValue;
    }

    function setValue(key, value) {
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue(key, value);
        } else {
            localStorage.setItem(key, value);
        }
    }

    // ─── Attack mode settings ───────────────────────────────────────────────────

    const ATTACK_MODES = [
        { value: 'overlay',     label: 'Floating window',     desc: 'Opens on top of the market page' },
        { value: 'new-tab',     label: 'New tab',             desc: 'Switches to the new tab' },
        { value: 'new-tab-bg',  label: 'New tab (stay here)', desc: 'Opens quietly in the background' },
        { value: 'current-tab', label: 'This tab',            desc: 'Leaves the market page' },
    ];

    let menuIds = [];

    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand === 'undefined') return;

        menuIds.forEach(id => GM_unregisterMenuCommand(id));
        menuIds = [];

        const current = getValue('attackMode', 'overlay');

        ATTACK_MODES.forEach(({ value, label }) => {
            const id = GM_registerMenuCommand(
                `${current === value ? '✓' : '　'} Open attack as: ${label}`,
                () => {
                    setValue('attackMode', value);
                    registerMenuCommands();
                }
            );
            menuIds.push(id);
        });
    }

    registerMenuCommands();

    // ─── Shared utilities ───────────────────────────────────────────────────────

    const REMOVE_SELECTORS = [
        '[class^="logStatsWrap___"]',
        '[class^="log___"]',
        '#header-root'
    ];

    const HIDE_SELECTORS = [
        ...REMOVE_SELECTORS,
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
            document.querySelectorAll(REMOVE_SEL).forEach(el => el.remove());
            document.querySelector('.content-wrapper.logged-out.spring')
                ?.style.setProperty('margin-bottom', '0', 'important');
        };

        injectStyles();

        const startObserver = () => {
            if (!document.body) return;
            syncAttackIframeUi();
            new MutationObserver(debounce(syncAttackIframeUi, 25)).observe(document.body, {
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

    // ─── Market page ────────────────────────────────────────────────────────────

    const overlays = new Set();
    const resizeTimers = new WeakMap();
    let highestZ = 999999;
    let previousUrl = location.href;

    // Shared drag state — only one overlay can be dragged at a time
    let dragState = null;

    document.addEventListener('mousemove', (e) => {
        if (!dragState) return;

        const { overlay, offsetX, offsetY } = dragState;

        if (overlay._disposed) {
            dragState = null;
            return;
        }

        dragState.targetX = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - overlay.offsetWidth));
        dragState.targetY = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - overlay.offsetHeight));

        if (dragState.rafId === null) {
            dragState.rafId = requestAnimationFrame(() => {
                dragState.rafId = null;
                if (dragState) {
                    overlay.style.transform = `translate(${dragState.targetX - dragState.baseX}px, ${dragState.targetY - dragState.baseY}px)`;
                }
            });
        }
    });

    document.addEventListener('mouseup', () => {
        if (!dragState) return;

        const { overlay } = dragState;

        if (dragState.rafId !== null) {
            cancelAnimationFrame(dragState.rafId);
            dragState.rafId = null;
        }

        if (!overlay._disposed) {
            overlay.style.transform = 'translate(0px, 0px)';
            overlay.style.left = `${dragState.targetX}px`;
            overlay.style.top = `${dragState.targetY}px`;
            overlay.style.willChange = '';
            overlay._frame.style.pointerEvents = 'auto';
        }

        document.body.style.userSelect = '';
        dragState = null;
    });

    function disposeOverlay(overlay) {
        if (!overlay || overlay._disposed) return;
        overlay._disposed = true;

        const { _frame: frame, _header: header, _closeButton: close } = overlay;

        resizeTimers.get(overlay)?.disconnect();
        resizeTimers.delete(overlay);

        frame?.removeEventListener('load', overlay._frameResizeLoadHandler);
        overlay.removeEventListener('mousedown', overlay._overlayMouseDownHandler);
        close?.removeEventListener('click', overlay._closeClickHandler);
        header?.removeEventListener('mousedown', overlay._headerMouseDownHandler);

        if (dragState?.overlay === overlay) {
            dragState = null;
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
        resizeTimers.get(overlay)?.disconnect();
        resizeTimers.delete(overlay);

        try {
            const doc = frame.contentDocument || frame.contentWindow?.document;
            if (!doc?.body) return;

            const ro = new ResizeObserver(() => {
                if (overlay._disposed) {
                    ro.disconnect();
                    resizeTimers.delete(overlay);
                    return;
                }
                resizeOverlayToIframe(overlay, frame);
            });

            ro.observe(doc.body);
            resizeTimers.set(overlay, ro);
        } catch {
            // cross-origin: single resize attempt on load is sufficient
        }
    }

    function createOverlay(url) {
        const offset = overlays.size * 18;
        const startX = 70 + offset;
        const startY = 70 + offset;

        const overlay = document.createElement('div');
        overlay._disposed = false;

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

        const onOverlayMouseDown = () => {
            bringToFront(overlay);
        };

        const onFrameLoad = () => {
            if (!overlay._disposed) {
                resizeOverlayToIframe(overlay, frame);
                scheduleResizeChecks(overlay, frame);
            }
        };

        const onCloseClick = () => {
            disposeOverlay(overlay);
        };

        const onHeaderMouseDown = (e) => {
            if (overlay._disposed) return;

            bringToFront(overlay);

            const rect = overlay.getBoundingClientRect();
            dragState = {
                overlay,
                offsetX: e.clientX - rect.left,
                offsetY: e.clientY - rect.top,
                baseX: rect.left,
                baseY: rect.top,
                targetX: rect.left,
                targetY: rect.top,
                rafId: null
            };

            overlay.style.willChange = 'transform';
            frame.style.pointerEvents = 'none';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        };

        overlay._overlayMouseDownHandler = onOverlayMouseDown;
        overlay._frameResizeLoadHandler = onFrameLoad;
        overlay._closeClickHandler = onCloseClick;
        overlay._headerMouseDownHandler = onHeaderMouseDown;

        overlay.addEventListener('mousedown', onOverlayMouseDown);
        frame.addEventListener('load', onFrameLoad);
        close.addEventListener('click', onCloseClick);
        header.addEventListener('mousedown', onHeaderMouseDown);

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
            button.textContent = 'ATTACK';
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

        const prev = new URL(previousUrl);
        const curr = new URL(currentUrl);

        if (
            curr.searchParams.get('sid') !== 'ItemMarket' ||
            !curr.searchParams.has('itemID') ||
            prev.searchParams.get('itemID') !== curr.searchParams.get('itemID')
        ) {
            clearAllOverlays();
        }

        previousUrl = currentUrl;
    }

    function installLocationChangeHooks() {
        const onChange = debounce(handleLocationMaybeChanged, 50);

        const wrap = (method) => {
            const orig = history[method];
            history[method] = function () {
                const result = orig.apply(this, arguments);
                onChange();
                return result;
            };
        };

        wrap('pushState');
        wrap('replaceState');
        window.addEventListener('popstate', onChange);
    }

    function installMarketObserver() {
        const start = () => {
            if (!document.body) return;

            createAttackButtons();

            const marketList = document.querySelector('[class*="sellerList"]');
            const observeTarget = marketList ?? document.body;

            new MutationObserver(debounce(createAttackButtons, 50)).observe(observeTarget, {
                childList: true,
                subtree: !marketList
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

        const url = button.dataset.attackUrl;

        if (isTornPDA) {
            window.open(url, '_blank');
            return;
        }

        const mode = getValue('attackMode', 'overlay');

        if (mode === 'overlay') {
            createOverlay(url);
        } else if (mode === 'new-tab') {
            GM_openInTab(url, { active: true });
        } else if (mode === 'new-tab-bg') {
            GM_openInTab(url, { active: false });
        } else {
            location.href = url;
        }
    });

    installLocationChangeHooks();
    installMarketObserver();
})();
