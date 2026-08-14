# Miaoucratie

Site vitrine de Miaoucratie, garde de chats à domicile autour de Domagné (Ille-et-Vilaine).

Site statique publié par GitHub Pages sur <https://miaoucratie.fr>. Pas de framework, pas d'étape de compilation : ce qui est dans le dépôt est ce qui est servi.

## Publier

```bash
git push origin main
```

GitHub Pages reconstruit en une à deux minutes. Les fichiers sont servis avec `cache-control: max-age=600` et un ETag calculé sur leur contenu : une modification est donc visible au plus tard 10 minutes après. **Ne pas ajouter de `?v=` aux feuilles de style**, c'est inutile ici et cela crée une maintenance manuelle qui finit toujours par être oubliée.

## Pages

| Fichier | Rôle |
|---|---|
| `index.html` | Accueil : positionnement, avis Google, prestations, zone |
| `tarifs.html` | Grille tarifaire et conditions |
| `faq.html` | 37 questions, avec accordéon, filtres et recherche |
| `carte.html` | Vérification de commune (Leaflet + API adresse) |
| `reservation.html` | Formulaire de demande (Flatpickr, hCaptcha, Web3Forms) |
| `calculateur-miaoucratie.html` | Simulateur de devis |
| `cgv.html` | Conditions générales de vente |
| `mentions-legales.html` | Mentions légales et RGPD |
| `admin-indisponibilites.html` | Administration des périodes d'indisponibilité |

## Feuilles de style

| Fichier | Portée |
|---|---|
| `css/style.css` | Base commune à toutes les pages |
| `css/overrides.css` | Correctifs partagés par index, faq, cgv, calculateur |
| `css/topbar.css` | Barre de navigation (index, faq, cgv) |
| `css/page-legale.css` | Mise en page des documents juridiques (CGV, mentions) |
| `css/reservation.css` | Formulaire de réservation et page admin |

Chaque page porte en plus des blocs `<style>` qui lui sont propres.

## Pièges connus

Ces points ont chacun provoqué une panne réelle. Les lire avant toute modification en masse.

**L'équilibre des balises ne prouve rien.** Une suppression de blocs par comptage de `<div>` a compté les `<div>` écrits *dans les chaînes JavaScript* et emporté 4 400 caractères de trop, détruisant l'accordéon, la recherche, les filtres et le menu de la FAQ. Les balises restaient équilibrées et la page paraissait saine. Toujours vérifier le **comportement**, jamais la structure seule.

**Une classe peut servir à deux choses.** Harmoniser `.eyebrow` a repeint une pastille flottante de `carte.html` qui utilisait la même classe pour un autre usage. Vérifier qui d'autre utilise une classe avant de la modifier.

**`white-space: nowrap` doit être conditionné.** Posé sur un titre pour éviter une coupure disgracieuse, il a fait déborder `reservation.html` de 84 px sur mobile.

**Un `<img>` avec un attribut `height` ignore `aspect-ratio`** tant que `height: auto` n'est pas déclaré en CSS.

**Les `!important` ne sont pas décoratifs.** `style.css` est chargé en premier mais contient des règles censées écraser les styles propres à chaque page, qui viennent après. C'est la seule raison d'être de la plupart des `!important` du site. En retirer sans réordonner la cascade casse la mise en page. Voir `DETTE-TECHNIQUE.md`.

**La carte se teste hors Leaflet.** Le marqueur de départ dépend d'un appel réseau de géocodage : sa présence varie d'un chargement à l'autre. Toute comparaison automatique de `carte.html` doit exclure les éléments `leaflet-*`, sinon elle produit de faux positifs reproductibles.

## Vérifier une modification

```bash
npm install    # une seule fois : installe Playwright et Chromium
npm run qa     # vérifie le site
```

Le harnais lance un serveur local, ouvre les 9 pages en 1272 px et 375 px, et contrôle deux choses.

**L'empreinte visuelle.** Pour chacun des 3 200 éléments du site, il relève dimensions, position et styles calculés, puis compare à `qa/reference.json`. C'est ce qui attrape les régressions silencieuses d'une modification CSS.

**Le comportement.** Menu burger sur les 9 pages, accordéon et filtres et recherche de la FAQ, synchronisation des données structurées avec le texte affiché, moteur de communes de la carte sur ses trois verdicts avec la couleur de marqueur attendue, réinitialisation complète, initialisation du calendrier de réservation, et la règle d'anonymat des avis. C'est ce qui attrape ce que l'empreinte ne voit pas : une page peut avoir des balises parfaitement équilibrées et n'avoir plus aucun JavaScript.

Quand un changement visuel est **voulu**, valider d'abord à l'œil, puis :

```bash
npm run qa:update
```

La référence est versionnée : sa modification apparaît dans le diff, ce qui force à assumer explicitement tout changement d'apparence.

Deux exclusions volontaires, documentées dans le fichier : les éléments Leaflet, dont le rendu dépend d'un appel réseau, et `admin-indisponibilites.html`, dont le contenu vient d'une API qui n'autorise que l'origine de production.

## Services externes

| Service | Usage | Remarque |
|---|---|---|
| Leaflet 1.9.4 | Carte | Version épinglée |
| Flatpickr 4.6.13 | Sélecteurs de date | Version épinglée |
| Web3Forms | Envoi du formulaire | Clé publique en clair, c'est le fonctionnement prévu |
| API adresse (geo.api.gouv.fr) | Recherche de communes | Service public, sans clé |
| Google Analytics 4 | Mesure d'audience | Voir `DETTE-TECHNIQUE.md` |
| Cloudflare Worker | API de réservation | `miaoucratie-reservation-api.miaoucratie.workers.dev` |

## Règles de contenu

**Jamais le nom de famille d'un client.** Prénom seul, partout : cartes d'avis, données structurées JSON-LD, témoignages.

**Les données structurées doivent refléter le texte affiché.** La FAQ duplique chaque réponse en JSON-LD ; toute correction doit être faite aux deux endroits, sinon Google ignore le résultat enrichi.

**Les règles métier sont répétées sur plusieurs pages** : durée de visite, acompte, délai d'annulation, seuils kilométriques, tarifs. Toute modification doit être répercutée partout.
