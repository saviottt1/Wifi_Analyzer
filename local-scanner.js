#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Wi-Fi Scanner Pro — Local Scanner Agent
// ─────────────────────────────────────────────────────────────────────────────
// This runs ONLY on the user's own computer. It performs real Wi-Fi scans
// using OS-native commands and exposes the results on localhost:7778 so the
// browser UI (served from Render or localhost) can fetch them.
//
// Endpoints:
//   GET /scan    → Run a Wi-Fi scan and return JSON array of networks
//   GET /health  → Connection-check: { status, platform, timestamp }
//
// Security:
//   • Binds to 127.0.0.1 (localhost only) — not reachable from the network
//   • CORS allows all origins so the Render-hosted page can reach localhost
//   • Only two read-only endpoints — no arbitrary command execution
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const os = require('os');

const app = express();
const PORT = 7778;
const PLATFORM = os.platform(); // 'linux', 'win32', or 'darwin'

// ── CORS ────────────────────────────────────────────────────────────────────
// Allow any origin so the Render-hosted page (https://...onrender.com) can
// fetch from http://localhost:7778. This is safe because we bind to 127.0.0.1
// — only the local machine can reach this server.
app.use(cors({ origin: '*' }));

// ── Per-OS scan commands ────────────────────────────────────────────────────
function getScanCommand() {
    switch (PLATFORM) {
        case 'win32':
            return 'netsh wlan show networks mode=bssid';
        case 'darwin':
            return 'system_profiler SPAirPortDataType -json';
        case 'linux':
        default:
            return 'nmcli -t -f SSID,BSSID,SIGNAL,FREQ,CHAN,RATE,SECURITY dev wifi list --rescan yes';
    }
}

function getFallbackCommand() {
    switch (PLATFORM) {
        case 'win32':
            return 'netsh wlan show networks mode=bssid';
        case 'darwin':
            return 'system_profiler SPAirPortDataType -json';
        case 'linux':
        default:
            return 'nmcli -t -f SSID,BSSID,SIGNAL,FREQ,CHAN,RATE,SECURITY dev wifi';
    }
}

// ── Parsers ─────────────────────────────────────────────────────────────────
// Each returns: { ssid, bssid, signal (0-100), dbm, freq, band, channel, rate, security }

function parseWifiDataLinux(output) {
    const lines = output.trim().split('\n');
    const networks = [];

    // Split on un-escaped colons
    const regex = /(?<!\\):/;
    const unescape = (str) => (str ? str.replace(/\\:/g, ':') : '');

    for (const line of lines) {
        if (!line.trim()) continue;

        const parts = line.split(regex);

        if (parts.length >= 7) {
            const ssid = unescape(parts[0]);
            const bssid = unescape(parts[1]);
            const signal = parseInt(parts[2], 10);
            const freq = parseInt(parts[3], 10);
            const channel = parts[4];
            const rate = unescape(parts[5]);
            const security = unescape(parts.slice(6).join(':'));

            const dbm = Math.round((signal / 2) - 100);
            const band = freq > 5000 ? '5 GHz' : '2.4 GHz';

            if (ssid && ssid !== '--') {
                networks.push({
                    ssid, bssid,
                    signal: isNaN(signal) ? 0 : signal,
                    dbm, freq, band, channel, rate,
                    security: security || 'Open'
                });
            }
        }
    }
    return networks;
}

function parseWifiDataWindows(output) {
    const networks = [];
    const blocks = output.split(/\r?\n(?=SSID \d+\s*:)/g);

    for (const block of blocks) {
        const ssidMatch = block.match(/^SSID \d+\s*:\s*(.*)$/m);
        if (!ssidMatch) continue;
        const ssid = ssidMatch[1].trim();

        const authMatch = block.match(/Authentication\s*:\s*(.*)/);
        const security = authMatch ? authMatch[1].trim() : 'Unknown';

        const bssidBlocks = block.split(/\r?\n(?=\s*BSSID \d+\s*:)/g).slice(1);

        for (const b of bssidBlocks) {
            // Windows netsh often uses hyphens for MAC addresses (e.g., 00-11-22-33-44-55)
            const bssidMatch = b.match(/BSSID \d+\s*:\s*([0-9a-fA-F:-]{17})/i);
            const signalMatch = b.match(/Signal\s*:\s*(\d+)%/i);
            const channelMatch = b.match(/Channel\s*:\s*(\d+)/i);
            const radioMatch = b.match(/Radio type\s*:\s*(.*)/i);

            if (!bssidMatch) continue;
            
            // Normalize BSSID to use colons instead of hyphens
            const bssid = bssidMatch[1].replace(/-/g, ':').toLowerCase();

            const signal = signalMatch ? parseInt(signalMatch[1], 10) : 0;
            const channel = channelMatch ? channelMatch[1] : '';
            const dbm = Math.round((signal / 2) - 100);
            const band = parseInt(channel, 10) > 14 ? '5 GHz' : '2.4 GHz';

            if (ssid) {
                networks.push({
                    ssid,
                    bssid,
                    signal,
                    dbm,
                    freq: 0,
                    band,
                    channel,
                    rate: radioMatch ? radioMatch[1].trim() : '',
                    security: security || 'Open'
                });
            }
        }
    }
    return networks;
}

function parseWifiDataMac(output) {
    const networks = [];
    let data;
    try {
        data = JSON.parse(output);
    } catch (e) {
        return networks;
    }

    const airportData = data.SPAirPortDataType && data.SPAirPortDataType[0];
    const interfaces = airportData && airportData.spairport_airport_interfaces;
    if (!interfaces) return networks;

    for (const iface of interfaces) {
        const others = iface.spairport_airport_other_local_wireless_networks || [];
        for (const net of others) {
            const ssid = net._name || '';
            if (!ssid) continue;

            const snMatch = (net.spairport_signal_noise || '').match(/(-?\d+)/);
            const dbm = snMatch ? parseInt(snMatch[1], 10) : -100;
            const signal = Math.max(0, Math.min(100, Math.round((dbm + 100) * 2)));

            const channelStr = String(net.spairport_network_channel || '');
            const channelNum = parseInt(channelStr, 10);
            const band = channelNum > 14 ? '5 GHz' : '2.4 GHz';

            networks.push({
                ssid,
                bssid: net._name + '-' + channelStr,
                signal, dbm,
                freq: 0,
                band,
                channel: channelStr,
                rate: net.spairport_network_phymode || '',
                security: net.spairport_security_mode || 'Open'
            });
        }
    }
    return networks;
}

function parseWifiData(output) {
    let networks;
    if (PLATFORM === 'win32') {
        networks = parseWifiDataWindows(output);
    } else if (PLATFORM === 'darwin') {
        networks = parseWifiDataMac(output);
    } else {
        networks = parseWifiDataLinux(output);
    }

    // Deduplicate by BSSID – keep strongest
    const unique = {};
    for (const net of networks) {
        if (!unique[net.bssid] || unique[net.bssid].signal < net.signal) {
            unique[net.bssid] = net;
        }
    }

    return Object.values(unique).sort((a, b) => b.signal - a.signal);
}

// ── Promisified scan ────────────────────────────────────────────────────────
function runScan() {
    return new Promise((resolve) => {
        exec(getScanCommand(), { timeout: 8000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
            // On Linux, nmcli may exit with code 0 but return empty output when the
            // adapter is busy or rescan fails — treat empty stdout as a failure too.
            if (error || !stdout.trim()) {
                // Try fallback command
                exec(getFallbackCommand(), { timeout: 5000, maxBuffer: 1024 * 1024 * 10 }, (err2, stdout2) => {
                    if (err2 || !stdout2.trim()) {
                        const actualErr = err2 || error;
                        const msg = (actualErr ? actualErr.message || '' : '').toLowerCase();

                        if (msg.includes('not found') || msg.includes('not recognized')) {
                            resolve({
                                error: 'unsupported_os',
                                message: 'Wi-Fi scanning is not supported on this system. The required command was not found.',
                                platform: PLATFORM
                            });
                        } else if (msg.includes('permission') || msg.includes('denied') || msg.includes('privileges')) {
                            resolve({
                                error: 'permission_denied',
                                message: 'Permission denied. Try running the scanner with elevated privileges (sudo on Linux/macOS, Administrator on Windows).',
                                platform: PLATFORM
                            });
                        } else if (msg.includes('wifi') && (msg.includes('disabled') || msg.includes('off'))) {
                            resolve({
                                error: 'wifi_disabled',
                                message: 'Wi-Fi is disabled on this device. Please enable Wi-Fi and try again.',
                                platform: PLATFORM
                            });
                        } else if (!stdout2 || !stdout2.trim()) {
                            resolve({
                                error: 'no_data',
                                message: 'The Wi-Fi scan returned no data. Is Wi-Fi enabled and the adapter available?',
                                platform: PLATFORM
                            });
                        } else {
                            resolve({
                                error: 'scan_failed',
                                message: actualErr ? `Wi-Fi scan failed: ${actualErr.message}` : 'Wi-Fi scan returned empty output.',
                                platform: PLATFORM
                            });
                        }
                        return;
                    }

                    try {
                        const networks = parseWifiData(stdout2);
                        resolve({ networks, platform: PLATFORM, timestamp: Date.now() });
                    } catch (parseErr) {
                        resolve({ error: 'parse_error', message: 'Failed to parse scan results.', platform: PLATFORM });
                    }
                });
                return;
            }

            try {
                const networks = parseWifiData(stdout);
                resolve({ networks, platform: PLATFORM, timestamp: Date.now() });
            } catch (parseErr) {
                resolve({ error: 'parse_error', message: 'Failed to parse scan results.', platform: PLATFORM });
            }
        });
    });
}

// ── Endpoints ───────────────────────────────────────────────────────────────

// Health check — lets the browser know the local scanner is running
app.get('/health', (req, res) => {
    const platformNames = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
    res.json({
        status: 'ok',
        platform: platformNames[PLATFORM] || PLATFORM,
        platformId: PLATFORM,
        timestamp: Date.now()
    });
});

// Wi-Fi scan — runs the OS scan command and returns results
let cachedResult = null;
let lastScanTime = 0;
const CACHE_TTL = 3000; // 3 seconds cache

let scanPromise = null;

app.get('/scan', async (req, res) => {
    // Return cached result if still valid — but update timestamp so UI shows current time
    if (cachedResult && (Date.now() - lastScanTime < CACHE_TTL)) {
        return res.json({ ...cachedResult, timestamp: Date.now() });
    }

    // Coalesce requests: if a scan is already running, wait for it instead of rejecting
    if (scanPromise) {
        try {
            const result = await scanPromise;
            return res.json(result);
        } catch (err) {
            return res.status(500).json({ error: 'internal_error', message: 'Scan failed' });
        }
    }

    // Start a new scan
    try {
        scanPromise = runScan();
        const result = await scanPromise;
        
        // Cache the successful result
        if (!result.error) {
            cachedResult = result;
            lastScanTime = Date.now();
        }
        
        res.json(result);
    } catch (err) {
        res.status(500).json({
            error: 'internal_error',
            message: 'An unexpected error occurred during scanning.'
        });
    } finally {
        scanPromise = null;
    }
});

// ── Start server ────────────────────────────────────────────────────────────
// Bind to 127.0.0.1 — only accessible from this machine
const server = app.listen(PORT, '127.0.0.1', () => {
    const platformNames = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
    console.log(`\n  📡  Wi-Fi Scanner Pro — Local Scanner Agent`);
    console.log(`  ─────────────────────────────────────────────`);
    console.log(`  Running on       http://localhost:${PORT}`);
    console.log(`  Platform:        ${platformNames[PLATFORM] || PLATFORM}`);
    console.log(`  Endpoints:`);
    console.log(`    GET /health    → Connection check`);
    console.log(`    GET /scan      → Scan nearby Wi-Fi networks`);
    console.log(`\n  The browser UI will connect to this scanner automatically.`);
    console.log(`  Press Ctrl+C to stop.\n`);
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.log(`Scanner agent is already running on port ${PORT}. Continuing...`);
    } else {
        console.error('Failed to start scanner server:', e);
    }
});
