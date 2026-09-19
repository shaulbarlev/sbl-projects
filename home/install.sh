#!/bin/sh
# Push the agent into the LXC and (re)start it. Run from a Mac that can SSH
# to the Proxmox host as root. The env file is written once by hand, see
# agent/skin-agent.env.example.
#
#   SSHPASS=… ./install.sh            # defaults below
#   PVE_HOST=192.168.50.90 CT=300 ./install.sh
set -eu
PVE_HOST="${PVE_HOST:-192.168.50.90}"
CT="${CT:-300}"
cd "$(dirname "$0")/agent"
tar czf /tmp/skin-agent.tgz skin-agent.py skin-agent.service
sshpass -e ssh -o StrictHostKeyChecking=no "root@$PVE_HOST" "
  cat > /tmp/skin-agent.tgz &&
  pct push $CT /tmp/skin-agent.tgz /tmp/skin-agent.tgz && rm /tmp/skin-agent.tgz &&
  pct exec $CT -- sh -c '
    mkdir -p /opt/skin-agent && cd /tmp && tar xzf skin-agent.tgz && rm -f skin-agent.tgz ._* &&
    mv skin-agent.py /opt/skin-agent/skin-agent.py &&
    mv skin-agent.service /etc/systemd/system/skin-agent.service &&
    chown root:root /opt/skin-agent/skin-agent.py /etc/systemd/system/skin-agent.service &&
    chmod 644 /opt/skin-agent/skin-agent.py /etc/systemd/system/skin-agent.service &&
    apt-get install -y -qq python3-websockets >/dev/null &&
    systemctl daemon-reload && systemctl enable --now skin-agent && systemctl restart skin-agent &&
    sleep 4 && systemctl is-active skin-agent && journalctl -u skin-agent -n 3 --no-pager -o cat'
" < /tmp/skin-agent.tgz
rm -f /tmp/skin-agent.tgz
