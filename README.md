# miaoucratie.fr

Site vitrine de Miaoucratie, garde de chats à domicile en Ille-et-Vilaine.

Site statique, sans framework ni étape de compilation, publié par GitHub Pages.

## Publier

```bash
git push origin main
```

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
   pied de page sont identiques d'une page à l'autre.

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

Deux messages ne signalent **pas** une régression, seulement une dépendance réseau
qui a lâché — il suffit de relancer :

- « police non chargée » : la page aurait été mesurée avec la police de secours ;
- un échec en bloc sur la carte, qui interroge l'API adresse pour de vrai.

Éteindre le serveur de prévisualisation avant de lancer la vérification : deux
serveurs sur le même port donnent des écarts fantômes.

Les options et les pièges connus du harnais sont décrits en tête de `qa/qa.mjs`.

## Ajouter une page

Une page neuve hérite de tout le style commun en chargeant deux feuilles, dans cet
ordre, la seconde en **dernier** dans le `<head>` :

```html
<link rel="stylesheet" href="css/style.css">
<!-- ... styles propres à la page ... -->
<link rel="stylesheet" href="css/couches.css">
```

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

Ajouter enfin la page à la liste `PAGES` de `qa/qa.mjs`, puis `npm run qa:update`.
