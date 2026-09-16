"""Execute the pinned v4 library's storage layout in an isolated build."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
repo = Path(__file__).resolve().parents[3]
forge = os.environ.get("FORGE") or shutil.which("forge")
if not forge:
    raise SystemExit("forge is required for the pool layout check")
with tempfile.TemporaryDirectory(prefix="tickergarden-conversion-pool-") as tmp:
    root = Path(tmp)
    (root / "test").mkdir()
    (root / "lib").mkdir()
    (root / "lib/v4-core").symlink_to(repo / "contracts/lib/v4-periphery/lib/v4-core", target_is_directory=True)
    (root / "foundry.toml").write_text('[profile.default]\nsolc_version="0.8.26"\nevm_version="cancun"\nremappings=["@uniswap/v4-core/=lib/v4-core/"]\n')
    (root / "test/PoolLayout.t.sol").write_text('''// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
contract PoolLayoutTest {
 mapping(bytes32=>bytes32) private words;
 function extsload(bytes32 slot) external view returns(bytes32){return words[slot];}
 function testPinnedLayout() public {
  bytes32 pool=keccak256("pool");bytes32 slot=keccak256(abi.encode(pool,uint256(6)));
  words[slot]=bytes32(uint256(1<<96)|(uint256(uint24(0xffffff))<<160)|(uint256(7)<<184)|(uint256(9)<<208));
  words[bytes32(uint256(slot)+3)]=bytes32(uint256(type(uint128).max));
  (uint160 price,int24 tick,uint24 protocol,uint24 lp)=StateLibrary.getSlot0(IPoolManager(address(this)),PoolId.wrap(pool));
  require(price==1<<96 && tick==-1 && protocol==7 && lp==9,"slot0 layout changed");
  require(StateLibrary.getLiquidity(IPoolManager(address(this)),PoolId.wrap(pool))==type(uint128).max,"liquidity layout changed");
 }
}
''')
    subprocess.run([forge, "test", "--root", str(root)], check=True)
