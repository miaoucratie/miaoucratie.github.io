from pathlib import Path
import re

# URL de ton site (à adapter si besoin)
SITE_URL = "https://miaoucratie.github.io/"

HTML_FILE = Path("index.html")
SITEMAP_FILE = Path("sitemap.xml")

# 1) Créer le sitemap.xml
sitemap_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>{SITE_URL}</loc>
  </url>
</urlset>
"""

SITEMAP_FILE.write_text(sitemap_content, encoding="utf-8")
print(f"✔ sitemap.xml créé")

# 2) Ajouter le lien dans le HTML
html = HTML_FILE.read_text(encoding="utf-8")

link_tag = '<link rel="sitemap" type="application/xml" href="sitemap.xml">'

# Vérifie si déjà présent
if link_tag not in html:
    html = re.sub(
        r"</head>",
        f"  {link_tag}\n</head>",
        html,
        flags=re.IGNORECASE
    )
    HTML_FILE.write_text(html, encoding="utf-8")
    print("✔ Lien sitemap ajouté dans index.html")
else:
    print("✔ Sitemap déjà présent dans HTML")

print("\n✅ Terminé !")