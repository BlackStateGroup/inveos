"""One supplied fictional original; executed only inside the qualified container."""
import json
from pathlib import Path
from pdf_render import render

print(json.dumps(render(Path("/original/input.pdf"))))
