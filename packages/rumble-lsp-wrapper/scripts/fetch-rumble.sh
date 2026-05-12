#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WRAPPER_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
RUMBLE_DIR="$WRAPPER_DIR/rumble"

RUMBLE_REPO_URL="${RUMBLE_REPO_URL:-https://github.com/RumbleDB/rumble.git}"
RUMBLE_REF="${RUMBLE_REF:-master}"
RUMBLE_VERSION="${RUMBLE_VERSION:-2.1.0}"
RUMBLE_JAR="$RUMBLE_DIR/target/rumbledb-$RUMBLE_VERSION-jar-with-dependencies.jar"

if [ ! -d "$RUMBLE_DIR" ]; then
    echo "Cloning Rumble repository from $RUMBLE_REPO_URL (ref: $RUMBLE_REF)..." >&2
    git clone --depth 1 --branch "$RUMBLE_REF" "$RUMBLE_REPO_URL" "$RUMBLE_DIR"
fi

if [ ! -f "$RUMBLE_JAR" ]; then
    echo "Building Rumble from source..." >&2
    (cd "$RUMBLE_DIR" && mvn -q -DskipTests clean compile assembly:single)
fi

if [ ! -f "$RUMBLE_JAR" ]; then
    echo "Expected Rumble jar not found: $RUMBLE_JAR" >&2
    exit 1
fi
