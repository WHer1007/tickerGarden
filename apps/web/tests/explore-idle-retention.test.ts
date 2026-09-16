import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const app=readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
function section(start:string,end:string){const from=app.indexOf(start);assert.notEqual(from,-1);const to=app.indexOf(end,from+start.length);assert.notEqual(to,-1);return app.slice(from,to);}

test('tab hiding and page cache navigation never delete the Explore display',()=>{
 const lifecycle=section('function startSnapshotUpdates()', 'function isStaticPage()');
 const visibility=lifecycle.slice(lifecycle.indexOf('document.addEventListener("visibilitychange"'));
 assert.match(visibility,/poller.stop\(\)/);assert.match(visibility,/poller.reconnect\(\)/);
 assert.doesNotMatch(visibility,/clearMarketDirectoryView|marketDirectory.reset|invalidateSnapshotReads/);
 const pagehide=app.split('\n').filter(line=>line.includes('addEventListener("pagehide"')).join('\n');
 assert.doesNotMatch(pagehide,/clearMarketDirectoryView|marketDirectory.reset/);
});

test('outage invalidates transaction foundation but retains labelled Explore rows',()=>{
 const invalidate=section('function invalidateSnapshotReads(', 'function startSnapshotUpdates()');
 assert.match(invalidate,/preserveExploreDisplay=currentPage\(\) === "markets"/);
 assert.match(invalidate,/if\(!preserveExploreDisplay\)\{marketDirectory.reset\(\);clearMarketDirectoryView\(false\);\}/);
 assert.match(invalidate,/else if\(!foundation\)pauseExploreView\(\)/);
 const pause=section('function pauseExploreView()', 'let marketPhaseFilter');
 assert.match(pause,/explorePagers\[phase\].pause\(\)/);
 assert.match(pause,/if\(!hasCards\)clearMarketDirectoryView\(false\)/);
 assert.match(pause,/Showing the last loaded list/);
 assert.match(pause,/button.disabled=true/);
 const lifecycle=section('    unavailable: error =>', 'function isStaticPage()');
 assert.match(lifecycle,/foundation = null/);
 assert.match(lifecycle,/invalidateSnapshotReads\(\)/);
 assert.doesNotMatch(pause,/publicClient|readContract|\.remove\(/);
});

test('same-page recovery restores pagination and actual unmount still disposes the view',()=>{
 const render=section('  if(exploreRenderedPages[phase]===renderedKey', '  grid.querySelectorAll');
 assert.match(render,/button.disabled=false/);
 assert.match(render,/previous.disabled=!page.hasPrevious/);
 assert.match(render,/next.disabled=!page.hasNext/);
 const unmount=section('function unmountPage()', '  ++directEscapeLoadGeneration; directEscape = null;');
 assert.match(unmount,/invalidateSnapshotReads\(false,false\)/);
});

test('statistics only query visible rows and patch values without reloading lists',()=>{
 const refresh=section('async function refreshExploreStatistics()', 'async function fetchExplorePage(');
 assert.match(refresh,/exploreVisibleRows\[0\],\.\.\.exploreVisibleRows\[1\]/);
 assert.doesNotMatch(refresh,/foundation.markets/);
 const patch=section('function applyExploreStatistics()', 'type ExploreRanking=');
 assert.match(patch,/stat.sourceVersion===market.sourceVersion/);
 assert.doesNotMatch(patch,/renderExploreStage|\.reset\(|listMarkets|replaceChildren|\.remove\(/);
 const timer=section('const exploreStatisticsTimer=', 'if(import.meta.hot)import.meta.hot.dispose(()=>clearInterval(exploreStatisticsTimer))');
 assert.match(timer,/applyExploreStatistics/);assert.doesNotMatch(timer,/renderExploreStage|\.reset\(/);
});
