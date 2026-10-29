"""First-party fictional supplier PDF and raster-only PDF construction.

No font, image or third-party fixture is included. Rasterisation is performed
only by the qualified isolated research runner, never by this generator.
"""
import zlib

PAGES=[
    ['FICTIONAL SYN-SUPPLIER-001', 'NORTHSTAR DEMO SUPPLIER',
     'OWNERSHIP DECLARATION 2026-10-25', 'ATLAS DEMO HOLDINGS 100 PERCENT'],
    ['FICTIONAL SYN-SUPPLIER-001', 'NORTHSTAR DEMO SUPPLIER',
     'REGISTER EXTRACT 2026-09-01', 'ATLAS DEMO HOLDINGS 60 PERCENT',
     'BIRCH DEMO HOLDINGS 40 PERCENT'],
]


def package(objects):
    data=bytearray(b'%PDF-1.4\n');offsets=[]
    for number,body in enumerate(objects,1):
        offsets.append(len(data));data.extend(f'{number} 0 obj\n'.encode()+body+b'\nendobj\n')
    xref=len(data);data.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for offset in offsets:data.extend(f'{offset:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode());return bytes(data)


def digital_supplier_pdf(page_index=None):
    if page_index is not None and (type(page_index) is not int or page_index not in (0,1)):
        raise ValueError('Unknown fictional supplier record')
    pages=PAGES if page_index is None else [PAGES[page_index]]
    kids=' '.join(f'{3+i*2} 0 R' for i in range(len(pages)))
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>',f'<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>'.encode()]
    for index,lines in enumerate(pages):
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {3+2*len(pages)} 0 R >> >> /Contents {4+index*2} 0 R >>'.encode())
        stream=b'BT /F1 14 Tf 48 720 Td 28 TL\n'+b'\n'.join(b'('+line.encode('ascii')+b') Tj T*' for line in lines)+b'\nET\n'
        objects.append(f'<< /Length {len(stream)} >>\nstream\n'.encode()+stream+b'endstream')
    objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');return package(objects)


def scanned_supplier_pdf(images):
    """Embed one or two explicit RGB page rasters; no text/font layer is added."""
    if len(images) not in (1,2):raise ValueError('One or two fictional supplier pages required')
    kids=' '.join(f'{3+i*3} 0 R' for i in range(len(images)))
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>',f'<< /Type /Pages /Kids [{kids}] /Count {len(images)} >>'.encode()]
    for index,(width,height,rgb) in enumerate(images):
        if type(width) is not int or type(height) is not int or not 1<=width<=2048 or not 1<=height<=2048 or len(rgb)!=width*height*3:raise ValueError('Invalid bounded page raster')
        image_number=5+index*3;stream=b'q 612 0 0 792 0 0 cm /Scan Do Q\n';image=zlib.compress(rgb,9)
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Scan {image_number} 0 R >> >> /Contents {4+index*3} 0 R >>'.encode())
        objects.append(f'<< /Length {len(stream)} >>\nstream\n'.encode()+stream+b'endstream')
        objects.append(f'<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length {len(image)} >>\nstream\n'.encode()+image+b'\nendstream')
    return package(objects)
