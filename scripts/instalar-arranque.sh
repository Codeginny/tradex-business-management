#!/usr/bin/env bash
# Hace que TRADEX arranque sola cada vez que prendés la compu (servicio de usuario de systemd).
# Uso: bash scripts/instalar-arranque.sh     ·  Para quitarlo: systemctl --user disable --now tradex
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/tradex.service" <<UNIT
[Unit]
Description=TRADEX - sistema de gestión
StartLimitIntervalSec=0

[Service]
WorkingDirectory=$DIR
ExecStart=$NODE $DIR/server.js
Restart=always
RestartSec=15

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now tradex
echo "✅ TRADEX queda prendida en http://localhost:5190 y arranca sola con la compu."
echo "   Ver estado: systemctl --user status tradex   ·   Ver mensajes: journalctl --user -u tradex -f"
