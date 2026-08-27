(() => {
    'use strict';

    // ── State ──────────────────────────────────────────────────
    let networksData = [];
    let previousSignals = {};
    let currentSort = 'signal';
    let searchQuery = '';
    let scanNumber = 0;
    let cardElements = {};
    let selectMode = false;
    let selectedBssids = new Set();
    
    // Scanner state
    let isDemoMode = false;
    let isConnected = false;
    let isScanning = false;
    let scanIntervalId = null;
    let healthIntervalId = null;
    const SCANNER_URL = 'http://localhost:7778';

    // ── DOM References ─────────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const networksGrid = $('#networksGrid');
    const apCountEl = $('#apCount');
    const searchInput = $('#searchInput');
    const connectionStatus = $('#connectionStatus');
    const pulseDot = $('#pulseDot');
    const lastScanEl = $('#lastScan');
    const scanCountEl = $('#scanCount');
    const emptyState = $('#emptyState');
    const sortButtons = document.querySelectorAll('.sort-options button');

    // Scanner UI DOM
    const scannerDot = $('#scannerDot');
    const scannerStatusText = $('#scannerStatusText');
    const demoToggleBtn = $('#demoToggleBtn');
    const scanNowBtn = $('#scanNowBtn');
    const demoBanner = $('#demoBanner');
    const demoBannerClose = $('#demoBannerClose');
    const instructionsPanel = $('#instructionsPanel');

    // Selection & Export DOM
    const selectModeBtn = $('#selectModeBtn');
    const exportFab = $('#exportFab');
    const selectedCountEl = $('#selectedCount');
    const selectAllBtn = $('#selectAllBtn');
    const deselectAllBtn = $('#deselectAllBtn');
    const exportBtn = $('#exportBtn');
    const exportModal = $('#exportModal');
    const modalClose = $('#modalClose');
    const modalCancelBtn = $('#modalCancelBtn');
    const modalDownloadBtn = $('#modalDownloadBtn');
    const surveyIdInput = $('#surveyIdInput');
    const engineerInput = $('#engineerInput');
    const buildingIdInput = $('#buildingIdInput');
    const floorIdInput = $('#floorIdInput');
    const coordXInput = $('#coordXInput');
    const coordYInput = $('#coordYInput');
    const previewCountEl = $('#previewCount');
    const previewList = $('#previewList');

    // ── Signal Helpers ─────────────────────────────────────────
    function getSignalColor(signal) {
        if (signal >= 70) return 'var(--signal-excellent)';
        if (signal >= 45) return 'var(--signal-good)';
        if (signal >= 25) return 'var(--signal-fair)';
        return 'var(--signal-weak)';
    }

    function getSignalColorRaw(signal) {
        if (signal >= 70) return '#10b981';
        if (signal >= 45) return '#84cc16';
        if (signal >= 25) return '#eab308';
        return '#ef4444';
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Build Card HTML ─────────────────────────────────────────
    function buildCardHTML(net) {
        const rawColor = getSignalColorRaw(net.signal);
        const circumference = 144.51;
        const offset = circumference - (circumference * net.signal / 100);

        const lockSvg = net.security !== 'Open'
            ? `<svg class="lock-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
            : '';

        const checkboxHtml = `<div class="card-checkbox" data-bssid="${escapeHtml(net.bssid)}">
            <svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>
        </div>`;
        
        const demoBadge = isDemoMode ? `<span class="demo-badge">DEMO</span>` : '';

        return `
            ${checkboxHtml}
            <div class="card-header">
                <div class="ssid-section">
                    <div class="ssid">${escapeHtml(net.ssid) || '<em style="opacity:0.5">Hidden</em>'}</div>
                    <span class="band-tag">${net.band || '2.4 GHz'} · CH ${net.channel}</span>${demoBadge}
                </div>
                <div class="signal-gauge">
                    <div class="gauge-ring">
                        <svg viewBox="0 0 56 56">
                            <circle class="gauge-bg" cx="28" cy="28" r="23" />
                            <circle class="gauge-fill" cx="28" cy="28" r="23"
                                stroke="${rawColor}"
                                stroke-dasharray="${circumference}"
                                stroke-dashoffset="${offset}"
                                transform="rotate(-90 28 28)" />
                        </svg>
                        <div class="gauge-text">
                            <span class="gauge-percent" style="color:${rawColor}">${net.signal}%</span>
                            <span class="gauge-dbm">${net.dbm} dBm</span>
                        </div>
                    </div>
                </div>
            </div>
            <div class="card-body">
                <div class="info-row">
                    <span class="info-label">MAC Address</span>
                    <span class="info-value">${escapeHtml(net.bssid)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Frequency</span>
                    <span class="info-value">${net.freq ? net.freq + ' MHz' : '—'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Max Rate</span>
                    <span class="info-value">${escapeHtml(net.rate) || '—'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Security</span>
                    <span class="info-value"><span class="security-badge">${lockSvg} ${escapeHtml(net.security)}</span></span>
                </div>
            </div>`;
    }

    // ── Local Scanner Client ───────────────────────────────────
    
    async function checkHealth() {
        if (isDemoMode) return;
        
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 2000);
            
            const res = await fetch(`${SCANNER_URL}/health`, { 
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(id);
            
            setConnected(res.ok);
        } catch (err) {
            // Force-set disconnected even if already false (fixes initial load)
            if (isConnected) {
                isConnected = false; // reset before calling setConnected
            }
            setConnected(false);
        }
    }

    async function triggerScan() {
        if (isDemoMode) {
            generateDemoData();
            // Schedule next demo tick
            scanIntervalId = setTimeout(triggerScan, 3000);
            return;
        }

        // If not connected, do not attempt scan and do not reschedule
        if (!isConnected || isScanning) return;
        
        let scanSucceeded = false;
        try {
            isScanning = true;
            scanNowBtn.disabled = true;
            scanNowBtn.classList.add('scanning');
            
            const res = await fetch(`${SCANNER_URL}/scan`);
            if (!res.ok) throw new Error('Scan request failed: ' + res.status);
            
            const data = await res.json();
            
            if (data.error) {
                showErrorState(data.message);
            } else {
                networksData = data.networks || [];
                updateUI(data.timestamp);
                scanSucceeded = true;
            }
            
        } catch (err) {
            console.error('Scan error:', err);
        } finally {
            isScanning = false;
            scanNowBtn.disabled = false;
            scanNowBtn.classList.remove('scanning');
            
            // Only reschedule if still connected and not in demo mode
            if (isConnected && !isDemoMode) {
                scanIntervalId = setTimeout(triggerScan, 3000);
            }
        }
    }

    function setConnected(connected) {
        // Always run on first call (isConnected starts false, connected may also be false)
        const firstCall = !isConnected && !connected && networksData.length === 0 
                          && !instructionsPanel.classList.contains('visible');
        if (isConnected === connected && !firstCall) return;
        isConnected = connected;
        
        if (connected) {
            scannerDot.className = 'scanner-status-dot connected';
            scannerStatusText.textContent = 'Local Wi-Fi Scanner: Connected';
            connectionStatus.textContent = 'LIVE';
            connectionStatus.style.color = '#10b981';
            pulseDot.classList.add('active');
            instructionsPanel.classList.remove('visible');
            networksGrid.classList.remove('hidden');
            
            // Trigger first scan immediately (which will schedule subsequent ones)
            if (!scanIntervalId) {
                triggerScan();
            }
        } else {
            scannerDot.className = 'scanner-status-dot disconnected';
            scannerStatusText.textContent = 'Local Wi-Fi Scanner: Not Connected';
            connectionStatus.textContent = 'Offline';
            connectionStatus.style.color = '#ef4444';
            pulseDot.classList.remove('active');
            
            // Show instructions if not in demo mode
            if (!isDemoMode) {
                networksData = [];
                renderNetworks(); // clear grid
                networksGrid.classList.add('hidden');
                instructionsPanel.classList.add('visible');
            }
            
            if (scanIntervalId) {
                clearTimeout(scanIntervalId);
                scanIntervalId = null;
            }
        }
    }

    function showErrorState(message) {
        networksData = [];
        networksGrid.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:1rem;color:#ef4444;">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p style="text-align:center;max-width:400px;line-height:1.5;">${escapeHtml(message)}</p>
            </div>
        `;
        apCountEl.textContent = '0';
    }

    // ── Demo Mode ──────────────────────────────────────────────
    function toggleDemoMode() {
        isDemoMode = !isDemoMode;
        demoToggleBtn.classList.toggle('active', isDemoMode);
        
        if (isDemoMode) {
            demoBanner.classList.add('visible');
            instructionsPanel.classList.remove('visible');
            networksGrid.classList.remove('hidden');
            
            // Stop real scanning
            if (scanIntervalId) clearTimeout(scanIntervalId);
            scanIntervalId = null;
            
            // UI updates
            scannerDot.className = 'scanner-status-dot connected';
            scannerStatusText.textContent = 'Local Wi-Fi Scanner: Demo Mode';
            connectionStatus.textContent = 'DEMO';
            connectionStatus.style.color = '#f97316';
            pulseDot.classList.add('active');
            
            triggerScan(); // Will handle demo scheduling
        } else {
            demoBanner.classList.remove('visible');
            networksData = [];
            
            // Restart real scanning
            if (scanIntervalId) clearTimeout(scanIntervalId);
            scanIntervalId = null;
            
            // Force health check to determine real state
            isConnected = false; // Reset to force state update
            checkHealth();
        }
    }

    // Seed data for demo mode
    const DEMO_SEED = [
        { ssid: 'Demo_5G_Network',    bssid: '00:11:22:33:44:55', signal: 92, dbm: -54, freq: 5180, band: '5 GHz',   channel: '36',  rate: '866 Mbps',  security: 'WPA2-PSK' },
        { ssid: 'Office_Guest',        bssid: 'aa:bb:cc:dd:ee:ff', signal: 75, dbm: -62, freq: 2437, band: '2.4 GHz', channel: '6',   rate: '144 Mbps',  security: 'WPA2/WPA3' },
        { ssid: 'CoffeeShop_Free_WiFi',bssid: '12:34:56:78:90:ab', signal: 48, dbm: -76, freq: 2412, band: '2.4 GHz', channel: '1',   rate: '72 Mbps',   security: 'Open' },
        { ssid: 'Corp_Secure_Net',     bssid: '98:76:54:32:10:fe', signal: 60, dbm: -70, freq: 5745, band: '5 GHz',   channel: '149', rate: '1300 Mbps', security: 'WPA3-Enterprise' },
        { ssid: 'Hidden Network',      bssid: '1a:2b:3c:4d:5e:6f', signal: 30, dbm: -85, freq: 2462, band: '2.4 GHz', channel: '11',  rate: '54 Mbps',   security: 'WPA2-PSK' }
    ];

    function generateDemoData() {
        const fluctuate = (val, maxChange) => Math.max(0, Math.min(100, val + (Math.random() * maxChange * 2 - maxChange)));
        
        // First call: deep-clone the seed so mutations don't affect DEMO_SEED
        if (!isDemoMode || networksData.length === 0 || networksData[0].bssid !== DEMO_SEED[0].bssid) {
            networksData = DEMO_SEED.map(n => ({ ...n }));
        } else {
            // Subsequent calls: fluctuate signals
            networksData.forEach(net => {
                net.signal = Math.round(fluctuate(net.signal, 5));
                net.dbm = Math.round((net.signal / 2) - 100);
            });
        }
        
        updateUI(Date.now());
    }

    // ── UI Updates ─────────────────────────────────────────────
    function updateUI(timestamp) {
        scanNumber++;
        scanCountEl.textContent = scanNumber;
        const now = new Date(timestamp || Date.now());
        lastScanEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        renderNetworks();
    }

    function renderNetworks() {
        let filtered = networksData.filter(net => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            // Guard against null/undefined ssid and channel (e.g. hidden networks)
            return (net.ssid || '').toLowerCase().includes(q) ||
                   (net.bssid || '').toLowerCase().includes(q) ||
                   String(net.channel ?? '').includes(q) ||
                   (net.band || '').toLowerCase().includes(q);
        });

        filtered.sort((a, b) => {
            if (currentSort === 'signal')  return b.signal - a.signal;
            if (currentSort === 'name')    return a.ssid.localeCompare(b.ssid);
            if (currentSort === 'channel') return parseInt(a.channel) - parseInt(b.channel);
            return 0;
        });

        apCountEl.textContent = filtered.length;

        if (filtered.length === 0) {
            if (!emptyState || !networksGrid.contains(emptyState)) {
                networksGrid.innerHTML = `<div class="empty-state"><p>No networks found.</p></div>`;
            }
            return;
        }

        const existing = networksGrid.querySelector('.empty-state');
        if (existing) existing.remove();

        const activeBssids = new Set(filtered.map(n => n.bssid));
        Object.keys(cardElements).forEach(bssid => {
            if (!activeBssids.has(bssid)) {
                const el = cardElements[bssid];
                el.style.opacity = '0';
                el.style.transform = 'scale(0.95)';
                setTimeout(() => el.remove(), 300);
                delete cardElements[bssid];
            }
        });

        filtered.forEach((net, idx) => {
            const bssid = net.bssid;
            let card = cardElements[bssid];

            if (card) {
                card.innerHTML = buildCardHTML(net);
                card.style.setProperty('--signal-color', getSignalColor(net.signal));
                if (selectedBssids.has(bssid)) card.classList.add('selected');

                const prev = previousSignals[bssid];
                if (prev !== undefined && prev !== net.signal) {
                    card.classList.remove('flash');
                    void card.offsetWidth;
                    card.classList.add('flash');
                }

                const currentCards = [...networksGrid.children].filter(c => c.classList.contains('network-card'));
                if (currentCards[idx] !== card) {
                    if (currentCards[idx]) {
                        networksGrid.insertBefore(card, currentCards[idx]);
                    } else {
                        networksGrid.appendChild(card);
                    }
                }
            } else {
                card = document.createElement('div');
                card.className = 'network-card';
                card.dataset.bssid = bssid;
                card.style.setProperty('--signal-color', getSignalColor(net.signal));
                card.innerHTML = buildCardHTML(net);
                if (selectedBssids.has(bssid)) card.classList.add('selected');

                const currentCards = [...networksGrid.children].filter(c => c.classList.contains('network-card'));
                if (currentCards[idx]) {
                    networksGrid.insertBefore(card, currentCards[idx]);
                } else {
                    networksGrid.appendChild(card);
                }
                cardElements[bssid] = card;
            }
            previousSignals[bssid] = net.signal;
        });
    }

    // ── Selection & Export helpers ──────────────────────────────
    function toggleSelectMode() {
        selectMode = !selectMode;
        document.body.classList.toggle('select-mode', selectMode);
        selectModeBtn.classList.toggle('active', selectMode);
        selectModeBtn.querySelector('span').textContent = selectMode ? 'Done' : 'Select';

        if (!selectMode) {
            selectedBssids.clear();
            Object.values(cardElements).forEach(card => card.classList.remove('selected'));
        }
        updateFab();
    }

    function toggleCardSelection(bssid) {
        if (!selectMode) return;
        if (selectedBssids.has(bssid)) {
            selectedBssids.delete(bssid);
            if (cardElements[bssid]) cardElements[bssid].classList.remove('selected');
        } else {
            selectedBssids.add(bssid);
            if (cardElements[bssid]) cardElements[bssid].classList.add('selected');
        }
        updateFab();
    }

    function updateFab() {
        const count = selectedBssids.size;
        selectedCountEl.textContent = count;
        exportFab.classList.toggle('visible', selectMode && count > 0);
    }

    function selectAllVisible() {
        const visible = networksData.filter(net => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            return net.ssid.toLowerCase().includes(q) || net.bssid.toLowerCase().includes(q) || net.channel.toString().includes(q) || (net.band || '').toLowerCase().includes(q);
        });
        visible.forEach(net => {
            selectedBssids.add(net.bssid);
            if (cardElements[net.bssid]) cardElements[net.bssid].classList.add('selected');
        });
        updateFab();
    }

    function deselectAll() {
        selectedBssids.clear();
        Object.values(cardElements).forEach(card => card.classList.remove('selected'));
        updateFab();
    }

    function generateSurveyId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let id = 'SUR-';
        for (let i = 0; i < 8; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    }

    function openExportModal() {
        const selectedNets = networksData.filter(n => selectedBssids.has(n.bssid));
        previewCountEl.textContent = selectedNets.length;
        previewList.innerHTML = selectedNets.map(net => {
            const color = getSignalColorRaw(net.signal);
            return `<div class="preview-item">
                <div>
                    <div class="preview-item-ssid">${escapeHtml(net.ssid)}</div>
                    <div class="preview-item-bssid">${escapeHtml(net.bssid)}</div>
                </div>
                <div class="preview-item-signal" style="color:${color}">${net.dbm} dBm</div>
            </div>`;
        }).join('');

        if (!surveyIdInput.value) surveyIdInput.value = generateSurveyId();
        exportModal.classList.add('open');
    }

    function closeExportModal() { exportModal.classList.remove('open'); }

    function downloadJSON() {
        const selectedNets = networksData.filter(n => selectedBssids.has(n.bssid));
        if (selectedNets.length === 0) return;

        const surveyId = surveyIdInput.value.trim() || generateSurveyId();
        const engineer = engineerInput.value.trim() || 'Field Tech';
        const buildingId = buildingIdInput.value.trim();
        const floorId = floorIdInput.value.trim();
        const x = parseFloat(coordXInput.value);
        const y = parseFloat(coordYInput.value);

        function freqToChannel(freq) {
            if (freq >= 2412 && freq <= 2484) {
                if (freq === 2484) return 14;
                return Math.round((freq - 2412) / 5) + 1;
            }
            if (freq >= 5170 && freq <= 5825) return Math.round((freq - 5000) / 5);
            return 0;
        }

        const payload = {
            surveyId: surveyId,
            engineer: engineer,
            date: new Date().toISOString(),
            isDemoData: isDemoMode,
            location: {
                buildingId: buildingId,
                floorId: floorId,
                x: isNaN(x) ? null : x,
                y: isNaN(y) ? null : y
            },
            fingerprint: selectedNets.map(net => ({
                bssid: net.bssid,
                rssi: net.dbm,
                frequency: net.freq,
                channel: parseInt(net.channel) || freqToChannel(net.freq)
            }))
        };

        const jsonStr = JSON.stringify(payload, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${surveyId}_fingerprint.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        closeExportModal();
    }

    // ── Event Listeners ────────────────────────────────────────
    searchInput.addEventListener('input', (e) => { searchQuery = e.target.value; renderNetworks(); });
    sortButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            sortButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSort = btn.dataset.sort;
            renderNetworks();
        });
    });

    selectModeBtn.addEventListener('click', toggleSelectMode);
    networksGrid.addEventListener('click', (e) => {
        if (!selectMode) return;
        const card = e.target.closest('.network-card');
        if (!card) return;
        toggleCardSelection(card.dataset.bssid);
    });

    selectAllBtn.addEventListener('click', selectAllVisible);
    deselectAllBtn.addEventListener('click', deselectAll);
    exportBtn.addEventListener('click', openExportModal);
    modalClose.addEventListener('click', closeExportModal);
    modalCancelBtn.addEventListener('click', closeExportModal);
    modalDownloadBtn.addEventListener('click', downloadJSON);
    exportModal.addEventListener('click', (e) => { if (e.target === exportModal) closeExportModal(); });
    
    demoToggleBtn.addEventListener('click', toggleDemoMode);
    demoBannerClose.addEventListener('click', toggleDemoMode);
    scanNowBtn.addEventListener('click', triggerScan);

    // ── Boot ───────────────────────────────────────────────────
    checkHealth(); // Check immediately
    healthIntervalId = setInterval(checkHealth, 5000); // Poll health every 5s

})();
