import argparse
import json
import time
from pathlib import Path

import uno
from com.sun.star.beans import PropertyValue


def prop(name, value):
    property_value = PropertyValue()
    property_value.Name = name
    property_value.Value = value
    return property_value


parser = argparse.ArgumentParser()
parser.add_argument("document")
parser.add_argument("--port", type=int, default=2011)
args = parser.parse_args()
source = Path(args.document).resolve()
context = uno.getComponentContext()
resolver = context.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", context)
remote = None
for attempt in range(60):
    try:
        remote = resolver.resolve(f"uno:socket,host=127.0.0.1,port={args.port};urp;StarOffice.ComponentContext")
        break
    except Exception:
        time.sleep(0.5)
if remote is None:
    raise RuntimeError("LibreOffice listener unavailable")
desktop = remote.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", remote)
document = desktop.loadComponentFromURL(source.as_uri(), "_blank", 0, (prop("Hidden", True), prop("UpdateDocMode", 3)))
if document is None:
    raise RuntimeError("DOCX could not be opened")
document.refresh()
for iteration in range(3):
    indexes = document.getDocumentIndexes()
    for index in range(indexes.getCount()):
        indexes.getByIndex(index).update()
    document.getTextFields().refresh()
    document.refresh()
document.store()
pdf = source.with_suffix(".pdf")
document.storeToURL(pdf.as_uri(), (prop("FilterName", "writer_pdf_Export"), prop("Overwrite", True)))
pages = document.getCurrentController().getPageCount()
document.close(True)
print(json.dumps({"document": str(source), "pdf": str(pdf), "pages": pages, "indexes_updated": indexes.getCount()}))
