import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function supportedNode(version) {
  const [major, minor] = String(version).replace(/^v/, '').split('.').map(Number);
  return major === 22 && minor >= 23 || major === 24 && minor >= 5 || major > 24;
}

export async function dependenciesReady(root = projectRoot) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const noDependencies = value => ['dependencies', 'optionalDependencies', 'devDependencies']
      .every(field => value?.[field] === undefined || value[field] && typeof value[field] === 'object'
        && !Array.isArray(value[field]) && Object.keys(value[field]).length === 0);
    return manifest.name === 'meme-radar-open-source' && noDependencies(manifest)
      && lock.name === manifest.name && lock.version === manifest.version
      && lock.packages && Object.keys(lock.packages).length === 1
      && lock.packages['']?.version === manifest.version && noDependencies(lock.packages['']);
  } catch { return false; }
}

const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;

export async function withLocalLock(name, callback, { root = projectRoot, fsImpl = fs,
  pid = process.pid, kill = process.kill, pause = delay, attempts = 400 } = {}) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name) || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('启动锁参数无效。');
  const runtime = path.join(root, '.runtime'), lock = path.join(runtime, `${name}.lock`);
  const recovery = `${lock}.recovery`, temporary = path.join(runtime, `.lock-owner-${randomUUID()}.tmp`);
  const failure = (code, target = lock) => Object.assign(new Error(
    `启动锁无法安全确认：本项目 .runtime/${path.basename(target)}。请关闭本项目所有启动窗口并确认没有相关进程；保留该锁并联系维护者检查，不要删除整个 .runtime。`), { code });
  const alive = owner => {
    try { kill(owner, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; } // Permission/unknown errors never prove a dead owner.
  };
  const inspect = target => {
    let stat;
    try { stat = fsImpl.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw failure('RADAR_LOCK_UNSAFE', target);
    const directory = stat.isDirectory(), ownerFile = directory ? path.join(target, 'pid') : target;
    if (directory && fsImpl.readdirSync(target).some(entry => entry !== 'pid')) throw failure('RADAR_LOCK_UNSAFE', target);
    let ownerStat, fd;
    try {
      ownerStat = fsImpl.lstatSync(ownerFile);
      if (!ownerStat.isFile() || ownerStat.isSymbolicLink() || ownerStat.size > 64 || ownerStat.nlink > (directory ? 1 : 2)) {
        throw failure('RADAR_LOCK_UNSAFE', target);
      }
      fd = fsImpl.openSync(ownerFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      if (!sameFile(ownerStat, fsImpl.fstatSync(fd))) throw failure('RADAR_LOCK_CHANGED', target);
      const text = fsImpl.readFileSync(fd, 'utf8').trim(), owner = Number(text);
      if (!/^\d+$/.test(text) || !Number.isSafeInteger(owner) || owner <= 0) return { stat, directory, incomplete: true };
      return { stat, directory, ownerStat, ownerFile, owner };
    } catch (error) {
      if (error.code === 'ENOENT') return { stat, directory, incomplete: true };
      throw error;
    } finally { if (fd !== undefined) fsImpl.closeSync(fd); }
  };
  const unlinkOwned = (target, expected) => {
    let current;
    try { current = fsImpl.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!sameFile(current, expected) || !current.isFile() || current.isSymbolicLink()) throw failure('RADAR_LOCK_CHANGED', target);
    fsImpl.unlinkSync(target);
  };
  fsImpl.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const runtimeStat = fsImpl.lstatSync(runtime);
  if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()) throw failure('RADAR_LOCK_UNSAFE');
  let prepared, fd, ownsTemporary = false, callbackFailure;
  try {
    // A complete, flushed owner becomes visible atomically. A crash before
    // link leaves only an unrelated temp file, never an ownerless held lock.
    fd = fsImpl.openSync(temporary, 'wx', 0o600); ownsTemporary = true;
    fsImpl.writeFileSync(fd, `${pid}\n`); fsImpl.fsyncSync(fd); prepared = fsImpl.fstatSync(fd);
    fsImpl.closeSync(fd); fd = undefined;
    let incompleteWaits = 0;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let acquired = false;
      try { fsImpl.linkSync(temporary, lock); acquired = true; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (acquired) {
        try {
          unlinkOwned(temporary, prepared); ownsTemporary = false;
          try { return await callback(); } catch (error) { callbackFailure = { error }; throw error; }
        }
        finally { unlinkOwned(lock, prepared); }
      }
      const previous = inspect(lock);
      if (!previous) continue;
      if (previous.incomplete) {
        // Legacy mkdir+pid acquisition could be in progress. Give it a short
        // grace period; absence/age alone cannot prove that its creator died.
        if (++incompleteWaits >= 10) throw failure('RADAR_LOCK_ORPHAN');
      } else if (!alive(previous.owner)) {
        // Only one reaper may remove a confirmed-dead owner. Without this
        // guard, two reapers could delete a newly acquired replacement lock.
        let reaping = false;
        try { fsImpl.linkSync(temporary, recovery); reaping = true; }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const guard = inspect(recovery);
          if (guard && (guard.incomplete || !alive(guard.owner))) throw failure('RADAR_LOCK_RECOVERY', recovery);
        }
        if (reaping) {
          try {
            const current = inspect(lock);
            if (current && sameFile(current.stat, previous.stat) && !current.incomplete && !alive(current.owner)) {
              unlinkOwned(current.ownerFile, current.ownerStat);
              if (current.directory) fsImpl.rmdirSync(lock);
            }
          } finally { unlinkOwned(recovery, prepared); }
          continue;
        }
      }
      await pause(300);
    }
    throw Object.assign(new Error(`本项目 .runtime/${name}.lock 仍由活动进程持有，请等待启动完成后重试。`), { code: 'RADAR_LOCK_BUSY' });
  } catch (error) {
    if (callbackFailure && error === callbackFailure.error || error?.code?.startsWith('RADAR_LOCK_')) throw error;
    throw failure('RADAR_LOCK_IO');
  } finally {
    if (fd !== undefined) fsImpl.closeSync(fd);
    if (ownsTemporary) {
      // Only the unique file created by this attempt is eligible for cleanup.
      try { if (prepared) unlinkOwned(temporary, prepared); else fsImpl.unlinkSync(temporary); } catch { /* Never remove another path. */ }
    }
  }
}

export async function ensureDependencies() {
  if (!supportedNode(process.versions.node)) throw new Error('需要 Node.js 22.23+ 或 24.5+，双击“安装并启动.command”可自动准备。');
  // The AVE-only application uses Node built-ins. Never install or load an old
  // dependency tree merely because it remains beside a user's local history.
  if (!await dependenciesReady()) throw new Error('发行文件不完整或依赖清单不一致，请重新解压完整的开源版。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { await ensureDependencies({ checkOnly: process.argv.includes('--check') }); console.log('运行环境已就绪。'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
