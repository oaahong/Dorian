#!/usr/bin/env node
/**
 * Cut a release: `npm run release:patch` (or :minor, :major).
 *
 * Everything this does, `npm version` would do too. What it adds is refusing
 * early. `npm version` runs its checks *after* writing the new number into
 * package.json, so a failed check leaves the file bumped, uncommitted, and — the
 * part that bites — a second attempt bumps it again, turning a failed 1.4.2 into
 * a released 1.4.3. Every check here runs before anything on disk is touched.
 *
 * From there `npm version` takes over and does the standard thing: bump
 * package.json and the lockfile, commit, create an annotated tag. `postversion`
 * pushes both, which is what makes .github/workflows/release.yml publish the
 * GitHub Release.
 */
import { execFileSync } from 'node:child_process';
import { currentVersion, missingNotesMessage, releaseNotes } from './release-notes.mjs';

const BUMPS = ['patch', 'minor', 'major'];

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const bump = process.argv[2];
if (!BUMPS.includes(bump)) fail(`Usage: node scripts/release.mjs <${BUMPS.join('|')}>`);

/** Semver by hand: three integers, and everything to the right of the bump resets. */
function nextVersion(version, kind) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    fail(`package.json version "${version}" is not a semver x.y.z, so nothing can be bumped from it.`);
  }
  const [major, minor, patch] = parts;
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const from = currentVersion();
const to = nextVersion(from, bump);

// A release publishes a GitHub Release and is what Render has already deployed,
// so it has to come from the branch that was reviewed and tested.
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') {
  fail(`On branch ${branch}. Releases are cut from main — merge first, or tag by hand if you mean it.`);
}

if (git('status', '--porcelain')) {
  fail('Working tree is dirty. Commit or stash first: the release commit should contain only the version bump.');
}

// Cheap, and catches the case where main is behind: the tag would then be made
// on a commit the remote does not have, and the workflow would never see it.
git('fetch', 'origin', 'main', '--quiet');
if (git('rev-list', '--count', 'HEAD..origin/main') !== '0') {
  fail('origin/main has commits this branch does not. Pull first, so the tag lands on what everyone else sees.');
}

if (!releaseNotes(to)) fail(missingNotesMessage(to));

console.log(`Releasing ${from} -> ${to} from ${branch}. Running the full verify first; this takes a few minutes.\n`);
execFileSync('npm', ['version', bump, '-m', 'Release %s'], { stdio: 'inherit' });
