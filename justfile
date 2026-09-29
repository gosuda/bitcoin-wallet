# Tasks for this repository; `just --list` shows them. Each recipe is a line
# or two over a script or a plain command, so nothing here needs `just` to run.

# Print the app's version, and fail if any copy of it disagrees.
version:
    scripts/check-version.sh

# Set the app's version everywhere, e.g. `just bump 0.2.0`.
bump next:
    scripts/bump-version.sh {{next}}
