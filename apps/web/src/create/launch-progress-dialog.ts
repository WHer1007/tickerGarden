import './launch-progress.css';

export type LaunchProgressState = {
  title: string;
  step: string;
  detail: string;
  percent: number;
  supportDetails?: string;
  canDismiss?: boolean;
  outcome?: boolean;
  complete?: boolean;
  tokenName?: string;
  tokenSymbol?: string;
  tokenLogo?: string;
};

export type LaunchProgressActions = {
  onDismiss?: () => void;
  onViewToken?: () => void;
  onCreateNew?: () => void;
};

const STAGES = [
  'Publish details',
  'Prepare launch',
  'Approve asset (if needed)',
  'Confirm in wallet',
  'Confirm on chain',
  'Complete',
];

let dialog: HTMLDialogElement | undefined;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function getDialog(): HTMLDialogElement {
  if (dialog) return dialog;

  dialog = element('dialog', 'launch-progress-dialog');
  dialog.setAttribute('aria-labelledby', 'launch-progress-title');
  dialog.setAttribute('aria-describedby', 'launch-progress-detail');
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) event.preventDefault();
  });
  document.body.append(dialog);
  return dialog;
}

export function renderLaunchProgress(state: LaunchProgressState, actions: LaunchProgressActions): void {
  const modal = getDialog();
  modal.replaceChildren();
  modal.classList.toggle('launch-progress-dialog--outcome',Boolean(state.outcome));

  const content = element('div', 'launch-progress-dialog__content');
  const heading = element('h2', 'launch-progress-dialog__title');
  heading.id = 'launch-progress-title';
  heading.textContent = state.title;
  if(state.outcome){
    const icon=element('i','ph ph-check-circle launch-progress-dialog__outcome-icon');icon.setAttribute('aria-hidden','true');content.append(icon);
  }
  content.append(heading);
  if(state.outcome&&(state.tokenName||state.tokenSymbol)){
    const identity=element('div','launch-progress-dialog__identity');
    const image=element('span','launch-progress-dialog__token-image');
    const placeholder=element('i','ph ph-plant');placeholder.setAttribute('aria-hidden','true');image.append(placeholder);
    if(state.tokenLogo){
      const logo=element('img');logo.src=state.tokenLogo;logo.alt='';logo.addEventListener('load',()=>image.classList.add('has-image'));
      logo.addEventListener('error',()=>logo.remove());image.append(logo);
    }
    const copy=element('div');
    const name=element('strong');name.textContent=state.tokenName||'Your token';
    const symbol=element('span');symbol.textContent=state.tokenSymbol?`$${state.tokenSymbol}`:'';
    copy.append(name);if(state.tokenSymbol)copy.append(symbol);
    identity.append(image,copy);content.append(identity);
  }

  const status = element('div', 'launch-progress-dialog__status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const step = element('p', 'launch-progress-dialog__step');
  step.textContent = state.step;
  const detail = element('p', 'launch-progress-dialog__detail');
  detail.id = 'launch-progress-detail';
  detail.textContent = state.detail;
  status.append(step, detail);
  content.append(status);

  const progressLabel = element('label', 'launch-progress-dialog__progress-label');
  progressLabel.textContent = 'Stage progress';
  const progress = element('progress', 'launch-progress-dialog__progress');
  progress.max = 100;
  progress.value = Math.max(0, Math.min(100, Number.isFinite(state.percent) ? state.percent : 0));
  progress.setAttribute('aria-label', 'Stage progress');
  progressLabel.append(progress);
  content.append(progressLabel);

  const stages = element('ol', 'launch-progress-dialog__stages');
  const activeIndex = state.step === 'Check transaction'
    ? STAGES.indexOf('Confirm on chain')
    : STAGES.findIndex((stageName) => stageName === state.step || (state.step === 'Approve asset' && stageName === 'Approve asset (if needed)'));
  STAGES.forEach((stageName, index) => {
    const item = element('li');
    const stageIcon=element('i');stageIcon.setAttribute('aria-hidden','true');
    const label=element('span');label.textContent=stageName;
    if (index < activeIndex || (activeIndex === STAGES.length - 1 && index === activeIndex)) {
      item.dataset.state = 'complete';
      stageIcon.className='ph ph-check-circle';
    } else if (index === activeIndex) {
      item.dataset.state = 'current';
      item.setAttribute('aria-current', 'step');
      stageIcon.className='ph ph-circle-notch';
    } else {
      stageIcon.className='ph ph-circle';
    }
    item.append(stageIcon,label);
    stages.append(item);
  });
  if(!state.outcome)content.append(stages);

  if (state.supportDetails) {
    const support = element('button', 'launch-progress-dialog__support');
    support.type = 'button';
    support.textContent = 'Copy support details';
    support.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(state.supportDetails!); support.textContent = 'Copied'; }
      catch { const details=element('textarea'); details.readOnly=true; details.value=state.supportDetails!; support.after(details); details.focus(); details.select(); support.disabled=true; }
    });
    content.append(support);
  }

  if(state.complete&&(actions.onViewToken||actions.onCreateNew)){
    const controls=element('div','launch-progress-dialog__complete-actions');
    if(actions.onViewToken){
      const view=element('button','launch-progress-dialog__view');view.type='button';view.textContent='View Token';
      view.addEventListener('click',()=>actions.onViewToken?.());controls.append(view);
    }
    if(actions.onCreateNew){
      const create=element('button','launch-progress-dialog__create-new');create.type='button';create.textContent='Launch another token';
      create.addEventListener('click',()=>actions.onCreateNew?.());controls.append(create);
    }
    content.append(controls);
  }

  if (state.canDismiss) {
    const dismiss = element('button', 'launch-progress-dialog__dismiss');
    dismiss.type = 'button';
    dismiss.textContent = 'Return to form';
    dismiss.addEventListener('click', () => actions.onDismiss?.());
    content.append(dismiss);
  }

  modal.append(content);
  if (!modal.open) modal.showModal();
  modal.querySelector<HTMLElement>('button, a')?.focus();
}

export function closeLaunchProgress(): void {
  if (dialog?.open) dialog.close();
}
