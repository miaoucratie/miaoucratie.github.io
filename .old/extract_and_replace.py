import base64
import re
import unicodedata
from pathlib import Path
from bs4 import BeautifulSoup

INPUT_FILE = Path("index.html")
OUTPUT_FILE = Path("index_clean.html")
IMAGES_DIR = Path("images")
IMAGES_DIR.mkdir(exist_ok=True)

html = INPUT_FILE.read_text(encoding="utf-8")
soup = BeautifulSoup(html, "html.parser")

used_names = set()


def slugify(text: str) -> str:
    text = text or ""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "image"


def guess_name(img_tag, index: int, ext: str) -> str:
    classes = img_tag.get("class", [])
    class_str = " ".join(classes).lower()
    img_id = (img_tag.get("id") or "").lower()
    alt = (img_tag.get("alt") or "").strip()

    # Cas explicites
    if "logo" in class_str or "logo" in img_id or "logo" in alt.lower():
        if "footer" in class_str or "footer" in img_id:
            base = "logo-footer"
        elif "hero" in class_str or "hero" in img_id:
            base = "logo-hero"
        else:
            base = "logo"
        return f"{base}.{ext}"

    if "cred" in class_str or "cred" in img_id or "portrait" in alt.lower():
        return f"photo-credibilite.{ext}"

    if "hero" in class_str or "hero" in img_id:
        return f"hero.{ext}"

    if alt:
        base = slugify(alt)
        return f"{base}.{ext}"

    if img_id:
        return f"{slugify(img_id)}.{ext}"

    if classes:
        base = slugify(classes[0])
        return f"{base}-{index}.{ext}"

    return f"image-{index}.{ext}"


def unique_name(filename: str) -> str:
    stem = Path(filename).stem
    suffix = Path(filename).suffix
    candidate = filename
    n = 2
    while candidate in used_names or (IMAGES_DIR / candidate).exists():
        candidate = f"{stem}-{n}{suffix}"
        n += 1
    used_names.add(candidate)
    return candidate


counter = 1
for img in soup.find_all("img"):
    src = img.get("src", "")
    if not src.startswith("data:image/"):
        continue

    match = re.match(r"data:(image/[^;]+);base64,(.*)", src, re.DOTALL)
    if not match:
        continue

    mime = match.group(1)
    b64 = re.sub(r"\s+", "", match.group(2))
    ext = mime.split("/")[-1]
    if ext == "jpeg":
        ext = "jpg"

    guessed = guess_name(img, counter, ext)
    filename = unique_name(guessed)
    filepath = IMAGES_DIR / filename

    filepath.write_bytes(base64.b64decode(b64))
    img["src"] = f"images/{filename}"

    print(f"Image extraite : {filepath}")
    counter += 1

OUTPUT_FILE.write_text(str(soup), encoding="utf-8")
print(f"\nTerminé : {OUTPUT_FILE}")