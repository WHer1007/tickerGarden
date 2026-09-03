import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SCHEMA_PATH = ROOT / "v2_hash_schemas.json"
MASK = (1 << 64) - 1
ROTATIONS = (
    (0, 36, 3, 41, 18),
    (1, 44, 10, 45, 2),
    (62, 6, 43, 15, 61),
    (28, 55, 25, 21, 56),
    (27, 20, 39, 8, 14),
)
ROUND_CONSTANTS = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A,
    0x8000000080008000, 0x000000000000808B, 0x0000000080000001,
    0x8000000080008081, 0x8000000000008009, 0x000000000000008A,
    0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089,
    0x8000000000008003, 0x8000000000008002, 0x8000000000000080,
    0x000000000000800A, 0x800000008000000A, 0x8000000080008081,
    0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)


def rotate(value, shift):
    if shift == 0:
        return value
    return ((value << shift) | (value >> (64 - shift))) & MASK


def keccak_f(state):
    for constant in ROUND_CONSTANTS:
        columns = [
            state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
            for x in range(5)
        ]
        delta = [columns[(x - 1) % 5] ^ rotate(columns[(x + 1) % 5], 1) for x in range(5)]
        for y in range(5):
            for x in range(5):
                state[x + 5 * y] ^= delta[x]
        moved = [0] * 25
        for y in range(5):
            for x in range(5):
                moved[y + 5 * ((2 * x + 3 * y) % 5)] = rotate(
                    state[x + 5 * y], ROTATIONS[x][y]
                )
        for y in range(5):
            for x in range(5):
                state[x + 5 * y] = moved[x + 5 * y] ^ (
                    (~moved[(x + 1) % 5 + 5 * y]) & moved[(x + 2) % 5 + 5 * y]
                )
        state[0] ^= constant


def keccak256(payload):
    rate = 136
    padded = bytearray(payload)
    padded.append(0x01)
    padded.extend(b"\x00" * ((rate - len(padded) % rate) % rate))
    padded[-1] |= 0x80
    state = [0] * 25
    for offset in range(0, len(padded), rate):
        block = padded[offset : offset + rate]
        for index in range(rate // 8):
            state[index] ^= int.from_bytes(block[index * 8 : index * 8 + 8], "little")
        keccak_f(state)
    return b"".join(word.to_bytes(8, "little") for word in state)[:32]


def sample_value(type_name, field_name, index, domain, schema_version):
    if field_name == "domain":
        return keccak256(domain.encode())
    if field_name == "schemaVersion":
        return schema_version
    if field_name == "chainId":
        return 31337
    if type_name == "address":
        return int.from_bytes(keccak256(field_name.encode())[-20:], "big")
    if type_name == "bytes32":
        return keccak256(f"vector:{field_name}".encode())
    if type_name.startswith("uint"):
        bits = int(type_name[4:] or "256")
        return min((index + 1) * 1009, (1 << bits) - 1)
    if type_name.startswith("int"):
        bits = int(type_name[3:] or "256")
        return min((index + 1) * 1009, (1 << (bits - 1)) - 1)
    raise ValueError(f"unsupported vector type: {type_name}")


def encode_word(type_name, value):
    if type_name == "bytes32":
        return value
    if type_name == "address":
        return value.to_bytes(32, "big")
    if type_name.startswith("uint"):
        return value.to_bytes(32, "big")
    if type_name.startswith("int"):
        return value.to_bytes(32, "big", signed=True)
    raise ValueError(type_name)


def printable(type_name, value):
    if type_name == "address":
        return "0x" + value.to_bytes(20, "big").hex()
    if type_name == "bytes32":
        return "0x" + value.hex()
    return str(value)


def build():
    document = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    vectors = []
    for name, schema in document["schemas"].items():
        words = []
        values = {}
        schema_version = schema.get("schemaVersion", 1)
        for index, declaration in enumerate(schema["fields"]):
            type_name, field_name = declaration.split(" ", 1)
            value = sample_value(
                type_name,
                field_name,
                index,
                schema["domain"],
                schema_version,
            )
            words.append(encode_word(type_name, value))
            values[field_name] = printable(type_name, value)
        encoded = b"".join(words)
        inner = keccak256(encoded)
        result = keccak256(inner) if schema.get("finalTransform") else inner
        vectors.append(
            {
                "schema": name,
                "inputs": values,
                "encoded": "0x" + encoded.hex(),
                "innerHash": "0x" + inner.hex(),
                "result": "0x" + result.hex(),
            }
        )
    document["vectors"] = vectors
    return document


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    assert keccak256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    rendered = json.dumps(build(), indent=2) + "\n"
    if args.write:
        SCHEMA_PATH.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
