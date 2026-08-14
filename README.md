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

`npm run qa:update` régénère la référence après un changement visuel voulu.

En local, la vérification compare aussi l'apparence à une référence. En intégration
continue, seul le comportement est vérifié : les métriques de police diffèrent trop
d'un système à l'autre pour qu'une référence soit transportable.
