import {loadPageTemplate} from './pages.ts';
import {resolveRoute} from './routes.ts';
import {renderShell} from '../ui/shell.ts';
import {setupDocs} from '../ui/docs-search.ts';
import '../icons/regular.css';
async function mountStaticPage() {
const route=resolveRoute(new URL(location.href));
if(route.page!=='docs')await import('../../legal.css');
renderShell(route.page, 'Robinhood Chain');
document.body.dataset.page=route.page;
const outlet=document.querySelector<HTMLElement>('[data-route-outlet]')!;
if (!outlet.querySelector('main')) {
  const page=await loadPageTemplate(route.page);
  document.title=page.title;outlet.innerHTML=page.html;
}
const main=outlet.querySelector<HTMLElement>('main');if(main)main.id='main-content';
if(route.page==='docs')setupDocs();
const header=document.querySelector<HTMLElement>('[data-shell-header]')!;
const menu=document.querySelector<HTMLButtonElement>('[data-menu]')!;
menu.onclick=()=>{const open=header.classList.toggle('nav-open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close Navigation':'Open Navigation');};
header.onkeydown=e=>{if(e.key==='Escape'){header.classList.remove('nav-open');menu.setAttribute('aria-expanded','false');menu.focus();}};
document.querySelector<HTMLButtonElement>('[data-wallet]')!.onclick=async()=>{
  const button=document.querySelector<HTMLButtonElement>('[data-wallet]')!;button.disabled=true;
  try {
    await import('../app.ts');
    document.querySelector<HTMLButtonElement>('[data-wallet]')?.click();
  } catch {button.disabled=false;button.querySelector('span')!.textContent='Retry connection';}
};
if(location.hash)requestAnimationFrame(()=>{try{document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();}catch{}});

}
void mountStaticPage();
