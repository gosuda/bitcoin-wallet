# Rulesets

`main.json` is what protects `main`: a pull request to change it, the `rust` workflow's
jobs green, no force-push, no deletion, and no one exempt. It is applied with `gh`, and
the copy here is the source of truth — edit this file, then push it:

```bash
# first time
gh api -X POST repos/gosuda/bitcoin-wallet/rulesets --input docs/rulesets/main.json

# after an edit
id=$(gh api repos/gosuda/bitcoin-wallet/rulesets --jq '.[] | select(.name == "main") | .id')
gh api -X PUT "repos/gosuda/bitcoin-wallet/rulesets/$id" --input docs/rulesets/main.json

# what main is actually held to
gh api repos/gosuda/bitcoin-wallet/rules/branches/main
```

The required checks are job **names** from `.github/workflows/rust.yml`. Renaming or
removing a job there without updating this list leaves every pull request waiting on a
check that will never report — change both in the same pull request, and re-apply.
`integration_id` 15368 is GitHub Actions, so only a real workflow run can satisfy a check,
not a commit status posted by hand.
