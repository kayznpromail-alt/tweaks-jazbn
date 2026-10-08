# Edgey Project Notes

## Infrastructure

- **VPS**: `ssh root@194.163.138.26`
- **Deploy path**: `/opt/edgey/deploy`
- **Update**: `cd /opt/edgey/deploy && git pull && docker compose up -d --build`
- **Logs**: `cd /opt/edgey/deploy && docker compose logs --tail=50 api`
- **API**: `https://api.edgey.shop`
- **Admin panel**: hosted on Vercel (edgey-website repo)
- **Website repo**: `edgeyshop/edgey-website`
