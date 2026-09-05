const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
const b=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await p.goto('http://127.0.0.1:5193/',{waitUntil:'networkidle'});await p.locator('.garden-ready').waitFor();await p.locator('[data-garden]').scrollIntoViewIfNeeded();
 const box=await p.locator('[data-garden-viewport]').boundingBox();const fruit=p.getByRole('button',{name:'Explore NVDA, NVIDIA',exact:true});const old=await fruit.boundingBox();
 const cdp=await p.context().newCDPSession(p);
 let x=box.x+box.width*.45,y=box.y+box.height*.79;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let n=1;n<=8;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+n*10,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await p.waitForFunction(x=>Math.abs(document.querySelector('.garden-fruit-label').getBoundingClientRect().x-x)>5,old.x);
 const scroll=await p.evaluate(()=>scrollY);x=box.x+box.width*.2;y=box.y+box.height*.65;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let n=1;n<=8;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-n*12}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await p.waitForFunction(y=>scrollY>y+20,scroll);
 const fallback=await b.newPage({viewport:{width:390,height:844}});
 await fallback.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).includes('webgl')?null:original.call(this,type,...args);};});
 await fallback.goto('http://127.0.0.1:5193/',{waitUntil:'networkidle'});
 assert.equal(await fallback.locator('.garden-ready').count(),0);
 assert.equal(await fallback.locator('.tree-base').isVisible(),true);
 assert.equal(await fallback.locator('.ticker-fruit').count(),10);
 assert.equal(await fallback.locator('.garden-ui').isVisible(),false);
 console.log('PASS: actual touch horizontal rotation; vertical page scrolling; initial WebGL unavailable retains all ten original fruit labels and hides 3D-only controls.');
} finally {await b.close();}
})().catch(e=>{console.error(e);process.exit(1)});
