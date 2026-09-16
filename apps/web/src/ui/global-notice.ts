export type GlobalNoticeTone = 'neutral' | 'success' | 'warning' | 'error';

const presentation: Record<GlobalNoticeTone, { icon: string; label: string }> = {
  neutral: { icon: 'ph-info', label: 'Notice' },
  success: { icon: 'ph-check-circle', label: 'Success' },
  warning: { icon: 'ph-warning', label: 'Attention' },
  error: { icon: 'ph-warning-circle', label: 'Error' },
};

export function globalNoticeRegion(): HTMLElement {
  const existing = document.querySelector<HTMLElement>('[data-global-notice-region]');
  if (existing) return existing;
  const region = document.createElement('aside');
  region.className = 'global-notice-region';
  region.dataset.globalNoticeRegion = '';
  region.setAttribute('aria-label', 'Notifications');
  document.body.append(region);
  return region;
}

export function createGlobalNotice() {
  let panel: HTMLElement | undefined;
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;

  const dismiss = () => {
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
    panel?.remove();
    panel = undefined;
  };

  return {
    show(message: string, tone: GlobalNoticeTone = 'neutral') {
      clearTimeout(dismissTimer);
      if (!panel) {
        panel = document.createElement('section');
        panel.className = 'status-notice global-notice';
        globalNoticeRegion().append(panel);
      }

      const state = presentation[tone];
      panel.dataset.tone = tone;
      panel.setAttribute('role', 'status');
      panel.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
      panel.setAttribute('aria-atomic', 'true');

      const icon = document.createElement('i');
      icon.className = `ph ${state.icon}`;
      icon.setAttribute('aria-hidden', 'true');
      const content = document.createElement('div');
      content.className = 'global-notice__content';
      const label = document.createElement('strong');
      label.textContent = state.label;
      const copy = document.createElement('p');
      copy.textContent = message;
      content.append(label, copy);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'status-notice__close';
      close.setAttribute('aria-label', 'Dismiss notification');
      close.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
      close.onclick = dismiss;
      panel.replaceChildren(icon, content, close);
      dismissTimer = setTimeout(dismiss, tone === 'error' || tone === 'warning' ? 8_000 : 5_000);
    },
    dismiss,
  };
}
