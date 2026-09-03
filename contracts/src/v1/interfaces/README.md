# Interfaces

`IV1Protocol.sol` is generated from `spec/v1_abi_surface.json` and is the compiled
V1 interface boundary. Regenerate it with:

```sh
python3 spec/generate_v1_interfaces.py --write
```

The draft under `spec/interfaces/` remains a specification aid and is not part of
the production import graph. `spec/generate_v1_artifact_manifest.py` reads the
Solidity artifacts and rejects any function, return type, mutability, event,
indexed-field, selector, permission, delay, recipient, or required-error drift.
