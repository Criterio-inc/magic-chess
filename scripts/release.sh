#!/bin/bash
# Bygger, signerar och notariserar Saecula: Kartbordet som Mac-app. Resultatet är en
# skivavbild som startar utan Gatekeeper-varning på Intel och Apple Silicon.
# Samma mönster som critero-clean-up/scripts/release.sh:
#   1. Developer ID Application-certifikat i nyckelringen (väljs med hash,
#      eftersom «Á» i namnet ger «no identity found» i codesign)
#   2. Appspecifikt lösenord i nyckelringen som tjänsten critero-apple-notary
# Lösenordet passerar aldrig ett skalfönster eller en loggfil.
#
# Användning: ./scripts/release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
KEYCHAIN_SERVICE="critero-apple-notary"
fail() { echo "FEL: $1" >&2; exit 1; }

cert_line="$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 || true)"
identity="$(sed -n 's/.*"\(Developer ID Application[^"]*\)".*/\1/p' <<< "$cert_line" || true)"
signing_id="${APPLE_SIGNING_IDENTITY:-$(awk '{print $2}' <<< "$cert_line" || true)}"
[[ -n "$signing_id" ]] || fail "Hittar inget Developer ID Application-certifikat i nyckelringen."
team_id="${APPLE_TEAM_ID:-$(sed -n 's/.*(\([A-Z0-9]\{10\}\))$/\1/p' <<< "$identity" || true)}"
[[ -n "$team_id" ]] || fail "Kunde inte läsa ut team-id."

apple_id="${APPLE_ID:-$(security find-generic-password -s "$KEYCHAIN_SERVICE" 2> /dev/null | sed -n 's/.*"acct"<blob>="\(.*\)"/\1/p' || true)}"
[[ -n "$apple_id" ]] || fail "Hittar inget Apple-id för tjänsten $KEYCHAIN_SERVICE."
apple_password="$(security find-generic-password -w -s "$KEYCHAIN_SERVICE" 2> /dev/null)" ||
    fail "Hittar inget appspecifikt lösenord för tjänsten $KEYCHAIN_SERVICE."

echo "Signerar som: $identity ($signing_id)"
echo "Team-id:      $team_id"
echo

export APPLE_SIGNING_IDENTITY="$signing_id" APPLE_ID="$apple_id" APPLE_PASSWORD="$apple_password" APPLE_TEAM_ID="$team_id"
npx tauri build --target universal-apple-darwin

out="src-tauri/target/universal-apple-darwin/release/bundle"
app="$out/macos/Saecula Kartbordet.app"
dmg="$(find "$out/dmg" -name '*.dmg' -maxdepth 1 | head -1)"
[[ -d "$app" ]] || fail "Hittar ingen byggd app i $app"
[[ -n "$dmg" ]] || fail "Hittar ingen skivavbild i $out/dmg"

# Filnamn med å/ä/ö inne i paketet byter Unicode-form när Finder kopierar appen, och då räknas den som skadad.
icke_ascii="$(cd "$app" && find . -name '*[! -~]*' | head -5)"
[[ -z "$icke_ascii" ]] || fail "Filnamn utanför ASCII i appen: $icke_ascii"
codesign --verify --deep --strict "$app" || fail "Appens signatur håller inte"

# Tauri notariserar appen; skivavbilden är en egen fil som Gatekeeper
# kontrollerar först när mottagaren dubbelklickar den.
echo; echo "Notariserar skivavbilden..."
xcrun notarytool submit "$dmg" --apple-id "$apple_id" --password "$apple_password" --team-id "$team_id" --wait
xcrun stapler staple "$dmg"

# Kopiera ut ur target/ direkt: ett nytt bygge skriver annars över den
# notariserade filen utan varning.
version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
dest="$HOME/Desktop/Saecula-Kartbordet-$version.dmg"
cp "$dmg" "$dest"

# Det avgörande provet: sätt karantänflaggan som en nedladdning får och fråga
# Gatekeeper precis som mottagarens Mac gör vid dubbelklick.
probe="$(mktemp -d)/prov.dmg"
cp "$dest" "$probe"
xattr -w com.apple.quarantine "0083;$(printf '%x' "$(date +%s)");Safari;" "$probe"
echo; echo "=== Kontroll ==="
lipo -archs "$app/Contents/MacOS/kartbordet"
spctl -a -vv -t open --context context:primary-signature "$probe" 2>&1 | sed 's/^/  /'
xcrun stapler validate "$dest" 2>&1 | sed 's/^/  /'
echo; echo "Klar: $dest"
