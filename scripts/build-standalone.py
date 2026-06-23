from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
INDEX = PROJECT_ROOT / "index.html"
STYLES = PROJECT_ROOT / "src" / "styles.css"
DATA = PROJECT_ROOT / "data" / "embedded-data.js"
STORAGE = PROJECT_ROOT / "src" / "storage.js"
APP = PROJECT_ROOT / "src" / "app.js"
OUTPUT = PROJECT_ROOT / "工单五模块管理看板_6月22日刷新版.html"


def main() -> None:
    html = INDEX.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")
    data = DATA.read_text(encoding="utf-8")
    storage = STORAGE.read_text(encoding="utf-8")
    app = APP.read_text(encoding="utf-8")

    html = html.replace(
        '  <link rel="stylesheet" href="./src/styles.css" />',
        f"  <style>\n{styles}\n  </style>",
    )
    html = html.replace(
        '  <script src="./data/embedded-data.js"></script>\n  <script src="./src/storage.js"></script>\n  <script src="./src/app.js" defer></script>',
        f"  <script>\n{data}\n  </script>\n  <script>\n{storage}\n  </script>\n  <script>\n{app}\n  </script>",
    )
    OUTPUT.write_text(html, encoding="utf-8")
    print(OUTPUT)


if __name__ == "__main__":
    main()
