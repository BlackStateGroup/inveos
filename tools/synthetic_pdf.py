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
