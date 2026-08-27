# Wi-Fi Scanner Pro

A real-time Wi-Fi access point scanner with a modern glassmorphism design.

## Architecture

This application consists of two parts:

1. **Web UI (Render)**: A Node.js/Express server serving the frontend HTML, CSS, and JS. Deployed in the cloud (e.g. Render).
2. **Local Scanner Agent**: A lightweight local background agent (`local-scanner.js`) that runs on your computer to scan your physical Wi-Fi hardware and expose results on `localhost:7778`.

---

## ⚡ Quick Start: One-Click Launchers

You don't need to type terminal commands! We provide one-click scripts that automatically install dependencies and start the scanner:

* **Windows**: Double-click **`start-scanner.bat`**
* **Linux / macOS**: Double-click or run **`./start-scanner.sh`**

Once launched, open your Render web URL (or `http://localhost:3000`), and the UI will automatically connect to your local scanner!

---

## 🔄 Automatic Auto-Start (Run on System Boot)

To make scanning **100% automatic** so you never have to open or run anything manually:

### Windows Auto-Start
1. Press `Win + R`, type `shell:startup` and press **Enter**.
2. Right-click inside the folder, select **New -> Shortcut**.
3. Point the shortcut to `start-scanner.bat` in your project folder.
4. *Done! Now the scanner starts automatically in the background whenever Windows boots.*

### Linux Auto-Start (systemd / PM2)
Run PM2 to keep the scanner running permanently:
```bash
npx pm2 start local-scanner.js --name "wifi-scanner-agent"
npx pm2 save
npx pm2 startup
```

### macOS Auto-Start
Add `start-scanner.sh` to your **System Settings -> General -> Login Items**.

---

## 🌐 Hosting on Render

1. Push this repository to GitHub (`saviottt1/Wifi_Analyzer`).
2. Go to [Render.com](https://render.com) -> **New Web Service**.
3. Connect your repository.
4. Settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Open your deployed URL. With the local scanner running on your PC (or set to auto-start), live Wi-Fi networks will load automatically!

---

## 🧪 Demo Mode

Click **Demo Mode** in the top bar of the web app to preview the interface with realistic sample Wi-Fi data without needing a physical Wi-Fi adapter.

---

## Supported Operating Systems
- **Windows**: `netsh wlan show networks mode=bssid`
- **macOS**: `system_profiler SPAirPortDataType -json`
- **Linux**: `nmcli dev wifi list`
