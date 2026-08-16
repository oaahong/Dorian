#!/usr/bin/env node
/**
 * Pull one release's section out of FIX_NOTES.md.
 *
 * Two callers, one source of truth:
 *
 * - `npm version` runs this as a gate. If the version being cut has no section
 *   written for it, the release stops before the commit and tag exist, which is
 *   the only moment where backing out is free. Writing the notes afterwards never
 *   happens; a tag with nothing to say is how a changelog dies.
 * - The release workflow runs it to fill in the GitHub Release body, so what is
 *   published is exactly the text in the repo rather than a second, weaker
 *   changelog generated from commit subjects.
 *
 * Sections are matched on an exact `# v<version> ` heading, so 1.4.1 will not
 * silently settle for the older two-segment `# v1.4` heading above it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The version in package.json right now. */
export function currentVersion() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

/** The body of `# v<version> ...` up to the next top-level heading. */
export function releaseNotes(version) {
  const notes = readFileSync(join(root, 'FIX_NOTES.md'), 'utf8');
  const lines = notes.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`# v${version} `));
  if (start === -1) return null;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('# '));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n');
  // Drop the `---` separator the file puts between sections, and blank padding.
  return body.replace(/\n+---\s*$/, '').trim();
}

/** What to say when the section is missing. Shared with the release driver. */
export function missingNotesMessage(version) {
  return (
    `FIX_NOTES.md has no section for v${version}.\n\n` +
    `Add one before releasing:\n\n  # v${version} <a title someone can read>\n\n` +
    `It becomes the GitHub Release body verbatim, so write it for whoever hits\n` +
    `the bug next — what broke, why the tests missed it, what changed.`
  );
}

// Only when run as a command; scripts/release.mjs imports the functions above.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] ?? currentVersion();
  const section = releaseNotes(version);
  if (!section) {
    console.error(missingNotesMessage(version));
    process.exit(1);
  }
  console.log(section);
}
