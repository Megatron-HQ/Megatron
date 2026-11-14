# frozen_string_literal: true

# Template for Casks/megatron.rb in Megatron-HQ/homebrew-tap. homebrew-tap.yml substitutes the
# version and sha256 placeholders from each published release; don't hand-edit the tap's copy.
cask "megatron" do
  version "@VERSION@"
  sha256 "@SHA256@"

  url "https://github.com/Megatron-HQ/Megatron/releases/download/v#{version}/megatron-#{version}-mac.zip"
  name "Megatron"
  desc "Inventory, lint and track usage of Claude Code skills and plugins"
  homepage "https://github.com/Megatron-HQ/Megatron"

  # The app replaces its own bundle in place (src/main/mac-self-update.ts), so `brew upgrade`
  # skips this cask unless it is named or --greedy is passed.
  auto_updates true
  depends_on arch: :arm64

  app "Megatron.app"

  # Megatron is ad-hoc signed, without a Developer ID, so Gatekeeper blocks a quarantined copy.
  # Installing through this tap is the user's explicit choice to trust it.
  postflight_steps do
    run "/usr/bin/xattr",
        args:           ["-dr", "com.apple.quarantine", "{{appdir}}/Megatron.app"],
        writable_paths: ["Megatron.app"],
        writable_base:  :appdir
  end

  zap trash: [
    "~/Library/Application Support/megatron",
    "~/Library/Caches/megatron-updater",
    "~/Library/Preferences/com.megatron.app.plist",
    "~/Library/Saved Application State/com.megatron.app.savedState",
  ]
end
