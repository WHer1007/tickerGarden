// Rebuild the UI derivatives from the approved source artwork. Requires ImageMagick.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const asset=fileURLToPath(new URL('../assets/',import.meta.url));
for(const name of ['step-stake','step-earn','step-liquidity'])for(const size of [320,640])execFileSync('magick',[`${asset}${name}.webp`,'-resize',`${size}x${size}`,'-strip','-quality','80',`${asset}${name}-${size}.webp`]);
execFileSync('magick',[`${asset}robinhood-chain/robinhood-feather-symbol.jpg`,'-resize','60x60','-strip','-quality','85',`${asset}robinhood-chain/robinhood-feather-60.webp`]);
