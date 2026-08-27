#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "==================================================="
echo " Starting Wi-Fi Scanner Pro Local Agent..."
echo "==================================================="
echo ""

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

echo "Starting scanner agent on http://localhost:7778 ..."
node local-scanner.js
