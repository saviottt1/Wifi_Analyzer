const { app, BrowserWindow } = require('electron');
const path = require('path');

// Prevent multiple instances of the app
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    process.exit(0);
}

// Start the local scanner background service
try {
    require('./local-scanner.js');
    console.log('Started internal scanner service.');
} catch (err) {
    console.error('Scanner service already running or failed to start:', err.message);
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'Wi-Fi Scanner Pro',
        // icon: path.join(__dirname, 'public/assets/icon.png'), // Add icon later if needed
        webPreferences: {
            nodeIntegration: false, // Security best practice
            contextIsolation: true
        }
    });

    // Hide the default menu bar for a cleaner look
    mainWindow.setMenuBarVisibility(false);
    mainWindow.autoHideMenuBar = true;

    // Load the local HTML file (no external server required!)
    mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
