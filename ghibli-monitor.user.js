// ==UserScript==
// @name         Ghibli Museum — Ticket Monitor + Autofill
// @namespace    https://github.com/systemfifteen/japonsko-2026
// @version      1.5
// @description  Zvýrazní dostupné lístky na Lawson Ticket, autofill formulára, zvuk + browser notifikácie + Telegram alert
// @author       systemfifteen
// @match        https://l-tike.com/st1/ghibli-en/*
// @grant        GM_xmlhttpRequest
// @connect      api.telegram.org
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // ⚙️  KONFIGURÁCIA — doplň svoje údaje
    // ═══════════════════════════════════════════════════════════════
    const MY_DATA = {
        name:        'Your Name',              // ← meno presne ako v pase
        phone:       '00421xxxxxxxxx',         // ← telefón s predvoľbou, napr. 00421905xxxxxx
        email:       'your@email.com',         // ← emailová adresa
        email2:      'your@email.com',         // ← potvrdenie emailu (rovnaké)
        count:       '2',                      // ← počet lístkov
    };

    // ─── Telegram (voliteľné — nechaj prázdne ak nechceš) ────────
    const TELEGRAM_TOKEN   = '';               // ← Bot token z @BotFather
    const TELEGRAM_CHAT_ID = '';              // ← tvoje chat ID (zisti cez @userinfobot)

    // ─── Preferované dni (formát 'DD') — prázdne = sleduj všetko ─
    const PREFERRED_DAYS   = ['08', '09', '10']; // napr. máj 8–10
    // ═══════════════════════════════════════════════════════════════

    // ─── Nastavenia ───────────────────────────────────────────────
    const CHECK_INTERVAL_MS  = 8000;
    const SOUND_ENABLED      = true;
    const AUTO_RELOAD        = true;
    const RELOAD_INTERVAL_MS = 60000;

    // Sleduj už odoslané sloty — neopakuj notifikácie
    const telegramSent = new Set();

    // ─── Farby ────────────────────────────────────────────────────
    const COLOR_AVAILABLE = '#00c853';
    const COLOR_FEW_LEFT  = '#ff6f00';
    const COLOR_SOLD_OUT  = '#bdbdbd';

    // ─── Je element v legende? ────────────────────────────────────
    function isInLegend(el) {
        let node = el;
        while (node && node !== document.body) {
            const text = (node.textContent || '').trim();
            if (text.includes('Sales Status') && text.length < 200) return true;
            if (text.includes('○') && text.includes('△') && text.includes('×') && text.length < 300) return true;
            node = node.parentElement;
        }
        return false;
    }

    // ─── Obsahuje čas slotu? ──────────────────────────────────────
    function hasTimeSlot(text) {
        return /[○△×]\s*\d{1,2}:\d{2}/.test(text);
    }

    // ─── Zvuk ─────────────────────────────────────────────────────
    // Jeden zdieľaný AudioContext — prehliadač ho zablokuje kým
    // nie je "user gesture". Odblokujeme ho pri prvom pohybe myši.
    let audioCtx = null;

    function getAudioCtx() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function unlockAudio() {
        getAudioCtx();
        document.removeEventListener('mousemove', unlockAudio);
        document.removeEventListener('keydown', unlockAudio);
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
    }
    document.addEventListener('mousemove', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });

    function beep(frequency = 880, duration = 300, times = 3) {
        if (!SOUND_ENABLED) return;
        try {
            const ctx = getAudioCtx();
            for (let i = 0; i < times; i++) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = frequency;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.4);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.4 + duration / 1000);
                osc.start(ctx.currentTime + i * 0.4);
                osc.stop(ctx.currentTime + i * 0.4 + duration / 1000 + 0.05);
            }
        } catch (e) {}
    }

    // ─── Stavový panel ───────────────────────────────────────────
    function createStatusBar() {
        if (document.getElementById('ghibli-monitor-bar')) return;
        const bar = document.createElement('div');
        bar.id = 'ghibli-monitor-bar';
        bar.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
            background: #1a1a2e; color: #fff;
            font-family: monospace; font-size: 13px;
            padding: 7px 16px; display: flex; align-items: center; gap: 16px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        `;
        bar.innerHTML = `
            <span style="color:#e040fb;font-weight:bold">🎥 Ghibli Monitor</span>
            <span id="gm-status">⏳ Inicializujem...</span>
            <span id="gm-found" style="margin-left:auto"></span>
            <button id="gm-fill-btn" style="
                background:#1565c0;color:#fff;border:none;border-radius:4px;
                padding:3px 10px;cursor:pointer;font-size:12px;display:none;
            ">✏️ Autofill</button>
            <span id="gm-time" style="color:#888;font-size:11px"></span>
        `;
        document.body.prepend(bar);
        document.body.style.paddingTop = '38px';

        document.getElementById('gm-fill-btn').addEventListener('click', () => {
            autofillForm();
        });
    }

    function updateStatus(text, color = '#fff') {
        const el = document.getElementById('gm-status');
        if (el) { el.textContent = text; el.style.color = color; }
        const t = document.getElementById('gm-time');
        if (t) t.textContent = new Date().toLocaleTimeString('sk-SK');
    }

    function updateFound(text, color = '#fff') {
        const el = document.getElementById('gm-found');
        if (el) { el.textContent = text; el.style.color = color; }
    }

    // ─── Autofill ─────────────────────────────────────────────────
    // Nastaví hodnotu input poľa aj pre React/Vue/Angular stránky
    function setVal(el, value) {
        try {
            // Natívny setter — funguje aj pre React controlled inputs
            const proto = el.tagName === 'SELECT'
                ? window.HTMLSelectElement.prototype
                : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');
            if (nativeSetter && nativeSetter.set) {
                nativeSetter.set.call(el, value);
            } else {
                el.value = value;
            }
            // Dispatch events aby stránka zachytila zmenu
            ['input', 'change', 'blur'].forEach(evt => {
                el.dispatchEvent(new Event(evt, { bubbles: true }));
            });
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        } catch (e) {
            el.value = value;
        }
    }

    function autofillForm() {
        let filled = 0;
        const inputs = document.querySelectorAll('input, select, textarea');

        inputs.forEach(el => {
            if (el.type === 'hidden' || el.disabled || el.readOnly) return;

            const attr = [el.name, el.id, el.placeholder, el.getAttribute('autocomplete')]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            // ─ Meno ─
            if (/name|nam|jmeno|namae/.test(attr) && !/user|pass|mail/.test(attr)) {
                setVal(el, MY_DATA.name); filled++;
            }
            // ─ Telefón ─
            else if (/tel|phone|mobil|fon/.test(attr)) {
                setVal(el, MY_DATA.phone); filled++;
            }
            // ─ Email (prvý) ─
            else if (/mail/.test(attr) && !/confirm|2|second|re/.test(attr)) {
                setVal(el, MY_DATA.email); filled++;
            }
            // ─ Email potvrdenie ─
            else if (/mail/.test(attr) && /confirm|2|second|re/.test(attr)) {
                setVal(el, MY_DATA.email2); filled++;
            }
            // ─ Počet lístkov ─
            else if (/count|num|qty|quantity|ticket|ken/.test(attr)) {
                setVal(el, MY_DATA.count); filled++;
            }
        });

        // Fallback: ak nič nenašiel podľa atribútov, skús podľa poradia
        // (Lawson má typicky: 1.meno 2.telefón 3.email 4.email)
        if (filled === 0) {
            const textInputs = Array.from(inputs).filter(el =>
                ['text', 'email', 'tel', 'number', ''].includes(el.type) &&
                !el.disabled && !el.readOnly && el.type !== 'hidden'
            );
            const order = [MY_DATA.name, MY_DATA.phone, MY_DATA.email, MY_DATA.email2];
            textInputs.slice(0, order.length).forEach((el, i) => {
                setVal(el, order[i]); filled++;
            });
        }

        updateStatus(`✏️ Vyplnené ${filled} polí`, '#90caf9');
        setTimeout(() => updateStatus('👁 Monitorujem...', '#90caf9'), 3000);
    }

    // ─── Flash titulku ────────────────────────────────────────────
    let flashInterval = null;
    function flashTitle(alertTitle) {
        const original = document.title;
        let toggle = false;
        if (flashInterval) clearInterval(flashInterval);
        flashInterval = setInterval(() => {
            document.title = toggle ? alertTitle : original;
            toggle = !toggle;
        }, 800);
        setTimeout(() => { clearInterval(flashInterval); document.title = original; }, 30000);
    }

    // ─── Browser notifikácia ──────────────────────────────────────
    function showNotification(title, body) {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            new Notification(title, { body, icon: 'https://www.ghibli-museum.jp/favicon.ico' });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(p => {
                if (p === 'granted') new Notification(title, { body });
            });
        }
    }

    // ─── Telegram notifikácia ─────────────────────────────────────
    function sendTelegram(slots) {
        if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;

        const lines = slots.map(s => {
            const emoji = s.status === 'Available' ? '🟢' : '🟡';
            const label = s.status === 'Available' ? 'VOĽNÉ!' : 'posledné!';
            return `${emoji} <b>Máj ${s.day} — ${s.time}</b> ${label}`;
        });
        const message = [
            '🎥 <b>Ghibli Museum — LÍSTKY DOSTUPNÉ!</b>',
            '',
            ...lines,
            '',
            `🔗 <a href="https://l-tike.com/st1/ghibli-en/sitetop">Kúpiť lístky HNEĎ →</a>`,
            '',
            `⏰ Detekované: ${new Date().toLocaleTimeString('sk-SK')}`
        ].join('\n');

        GM_xmlhttpRequest({
            method: 'POST',
            url: `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
            onerror: () => console.warn('[Ghibli] Telegram send failed')
        });
    }

    // ─── Parsuj dispEvent zo stránky ──────────────────────────────
    // Lawson vkladá dostupnosť lístkov ako JS objekt priamo do HTML.
    // Parsujeme ho regexom (nie JSON.parse — má trailing commas).
    function parseDispEvent() {
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
            const blockMatch = s.textContent.match(/var dispEvent\s*=\s*\{([\s\S]*?)\}\s*;/);
            if (!blockMatch) continue;

            const results = [];
            const dayRegex = /"(\d{2})":\s*\[([^\]]*(?:\[[^\]]*\][^\]]*)*)\]/g;
            let dayMatch;
            while ((dayMatch = dayRegex.exec(blockMatch[0])) !== null) {
                const day = dayMatch[1];
                if (PREFERRED_DAYS.length && !PREFERRED_DAYS.includes(day)) continue;
                const slotRegex = /"Status"\s*:\s*"([^"]+)"[\s\S]*?"Time"\s*:\s*"([^"]+)"/g;
                let slotMatch;
                while ((slotMatch = slotRegex.exec(dayMatch[2])) !== null) {
                    results.push({ day, status: slotMatch[1], time: slotMatch[2] });
                }
            }
            return results;
        }
        return null;
    }

    // ─── Hlavný sken ─────────────────────────────────────────────
    let lastReload = Date.now();
    let formDetected = false;

    function scanPage() {
        let foundAvailable = false;
        let foundFewLeft   = false;
        let availableSlots = [];
        let fewLeftSlots   = [];

        // ── Detekcia formulára ──
        const hasForm = document.querySelectorAll('input[type=text], input[type=email], input[type=tel]').length > 0;
        if (hasForm && !formDetected) {
            formDetected = true;
            updateStatus('📝 Formulár detekovaný — autofill!', '#ffeb3b');
            const btn = document.getElementById('gm-fill-btn');
            if (btn) btn.style.display = 'inline-block';
            beep(520, 150, 2);
            setTimeout(autofillForm, 300);
        } else if (!hasForm) {
            formDetected = false;
            const btn = document.getElementById('gm-fill-btn');
            if (btn) btn.style.display = 'none';
        }

        // ── Sken dostupnosti ──
        const allElements = document.querySelectorAll('a, td, li, span, div, p');
        allElements.forEach(el => {
            const text = (el.textContent || '').trim();
            if (!text || text.length > 100) return;
            if (isInLegend(el)) return;
            if (!hasTimeSlot(text)) return;

            if (/^○/.test(text)) {
                el.style.backgroundColor = COLOR_AVAILABLE;
                el.style.color = '#000';
                el.style.fontWeight = 'bold';
                el.style.borderRadius = '4px';
                el.style.padding = '2px 6px';
                el.style.outline = `3px solid ${COLOR_AVAILABLE}`;
                foundAvailable = true;
                availableSlots.push(text.substring(0, 30));
            } else if (/^△/.test(text)) {
                el.style.backgroundColor = COLOR_FEW_LEFT;
                el.style.color = '#000';
                el.style.fontWeight = 'bold';
                el.style.borderRadius = '4px';
                el.style.padding = '2px 6px';
                el.style.outline = `3px solid ${COLOR_FEW_LEFT}`;
                foundFewLeft = true;
                fewLeftSlots.push(text.substring(0, 30));
            } else if (/^×/.test(text)) {
                el.style.color = COLOR_SOLD_OUT;
                el.style.textDecoration = 'line-through';
            }
        });

        // ── Výsledok + Telegram ──
        if (foundAvailable || foundFewLeft) {
            // Parsuj dispEvent pre Telegram (presné dni + časy)
            const slots = parseDispEvent();
            if (slots) {
                const newSlots = slots.filter(s => {
                    if (s.status === 'SoldOut') return false;
                    const key = `${s.day}-${s.time}`;
                    if (telegramSent.has(key)) return false;
                    telegramSent.add(key);
                    return true;
                });
                if (newSlots.length > 0) sendTelegram(newSlots);
            } else {
                // Fallback: dispEvent sa nenašiel — pošli DOM sloty
                const allSlots = [...availableSlots, ...fewLeftSlots];
                const newDomSlots = allSlots.filter(t => {
                    if (telegramSent.has(t)) return false;
                    telegramSent.add(t);
                    return true;
                });
                if (newDomSlots.length > 0) {
                    sendTelegram(newDomSlots.map(t => ({ day: '??', time: t, status: 'Available' })));
                }
            }
        }

        if (foundAvailable) {
            updateStatus('🟢 DOSTUPNÉ LÍSTKY!', COLOR_AVAILABLE);
            updateFound(`✓ ${availableSlots.join(' | ')}`, COLOR_AVAILABLE);
            beep(880, 300, 5);
            flashTitle('🟢 DOSTUPNÉ! — Ghibli');
            showNotification('Ghibli: Dostupné lístky!', availableSlots.join(', '));
        } else if (foundFewLeft) {
            updateStatus('🟡 Posledné lístky (△)', COLOR_FEW_LEFT);
            updateFound(`△ ${fewLeftSlots.join(' | ')}`, COLOR_FEW_LEFT);
            beep(660, 200, 3);
            flashTitle('🟡 POSLEDNÉ! — Ghibli');
            showNotification('Ghibli: Posledné lístky!', fewLeftSlots.join(', '));
        } else if (!hasForm) {
            // Reset telegramSent ak je všetko vypredané (sloty sa môžu znova uvoľniť)
            telegramSent.clear();
            updateStatus('❌ Všetko vypredané', '#ef5350');
            updateFound('', '#fff');
            if (AUTO_RELOAD && Date.now() - lastReload > RELOAD_INTERVAL_MS) {
                updateStatus('🔄 Reloadujem...', '#90caf9');
                lastReload = Date.now();
                setTimeout(() => location.reload(), 1000);
            }
        }
    }

    // ─── Štart ───────────────────────────────────────────────────
    function init() {
        createStatusBar();
        updateStatus('👁 Monitorujem...', '#90caf9');
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
        setTimeout(scanPage, 1500);
        setInterval(scanPage, CHECK_INTERVAL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
