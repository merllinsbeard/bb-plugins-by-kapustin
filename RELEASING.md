# Independent plugin releases

Repository: `dmitriikapustin/bb-plugins-by-kapustin`.
Publisher: `dmitriikapustin` through the isolated `gh-bb` profile.

## Validate

- Read the plugin README and check the exact Git diff. Preserve its ID and storage contract.
- Update only the affected plugin version and its lockfile. Update the draft marketplace source range when establishing a new compatibility line; compatible patch releases do not need a Community PR.
- Run `node scripts/run.mjs deps NAME`, `check NAME`, `test NAME`, and `build NAME`. Run `npm run catalog:check`.
- Verify a clean install with production dependencies and check the plugin UI using demo data. Review any screenshot before publishing it.
- Review the release commit, publisher account, destination repository, plugin versions, release tags and exact push commands before approval.

## Publish

Commit source changes before tagging. Use one immutable tag per released plugin, for example `goals/v0.1.0`. Never move an existing tag. Updating Goals does not require releasing Uptime or changing its version.

The Git repository has its own author and HTTPS credential helper. `gh-bb api user --jq .login` must report `dmitriikapustin`; ordinary `gh` should keep its original account. Do not use `gh auth switch` or global `gh auth setup-git` for this repository.

After approval, push the reviewed commit and only the intended tags. Root package.json is private and is never published to npm. Git-based plugin releases do not require an npm account.

BB stable sources use the repository URL, a plugin subdirectory, a semver range, and `tagPrefix: "NAME/"`. The collection manifest is an index, not an automatic installer.

## BB Community

`marketplace/entries`, `icons`, `screenshots`, and `overview` are drafts to copy into a fork of [get-bb/marketplace](https://github.com/get-bb/marketplace).

Before each submission, re-read the current upstream schema and contribution rules, verify the public release source, and run all upstream validation commands. Open the PR as `dmitriikapustin`. Submission does not imply acceptance or featured placement.

## Initial source provenance

The initial seven plugins were copied from the owner's previously prepared `community-release/` staging directory. They intentionally differ from some active local development plugins (including publication defaults and documentation). This repository does not automatically synchronize with those directories. Review later development changes explicitly instead of overwriting the release copies wholesale.

Moving an active local installation to this permanent repository is a separate step: verify it, then install its new local path under the same ID to preserve settings. Do not remove and reinstall a plugin to move its source.
