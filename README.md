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

En local, la vérification compare l'apparence de chaque page à une référence **et**
teste le comportement : menu, accordéon, filtres, recherche, carte, calendrier.
En intégration continue, seul le comportement est vérifié — les métriques de police
diffèrent trop d'un système à l'autre pour qu'une référence soit transportable.

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
