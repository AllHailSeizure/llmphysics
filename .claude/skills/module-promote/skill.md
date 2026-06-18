---
name: module-promote
description: Use when promoting a verified llmphysics-bot module from the develop branch to publish. Handles file-path staging, lint gate, README/CHANGELOG updates, upload smoke test, publish, and git tagging.
---

# module-promote

Promotion workflow for llmphysics-bot. Stages by file path (not cherry-pick — develop is always messy). Requires `/module-verify` to have returned `VERIFIED ✓` first.

## Usage

`/module-promote <module-name>`

---

## Steps

**1. Pre-flight**
- Confirm `/module-verify <module-name>` returned `VERIFIED ✓`
- Determine version bump: new module → `minor`; bug fix → `patch`; architecture break → `major`

**2. Lint + build gate**
```bash
cd llmphysics-bot
npm run lint   # must pass with zero errors — fix lint errors before continuing
npm run build  # must compile clean
```

**3. Stage by file path**
```bash
git checkout publish
git checkout develop -- src/server/trigger-modules/<name>.ts   # adjust path for module type
git checkout develop -- src/server/registry.ts                 # always
git checkout develop -- llmphysics-bot/.documentation/verification-status.md  # always
# + any shared helpers this module exclusively introduced
```
Ask the user to confirm the exact file list before staging.

_Note: `verification-status.md` carries the content hashes and test results written by `/module-verify`. The hash of the module file is content-based, so it remains valid after staging — no re-hashing needed._

**4. Review staged diff**
```bash
git diff --staged
```
Confirm: only the declared files appear. If anything extra shows up, stop and investigate before continuing.

**5. Safety scan (check each)**
- [ ] Only the declared module files are staged — nothing else
- [ ] No WIP markers: `// TODO`, `// TEMP`, `// FIXME`, `console.log debug`
- [ ] Build passed (step 2)
- [ ] `MODULE` descriptor is present and accurate in the module file

**6. Commit**
```bash
git commit -m "module(<name>): add verified — vX.X.X"
```
_(Use the next version number — determined in step 7.)_

**7. Update README and CHANGELOG**
- README: add or update the module row in the module table (name, type, description, version added, `✓ Verified`)
- CHANGELOG: add entry under `[Unreleased]` section

**8. Upload (private smoke test)**
```bash
npm run build && devvit upload --bump minor   # match the bump type from step 1
```
Run `/module-verify <module-name>` one final time against the uploaded version.

**9. Publish**
```bash
devvit publish --bump minor   # must match the bump used in upload
```
Confirm the new version number in the CLI output.

**9a. Record promote in verification-status.md**

Update the `## <module-name>` section in `llmphysics-bot/.documentation/verification-status.md`:
- Set `Last promoted` to today's date + the version number from step 9's output

Then commit on the `publish` branch:
```bash
git add llmphysics-bot/.documentation/verification-status.md
git commit -m "chore(<name>): record promote — vX.X.X"
```

**10. Tag and merge**
```bash
git tag v<new-version>   # e.g. git tag v2.4.0
git checkout master
git merge publish
git push origin master
git push origin --tags
```

---

## Publish commit standard (enforced here)

A publish commit MUST contain exactly: the module file + registry/index changes + any shared helper exclusively introduced by this module.

**Smell check:** "If I stripped out `<module>` files, would any diff remain?" → If yes, stop.
