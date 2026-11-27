#!/bin/sh
# docx.sh unpack <file.docx> <dir>   |   docx.sh pack <dir> <out.docx>
set -e
case "$1" in
  unpack) rm -rf "$3" && mkdir -p "$3" && python3 -c "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$2" "$3" ;;
  pack) rm -f "$3" && (cd "$2" && zip -XrDq "$(cd "$(dirname "$3")" && pwd)/$(basename "$3")" '[Content_Types].xml' . -x '[Content_Types].xml') && zip -d "$3" '*/' >/dev/null 2>&1 || true
        python3 -c "import sys,zipfile,xml.dom.minidom as m; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; m.parseString(z.read('word/document.xml')); print('ok', sys.argv[1])" "$3" ;;
  *) echo "usage: docx.sh unpack|pack"; exit 1 ;;
esac
