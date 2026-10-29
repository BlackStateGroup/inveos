"""First-party geometry bounds before native bitmap allocation; no parser imports."""
import math

def render_size(width, height, rotation, media, crop):
    if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<=0 for v in (width,height)):
        raise ValueError('Invalid page size')
    if rotation != 0 or tuple(media) != (0,0,width,height) or tuple(crop) != tuple(media):
        raise ValueError('Unsupported page transform')
    size=(math.ceil(width),math.ceil(height))
    if max(size)>2048 or size[0]*size[1]>2_000_000:
        raise ValueError('Bitmap allocation bound')
    return size
