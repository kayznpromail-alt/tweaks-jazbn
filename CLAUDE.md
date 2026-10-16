# Edgey Project Notes

## Infrastructure

- **VPS**: `ssh root@194.163.138.26`
- **Deploy path**: `/opt/edgey/deploy`
- **Deploy**: auto via GitHub Actions on merge to main (SSH + docker compose)
- **Manual deploy**: `cd /opt/edgey/deploy && git pull && docker compose up -d --build`
- **Logs**: `cd /opt/edgey/deploy && docker compose logs --tail=50 api`
- **API**: `https://gw.eminencehw.com`
- **Admin panel**: `https://gw.eminencehw.com/panel` (self-hosted, login with ADMIN_TOKEN)
