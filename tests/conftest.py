"""Pytest configuration for CharterFlow contract tests."""
import gltest.direct.sdk_loader as sdk_loader

# Upstream GenVM repository migrated from genlayerlabs/genvm to genlayerlabs/genvm-manager.
# Pinned artifacts including v0.6.0-rc8 are published under genlayerlabs/genvm-manager.
sdk_loader.GITHUB_RELEASES_URL = "https://github.com/genlayerlabs/genvm-manager/releases"
