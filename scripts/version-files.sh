# shellcheck shell=bash disable=SC2034 # sourced by bump-version.sh and check-version.sh
packages=(package.json packages/wallet-ui/package.json apps/web/package.json apps/native/package.json)
plist=apps/native/src-tauri/gen/apple/bitcoin-wallet-app_iOS/Info.plist
project=apps/native/src-tauri/gen/apple/project.yml
