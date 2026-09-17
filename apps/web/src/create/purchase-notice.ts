export function createPurchaseNotice(): HTMLElement {
  const notice = document.createElement('aside');
  notice.className = 'launch-purchase-notice';
  notice.setAttribute('aria-label', 'Paired asset purchase');
  const icon = document.createElement('span');
  icon.className = 'launch-purchase-notice__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'i';
  const text = document.createElement('p');
  text.textContent = 'ETH buys the missing paired asset first, then your token launches. If the launch stops, purchased assets stay in your wallet.';
  notice.append(icon, text);
  return notice;
}
