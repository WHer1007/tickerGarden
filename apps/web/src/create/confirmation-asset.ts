export function createConfirmationAsset(symbol: string, iconUrl?: string, compact = false): HTMLElement {
  const asset = document.createElement('span');
  asset.className = compact ? 'launch-confirm-asset launch-confirm-asset--compact' : 'launch-confirm-asset';
  if (iconUrl) {
    const icon = document.createElement('img');
    icon.src = iconUrl;
    icon.alt = '';
    icon.width = 20;
    icon.height = 20;
    icon.onerror = () => { icon.hidden = true; };
    asset.append(icon);
  }
  asset.append(document.createTextNode(symbol));
  return asset;
}
