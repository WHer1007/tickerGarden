import './launch-progress.css';

export type LaunchProgressState = {
  title: string;
  step: string;
  detail: string;
  percent: number;
  hash?: string;
  explorer: string;
  needsHash?: boolean;
  canDismiss?: boolean;
  outcome?: boolean;
  complete?: boolean;
  tokenName?: string;
  tokenSymbol?: string;
  tokenLogo?: string;
};

export type LaunchProgressActions = {
  onHash?: (hash: string) => void;
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
const HASH_PATTERN = /^0x[\da-fA-F]{64}$/;

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
  const previousInput = modal.querySelector<HTMLInputElement>('input[type="text"]');
  const previousValue = previousInput?.value;
  const hadFocus = previousInput === document.activeElement;
  const previousSelectionStart = previousInput?.selectionStart;
  const previousSelectionEnd = previousInput?.selectionEnd;
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

  if (state.hash) {
    const hashText = element('p', 'launch-progress-dialog__hash');
    hashText.textContent = state.hash;
    content.append(hashText);
  }

  if (state.needsHash) {
    const hashForm = element('form', 'launch-progress-dialog__hash-form');
    hashForm.noValidate = true;
    const hashLabel = element('label');
    hashLabel.textContent = 'Transaction hash';
    const input = element('input');
    input.type = 'text';
    input.inputMode = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.required = true;
    input.pattern = '0x[0-9a-fA-F]{64}';
    input.setAttribute('aria-describedby', 'launch-progress-hash-help');
    const help = element('span', 'launch-progress-dialog__help');
    help.id = 'launch-progress-hash-help';
    help.textContent = 'Enter the 64-character transaction hash.';
    const track = element('button', 'launch-progress-dialog__track');
    track.type = 'submit';
    track.textContent = 'Track transaction';
    track.disabled = true;
    input.addEventListener('input', () => {
      track.disabled = !HASH_PATTERN.test(input.value.trim());
    });
    if (previousValue !== undefined) {
      input.value = previousValue;
      track.disabled = !HASH_PATTERN.test(previousValue.trim());
    }
    hashForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const hash = input.value.trim();
      if (HASH_PATTERN.test(hash)) actions.onHash?.(hash);
    });
    hashLabel.append(input);
    hashForm.append(hashLabel, help, track);
    content.append(hashForm);
  }

  if (state.explorer) {
    const link = element('a', 'launch-progress-dialog__explorer');
    link.textContent = 'View on explorer';
    link.href = state.explorer;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    content.append(link);
  }

  if(state.complete&&(actions.onViewToken||actions.onCreateNew)){
    const controls=element('div','launch-progress-dialog__complete-actions');
    if(actions.onViewToken){
      const view=element('button','launch-progress-dialog__view');view.type='button';view.textContent='View Token';
      view.addEventListener('click',()=>actions.onViewToken?.());controls.append(view);
    }
    if(actions.onCreateNew){
      const create=element('button','launch-progress-dialog__create-new');create.type='button';create.textContent='Create new one';
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
  if (hadFocus) {
    const restoredInput = modal.querySelector<HTMLInputElement>('input[type="text"]');
    restoredInput?.focus();
    if (previousSelectionStart !== null && previousSelectionStart !== undefined) {
      restoredInput?.setSelectionRange(previousSelectionStart, previousSelectionEnd ?? previousSelectionStart);
    }
  } else {
    const autofocus = modal.querySelector<HTMLElement>('input, button, a');
    autofocus?.focus();
  }
}

export function closeLaunchProgress(): void {
  if (dialog?.open) dialog.close();
}
