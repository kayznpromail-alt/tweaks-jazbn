const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const notices = ['# Third-party notices\n\nInstalled production dependencies; this list is not a bundle reachability assertion.\n'];
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location || entry.dev) continue;
  const dir = path.join(root, location);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (pkg.version !== entry.version) throw Error('Installed dependency differs from lockfile');
  for (const name of fs.readdirSync(dir).filter(n => /^(license|licence|notice|copying)/i.test(n) && fs.statSync(path.join(dir,n)).isFile())) {
    notices.push(`## ${pkg.name} ${pkg.version}: ${name}\n\n${fs.readFileSync(path.join(dir,name),'utf8')}\n`);
  }
}
fs.writeFileSync(path.join(root,'THIRD_PARTY_NOTICES.txt'),notices.join('\n'));
