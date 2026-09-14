// Explicit local test config: do not load saved public-chain environment files.
import {defineConfig} from '../../apps/web/node_modules/vite/dist/node/index.js';
export default defineConfig({root:new URL('../../apps/web',import.meta.url).pathname,envDir:false,server:{host:'127.0.0.1',port:18771,strictPort:true},build:{outDir:new URL('../../.codex_tmp/full-local-web',import.meta.url).pathname,emptyOutDir:true}});
