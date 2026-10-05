import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { existsSync, mkdirSync, lstatSync, readdirSync, copyFileSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, renameSync, rmdirSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';

export function userHome(env = process.env) {
  return resolve((process.platform === 'win32' ? env.USERPROFILE || env.HOME : env.HOME) || homedir());
}
export function installRoot(env = process.env) { return join(userHome(env), '.edgey'); }
export function legacyInstallRoot(env = process.env) {
  return process.platform === 'win32' ? join(env.LOCALAPPDATA || join(userHome(env), 'AppData', 'Local'), 'edgey') : join(userHome(env), '.local', 'share', 'edgey');
}
export function safeDirectory(path) {
  const parent = dirname(path);
  if (parent !== path) safeDirectory(parent);
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('the edgey directory cannot be a link or a file');
}
function regular(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('unsafe migration file');
}
function locked(root, name, action) {
  safeDirectory(root);
  const path = join(root, name);
  // do not steal a lock on an ambiguous owner or during another startup.
  if (existsSync(path)) {
    regular(path);
    const pid = JSON.parse(readFileSync(path, 'utf8')).pid;
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('invalid migration owner');
    let gone = false;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') gone = true; }
    if (!gone) throw new Error('another edgey migration is running; retry startup');
    const recovery = path + '.recovery';
    mkdirSync(recovery, { mode: 0o700 });
    try {
      if (existsSync(path)) {
        regular(path);
        if (JSON.parse(readFileSync(path, 'utf8')).pid !== pid) throw new Error('migration owner changed; retry startup');
        unlinkSync(path);
      }
    } finally { rmdirSync(recovery); }
  }
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); return action(); }
  finally { closeSync(fd); unlinkSync(path); }
}

export function migrateLegacyInstallation(env = process.env) {
  const target = installRoot(env), legacy = legacyInstallRoot(env);
  if (!existsSync(legacy) || target === legacy) return target;
  const marker = join(target, 'legacy-install-migrated.json');
  if (existsSync(marker)) { regular(marker); return target; }
  return locked(target, 'install-migration.lock', () => {
    const copy = (source, destination) => {
      regular(source);
      if (existsSync(destination)) { regular(destination); return; }
      const temporary = destination + '.migration-' + randomUUID();
      try {
        copyFileSync(source, temporary, constants.COPYFILE_EXCL);
        if (existsSync(destination)) { regular(destination); return; }
        renameSync(temporary, destination);
      } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    };
    const directory = lstatSync(legacy);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('unsafe legacy installation');
    for (const relative of ['', 'versions', 'launchers', 'launchers/versions']) {
      const source = join(legacy, relative), destination = join(target, relative);
      if (!existsSync(source)) continue;
      const stat = lstatSync(source);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe legacy installation');
      safeDirectory(destination);
      for (const entry of readdirSync(source)) {
        const allowed = relative.endsWith('versions') ? /^\d+\.\d+\.\d+(?:\.exe)?$/.test(entry) : ['current.json', 'channel.json'].includes(entry);
        if (allowed) copy(join(source, entry), join(destination, entry));
      }
    }
    writeFileSync(marker, JSON.stringify({ version: 1 }), { flag: 'wx', mode: 0o600 });
    return target;
  });
}

export function ensureLauncherEntry(root, source) {
  const bin = join(root, 'bin'), target = join(bin, process.platform === 'win32' ? 'edgey.exe' : 'edgey');
  safeDirectory(bin);
  if (existsSync(target)) { regular(target); return; }
  regular(source);
  const temporary = target + '.migration-' + randomUUID();
  try {
    copyFileSync(source, temporary, constants.COPYFILE_EXCL);
    if (!existsSync(target)) renameSync(temporary, target);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export function assertNoOtherApplications(env = process.env) {
  if (process.platform !== 'win32') return;
  const script = '$roots = $env:EDGEY_MIGRATION_ROOTS | ConvertFrom-Json; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne [int]$env:EDGEY_MIGRATION_PID -and $_.ExecutablePath -and $roots -contains [IO.Path]::GetDirectoryName($_.ExecutablePath) } | ForEach-Object { $_.ProcessId }';
  const shell = join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...env, EDGEY_MIGRATION_PID: String(process.pid), EDGEY_MIGRATION_ROOTS: JSON.stringify([join(installRoot(env), 'versions'), join(legacyInstallRoot(env), 'versions')]) } });
  if (result.status !== 0 || result.stdout.trim()) throw new Error('close other edgey windows and restart to move the saved history into .edgey');
}

export function migrateLegacyData(target, legacy, env = process.env, check = assertNoOtherApplications) {
  if (!existsSync(legacy)) return;
  if (existsSync(target)) {
    if (existsSync(join(legacy, 'cli.db')) && !existsSync(join(target, 'cli.db'))) throw new Error('close other edgey windows; migration found an existing destination without its history database');
    return;
  }
  const stat = lstatSync(legacy);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe legacy data directory');
  locked(dirname(target), 'data-migration.lock', () => {
    if (existsSync(target)) return;
    check(env);
    // rename the whole directory, including SQLite WAL, journals and signing keys.
    // no database copy, overwrite, secret export or partial per-file move.
    renameSync(legacy, target);
  });
}

export function runtimeEnvironment(env = process.env) {
  const temporary = join(installRoot(env), 'cache', 'runtime');
  safeDirectory(temporary);
  return { ...env, TEMP: temporary, TMP: temporary, TMPDIR: temporary };
}
