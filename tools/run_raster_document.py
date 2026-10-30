"""One supplied fictional original; executed only inside the qualified container."""
import argparse
import json
from pathlib import Path
from pdf_render import render

parser=argparse.ArgumentParser();parser.add_argument('--profile-version',type=int,choices=(1,2),default=1)
args=parser.parse_args()
print(json.dumps(render(Path('/original/input.pdf'),args.profile_version)))
