#!/bin/sh
# Lance l'empreinte visuelle dans l'environnement figé.
#
#   qa/conteneur.sh              compare le site à la référence
#   qa/conteneur.sh --update     régénère la référence
#
# Pourquoi ce fichier : l'empreinte mesure des largeurs et des hauteurs en
# pixels. Ces mesures n'appartiennent pas au site, elles appartiennent au
# couple « site + machine qui dessine » : le même texte, la même police, ne
# donnent pas la même largeur sous macOS, Windows ou Linux. Comparée à un
# relevé pris ailleurs, l'empreinte signale des centaines d'écarts qui ne
# veulent rien dire, et on cesse de la lire.
#
# Elle mesure donc toujours dans le même environnement, décrit ici et nulle
# part ailleurs : une image épinglée par son empreinte, dont le tag fixe le
# système ET l'architecture. La CI utilise exactement la même, ce qui rend le
# verdict identique ici et sur GitHub — et insensible à un changement de poste.
#
# Le dépôt est recopié dans le conteneur avant l'installation : les
# dépendances du poste ne sont pas celles de Linux, et les mélanger casserait
# l'un ou l'autre. Seul le relevé régénéré ressort.

set -e

IMAGE="mcr.microsoft.com/playwright@sha256:941cc91e5022880ac1d14ae90b476b624deb6399dbbc28d612d5d5bd7928fcbd"

RACINE=$(cd "$(dirname "$0")/.." && pwd)

if ! command -v docker > /dev/null 2>&1; then
  echo "docker est introuvable." >&2
  echo "Ouvrir Docker Desktop, ou ajouter son dossier au PATH :" >&2
  echo "  /Applications/Docker.app/Contents/Resources/bin" >&2
  exit 1
fi

if ! docker info > /dev/null 2>&1; then
  echo "Le moteur Docker ne répond pas. Ouvrir Docker Desktop et réessayer." >&2
  exit 1
fi

if [ "$1" = "--update" ]; then
  INTERNE='npm run qa:update && cp qa/reference.json /src/qa/reference.json'
  echo "Régénération de la référence dans l'environnement figé…"
else
  INTERNE='npm run qa:empreinte'
  echo "Comparaison dans l'environnement figé…"
fi

exec docker run --rm \
  -v "$RACINE":/src \
  -w /tmp \
  "$IMAGE" \
  sh -c "set -e
    cp -a /src /app
    cd /app
    rm -rf node_modules
    npm ci --no-audit --no-fund --silent
    $INTERNE"
