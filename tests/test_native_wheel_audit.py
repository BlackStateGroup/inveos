import struct
import unittest
import tempfile
from pathlib import Path
import zipfile
from tools.audit_runtime_wheels import audit_directory
from tools.audit_native_wheels import audit_native
from tools.audit_native_wheels import elf_dependencies


def fixture():
    data = bytearray(512)
    data[:7] = b'\x7fELF\x02\x01\x01'
    struct.pack_into('<HHI', data, 16, 3, 62, 1)
    struct.pack_into('<Q', data, 32, 64)
    struct.pack_into('<HHH', data, 52, 64, 56, 2)
    struct.pack_into('<IIQQQQQQ', data, 64, 1, 4, 0, 0x1000, 0, 512, 512, 4096)
    struct.pack_into('<IIQQQQQQ', data, 120, 2, 4, 192, 0x10c0, 0, 112, 112, 8)
    strings = b'\0libfiction.so\0fixture.so\0$ORIGIN/private\0'
    data[320:320+len(strings)] = strings
    for i, pair in enumerate([(5, 0x1140), (10,len(strings)), (1,1), (14,15), (29,26), (0,0)]):
        struct.pack_into('<qQ',data,192+i*16,*pair)
    return data


class NativeAuditTests(unittest.TestCase):
    def test_declared_dependencies_and_search_path(self):
        result = elf_dependencies(fixture())
        self.assertEqual(result['needed'], ['libfiction.so'])
        self.assertEqual(result['soname'], 'fixture.so')
        self.assertEqual(result['runpath'], '$ORIGIN/private')

    def test_truncated_unsupported_and_segment_bounds(self):
        for change in [lambda b: b[:50], lambda b: b[:180],
                       lambda b: b[:4]+b'\x01'+b[5:],
                       lambda b: b[:18]+b'\xb7\0'+b[20:]]:
            with self.assertRaises(ValueError):
                elf_dependencies(change(fixture()))
        data = fixture()
        struct.pack_into('<Q', data, 96, 9999)
        with self.assertRaises(ValueError):
            elf_dependencies(data)

    def test_unmapped_strings_offsets_and_termination(self):
        for offset, value in [(200,0x9999), (216,999999999), (232,9999), (264,9999)]:
            data=fixture(); struct.pack_into('<Q',data,offset,value)
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                elf_dependencies(data)
        data=fixture(); data[320:]=b'x'*192
        with self.assertRaises(ValueError):
            elf_dependencies(data)

    def test_missing_terminator_and_duplicate_singleton(self):
        data=fixture()
        for pos in range(192,304,16):
            struct.pack_into('<qQ',data,pos,5,0x1140)
        with self.assertRaises(ValueError):
            elf_dependencies(data)
        data=fixture(); struct.pack_into('<qQ',data,256,5,0x1140)
        with self.assertRaises(ValueError):
            elf_dependencies(data)

    def test_wheel_scan_is_hash_bound_and_does_not_extract(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wheel = root / 'fictional.whl'
            with zipfile.ZipFile(wheel, 'w') as archive:
                archive.writestr('fictional-1.dist-info/METADATA', 'Name: fictional\nVersion: 1\n')
                archive.writestr('fictional/core.so', fixture())
            expected = {'artifacts': audit_directory(root)}
            result = audit_native(root, expected)
            self.assertEqual(len(result['binaries']), 1)
            self.assertEqual(result['unmatchedNeededNames'], ['libfiction.so'])
            self.assertEqual(list(root.iterdir()), [wheel])
            expected['artifacts'][0]['sha256'] = '0'*64
            with self.assertRaises(ValueError):
                audit_native(root, expected)

    def test_unexpected_artifacts_fail_inventory_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with zipfile.ZipFile(root/'fictional.whl','w') as archive:
                archive.writestr('fictional-1.dist-info/METADATA','Name: fictional\nVersion: 1\n')
            with self.assertRaises(ValueError):
                audit_native(root, {'artifacts': []})
