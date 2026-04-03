from pathlib import Path
import re
import sys

INPUT_HTML = Path("index_clean.html")   # change ici si besoin
OUTPUT_HTML = Path("index_no_inline_css.html")
CSS_DIR = Path("css")
CSS_FILE = CSS_DIR / "style.css"

html = INPUT_HTML.read_text(encoding="utf-8")

# Récupère tous les blocs <style>...</style>
style_blocks = re.findall(
    r"<style\b[^>]*>(.*?)</style>",
    html,
    flags=re.IGNORECASE | re.DOTALL
)

if not style_blocks:
    sys.exit("Aucun bloc <style> trouvé dans le fichier HTML.")

# Concatène tous les CSS trouvés dans un seul fichier
css_content = "\n\n".join(block.strip() for block in style_blocks if block.strip()) + "\n"

CSS_DIR.mkdir(exist_ok=True)
CSS_FILE.write_text(css_content, encoding="utf-8")

# Supprime tous les blocs <style>...</style> du HTML
html_without_css = re.sub(
    r"\s*<style\b[^>]*>.*?</style>\s*",
    "\n",
    html,
    flags=re.IGNORECASE | re.DOTALL
)

# Ajoute le lien CSS dans <head> si absent
link_tag = '<link rel="stylesheet" href="css/style.css">'
if link_tag.lower() not in html_without_css.lower():
    html_without_css = re.sub(
        r"</head>",
        f"  {link_tag}\n</head>",
        html_without_css,
        flags=re.IGNORECASE,
        count=1
    )

OUTPUT_HTML.write_text(html_without_css, encoding="utf-8")

print(f"CSS extrait vers : {CSS_FILE}")
print(f"HTML nettoyé vers : {OUTPUT_HTML}")