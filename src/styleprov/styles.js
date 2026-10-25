// Tre stilgrepp för kartrummet. Rummet och pjäserna är desamma; ljus, färg och efterbehandling skiljer dem åt.
// Saeculas palett: mörkblått #142936, guld #c4aa73, pergament #eee4cc (src/ui/styles.css i saecula).

const HERO = { pos: [17, 12.5, 25], target: [-11, 1.5, -6], fov: 38 };

const LIGHT_ROOM = {
  plaster: '#e2d5ba', ceiling: '#cfc0a2', mullion: '#e9e1cd',
  table: ['#3d2312', '#7d4f2c'], floor: ['#4a2d16', '#8f5f36'], panel: ['#43280f', '#7a5030'],
  trim: 0xb48a4a,
  banner: { field: '#1d3a4c', border: '#c4aa73' },
  rug: { field: '#6b1e19', border: '#1d3346', gold: '#c49a4a' },
};

export const STYLES = {
  A: {
    title: 'A · Eftermiddag i kartrummet',
    note: 'Eftermiddagsljus faller in genom spröjsade fönster över ek och pergament. Närmast originalets värme och lättast att läsa.',
    camera: HERO,
    palette: LIGHT_ROOM,
    sky: { file: 'sky.hdr', intensity: 1.0 },
    env: { walls: 0xc8b490, floor: 0x5a3a20, table: 0x4a2c17, window: 0xfff0d8, windowGain: 5, candleGain: 0, intensity: 0.45 },
    sun: { color: 0xffd2a0, intensity: 3.2, dir: [-1, 0.3, -0.25] },
    hemi: [0xfff3df, 0x4a321c, 0.3],
    candles: null,
    fog: [0xcdb894, 0.0018],
    post: { bloom: 0.7, saturation: 0.1, contrast: 0.12, vignette: 0.5, dof: 2.6, ao: 2.4 },
  },
  B: {
    title: 'B · Kväll vid kandelabrarna',
    note: 'Kandelabrarna lyser upp kartan och pjäserna medan rummet sjunker in i Saeculas mörkblå skymning. Mest dramatisk, men dueller kräver mer ljus.',
    camera: HERO,
    palette: {
      plaster: '#2a5068', ceiling: '#13293a', mullion: '#2a2219',
      table: ['#2e1a0d', '#6b4224'], floor: ['#2a180b', '#5e3b1f'], panel: ['#26160a', '#553620'],
      trim: 0xc4aa73,
      banner: { field: '#142936', border: '#c4aa73' },
      rug: { field: '#4e1512', border: '#142936', gold: '#b8924a' },
    },
    sky: { file: 'dusk.hdr', intensity: 0.22 },
    env: { walls: 0x1f4257, floor: 0x24160b, table: 0x2e1a0d, window: 0x5a76a8, windowGain: 0.6, candleGain: 12, intensity: 0.6 },
    sun: { color: 0x7d97c8, intensity: 0.9, dir: [-1, 0.45, -0.25] }, // månljus genom fönstren
    hemi: [0x3a5a72, 0x1a0f07, 0.22],
    // fill: ett ljus utanför bild framför brädet, så att vits ansikten inte blir silhuetter
    candles: { color: 0xffa64d, intensity: 650, floorGain: 5, fill: { pos: [22, 9, 16], intensity: 1400 } },
    fog: [0x0c1820, 0.003],
    post: { bloom: 1.1, saturation: 0.04, contrast: 0.1, vignette: 0.62, dof: 2.6, ao: 2.6 },
  },
  C: {
    title: 'C · Kartografens kopparstick',
    note: 'Fältherrens blick rakt ner över kartan, i sepia med gravyrkonturer kring pjäserna. Djärvast och längst från originalet.',
    camera: { pos: [-7, 50, 27], target: [-9, 0, -1.5], fov: 40 },
    palette: LIGHT_ROOM,
    sky: { file: 'sky.hdr', intensity: 0.6 },
    env: { walls: 0xbfae8c, floor: 0x5a3a20, table: 0x4a2c17, window: 0xfff0d8, windowGain: 2, candleGain: 0, intensity: 0.35 },
    sun: { color: 0xffe6c4, intensity: 1.4, dir: [-1, 0.3, -0.25] },
    overhead: { color: 0xfff1dc, intensity: 3.2, pos: [-16, 72, -12], angle: 24, penumbra: 0.85 },
    hemi: [0xfff3df, 0x4a321c, 0.18],
    candles: null,
    fog: [0x2a2016, 0.004],
    post: { bloom: 0.15, saturation: -0.45, contrast: 0.28, vignette: 0.9, vignetteOffset: 0.18, dof: 0, ao: 3, sepia: 0.7, noise: 0.2, outline: true },
  },
};
