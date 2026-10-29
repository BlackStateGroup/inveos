import unittest
from tools.pdf_render_limits import render_size

class RenderLimitsTests(unittest.TestCase):
    def test_valid_and_fractional_dimensions(self):
        self.assertEqual(render_size(612,792,0,(0,0,612,792),(0,0,612,792)),(612,792))
        self.assertEqual(render_size(100.2,200.1,0,(0,0,100.2,200.1),(0,0,100.2,200.1)),(101,201))
    def test_rejects_unbounded_and_invalid_dimensions(self):
        for w,h in [(0,1),(-1,1),(float('nan'),1),(1,float('inf')),(True,1),(2049,1),(2000,2000)]:
            with self.assertRaises(ValueError):render_size(w,h,0,(0,0,w,h),(0,0,w,h))
    def test_rejects_unmapped_rotation_and_crop(self):
        for rotation,media,crop in [(90,(0,0,612,792),(0,0,612,792)),(0,(1,0,613,792),(1,0,613,792)),(0,(0,0,612,792),(0,0,600,700))]:
            with self.assertRaises(ValueError):render_size(612,792,rotation,media,crop)
