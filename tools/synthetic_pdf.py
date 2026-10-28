"""First-party deterministic fictional digital PDF; no external fixture/font files."""
def digital_pdf():
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>',
             b'<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>']
    text=b'FICTIONAL INVEOS repeated passage'
    for page,content in [(3,4),(5,6)]:
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents {content} 0 R >>'.encode())
        stream=b'BT /F1 12 Tf 72 700 Td ('+text+b') Tj ET\n'
        objects.append(b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'endstream')
    objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    data=bytearray(b'%PDF-1.4\n'); offsets=[0]
    for number,body in enumerate(objects,1):
        offsets.append(len(data));data.extend(f'{number} 0 obj\n'.encode()+body+b'\nendobj\n')
    xref=len(data);data.extend(b'xref\n0 8\n0000000000 65535 f \n')
    for offset in offsets[1:]:data.extend(f'{offset:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return bytes(data)


def coverage_pdf(kinds):
    """Small first-party pages: digital text, blank, or a raster checkerboard.

    Raster is deliberately not a scanned-language/OCR accuracy fixture.
    """
    if not kinds or len(kinds)>3 or any(k not in ('text','blank','raster') for k in kinds):
        raise ValueError('Unsupported fictional page recipe')
    font=3+2*len(kinds); image=font+1
    kids=' '.join(f'{3+2*i} 0 R' for i in range(len(kinds)))
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>',
             f'<< /Type /Pages /Kids [{kids}] /Count {len(kinds)} >>'.encode()]
    for i,kind in enumerate(kinds):
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font} 0 R >> /XObject << /Im1 {image} 0 R >> >> /Contents {4+2*i} 0 R >>'.encode())
        stream={'text':b'BT /F1 12 Tf 72 700 Td (FICTIONAL INVEOS repeated passage) Tj ET\n',
                'blank':b'', 'raster':b'q 100 0 0 100 72 600 cm /Im1 Do Q\n'}[kind]
        objects.append(b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'endstream')
    objects.extend([b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
                    b'<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 4 >>\nstream\n\x00\xff\xff\x00\nendstream'])
    data=bytearray(b'%PDF-1.4\n'); offsets=[]
    for n,body in enumerate(objects,1):
        offsets.append(len(data));data.extend(f'{n} 0 obj\n'.encode()+body+b'\nendobj\n')
    xref=len(data);data.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for offset in offsets:data.extend(f'{offset:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return bytes(data)
