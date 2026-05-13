// ==UserScript==
// @name         Torn Market Attack Buttons
// @namespace    http://tampermonkey.net/
// @version      6.1
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
    let audioCtx = null;

    function setStyles(el, styles, important = false) {
        if (!el) return;
        for (const [prop, value] of Object.entries(styles)) {
            el.style.setProperty(prop, value, important ? 'important' : '');
        }
    }

    function ensureReadyStyles() {
        if (document.getElementById('attack-overlay-ready-styles')) return;

        const style = document.createElement('style');
        style.id = 'attack-overlay-ready-styles';
        style.textContent = `
            @keyframes attack-ready-pulse {
                0% {
                    box-shadow: 0 0 0 0 rgba(57, 255, 120, 0.85), 0 8px 20px rgba(0,0,0,0.5);
                }
                70% {
                    box-shadow: 0 0 0 8px rgba(57, 255, 120, 0), 0 8px 20px rgba(0,0,0,0.5);
                }
                100% {
                    box-shadow: 0 0 0 0 rgba(57, 255, 120, 0), 0 8px 20px rgba(0,0,0,0.5);
                }
            }

            .attack-overlay-ready {
                border-color: #39ff78 !important;
                animation: attack-ready-pulse 1s infinite;
            }
        `;
        document.head.appendChild(style);
    }

    function getAudioContext() {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!audioCtx) audioCtx = new Ctx();
        return audioCtx;
    }

    function playReadyBeep() {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;

            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }

            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);

            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.2);
        } catch (err) {
            console.log('[AttackButtons] Could not play ready beep:', err);
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

            syncAttackIframeUi();

            new MutationObserver(syncAttackIframeUi).observe(document.body, {
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

    ensureReadyStyles();

    const overlays = new Set();
    const resizeTimers = new WeakMap();
    let highestZ = 999999;
    let previousUrl = location.href;

    const getCurrentItemId = () => new URL(location.href).searchParams.get('itemID');

    const isSameItemMarketView = () => {
        const url = new URL(location.href);
        return url.searchParams.get('sid') === 'ItemMarket' && url.searchParams.has('itemID');
    };

    function markOverlayReady(overlay, ready) {
        if (!overlay) return;

        if (ready) {
            if (!overlay.dataset.readyShown) {
                overlay.dataset.readyShown = 'true';
                playReadyBeep();
            }
            overlay.classList.add('attack-overlay-ready');
        } else {
            delete overlay.dataset.readyShown;
            overlay.classList.remove('attack-overlay-ready');
        }
    }

    function clearAllOverlays() {
        overlays.forEach((overlay) => {
            const frame = overlay.querySelector('iframe');
            if (frame) frame.src = 'about:blank';

            const timer = resizeTimers.get(overlay);
            if (timer) {
                clearInterval(timer);
                resizeTimers.delete(overlay);
            }

            if (overlay._rowObserver) {
                overlay._rowObserver.disconnect();
                overlay._rowObserver = null;
            }

            if (overlay._iframeButtonObserver) {
                overlay._iframeButtonObserver.disconnect();
                overlay._iframeButtonObserver = null;
            }

            markOverlayReady(overlay, false);
            overlay.remove();
        });

        overlays.clear();
    }

    const bringToFront = (overlay) => {
        highestZ += 1;
        overlay.style.zIndex = String(highestZ);
    };

    function resizeOverlayToIframe(overlay, frame) {
        if (!overlay || !frame) return;

        try {
            const doc = frame.contentDocument || frame.contentWindow.document;
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
            if (!document.body.contains(overlay)) {
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
    function startOverlayTimer(overlay) {
        if (!overlay?._title || overlay._timerStarted) return;

        overlay._timerStarted = true;

        let seconds = 0;

        const update = () => {
            const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
            const secs = String(seconds % 60).padStart(2, '0');

            overlay._title.textContent = `Attack ${mins}:${secs}`;
        };

        update();

        overlay._timerInterval = setInterval(() => {
            seconds++;
            update();
        }, 1000);
    }

    function setIframeAttackButtonDisabled(overlay, disabled) {
        if (!overlay) return;

        try {
            const frame = overlay.querySelector('iframe');
            const doc = frame?.contentDocument || frame?.contentWindow?.document;
            if (!doc) return;

            const button = doc.querySelector('[class^="dialogButtons___"] > button');
            if (!button) return;

            const wasDisabled = button.disabled;

            button.disabled = disabled;

            if (disabled) {
                button.setAttribute('aria-disabled', 'true');
                button.style.opacity = '0.5';
                button.style.cursor = 'not-allowed';
                button.style.pointerEvents = 'none';
                button.title = 'Wait until the market row is gone.';
                markOverlayReady(overlay, false);
            } else {
                button.disabled = false;
                button.removeAttribute('aria-disabled');
                button.style.opacity = '';
                button.style.cursor = '';
                button.style.pointerEvents = '';
                button.title = '';
                if (wasDisabled) {
                    markOverlayReady(overlay, true);
                    startOverlayTimer(overlay);
                }
            }
        } catch (err) {
            console.log('[AttackButtons] Could not set iframe attack button state:', err);
        }
    }

    function watchSourceRowForOverlay(overlay, row) {
        if (!overlay || !row || !document.body) return;

        if (overlay._rowObserver) {
            overlay._rowObserver.disconnect();
        }

        const observer = new MutationObserver(() => {
            const overlayStillExists = document.body.contains(overlay);
            if (!overlayStillExists) {
                observer.disconnect();
                return;
            }

            const rowStillExists = document.body.contains(row);
            setIframeAttackButtonDisabled(overlay, rowStillExists);

            if (!rowStillExists) {
                observer.disconnect();
                overlay._rowObserver = null;
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        overlay._rowObserver = observer;
        setIframeAttackButtonDisabled(overlay, true);
    }

    function monitorIframeAttackButton(overlay, row) {
        const frame = overlay.querySelector('iframe');
        if (!frame) return;

        frame.addEventListener('load', () => {
            const rowStillExists = document.body.contains(row);
            setIframeAttackButtonDisabled(overlay, rowStillExists);

            if (rowStillExists) {
                watchSourceRowForOverlay(overlay, row);
            } else {
                markOverlayReady(overlay, true);
            }

            try {
                const doc = frame.contentDocument || frame.contentWindow.document;
                if (!doc?.body) return;

                if (overlay._iframeButtonObserver) {
                    overlay._iframeButtonObserver.disconnect();
                }

                const iframeObserver = new MutationObserver(() => {
                    const sourceRowStillExists = document.body.contains(row);
                    setIframeAttackButtonDisabled(overlay, sourceRowStillExists);
                });

                iframeObserver.observe(doc.body, {
                    childList: true,
                    subtree: true
                });

                overlay._iframeButtonObserver = iframeObserver;
            } catch (err) {
                console.log('[AttackButtons] Could not observe iframe button:', err);
            }
        });
    }

    function createOverlay(url, sourceRow) {
        const overlay = document.createElement('div');
        const startX = 70 + overlays.size * 18;
        const startY = 70 + overlays.size * 18;

        overlay._sourceRow = sourceRow || null;
        overlay._rowObserver = null;
        overlay._iframeButtonObserver = null;

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
            'resize': 'horizontal',
            'will-change': 'transform'
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
        title.textContent = 'Attack 00:00';
        overlay._title = title;

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

        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let baseX = startX;
        let baseY = startY;
        let targetX = startX;
        let targetY = startY;
        let rafId = null;

        const paint = () => {
            rafId = null;
            overlay.style.transform = `translate(${targetX - baseX}px, ${targetY - baseY}px)`;
        };

        const queuePaint = () => {
            if (rafId !== null) return;
            rafId = requestAnimationFrame(paint);
        };

        overlay.addEventListener('mousedown', () => bringToFront(overlay));

        frame.addEventListener('load', () => {
            resizeOverlayToIframe(overlay, frame);
            scheduleResizeChecks(overlay, frame);
        });

        close.addEventListener('click', () => {
            const timer = resizeTimers.get(overlay);
            if (timer) {
                clearInterval(timer);
                resizeTimers.delete(overlay);
            }

            if (overlay._rowObserver) {
                overlay._rowObserver.disconnect();
                overlay._rowObserver = null;
            }

            if (overlay._iframeButtonObserver) {
                overlay._iframeButtonObserver.disconnect();
                overlay._iframeButtonObserver = null;
            }

            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }

            markOverlayReady(overlay, false);
            frame.src = 'about:blank';
            overlays.delete(overlay);
            overlay.remove();
        });

        header.addEventListener('mousedown', (e) => {
            bringToFront(overlay);
            isDragging = true;

            const rect = overlay.getBoundingClientRect();
            baseX = rect.left;
            baseY = rect.top;
            targetX = rect.left;
            targetY = rect.top;
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;

            frame.style.pointerEvents = 'none';
            document.body.style.userSelect = 'none';

            e.preventDefault();
        });

        const onMouseMove = (e) => {
            if (!isDragging) return;

            const maxLeft = window.innerWidth - overlay.offsetWidth;
            const maxTop = window.innerHeight - overlay.offsetHeight;

            targetX = Math.max(0, Math.min(e.clientX - dragOffsetX, Math.max(0, maxLeft)));
            targetY = Math.max(0, Math.min(e.clientY - dragOffsetY, Math.max(0, maxTop)));

            queuePaint();
        };

        const onMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;

            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }

            overlay.style.transform = 'translate(0px, 0px)';
            overlay.style.left = `${targetX}px`;
            overlay.style.top = `${targetY}px`;

            frame.style.pointerEvents = 'auto';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        header.append(title, close);
        overlay.append(header, frame);
        document.body.appendChild(overlay);
        overlays.add(overlay);

        if (sourceRow) {
            monitorIframeAttackButton(overlay, sourceRow);
        }
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
        const wrapHistoryMethod = (methodName) => {
            const original = history[methodName];
            history[methodName] = function () {
                const result = original.apply(this, arguments);
                handleLocationMaybeChanged();
                return result;
            };
        };

        wrapHistoryMethod('pushState');
        wrapHistoryMethod('replaceState');

        window.addEventListener('popstate', handleLocationMaybeChanged);
        new MutationObserver(handleLocationMaybeChanged).observe(document, { subtree: true, childList: true });
    }

    function installMarketObserver() {
        const start = () => {
            createAttackButtons();
            if (!document.body) return;

            new MutationObserver(createAttackButtons).observe(document.body, {
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

        const row = button.closest('li[class*="rowWrapper"]');
        if (!row) return;

        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }

        createOverlay(button.dataset.attackUrl, row);
    });

    installLocationChangeHooks();
    installMarketObserver();
})();