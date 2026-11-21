/** Small, high-contrast editor glyphs. Unmapped sculpt/tool artwork is preserved. */
const glyphs: Record<number, string> = {
  1  : '<path d="M16 4v24M4 16h24M12 8l4-4 4 4M12 24l4 4 4-4M8 12l-4 4 4 4M24 12l4 4-4 4"/>',
  2  : '<path d="M25 11a10 10 0 1 0 1 8M25 4v8h-8"/>',
  3  : '<circle cx="16" cy="16" r="11"/><path d="M12 12a4 4 0 1 1 5 4c-1 1-1 2-1 3M16 23h.1"/>',
  26 : '<circle cx="16" cy="16" r="7"/><path d="M16 3v8m0 10v8M3 16h8m10 0h8"/>',
  44: '<circle cx="16" cy="16" r="11"/><path d="M16 5c8 5-8 17 0 22"/><path d="M16 5a11 11 0 0 1 0 22Z" fill="#d5d5d5"/>',
  45 : '<path d="M5 10h14v14H5zM19 14l8-5v17l-8-5"/>',
  49 : '<path d="M6 24L25 5M16 5h9v9M6 16v8h8"/><path d="M6 7h6v6H6z"/>',
  53: '<path d="M5 6l22 3-12 18Z"/><circle cx="5" cy="6" r="2"/><circle cx="27" cy="9" r="2"/><circle cx="15" cy="27" r="2"/>',
  77 : '<path d="M5 8h22M5 16h22M5 24h22"/><path d="M11 5v6m10 2v6M13 21v6" stroke-width="4"/>',
  79 : '<path d="M5 8h22v18H5zM5 13h22M10 8v5"/>',
  81 : '<path d="M7 4h18v24H7zM11 10h10M11 16h10M11 22h7"/>',
  89 : '<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="4" fill="#d5d5d5"/>',
  90 : '<path d="M4 7h24M4 16h24M4 25h24M7 4v24M16 4v24M25 4v24"/>',
  91 : '<circle cx="16" cy="16" r="11"/><ellipse cx="16" cy="16" rx="5" ry="11"/><path d="M5 16h22M8 9h16M8 23h16"/>',
  92 : '<circle cx="16" cy="16" r="11" fill="#d5d5d5"/><path d="M21 8a10 10 0 0 1 0 16" stroke="#888"/>',
  104: '<path d="M8 4l17 13-9 1-4 9Z"/>',
  118: '<path d="M8 10l14-5v22L8 22zM8 10v12M8 10l14 17M8 22L22 5"/>',
  119: '<path d="M6 8h20v16H6zM6 8l6 5h14M12 13v11"/>',
  133: '<path d="M16 3l11 6v14l-11 6-11-6V9Z M5 9l11 6 11-6M16 15v14"/>',
  134: '<path d="M4 11V4h7m10 0h7v7M4 21v7h7m10 0h7v-7" stroke-dasharray="3 2"/>',
  141: '<rect x="4" y="8" width="16" height="18" rx="1"/><rect x="12" y="4" width="16" height="18" rx="1"/>',
  142: '<circle cx="8" cy="8" r="2"/><circle cx="24" cy="8" r="2"/><circle cx="8" cy="24" r="2"/><circle cx="24" cy="24" r="2"/>',
  143: '<path d="M5 11l11-7 11 7-11 7ZM5 18l11 7 11-7M5 23l11 7 11-7"/>',
}

export function buildStudioIconSvg(source: string): string {
  const root = source.indexOf('<svg')
  const start = source.indexOf('>', root) + 1
  const end = source.lastIndexOf('</svg>')
  if (root < 0 || start <= 0 || end <= start) throw new Error('Invalid editor icon sheet')
  const holes = Object.keys(glyphs)
    .map(Number)
    .map((id) => `<rect x="${(id % 16) * 32}" y="${Math.floor(id / 16) * 32}" width="32" height="32" fill="black"/>`)
    .join('')
  const icons = Object.entries(glyphs)
    .map(([key, paths]) => {
      const id = Number(key)
      return `<g transform="translate(${(id % 16) * 32} ${Math.floor(id / 16) * 32})" fill="none" stroke="#d5d5d5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`
    })
    .join('')
  return `${source.slice(0, start)}<defs><mask id="studio-chrome-mask"><rect width="512" height="512" fill="white"/>${holes}</mask></defs><g mask="url(#studio-chrome-mask)">${source.slice(start, end)}</g>${icons}</svg>`
}
