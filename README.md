# miaoucratie.fr

Le site de Miaoucratie, mon activité de garde de chats à domicile en Ille-et-Vilaine.

Dix pages, aucun framework, aucune étape de compilation, zéro dépendance en
production. Du HTML, du CSS et un peu de JavaScript, servis par GitHub Pages.

## Ce que j'ai mis autour

Un harnais de vérification maison, parce qu'un site qui prend des réservations
n'a pas droit à la régression silencieuse. À chaque pull request, il rejoue
18 vues sur deux largeurs et contrôle quatre choses : que les pages se
comportent comme prévu, que leur apparence n'a pas bougé, que la barre et le
pied restent identiques d'une page à l'autre, et que les parcours mènent bien
jusqu'au formulaire. 111 tests couvrent en plus les règles de réservation,
sans navigateur.

`main` est protégée. Rien ne part en ligne sans que ce contrôle soit vert.

Le reste tient à des choix assumés. Les polices sont servies depuis le dépôt et
non par Google. La mesure d'audience ne démarre qu'après un accord explicite du
visiteur, et refuser demande le même geste qu'accepter. Les deux bibliothèques
externes sont épinglées et vérifiées par empreinte. Les textes respectent les
seuils de contraste AA. La réservation passe par un Worker Cloudflare.
