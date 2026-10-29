"""Fictional acceptance runner executed only inside the qualified container."""
import json
from pathlib import Path
from pdf_render import render

reports={}
for name in ['digital','mixed','blank','raster']:
    reports[name]=render(Path('/original')/(name+'.pdf'))
# Known fictional ground truth: raster occupies PDF x72..172/y600..700.
r=reports['raster']['pages'][0]
assert r['nonWhiteBounds']==(72,92,172,192),r
assert reports['blank']['pages'][0]['nonWhiteBounds'] is None
assert reports['digital']['pages'][0]['pngSha256']==reports['digital']['pages'][1]['pngSha256']
assert reports['mixed']['pages'][1]['pngSha256']==r['pngSha256']
b=reports['digital']['pages'][0]['nonWhiteBounds']
assert b and 70<=b[0]<b[2]<=285 and 80<=b[1]<b[3]<=96,b
rejected=[]
for name in ['malformed','oversize','overpages']:
    try:render(Path('/original')/(name+'.pdf'))
    except Exception:rejected.append(name)
    else:raise ValueError('Invalid input accepted: '+name)
print(json.dumps({'status':'synthetic_render_passed','cases':reports,'rejected':rejected,
                  'profile':{'scale':1,'rotation':0,'crop':[0,0,0,0],'grayscale':True,'forms':False,'annotations':False},
                  'approval':'research_only_unreviewed_raster_derivative'}))
