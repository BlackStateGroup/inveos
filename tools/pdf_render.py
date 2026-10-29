"""Executed only inside the qualified research container, never the API."""
import base64,hashlib,io,json
from contextlib import closing
from pathlib import Path
import pypdfium2 as pdfium
from PIL import ImageChops
from pdf_render_limits import render_size

def render(path):
    original=path.read_bytes()
    if not 1<=len(original)<=65536:raise ValueError('Original byte bound')
    before=hashlib.sha256(original).hexdigest()
    rows=[]
    with pdfium.PdfDocument(original) as document:
        if not 1<=len(document)<=2:raise ValueError('Page count bound')
        for index in range(len(document)):
            with closing(document[index]) as page:
                width,height=page.get_size()
                size=render_size(width,height,page.get_rotation(),page.get_mediabox(),page.get_cropbox())
                with closing(page.render(scale=1,rotation=0,crop=(0,0,0,0),may_draw_forms=False,draw_annots=False,grayscale=True)) as bitmap:
                    image=bitmap.to_pil().convert('L')
                    try:
                        if image.size!=size:raise ValueError('Unexpected bitmap dimensions')
                        diff=ImageChops.invert(image);bounds=diff.getbbox();diff.close()
                        stream=io.BytesIO();image.save(stream,format='PNG');png=stream.getvalue()
                        if len(png)>262144:raise ValueError('PNG output bound')
                        rows.append({'page':index+1,'width':size[0],'height':size[1],'nonWhiteBounds':bounds,
                                     'pngSha256':hashlib.sha256(png).hexdigest(),'pngBytes':len(png),
                                     'pngBase64':base64.b64encode(png).decode()})
                    finally:image.close()
    if hashlib.sha256(path.read_bytes()).hexdigest()!=before:raise ValueError('Original changed')
    return {'originalSha256':before,'pages':rows}
