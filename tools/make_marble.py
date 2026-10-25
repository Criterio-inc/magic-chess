"""Sömlösa marmortexturer (vit Carrara, svart Nero Marquina) ur periodiskt brus.

All brus byggs i frekvensrymden (FFT) och är därför periodiskt per konstruktion:
texturen kaklar utan skarvar, vilket triplanar-shadern i spelet kräver.
Ut: public/tex/marble_{white,black}_{albedo,rough,normal}.jpg
"""
import numpy as np
from PIL import Image
from pathlib import Path

N = 2048
OUT = Path(__file__).resolve().parent.parent / "public" / "tex"
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(7)

fy = np.fft.fftfreq(N)[:, None] * N
fx = np.fft.fftfreq(N)[None, :] * N
FR = np.sqrt(fx * fx + fy * fy)
FR[0, 0] = 1.0


def fbm(beta=2.0, lo=1.0, hi=N / 2, seed=None):
    """Periodiskt 1/f^beta-brus, normerat till medel 0, std 1."""
    r = np.random.default_rng(seed) if seed is not None else rng
    spec = (r.normal(size=(N, N)) + 1j * r.normal(size=(N, N))) / FR ** (beta / 2)
    spec[(FR < lo) | (FR > hi)] = 0
    f = np.real(np.fft.ifft2(spec))
    return (f - f.mean()) / f.std()


y, x = np.mgrid[0:N, 0:N] / N


def veins(nx, ny, warp, sharp, seed):
    """Tunna ådror: nollgenomgångar av en vriden sinus. nx, ny heltal => periodiskt."""
    w = fbm(4.0, 1, 40, seed) * warp + fbm(3.0, 4, 200, seed + 1) * 0.6
    s = np.sin(2 * np.pi * (nx * x + ny * y) + w)
    return np.exp(-np.abs(s) * sharp)


def smooth01(a):
    a = (a - a.min()) / (a.max() - a.min())
    return a


def save_rgb(arr, name):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(OUT / name, quality=92)


def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-gx, gy, np.ones_like(h)], -1)  # OpenGL-konvention (grön upp)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def make(name, base, cloud_col, vein_col, layers, rough_base, rough_vein):
    cloud = smooth01(fbm(3.2, 1, 200, 11))
    mottling = fbm(2.5, 20, 600, 12) * 0.5 + 0.5
    col = base[None, None, :] * (1 - 0.35 * cloud[..., None]) + cloud_col[None, None, :] * 0.35 * cloud[..., None]
    col *= (0.985 + 0.03 * mottling)[..., None]
    vein_total = np.zeros((N, N))
    for (nx, ny, warp, sharp, strength, seed) in layers:
        v = veins(nx, ny, warp, sharp, seed)
        # Ådrorna bleknar och tätnar i sjok, som i riktig sten
        mask = smooth01(fbm(3.5, 1, 30, seed + 50)) ** 1.5
        v = v * (0.25 + 0.75 * mask) * strength
        vein_total = np.maximum(vein_total, v)
    vt = np.clip(vein_total, 0, 1)[..., None]
    col = col * (1 - vt) + vein_col[None, None, :] * vt
    save_rgb(col, f"marble_{name}_albedo.jpg")

    micro = fbm(1.0, 200, N / 2, 13)
    rough = rough_base + (rough_vein - rough_base) * vt[..., 0] + micro * 0.015 + cloud * 0.03
    Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8)).save(OUT / f"marble_{name}_rough.jpg", quality=92)

    height = -vt[..., 0] * 0.5 + micro * 0.006 + fbm(3.0, 2, 200, 14) * 0.05
    save_rgb(normal_from_height(height, 6.0), f"marble_{name}_normal.jpg")
    # R = höjd (för bump i triplanarshadern), G = grovhet
    hn = (height - height.min()) / (height.max() - height.min())
    data = np.stack([hn, np.clip(rough, 0, 1), np.zeros_like(hn)], -1)
    Image.fromarray((data * 255 + 0.5).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(OUT / f"marble_{name}_data.jpg", quality=92)
    print("ok", name)


# Vit Carrara: varmvit botten, mjuka grå moln, gråblå ådror i två skalor
make(
    "white",
    base=np.array([0.88, 0.865, 0.835]),
    cloud_col=np.array([0.70, 0.71, 0.72]),
    vein_col=np.array([0.36, 0.38, 0.42]),
    layers=[(1, 1, 3.5, 5.0, 0.55, 21), (2, -1, 4.5, 16.0, 0.6, 31), (3, 2, 5.0, 38.0, 0.4, 41)],
    rough_base=0.16,
    rough_vein=0.26,
)

# Svart Nero Marquina: djup svart med grafitmoln, skarpa vita ådror och ett nät av fina grå sprickor
make(
    "black",
    base=np.array([0.04, 0.039, 0.044]),
    cloud_col=np.array([0.12, 0.118, 0.125]),
    vein_col=np.array([0.86, 0.84, 0.8]),
    layers=[(1, 1, 3.0, 14.0, 1.0, 51), (2, -1, 4.0, 26.0, 0.85, 61), (1, 3, 5.0, 40.0, 0.7, 71), (3, 2, 6.0, 70.0, 0.55, 81)],
    rough_base=0.12,
    rough_vein=0.24,
)
