#!/usr/bin/env bash
# Cloud environment setup script. Owned by `foundation`.
#
# SELF-CONTAINED ON PURPOSE: paste this whole file into the cloud environment's setup-script field. It runs from the
# directory ABOVE the repository, so it references no other repo file (the Gradle init script is embedded below).
#
# Idempotent, ALWAYS exits 0 (problems are warnings), every heavy step is guarded by `timeout`.
# Installs into ANDROID_HOME (default /opt/android-sdk): cmdline-tools, platform-tools, platforms;android-37.0,
# build-tools;37.0.0, ndk;27.1.12297006, cmake;3.22.1 (the versions app.config.ts / React Native 0.88 expect).
# Test knobs: ANDROID_HOME=<dir>, HOME=<dir>, CLOUD_SETUP_SKIP_ENV=1 (do not write /etc/profile.d or ~/.bashrc).
# There is no metrics opt-out flag in sdkmanager (checked `sdkmanager --help`); it sends none by itself.

set +e
set -u

ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

SDK_PACKAGES=(
  "platform-tools"
  "platforms;android-37.0"
  "build-tools;37.0.0"
  "ndk;27.1.12297006"
  "cmake;3.22.1"
)
# Directory (relative to ANDROID_HOME) proving each package above is installed.
SDK_DIRS=(
  "platform-tools"
  "platforms/android-37.0"
  "build-tools/37.0.0"
  "ndk/27.1.12297006"
  "cmake/3.22.1"
)
FALLBACK_CMDLINE_ZIP="commandlinetools-linux-16111833_latest.zip"
REPO_XML_URL="https://dl.google.com/android/repository/repository2-3.xml"
DOWNLOAD_BASE="https://dl.google.com/android/repository"

T0=$(date +%s)
LOG=()
WARNINGS=0
say() { printf '[cloud-setup +%3ss] %s\n' "$(($(date +%s) - T0))" "$*"; }
warn() { WARNINGS=$((WARNINGS + 1)); say "WARNING: $*"; }
note() { LOG+=("$*"); }
have() { command -v "$1" >/dev/null 2>&1; }

say "start: ANDROID_HOME=$ANDROID_HOME HOME=${HOME:-?}"

# ---------------------------------------------------------------- prerequisites
if ! have java; then warn "java not found: sdkmanager cannot run (install a JDK 17+)"; fi
for tool in curl unzip; do have "$tool" || warn "$tool not found"; done
SUDO=""
if [ "$(id -u)" != "0" ] && have sudo; then SUDO="sudo"; fi

# ---------------------------------------------------------------- SDK root
if ! mkdir -p "$ANDROID_HOME" 2>/dev/null; then
  if [ -n "$SUDO" ] && $SUDO mkdir -p "$ANDROID_HOME" && $SUDO chown "$(id -u):$(id -g)" "$ANDROID_HOME"; then :; else
    warn "cannot create $ANDROID_HOME"
  fi
fi

# ---------------------------------------------------------------- cmdline-tools
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [ -x "$SDKMANAGER" ]; then
  note "cmdline-tools: already present"
else
  say "installing cmdline-tools"
  zip_name=""
  zip_name="$(timeout 60 curl -fsS --retry 2 "$REPO_XML_URL" 2>/dev/null |
    grep -o 'commandlinetools-linux-[0-9]*_latest\.zip' | sort -t- -k3 -n -u | tail -n 1)"
  if [ -z "$zip_name" ]; then
    zip_name="$FALLBACK_CMDLINE_ZIP"
    warn "could not read $REPO_XML_URL, using fallback $zip_name"
  fi
  tmp="$(mktemp -d)"
  if timeout 180 curl -fsS --retry 3 -o "$tmp/cmdline.zip" "$DOWNLOAD_BASE/$zip_name" &&
    unzip -q "$tmp/cmdline.zip" -d "$tmp/x" &&
    [ -d "$tmp/x/cmdline-tools" ]; then
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    rm -rf "$ANDROID_HOME/cmdline-tools/latest"
    mv "$tmp/x/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
    note "cmdline-tools: installed $zip_name"
  else
    warn "cmdline-tools download/unpack failed ($zip_name)"
  fi
  rm -rf "$tmp"
fi

# ---------------------------------------------------------------- licenses + packages
if [ -x "$SDKMANAGER" ]; then
  missing=()
  for i in "${!SDK_PACKAGES[@]}"; do
    [ -d "$ANDROID_HOME/${SDK_DIRS[$i]}" ] || missing+=("${SDK_PACKAGES[$i]}")
  done
  if [ ${#missing[@]} -eq 0 ]; then
    note "sdk packages: all present"
  else
    say "accepting licenses"
    # `yes` dies of SIGPIPE when sdkmanager stops reading: expected.
    yes 2>/dev/null | timeout 90 "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 ||
      warn "license acceptance returned non-zero (may be fine if already accepted)"
    say "installing: ${missing[*]}"
    if timeout 240 "$SDKMANAGER" --sdk_root="$ANDROID_HOME" "${missing[@]}" >/dev/null 2>&1; then
      note "sdk packages installed: ${missing[*]}"
    else
      warn "sdkmanager did not finish installing: ${missing[*]} (re-run this script; it resumes)"
    fi
    for i in "${!SDK_PACKAGES[@]}"; do
      [ -d "$ANDROID_HOME/${SDK_DIRS[$i]}" ] || warn "still missing: ${SDK_PACKAGES[$i]}"
    done
  fi
fi

# ---------------------------------------------------------------- Gradle: Central mirror init script + properties
# Maven Central answers HTTP 429 to the shared cloud egress; Google's public Central mirror is not rate limited.
# CI and developer machines use real Central (this file is cloud-only and not part of the repo).
GRADLE_HOME_DIR="${HOME:-/root}/.gradle"
if mkdir -p "$GRADLE_HOME_DIR/init.d" 2>/dev/null; then
  cat >"$GRADLE_HOME_DIR/init.d/00-central-mirror.gradle.tmp" <<'GRADLE_INIT_EOF'
// Cloud-session workaround: Maven Central (Cloudflare) answers HTTP 429 to bursts from the shared egress IP.
// Google's public Central mirror is not rate limited. CI and developer machines use real Central.
def MIRROR = 'https://maven-central.storage-download.googleapis.com/maven2/'
def isCentral = { String u -> u.matches('^https?://(repo\\.maven\\.apache\\.org|repo1\\.maven\\.org)/maven2/?$') }
def patch = { repos ->
  repos.configureEach { repo ->
    if (repo instanceof MavenArtifactRepository && isCentral(repo.url.toString())) { repo.url = MIRROR }
  }
}
gradle.beforeSettings { settings -> patch(settings.pluginManagement.repositories) }
gradle.settingsEvaluated { settings -> patch(settings.dependencyResolutionManagement.repositories) }
gradle.allprojects { project ->
  patch(project.buildscript.repositories)
  patch(project.repositories)
}
GRADLE_INIT_EOF
  mv -f "$GRADLE_HOME_DIR/init.d/00-central-mirror.gradle.tmp" "$GRADLE_HOME_DIR/init.d/00-central-mirror.gradle"
  note "gradle: wrote init.d/00-central-mirror.gradle"

  props="$GRADLE_HOME_DIR/gradle.properties"
  touch "$props"
  added=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    key="${line%%=*}"
    # Add only keys that are not already set (never clobber existing values).
    if ! grep -q "^[[:space:]]*${key//./\\.}[[:space:]]*=" "$props"; then
      printf '%s\n' "$line" >>"$props"
      added=$((added + 1))
    fi
  done <<'GRADLE_PROPS_EOF'
org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8
org.gradle.daemon=true
org.gradle.caching=true
org.gradle.workers.max=3
systemProp.org.gradle.internal.repository.max.retries=8
systemProp.org.gradle.internal.repository.initial.backoff=2000
systemProp.org.gradle.internal.http.connectionTimeout=60000
systemProp.org.gradle.internal.http.socketTimeout=120000
GRADLE_PROPS_EOF
  note "gradle: gradle.properties lines added: $added"
else
  warn "cannot create $GRADLE_HOME_DIR/init.d"
fi

# ---------------------------------------------------------------- persist environment for later shells
persist_env() {
  local block marker_begin="# >>> pillion android sdk >>>" marker_end="# <<< pillion android sdk <<<"
  block="$marker_begin
export ANDROID_HOME=\"$ANDROID_HOME\"
export ANDROID_SDK_ROOT=\"$ANDROID_HOME\"
case \":\$PATH:\" in *\":$ANDROID_HOME/platform-tools:\"*) ;; *) export PATH=\"\$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools\" ;; esac
$marker_end"
  local rc="${HOME:-/root}/.bashrc"
  touch "$rc" 2>/dev/null
  if grep -qF "$marker_begin" "$rc" 2>/dev/null; then
    note "env: ~/.bashrc already has the block"
  elif printf '\n%s\n' "$block" >>"$rc" 2>/dev/null; then
    note "env: appended block to $rc"
  else
    warn "cannot write $rc"
  fi
  local pd=/etc/profile.d/android-sdk.sh
  if [ -d /etc/profile.d ]; then
    if printf '%s\n' "$block" | ${SUDO:+$SUDO }tee "$pd.tmp" >/dev/null 2>&1 && ${SUDO:+$SUDO }mv -f "$pd.tmp" "$pd" 2>/dev/null; then
      note "env: wrote $pd"
    else
      warn "cannot write $pd"
    fi
  fi
}
if [ "${CLOUD_SETUP_SKIP_ENV:-0}" = "1" ]; then
  note "env: skipped (CLOUD_SETUP_SKIP_ENV=1)"
else
  persist_env
fi

# ---------------------------------------------------------------- summary
say "summary"
for l in "${LOG[@]}"; do say "  - $l"; done
for i in "${!SDK_PACKAGES[@]}"; do
  if [ -d "$ANDROID_HOME/${SDK_DIRS[$i]}" ]; then say "  ok       ${SDK_PACKAGES[$i]}"; else say "  MISSING  ${SDK_PACKAGES[$i]}"; fi
done
say "done in $(($(date +%s) - T0))s with $WARNINGS warning(s); exit 0"
exit 0
