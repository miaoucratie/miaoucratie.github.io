# miaoucratie.fr

Site vitrine de Miaoucratie, garde de chats à domicile en Ille-et-Vilaine.

Site statique, sans framework ni étape de compilation, publié par GitHub Pages.

## Publier

GitHub Pages publie **dès le push sur `main`**, sans attendre la vérification.
Pousser directement sur `main` met donc en ligne avant tout contrôle : si la
vérification échoue ensuite, la régression est déjà chez les visiteurs.

Le travail passe donc par une branche et une pull request, où la vérification
s'exécute **avant** la fusion :

```bash
git checkout -b ma-modification
```

```bash
git push -u origin ma-modification
```

Ouvrir la pull request, attendre que « QA / Non-régression » soit au vert, puis
fusionner. C'est la fusion qui publie.

Pour une correction d'urgence assumée, pousser sur `main` reste possible — mais
c'est un choix, pas la marche normale.

## Vérifier

```bash
npm install
npm run qa
```

Trois familles de contrôles :

1. **Comportement** — menu, accordéon, filtres, recherche, carte, calendrier.
2. **Apparence** — l'empreinte de chaque page est comparée à une référence locale.
   Elle détecte un changement, jamais un défaut déjà présent.
3. **Cohérence** — des règles sans référence : deux champs côte à côte s'alignent,
   des cartes empilées dans la même colonne ont la même largeur, la barre et le
   pied de page sont identiques d'une page à l'autre, menus compris.
4. **Parcours** — trois chemins suivis de bout en bout jusqu'au formulaire, en
   cliquant les appels à l'action du contenu.

Les règles de réservation, elles, se testent sans navigateur :

```bash
npm test
```

En intégration continue, l'apparence n'est pas comparée — les métriques de police
diffèrent trop d'un système à l'autre pour qu'une référence soit transportable.
Comportement et cohérence, eux, y tournent.

Après un changement visuel voulu et vérifié à l'œil :

```bash
npm run qa:update
```

### En cas d'échec

Pour voir tous les écarts au lieu du premier seulement :

```bash
npm run qa -- --detail
```

Un échec sur la carte est désormais un vrai échec : l'API adresse est servie
depuis `qa/fixtures/geo-api.json` et ne dépend plus du réseau. Relancer ne le
fera pas disparaître.

Éteindre le serveur de prévisualisation avant de lancer la vérification : deux
serveurs sur le même port donnent des écarts fantômes.

Les options et les pièges connus du harnais sont décrits en tête de `qa/qa.mjs`.

## Ajouter une page

Une page neuve hérite de tout le style commun en chargeant trois feuilles, dans cet
ordre, la dernière en **fin** de `<head>` :

```html
<link rel="stylesheet" href="css/polices.css">
<link rel="stylesheet" href="css/style.css">
<!-- ... styles propres à la page ... -->
<link rel="stylesheet" href="css/couches.css">
```

`polices.css` déclare les deux familles, servies depuis `fonts/` : le site ne
dépend d'aucun fournisseur extérieur pour sa typographie.
`style.css` porte la base : palette, typographie, boutons, mise en page.
`couches.css` porte la barre de navigation, le pied de page et les titres, et doit
rester la dernière chargée — c'est ce qui lui permet d'imposer le commun sans
`!important`.

Deux règles pour ne pas casser le reste :

- **ne jamais redéfinir une variable de la palette** (`--cream`, `--light`,
  `--terracotta`…) pour un usage local : elle déteindrait sur la barre, le pied et
  les titres. Préfixer, comme `--calc-light` ou `--fond-legal` ;
- **ne pas recopier la barre ni le pied** : ils sont définis une seule fois dans
  `couches.css`.

La barre de navigation, le menu et le pied de page sont recopiés dans chaque page.
Reprendre ces trois blocs depuis une page existante, sans les modifier : la
vérification compare la liste des liens d'une page à l'autre et signale toute
divergence, en nommant la page fautive.

Ajouter enfin la page à la liste `PAGES` de `qa/qa.mjs`, puis `npm run qa:update`.
