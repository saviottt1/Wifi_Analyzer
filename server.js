// ─────────────────────────────────────────────────────────────────────────────
// Wi-Fi Scanner Pro — Web Server (Render-compatible)
// ─────────────────────────────────────────────────────────────────────────────
// This server ONLY serves the static frontend files.
// It does NOT perform Wi-Fi scanning — that is handled by local-scanner.js
// running on the user's own computer.
//
// Render configuration:
//   Build Command:  npm install
//   Start Command:  node server.js
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint — confirms the web server is running
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'wifi-scanner-web',
        message: 'Web server is running. Wi-Fi scanning is performed by the local scanner agent on your computer.',
        timestamp: Date.now()
    });
});

// Start server — bind to 0.0.0.0 for Render compatibility
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  🛜  Wi-Fi Scanner Pro — Web Server`);
    console.log(`  ─────────────────────────────────────`);
    console.log(`  Server running on  http://localhost:${PORT}`);
    console.log(`  Mode:              Static UI server (no local Wi-Fi scanning)`);
    console.log(`\n  To scan Wi-Fi networks, run the local scanner on your computer:`);
    console.log(`    npm run local-scanner`);
    console.log(`  Press Ctrl+C to stop.\n`);
});
