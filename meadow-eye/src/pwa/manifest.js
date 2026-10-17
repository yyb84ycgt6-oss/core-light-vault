// Web app manifest and icon as data URIs: the shell needs no other file.
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#080a12"/><circle cx="32" cy="32" r="20" fill="none" stroke="#00ff88" stroke-width="2" stroke-dasharray="3 2"/><text x="32" y="39" font-family="monospace" font-size="18" text-anchor="middle" fill="#a8ff8a">}0{</text></svg>`;
export const iconDataUri = () => `data:image/svg+xml,${encodeURIComponent(ICON_SVG)}`;

export function manifestDataUri(startUrl = '.') {
  const m = {
    name: 'MEADOW EYE OS',
    short_name: 'Meadow',
    description: 'Capability as instinct, not software as product.',
    start_url: startUrl,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#080a12',
    theme_color: '#080a12',
    icons: [{ src: iconDataUri(), sizes: 'any', type: 'image/svg+xml' }],
  };
  return `data:application/manifest+json,${encodeURIComponent(JSON.stringify(m))}`;
}
