/* Règles de mise en page */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { RELEVE, verifierBalisage } from './mise-en-page-regles.mjs';

let navigateur;
before(async () => { navigateur = await chromium.launch(); });
after(async () => { await navigateur.close(); });

/* Genres relevés sur une page d'essai */
async function genres(corps, largeur = 1280) {
  const page = await navigateur.newPage({ viewport: { width: largeur, height: 900 } });
  await page.setContent(`<!doctype html><html><head><style>body{margin:0;font:16px sans-serif;color:#1e1812;background:#fff}</style></head><body><h1>Titre</h1>${corps}</body></html>`);
  const echecs = await page.evaluate(RELEVE);
  await page.close();
  return echecs;
}
const a = async (corps, genre, largeur) => (await genres(corps, largeur)).some((e) => e.genre === genre);

/* Pages d'essai */
const CAS = [
  ['debordement', '<div style="width:2000px">x</div>', '<div>x</div>', 375],
  ['orpheline', '<p style="width:45px;font:16px monospace">aaaa bbbb c</p>', '<p style="width:600px">aaaa bbbb c</p>'],
  ['bouton casse', '<a class="btn-primary" href="/x" style="display:inline-block;width:40px">Réserver une garde</a>', '<a class="btn-primary" href="/x" style="display:inline-block;white-space:nowrap">Réserver une garde</a>'],
  ['contraste', '<p style="color:#ccc">texte pâle</p>', '<p style="color:#1e1812">texte lisible</p>'],
  ['italique gras', '<p><em style="font-weight:700">x</em></p>', '<p><em style="font-weight:400">x</em></p>'],
  ['lien bleu', '<p>Voir <a href="/x" style="color:#0000ff">ce lien</a> ici.</p>', '<p>Voir <a href="/x" style="color:#a8472a">ce lien</a> ici.</p>'],
  ['titres', '<h3>Saut</h3>', '<h2>Suite</h2>'],
  ['ancre morte', '<a href="#nulle">x</a>', '<a href="#cible">x</a><p id="cible">y</p>'],
  ['lien sans nom', '<a href="/x"></a>', '<a href="/x">nom</a>'],
  ['etiquette dans le nom', '<a href="/x" aria-label="Autre chose">Réserver</a>', '<a href="/x" aria-label="Réserver une garde">Réserver</a>'],
  ['image sans alt', '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">', '<img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'],
  ['cible trop petite', '<main><button style="width:10px;height:10px;padding:0;border:0">x</button></main>', '<main><button style="width:44px;height:44px">x</button></main>'],
  ['texte recouvert', '<p>texte caché</p><div style="position:absolute;top:0;left:0;width:600px;height:300px;background:#fff"></div>', '<p>texte visible</p>'],
  ['texte coupé', '<div style="overflow:hidden;width:50px"><span style="white-space:nowrap">texte qui dépasse</span></div>', '<div style="overflow:hidden;width:500px"><span style="white-space:nowrap">texte qui tient</span></div>'],
  ['défilement figé', '<div><div style="overflow-x:auto;scrollbar-width:none;width:100px;white-space:nowrap">texte qui déborde largement</div></div>', '<div><div style="overflow-x:auto;scrollbar-width:none;width:100px;white-space:nowrap">texte qui déborde largement</div><button>›</button></div>'],
  ['cadres non alignés', '<section><div style="border:1px solid #000;height:40px"></div><div style="border:1px solid #000;height:40px;margin-left:10px"></div></section>', '<section><div style="border:1px solid #000;height:40px"></div><div style="border:1px solid #000;height:40px"></div></section>'],
  ['fin de page', '<div style="height:2000px"></div><footer>pied</footer><div style="height:200px"></div>', '<div style="height:2000px"></div><footer>pied</footer>'],
];

for (const [genre, fautive, saine, largeur] of CAS) {
  test(`règle « ${genre} » : arrête la page fautive, accepte la page saine`, async () => {
    assert.equal(await a(fautive, genre, largeur), true, 'page fautive non arrêtée');
    assert.equal(await a(saine, genre, largeur), false, 'page saine arrêtée');
  });
}

test('règle « fin de page » : un élément fixe sur le pied de page est arrêté', async () => {
  const fautive = '<div style="height:2000px"></div><footer style="height:80px">pied</footer><div style="position:fixed;bottom:0;right:0;width:200px;height:60px;background:#eee"></div>';
  assert.equal(await a(fautive, 'fin de page'), true);
});

test('balisage : arrête une balise jamais fermée, accepte une page complète', () => {
  const complete = '<!doctype html><html><body><header><nav></nav></header><main><h1>T</h1></main><footer></footer></body></html>';
  assert.deepEqual(verifierBalisage(complete), []);
  assert.ok(verifierBalisage(complete.replace('<main>', '<main><div>')).some((x) => x.includes('jamais fermee') || x.includes('ferme trop tot')));
});
