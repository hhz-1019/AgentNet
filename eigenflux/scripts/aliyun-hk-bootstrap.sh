#!/bin/bash
# Only for the inspected, newly purchased Hong Kong host. No application data is imported.
set -euo pipefail
umask 077
test "$(id -u)" = 0
test "$(hostname)" = iZj6c3egnl5bzb0itdjs7dZ
disk=/dev/disk/by-id/virtio-j6c3egnl5bzb0it729i7
test -b "$disk"
test "$(blockdev --getsize64 "$disk")" = 107374182400
if ! mountpoint -q /srv/elsewhere; then
  test "$(lsblk -nr -o NAME "$disk" | wc -l)" = 1
  test -z "$(lsblk -nr -o MOUNTPOINTS "$disk" | tr -d '[:space:]')"
  signatures=$(wipefs --no-act --noheadings --output TYPE "$disk")
  test -z "$signatures"
  test ! -e /srv/elsewhere || test -z "$(ls -A /srv/elsewhere)"
  mkfs.ext4 -L elsewhere-data -m 1 "$disk"
  install -d -m 0750 /srv/elsewhere
  uuid=$(blkid -s UUID -o value "$disk")
  test -n "$uuid"
  cp -a /etc/fstab /etc/fstab.before-elsewhere
  printf 'UUID=%s /srv/elsewhere ext4 defaults,nofail,x-systemd.device-timeout=15s 0 2\n' "$uuid" >> /etc/fstab
  systemctl daemon-reload
  mount /srv/elsewhere
fi
test "$(findmnt -nro UUID /srv/elsewhere)" = "$(blkid -s UUID -o value "$disk")"
install -d -m 0700 /srv/elsewhere/{docker,containerd,backups,staging,config}
install -d -m 0755 /var/lib/containerd
if ! mountpoint -q /var/lib/containerd; then
  test -z "$(ls -A /var/lib/containerd)"
  printf '/srv/elsewhere/containerd /var/lib/containerd none bind,nofail,x-systemd.requires-mounts-for=/srv/elsewhere 0 0\n' >> /etc/fstab
  systemctl daemon-reload
  mount /var/lib/containerd
fi
test "$(findmnt -nro UUID /var/lib/containerd)" = "$(blkid -s UUID -o value "$disk")"
install -d -m 0755 /etc/docker /etc/systemd/system/docker.service.d /etc/systemd/system/containerd.service.d
test ! -e /etc/docker/daemon.json
cat > /etc/docker/daemon.json <<'JSON'
{
  "data-root": "/srv/elsewhere/docker",
  "log-driver": "local",
  "log-opts": {"max-size":"10m", "max-file":"3"},
  "live-restore": true
}
JSON
for unit in docker containerd; do
cat > "/etc/systemd/system/$unit.service.d/elsewhere-storage.conf" <<'UNIT'
[Unit]
RequiresMountsFor=/srv/elsewhere /var/lib/containerd
[Service]
ExecStartPre=/usr/bin/mountpoint -q /srv/elsewhere
ExecStartPre=/usr/bin/mountpoint -q /var/lib/containerd
UNIT
done
install -d -m 0755 /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/elsewhere-limits.conf <<'JOURNAL'
[Journal]
SystemMaxUse=256M
RuntimeMaxUse=64M
MaxRetentionSec=14day
JOURNAL
systemctl restart systemd-journald
printf 'vm.max_map_count=262144\n' > /etc/sysctl.d/60-elsewhere.conf
sysctl -p /etc/sysctl.d/60-elsewhere.conf
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL --retry 3 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
test "$(gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc | awk -F: '$1=="fpr"{print $10;exit}')" = 9DC858229FC7DD38854AE2D88D81803C0EBFCD88
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<'APT'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
APT
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl daemon-reload
systemctl enable --now containerd docker
docker version --format '{{.Server.Version}}'
docker compose version
docker info --format 'DockerRootDir={{.DockerRootDir}} LoggingDriver={{.LoggingDriver}}'
findmnt /srv/elsewhere
findmnt /var/lib/containerd
df -hT / /srv/elsewhere
systemctl --failed --no-pager
printf 'ELSEWHERE_HOST_BOOTSTRAP_OK\n'
