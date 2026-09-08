/** Pixel-preserving layers of the approved artwork, independent of RPC, wallet or market data. */
type Point = readonly [number, number];
type Crop = readonly [number, number, number, number];
type Fruit = Readonly<{ symbol: string; crop: Crop; branch: readonly Point[] }>;
// Normalized asset coordinates. These cutouts retain the artist's fruit shapes and lettering.
const crop = (x: number, y: number, right: number, bottom: number): Crop => [x/1254,y/1254,right/1254,bottom/1254];
const path = (...points: Point[]): readonly Point[] => points.map(([x,y]) => [x/1254,y/1254] as const);
export const ARBOR_FRUITS: readonly Fruit[] = [
  { symbol:'AAPL', crop:crop(550,74,700,235), branch:path([624,233],[616,275],[579,329],[542,378],[530,418]) },
  { symbol:'AMZN', crop:crop(236,188,384,352), branch:path([354,344],[383,368],[435,394],[486,422],[515,454],[532,487]) },
  { symbol:'MSFT', crop:crop(841,189,989,352), branch:path([914,350],[903,405],[875,452],[840,483],[779,523],[711,574]) },
  { symbol:'NVDA', crop:crop(637,357,784,520), branch:path([712,516],[718,550],[710,588],[691,629],[679,669],[673,723]) },
  { symbol:'GOOGL', crop:crop(170,461,318,625), branch:path([267,621],[301,644],[351,658],[397,649],[446,633],[491,628],[538,638]) },
  { symbol:'COST', crop:crop(1053,441,1200,603), branch:path([1129,597],[1112,623],[1086,644],[1046,663],[997,673],[946,671],[883,653]) },
  { symbol:'TSLA', crop:crop(156,750,302,918), branch:path([233,914],[252,941],[280,952],[318,952],[370,935],[416,918]) },
  { symbol:'META', crop:crop(450,761,594,920), branch:path([530,916],[569,938],[601,970],[625,1004],[644,1041]) },
  { symbol:'AVGO', crop:crop(871,750,1017,914), branch:path([950,761],[950,725],[939,693],[921,674],[881,655],[827,649],[780,664],[747,694]) },
];
const LEAVES: readonly Crop[] = [crop(750,145,795,217),crop(421,520,479,566),crop(809,815,857,872),crop(455,955,514,1028)];

export async function mountArbor(stage: HTMLElement): Promise<() => void> {
  const source = stage.querySelector<HTMLImageElement>('[data-arbor-source]')!;
  const art = stage.querySelector<HTMLElement>('.arbor-art')!;
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const nodes: HTMLElement[] = [];
  const animations = new Map<Element, Animation>();
  let disposed = false;
  const announce = stage.querySelector<HTMLElement>('[data-arbor-status]')!;
  await source.decode();
  const width = source.naturalWidth, height = source.naturalHeight;
  // Keep the natural artwork ratio identical in the base and interactive layers.
  stage.style.aspectRatio = `${width} / ${height}`;
  const base = document.createElement('canvas');
  base.width = width; base.height = height; base.className = 'arbor-base'; base.setAttribute('aria-hidden', 'true');
  const context = base.getContext('2d');
  if (!context) return () => {};
  // Remove the supplied white matte in memory, preserving antialiased colored edges.
  // The original PNG remains unchanged and provides the no-JavaScript fallback.
  const artwork = document.createElement('canvas'); artwork.width=width; artwork.height=height;
  const prepared = artwork.getContext('2d')!; prepared.drawImage(source,0,0);
  const pixels = prepared.getImageData(0,0,width,height);
  for(let i=0;i<pixels.data.length;i+=4) {
    // Neutralize the baked-in lime before applying the current interactive selection.
    const r=pixels.data[i]!,g=pixels.data[i+1]!,b=pixels.data[i+2]!;
    if(r>85 && g>110 && g>r*0.85 && r>b*1.4 && g>b*1.4) {
      const x=(i/4)%width,y=Math.floor(i/4/width);
      const inFruit=x>=637/1254*width&&x<784/1254*width&&y>=357/1254*height&&y<520/1254*height;
      pixels.data[i]=inFruit?255:6;pixels.data[i+1]=inFruit?255:63;pixels.data[i+2]=inFruit?255:46;
    }
    const white=Math.min(pixels.data[i]!,pixels.data[i+1]!,pixels.data[i+2]!);
    const alpha=1-white/255;
    if(white>=250) {pixels.data[i+3]=0;continue;}
    for(let c=0;c<3;c++) pixels.data[i+c]=Math.round((pixels.data[i+c]!-white)/alpha);
    pixels.data[i+3]=Math.round(pixels.data[i+3]!*alpha);
  }
  prepared.putImageData(pixels,0,0);
  context.drawImage(artwork, 0, 0); nodes.push(base); art.append(base);

  function cutout(crop: Crop, element: HTMLElement) {
    const [left, top, right, bottom] = crop;
    const x = Math.round(left * width), y = Math.round(top * height);
    const w = Math.round(right * width) - x, h = Math.round(bottom * height) - y;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d')!; ctx.drawImage(artwork, x, y, w, h, 0, 0, w, h);
    context!.clearRect(x, y, w, h);
    Object.assign(element.style, { left: `${x / width * 100}%`, top: `${y / height * 100}%`, width: `${w / width * 100}%`, height: `${h / height * 100}%` });
    element.append(canvas); art.append(element); nodes.push(element);
  }
  function animate(element: HTMLElement, frames: Keyframe[], duration: number) {
    animations.get(element)?.cancel();
    if (reduced.matches || disposed) return;
    const animation = element.animate(frames, { duration, easing: 'ease-out' });
    animations.set(element, animation);
    void animation.finished.catch(() => {}).finally(() => {
      if (animations.get(element) === animation) animations.delete(element);
    });
  }
  // The highlight is an alpha stencil sampled from the actual branch pixels, not a redrawn tree.
  function branchLayer(points: readonly Point[]) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.className = 'arbor-branch'; canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d')!;
    ctx.lineWidth = width * 0.014; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x*width,y*height) : ctx.moveTo(x*width,y*height)); ctx.stroke();
    ctx.globalCompositeOperation = 'source-in'; ctx.drawImage(artwork,0,0);
    ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = getComputedStyle(stage).getPropertyValue('--lime').trim() || '#b9f31d'; ctx.fillRect(0,0,width,height);
    art.append(canvas); nodes.push(canvas); return canvas;
  }
  const leaves = LEAVES.map(crop => {
    const leaf = document.createElement('div'); leaf.className = 'arbor-leaf'; leaf.setAttribute('aria-hidden','true'); cutout(crop,leaf); return leaf;
  });
  let hovered: number | null = null;
  let focused: number | null = null;
  const defaultIndex = ARBOR_FRUITS.findIndex(fruit => fruit.symbol === 'NVDA');
  // Flood-fill the outside of the raster silhouette. Enclosed fruit/leaf interiors
  // become the highlight mask, while the original dark lettering stays on top.
  function highlightedFruit(normal: HTMLCanvasElement) {
    const w=normal.width,h=normal.height,ctx=normal.getContext('2d')!;
    const data=ctx.getImageData(0,0,w,h),outside=new Uint8Array(w*h),queue:number[]=[];
    const visit=(x:number,y:number)=>{
      const i=y*w+x;if(outside[i]||data.data[i*4+3]!>110)return;
      outside[i]=1;queue.push(i);
    };
    for(let x=0;x<w;x++){visit(x,0);visit(x,h-1);}
    for(let y=0;y<h;y++){visit(0,y);visit(w-1,y);}
    for(let k=0;k<queue.length;k++){
      const i=queue[k]!,x=i%w,y=Math.floor(i/w);
      if(x)visit(x-1,y);if(x<w-1)visit(x+1,y);if(y)visit(x,y-1);if(y<h-1)visit(x,y+1);
    }
    const filled=document.createElement('canvas');filled.width=w;filled.height=h;
    const fill=filled.getContext('2d')!,mask=fill.createImageData(w,h);
    for(let i=0;i<w*h;i++)if(!outside[i]){mask.data[i*4]=185;mask.data[i*4+1]=243;mask.data[i*4+2]=29;mask.data[i*4+3]=255;}
    fill.putImageData(mask,0,0);fill.drawImage(normal,0,0);return filled;
  }
  const records = ARBOR_FRUITS.map((fruit,index) => {
    const highlight = branchLayer(fruit.branch);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'arbor-fruit';
    button.dataset.symbol = fruit.symbol; button.dataset.state = 'idle';
    button.setAttribute('aria-label', `Drop ${fruit.symbol} fruit`);
    cutout(fruit.crop,button);
    const visual=button.querySelector('canvas')!;
    // Two neighboring leaf tips cross rectangular crop bounds. Keep those pixels
    // attached to the tree instead of taking them along with the falling fruit.
    const preservedTip=fruit.symbol==='AAPL'?[550,74,40,30]:fruit.symbol==='GOOGL'?[170,600,24,25]:null;
    if(preservedTip){
      const [px,py,pw,ph]=preservedTip as [number,number,number,number];
      const x=Math.round(px/1254*width),y=Math.round(py/1254*height),w=Math.round(pw/1254*width),h=Math.round(ph/1254*height);
      context!.drawImage(artwork,x,y,w,h,x,y,w,h);
      visual.getContext('2d')!.clearRect(x-Math.round(fruit.crop[0]*width),y-Math.round(fruit.crop[1]*height),w,h);
    }

    const normal=document.createElement('canvas');normal.width=visual.width;normal.height=visual.height;
    normal.getContext('2d')!.drawImage(visual,0,0);
    const filled=highlightedFruit(normal);
    function activate() {
      updateSelection();
      leaves.forEach((leaf,i) => animate(leaf,[{transform:'rotate(0deg)'},{transform:`rotate(${i%2?3:-3}deg)`},{transform:'rotate(0deg)'}],650+i*65));
    }
    button.addEventListener('pointerenter',()=>{hovered=index;activate();},options);
    button.addEventListener('focus',()=>{focused=index;activate();},options);
    button.addEventListener('pointerleave',()=>{if(hovered===index)hovered=null;updateSelection();},options);
    button.addEventListener('blur',()=>{if(focused===index)focused=null;updateSelection();},options);
    button.addEventListener('click',()=>{
      if(button.dataset.state==='falling')return;
      announce.textContent = `${fruit.symbol} fruit dropped.`;
      activate();
      if(reduced.matches)return;
      button.dataset.state='falling';button.setAttribute('aria-disabled','true');
      // Animate only the image. The hit target stays on its branch, avoiding hover
      // churn and accidental clicks on a moving fruit as it falls.
      const distance=Math.max(24,(1-fruit.crop[3])*art.clientHeight-12);
      const drift=index%2?9:-9;
      const animation=visual.animate([
        {transform:'translate(0,0)',opacity:1,offset:0},
        {transform:`translate(${drift*.1}px,${distance*.08}px) rotate(1deg)`,opacity:1,offset:.18},
        {transform:`translate(${drift*.4}px,${distance*.32}px) rotate(3deg)`,opacity:1,offset:.36},
        {transform:`translate(${drift}px,${distance}px) rotate(8deg)`,opacity:1,offset:.64},
        {transform:`translate(${drift}px,${distance}px) rotate(8deg)`,opacity:0,offset:.8},
        {transform:'translate(0,0)',opacity:0,offset:.82},
        {transform:'translate(0,0)',opacity:1,offset:1},
      ],{duration:1550,easing:'linear'});
      animations.set(visual,animation);
      void animation.finished.catch(()=>{}).finally(()=>{
        if(animations.get(visual)!==animation)return;
        animations.delete(visual);button.dataset.state='idle';button.removeAttribute('aria-disabled');updateSelection();
      });
    },options);
    button.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?ARBOR_FRUITS.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+ARBOR_FRUITS.length)%ARBOR_FRUITS.length;
      records[next]?.button.focus();
    },options);
    return {button,highlight,visual,normal,filled};
  });
  function updateSelection() {
    if(disposed)return;
    const selected=hovered??focused??defaultIndex;
    records.forEach(({button,highlight,visual,normal,filled},index)=>{
      const active=index===selected;button.dataset.active=String(active);
      highlight.classList.toggle('is-active',active);
      const ctx=visual.getContext('2d')!;ctx.clearRect(0,0,visual.width,visual.height);ctx.drawImage(active?filled:normal,0,0);
    });
  }
  updateSelection();
  const stopMotion=()=>{ animations.forEach(animation=>animation.cancel()); animations.clear(); records.forEach(({button})=>{button.dataset.state='idle';button.removeAttribute('aria-disabled');}); };
  reduced.addEventListener('change',stopMotion,options);
  document.addEventListener('visibilitychange',()=>{if(document.hidden) stopMotion();},options);
  stage.classList.add('is-ready');
  return () => {
    disposed=true;stopMotion();controller.abort();nodes.forEach(node=>node.remove());
    stage.classList.remove('is-ready');stage.style.removeProperty('aspect-ratio');
  };
}
