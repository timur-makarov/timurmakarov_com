+++
date = '2024-08-14T08:00:00+04:00'
draft = false
title = 'Ethereum Execution Layer Specifications (Updated up to June 13 2026)'
description = "Compilation of knowledge on official EELS. Current version: pre-Amsterdam <br> Explanation of all the building blocks (EVM, RLP, Blob, BAL, Merkle Patricia Trie, etc.) and code"
+++

This article supposes that you have some prior knowledge on what transactions, blocks, smart-contracts abstractly are. Here we will decipher [EELS](https://github.com/ethereum/execution-specs) of the Amsterdam fork line by line. Contains explanations for everything and they are provided and as we go.

EELS implement validation rules for incoming blocks. And so here, in the code snippets, we're not building a new block, we're validation an existing one. But the rules for building one are the same, of course.

"""
The Execution Layer is defined as the part of the blockchain that executes smart contracts, handles transactions, and updates the global state of a particular blockchain. For example, each time a user engages with a dApp, be it swapping tokens in a DEX or minting NFTs, or even borrowing from DeFi protocols, it’s the Execution Layer that services the request and updates the states to reflect the new situation.

Blockchains have real world utility and require an environment for the computation which can be provided by the Execution Layer. The environment will verify ownership of the applicable balances or permissions and perform the necessary updates to blockchain state.

Ethereum is one of the blockchains in which the Execution Layer is decoupled from the Consensus Layer. After The Merge, Execution Layer became the original Ethereum chain and Beacon Chain now performs the consensus. Such forms of decoupling enables extensibility and improved flexibility in the structure of blockchains.

Optimism and Arbitrum, which follow the decentralized modular Layer 2 model, also create their own Execution Layers. These place data on the consensus layer of Ethereum after processing them off chain for cost effective and rapid services without compromising security.

By separating execution from consensus, modern blockchains are more adaptable and scalable—fueling a broad range of decentralized innovations across finance, gaming, identity, and beyond.
""" from [chiliz.com](https://www.chiliz.com/execution-vs-consensus-layer-blockchain/)

- [Primitives and Fundamentals](#primitives-and-fundamentals)
  - [Merkle Patricia Tries, Proofs and the State](#merkle-patricia-tries-and-proofs-and-the-state)
  - [Types of Transactions and All About Them](#types-of-transactions-and-dynamic-gas-prices)
  - [State Tracker in EELS](#state-tracker-in-eels)
  - [Block-level Access Lists](#block-level-access-lists)
- [Ethereum Virtual Machine](#ethereum-virtual-machine)
  - [EVM Helper Functions](#evm-helper-functions)
  - [EVM Opcodes](#evm-opcodes)
- [Specifications. The Building Blocks of the Block Validation Flow](#specifications-the-building-blocks-of-the-block-validation-flow)
  - [Initial Validation](#initial-validation)
  - [Executions](#execution)

## Primitives and Fundamentals

### Merkle Patricia Tries and Proofs and the State

#### General Tries
A trie is also known as a radix tree, and the ethereum implementation introduces a couple modifications to boost efficiency. In a normal radix tree, a key is the actual path taken through the tree to get to the corresponding value. That is, beginning from the root node of the tree, each character in the key tells you which child node to follow to get to the corresponding value, where the values are stored in the leaf nodes that terminate every path through the tree. Supposing the keys come from an alphabet containing N characters, each node in the tree can have up to N children, and the maximum depth of the tree is the maximum length of a key.

Radix trees are nice because they allow keys that begin with the same sequence of characters to have values that are closer together in the tree. There are also no key collisions in a trie, like there might be in hash-tables. They can, however, be rather inefficient, like when you have a long key where no other key shares a common prefix. Then you have to travel (and store) a considerable number of nodes in the tree to get to the value, despite there being no other values along the path.

---

#### Important to Note

While the Modified Merkle Patricia Trie (MPT) is a beautiful logical data structure, it does not exist as a literal "tree" on a hard drive. Physically, Ethereum clients (like Geth or Erigon) flatten this tree and store it in a highly optimized, embedded Key-Value (KV) database, typically LevelDB.

In the underlying database, there are no "branches" or "leaves" in the traditional sense. Everything is just a flat list of key-value pairs: `keccak256(node)` => `rlp(node)` (explained later).

If an Ethereum node actually did 6 to 8 separate disk reads for every single account and storage slot touched in a transaction, the network would grind to a halt. Modern clients implement heavy optimizations:
1. In-Memory Caching: Clients dedicate a massive amount of your computer's RAM to caching the most frequently accessed nodes. The top levels of the State Trie (the root and highest branches) almost never leave RAM, meaning disk reads are only required for the very bottom of the tree
2. The "Flat State": Traversing a trie node-by-node is incredibly slow. Modern client architectures maintain a secondary, parallel database. It ignores the trie entirely and simply maps Address -> Balance directly. The trie is then updated in the background purely so the client can calculate the new stateRoot hash to prove the block is valid

Recursive Length Prefix (RLP) is a core serialization protocol used within the execution layer for encoding and parsing data. It is designed to serialize data and produce a structure readable by all client software.

---

#### Tries Used in Ethereum
The ethereum implementation of radix trees introduces a number of improvements:
1. To make the tree cryptographically secure, each node is referenced by its hash, which are used for look-up in a leveldb database. With this scheme, the root node becomes a cryptographic fingerprint of the entire data structure (hence, Merkle)
2. A number of node ‘types’ are introduced to improve efficiency. With 64 character paths it is inevitable that after traversing the first few layers of the trie, you will reach a node where no divergent path exists for at least part of the way down. To avoid having to create up to 15 sparse NULL nodes along the path, we shortcut the descent by setting up an extension node of the form [ encodedPath, key ], where encodedPath contains the "partial path" to skip ahead, and the key is for the next DB lookup

NULL (represented as the empty string)
branch A 17-item node [ v0 ... v15, vt ]
leaf A 2-item node [ encodedPath, value ]
extension A 2-item node [ encodedPath, key ]

For a leaf node, which can be marked by a flag in the first nibble of the encodedPath, the path encodes all prior node's path fragments and we can look up the value directly.

This above optimization, however, introduces ambiguity. When traversing paths in nibbles, we may end up with an odd number of nibbles to traverse, but because all data is stored in bytes format. It is not possible to differentiate between, for instance, the nibble 1, and the nibbles 01 (both must be stored as <01>). To specify odd length, the partial path is prefixed with a flag.

0	0000	extension	even
1	0001	extension	odd
2	0010	terminating (leaf)	even
3	0011	terminating (leaf)	odd

Suppose we want a trie containing four path/value pairs ('do', 'verb'), ('dog', 'puppy'), ('doge', 'coins'), ('horse', 'stallion'). Values would be bytes too, of course.
<64 6f> : 'verb'
<64 6f 67> : 'puppy'
<64 6f 67 65> : 'coins'
<68 6f 72 73 65> : 'stallion'

```
rootHash: [ <16>, hashA ]
hashA:    [ <>, <>, <>, <>, hashB, <>, <>, <>, [ <20 6f 72 73 65>, 'stallion' ], <>, <>, <>, <>, <>, <>, <>, <> ]
hashB:    [ <00 6f>, hashC ]
hashC:    [ <>, <>, <>, <>, <>, <>, hashD, <>, <>, <>, <>, <>, <>, <>, <>, <>, 'verb' ]
hashD:    [ <17>, [ <>, <>, <>, <>, <>, <>, [ <35>, 'coins' ], <>, <>, <>, <>, <>, <>, <>, <>, <>, 'puppy' ] ]
```

```
[ ROOT HASH ]
  (Extension Node)
  Shared Path: <16> (The nibble '6'; the flag is '1')
       │
       ▼
[ HASH A ]
  (Branch Node - splits based on the next nibble)
       ├── Index [4] (from '64') ──> Points to HASH B
       │
       └── Index [8] (from '68') ──> [ LEAF NODE ] 
                                       Path: <20 6f 72 73 65>;
                                       Value: 'stallion' (horse)
                                       (the flag is '2' + '0' to keep the length even)

--- (Following the path for 'do', 'dog', 'doge') ---

[ HASH B ]
  (Extension Node)
  Shared Path: <00 6f> (The nibbles '6f'; the flag is '0' + '0' to keep it even)
       │
       ▼
[ HASH C ]
  (Branch Node - splits based on the next nibble)
       ├── Index [6] (from '67') ──> Points to HASH D
       │
       └── Value Slot (17th item) ─> 'verb' (Path ends here: 'do')

--- (Following the path for 'dog', 'doge') ---

[ HASH D ]
  (Extension Node pointing to an INLINE Branch Node)
  Shared Path: <17> (The nibble '7'; the flag '1')
       │
       ▼
  [ INLINE BRANCH NODE ]
       ├── Index [5] (from '65') ──> [ LEAF NODE ]
       │                               Path: <35> (the flag is '3')
       │                               Value: 'coins' (doge)
       │
       └── Value Slot (17th item) ─> 'puppy' (Path ends here: 'dog')
```

**if len(rlp.encode(node)) >= 32:**
node_hash = keccak256(rlp.encode(node))
What is included is *node_hash* and we need to store the pair (*node_hash*, *node*) in the database.
**else:**
Database lookups are expensive. Hashing a node and saving Hash => Node in the database takes time. If a node is tiny, creating a massive 32-byte (64-character) hash pointer to reference a tiny 10-byte node is inefficient. So we just embed the raw data directly into the parent node

---

#### Types of Tries in Ethereum
Here are the four types of tries Ethereum uses to store all network data:

1. The State Trie (World State)
Scope: One global trie per block.
Purpose: This is the master ledger of the network. It maps every active Ethereum address (both user wallets and smart contracts) to its current "Account State." The account state includes the account's nonce, ETH balance, code hash, and a link (the storageRoot) to its individual Storage Trie.

2. The Storage Trie (Contract State)
Scope: One distinct trie per smart contract account.
Purpose: This is where a smart contract's actual state variables (its memory/data) live. It maps cryptographically hashed storage slots to their specific values. The root hash of this specific trie is stored back in the global State Trie to mathematically prove the contract's state.

3. The Transaction Trie
Scope: One trie per mined block.
Purpose: It securely records every transaction included in a specific block. It maps the index of the transaction (the order it was processed in the block) to the transaction data itself. Once a block is mined, this trie is immutable and never updated.

4. The Receipts Trie
Scope: One trie per mined block.
Purpose: It stores the outcomes of the transactions recorded in the Transaction Trie. It maps the transaction index to its corresponding receipt, which contains details like gas used, success/failure status, and emitted logs or events.

5. The Withdrawals Trie
Scope: One trie per mined block.
Purpose: This trie acts as the secure bridge between Ethereum's Consensus Layer (the Beacon Chain) and its Execution Layer. It securely records all the staked ETH and staking rewards being withdrawn by validators back into standard Ethereum wallets.

---

#### Merkle Proof in Ethereum

If you want to prove to someone that your transaction is included in a specific block, you don't send them the whole tree. You only send your transaction data and a handful of "sibling hashes" — the specific hashes on the direct path from your data up to the root.

The client takes your transaction, checks that the transaction in the leaf node is the one you asked for, hashes the leaf node, checks that the hash is in the branch node the leaf came from, hashes the branch node, and so on up the tree to the root node. You hash the root node and compare it with the hash from the block header.

By using root hashes and requesting multiple merkle path to the data you need, you can run the transaction on a light-node (smartphone, laptop) without downloading all the Ethereum data. You use merkle path as the database (you requested and verifies the transaction, you requested and verified contents of used variables, you requested and verified that the execution emitted certain logs) 

---

#### How Solidity Stores the Data

**The Base Slot (`p`)**
Before any dynamic calculations occur, Solidity must assign a starting point for every state variable. This is the base slot, often denoted as `p`.

* **How it is calculated:** Base slots are assigned sequentially at **compile time**, starting from `0`. As the compiler reads your state variables from top to bottom, it assigns the next available slot.
* **Inheritance:** If a contract inherits from another, the parent contract's variables are assigned first. The child contract's variables continue from the next available slot after the parent's last variable.

```solidity
contract Storage {
    uint256 a; // p = 0
    uint256 b; // p = 1
    mapping(uint256 => uint256) c; // p = 2
}

```

**Value Types and Packing**
Simple value types (`uint256`, `address`, `bool`, etc.) are stored exactly at their assigned base slot `p`.

If multiple consecutive variables require less than 32 bytes (e.g., an `address` is 20 bytes, a `bool` is 1 byte), Solidity will **pack** them into the same 32-byte slot to save gas. They are packed from right to left.

**Structs and Fixed-Size Arrays (Multi-Slot)**
Structs and fixed arrays are static data structures, meaning their size is known at compile time. Therefore, they do not use hashing; they are stored sequentially starting at their base slot `p`.

1. A struct or fixed array always begins on a brand new slot
2. Its elements are laid out sequentially following the exact same packing rules as global state variables
3. When the struct or array ends, the next global state variable will start on a new slot (structs/arrays pad out to the end of their final slot)

```solidity
struct Player {
    uint256 score;      // stored at slot p
    uint128 health;     // stored at slot p + 1 (bytes 0-15)
    uint128 magic;      // stored at slot p + 1 (bytes 16-31, packed with health)
    address guild;      // stored at slot p + 2
}
Player myPlayer; // If p = 0, this struct occupies slots 0, 1, and 2.

```

**Dynamic Arrays (`T[]`)**

Because dynamic arrays can grow infinitely, their elements cannot be stored sequentially after `p` without risking overwriting other state variables.

* Base Slot (`p`): Stores the **length** of the array.
* Data Location: The elements begin at a cryptographically secured location: `keccak256(p)`.
* Specific Element (`i`): To find the index `i`, you add the index to the hashed base slot.

```solidity
// To find the slot for dynamicArray[i] where p is the base slot:
uint256 dataStart = uint256(keccak256(abi.encode(p)));
uint256 elementSlot = dataStart + i; 

```

If the array elements are smaller than 32 bytes, the offset is adjusted for packing `p + (i / items_per_slot)`.

**Mappings (`mapping(K => V)`)**

* Base Slot (`p`): Mappings do not have a length, nor do they keep track of their keys. The base slot only acts as a unique namespace.
* Data Location: The value for key `k` is stored by hashing the key and the base slot together.

```solidity
// To find the slot for myMapping[key] where p is the base slot:
uint256 elementSlot = uint256(keccak256(abi.encode(key, p)));

```

**Strings and Dynamic Bytes (`string`, `bytes`)**

Strings and bytes are dynamically sized, but Solidity uses a brilliant bitwise trick to save massive amounts of gas for short strings.

To understand why Solidity stores `length * 2`, we have to look at how data is structured in memory. The EVM checks the Least Significant Bit (LSB)—the very last bit of the 32-byte word—to determine if a string is short or long.

* Multiplying by 2: In binary, multiplying an integer by 2 is the same as a "bitwise left shift" (`<< 1`). This guarantees that the final bit (the LSB) is always a `0`.
* Adding 1: If you multiply by 2 and add 1, you guarantee the LSB is a `1`.

Solidity uses this final bit as a flag:
LSB `0` = Short String.
LSB `1` = Long String.

Scenario A: Short Strings (<= 31 bytes):

* The actual string data is stored left-aligned in slot `p`.
* The length is stored in the very last byte (the lowest-order byte) of slot `p` as `length * 2`.

Scenario B: Long Strings (>= 31 bytes):

* Slot `p` now only stores the length of the string, formatted as `(length * 2) + 1`. The `+1` sets the LSB to `1`.
* When the EVM reads slot `p`, it sees the LSB is `1`. It knows to strip that bit away, divide by 2 to get the true length, and then jump to `keccak256(p)` to read the actual string data sequentially across multiple slots (just like a dynamic array).

**Nested Structures (Combinations)**

When structures are nested, the calculation is recursive from the outside in. You resolve the outer structure's storage location, and that exact location becomes the new base slot (`p`) for the inner structure.

Assume this mapping is declared at base slot `p = 2`. We want to find index `5` of the array belonging to address `0xABC`.

1. **Resolve the Mapping:** Calculate the slot for the array belonging to `0xABC`
`array_p = keccak256(abi.encode(0xABC, 2))`

2. **Resolve the Array:** Use `array_p` as the base slot for the dynamic array calculation
`data_start = keccak256(abi.encode(array_p))`
`final_slot = data_start + 5`

---

#### Execution Layer Specifications Implementation

```python
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import (
    TYPE_CHECKING,
    Callable,
    Dict,
    Generic,
    List,
    Mapping,
    MutableMapping,
    Optional,
    Sequence,
    Tuple,
    TypeVar,
    cast,
)

from ethereum_rlp import Extended, rlp
from ethereum_types.bytes import Bytes
from ethereum_types.frozen import slotted_freezable
from ethereum_types.numeric import Uint
from typing_extensions import assert_type

from ethereum.crypto.hash import Hash32, keccak256
from ethereum.utils.hexadecimal import hex_to_bytes

if TYPE_CHECKING:
    from ethereum.state import Account, Address, Root

# note: an empty trie (regardless of whether it is secured) has root:
#   keccak256(RLP(b''))
#       ==
#   56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421 # noqa: E501
EMPTY_TRIE_ROOT = Hash32(
    hex_to_bytes(
        "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"
    )
)


@slotted_freezable
@dataclass
class LeafNode:
    rest_of_key: Bytes
    value: Extended


@slotted_freezable
@dataclass
class ExtensionNode:
    key_segment: Bytes
    subnode: Extended


BranchSubnodes = Tuple[
    Extended,
    Extended,
    Extended,
    Extended,
    Extended,
    Extended,
    Extended,
    Extended,
    Extended,
    Extended,
    Extended,
    Extended,
    Extended,
    Extended,
    Extended,
    Extended,
]


@slotted_freezable
@dataclass
class BranchNode:
    subnodes: BranchSubnodes
    value: Extended


InternalNode = LeafNode | ExtensionNode | BranchNode


K = TypeVar("K", bound=Bytes)
V = TypeVar("V", bound=Extended | None)


def encode_account(raw_account_data: Account, storage_root: Bytes) -> Bytes:
    """
    Encode `Account` dataclass.

    Storage is not stored in the `Account` dataclass, so `Accounts` cannot be
    encoded without providing a storage root.
    """
    return rlp.encode(
        (
            raw_account_data.nonce,
            raw_account_data.balance,
            storage_root,
            raw_account_data.code_hash,
        )
    )


def encode_internal_node(node: Optional[InternalNode]) -> Extended:
    """
    Encodes a Merkle Trie node into its RLP form. The RLP will then be
    serialized into a `Bytes` object and hashed unless it is less than 32 bytes
    when serialized.

    This function also accepts `None`, representing the absence of a node,
    which is encoded to `b""`.

    Parameters
    ----------
    node : Optional[InternalNode]
        The node to encode.

    Returns
    -------
    encoded : `Extended`
        The node encoded as RLP.

    """
    unencoded: Extended
    if node is None:
        unencoded = b""
    elif isinstance(node, LeafNode):
        unencoded = (
            nibble_list_to_compact(node.rest_of_key, True),
            node.value,
        )
    elif isinstance(node, ExtensionNode):
        unencoded = (
            nibble_list_to_compact(node.key_segment, False),
            node.subnode,
        )
    elif isinstance(node, BranchNode):
        unencoded = list(node.subnodes) + [node.value]
    else:
        raise AssertionError(f"Invalid internal node type {type(node)}!")

    encoded = rlp.encode(unencoded)
    if len(encoded) < 32:
        return unencoded
    else:
        return keccak256(encoded)


def encode_node(node: Extended, storage_root: Bytes | None = None) -> Bytes:
    """
    Encode a Node for storage in the Merkle Trie.
    """
    from ethereum.state import Account

    if isinstance(node, Account):
        assert storage_root is not None
        return encode_account(node, storage_root)
    elif isinstance(node, Bytes):
        return node
    else:
        return rlp.encode(node)


@dataclass
class Trie(Generic[K, V]):
    """
    The Merkle Trie.
    """

    secured: bool
    default: V
    _data: Dict[K, V] = field(default_factory=dict)


def copy_trie(trie: Trie[K, V]) -> Trie[K, V]:
    """
    Create a copy of `trie`. Since only frozen objects may be stored in tries,
    the contents are reused.

    Parameters
    ----------
    trie: `Trie`
        Trie to copy.

    Returns
    -------
    new_trie : `Trie[K, V]`
        A copy of the trie.

    """
    return Trie(trie.secured, trie.default, copy.copy(trie._data))


def trie_set(trie: Trie[K, V], key: K, value: V) -> None:
    """
    Stores an item in a Merkle Trie.

    This method deletes the key if `value == trie.default`, because the Merkle
    Trie represents the default value by omitting it from the trie.

    Parameters
    ----------
    trie: `Trie`
        Trie to store in.
    key : `Bytes`
        Key to lookup.
    value : `V`
        Node to insert at `key`.

    """
    if value == trie.default:
        if key in trie._data:
            del trie._data[key]
    else:
        trie._data[key] = value


def trie_get(trie: Trie[K, V], key: K) -> V:
    """
    Gets an item from the Merkle Trie.

    This method returns `trie.default` if the key is missing.

    Parameters
    ----------
    trie:
        Trie to lookup in.
    key :
        Key to lookup.

    Returns
    -------
    node : `V`
        Node at `key` in the trie.

    """
    return trie._data.get(key, trie.default)


def common_prefix_length(a: Sequence, b: Sequence) -> int:
    """
    Find the longest common prefix of two sequences.
    """
    for i in range(len(a)):
        if i >= len(b) or a[i] != b[i]:
            return i
    return len(a)


def nibble_list_to_compact(x: Bytes, is_leaf: bool) -> Bytes:
    """
    Compresses nibble-list into a standard byte array with a flag.

    A nibble-list is a list of byte values no greater than `15`. The flag is
    encoded in high nibble of the highest byte. The flag nibble can be broken
    down into two two-bit flags.

    Highest nibble::

        +---+---+----------+--------+
        | _ | _ | is_leaf | parity |
        +---+---+----------+--------+
          3   2      1         0


    The lowest bit of the nibble encodes the parity of the length of the
    remaining nibbles -- `0` when even and `1` when odd. The second lowest bit
    is used to distinguish leaf and extension nodes. The other two bits are not
    used.

    Parameters
    ----------
    x :
        Array of nibbles.
    is_leaf :
        True if this is part of a leaf node, or false if it is an extension
        node.

    Returns
    -------
    compressed : `bytearray`
        Compact byte array.

    """
    compact = bytearray()

    if len(x) % 2 == 0:  # ie even length
        compact.append(16 * (2 * is_leaf))
        for i in range(0, len(x), 2):
            compact.append(16 * x[i] + x[i + 1])
    else:
        compact.append(16 * ((2 * is_leaf) + 1) + x[0])
        for i in range(1, len(x), 2):
            compact.append(16 * x[i] + x[i + 1])

    return Bytes(compact)


def bytes_to_nibble_list(bytes_: Bytes) -> Bytes:
    """
    Converts a `Bytes` into to a sequence of nibbles (bytes with value < 16).

    Parameters
    ----------
    bytes_:
        The `Bytes` to convert.

    Returns
    -------
    nibble_list : `Bytes`
        The `Bytes` in nibble-list format.

    """
    nibble_list = bytearray(2 * len(bytes_))
    for byte_index, byte in enumerate(bytes_):
        nibble_list[byte_index * 2] = (byte & 0xF0) >> 4
        nibble_list[byte_index * 2 + 1] = byte & 0x0F
    return Bytes(nibble_list)


def _prepare_trie(
    trie: Trie[K, V],
    get_storage_root: Optional[Callable[[Address], Root]] = None,
) -> Mapping[Bytes, Bytes]:
    """
    Prepares the trie for root calculation. Removes values that are empty,
    hashes the keys (if `secured == True`) and encodes all the nodes.

    Parameters
    ----------
    trie :
        The `Trie` to prepare.
    get_storage_root :
        Function to get the storage root of an account. Needed to encode
        `Account` objects.

    Returns
    -------
    out : `Mapping[ethereum.base_types.Bytes, Node]`
        Object with keys mapped to nibble-byte form.

    """
    from ethereum.state import Account, Address

    mapped: MutableMapping[Bytes, Bytes] = {}

    for preimage, value in trie._data.items():
        if isinstance(value, Account):
            assert get_storage_root is not None
            address = Address(preimage)
            encoded_value = encode_node(value, get_storage_root(address))
        elif value is None:
            raise AssertionError("cannot encode `None`")
        else:
            encoded_value = encode_node(value)
        if encoded_value == b"":
            raise AssertionError
        key: Bytes
        if trie.secured:
            # "secure" tries hash keys once before construction
            key = keccak256(preimage)
        else:
            key = preimage
        mapped[bytes_to_nibble_list(key)] = encoded_value

    return mapped


def root(
    trie: Trie[K, V],
    get_storage_root: Optional[Callable[[Address], Root]] = None,
) -> Root:
    """
    Computes the root of a modified merkle patricia trie (MPT).

    Parameters
    ----------
    trie :
        `Trie` to get the root of.
    get_storage_root :
        Function to get the storage root of an account. Needed to encode
        `Account` objects.


    Returns
    -------
    root : `.state.Root`
        MPT root of the underlying key-value pairs.

    """
    from ethereum.state import Root

    obj = _prepare_trie(trie, get_storage_root)

    root_node = encode_internal_node(patricialize(obj, Uint(0)))
    if len(rlp.encode(root_node)) < 32:
        return keccak256(rlp.encode(root_node))
    else:
        assert isinstance(root_node, Bytes)
        return Root(root_node)


def patricialize(
    obj: Mapping[Bytes, Bytes], level: Uint
) -> Optional[InternalNode]:
    """
    Structural composition function.

    Used to recursively patricialize and merkleize a dictionary. Includes
    memoization of the tree structure and hashes.

    Parameters
    ----------
    obj :
        Underlying trie key-value pairs, with keys in nibble-list format.
    level :
        Current trie level.

    Returns
    -------
    node : `ethereum.base_types.Bytes`
        Root node of `obj`.

    """
    if len(obj) == 0:
        return None

    arbitrary_key = next(iter(obj))

    # if leaf node
    if len(obj) == 1:
        leaf = LeafNode(arbitrary_key[level:], obj[arbitrary_key])
        return leaf

    # prepare for extension node check by finding max j such that all keys in
    # obj have the same key[i:j]
    substring = arbitrary_key[level:]
    prefix_length = len(substring)
    for key in obj:
        prefix_length = min(
            prefix_length, common_prefix_length(substring, key[level:])
        )

        # finished searching, found another key at the current level
        if prefix_length == 0:
            break

    # if extension node
    if prefix_length > 0:
        prefix = arbitrary_key[int(level) : int(level) + prefix_length]
        return ExtensionNode(
            prefix,
            encode_internal_node(
                patricialize(obj, level + Uint(prefix_length))
            ),
        )

    branches: List[MutableMapping[Bytes, Bytes]] = []
    for _ in range(16):
        branches.append({})
    value = b""
    for key in obj:
        if len(key) == level:
            value = obj[key]
        else:
            branches[key[level]][key] = obj[key]

    subnodes = tuple(
        encode_internal_node(patricialize(branches[k], level + Uint(1)))
        for k in range(16)
    )
    return BranchNode(
        cast(BranchSubnodes, assert_type(subnodes, Tuple[Extended, ...])),
        value,
    )

```

**Things to Note:**

1. EMPTY_TRIE_ROOT:
The fundamental rule of a Merkle Tree is that the Root Hash is always the hash of its contents. If a trie is completely empty, its top-level node is effectively a null byte string: b''.

2. `secured` flag: 
Secured (State Trie / Storage Trie): If trie.secured is true, the Trie hashes the key first: `key = keccak256(preimage)`. Ethereum's main State Trie uses Ethereum Addresses (which are 20 bytes) as keys. If an attacker wanted to slow down the network, they could mine millions of addresses that share very long common prefixes (e.g., 0x0000000000...a, 0x0000000000...b). This would force the Ethereum nodes to build a highly unbalanced tree with deep paths, making reading and writing state slow. By hashing the address first, the keys are completely randomized. It ensures the Trie remains perfectly balanced no matter what addresses people create.
Unsecured (Transaction Trie / Receipts Trie): Every block also has a Trie for its transactions. The keys for these tries are simply the transaction's index in the block. Because the system sequentially dictates these index numbers, an attacker cannot manipulate them to create unbalanced trees. Therefore, hashing them would be a waste of compute power, so they use an "unsecured" Trie where the keys are the raw numbers.

3. `nibble_list_to_compact`: 
As discussed above, Ethereum tries navigate paths using "nibbles" (half-bytes, or a single hex character like a or f). However, computer storage works in full bytes (2 nibbles). If a node's path is an odd number of nibbles long (e.g., a, b, c), you can't store it as 1.5 bytes. You have to pack it into whole bytes. This function takes an array of nibbles and compresses them into bytes while adding a special "flag" nibble at the very beginning.

4. `bytes_to_nibble_list`: 
This is the exact reverse of packing. It takes standard Ethereum keys (32 bytes keccak256 hash, if secured flag is on, else the original bytes of the key) and breaks them apart into an array of individual nibbles (8 bits of the byte => 4 bits of the hex character). The Trie needs this because it builds its branches and leaves one hex character (nibble) at a time.

5. `rlp.encode(root_node)` check in `root`:
If the Trie is tiny (e.g., a test network with only one account), `encode_internal_node` returned the raw, unhashed tuple. When RLP encoded, it is less than 32 bytes. But because the block header demands a 32-byte root, we are forced to hash it here anyway just to stretch it to 32 bytes.


---

#### The Ethereum State

```python
"""
The `State` class is the in-memory implementation of `PreState` (interface for State).
It consists of a main account trie and storage tries for each contract.

There is a distinction between an account that does not exist and
`EMPTY_ACCOUNT`.
"""

from dataclasses import dataclass, field
from typing import AbstractSet, Dict, List, Optional, Protocol, Set, Tuple

from ethereum_types.bytes import Bytes, Bytes20, Bytes32
from ethereum_types.frozen import slotted_freezable
from ethereum_types.numeric import U256, Uint

from ethereum.crypto.hash import Hash32, keccak256
from ethereum.merkle_patricia_trie import (
    EMPTY_TRIE_ROOT,
    InternalNode,
    Trie,
    copy_trie,
    root,
    trie_get,
    trie_set,
)

Address = Bytes20
Root = Hash32

EMPTY_CODE_HASH = keccak256(b"")


@slotted_freezable
@dataclass
class Account:
    """
    State associated with an address.
    """

    nonce: Uint
    balance: U256
    code_hash: Hash32


EMPTY_ACCOUNT = Account(
    nonce=Uint(0),
    balance=U256(0),
    code_hash=EMPTY_CODE_HASH,
)


@dataclass
class BlockDiff:
    """
    State changes produced by executing a block.
    """

    account_changes: Dict[Address, Optional[Account]]
    """Per-address account diffs produced by execution."""

    storage_changes: Dict[Address, Dict[Bytes32, U256]]
    """Per-address storage diffs produced by execution."""

    code_changes: Dict[Hash32, Bytes]
    """New bytecodes (keyed by code hash) introduced by execution."""

    storage_clears: Set[Address] = field(default_factory=set)
    """
    Addresses whose pre-existing storage was wiped during block
    execution (via a pre-EIP-6780 `SELFDESTRUCT`). Their storage
    tries are dropped before [`storage_changes`][sc] is applied, so any
    post-wipe writes begin from empty storage.

    [sc]: ref:ethereum.state.BlockDiff.storage_changes
    """


@dataclass
class State:
    """
    Contains all information that is preserved between transactions.
    """

    _main_trie: Trie[Address, Optional[Account]] = field(
        default_factory=lambda: Trie(secured=True, default=None)
    )
    _storage_tries: Dict[Address, Trie[Bytes32, U256]] = field(
        default_factory=dict
    )
    _code_store: Dict[Hash32, Bytes] = field(
        default_factory=dict, compare=False
    )

    def get_code(self, code_hash: Hash32) -> Bytes:
        """
        Get the bytecode for a given code hash.

        Return ``b""`` for ``EMPTY_CODE_HASH``.
        """
        if code_hash == EMPTY_CODE_HASH:
            return b""
        return self._code_store[code_hash]

    def get_account_optional(self, address: Address) -> Optional[Account]:
        """
        Get the account at an address.

        Return ``None`` if there is no account at the address.
        """
        return trie_get(self._main_trie, address)

    def get_storage(self, address: Address, key: Bytes32) -> U256:
        """
        Get a storage value.

        Return ``U256(0)`` if the key has not been set.
        """
        trie = self._storage_tries.get(address)
        if trie is None:
            return U256(0)

        value = trie_get(trie, key)

        assert isinstance(value, U256)
        return value

    def account_has_storage(self, address: Address) -> bool:
        """
        Check whether an account has any storage.

        Only needed for EIP-7610.
        """
        return address in self._storage_tries

    def compute_state_root_and_trie_changes(
        self,
        account_changes: Dict[Address, Optional[Account]],
        storage_changes: Dict[Address, Dict[Bytes32, U256]],
        storage_clears: AbstractSet[Address] = frozenset(),
    ) -> Tuple[Root, List["InternalNode"]]:
        """
        Compute the state root after applying changes to the pre-state.

        ``storage_clears`` lists addresses whose pre-existing storage
        tries are dropped before ``storage_changes`` is applied, so any
        post-wipe writes begin from empty storage.

        Return the new state root together with the internal trie nodes
        that were created or modified.
        """
        main_trie = copy_trie(self._main_trie)
        storage_tries = {
            k: copy_trie(v)
            for k, v in self._storage_tries.items()
            if k not in storage_clears
        }

        for address, account in account_changes.items():
            trie_set(main_trie, address, account)

        for address, slots in storage_changes.items():
            trie = storage_tries.get(address)
            if trie is None:
                trie = Trie(secured=True, default=U256(0))
                storage_tries[address] = trie
            for key, value in slots.items():
                trie_set(trie, key, value)
            if trie._data == {}:
                del storage_tries[address]

        def get_storage_root(addr: Address) -> Root:
            if addr in storage_tries:
                return root(storage_tries[addr])
            return EMPTY_TRIE_ROOT

        state_root_value = root(main_trie, get_storage_root=get_storage_root)

        return state_root_value, []


def apply_changes_to_state(state: State, diff: BlockDiff) -> None:
    """
    Apply block-level diff to the ``State`` for the next block.

    Parameters
    ----------
    state :
        The state to update.
    diff :
        Account, storage, and code changes to apply.

    """
    for address in diff.storage_clears:
        state._storage_tries.pop(address, None)

    for address, account in diff.account_changes.items():
        trie_set(state._main_trie, address, account)

    for address, slots in diff.storage_changes.items():
        trie = state._storage_tries.get(address)
        if trie is None:
            trie = Trie(secured=True, default=U256(0))
            state._storage_tries[address] = trie
        for key, value in slots.items():
            trie_set(trie, key, value)
        if trie._data == {}:
            del state._storage_tries[address]

    state._code_store.update(diff.code_changes)




```


### Types of Transactions and All About Them

You can read about Elliptic Curve signatures and keys in the [Bitcoin article](/articles//bitcoin#wallet-address-and-2-keys).
There is no `from` field, because you can calculated it from the public key from the signature.

#### Legacy Transaction Type

The original transaction format used since Ethereum's launch.
There is no `chainId` field, so according [EIP-155](https://eips.ethereum.org/EIPS/eip-155) you would need to embed it in the `v` field.

```python
class LegacyTransaction:
    """
    Atomic operation performed on the block chain.
    """

    nonce: U256
    """
    A scalar value equal to the number of transactions sent by the sender.
    """

    gas_price: Uint
    """
    The price of gas for this transaction, in wei.
    """

    gas: Uint
    """
    The maximum amount of gas that can be used by this transaction.
    """

    to: Bytes0 | Address
    """
    The address of the recipient. If empty, the transaction is a contract
    creation.
    """

    value: U256
    """
    The amount of ether (in wei) to send with this transaction.
    """

    data: Bytes
    """
    The data payload of the transaction, which can be used to call functions
    on contracts or to create new contracts.
    """

    v: U256
    """
    The recovery id of the signature.
    """

    r: U256
    """
    The first part of the signature.
    """

    s: U256
    """
    The second part of the signature.
    """

```

---

#### Typed Transaction Envelope

Whenever protocol developers wanted to add new features to transactions—such as changing how gas fees work or adding new cryptographic features—they ran into a massive roadblock. Because the legacy format was so rigid, adding new fields meant changing the whole RLP structure, which risked breaking older client software.

After [EIP-2718](https://eips.ethereum.org/EIPS/eip-2718) new transactions are now defined simply as:

`TransactionType || TransactionPayload`
TransactionType: A single byte (between 0x00 to 0x7f) that identifies the specific format of the transaction.
TransactionPayload: An opaque byte array. How this array is decoded depends entirely on the type.

EIP-2718 safely distinguishes between new "typed" transactions and old "legacy" transactions without breaking old nodes. It all comes down to the very first byte of the transaction data:
* Legacy Transactions: Because legacy transactions are encoded as standard RLP lists, the rules of RLP dictate that the first byte of a list will always be 0xc0 or higher.
* Typed Transactions: EIP-2718 explicitly restricts the TransactionType byte to a maximum of 0x7f (127).

Receipts now follow the exact same structure: `TransactionType || ReceiptPayload`. The network mandates that the TransactionType of the receipt and the transaction must exactly match, keeping the data structures clean and predictable.

---

#### Access List Transaction Type

Has `chainId` field and also includes `access_list`. It was introduced to prevent smart contracts from breaking due to the gas increases introduced in [EIP-2929](https://eips.ethereum.org/EIPS/eip-2929).
When Berlin upgrade raised `SLOAD` from 800 to 2,100 gas, many existing deployed contracts that hardcoded gas limits suddenly threw "Out of Gas" errors and became permanently frozen. The Solution: EIP-2930 allows users to pass an explicit access list alongside the transaction. By forcing the EVM to pre-warm those addresses and slots, the runtime execution costs drop back down to safe levels, allowing old, fragile contracts to execute successfully. That is, you pay gas at the start of the transaction, pre-warm all `SLOAD` operations in the contracts this smart-contract calls and even if the gas limits are hardcoded, the transaction will still work as before.

Plus, you could save a little bit of gas on the complex enough calls.

```python
class Access:
    """
    A mapping from account address to storage slots that are pre-warmed as part
    of a transaction.
    """

    account: Address
    """
    The address of the account that is accessed.
    """

    slots: Tuple[Bytes32, ...]
    """
    A tuple of storage slots that are accessed in the account.
    """
```

```python
class AccessListTransaction:
    """
    The transaction type added in [EIP-2930] to support access lists.

    This transaction type extends the legacy transaction with an access list
    and chain ID. The access list specifies which addresses and storage slots
    the transaction will access.

    [EIP-2930]: https://eips.ethereum.org/EIPS/eip-2930
    """

    chain_id: U64
    """
    The ID of the chain on which this transaction is executed.
    """

    nonce: U256
    """
    A scalar value equal to the number of transactions sent by the sender.
    """

    gas_price: Uint
    """
    The price of gas for this transaction.
    """

    gas: Uint
    """
    The maximum amount of gas that can be used by this transaction.
    """

    to: Bytes0 | Address
    """
    The address of the recipient. If empty, the transaction is a contract
    creation.
    """

    value: U256
    """
    The amount of ether (in wei) to send with this transaction.
    """

    data: Bytes
    """
    The data payload of the transaction, which can be used to call functions
    on contracts or to create new contracts.
    """

    access_list: Tuple[Access, ...]
    """
    A tuple of `Access` objects that specify which addresses and storage slots
    are accessed in the transaction.
    """

    y_parity: U256
    """
    The recovery id of the signature.
    """

    r: U256
    """
    The first part of the signature.
    """

    s: U256
    """
    The second part of the signature.
    """
```

---

#### Fee Market Transaction Type

These transactions introduce a new fee market mechanism that improves predictability by separating the transaction fee into a base fee and a priority fee. 

Before [EIP-1559](https://eips.ethereum.org/EIPS/eip-1559), Ethereum used a simple first-price auction. You submitted a single `gasPrice`, and miners blindly picked the transactions with the highest bids. Because the mempool was highly volatile, users and wallets frequently overpaid out of fear their transaction would get stuck, leading to fee spikes and problems with UX.

1. You no longer submit a single bid. Instead, you define two caps:

`maxPriorityFeePerGas` (The Tip): The maximum amount you are willing to pay the validator directly to prioritize your transaction over others.
`maxFeePerGas` (The Cap): The absolute maximum total fee you are willing to pay (Base Fee + Tip).

2. The network itself dictates the third value:

`baseFeePerGas`: An algorithmic, mandatory fee required for a transaction to be included in a block. This fee is burned entirely, removing ETH from circulation.

**Formula**: `base_fee` = `parent_base_fee` * (1 + (`gas_used` - `gas_target`) / 8 * `gas_target`)
Where `gas_target` is half of the current block gas limit (~60 million) and 8 means the change step is 12.5%

```python
class FeeMarketTransaction:
    """
    The transaction type added in [EIP-1559].

    This transaction type introduces a new fee market mechanism with two gas
    price parameters: max_priority_fee_per_gas and max_fee_per_gas.

    [EIP-1559]: https://eips.ethereum.org/EIPS/eip-1559
    """

    chain_id: U64
    """
    The ID of the chain on which this transaction is executed.
    """

    nonce: U256
    """
    A scalar value equal to the number of transactions sent by the sender.
    """

    max_priority_fee_per_gas: Uint
    """
    The maximum priority fee per gas that the sender is willing to pay.
    """

    max_fee_per_gas: Uint
    """
    The maximum fee per gas that the sender is willing to pay, including the
    base fee and priority fee.
    """

    gas: Uint
    """
    The maximum amount of gas that can be used by this transaction.
    """

    to: Bytes0 | Address
    """
    The address of the recipient. If empty, the transaction is a contract
    creation.
    """

    value: U256
    """
    The amount of ether (in wei) to send with this transaction.
    """

    data: Bytes
    """
    The data payload of the transaction, which can be used to call functions
    on contracts or to create new contracts.
    """

    access_list: Tuple[Access, ...]
    """
    A tuple of `Access` objects that specify which addresses and storage slots
    are accessed in the transaction.
    """

    y_parity: U256
    """
    The recovery id of the signature.
    """

    r: U256
    """
    The first part of the signature.
    """

    s: U256
    """
    The second part of the signature.
    """
```

The calculation of base fee in EELS

```python
ELASTICITY_MULTIPLIER=2 # Means that the target is half of the block gas limit
BASE_FEE_MAX_CHANGE_DENOMINATOR=8 # Means that the change step is 12.5 percent


def calculate_base_fee_per_gas(
    block_gas_limit: Uint,
    parent_gas_limit: Uint,
    parent_gas_used: Uint,
    parent_base_fee_per_gas: Uint,
) -> Uint:
    """
    Calculates the base fee per gas for the block.

    Parameters
    ----------
    block_gas_limit :
        Gas limit of the block for which the base fee is being calculated.
    parent_gas_limit :
        Gas limit of the parent block.
    parent_gas_used :
        Gas used in the parent block.
    parent_base_fee_per_gas :
        Base fee per gas of the parent block.

    Returns
    -------
    base_fee_per_gas : `Uint`
        Base fee per gas for the block.

    """
    parent_gas_target = parent_gas_limit // ELASTICITY_MULTIPLIER
    if not check_gas_limit(block_gas_limit, parent_gas_limit):
        raise InvalidBlock

    if parent_gas_used == parent_gas_target:
        expected_base_fee_per_gas = parent_base_fee_per_gas
    elif parent_gas_used > parent_gas_target:
        gas_used_delta = parent_gas_used - parent_gas_target

        parent_fee_gas_delta = parent_base_fee_per_gas * gas_used_delta
        target_fee_gas_delta = parent_fee_gas_delta // parent_gas_target

        base_fee_per_gas_delta = max(
            target_fee_gas_delta // BASE_FEE_MAX_CHANGE_DENOMINATOR,
            Uint(1),
        )

        expected_base_fee_per_gas = (
            parent_base_fee_per_gas + base_fee_per_gas_delta
        )
    else:
        gas_used_delta = parent_gas_target - parent_gas_used

        parent_fee_gas_delta = parent_base_fee_per_gas * gas_used_delta
        target_fee_gas_delta = parent_fee_gas_delta // parent_gas_target

        base_fee_per_gas_delta = (
            target_fee_gas_delta // BASE_FEE_MAX_CHANGE_DENOMINATOR
        )

        expected_base_fee_per_gas = (
            parent_base_fee_per_gas - base_fee_per_gas_delta
        )

    return Uint(expected_base_fee_per_gas)
```

Approximately 60 million, because Ethereum has dynamic block gas limit from the get-go to prevent blocksize wars. In reality it always stays maximum 2-3 steps away from the 60 million.

```python
# GasCosts.LIMIT_ADJUSTMENT_FACTOR = 1024
# GasCosts.LIMIT_MINIMUM = 5000

def check_gas_limit(gas_limit: Uint, parent_gas_limit: Uint) -> bool:  
    """
    Validates the gas limit for a block.

    The bounds of the gas limit, ``max_adjustment_delta``, is set as the
    quotient of the parent block's gas limit and the``LIMIT_ADJUSTMENT_FACTOR``. 

    Parameters
    ----------
    gas_limit :
        Gas limit to validate.

    parent_gas_limit :
        Gas limit of the parent block.

    Returns
    -------
    check : `bool`
        True if gas limit constraints are satisfied, False otherwise.

    """
    max_adjustment_delta = parent_gas_limit // GasCosts.LIMIT_ADJUSTMENT_FACTOR
    if gas_limit >= parent_gas_limit + max_adjustment_delta:
        return False
    if gas_limit <= parent_gas_limit - max_adjustment_delta:
        return False
    if gas_limit < GasCosts.LIMIT_MINIMUM:
        return False

    return True
```

---

#### Blob Transaction Type

Layer 2 networks, or Rollups, work by processing thousands of transactions off-chain, bundling them into a single batch, and then posting the transaction data back to the Ethereum Layer 1 (L1) mainnet. This ensures that L2 inherits the security and decentralization of Ethereum.

Before EIP-4844, rollups had to post this data using L1 calldata. Because calldata is processed by the EVM and stored permanently on the blockchain by every full node, it is expensive.

Blobs are 128kb files, live for 4096 epochs (18 days and after that deleted) and can be any 128kb of data, but usually used by L2. But the blobs are Consensus Layer responsibility, here we only need to store the commitments thereof and validate blob_gas_price akin to EIP-1559 above.

The base fee per blob gas update rule is intended to approximate the formula `base_fee_per_blob_gas` = `BLOB_MIN_GASPRICE` * e ** (`excess_blob_gas` / `BLOB_BASE_FEE_UPDATE_FRACTION`), where `excess_blob_gas` is the total “extra” amount of blob gas that the chain has consumed relative to the “targeted” number `BLOB_TARGET_GAS_PER_BLOCK`. Like EIP-1559, it’s a self-correcting formula: as the excess goes higher, the base_fee_per_blob_gas increases exponentially, reducing usage and eventually forcing the excess back down.

The parameter `BLOB_BASE_FEE_UPDATE_FRACTION` controls the maximum rate of change of the base fee per blob gas and is ~ 1.125 per block (the same step as in transactions fee market, 12.5%).

```python
class BlobTransaction:
    """
    The transaction type added in [EIP-4844].

    This transaction type extends the fee market transaction to support
    blob-carrying transactions.

    [EIP-4844]: https://eips.ethereum.org/EIPS/eip-4844
    """

    chain_id: U64
    """
    The ID of the chain on which this transaction is executed.
    """

    nonce: U256
    """
    A scalar value equal to the number of transactions sent by the sender.
    """

    max_priority_fee_per_gas: Uint
    """
    The maximum priority fee per gas that the sender is willing to pay.
    """

    max_fee_per_gas: Uint
    """
    The maximum fee per gas that the sender is willing to pay, including the
    base fee and priority fee.
    """

    gas: Uint
    """
    The maximum amount of gas that can be used by this transaction.
    """

    to: Address
    """
    The address of the recipient. If empty, the transaction is a contract
    creation.
    """

    value: U256
    """
    The amount of ether (in wei) to send with this transaction.
    """

    data: Bytes
    """
    The data payload of the transaction, which can be used to call functions
    on contracts or to create new contracts.
    """

    access_list: Tuple[Access, ...]
    """
    A tuple of `Access` objects that specify which addresses and storage slots
    are accessed in the transaction.
    """

    max_fee_per_blob_gas: U256
    """
    The maximum fee per blob gas that the sender is willing to pay.
    """

    blob_versioned_hashes: Tuple[VersionedHash, ...]
    """
    A tuple of objects that represent the versioned hashes of the blobs
    included in the transaction.
    """

    y_parity: U256
    """
    The recovery id of the signature.
    """

    r: U256
    """
    The first part of the signature.
    """

    s: U256
    """
    The second part of the signature.
    """
```

Blobs fee market.

```python
PER_BLOB = 2**17
BLOB_SCHEDULE_TARGET = 14
BLOB_TARGET_GAS_PER_BLOCK = PER_BLOB * BLOB_SCHEDULE_TARGET
BLOB_BASE_COST = 2**13
BLOB_SCHEDULE_MAX = 21
BLOB_MIN_GASPRICE = 1
BLOB_BASE_FEE_UPDATE_FRACTION = 11684671

def calculate_excess_blob_gas(
    parent_header: Header | PreviousHeader,
) -> U64:
    """
    Calculates the excess blob gas for the current block based
    on the gas used in the parent block.

    Parameters
    ----------
    parent_header :
        The parent block of the current block.

    Returns
    -------
    excess_blob_gas: `ethereum.base_types.U64`
        The excess blob gas for the current block.

    """
    excess_blob_gas = parent_header.excess_blob_gas
    blob_gas_used = parent_header.blob_gas_used
    base_fee_per_gas = parent_header.base_fee_per_gas

    parent_blob_gas = excess_blob_gas + blob_gas_used
    if parent_blob_gas < GasCosts.BLOB_TARGET_GAS_PER_BLOCK:
        return U64(0)

    target_blob_gas_price = Uint(GasCosts.PER_BLOB)
    target_blob_gas_price *= calculate_blob_gas_price(excess_blob_gas)

    base_blob_tx_price = GasCosts.BLOB_BASE_COST * base_fee_per_gas
    if base_blob_tx_price > target_blob_gas_price:
        blob_schedule_delta = (
            GasCosts.BLOB_SCHEDULE_MAX - GasCosts.BLOB_SCHEDULE_TARGET
        )
        return (
            excess_blob_gas
            + blob_gas_used * blob_schedule_delta // GasCosts.BLOB_SCHEDULE_MAX
        )

    return parent_blob_gas - GasCosts.BLOB_TARGET_GAS_PER_BLOCK

def calculate_blob_gas_price(excess_blob_gas: U64) -> Uint:
    """
    Calculate the blob gasprice for a block.

    Parameters
    ----------
    excess_blob_gas :
        The excess blob gas for the block.

    Returns
    -------
    blob_gasprice: `Uint`
        The blob gasprice.

    """
    return taylor_exponential(
        GasCosts.BLOB_MIN_GASPRICE,
        Uint(excess_blob_gas),
        GasCosts.BLOB_BASE_FEE_UPDATE_FRACTION,
    )
```

`base_blob_tx_price > target_blob_gas_price`:
[EIP-7918](https://eips.ethereum.org/EIPS/eip-7918). If this is True, it proves that blobs aren't missing because of low demand; they are missing because L1 is too expensive. Instead of subtracting gas from the excess_blob_gas tally (which would lower the blob price), the return statement overrides the standard logic. It applies a blob_schedule_delta ratio to effectively freeze or artificially inflate the excess_blob_gas. This creates a price floor for blob gas tied to the L1 base fee. It ensures that the blob data market doesn't artificially crash just because the EVM is temporarily congested

---

#### Set Code Transaction Type

To understand [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702), you have to look at the friction that existed before it. Historically, if you wanted the advanced features of a Smart Contract Account (like batched transactions, gas paid in USDC, or social recovery), you had to deploy a brand-new smart contract wallet, abandon your old Externally Owned Account (EOA), and pay gas fees to transfer all your assets over.

EIP-7702 solves this by giving existing EOAs "superpowers." It allows a standard wallet to adopt the code of a smart contract during a transaction, without ever changing its address or migrating assets.

When a user (but the wallet in most practical cases) submits this type of transaction, the payload includes the `authorization_list`. This list contains cryptographic signatures that authorize the EOA to delegate its execution logic to a specific smart contract address.

Sounds complicated, but essentially all we do is set `code_hash` field for an account to `marker + address of a smart_contract`.
And a wallet, without creating and deploy a separate smart contract for each user, for example, now can:
1. Ask user to sign 3 actions: `transfer_nft` => `sell_nft` => `pay_fees_in_usd` (no ETH, but user has USDT)
2. Create a transaction where user is the `to` and pay the fees for it
3. Add `authorization_list` where user signed to set a (e.g. wallet's) smart contract to their account
4. Ethereum sets that address and retrieves code for that contract, which has something like `executeBatch`
5. Transaction calls `executeBatch` which checks user's signature for the actions in step 1 and executes them
6. This call is essentially a delegate call, so the code executes in the context of user's account
7. Result: user performed some actions and paid transaction fees in USDT

And you can put any logic in that smart contract. You can use different signing keys (EVM implements only a few types of elliptic curves at the moment, so the contract will likely have to implement it's own cryptography functions) and ask wallet to call your account and rotate them when you've lost them, but you still have access to the wallet.  

```python
class Authorization:
    """
    The authorization for a set code transaction.
    """

    chain_id: U256
    address: Address
    nonce: U64
    y_parity: U8
    r: U256
    s: U256
```

```python
class SetCodeTransaction:
    """
    The transaction type added in [EIP-7702].

    This transaction type allows Ethereum Externally Owned Accounts (EOAs)
    to set code on their account, enabling them to act as smart contracts.

    [EIP-7702]: https://eips.ethereum.org/EIPS/eip-7702
    """

    chain_id: U64
    """
    The ID of the chain on which this transaction is executed.
    """

    nonce: U64
    """
    A scalar value equal to the number of transactions sent by the sender.
    """

    max_priority_fee_per_gas: Uint
    """
    The maximum priority fee per gas that the sender is willing to pay.
    """

    max_fee_per_gas: Uint
    """
    The maximum fee per gas that the sender is willing to pay, including the
    base fee and priority fee.
    """

    gas: Uint
    """
    The maximum amount of gas that can be used by this transaction.
    """

    to: Address
    """
    The address of the recipient. If empty, the transaction is a contract
    creation.
    """

    value: U256
    """
    The amount of ether (in wei) to send with this transaction.
    """

    data: Bytes
    """
    The data payload of the transaction, which can be used to call functions
    on contracts or to create new contracts.
    """

    access_list: Tuple[Access, ...]
    """
    A tuple of `Access` objects that specify which addresses and storage slots
    are accessed in the transaction.
    """

    authorizations: Tuple[Authorization, ...]
    """
    A tuple of `Authorization` objects that specify what code the signer
    desires to execute in the context of their EOA.
    """

    y_parity: U256
    """
    The recovery id of the signature.
    """

    r: U256
    """
    The first part of the signature.
    """

    s: U256
    """
    The second part of the signature.
    """
```

```python
SET_CODE_TX_MAGIC = b"\x05"
EOA_DELEGATION_MARKER = b"\xef\x01\x00"
EOA_DELEGATION_MARKER_LENGTH = len(EOA_DELEGATION_MARKER)
EOA_DELEGATED_CODE_LENGTH = 23
REFUND_AUTH_PER_EXISTING_ACCOUNT = 12500
NULL_ADDRESS = hex_to_address("0x0000000000000000000000000000000000000000")


def is_valid_delegation(code: bytes) -> bool:
    """
    Whether the code is a valid delegation designation.

    Parameters
    ----------
    code: `bytes`
        The code to check.

    Returns
    -------
    valid : `bool`
        True if the code is a valid delegation designation,
        False otherwise.

    """
    if (
        len(code) == EOA_DELEGATED_CODE_LENGTH
        and code[:EOA_DELEGATION_MARKER_LENGTH] == EOA_DELEGATION_MARKER
    ):
        return True
    return False


def set_delegation(message: Message) -> U256:
    """
    Set the delegation code for the authorities in the message.

    Parameters
    ----------
    message :
        Transaction specific items.

    Returns
    -------
    refund_counter: `U256`
        Refund from authority which already exists in state.

    """
    tx_state = message.tx_env.state
    refund_counter = U256(0)
    for auth in message.tx_env.authorizations:
        if auth.chain_id not in (message.block_env.chain_id, U256(0)):
            continue

        if auth.nonce >= U64.MAX_VALUE:
            continue

        try:
            authority = recover_authority(auth)
        except InvalidSignatureError:
            continue

        message.accessed_addresses.add(authority)

        authority_account = get_account(tx_state, authority)
        authority_code = get_code(tx_state, authority_account.code_hash)

        if authority_code and not is_valid_delegation(authority_code):
            continue

        authority_nonce = authority_account.nonce
        if authority_nonce != auth.nonce:
            continue

        if account_exists(tx_state, authority):
            refund_counter += U256(
                GasCosts.AUTH_PER_EMPTY_ACCOUNT
                - REFUND_AUTH_PER_EXISTING_ACCOUNT
            )

        if auth.address == NULL_ADDRESS:
            code_to_set = b""
        else:
            code_to_set = EOA_DELEGATION_MARKER + auth.address

        set_code(tx_state, authority, code_to_set)
        increment_nonce(tx_state, authority)

    if message.code_address is None:
        raise InvalidBlock("Invalid type 4 transaction: no target")

    message.code = get_code(
        tx_state,
        get_account(tx_state, message.code_address).code_hash,
    )

    return refund_counter

```

`AUTH_PER_EMPTY_ACCOUNT`:
If user's account is non-existent, then setting the delegation costs 25000 gas. Otherwise refund 12500 gas (i.e. we took 25000 at the start of the transaction and refunded 12500 after checking and setting the delegation)


### State Tracker in EELS

It's important to understand this flow before moving on.
As we validate the block, who exactly do we ask for data? Very simple.

1. We track changes in dictionaries (e.g. accounts that changed)
2. When we need to get an account, storage or code, we look at the changes in the transaction first, then in the block we're validating, then in the chain itself. So, we always get the current state of the entity.

```python
"""
State Tracking for Block Execution.

Track state changes on top of a read-only ``PreState``.  At block end,
accumulated diffs feed into
``PreState.compute_state_root_and_trie_changes()``.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Replace the mutable ``State`` class with lightweight state trackers that
record diffs.  ``BlockState`` accumulates committed transaction
changes across a block.  ``TransactionState`` tracks in-flight changes
within a single transaction and supports copy-on-write rollback.
"""

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Callable, Dict, Optional, Set, Tuple

from ethereum_types.bytes import Bytes, Bytes32
from ethereum_types.frozen import modify
from ethereum_types.numeric import U256, Uint

from ethereum.crypto.hash import Hash32, keccak256
from ethereum.state import (
    EMPTY_ACCOUNT,
    EMPTY_CODE_HASH,
    Account,
    Address,
    BlockDiff,
    PreState,
)

if TYPE_CHECKING:
    from .block_access_lists import BlockAccessListBuilder


@dataclass
class BlockState:
    """
    Accumulate committed transaction-level changes across a block.

    Read chain: block writes -> pre_state.

    ``account_reads`` and ``storage_reads`` accumulate across all
    transactions for BAL generation.
    """

    pre_state: PreState
    account_reads: Set[Address] = field(default_factory=set)
    account_writes: Dict[Address, Optional[Account]] = field(
        default_factory=dict
    )
    storage_reads: Set[Tuple[Address, Bytes32]] = field(default_factory=set)
    storage_writes: Dict[Address, Dict[Bytes32, U256]] = field(
        default_factory=dict
    )
    code_writes: Dict[Hash32, Bytes] = field(default_factory=dict)


@dataclass
class TransactionState:
    """
    Track in-flight state changes within a single transaction.

    Read chain: tx writes -> block writes -> pre_state.

    ``storage_reads`` and ``account_reads`` are shared references
    that survive rollback (reads from failed calls still appear in the
    Block Access List).
    """

    parent: BlockState
    account_reads: Set[Address] = field(default_factory=set)
    account_writes: Dict[Address, Optional[Account]] = field(
        default_factory=dict
    )
    storage_reads: Set[Tuple[Address, Bytes32]] = field(default_factory=set)
    storage_writes: Dict[Address, Dict[Bytes32, U256]] = field(
        default_factory=dict
    )
    code_writes: Dict[Hash32, Bytes] = field(default_factory=dict)
    created_accounts: Set[Address] = field(default_factory=set)
    transient_storage: Dict[Tuple[Address, Bytes32], U256] = field(
        default_factory=dict
    )


def get_account_optional(
    tx_state: TransactionState, address: Address
) -> Optional[Account]:
    """
    Get the ``Account`` object at an address. Return ``None`` (rather than
    ``EMPTY_ACCOUNT``) if there is no account at the address.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address to look up.

    Returns
    -------
    account : ``Optional[Account]``
        Account at address.

    """
    tx_state.account_reads.add(address)
    if address in tx_state.account_writes:
        return tx_state.account_writes[address]
    if address in tx_state.parent.account_writes:
        return tx_state.parent.account_writes[address]
    return tx_state.parent.pre_state.get_account_optional(address)


def get_account(tx_state: TransactionState, address: Address) -> Account:
    """
    Get the ``Account`` object at an address. Return ``EMPTY_ACCOUNT``
    if there is no account at the address.

    Use ``get_account_optional()`` if you care about the difference
    between a non-existent account and ``EMPTY_ACCOUNT``.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address to look up.

    Returns
    -------
    account : ``Account``
        Account at address.

    """
    account = get_account_optional(tx_state, address)
    if account is None:
        return EMPTY_ACCOUNT
    else:
        return account


def get_code(tx_state: TransactionState, code_hash: Hash32) -> Bytes:
    """
    Get the bytecode for a given code hash.

    Read chain: tx code_writes -> block code_writes -> pre_state.

    Parameters
    ----------
    tx_state :
        The transaction state.
    code_hash :
        Hash of the code to look up.

    Returns
    -------
    code : ``Bytes``
        The bytecode.

    """
    if code_hash == EMPTY_CODE_HASH:
        return b""
    if code_hash in tx_state.code_writes:
        return tx_state.code_writes[code_hash]
    if code_hash in tx_state.parent.code_writes:
        return tx_state.parent.code_writes[code_hash]
    return tx_state.parent.pre_state.get_code(code_hash)


def get_storage(
    tx_state: TransactionState, address: Address, key: Bytes32
) -> U256:
    """
    Get a value at a storage key on an account. Return ``U256(0)`` if
    the storage key has not been set previously.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account.
    key :
        Key to look up.

    Returns
    -------
    value : ``U256``
        Value at the key.

    """
    tx_state.storage_reads.add((address, key))
    if address in tx_state.storage_writes:
        if key in tx_state.storage_writes[address]:
            return tx_state.storage_writes[address][key]
    if address in tx_state.parent.storage_writes:
        if key in tx_state.parent.storage_writes[address]:
            return tx_state.parent.storage_writes[address][key]
    return tx_state.parent.pre_state.get_storage(address, key)


def get_storage_original(
    tx_state: TransactionState, address: Address, key: Bytes32
) -> U256:
    """
    Get the original value in a storage slot i.e. the value before the
    current transaction began. Read from block-level writes, then
    pre_state. Return ``U256(0)`` for accounts created in the current
    transaction.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account to read the value from.
    key :
        Key of the storage slot.

    """
    if address in tx_state.created_accounts:
        return U256(0)
    if address in tx_state.parent.storage_writes:
        if key in tx_state.parent.storage_writes[address]:
            return tx_state.parent.storage_writes[address][key]
    return tx_state.parent.pre_state.get_storage(address, key)


def get_transient_storage(
    tx_state: TransactionState, address: Address, key: Bytes32
) -> U256:
    """
    Get a value at a storage key on an account from transient storage.
    Return ``U256(0)`` if the storage key has not been set previously.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account.
    key :
        Key to look up.

    Returns
    -------
    value : ``U256``
        Value at the key.

    """
    return tx_state.transient_storage.get((address, key), U256(0))


def account_exists(tx_state: TransactionState, address: Address) -> bool:
    """
    Check if an account exists in the state trie.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account that needs to be checked.

    Returns
    -------
    account_exists : ``bool``
        True if account exists in the state trie, False otherwise.

    """
    return get_account_optional(tx_state, address) is not None


def account_has_code_or_nonce(
    tx_state: TransactionState, address: Address
) -> bool:
    """
    Check if an account has non-zero nonce or non-empty code.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account that needs to be checked.

    Returns
    -------
    has_code_or_nonce : ``bool``
        True if the account has non-zero nonce or non-empty code,
        False otherwise.

    """
    account = get_account(tx_state, address)
    return account.nonce != Uint(0) or account.code_hash != EMPTY_CODE_HASH


def account_has_storage(tx_state: TransactionState, address: Address) -> bool:
    """
    Check if an account has storage.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account that needs to be checked.

    Returns
    -------
    has_storage : ``bool``
        True if the account has storage, False otherwise.

    """
    if tx_state.storage_writes.get(address):
        return True
    if tx_state.parent.storage_writes.get(address):
        return True
    return tx_state.parent.pre_state.account_has_storage(address)


def account_exists_and_is_empty(
    tx_state: TransactionState, address: Address
) -> bool:
    """
    Check if an account exists and has zero nonce, empty code and zero
    balance.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account that needs to be checked.

    Returns
    -------
    exists_and_is_empty : ``bool``
        True if an account exists and has zero nonce, empty code and
        zero balance, False otherwise.

    """
    account = get_account_optional(tx_state, address)
    return (
        account is not None
        and account.nonce == Uint(0)
        and account.code_hash == EMPTY_CODE_HASH
        and account.balance == 0
    )


def is_account_alive(tx_state: TransactionState, address: Address) -> bool:
    """
    Check whether an account is both in the state and non-empty.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account that needs to be checked.

    Returns
    -------
    is_alive : ``bool``
        True if the account is alive.

    """
    account = get_account_optional(tx_state, address)
    return account is not None and account != EMPTY_ACCOUNT


def set_account(
    tx_state: TransactionState,
    address: Address,
    account: Optional[Account],
) -> None:
    """
    Set the ``Account`` object at an address. Setting to ``None``
    deletes the account (but not its storage, see
    ``destroy_account()``).

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address to set.
    account :
        Account to set at address.

    """
    tx_state.account_writes[address] = account


def set_storage(
    tx_state: TransactionState,
    address: Address,
    key: Bytes32,
    value: U256,
) -> None:
    """
    Set a value at a storage key on an account.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account.
    key :
        Key to set.
    value :
        Value to set at the key.

    """
    assert get_account_optional(tx_state, address) is not None
    if address not in tx_state.storage_writes:
        tx_state.storage_writes[address] = {}
    tx_state.storage_writes[address][key] = value


def destroy_account(tx_state: TransactionState, address: Address) -> None:
    """
    Completely remove the account at ``address`` and all of its storage.

    This function is made available exclusively for the ``SELFDESTRUCT``
    opcode. It is expected that ``SELFDESTRUCT`` will be disabled in a
    future hardfork and this function will be removed. Only supports same
    transaction destruction.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of account to destroy.

    """
    destroy_storage(tx_state, address)
    set_account(tx_state, address, None)


def destroy_storage(tx_state: TransactionState, address: Address) -> None:
    """
    Completely remove the storage at ``address``.

    Convert storage writes to reads before deleting so that accesses
    from created-then-destroyed accounts appear in the Block Access
    List. Only supports same transaction destruction.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of account whose storage is to be deleted.

    """
    if address in tx_state.storage_writes:
        for key in tx_state.storage_writes[address]:
            tx_state.storage_reads.add((address, key))
        del tx_state.storage_writes[address]


def mark_account_created(tx_state: TransactionState, address: Address) -> None:
    """
    Mark an account as having been created in the current transaction.
    This information is used by ``get_storage_original()`` to handle an
    obscure edgecase, and to respect the constraints added to
    SELFDESTRUCT by EIP-6780.

    The marker is not removed even if the account creation reverts.
    Since the account cannot have had code prior to its creation and
    can't call ``get_storage_original()``, this is harmless.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account that has been created.

    """
    tx_state.created_accounts.add(address)


def set_transient_storage(
    tx_state: TransactionState,
    address: Address,
    key: Bytes32,
    value: U256,
) -> None:
    """
    Set a value at a storage key on an account in transient storage.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account.
    key :
        Key to set.
    value :
        Value to set at the key.

    """
    if value == U256(0):
        tx_state.transient_storage.pop((address, key), None)
    else:
        tx_state.transient_storage[(address, key)] = value


def modify_state(
    tx_state: TransactionState,
    address: Address,
    f: Callable[[Account], None],
) -> None:
    """
    Modify an ``Account`` in the state. If, after modification, the
    account exists and has zero nonce, empty code, and zero balance, it
    is destroyed.
    """
    set_account(tx_state, address, modify(get_account(tx_state, address), f))
    if account_exists_and_is_empty(tx_state, address):
        destroy_account(tx_state, address)


def move_ether(
    tx_state: TransactionState,
    sender_address: Address,
    recipient_address: Address,
    amount: U256,
) -> None:
    """
    Move funds between accounts.

    Parameters
    ----------
    tx_state :
        The transaction state.
    sender_address :
        Address of the sender.
    recipient_address :
        Address of the recipient.
    amount :
        The amount to transfer.

    """

    def reduce_sender_balance(sender: Account) -> None:
        if sender.balance < amount:
            raise AssertionError
        sender.balance -= amount

    def increase_recipient_balance(recipient: Account) -> None:
        recipient.balance += amount

    modify_state(tx_state, sender_address, reduce_sender_balance)
    modify_state(tx_state, recipient_address, increase_recipient_balance)


def create_ether(
    tx_state: TransactionState, address: Address, amount: U256
) -> None:
    """
    Add newly created ether to an account.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account to which ether is added.
    amount :
        The amount of ether to be added to the account of interest.

    """

    def increase_balance(account: Account) -> None:
        account.balance += amount

    modify_state(tx_state, address, increase_balance)


def set_account_balance(
    tx_state: TransactionState, address: Address, amount: U256
) -> None:
    """
    Set the balance of an account.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account whose balance needs to be set.
    amount :
        The amount that needs to be set in the balance.

    """

    def set_balance(account: Account) -> None:
        account.balance = amount

    modify_state(tx_state, address, set_balance)


def increment_nonce(tx_state: TransactionState, address: Address) -> None:
    """
    Increment the nonce of an account.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account whose nonce needs to be incremented.

    """

    def increase_nonce(sender: Account) -> None:
        sender.nonce += Uint(1)

    modify_state(tx_state, address, increase_nonce)


def set_code(
    tx_state: TransactionState, address: Address, code: Bytes
) -> None:
    """
    Set Account code.

    Parameters
    ----------
    tx_state :
        The transaction state.
    address :
        Address of the account whose code needs to be updated.
    code :
        The bytecode that needs to be set.

    """
    code_hash = keccak256(code)
    if code_hash != EMPTY_CODE_HASH:
        tx_state.code_writes[code_hash] = code

    def write_code_hash(sender: Account) -> None:
        sender.code_hash = code_hash

    modify_state(tx_state, address, write_code_hash)


# -- Snapshot / Rollback ---------------------------------------------------


def copy_tx_state(tx_state: TransactionState) -> TransactionState:
    """
    Create a snapshot of the transaction state for rollback.

    Deep-copy writes and transient storage.  The parent reference,
    ``created_accounts``, ``storage_reads``, and ``account_reads``
    are shared (not rolled back).

    Parameters
    ----------
    tx_state :
        The transaction state to snapshot.

    Returns
    -------
    snapshot : ``TransactionState``
        A copy of the transaction state.

    """
    return TransactionState(
        parent=tx_state.parent,
        account_writes=dict(tx_state.account_writes),
        storage_writes={
            addr: dict(slots)
            for addr, slots in tx_state.storage_writes.items()
        },
        code_writes=dict(tx_state.code_writes),
        created_accounts=tx_state.created_accounts,
        transient_storage=dict(tx_state.transient_storage),
        storage_reads=tx_state.storage_reads,
        account_reads=tx_state.account_reads,
    )


def restore_tx_state(
    tx_state: TransactionState, snapshot: TransactionState
) -> None:
    """
    Restore transaction state from a snapshot (rollback on failure).

    Parameters
    ----------
    tx_state :
        The transaction state to restore.
    snapshot :
        The snapshot to restore from.

    """
    tx_state.account_writes = snapshot.account_writes
    tx_state.storage_writes = snapshot.storage_writes
    tx_state.code_writes = snapshot.code_writes
    tx_state.transient_storage = snapshot.transient_storage


# -- Lifecycle --------------------------------------------------------------


def incorporate_tx_into_block(
    tx_state: TransactionState,
    builder: "BlockAccessListBuilder",
) -> None:
    """
    Merge transaction writes into the block state and clear for reuse.

    Update the BAL builder incrementally by diffing this transaction's
    writes against the block's cumulative state.  Merge reads and
    touches into block-level sets.

    Parameters
    ----------
    tx_state :
        The transaction state to commit.
    builder :
        The BAL builder for incremental updates.

    """
    from .block_access_lists import update_builder_from_tx

    block = tx_state.parent

    # Update BAL builder before merging writes into block state
    update_builder_from_tx(builder, tx_state)

    # Merge reads and touches into block-level sets
    block.storage_reads.update(tx_state.storage_reads)
    block.account_reads.update(tx_state.account_reads)

    # Merge cumulative writes
    for address, account in tx_state.account_writes.items():
        block.account_writes[address] = account

    for address, slots in tx_state.storage_writes.items():
        if address not in block.storage_writes:
            block.storage_writes[address] = {}
        block.storage_writes[address].update(slots)

    block.code_writes.update(tx_state.code_writes)

    tx_state.account_writes.clear()
    tx_state.storage_writes.clear()
    tx_state.code_writes.clear()
    tx_state.created_accounts.clear()
    tx_state.transient_storage.clear()
    tx_state.storage_reads = set()
    tx_state.account_reads = set()


def extract_block_diff(block_state: BlockState) -> BlockDiff:
    """
    Extract account, storage, and code diff from the block state.

    Parameters
    ----------
    block_state :
        The block state.

    Returns
    -------
    diff : `BlockDiff`
        Account, storage, and code changes accumulated during block execution.

    """
    return BlockDiff(
        account_changes=block_state.account_writes,
        storage_changes=block_state.storage_writes,
        code_changes=block_state.code_writes,
    )

```

`modify_state`:
At the end, we delete empty accounts that were possible prior to [EIP-161](https://eips.ethereum.org/EIPS/eip-161)


### Block-level Access Lists

Eliminates sequential processing bottlenecks by providing an upfront map of all transaction dependencies, setting the stage for validators to process many transactions in parallel instead of one by one
Allows nodes to update their records by reading the final results without needing to replay every transaction (executionless sync), making it much faster to sync a node to the network
Eliminates guesswork, allowing validators to pre-load all necessary data at once instead of discovering it step-by-step, which makes validation much faster
Today's Ethereum is like a single-lane road; because the network doesn't know what data a transaction will need or change (like which accounts a transaction will touch) until a transaction has been run, validators must process transactions one by one in a strict, sequential line. If they tried to process the transactions all at once, without knowing these dependencies, two transactions might accidentally try to change the exact same data at the same time, causing errors.

Block-Level Access Lists (BALs, or EIP-7928) function like a map for the network, detailing which parts of the database will be accessed before the work begins. The execution layer stores the full Block Access List, including every account change that the transactions will touch, along with the final results of those changes (all state accesses and post-execution values). To keep blocks lightweight, the block header contains a new field with a unique digital fingerprint (the hash record) of this list.

Because they give instant visibility into which transactions don't overlap, BALs allow nodes to perform parallel disk reads, fetching information for many transactions simultaneously. The network can safely group unrelated transactions and process them in parallel.

As the BAL includes the final results of transactions (the post-execution values), when the network's nodes need to sync to the network's current state, they can copy those final results to update their records. Validators no longer have to replay all the complicated transactions from scratch to know what happened, making it faster and easier for new nodes to join the network.

The parallel disk reads enabled by BALs will be a significant step toward a future where Ethereum can process many transactions at once, significantly increasing the network's speed.

```python

"""
Block access lists (BALs), originally defined in [EIP-7928], record all
accounts and storage locations accessed during block execution along with their
post-execution values.

BALs enable parallel disk reads, parallel transaction validation, parallel
state root computation, and applying state updates without executing bytecode.

See [`BlockAccessList`][bal] for more detail.

[EIP-7928]: https://eips.ethereum.org/EIPS/eip-7928
[bal]: ref:ethereum.forks.amsterdam.block_access_lists.BlockAccessList
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple, TypeAlias

from ethereum_rlp import rlp
from ethereum_types.bytes import Bytes, Bytes32
from ethereum_types.frozen import slotted_freezable
from ethereum_types.numeric import U64, U256, Uint, ulen

from ethereum.crypto.hash import Hash32, keccak256
from ethereum.state import EMPTY_CODE_HASH, Account, Address, PreState

from .exceptions import BlockAccessListGasLimitExceededError
from .fork_types import BlockAccessIndex
from .state_tracker import BlockState, TransactionState, get_code


@slotted_freezable
@dataclass
class StorageChange:
    """
    In a [`SlotChanges`][s], represents a single change in an [`Account`]'s
    storage slot.

    [s]: ref:ethereum.forks.amsterdam.block_access_lists.SlotChanges
    [`Account`]: ref:ethereum.state.Account
    """

    block_access_index: BlockAccessIndex
    """
    Position within the set of all changes in a [`Block`].

    [`Block`]: ref:ethereum.forks.amsterdam.blocks.Block
    """

    new_value: U256
    """
    Value of an [`Account`]'s storage slot after this change has been applied.

    [`Account`]: ref:ethereum.state.Account
    """


@slotted_freezable
@dataclass
class BalanceChange:
    """
    In a [`BlockAccessList`][bal], represents a change in an [`Account`]'s
    balance.

    [bal]: ref:ethereum.forks.amsterdam.block_access_lists.BlockAccessList
    [`Account`]: ref:ethereum.state.Account
    """  # noqa: E501

    block_access_index: BlockAccessIndex
    """
    Position within the set of all changes in a [`Block`].

    [`Block`]: ref:ethereum.forks.amsterdam.blocks.Block
    """

    post_balance: U256
    """
    Balance of an [`Account`] after this change has been applied.

    [`Account`]: ref:ethereum.state.Account
    """


@slotted_freezable
@dataclass
class NonceChange:
    """
    In a [`BlockAccessList`][bal], represents a change in an [`Account`]'s
    nonce.

    [bal]: ref:ethereum.forks.amsterdam.block_access_lists.BlockAccessList
    [`Account`]: ref:ethereum.state.Account
    """  # noqa: E501

    block_access_index: BlockAccessIndex
    """
    Position within the set of all changes in a [`Block`].

    [`Block`]: ref:ethereum.forks.amsterdam.blocks.Block
    """

    new_nonce: U64
    """
    Nonce of an [`Account`] after this change has been applied.

    [`Account`]: ref:ethereum.state.Account
    """


@slotted_freezable
@dataclass
class CodeChange:
    """
    In a [`BlockAccessList`][bal], represents a change in an [`Account`]'s
    code.

    [bal]: ref:ethereum.forks.amsterdam.block_access_lists.BlockAccessList
    [`Account`]: ref:ethereum.state.Account
    """  # noqa: E501

    block_access_index: BlockAccessIndex
    """
    Position within the set of all changes in a [`Block`].

    [`Block`]: ref:ethereum.forks.amsterdam.blocks.Block
    """

    new_code: Bytes
    """
    Code of an [`Account`] after this change has been applied.

    [`Account`]: ref:ethereum.state.Account
    """


@slotted_freezable
@dataclass
class SlotChanges:
    """
    In a [`BlockAccessList`][bal], represents a change in an [`Account`]'s
    storage.

    [bal]: ref:ethereum.forks.amsterdam.block_access_lists.BlockAccessList
    [`Account`]: ref:ethereum.state.Account
    """  # noqa: E501

    slot: U256
    """
    Location within an [`Account`]'s storage that has been modified.

    [`Account`]: ref:ethereum.state.Account
    """

    changes: Tuple[StorageChange, ...]
    """
    Sequence of changes that have been made to one particular storage slot.
    """


@slotted_freezable
@dataclass
class AccountChanges:
    """
    All changes for a single [`Account`], grouped by field type.

    [`Account`]: ref:ethereum.state.Account
    """

    address: Address
    """
    Address of the account containing these changes.
    """

    storage_changes: Tuple[SlotChanges, ...]
    """
    Writes to the storage of the associated [`Account`].

    [`Account`]: ref:ethereum.state.Account
    """

    storage_reads: Tuple[U256, ...]
    """
    Storage slots of the associated [`Account`] that have been read but not
    changed.

    [`Account`]: ref:ethereum.state.Account
    """

    balance_changes: Tuple[BalanceChange, ...]
    """
    Writes to the balance of the associated [`Account`].

    [`Account`]: ref:ethereum.state.Account
    """

    nonce_changes: Tuple[NonceChange, ...]
    """
    Writes to the nonce of the associated [`Account`].

    [`Account`]: ref:ethereum.state.Account
    """

    code_changes: Tuple[CodeChange, ...]
    """
    Writes to the code of the associated [`Account`].

    [`Account`]: ref:ethereum.state.Account
    """


BlockAccessList: TypeAlias = List[AccountChanges]
"""
List of state changes recorded across a [`Block`].

The hash of a block's access list is included in its [`Header`], though the
access list itself is not included in the block body.

A `BlockAccessList` includes, for example, the targets of:

- [`BALANCE`], [`EXTCODESIZE`][ecs], [`EXTCODECOPY`][ecc],
  and [`EXTCODEHASH`][ech] instructions;
- the [call family][call] of instructions _even if they revert_;
- the [create family][create] of instructions if the target is accessed;
- etc.

[`Block`]: ref:ethereum.forks.amsterdam.blocks.Block
[`Header`]: ref:ethereum.forks.amsterdam.blocks.Header
[`BALANCE`]: ref:ethereum.forks.amsterdam.vm.instructions.environment.balance
[ecs]: ref:ethereum.forks.amsterdam.vm.instructions.environment.extcodesize
[ecc]: ref:ethereum.forks.amsterdam.vm.instructions.environment.extcodecopy
[ech]: ref:ethereum.forks.amsterdam.vm.instructions.environment.extcodehash
[call]: ref:ethereum.forks.amsterdam.vm.instructions.system.call
[create]: ref:ethereum.forks.amsterdam.vm.instructions.system.create
"""


@dataclass
class AccountData:
    """
    Account data stored in the builder during block execution.

    This dataclass tracks all changes made to a single account throughout
    the execution of a block, organized by the type of change and the
    transaction index where it occurred.
    """

    storage_changes: Dict[U256, List[StorageChange]] = field(
        default_factory=dict
    )
    """
    Mapping from storage slot to list of changes made to that slot.
    Each change includes the transaction index and new value.
    """

    storage_reads: Set[U256] = field(default_factory=set)
    """
    Set of storage slots that were read but not modified.
    """

    balance_changes: List[BalanceChange] = field(default_factory=list)
    """
    List of balance changes for this account, ordered by transaction index.
    """

    nonce_changes: List[NonceChange] = field(default_factory=list)
    """
    List of nonce changes for this account, ordered by transaction index.
    """

    code_changes: List[CodeChange] = field(default_factory=list)
    """
    List of code changes (contract deployments) for this account,
    ordered by transaction index.
    """


@dataclass
class BlockAccessListBuilder:
    """
    Builder for constructing [`BlockAccessList`] efficiently during transaction
    execution.

    The builder accumulates all account and storage accesses during block
    execution and constructs a deterministic access list. Changes are tracked
    by address, field type, and transaction index to enable efficient
    reconstruction of state changes.

    The builder follows a two-phase approach:

    1. **Collection Phase**: During transaction execution, all state accesses
       are recorded via the tracking functions.
    1. **Build Phase**: After block execution, the accumulated data is sorted
       and encoded into the final deterministic format.

    [`BlockAccessList`]: ref:ethereum.forks.amsterdam.block_access_lists.BlockAccessList
    """  # noqa: E501

    block_access_index: BlockAccessIndex = BlockAccessIndex(0)
    """
    Current block access index.  Set by the caller before each
    [`incorporate_tx_into_block`] call (0 for system txs, i+1 for the
    i-th user tx, N+1 for post-execution operations).

    [`incorporate_tx_into_block`]: ref:ethereum.forks.amsterdam.state_tracker.incorporate_tx_into_block
    """  # noqa: E501

    accounts: Dict[Address, AccountData] = field(default_factory=dict)
    """
    Mapping from account address to its tracked changes during block execution.
    """


def ensure_account(builder: BlockAccessListBuilder, address: Address) -> None:
    """
    Ensure an account exists in the builder's tracking structure.

    Creates an empty [`AccountData`][ad] entry for the given address if it
    doesn't already exist. This function is idempotent and safe to call
    multiple times for the same address.

    [ad]: ref:ethereum.forks.amsterdam.block_access_lists.AccountData
    """
    if address not in builder.accounts:
        builder.accounts[address] = AccountData()


def add_storage_write(
    builder: BlockAccessListBuilder,
    address: Address,
    slot: U256,
    block_access_index: BlockAccessIndex,
    new_value: U256,
) -> None:
    """
    Add a storage write operation to the block access list.

    Records a storage slot modification for a given address at a specific
    transaction index. If multiple writes occur to the same slot within the
    same transaction (same `block_access_index`), only the final value is kept.
    """
    ensure_account(builder, address)

    if slot not in builder.accounts[address].storage_changes:
        builder.accounts[address].storage_changes[slot] = []

    # Check if there's already an entry with the same block_access_index
    # If so, update it with the new value, keeping only the final write
    changes = builder.accounts[address].storage_changes[slot]
    for i, existing_change in enumerate(changes):
        if existing_change.block_access_index == block_access_index:
            # Update the existing entry with the new value
            changes[i] = StorageChange(
                block_access_index=block_access_index, new_value=new_value
            )
            return

    # No existing entry found, append new change
    change = StorageChange(
        block_access_index=block_access_index, new_value=new_value
    )
    builder.accounts[address].storage_changes[slot].append(change)


def add_storage_read(
    builder: BlockAccessListBuilder, address: Address, slot: U256
) -> None:
    """
    Add a storage read operation to the block access list.

    Records that a storage slot was read during execution. Storage slots
    that are both read and written will only appear in the storage changes
    list, not in the storage reads list, as per [EIP-7928].
    """
    ensure_account(builder, address)
    builder.accounts[address].storage_reads.add(slot)


def add_balance_change(
    builder: BlockAccessListBuilder,
    address: Address,
    block_access_index: BlockAccessIndex,
    post_balance: U256,
) -> None:
    """
    Add a balance change to the block access list.

    Records the post-transaction balance for an account after it has been
    modified. This includes changes from transfers, gas fees, block rewards,
    and any other balance-affecting operations.
    """
    ensure_account(builder, address)

    # Balance value is already U256
    balance_value = post_balance

    # Check if we already have a balance change for this tx_index and update it
    # This ensures we only track the final balance per transaction
    existing_changes = builder.accounts[address].balance_changes
    for i, existing in enumerate(existing_changes):
        if existing.block_access_index == block_access_index:
            # Update the existing balance change with the new balance
            existing_changes[i] = BalanceChange(
                block_access_index=block_access_index,
                post_balance=balance_value,
            )
            return

    # No existing change for this tx_index, add a new one
    change = BalanceChange(
        block_access_index=block_access_index, post_balance=balance_value
    )
    builder.accounts[address].balance_changes.append(change)


def add_nonce_change(
    builder: BlockAccessListBuilder,
    address: Address,
    block_access_index: BlockAccessIndex,
    new_nonce: U64,
) -> None:
    """
    Add a nonce change to the block access list.

    Records a nonce increment for an account. This occurs when an EOA sends
    a transaction or when a contract performs [`CREATE`] or [`CREATE2`]
    operations.

    [`CREATE`]: ref:ethereum.forks.amsterdam.vm.instructions.system.create
    [`CREATE2`]: ref:ethereum.forks.amsterdam.vm.instructions.system.create2
    """
    ensure_account(builder, address)

    # Check if we already have a nonce change for this tx_index and update it
    # This ensures we only track the final (highest) nonce per transaction
    existing_changes = builder.accounts[address].nonce_changes
    for i, existing in enumerate(existing_changes):
        if existing.block_access_index == block_access_index:
            # Keep the highest nonce value
            if new_nonce > existing.new_nonce:
                existing_changes[i] = NonceChange(
                    block_access_index=block_access_index, new_nonce=new_nonce
                )
            return

    # No existing change for this tx_index, add a new one
    change = NonceChange(
        block_access_index=block_access_index, new_nonce=new_nonce
    )
    builder.accounts[address].nonce_changes.append(change)


def add_code_change(
    builder: BlockAccessListBuilder,
    address: Address,
    block_access_index: BlockAccessIndex,
    new_code: Bytes,
) -> None:
    """
    Add a code change to the block access list.

    Records contract code deployment or modification. This typically occurs
    during contract creation via [`CREATE`], [`CREATE2`], or
    [`SetCodeTransaction`][sct] operations.

    [`CREATE`]: ref:ethereum.forks.amsterdam.vm.instructions.system.create
    [`CREATE2`]: ref:ethereum.forks.amsterdam.vm.instructions.system.create2
    [sct]: ref:ethereum.forks.amsterdam.transactions.SetCodeTransaction
    """
    ensure_account(builder, address)

    # Check if we already have a code change for this block_access_index
    # This handles the case of in-transaction selfdestructs where code is
    # first deployed and then cleared in the same transaction
    existing_changes = builder.accounts[address].code_changes
    for i, existing in enumerate(existing_changes):
        if existing.block_access_index == block_access_index:
            # Replace the existing code change with the new one
            # For selfdestructs, this ensures we only record the final
            # state (empty code)
            existing_changes[i] = CodeChange(
                block_access_index=block_access_index, new_code=new_code
            )
            return

    # No existing change for this block_access_index, add a new one
    change = CodeChange(
        block_access_index=block_access_index, new_code=new_code
    )
    builder.accounts[address].code_changes.append(change)


def add_touched_account(
    builder: BlockAccessListBuilder, address: Address
) -> None:
    """
    Add an account that was accessed but not modified.

    Records that an account was accessed during execution without any state
    changes. This is used for operations like [`EXTCODEHASH`], [`BALANCE`],
    [`EXTCODESIZE`], and [`EXTCODECOPY`] that read account data without
    modifying it.

    [`EXTCODEHASH`]: ref:ethereum.forks.amsterdam.vm.instructions.environment.extcodehash
    [`BALANCE`]: ref:ethereum.forks.amsterdam.vm.instructions.environment.balance
    [`EXTCODESIZE`]: ref:ethereum.forks.amsterdam.vm.instructions.environment.extcodesize
    [`EXTCODECOPY`]: ref:ethereum.forks.amsterdam.vm.instructions.environment.extcodecopy
    """  # noqa: E501
    ensure_account(builder, address)


def _build_from_builder(
    builder: BlockAccessListBuilder,
) -> BlockAccessList:
    """
    Build the final [`BlockAccessList`] from a builder (internal helper).

    Constructs a deterministic block access list by sorting all accumulated
    changes. The resulting list is ordered by:

    1. Account addresses (lexicographically)
    2. Within each account:
       - Storage slots (lexicographically)
       - Transaction indices (numerically) for each change type

    Addresses, storage slots, and block access indices are unique.
    Storage reads that also appear in storage changes are excluded.

    [`BlockAccessList`]: ref:ethereum.forks.amsterdam.block_access_lists.BlockAccessList
    """  # noqa: E501
    block_access_list: BlockAccessList = []

    for address, changes in builder.accounts.items():
        storage_changes = []
        for slot, slot_changes in changes.storage_changes.items():
            sorted_changes = tuple(
                sorted(slot_changes, key=lambda x: x.block_access_index)
            )
            storage_changes.append(
                SlotChanges(slot=slot, changes=sorted_changes)
            )

        storage_reads = []
        for slot in changes.storage_reads:
            if slot not in changes.storage_changes:
                storage_reads.append(slot)

        balance_changes = tuple(
            sorted(changes.balance_changes, key=lambda x: x.block_access_index)
        )
        nonce_changes = tuple(
            sorted(changes.nonce_changes, key=lambda x: x.block_access_index)
        )
        code_changes = tuple(
            sorted(changes.code_changes, key=lambda x: x.block_access_index)
        )

        storage_changes.sort(key=lambda x: x.slot)
        storage_reads.sort()

        account_change = AccountChanges(
            address=address,
            storage_changes=tuple(storage_changes),
            storage_reads=tuple(storage_reads),
            balance_changes=balance_changes,
            nonce_changes=nonce_changes,
            code_changes=code_changes,
        )

        block_access_list.append(account_change)

    block_access_list.sort(key=lambda x: x.address)

    return block_access_list


def _get_pre_tx_account(
    pre_tx_accounts: Dict[Address, Optional[Account]],
    pre_state: PreState,
    address: Address,
) -> Optional[Account]:
    """
    Look up an account in cumulative state, falling back to `pre_state`.

    The cumulative account state (`pre_tx_accounts`) should contain state up
    to (but not including) the current transaction.

    Returns `None` if the `address` does not exist.
    """
    if address in pre_tx_accounts:
        return pre_tx_accounts[address]
    return pre_state.get_account_optional(address)


def _get_pre_tx_storage(
    pre_tx_storage: Dict[Address, Dict[Bytes32, U256]],
    pre_state: PreState,
    address: Address,
    key: Bytes32,
) -> U256:
    """
    Look up a storage value in cumulative state, falling back to `pre_state`.

    Returns `0` if not set.
    """
    if address in pre_tx_storage and key in pre_tx_storage[address]:
        return pre_tx_storage[address][key]
    return pre_state.get_storage(address, key)


def update_builder_from_tx(
    builder: BlockAccessListBuilder,
    tx_state: TransactionState,
) -> None:
    """
    Update the BAL builder with changes from a single transaction.

    Compare the transaction's writes against the block's cumulative
    state (falling back to `pre_state`) to extract balance, nonce, code, and
    storage changes.  Net-zero filtering is automatic: if the pre-tx value
    equals the post-tx value, no change is recorded.

    Must be called **before** the transaction's writes are merged into
    the block state.
    """
    block_state = tx_state.parent
    pre_state = block_state.pre_state
    idx = builder.block_access_index

    # Compare account writes against block cumulative state
    for address, post_account in tx_state.account_writes.items():
        pre_account = _get_pre_tx_account(
            block_state.account_writes, pre_state, address
        )

        pre_balance = pre_account.balance if pre_account else U256(0)
        post_balance = post_account.balance if post_account else U256(0)
        if pre_balance != post_balance:
            add_balance_change(builder, address, idx, post_balance)

        pre_nonce = pre_account.nonce if pre_account else Uint(0)
        post_nonce = post_account.nonce if post_account else Uint(0)
        if pre_nonce != post_nonce:
            add_nonce_change(builder, address, idx, U64(post_nonce))

        pre_code_hash = (
            pre_account.code_hash if pre_account else EMPTY_CODE_HASH
        )
        post_code_hash = (
            post_account.code_hash if post_account else EMPTY_CODE_HASH
        )
        if pre_code_hash != post_code_hash:
            post_code = get_code(tx_state, post_code_hash)
            add_code_change(builder, address, idx, post_code)

    # Compare storage writes against block cumulative state
    for address, slots in tx_state.storage_writes.items():
        for key, post_value in slots.items():
            pre_value = _get_pre_tx_storage(
                block_state.storage_writes, pre_state, address, key
            )
            if pre_value != post_value:
                # Convert slot from internal Bytes32 format to U256 for BAL.
                # EIP-7928 uses U256 as it's more space-efficient in RLP.
                u256_slot = U256.from_be_bytes(key)
                add_storage_write(builder, address, u256_slot, idx, post_value)


def build_block_access_list(
    builder: BlockAccessListBuilder,
    block_state: BlockState,
) -> BlockAccessList:
    """
    Build a [`BlockAccessList`] from the builder and block state.

    Feed accumulated reads from the block state into the builder, then produce
    the final sorted and encoded block access list.

    [`BlockAccessList`]: ref:ethereum.forks.amsterdam.block_access_lists.BlockAccessList
    """  # noqa: E501
    # Add storage reads (convert Bytes32 to U256 for BAL encoding)
    for address, slot in block_state.storage_reads:
        add_storage_read(builder, address, U256.from_be_bytes(slot))

    # Add touched addresses
    for address in block_state.account_reads:
        add_touched_account(builder, address)

    return _build_from_builder(builder)


def hash_block_access_list(
    block_access_list: BlockAccessList,
) -> Hash32:
    """
    Compute the hash of a Block Access List.
    """
    return keccak256(rlp.encode(block_access_list))


def validate_block_access_list_gas_limit(
    block_access_list: BlockAccessList,
    block_gas_limit: Uint,
) -> None:
    """
    Validate that the block access list does not exceed the gas limit.

    The total number of items (addresses + unique storage keys) must not
    exceed ``block_gas_limit // GAS_BLOCK_ACCESS_LIST_ITEM``.
    """
    from .vm.gas import GasCosts

    bal_items = Uint(0)
    for account in block_access_list:
        # Count each address as one item
        bal_items += Uint(1)

        # Collect unique storage keys across both
        # reads and writes
        unique_slots: Set[U256] = set()
        for slot_change in account.storage_changes:
            unique_slots.add(slot_change.slot)
        for slot in account.storage_reads:
            unique_slots.add(slot)

        # Count each unique storage key as one item
        bal_items += ulen(unique_slots)

    if bal_items > block_gas_limit // GasCosts.BLOCK_ACCESS_LIST_ITEM:
        raise BlockAccessListGasLimitExceededError(
            f"Block access list exceeds gas limit, {bal_items} items "
            f"exceeds limit of "
            f"{block_gas_limit // GasCosts.BLOCK_ACCESS_LIST_ITEM}."
        )

```

The code is simple: we have some dictionaries with changes for each touched account, we updated them, we put this data in specific format at the end of block verifing, encode it, hash it and put this hash in the block header or verify that the given block has correct BAL.
**Things to Note:**
1. `block_access_index` is incremented externaly at the start of transaction processing (see below)
2. `_get_pre_tx_*`: Get the account change from the previous transacions in this block, or from the chain itself

## Ethereum Virtual Machine

### Forword

#### EVM is needed because

1. Allows for an easy implemtation of gas that is taken each step, and halting the transaction if it's out of gas
1. It provides rules for what each step is and how much it costs in gas. i.e. determinism
2. It provides rules for smart contracts: what they can do and how much gas it will cost them
3. It provides rules for nodes: what they have to implement, how and how much computing resources they can spend. If your implementation costs in tear-and-wear of hardware (or it's slower, or it's less efficient) more than the rewords from block building/validating, simulating transactions, etc., nobody would use it.


---

#### Pricompiles
A set of functions that are handled by the node's software. When during the execution we call to specific, pre-defined addresses, we are not interacting with smart contracts, but rather the node's implementaions of those function. For example, 0x01 is `ecrecover`, 0x2 is `sha256` and so on. Usualy they are cryptographic ones. All of them implemented in Python you can see [here](https://github.com/ethereum/execution-specs/tree/forks/amsterdam/src/ethereum/forks/amsterdam/vm/precompiled_contracts).


### EVM Helper Functions

#### Defenitions

```python
TRANSFER_TOPIC = keccak256(b"Transfer(address,address,uint256)")
BURN_TOPIC = keccak256(b"Burn(address,uint256)")
SYSTEM_ADDRESS = Address(
    bytes.fromhex("fffffffffffffffffffffffffffffffffffffffe")
)
CALL_SUCCESS = U256(1)


@final
@dataclass
class BlockEnvironment:
    """
    Items external to the virtual machine itself, provided by the environment.
    """

    chain_id: U64
    state: BlockState
    block_gas_limit: Uint
    block_hashes: List[Hash32]
    coinbase: Address
    number: Uint
    base_fee_per_gas: Uint
    time: U256
    prev_randao: Bytes32
    excess_blob_gas: U64
    parent_beacon_block_root: Hash32
    block_access_list_builder: BlockAccessListBuilder
    slot_number: U64


@final
@dataclass
class BlockOutput:
    """
    Output from applying the block body to the present state.

    Contains the following:

    block_gas_used : `ethereum.base_types.Uint`
        Gas used for executing all transactions.
    transactions_trie : `ethereum.fork_types.Root`
        Trie of all the transactions in the block.
    receipts_trie : `ethereum.fork_types.Root`
        Trie root of all the receipts in the block.
    receipt_keys :
        Keys of all the receipts in the block.
    block_logs : `Bloom`
        Logs bloom of all the logs included in all the transactions of the
        block.
    withdrawals_trie : `ethereum.fork_types.Root`
        Trie root of all the withdrawals in the block.
    blob_gas_used : `ethereum.base_types.U64`
        Total blob gas used in the block.
    requests : `Bytes`
        Hash of all the requests in the block.
    block_access_list: `BlockAccessList`
        The block access list for the block.
    """

    block_gas_used: Uint = Uint(0)
    cumulative_gas_used: Uint = Uint(0)
    transactions_trie: Trie[Bytes, Optional[Bytes | LegacyTransaction]] = (
        field(default_factory=lambda: Trie(secured=False, default=None))
    )
    receipts_trie: Trie[Bytes, Optional[Bytes | Receipt]] = field(
        default_factory=lambda: Trie(secured=False, default=None)
    )
    receipt_keys: Tuple[Bytes, ...] = field(default_factory=tuple)
    block_logs: Tuple[Log, ...] = field(default_factory=tuple)
    withdrawals_trie: Trie[Bytes, Optional[Bytes | Withdrawal]] = field(
        default_factory=lambda: Trie(secured=False, default=None)
    )
    blob_gas_used: U64 = U64(0)
    requests: List[Bytes] = field(default_factory=list)
    block_access_list: BlockAccessList = field(default_factory=list)


@final
@dataclass
class TransactionEnvironment:
    """
    Items that are used while processing a transaction.
    """

    origin: Address
    gas_price: Uint
    gas: Uint
    access_list_addresses: Set[Address]
    access_list_storage_keys: Set[Tuple[Address, Bytes32]]
    state: TransactionState
    blob_versioned_hashes: Tuple[VersionedHash, ...]
    authorizations: Tuple[Authorization, ...]
    index_in_block: Optional[Uint]
    tx_hash: Optional[Hash32]


@final
@dataclass
class Message:
    """
    Items that are used by contract creation or message call.
    """

    block_env: BlockEnvironment
    tx_env: TransactionEnvironment
    caller: Address
    target: Bytes0 | Address
    current_target: Address
    gas: Uint
    value: U256
    data: Bytes
    code_address: Optional[Address]
    code: Bytes
    depth: Uint
    should_transfer_value: bool
    is_static: bool
    accessed_addresses: Set[Address]
    accessed_storage_keys: Set[Tuple[Address, Bytes32]]
    disable_precompiles: bool
    parent_evm: Optional["Evm"]


@final
@dataclass
class Evm:
    """The internal state of the virtual machine."""

    pc: Uint
    stack: List[U256]
    memory: bytearray
    code: Bytes
    gas_left: Uint
    valid_jump_destinations: Set[Uint]
    logs: Tuple[Log, ...]
    refund_counter: int
    running: bool
    message: Message
    output: Bytes
    accounts_to_delete: Set[Address]
    return_data: Bytes
    error: Optional[EthereumException]
    accessed_addresses: Set[Address]
    accessed_storage_keys: Set[Tuple[Address, Bytes32]]


def incorporate_child_on_success(evm: Evm, child_evm: Evm) -> None:
    """
    Incorporate the state of a successful `child_evm` into the parent `evm`.

    Parameters
    ----------
    evm :
        The parent `EVM`.
    child_evm :
        The child evm to incorporate.

    """
    evm.gas_left += child_evm.gas_left
    evm.logs += child_evm.logs
    evm.refund_counter += child_evm.refund_counter
    evm.accounts_to_delete.update(child_evm.accounts_to_delete)
    evm.accessed_addresses.update(child_evm.accessed_addresses)
    evm.accessed_storage_keys.update(child_evm.accessed_storage_keys)


def incorporate_child_on_error(evm: Evm, child_evm: Evm) -> None:
    """
    Incorporate the state of an unsuccessful `child_evm` into the parent `evm`.

    Parameters
    ----------
    evm :
        The parent `EVM`.
    child_evm :
        The child evm to incorporate.

    """
    evm.gas_left += child_evm.gas_left
```

---

#### Address and Message
```python
"""
Ethereum Virtual Machine (EVM).

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

The abstract computer which runs the code stored in an
`.fork_types.Account`.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Set, Tuple

from ethereum_types.bytes import Bytes, Bytes0, Bytes32
from ethereum_types.numeric import U64, U256, Uint

from ethereum.crypto.hash import Hash32, keccak256
from ethereum.exceptions import EthereumException
from ethereum.merkle_patricia_trie import Trie
from ethereum.state import Address
from ethereum.utils.byte import left_pad_zero_bytes

from ..block_access_lists import BlockAccessList, BlockAccessListBuilder
from ..blocks import Log, Receipt, Withdrawal
from ..fork_types import Authorization, VersionedHash
from ..state_tracker import BlockState, TransactionState
from ..transactions import LegacyTransaction

__all__ = ("Environment", "Evm", "Message")
TRANSFER_TOPIC = keccak256(b"Transfer(address,address,uint256)")
BURN_TOPIC = keccak256(b"Burn(address,uint256)")
SYSTEM_ADDRESS = Address(
    bytes.fromhex("fffffffffffffffffffffffffffffffffffffffe")
)
CALL_SUCCESS = U256(1)


@dataclass
class BlockEnvironment:
    """
    Items external to the virtual machine itself, provided by the environment.
    """

    chain_id: U64
    state: BlockState
    block_gas_limit: Uint
    block_hashes: List[Hash32]
    coinbase: Address
    number: Uint
    base_fee_per_gas: Uint
    time: U256
    prev_randao: Bytes32
    excess_blob_gas: U64
    parent_beacon_block_root: Hash32
    block_access_list_builder: BlockAccessListBuilder
    slot_number: U64


@dataclass
class BlockOutput:
    """
    Output from applying the block body to the present state.

    Contains the following:

    block_gas_used : `ethereum.base_types.Uint`
        Gas used for executing all transactions.
    cumulative_gas_used: `ethereum.base_types.Uint`
        Total gas used in the block up to and including this transaction.
        This is the gas used after refunds.
    transactions_trie : `ethereum.fork_types.Root`
        Trie of all the transactions in the block.
    receipts_trie : `ethereum.fork_types.Root`
        Trie root of all the receipts in the block.
    receipt_keys :
        Keys of all the receipts in the block.
    block_logs : `Bloom`
        Logs bloom of all the logs included in all the transactions of the
        block.
    withdrawals_trie : `ethereum.fork_types.Root`
        Trie root of all the withdrawals in the block.
    blob_gas_used : `ethereum.base_types.U64`
        Total blob gas used in the block.
    requests : `Bytes`
        Hash of all the requests in the block.
    block_access_list: `BlockAccessList`
        The block access list for the block.
    """

    block_gas_used: Uint = Uint(0)
    cumulative_gas_used: Uint = Uint(0)
    transactions_trie: Trie[Bytes, Optional[Bytes | LegacyTransaction]] = (
        field(default_factory=lambda: Trie(secured=False, default=None))
    )
    receipts_trie: Trie[Bytes, Optional[Bytes | Receipt]] = field(
        default_factory=lambda: Trie(secured=False, default=None)
    )
    receipt_keys: Tuple[Bytes, ...] = field(default_factory=tuple)
    block_logs: Tuple[Log, ...] = field(default_factory=tuple)
    withdrawals_trie: Trie[Bytes, Optional[Bytes | Withdrawal]] = field(
        default_factory=lambda: Trie(secured=False, default=None)
    )
    blob_gas_used: U64 = U64(0)
    requests: List[Bytes] = field(default_factory=list)
    block_access_list: BlockAccessList = field(default_factory=list)


@dataclass
class TransactionEnvironment:
    """
    Items that are used by contract creation or message call.
    """

    origin: Address
    gas_price: Uint
    gas: Uint
    access_list_addresses: Set[Address]
    access_list_storage_keys: Set[Tuple[Address, Bytes32]]
    state: TransactionState
    blob_versioned_hashes: Tuple[VersionedHash, ...]
    authorizations: Tuple[Authorization, ...]
    index_in_block: Optional[Uint]
    tx_hash: Optional[Hash32]


@dataclass
class Message:
    """
    Items that are used by contract creation or message call.
    """

    block_env: BlockEnvironment
    tx_env: TransactionEnvironment
    caller: Address
    target: Bytes0 | Address
    current_target: Address
    gas: Uint
    value: U256
    data: Bytes
    code_address: Optional[Address]
    code: Bytes
    depth: Uint
    should_transfer_value: bool
    is_static: bool
    accessed_addresses: Set[Address]
    accessed_storage_keys: Set[Tuple[Address, Bytes32]]
    disable_precompiles: bool
    parent_evm: Optional["Evm"]


@dataclass
class Evm:
    """The internal state of the virtual machine."""

    pc: Uint
    stack: List[U256]
    memory: bytearray
    code: Bytes
    gas_left: Uint
    valid_jump_destinations: Set[Uint]
    logs: Tuple[Log, ...]
    refund_counter: int
    running: bool
    message: Message
    output: Bytes
    accounts_to_delete: Set[Address]
    return_data: Bytes
    error: Optional[EthereumException]
    accessed_addresses: Set[Address]
    accessed_storage_keys: Set[Tuple[Address, Bytes32]]


def incorporate_child_on_success(evm: Evm, child_evm: Evm) -> None:
    """
    Incorporate the state of a successful `child_evm` into the parent `evm`.

    Parameters
    ----------
    evm :
        The parent `EVM`.
    child_evm :
        The child evm to incorporate.

    """
    evm.gas_left += child_evm.gas_left
    evm.logs += child_evm.logs
    evm.refund_counter += child_evm.refund_counter
    evm.accounts_to_delete.update(child_evm.accounts_to_delete)
    evm.accessed_addresses.update(child_evm.accessed_addresses)
    evm.accessed_storage_keys.update(child_evm.accessed_storage_keys)


def incorporate_child_on_error(evm: Evm, child_evm: Evm) -> None:
    """
    Incorporate the state of an unsuccessful `child_evm` into the parent `evm`.

    Parameters
    ----------
    evm :
        The parent `EVM`.
    child_evm :
        The child evm to incorporate.

    """
    evm.gas_left += child_evm.gas_left


def emit_transfer_log(
    evm: Evm,
    sender: Address,
    recipient: Address,
    transfer_amount: U256,
) -> None:
    """
    Emit a LOG3 for all ETH transfers satisfying EIP-7708.

    Parameters
    ----------
    evm :
        The state of the ethereum virtual machine
    sender :
        The account address sending the transfer
    recipient :
        The account address receiving the transfer
    transfer_amount :
        The amount of ETH transacted

    """
    if transfer_amount == 0:
        return

    padded_sender = left_pad_zero_bytes(sender, 32)
    padded_recipient = left_pad_zero_bytes(recipient, 32)
    log_entry = Log(
        address=SYSTEM_ADDRESS,
        topics=(
            TRANSFER_TOPIC,
            Hash32(padded_sender),
            Hash32(padded_recipient),
        ),
        data=transfer_amount.to_be_bytes32(),
    )

    evm.logs = evm.logs + (log_entry,)


def emit_burn_log(
    evm: Evm,
    account: Address,
    amount: U256,
) -> None:
    """
    Emit a LOG2 for ETH burn per EIP-7708.

    Parameters
    ----------
    evm :
        The state of the ethereum virtual machine
    account :
        The account address whose ETH is being burned
    amount :
        The amount of ETH being burned

    """
    if amount == 0:
        return

    padded_account = left_pad_zero_bytes(account, 32)
    log_entry = Log(
        address=SYSTEM_ADDRESS,
        topics=(
            BURN_TOPIC,
            Hash32(padded_account),
        ),
        data=amount.to_be_bytes32(),
    )

    evm.logs = evm.logs + (log_entry,)

```

```python
"""
Hardfork Utility Functions For Addresses.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Address specific functions used in this amsterdam version of
specification.
"""

from ethereum_rlp import rlp
from ethereum_types.bytes import Bytes, Bytes32
from ethereum_types.numeric import U256, Uint

from ethereum.crypto.hash import keccak256
from ethereum.state import Address
from ethereum.utils.byte import left_pad_zero_bytes


def to_address_masked(data: Uint | U256) -> Address:
    """
    Convert a Uint or U256 value to a valid address (20 bytes).

    Parameters
    ----------
    data :
        The numeric value to be converted to address.

    Returns
    -------
    address : `Address`
        The obtained address.

    """
    return Address(data.to_be_bytes32()[-20:])


def compute_contract_address(address: Address, nonce: Uint) -> Address:
    """
    Computes address of the new account that needs to be created.

    Parameters
    ----------
    address :
        The address of the account that wants to create the new account.
    nonce :
        The transaction count of the account that wants to create the new
        account.

    Returns
    -------
    address: `Address`
        The computed address of the new account.

    """
    computed_address = keccak256(rlp.encode([address, nonce]))
    canonical_address = computed_address[-20:]
    padded_address = left_pad_zero_bytes(canonical_address, 20)
    return Address(padded_address)


def compute_create2_contract_address(
    address: Address, salt: Bytes32, call_data: Bytes
) -> Address:
    """
    Computes address of the new account that needs to be created, which is
    based on the sender address, salt and the call data as well.

    Parameters
    ----------
    address :
        The address of the account that wants to create the new account.
    salt :
        Address generation salt.
    call_data :
        The code of the new account which is to be created.

    Returns
    -------
    address: `ethereum.forks.amsterdam.fork_types.Address`
        The computed address of the new account.

    """
    preimage = b"\xff" + address + salt + keccak256(call_data)
    computed_address = keccak256(preimage)
    canonical_address = computed_address[-20:]
    padded_address = left_pad_zero_bytes(canonical_address, 20)

    return Address(padded_address)

```

```python
"""
Hardfork Utility Functions For The Message Data-structure.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Message specific functions used in this amsterdam version of
specification.
"""

from ethereum_types.bytes import Bytes, Bytes0
from ethereum_types.numeric import Uint

from ethereum.state import Address

from ..state_tracker import get_account, get_code
from ..transactions import Transaction
from ..vm import BlockEnvironment, Message, TransactionEnvironment
from ..vm.precompiled_contracts.mapping import PRE_COMPILED_CONTRACTS
from .address import compute_contract_address


def prepare_message(
    block_env: BlockEnvironment,
    tx_env: TransactionEnvironment,
    tx: Transaction,
) -> Message:
    """
    Execute a transaction against the provided environment.

    Parameters
    ----------
    block_env :
        Environment for the Ethereum Virtual Machine.
    tx_env :
        Environment for the transaction.
    tx :
        Transaction to be executed.

    Returns
    -------
    message: `ethereum.forks.amsterdam.vm.Message`
        Items containing contract creation or message call specific data.

    """
    accessed_addresses = set()
    accessed_addresses.add(tx_env.origin)
    accessed_addresses.update(PRE_COMPILED_CONTRACTS.keys())
    accessed_addresses.update(tx_env.access_list_addresses)

    if isinstance(tx.to, Bytes0):
        current_target = compute_contract_address(
            tx_env.origin,
            get_account(tx_env.state, tx_env.origin).nonce - Uint(1),
        )
        msg_data = Bytes(b"")
        code = tx.data
        code_address = None
    elif isinstance(tx.to, Address):
        current_target = tx.to
        msg_data = tx.data
        code = get_code(
            tx_env.state, get_account(tx_env.state, tx.to).code_hash
        )
        code_address = tx.to
    else:
        raise AssertionError("Target must be address or empty bytes")

    accessed_addresses.add(current_target)

    return Message(
        block_env=block_env,
        tx_env=tx_env,
        caller=tx_env.origin,
        target=tx.to,
        gas=tx_env.gas,
        value=tx.value,
        data=msg_data,
        code=code,
        depth=Uint(0),
        current_target=current_target,
        code_address=code_address,
        should_transfer_value=True,
        is_static=False,
        accessed_addresses=accessed_addresses,
        accessed_storage_keys=set(tx_env.access_list_storage_keys),
        disable_precompiles=False,
        parent_evm=None,
    )

```

`get_account(tx_env.state, tx_env.origin).nonce - Uint(1)`:
-1, because we increment the nonce before calling EVM

---

#### Gas

```python
"""
Ethereum Virtual Machine (EVM) Gas.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

EVM gas constants and calculators.
"""

from dataclasses import dataclass
from typing import Final, List, Tuple

from ethereum_types.numeric import U64, U256, Uint, ulen

from ethereum.forks.bpo5.blocks import Header as PreviousHeader
from ethereum.trace import GasAndRefund, evm_trace
from ethereum.utils.numeric import ceil32, taylor_exponential

from ..blocks import Header
from ..transactions import BlobTransaction, Transaction
from . import Evm
from .exceptions import OutOfGasError


# These values may be patched at runtime by a future gas repricing utility
class GasCosts:
    """
    Constant gas values for the EVM.
    """

    # Tiers
    BASE: Final[Uint] = Uint(2)
    VERY_LOW: Final[Uint] = Uint(3)
    LOW: Final[Uint] = Uint(5)
    MID: Final[Uint] = Uint(8)
    HIGH: Final[Uint] = Uint(10)

    # Access
    WARM_ACCESS: Final[Uint] = Uint(100)
    COLD_ACCOUNT_ACCESS: Final[Uint] = Uint(2600)
    COLD_STORAGE_ACCESS: Final[Uint] = Uint(2100)

    # Storage
    STORAGE_SET: Final[Uint] = Uint(20000)
    COLD_STORAGE_WRITE: Final[Uint] = Uint(5000)

    # Call
    CALL_VALUE: Final[Uint] = Uint(9000)
    CALL_STIPEND: Final[Uint] = Uint(2300)
    NEW_ACCOUNT: Final[Uint] = Uint(25000)

    # Contract Creation
    CODE_DEPOSIT_PER_BYTE: Final[Uint] = Uint(200)
    CODE_INIT_PER_WORD: Final[Uint] = Uint(2)

    # Authorization
    AUTH_PER_EMPTY_ACCOUNT: Final[int] = 25000

    # Utility
    ZERO: Final[Uint] = Uint(0)
    MEMORY_PER_WORD: Final[Uint] = Uint(3)
    FAST_STEP: Final[Uint] = Uint(5)

    # Refunds
    REFUND_STORAGE_CLEAR: Final[int] = 4800

    # Precompiles
    PRECOMPILE_ECRECOVER: Final[Uint] = Uint(3000)
    PRECOMPILE_P256VERIFY: Final[Uint] = Uint(6900)
    PRECOMPILE_SHA256_BASE: Final[Uint] = Uint(60)
    PRECOMPILE_SHA256_PER_WORD: Final[Uint] = Uint(12)
    PRECOMPILE_RIPEMD160_BASE: Final[Uint] = Uint(600)
    PRECOMPILE_RIPEMD160_PER_WORD: Final[Uint] = Uint(120)
    PRECOMPILE_IDENTITY_BASE: Final[Uint] = Uint(15)
    PRECOMPILE_IDENTITY_PER_WORD: Final[Uint] = Uint(3)
    PRECOMPILE_BLAKE2F_PER_ROUND: Final[Uint] = Uint(1)
    PRECOMPILE_POINT_EVALUATION: Final[Uint] = Uint(50000)
    PRECOMPILE_BLS_G1ADD: Final[Uint] = Uint(375)
    PRECOMPILE_BLS_G1MUL: Final[Uint] = Uint(12000)
    PRECOMPILE_BLS_G1MAP: Final[Uint] = Uint(5500)
    PRECOMPILE_BLS_G2ADD: Final[Uint] = Uint(600)
    PRECOMPILE_BLS_G2MUL: Final[Uint] = Uint(22500)
    PRECOMPILE_BLS_G2MAP: Final[Uint] = Uint(23800)
    PRECOMPILE_ECADD: Final[Uint] = Uint(150)
    PRECOMPILE_ECMUL: Final[Uint] = Uint(6000)
    PRECOMPILE_ECPAIRING_BASE: Final[Uint] = Uint(45000)
    PRECOMPILE_ECPAIRING_PER_POINT: Final[Uint] = Uint(34000)

    # Blobs
    PER_BLOB: Final[U64] = U64(2**17)
    BLOB_SCHEDULE_TARGET: Final[U64] = U64(14)
    BLOB_TARGET_GAS_PER_BLOCK: Final[U64] = PER_BLOB * BLOB_SCHEDULE_TARGET
    BLOB_BASE_COST: Final[Uint] = Uint(2**13)
    BLOB_SCHEDULE_MAX: Final[U64] = U64(21)
    BLOB_MIN_GASPRICE: Final[Uint] = Uint(1)
    BLOB_BASE_FEE_UPDATE_FRACTION: Final[Uint] = Uint(11684671)

    # Block Access Lists
    BLOCK_ACCESS_LIST_ITEM: Final[Uint] = Uint(2000)

    # Transactions
    TX_BASE: Final[Uint] = Uint(21000)
    TX_CREATE: Final[Uint] = Uint(32000)
    TX_DATA_TOKEN_STANDARD: Final[Uint] = Uint(4)
    TX_DATA_TOKEN_FLOOR: Final[Uint] = Uint(16)
    TX_ACCESS_LIST_ADDRESS: Final[Uint] = Uint(2400)
    TX_ACCESS_LIST_STORAGE_KEY: Final[Uint] = Uint(1900)

    # Block
    LIMIT_ADJUSTMENT_FACTOR: Final[Uint] = Uint(1024)
    LIMIT_MINIMUM: Final[Uint] = Uint(5000)

    # Static Opcodes
    OPCODE_ADD: Final[Uint] = VERY_LOW
    OPCODE_SUB: Final[Uint] = VERY_LOW
    OPCODE_MUL: Final[Uint] = LOW
    OPCODE_DIV: Final[Uint] = LOW
    OPCODE_SDIV: Final[Uint] = LOW
    OPCODE_MOD: Final[Uint] = LOW
    OPCODE_SMOD: Final[Uint] = LOW
    OPCODE_ADDMOD: Final[Uint] = MID
    OPCODE_MULMOD: Final[Uint] = MID
    OPCODE_SIGNEXTEND: Final[Uint] = LOW
    OPCODE_LT: Final[Uint] = VERY_LOW
    OPCODE_GT: Final[Uint] = VERY_LOW
    OPCODE_SLT: Final[Uint] = VERY_LOW
    OPCODE_SGT: Final[Uint] = VERY_LOW
    OPCODE_EQ: Final[Uint] = VERY_LOW
    OPCODE_ISZERO: Final[Uint] = VERY_LOW
    OPCODE_AND: Final[Uint] = VERY_LOW
    OPCODE_OR: Final[Uint] = VERY_LOW
    OPCODE_XOR: Final[Uint] = VERY_LOW
    OPCODE_NOT: Final[Uint] = VERY_LOW
    OPCODE_BYTE: Final[Uint] = VERY_LOW
    OPCODE_SHL: Final[Uint] = VERY_LOW
    OPCODE_SHR: Final[Uint] = VERY_LOW
    OPCODE_SAR: Final[Uint] = VERY_LOW
    OPCODE_CLZ: Final[Uint] = LOW
    OPCODE_JUMP: Final[Uint] = MID
    OPCODE_JUMPI: Final[Uint] = HIGH
    OPCODE_JUMPDEST: Final[Uint] = Uint(1)
    OPCODE_CALLDATALOAD: Final[Uint] = VERY_LOW
    OPCODE_BLOCKHASH: Final[Uint] = Uint(20)
    OPCODE_COINBASE: Final[Uint] = BASE
    OPCODE_POP: Final[Uint] = BASE
    OPCODE_MSIZE: Final[Uint] = BASE
    OPCODE_PC: Final[Uint] = BASE
    OPCODE_GAS: Final[Uint] = BASE
    OPCODE_ADDRESS: Final[Uint] = BASE
    OPCODE_ORIGIN: Final[Uint] = BASE
    OPCODE_CALLER: Final[Uint] = BASE
    OPCODE_CALLVALUE: Final[Uint] = BASE
    OPCODE_CALLDATASIZE: Final[Uint] = BASE
    OPCODE_CODESIZE: Final[Uint] = BASE
    OPCODE_GASPRICE: Final[Uint] = BASE
    OPCODE_TIMESTAMP: Final[Uint] = BASE
    OPCODE_NUMBER: Final[Uint] = BASE
    OPCODE_GASLIMIT: Final[Uint] = BASE
    OPCODE_PREVRANDAO: Final[Uint] = BASE
    OPCODE_RETURNDATASIZE: Final[Uint] = BASE
    OPCODE_CHAINID: Final[Uint] = BASE
    OPCODE_BASEFEE: Final[Uint] = BASE
    OPCODE_BLOBBASEFEE: Final[Uint] = BASE
    OPCODE_SLOTNUM: Final[Uint] = BASE
    OPCODE_BLOBHASH: Final[Uint] = Uint(3)
    OPCODE_PUSH: Final[Uint] = VERY_LOW
    OPCODE_PUSH0: Final[Uint] = BASE
    OPCODE_DUP: Final[Uint] = VERY_LOW
    OPCODE_SWAP: Final[Uint] = VERY_LOW
    OPCODE_DUPN: Final[Uint] = VERY_LOW
    OPCODE_SWAPN: Final[Uint] = VERY_LOW
    OPCODE_EXCHANGE: Final[Uint] = VERY_LOW

    # Dynamic Opcode Components
    OPCODE_RETURNDATACOPY_BASE: Final[Uint] = VERY_LOW
    OPCODE_RETURNDATACOPY_PER_WORD: Final[Uint] = Uint(3)
    OPCODE_CALLDATACOPY_BASE: Final[Uint] = VERY_LOW
    OPCODE_CODECOPY_BASE: Final[Uint] = VERY_LOW
    OPCODE_MCOPY_BASE: Final[Uint] = VERY_LOW
    OPCODE_MLOAD_BASE: Final[Uint] = VERY_LOW
    OPCODE_MSTORE_BASE: Final[Uint] = VERY_LOW
    OPCODE_MSTORE8_BASE: Final[Uint] = VERY_LOW
    OPCODE_COPY_PER_WORD: Final[Uint] = Uint(3)
    OPCODE_CREATE_BASE: Final[Uint] = Uint(32000)
    OPCODE_EXP_BASE: Final[Uint] = Uint(10)
    OPCODE_EXP_PER_BYTE: Final[Uint] = Uint(50)
    OPCODE_KECCAK256_BASE: Final[Uint] = Uint(30)
    OPCODE_KECCAK256_PER_WORD: Final[Uint] = Uint(6)
    OPCODE_LOG_BASE: Final[Uint] = Uint(375)
    OPCODE_LOG_DATA_PER_BYTE: Final[Uint] = Uint(8)
    OPCODE_LOG_TOPIC: Final[Uint] = Uint(375)
    OPCODE_SELFDESTRUCT_BASE: Final[Uint] = Uint(5000)
    OPCODE_SELFDESTRUCT_NEW_ACCOUNT: Final[Uint] = Uint(25000)


@dataclass
class ExtendMemory:
    """
    Define the parameters for memory extension in opcodes.

    `cost`: `ethereum.base_types.Uint`
        The gas required to perform the extension
    `expand_by`: `ethereum.base_types.Uint`
        The size by which the memory will be extended
    """

    cost: Uint
    expand_by: Uint


@dataclass
class MessageCallGas:
    """
    Define the gas cost and gas given to the sub-call for executing the call
    opcodes.

    `cost`: `ethereum.base_types.Uint`
        The gas required to execute the call opcode, excludes
        memory expansion costs.
    `sub_call`: `ethereum.base_types.Uint`
        The portion of gas available to sub-calls that is refundable
        if not consumed.
    """

    cost: Uint
    sub_call: Uint


def check_gas(evm: Evm, amount: Uint) -> None:
    """
    Checks if `amount` gas is available without charging it.
    Raises OutOfGasError if insufficient gas.

    Parameters
    ----------
    evm :
        The current EVM.
    amount :
        The amount of gas to check.

    """
    if evm.gas_left < amount:
        raise OutOfGasError


def charge_gas(evm: Evm, amount: Uint) -> None:
    """
    Subtracts `amount` from `evm.gas_left`.

    Parameters
    ----------
    evm :
        The current EVM.
    amount :
        The amount of gas the current operation requires.

    """
    evm_trace(evm, GasAndRefund(int(amount)))

    if evm.gas_left < amount:
        raise OutOfGasError
    else:
        evm.gas_left -= amount


def calculate_memory_gas_cost(size_in_bytes: Uint) -> Uint:
    """
    Calculates the gas cost for allocating memory
    to the smallest multiple of 32 bytes,
    such that the allocated size is at least as big as the given size.

    Parameters
    ----------
    size_in_bytes :
        The size of the data in bytes.

    Returns
    -------
    total_gas_cost : `ethereum.base_types.Uint`
        The gas cost for storing data in memory.

    """
    size_in_words = ceil32(size_in_bytes) // Uint(32)
    linear_cost = size_in_words * GasCosts.MEMORY_PER_WORD
    quadratic_cost = size_in_words ** Uint(2) // Uint(512)
    total_gas_cost = linear_cost + quadratic_cost
    try:
        return total_gas_cost
    except ValueError as e:
        raise OutOfGasError from e


def calculate_gas_extend_memory(
    memory: bytearray, extensions: List[Tuple[U256, U256]]
) -> ExtendMemory:
    """
    Calculates the gas amount to extend memory.

    Parameters
    ----------
    memory :
        Memory contents of the EVM.
    extensions:
        List of extensions to be made to the memory.
        Consists of a tuple of start position and size.

    Returns
    -------
    extend_memory: `ExtendMemory`

    """
    size_to_extend = Uint(0)
    to_be_paid = Uint(0)
    current_size = ulen(memory)
    for start_position, size in extensions:
        if size == 0:
            continue
        before_size = ceil32(current_size)
        after_size = ceil32(Uint(start_position) + Uint(size))
        if after_size <= before_size:
            continue

        size_to_extend += after_size - before_size
        already_paid = calculate_memory_gas_cost(before_size)
        total_cost = calculate_memory_gas_cost(after_size)
        to_be_paid += total_cost - already_paid

        current_size = after_size

    return ExtendMemory(to_be_paid, size_to_extend)


def calculate_message_call_gas(
    value: U256,
    gas: Uint,
    gas_left: Uint,
    memory_cost: Uint,
    extra_gas: Uint,
    call_stipend: Uint = GasCosts.CALL_STIPEND,
) -> MessageCallGas:
    """
    Calculates the MessageCallGas (cost and gas made available to the sub-call)
    for executing call Opcodes.

    Parameters
    ----------
    value:
        The amount of `ETH` that needs to be transferred.
    gas :
        The amount of gas provided to the message-call.
    gas_left :
        The amount of gas left in the current frame.
    memory_cost :
        The amount needed to extend the memory in the current frame.
    extra_gas :
        The amount of gas needed for transferring value + creating a new
        account inside a message call.
    call_stipend :
        The amount of stipend provided to a message call to execute code while
        transferring value (ETH).

    Returns
    -------
    message_call_gas: `MessageCallGas`

    """
    call_stipend = Uint(0) if value == 0 else call_stipend
    if gas_left < extra_gas + memory_cost:
        return MessageCallGas(gas + extra_gas, gas + call_stipend)

    gas = min(gas, max_message_call_gas(gas_left - memory_cost - extra_gas))

    return MessageCallGas(gas + extra_gas, gas + call_stipend)


def max_message_call_gas(gas: Uint) -> Uint:
    """
    Calculates the maximum gas that is allowed for making a message call.

    Parameters
    ----------
    gas :
        The amount of gas provided to the message-call.

    Returns
    -------
    max_allowed_message_call_gas: `ethereum.base_types.Uint`
        The maximum gas allowed for making the message-call.

    """
    return gas - (gas // Uint(64))


def init_code_cost(init_code_length: Uint) -> Uint:
    """
    Calculates the gas to be charged for the init code in CREATE*
    opcodes as well as create transactions.

    Parameters
    ----------
    init_code_length :
        The length of the init code provided to the opcode
        or a create transaction

    Returns
    -------
    init_code_gas: `ethereum.base_types.Uint`
        The gas to be charged for the init code.

    """
    return GasCosts.CODE_INIT_PER_WORD * ceil32(init_code_length) // Uint(32)
```

`calculate_memory_gas_cost`:
If memory allocation strictly cost 3 gas per word, the cost would scale linearly. An attacker could write a contract that allocates massive arrays. If the block gas limit is 60 million gas, an attacker could afford to allocate ~20 million words of memory in a single transaction. 20 million words * 32 bytes/word = 640 Megabytes of RAM. While 640 MB might not crash a modern computer instantly, forcing every node on the network to rapidly allocate and deallocate hundreds of megabytes of contiguous memory per block creates a massive bottleneck. It slows down block processing, causes memory fragmentation, and could lead to Out-Of-Memory (OOM) crashes on smaller nodes. To solve this, the protocol enforces an exponential penalty for large memory, because as memory grows, the quadratic term violently overtakes the linear term.

`init_code_cost`:
Before [EIP-3860](https://eips.ethereum.org/EIPS/eip-3860), an attacker could submit a massive wall of initcode (the code that set initial values and prepares the contract to be deployed, if needed, or just returns the contract code right away). They would pay the calldata cost (which was/is relatively cheap), and the nodes would be forced to do a massive, CPU-intensive JUMPDEST analysis on huge abounts of bytecode. The attacker could then ensure the first opcode executed was REVERT. The execution would fail instantly, the attacker would get most of their execution gas refunded, but the nodes had already wasted CPU cycles analyzing the massive initcode. EIP-3860 introduced a strict size limit (2 * MAX_CODE_SIZE) and the 2-gas-per-word charge to properly price this pre-execution CPU burden.

`max_message_call_gas`:
Before EIP-150, a contract could pass all of its remaining gas to a sub-call. Attackers exploited this by creating transactions that made recursive sub-calls until they hit the EVM's hard limit of 1024 call stack frames. Processing a 1024-deep stack trace caused massive hardware strain (memory bloat and triggered aggressive garbage collection in the host operating system, slowing down block processing) on nodes. By forcing the parent to retain 1/64 of the available gas at every step, the available gas depletes exponentially. Because gas depletes so quickly, the transaction will mathematically run out of gas long before it can reach the 1024 stack depth limit.

`call_stipend` in `calculate_message_call_gas`:
By hardcoding the 2300 stipend directly into the protocol rules whenever value > 0, Ethereum guarantees that if you push money to a contract, you must also give it enough gas to perform basic, lightweight bookkeeping. It takes the security burden off developers and ensures that value transfers are fundamentally observable and actionable by the receiving entity.

---

#### Stack and Memory

```python
"""
Ethereum Virtual Machine (EVM) Stack.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Implementation of the stack operators for the EVM.
"""

from typing import List, Tuple

from ethereum_types.numeric import U8, U256

from .exceptions import (
    InvalidParameter,
    StackOverflowError,
    StackUnderflowError,
)


def decode_single(x: U8) -> U8:
    """
    Decode the immediate byte for DUPN/SWAPN to get the stack index.

    Return n with 17 <= n <= 235.

    Parameters
    ----------
    x : int
        The immediate byte value (0-90 or 128-255).

    Returns
    -------
    int
        The stack index n, where 17 <= n <= 235.

    Raises
    ------
    InvalidParameter
        If x is in the forbidden range (90 < x < 128 or x > 255).

    """
    if not (U8(0) <= x <= U8(90) or U8(128) <= x <= U8(255)):
        raise InvalidParameter(
            f"DUPN/SWAPN immediate byte {x} is out of range. "
            "Valid range: 0 <= x <= 90 or 128 <= x <= 255"
        )

    return U8((int(x) + 145) % 256)


def decode_pair(x: U8) -> Tuple[U8, U8]:
    """
    Decode the immediate byte for EXCHANGE to get two stack indices.

    Return (n, m) with 1 <= n <= 14 and n < m <= 30 - n.

    Parameters
    ----------
    x : int
        The immediate byte value (0-81 or 128-255).

    Returns
    -------
    Tuple[int, int]
        The two stack indices (n, m), where
        1 <= n <= 14 and n < m <= 30 - n.

    Raises
    ------
    InvalidParameter
        If x is in the forbidden range (81 < x < 128 or x > 255).

    """
    if not (U8(0) <= x <= U8(81) or U8(128) <= x <= U8(255)):
        raise InvalidParameter(
            f"EXCHANGE immediate byte {x} is in the forbidden "
            "range 82 <= x <= 127\n"
            "Valid range: 0 <= x <= 81 or 128 <= x <= 255"
        )

    k = U8(int(x) ^ 143)
    q, r = divmod(k, U8(16))
    if q < r:
        return q + U8(1), r + U8(1)
    else:
        return r + U8(1), U8(29) - q


def pop(stack: List[U256]) -> U256:
    """
    Pops the top item off of `stack`.

    Parameters
    ----------
    stack :
        EVM stack.

    Returns
    -------
    value : `U256`
        The top element on the stack.

    """
    if len(stack) == 0:
        raise StackUnderflowError

    return stack.pop()


def push(stack: List[U256], value: U256) -> None:
    """
    Pushes `value` onto `stack`.

    Parameters
    ----------
    stack :
        EVM stack.

    value :
        Item to be pushed onto `stack`.

    """
    if len(stack) == 1024:
        raise StackOverflowError

    return stack.append(value)

```

`decode_*` explained [below](#runtime-and-interpreter)

```python

"""
Ethereum Virtual Machine (EVM) Memory.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

EVM memory operations.
"""

from ethereum_types.bytes import Bytes
from ethereum_types.numeric import U256, Uint

from ethereum.utils.byte import right_pad_zero_bytes


def memory_write(
    memory: bytearray, start_position: U256, value: Bytes
) -> None:
    """
    Writes to memory.

    Parameters
    ----------
    memory :
        Memory contents of the EVM.
    start_position :
        Starting pointer to the memory.
    value :
        Data to write to memory.

    """
    memory[start_position : int(start_position) + len(value)] = value


def memory_read_bytes(
    memory: bytearray, start_position: U256, size: U256
) -> Bytes:
    """
    Read bytes from memory.

    Parameters
    ----------
    memory :
        Memory contents of the EVM.
    start_position :
        Starting pointer to the memory.
    size :
        Size of the data that needs to be read from `start_position`.

    Returns
    -------
    data_bytes :
        Data read from memory.

    """
    return Bytes(memory[start_position : Uint(start_position) + Uint(size)])


def buffer_read(buffer: Bytes, start_position: U256, size: U256) -> Bytes:
    """
    Read bytes from a buffer. Padding with zeros if necessary.

    Parameters
    ----------
    buffer :
        Memory contents of the EVM.
    start_position :
        Starting pointer to the memory.
    size :
        Size of the data that needs to be read from `start_position`.

    Returns
    -------
    data_bytes :
        Data read from memory.

    """
    buffer_slice = buffer[start_position : Uint(start_position) + Uint(size)]
    return right_pad_zero_bytes(bytes(buffer_slice), size)


```

`Bytes` (Python's bytes) vs `bytearray`: 
The later is mutable, the former is not. Strictness at the code-level

Padding with zeros in `buffer_read`:
If a smart contract instructs the EVM to read a chunk of data (usually a 32-byte word) from a buffer, but the requested range extends past the actual length of the buffer, the EVM does not throw an error. Instead, it returns the bytes it does have, and fills the rest of the requested length with zeros.

Why was the EVM designed this way?

1. Preventing Trivial Crashes: If out-of-bounds reads threw fatal errors, it would be much harder to write generalized smart contracts. Contracts would have to perform excessive, manual length-checking before every single read to avoid reverting the entire transaction.

2. Standardizing Missing Calldata: This is heavily utilized in how functions are called. If a function expects three 32-byte arguments, but the user only sends one, the EVM simply pads the missing arguments with zeros. The contract logic can then safely evaluate if (arg2 == 0) instead of crashing because arg2 wasn't provided.

3. 32-Byte Word Alignment: The EVM operates almost exclusively on 256-bit (32-byte) words. If there are only 4 bytes left in a buffer, the EVM's stack cannot process a 4-byte item. It must push a 32-byte item onto the stack. Right-padding with zeros perfectly shapes the remaining data into a valid 32-byte word that the EVM's opcodes can actually use.

---

#### Runtime and Interpreter

```python
"""
Ethereum Virtual Machine (EVM) Runtime Operations.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Runtime related operations used while executing EVM code.
"""

from typing import Set

from ethereum_types.bytes import Bytes
from ethereum_types.numeric import Uint, ulen

from .instructions import Ops


def get_valid_jump_destinations(code: Bytes) -> Set[Uint]:
    """
    Analyze the EVM code to obtain the set of valid jump destinations.

    Valid jump destinations are defined as follows:
        * The jump destination is less than the length of the code.
        * The jump destination should have the `JUMPDEST` opcode (0x5B).
        * The jump destination shouldn't be part of the data corresponding to
          `PUSH-N` opcodes.
        * The jump destination shouldn't be part of the immediate byte
          corresponding to `DUPN`, `SWAPN`, or `EXCHANGE` opcodes (EIP-8024).

    Note - Jump destinations are 0-indexed.

    Parameters
    ----------
    code :
        The EVM code which is to be executed.

    Returns
    -------
    valid_jump_destinations: `Set[Uint]`
        The set of valid jump destinations in the code.

    """
    valid_jump_destinations = set()
    pc = Uint(0)

    while pc < ulen(code):
        try:
            current_opcode = Ops(code[pc])
        except ValueError:
            # Skip invalid opcodes, as they don't affect the jumpdest
            # analysis. Nevertheless, such invalid opcodes would be caught
            # and raised when the interpreter runs.
            pc += Uint(1)
            continue

        if current_opcode == Ops.JUMPDEST:
            valid_jump_destinations.add(pc)
        elif Ops.PUSH1.value <= current_opcode.value <= Ops.PUSH32.value:
            # If PUSH-N opcodes are encountered, skip the current opcode along
            # with the trailing data segment corresponding to the PUSH-N
            # opcodes.
            push_data_size = current_opcode.value - Ops.PUSH1.value + 1
            pc += Uint(push_data_size)
        elif current_opcode in (Ops.DUPN, Ops.SWAPN):
            # EIP-8024: DUPN/SWAPN invalid immediate range is
            # 90 < x < 128, i.e. 0x5B (91) to 0x7F (127).
            # Invalid immediates are not skipped so the byte
            # remains at an instruction boundary.
            if (
                pc + Uint(1) < ulen(code)
                and 0x5B <= code[pc + Uint(1)] <= 0x7F
            ):
                pass
            else:
                pc += Uint(1)
        elif current_opcode == Ops.EXCHANGE:
            # EIP-8024: EXCHANGE invalid immediate range is
            # 81 < x < 128, i.e. 0x52 (82) to 0x7F (127).
            # Invalid immediates are not skipped so the byte
            # remains at an instruction boundary.
            if (
                pc + Uint(1) < ulen(code)
                and 0x52 <= code[pc + Uint(1)] <= 0x7F
            ):
                pass
            else:
                pc += Uint(1)

        pc += Uint(1)

    return valid_jump_destinations

```

EIP-8024 - `SWAPN`, `DUPN` and `EXCHANGE`:
`SWAPN` - swaps two items in the stack N-deep
`DUPN` - duplicates two items in the stack N-deep
`EXCHANGE` - swaps two items in the stack N-deep and N-deep

Instead of reading the target depth from the stack itself, these three new opcodes take an "immediate" operand. This means the instruction is followed immediately by a 1-byte argument right there in the bytecode.  For example, the bytes 0xe6 0x15 would mean DUPN with an argument of 21.

Because this 1-byte argument is technically data sitting directly in the execution path, it creates a security risk. What if the compiler wants to reach exactly 91 items deep? The byte for 91 is 0x5B.As we know, 0x5B is the JUMPDEST opcode. If 0x5B was allowed as an argument, static analyzers scanning the code would see a 0x5B and mistakenly register it as a valid jump destination, allowing malicious contracts to break control flow. Furthermore, bytes 0x60 to 0x7F represent PUSH opcodes, which would also confuse the analyzer.

To make the EIP 100% backward compatible without rewriting how the EVM parses jumps, the authors simply banned those bytes from being used as arguments. For `DUPN` and `SWAPN`, the immediate byte cannot be between 0x5B and 0x7F. For `EXCHANGE`, the immediate byte cannot be between 0x52 and 0x7F. When the compiler generates bytecode, it uses a special encoding formula (`decode_single` and `decode_pair` from above) that maps the allowed byte values to stack depths. It safely skips right over the "danger zone" of 0x5B-0x7F. Because of this clever encoding, the existing jump-destination analysis (like the Python script you analyzed) continues to work flawlessly. It only has to ensure that if someone does illegally inject an invalid byte like 0x5B after a `DUPN`, the analyzer treats it as a broken instruction and registers the 0x5B as a real jump destination.

```python
"""
Ethereum Virtual Machine (EVM) Interpreter.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

A straightforward interpreter that executes EVM code.
"""

from dataclasses import dataclass
from typing import Optional, Set, Tuple

from ethereum_types.bytes import Bytes, Bytes0
from ethereum_types.numeric import U256, Uint, ulen

from ethereum.exceptions import EthereumException
from ethereum.state import Address
from ethereum.trace import (
    EvmStop,
    OpEnd,
    OpException,
    OpStart,
    PrecompileEnd,
    PrecompileStart,
    TransactionEnd,
    evm_trace,
)

from ..blocks import Log
from ..state_tracker import (
    account_has_code_or_nonce,
    account_has_storage,
    copy_tx_state,
    destroy_storage,
    get_account,
    get_code,
    increment_nonce,
    mark_account_created,
    move_ether,
    restore_tx_state,
    set_code,
)
from ..vm import Message
from ..vm.eoa_delegation import get_delegated_code_address, set_delegation
from ..vm.gas import GasCosts, charge_gas
from ..vm.precompiled_contracts.mapping import PRE_COMPILED_CONTRACTS
from . import Evm, emit_transfer_log
from .exceptions import (
    AddressCollision,
    ExceptionalHalt,
    InvalidContractPrefix,
    InvalidOpcode,
    OutOfGasError,
    Revert,
    StackDepthLimitError,
)
from .instructions import Ops, op_implementation
from .runtime import get_valid_jump_destinations

STACK_DEPTH_LIMIT = Uint(1024)
MAX_CODE_SIZE = 0x8000
MAX_INIT_CODE_SIZE = 2 * MAX_CODE_SIZE


@dataclass
class MessageCallOutput:
    """
    Output of a particular message call.

    Contains the following:

          1. `gas_left`: remaining gas after execution.
          2. `refund_counter`: gas to refund after execution.
          3. `logs`: list of `Log` generated during execution.
          4. `accounts_to_delete`: Contracts which have self-destructed.
          5. `error`: The error from the execution if any.
          6. `return_data`: The output of the execution.
    """

    gas_left: Uint
    refund_counter: U256
    logs: Tuple[Log, ...]
    accounts_to_delete: Set[Address]
    error: Optional[EthereumException]
    return_data: Bytes


def process_message_call(message: Message) -> MessageCallOutput:
    """
    If `message.target` is empty then it creates a smart contract
    else it executes a call from the `message.caller` to the `message.target`.

    Parameters
    ----------
    message :
        Transaction specific items.

    Returns
    -------
    output : `MessageCallOutput`
        Output of the message call

    """
    tx_state = message.tx_env.state
    refund_counter = U256(0)
    if message.target == Bytes0(b""):
        is_collision = account_has_code_or_nonce(
            tx_state, message.current_target
        ) or account_has_storage(tx_state, message.current_target)
        if is_collision:
            return MessageCallOutput(
                Uint(0),
                U256(0),
                tuple(),
                set(),
                AddressCollision(),
                Bytes(b""),
            )
        else:
            evm = process_create_message(message)
    else:
        if message.tx_env.authorizations != ():
            refund_counter += set_delegation(message)

        delegated_address = get_delegated_code_address(message.code)
        if delegated_address is not None:
            message.disable_precompiles = True
            message.accessed_addresses.add(delegated_address)
            message.code = get_code(
                tx_state,
                get_account(tx_state, delegated_address).code_hash,
            )
            message.code_address = delegated_address

        evm = process_message(message)

    if evm.error:
        logs: Tuple[Log, ...] = ()
        accounts_to_delete = set()
    else:
        logs = evm.logs
        accounts_to_delete = evm.accounts_to_delete
        refund_counter += U256(evm.refund_counter)

    tx_end = TransactionEnd(
        int(message.gas) - int(evm.gas_left), evm.output, evm.error
    )
    evm_trace(evm, tx_end)

    return MessageCallOutput(
        gas_left=evm.gas_left,
        refund_counter=refund_counter,
        logs=logs,
        accounts_to_delete=accounts_to_delete,
        error=evm.error,
        return_data=evm.output,
    )


def process_create_message(message: Message) -> Evm:
    """
    Executes a call to create a smart contract.

    Parameters
    ----------
    message :
        Transaction specific items.

    Returns
    -------
    evm: :py:class:`~ethereum.forks.amsterdam.vm.Evm`
        Items containing execution specific objects.

    """
    tx_state = message.tx_env.state
    # take snapshot of state before processing the message
    snapshot = copy_tx_state(tx_state)

    # If the address where the account is being created has storage, it is
    # destroyed. This can only happen in the following highly unlikely
    # circumstances:
    # * The address created by a `CREATE` call collides with a subsequent
    #   `CREATE` or `CREATE2` call.
    # * The first `CREATE` happened before Spurious Dragon and left empty
    #   code.
    destroy_storage(tx_state, message.current_target)

    # In the previously mentioned edge case the preexisting storage is ignored
    # for gas refund purposes. In order to do this we must track created
    # accounts. This tracking is also needed to respect the constraints
    # added to SELFDESTRUCT by EIP-6780.
    mark_account_created(tx_state, message.current_target)

    increment_nonce(tx_state, message.current_target)

    evm = process_message(message)
    if not evm.error:
        contract_code = evm.output
        contract_code_gas = (
            ulen(contract_code) * GasCosts.CODE_DEPOSIT_PER_BYTE
        )
        try:
            if len(contract_code) > 0:
                if contract_code[0] == 0xEF:
                    raise InvalidContractPrefix
            charge_gas(evm, contract_code_gas)
            if len(contract_code) > MAX_CODE_SIZE:
                raise OutOfGasError
        except ExceptionalHalt as error:
            restore_tx_state(tx_state, snapshot)
            evm.gas_left = Uint(0)
            evm.output = b""
            evm.error = error
        else:
            set_code(tx_state, message.current_target, contract_code)
    else:
        restore_tx_state(tx_state, snapshot)
    return evm


def process_message(message: Message) -> Evm:
    """
    Move ether and execute the relevant code.

    Parameters
    ----------
    message :
        Transaction specific items.

    Returns
    -------
    evm: :py:class:`~ethereum.forks.amsterdam.vm.Evm`
        Items containing execution specific objects

    """
    tx_state = message.tx_env.state
    if message.depth > STACK_DEPTH_LIMIT:
        raise StackDepthLimitError("Stack depth limit reached")

    code = message.code
    valid_jump_destinations = get_valid_jump_destinations(code)
    evm = Evm(
        pc=Uint(0),
        stack=[],
        memory=bytearray(),
        code=code,
        gas_left=message.gas,
        valid_jump_destinations=valid_jump_destinations,
        logs=(),
        refund_counter=0,
        running=True,
        message=message,
        output=b"",
        accounts_to_delete=set(),
        return_data=b"",
        error=None,
        accessed_addresses=message.accessed_addresses,
        accessed_storage_keys=message.accessed_storage_keys,
    )

    snapshot = copy_tx_state(tx_state)

    if message.should_transfer_value and message.value != 0:
        move_ether(
            tx_state,
            message.caller,
            message.current_target,
            message.value,
        )
        if message.caller != message.current_target:
            emit_transfer_log(
                evm, message.caller, message.current_target, message.value
            )

    # Execute message code and handle errors
    try:
        if evm.message.code_address in PRE_COMPILED_CONTRACTS:
            if not message.disable_precompiles:
                evm_trace(evm, PrecompileStart(evm.message.code_address))
                PRE_COMPILED_CONTRACTS[evm.message.code_address](evm)
                evm_trace(evm, PrecompileEnd())
        else:
            while evm.running and evm.pc < ulen(evm.code):
                try:
                    op = Ops(evm.code[evm.pc])
                except ValueError as e:
                    raise InvalidOpcode(evm.code[evm.pc]) from e

                evm_trace(evm, OpStart(op))
                op_implementation[op](evm)
                evm_trace(evm, OpEnd())

            evm_trace(evm, EvmStop(Ops.STOP))

    except ExceptionalHalt as error:
        evm_trace(evm, OpException(error))
        evm.gas_left = Uint(0)
        evm.output = b""
        evm.error = error
    except Revert as error:
        evm_trace(evm, OpException(error))
        evm.error = error

    if evm.error:
        restore_tx_state(tx_state, snapshot)
    return evm

```

Use of `account_has_storage` in `process_message_call` (and in calls of CREATE(2) opcodes):
Prior to Spurious Dragon hard fork it was possible to have an account with zero code and zero nonce, but with non-empty storage, if it was set in the initcode (explain [here](#gas)). There currently exist 28 of those - [EIP-7610](https://eips.ethereum.org/EIPS/eip-7610)

`destroy_storage` in `process_create_message`:
Dead, unreachable code which was not cleaned-up yet. ([the change is merged](https://github.com/ethereum/execution-specs/issues/1347), but someone has overridden it)

### Opcodes

#### Arithmetic Opcodes

```python
"""
Ethereum Virtual Machine (EVM) Arithmetic Instructions.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Implementations of the EVM Arithmetic instructions.
"""

from ethereum_types.bytes import Bytes
from ethereum_types.numeric import U256, Uint

from ethereum.utils.numeric import get_sign

from .. import Evm
from ..gas import (
    GasCosts,
    charge_gas,
)
from ..stack import pop, push


def add(evm: Evm) -> None:
    """
    Adds the top two elements of the stack together, and pushes the result back
    on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = pop(evm.stack)
    y = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_ADD)

    # OPERATION
    result = x.wrapping_add(y)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def sub(evm: Evm) -> None:
    """
    Subtracts the top two elements of the stack, and pushes the result back
    on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = pop(evm.stack)
    y = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_SUB)

    # OPERATION
    result = x.wrapping_sub(y)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def mul(evm: Evm) -> None:
    """
    Multiplies the top two elements of the stack, and pushes the result back
    on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = pop(evm.stack)
    y = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_MUL)

    # OPERATION
    result = x.wrapping_mul(y)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def div(evm: Evm) -> None:
    """
    Integer division of the top two elements of the stack. Pushes the result
    back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    dividend = pop(evm.stack)
    divisor = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_DIV)

    # OPERATION
    if divisor == 0:
        quotient = U256(0)
    else:
        quotient = dividend // divisor

    push(evm.stack, quotient)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


U255_CEIL_VALUE = 2**255


def sdiv(evm: Evm) -> None:
    """
    Signed integer division of the top two elements of the stack. Pushes the
    result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    dividend = pop(evm.stack).to_signed()
    divisor = pop(evm.stack).to_signed()

    # GAS
    charge_gas(evm, GasCosts.OPCODE_SDIV)

    # OPERATION
    if divisor == 0:
        quotient = 0
    elif dividend == -U255_CEIL_VALUE and divisor == -1:
        quotient = -U255_CEIL_VALUE
    else:
        sign = get_sign(dividend * divisor)
        quotient = sign * (abs(dividend) // abs(divisor))

    push(evm.stack, U256.from_signed(quotient))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def mod(evm: Evm) -> None:
    """
    Modulo remainder of the top two elements of the stack. Pushes the result
    back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = pop(evm.stack)
    y = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_MOD)

    # OPERATION
    if y == 0:
        remainder = U256(0)
    else:
        remainder = x % y

    push(evm.stack, remainder)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def smod(evm: Evm) -> None:
    """
    Signed modulo remainder of the top two elements of the stack. Pushes the
    result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = pop(evm.stack).to_signed()
    y = pop(evm.stack).to_signed()

    # GAS
    charge_gas(evm, GasCosts.OPCODE_SMOD)

    # OPERATION
    if y == 0:
        remainder = 0
    else:
        remainder = get_sign(x) * (abs(x) % abs(y))

    push(evm.stack, U256.from_signed(remainder))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def addmod(evm: Evm) -> None:
    """
    Modulo addition of the top 2 elements with the 3rd element. Pushes the
    result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = Uint(pop(evm.stack))
    y = Uint(pop(evm.stack))
    z = Uint(pop(evm.stack))

    # GAS
    charge_gas(evm, GasCosts.OPCODE_ADDMOD)

    # OPERATION
    if z == 0:
        result = U256(0)
    else:
        result = U256((x + y) % z)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def mulmod(evm: Evm) -> None:
    """
    Modulo multiplication of the top 2 elements with the 3rd element. Pushes
    the result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = Uint(pop(evm.stack))
    y = Uint(pop(evm.stack))
    z = Uint(pop(evm.stack))

    # GAS
    charge_gas(evm, GasCosts.OPCODE_MULMOD)

    # OPERATION
    if z == 0:
        result = U256(0)
    else:
        result = U256((x * y) % z)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def exp(evm: Evm) -> None:
    """
    Exponential operation of the top 2 elements. Pushes the result back on
    the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    base = Uint(pop(evm.stack))
    exponent = Uint(pop(evm.stack))

    # GAS
    # This is equivalent to 1 + floor(log(y, 256)). But in python the log
    # function is inaccurate leading to wrong results.
    exponent_bits = exponent.bit_length()
    exponent_bytes = (exponent_bits + Uint(7)) // Uint(8)
    charge_gas(
        evm,
        GasCosts.OPCODE_EXP_BASE
        + GasCosts.OPCODE_EXP_PER_BYTE * exponent_bytes,
    )

    # OPERATION
    result = U256(pow(base, exponent, Uint(U256.MAX_VALUE) + Uint(1)))

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def signextend(evm: Evm) -> None:
    """
    Sign extend operation. In other words, extend a signed number which
    fits in N bytes to 32 bytes.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    byte_num = pop(evm.stack)
    value = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_SIGNEXTEND)

    # OPERATION
    if byte_num > U256(31):
        # Can't extend any further
        result = value
    else:
        # U256(0).to_be_bytes() gives b'' instead of b'\x00'.
        value_bytes = Bytes(value.to_be_bytes32())
        # Now among the obtained value bytes, consider only
        # N `least significant bytes`, where N is `byte_num + 1`.
        value_bytes = value_bytes[31 - int(byte_num) :]
        sign_bit = value_bytes[0] >> 7
        if sign_bit == 0:
            result = U256.from_be_bytes(value_bytes)
        else:
            num_bytes_prepend = U256(32) - (byte_num + U256(1))
            result = U256.from_be_bytes(
                bytearray([0xFF] * num_bytes_prepend) + value_bytes
            )

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)

```

---

#### Bitwise Opcodes

```python
"""
Ethereum Virtual Machine (EVM) Bitwise Instructions.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Implementations of the EVM bitwise instructions.
"""

from ethereum_types.numeric import U256, Uint

from .. import Evm
from ..gas import (
    GasCosts,
    charge_gas,
)
from ..stack import pop, push


def bitwise_and(evm: Evm) -> None:
    """
    Bitwise AND operation of the top 2 elements of the stack. Pushes the
    result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = pop(evm.stack)
    y = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_AND)

    # OPERATION
    push(evm.stack, x & y)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def bitwise_or(evm: Evm) -> None:
    """
    Bitwise OR operation of the top 2 elements of the stack. Pushes the
    result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = pop(evm.stack)
    y = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_OR)

    # OPERATION
    push(evm.stack, x | y)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def bitwise_xor(evm: Evm) -> None:
    """
    Bitwise XOR operation of the top 2 elements of the stack. Pushes the
    result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = pop(evm.stack)
    y = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_XOR)

    # OPERATION
    push(evm.stack, x ^ y)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def bitwise_not(evm: Evm) -> None:
    """
    Bitwise NOT operation of the top element of the stack. Pushes the
    result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_NOT)

    # OPERATION
    push(evm.stack, ~x)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def get_byte(evm: Evm) -> None:
    """
    For a word (defined by next top element of the stack), retrieve the
    Nth byte (0-indexed and defined by top element of stack) from the
    left (most significant) to right (least significant).

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    byte_index = pop(evm.stack)
    word = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_BYTE)

    # OPERATION
    if byte_index >= U256(32):
        result = U256(0)
    else:
        extra_bytes_to_right = U256(31) - byte_index
        # Remove the extra bytes in the right
        word = word >> (extra_bytes_to_right * U256(8))
        # Remove the extra bytes in the left
        word = word & U256(0xFF)
        result = word

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def bitwise_shl(evm: Evm) -> None:
    """
    Logical shift left (SHL) operation of the top 2 elements of the stack.
    Pushes the result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    shift = Uint(pop(evm.stack))
    value = Uint(pop(evm.stack))

    # GAS
    charge_gas(evm, GasCosts.OPCODE_SHL)

    # OPERATION
    if shift < Uint(256):
        result = U256((value << shift) & Uint(U256.MAX_VALUE))
    else:
        result = U256(0)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def bitwise_shr(evm: Evm) -> None:
    """
    Logical shift right (SHR) operation of the top 2 elements of the stack.
    Pushes the result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    shift = pop(evm.stack)
    value = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_SHR)

    # OPERATION
    if shift < U256(256):
        result = value >> shift
    else:
        result = U256(0)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def bitwise_sar(evm: Evm) -> None:
    """
    Arithmetic shift right (SAR) operation of the top 2 elements of the stack.
    Pushes the result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    shift = int(pop(evm.stack))
    signed_value = pop(evm.stack).to_signed()

    # GAS
    charge_gas(evm, GasCosts.OPCODE_SAR)

    # OPERATION
    if shift < 256:
        result = U256.from_signed(signed_value >> shift)
    elif signed_value >= 0:
        result = U256(0)
    else:
        result = U256.MAX_VALUE

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def count_leading_zeros(evm: Evm) -> None:
    """
    Count the number of leading zero bits in a 256-bit word.

    Pops one value from the stack and pushes the number of leading zero bits.
    If the input is zero, pushes 256.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_CLZ)

    # OPERATION
    bit_length = U256(x.bit_length())
    result = U256(256) - bit_length

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)

```

---

#### Block Opcodes

```python
"""
Ethereum Virtual Machine (EVM) Block Instructions.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Implementations of the EVM block instructions.
"""

from ethereum_types.numeric import U256, Uint

from .. import Evm
from ..gas import GasCosts, charge_gas
from ..stack import pop, push


def block_hash(evm: Evm) -> None:
    """
    Push the hash of one of the 256 most recent complete blocks onto the
    stack. The block number to hash is present at the top of the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    Raises
    ------
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.StackUnderflowError`
        If `len(stack)` is less than `1`.
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.OutOfGasError`
        If `evm.gas_left` is less than `20`.

    """
    # STACK
    block_number = Uint(pop(evm.stack))

    # GAS
    charge_gas(evm, GasCosts.OPCODE_BLOCKHASH)

    # OPERATION
    max_block_number = block_number + Uint(256)
    current_block_number = evm.message.block_env.number
    if (
        current_block_number <= block_number
        or current_block_number > max_block_number
    ):
        # Default hash to 0, if the block of interest is not yet on the chain
        # (including the block which has the current executing transaction),
        # or if the block's age is more than 256.
        current_block_hash = b"\x00"
    else:
        current_block_hash = evm.message.block_env.block_hashes[
            -(current_block_number - block_number)
        ]

    push(evm.stack, U256.from_be_bytes(current_block_hash))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def coinbase(evm: Evm) -> None:
    """
    Push the current block's beneficiary address (address of the block miner)
    onto the stack.

    Here the current block refers to the block in which the currently
    executing transaction/call resides.

    Parameters
    ----------
    evm :
        The current EVM frame.

    Raises
    ------
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.StackOverflowError`
        If `len(stack)` is equal to `1024`.
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.OutOfGasError`
        If `evm.gas_left` is less than `2`.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_COINBASE)

    # OPERATION
    push(evm.stack, U256.from_be_bytes(evm.message.block_env.coinbase))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def timestamp(evm: Evm) -> None:
    """
    Push the current block's timestamp onto the stack. Here the timestamp
    being referred to is actually the unix timestamp in seconds.

    Here the current block refers to the block in which the currently
    executing transaction/call resides.

    Parameters
    ----------
    evm :
        The current EVM frame.

    Raises
    ------
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.StackOverflowError`
        If `len(stack)` is equal to `1024`.
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.OutOfGasError`
        If `evm.gas_left` is less than `2`.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_TIMESTAMP)

    # OPERATION
    push(evm.stack, evm.message.block_env.time)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def number(evm: Evm) -> None:
    """
    Push the current block's number onto the stack.

    Here the current block refers to the block in which the currently
    executing transaction/call resides.

    Parameters
    ----------
    evm :
        The current EVM frame.

    Raises
    ------
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.StackOverflowError`
        If `len(stack)` is equal to `1024`.
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.OutOfGasError`
        If `evm.gas_left` is less than `2`.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_NUMBER)

    # OPERATION
    push(evm.stack, U256(evm.message.block_env.number))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def prev_randao(evm: Evm) -> None:
    """
    Push the `prev_randao` value onto the stack.

    The `prev_randao` value is the random output of the beacon chain's
    randomness oracle for the previous block.

    Parameters
    ----------
    evm :
        The current EVM frame.

    Raises
    ------
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.StackOverflowError`
        If `len(stack)` is equal to `1024`.
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.OutOfGasError`
        If `evm.gas_left` is less than `2`.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_PREVRANDAO)

    # OPERATION
    push(evm.stack, U256.from_be_bytes(evm.message.block_env.prev_randao))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def gas_limit(evm: Evm) -> None:
    """
    Push the current block's gas limit onto the stack.

    Here the current block refers to the block in which the currently
    executing transaction/call resides.

    Parameters
    ----------
    evm :
        The current EVM frame.

    Raises
    ------
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.StackOverflowError`
        If `len(stack)` is equal to `1024`.
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.OutOfGasError`
        If `evm.gas_left` is less than `2`.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_GASLIMIT)

    # OPERATION
    push(evm.stack, U256(evm.message.block_env.block_gas_limit))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def chain_id(evm: Evm) -> None:
    """
    Push the chain id onto the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    Raises
    ------
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.StackOverflowError`
        If `len(stack)` is equal to `1024`.
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.OutOfGasError`
        If `evm.gas_left` is less than `2`.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_CHAINID)

    # OPERATION
    push(evm.stack, U256(evm.message.block_env.chain_id))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def slot_number(evm: Evm) -> None:
    """
    Push the current slot number onto the stack.

    The slot number is provided by the consensus layer and passed to the
    execution layer through the engine API.

    Parameters
    ----------
    evm :
        The current EVM frame.

    Raises
    ------
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.StackOverflowError`
        If `len(stack)` is equal to `1024`.
    :py:class:`~ethereum.forks.amsterdam.vm.exceptions.OutOfGasError`
        If `evm.gas_left` is less than `2`.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_SLOTNUM)

    # OPERATION
    push(evm.stack, U256(evm.message.block_env.slot_number))

    # PROGRAM COUNTER
    evm.pc += Uint(1)

```

---

#### Comparision Opcodes

```python
"""
Ethereum Virtual Machine (EVM) Comparison Instructions.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Implementations of the EVM Comparison instructions.
"""

from ethereum_types.numeric import U256, Uint

from .. import Evm
from ..gas import (
    GasCosts,
    charge_gas,
)
from ..stack import pop, push


def less_than(evm: Evm) -> None:
    """
    Checks if the top element is less than the next top element. Pushes the
    result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    left = pop(evm.stack)
    right = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_LT)

    # OPERATION
    result = U256(left < right)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def signed_less_than(evm: Evm) -> None:
    """
    Signed less-than comparison.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    left = pop(evm.stack).to_signed()
    right = pop(evm.stack).to_signed()

    # GAS
    charge_gas(evm, GasCosts.OPCODE_SLT)

    # OPERATION
    result = U256(left < right)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def greater_than(evm: Evm) -> None:
    """
    Checks if the top element is greater than the next top element. Pushes
    the result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    left = pop(evm.stack)
    right = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_GT)

    # OPERATION
    result = U256(left > right)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def signed_greater_than(evm: Evm) -> None:
    """
    Signed greater-than comparison.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    left = pop(evm.stack).to_signed()
    right = pop(evm.stack).to_signed()

    # GAS
    charge_gas(evm, GasCosts.OPCODE_SGT)

    # OPERATION
    result = U256(left > right)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def equal(evm: Evm) -> None:
    """
    Checks if the top element is equal to the next top element. Pushes
    the result back on the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    left = pop(evm.stack)
    right = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_EQ)

    # OPERATION
    result = U256(left == right)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def is_zero(evm: Evm) -> None:
    """
    Checks if the top element is equal to 0. Pushes the result back on the
    stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    x = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_ISZERO)

    # OPERATION
    result = U256(x == 0)

    push(evm.stack, result)

    # PROGRAM COUNTER
    evm.pc += Uint(1)

```

---

#### Control Flow Opcodes

```python
"""
Ethereum Virtual Machine (EVM) Control Flow Instructions.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Implementations of the EVM control flow instructions.
"""

from ethereum_types.numeric import U256, Uint

from ...vm.gas import (
    GasCosts,
    charge_gas,
)
from .. import Evm
from ..exceptions import InvalidJumpDestError
from ..stack import pop, push


def stop(evm: Evm) -> None:
    """
    Stop further execution of EVM code.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    pass

    # OPERATION
    evm.running = False

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def jump(evm: Evm) -> None:
    """
    Alter the program counter to the location specified by the top of the
    stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    jump_dest = Uint(pop(evm.stack))

    # GAS
    charge_gas(evm, GasCosts.OPCODE_JUMP)

    # OPERATION
    if jump_dest not in evm.valid_jump_destinations:
        raise InvalidJumpDestError

    # PROGRAM COUNTER
    evm.pc = Uint(jump_dest)


def jumpi(evm: Evm) -> None:
    """
    Alter the program counter to the specified location if and only if a
    condition is true. If the condition is not true, then the program counter
    would increase only by 1.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    jump_dest = Uint(pop(evm.stack))
    conditional_value = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_JUMPI)

    # OPERATION
    if conditional_value == 0:
        destination = evm.pc + Uint(1)
    elif jump_dest not in evm.valid_jump_destinations:
        raise InvalidJumpDestError
    else:
        destination = jump_dest

    # PROGRAM COUNTER
    evm.pc = destination


def pc(evm: Evm) -> None:
    """
    Push onto the stack the value of the program counter after reaching the
    current instruction and without increasing it for the next instruction.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_PC)

    # OPERATION
    push(evm.stack, U256(evm.pc))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def gas_left(evm: Evm) -> None:
    """
    Push the amount of available gas (including the corresponding reduction
    for the cost of this instruction) onto the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_GAS)

    # OPERATION
    push(evm.stack, U256(evm.gas_left))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def jumpdest(evm: Evm) -> None:
    """
    Mark a valid destination for jumps. This is a noop, present only
    to be used by `JUMP` and `JUMPI` opcodes to verify that their jump is
    valid.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_JUMPDEST)

    # OPERATION
    pass

    # PROGRAM COUNTER
    evm.pc += Uint(1)

```

---

#### Environment Opcodes

```python
"""
Ethereum Virtual Machine (EVM) Environmental Instructions.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Implementations of the EVM environment related instructions.
"""

from ethereum_types.bytes import Bytes32
from ethereum_types.numeric import U256, Uint, ulen

from ethereum.state import EMPTY_ACCOUNT
from ethereum.utils.numeric import ceil32

from ...state_tracker import get_account, get_code
from ...utils.address import to_address_masked
from ...vm.memory import buffer_read, memory_write
from .. import Evm
from ..exceptions import OutOfBoundsRead
from ..gas import (
    GasCosts,
    calculate_blob_gas_price,
    calculate_gas_extend_memory,
    charge_gas,
)
from ..stack import pop, push


def address(evm: Evm) -> None:
    """
    Pushes the address of the current executing account to the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_ADDRESS)

    # OPERATION
    push(evm.stack, U256.from_be_bytes(evm.message.current_target))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def balance(evm: Evm) -> None:
    """
    Pushes the balance of the given account onto the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    address = to_address_masked(pop(evm.stack))

    # GAS
    if address in evm.accessed_addresses:
        charge_gas(evm, GasCosts.WARM_ACCESS)
    else:
        evm.accessed_addresses.add(address)
        charge_gas(evm, GasCosts.COLD_ACCOUNT_ACCESS)

    # OPERATION
    # Non-existent accounts default to EMPTY_ACCOUNT, which has balance 0.
    tx_state = evm.message.tx_env.state
    balance = get_account(tx_state, address).balance

    push(evm.stack, balance)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def origin(evm: Evm) -> None:
    """
    Pushes the address of the original transaction sender to the stack.
    The origin address can only be an EOA.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_ORIGIN)

    # OPERATION
    push(evm.stack, U256.from_be_bytes(evm.message.tx_env.origin))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def caller(evm: Evm) -> None:
    """
    Pushes the address of the caller onto the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_CALLER)

    # OPERATION
    push(evm.stack, U256.from_be_bytes(evm.message.caller))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def callvalue(evm: Evm) -> None:
    """
    Push the value (in wei) sent with the call onto the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_CALLVALUE)

    # OPERATION
    push(evm.stack, evm.message.value)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def calldataload(evm: Evm) -> None:
    """
    Push a word (32 bytes) of the input data belonging to the current
    environment onto the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    start_index = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_CALLDATALOAD)

    # OPERATION
    value = buffer_read(evm.message.data, start_index, U256(32))

    push(evm.stack, U256.from_be_bytes(value))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def calldatasize(evm: Evm) -> None:
    """
    Push the size of input data in current environment onto the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_CALLDATASIZE)

    # OPERATION
    push(evm.stack, U256(len(evm.message.data)))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def calldatacopy(evm: Evm) -> None:
    """
    Copy a portion of the input data in current environment to memory.

    This will also expand the memory, in case that the memory is insufficient
    to store the data.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    memory_start_index = pop(evm.stack)
    data_start_index = pop(evm.stack)
    size = pop(evm.stack)

    # GAS
    words = ceil32(Uint(size)) // Uint(32)
    copy_gas_cost = GasCosts.OPCODE_COPY_PER_WORD * words
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(memory_start_index, size)]
    )
    charge_gas(
        evm,
        GasCosts.OPCODE_CALLDATACOPY_BASE + copy_gas_cost + extend_memory.cost,
    )

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    value = buffer_read(evm.message.data, data_start_index, size)
    memory_write(evm.memory, memory_start_index, value)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def codesize(evm: Evm) -> None:
    """
    Push the size of code running in current environment onto the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_CODESIZE)

    # OPERATION
    push(evm.stack, U256(len(evm.code)))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def codecopy(evm: Evm) -> None:
    """
    Copy a portion of the code in current environment to memory.

    This will also expand the memory, in case that the memory is insufficient
    to store the data.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    memory_start_index = pop(evm.stack)
    code_start_index = pop(evm.stack)
    size = pop(evm.stack)

    # GAS
    words = ceil32(Uint(size)) // Uint(32)
    copy_gas_cost = GasCosts.OPCODE_COPY_PER_WORD * words
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(memory_start_index, size)]
    )
    charge_gas(
        evm,
        GasCosts.OPCODE_CODECOPY_BASE + copy_gas_cost + extend_memory.cost,
    )

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    value = buffer_read(evm.code, code_start_index, size)
    memory_write(evm.memory, memory_start_index, value)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def gasprice(evm: Evm) -> None:
    """
    Push the gas price used in current environment onto the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_GASPRICE)

    # OPERATION
    push(evm.stack, U256(evm.message.tx_env.gas_price))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def extcodesize(evm: Evm) -> None:
    """
    Push the code size of a given account onto the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    address = to_address_masked(pop(evm.stack))

    # GAS
    if address in evm.accessed_addresses:
        charge_gas(evm, GasCosts.WARM_ACCESS)
    else:
        evm.accessed_addresses.add(address)
        charge_gas(evm, GasCosts.COLD_ACCOUNT_ACCESS)

    # OPERATION
    tx_state = evm.message.tx_env.state
    code_hash = get_account(tx_state, address).code_hash
    code = get_code(tx_state, code_hash)

    codesize = U256(len(code))
    push(evm.stack, codesize)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def extcodecopy(evm: Evm) -> None:
    """
    Copy a portion of an account's code to memory.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    address = to_address_masked(pop(evm.stack))
    memory_start_index = pop(evm.stack)
    code_start_index = pop(evm.stack)
    size = pop(evm.stack)

    # GAS
    words = ceil32(Uint(size)) // Uint(32)
    copy_gas_cost = GasCosts.OPCODE_COPY_PER_WORD * words
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(memory_start_index, size)]
    )

    if address in evm.accessed_addresses:
        access_gas_cost = GasCosts.WARM_ACCESS
    else:
        evm.accessed_addresses.add(address)
        access_gas_cost = GasCosts.COLD_ACCOUNT_ACCESS

    total_gas_cost = access_gas_cost + copy_gas_cost + extend_memory.cost

    charge_gas(evm, total_gas_cost)

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    tx_state = evm.message.tx_env.state
    code_hash = get_account(tx_state, address).code_hash
    code = get_code(tx_state, code_hash)

    value = buffer_read(code, code_start_index, size)
    memory_write(evm.memory, memory_start_index, value)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def returndatasize(evm: Evm) -> None:
    """
    Pushes the size of the return data buffer onto the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_RETURNDATASIZE)

    # OPERATION
    push(evm.stack, U256(len(evm.return_data)))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def returndatacopy(evm: Evm) -> None:
    """
    Copies data from the return data buffer to memory.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    memory_start_index = pop(evm.stack)
    return_data_start_position = pop(evm.stack)
    size = pop(evm.stack)

    # GAS
    words = ceil32(Uint(size)) // Uint(32)
    copy_gas_cost = GasCosts.OPCODE_RETURNDATACOPY_PER_WORD * words
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(memory_start_index, size)]
    )
    charge_gas(
        evm,
        GasCosts.OPCODE_RETURNDATACOPY_BASE
        + copy_gas_cost
        + extend_memory.cost,
    )
    if Uint(return_data_start_position) + Uint(size) > ulen(evm.return_data):
        raise OutOfBoundsRead

    evm.memory += b"\x00" * extend_memory.expand_by
    value = evm.return_data[
        return_data_start_position : return_data_start_position + size
    ]
    memory_write(evm.memory, memory_start_index, value)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def extcodehash(evm: Evm) -> None:
    """
    Returns the keccak256 hash of a contract’s bytecode.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    address = to_address_masked(pop(evm.stack))

    # GAS
    if address in evm.accessed_addresses:
        access_gas_cost = GasCosts.WARM_ACCESS
    else:
        evm.accessed_addresses.add(address)
        access_gas_cost = GasCosts.COLD_ACCOUNT_ACCESS

    charge_gas(evm, access_gas_cost)

    # OPERATION
    tx_state = evm.message.tx_env.state
    account = get_account(tx_state, address)

    if account == EMPTY_ACCOUNT:
        codehash = U256(0)
    else:
        codehash = U256.from_be_bytes(account.code_hash)

    push(evm.stack, codehash)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def self_balance(evm: Evm) -> None:
    """
    Pushes the balance of the current address to the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.FAST_STEP)

    # OPERATION
    # Non-existent accounts default to EMPTY_ACCOUNT, which has balance 0.
    balance = get_account(
        evm.message.tx_env.state, evm.message.current_target
    ).balance

    push(evm.stack, balance)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def base_fee(evm: Evm) -> None:
    """
    Pushes the base fee of the current block on to the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_BASEFEE)

    # OPERATION
    push(evm.stack, U256(evm.message.block_env.base_fee_per_gas))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def blob_hash(evm: Evm) -> None:
    """
    Pushes the versioned hash at a particular index on to the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    index = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_BLOBHASH)

    # OPERATION
    if int(index) < len(evm.message.tx_env.blob_versioned_hashes):
        blob_hash = evm.message.tx_env.blob_versioned_hashes[index]
    else:
        blob_hash = Bytes32(b"\x00" * 32)
    push(evm.stack, U256.from_be_bytes(blob_hash))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def blob_base_fee(evm: Evm) -> None:
    """
    Pushes the blob base fee on to the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_BLOBBASEFEE)

    # OPERATION
    blob_base_fee = calculate_blob_gas_price(
        evm.message.block_env.excess_blob_gas
    )
    push(evm.stack, U256(blob_base_fee))

    # PROGRAM COUNTER
    evm.pc += Uint(1)

```

---

#### Keccak256 Opcode

```python
"""
Ethereum Virtual Machine (EVM) Keccak Instructions.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Implementations of the EVM keccak instructions.
"""

from ethereum_types.numeric import U256, Uint

from ethereum.crypto.hash import keccak256
from ethereum.utils.numeric import ceil32

from .. import Evm
from ..gas import (
    GasCosts,
    calculate_gas_extend_memory,
    charge_gas,
)
from ..memory import memory_read_bytes
from ..stack import pop, push


def keccak(evm: Evm) -> None:
    """
    Pushes to the stack the Keccak-256 hash of a region of memory.

    This also expands the memory, in case the memory is insufficient to
    access the data's memory location.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    memory_start_index = pop(evm.stack)
    size = pop(evm.stack)

    # GAS
    words = ceil32(Uint(size)) // Uint(32)
    word_gas_cost = GasCosts.OPCODE_KECCAK256_PER_WORD * words
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(memory_start_index, size)]
    )
    charge_gas(
        evm,
        GasCosts.OPCODE_KECCAK256_BASE + word_gas_cost + extend_memory.cost,
    )

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    data = memory_read_bytes(evm.memory, memory_start_index, size)
    hashed = keccak256(data)

    push(evm.stack, U256.from_be_bytes(hashed))

    # PROGRAM COUNTER
    evm.pc += Uint(1)

```

---

#### Log Opcode

```python
"""
Ethereum Virtual Machine (EVM) Logging Instructions.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Implementations of the EVM logging instructions.
"""

from functools import partial
from typing import Callable

from ethereum_types.numeric import Uint

from ...blocks import Log
from .. import Evm
from ..exceptions import WriteInStaticContext
from ..gas import (
    GasCosts,
    calculate_gas_extend_memory,
    charge_gas,
)
from ..memory import memory_read_bytes
from ..stack import pop


def log_n(evm: Evm, num_topics: int) -> None:
    """
    Appends a log entry, having `num_topics` topics, to the evm logs.

    This will also expand the memory if the data (required by the log entry)
    corresponding to the memory is not accessible.

    Parameters
    ----------
    evm :
        The current EVM frame.
    num_topics :
        The number of topics to be included in the log entry.

    """
    # STACK
    memory_start_index = pop(evm.stack)
    size = pop(evm.stack)

    topics = []
    for _ in range(num_topics):
        topic = pop(evm.stack).to_be_bytes32()
        topics.append(topic)

    # GAS
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(memory_start_index, size)]
    )
    charge_gas(
        evm,
        GasCosts.OPCODE_LOG_BASE
        + GasCosts.OPCODE_LOG_DATA_PER_BYTE * Uint(size)
        + GasCosts.OPCODE_LOG_TOPIC * Uint(num_topics)
        + extend_memory.cost,
    )

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    if evm.message.is_static:
        raise WriteInStaticContext
    log_entry = Log(
        address=evm.message.current_target,
        topics=tuple(topics),
        data=memory_read_bytes(evm.memory, memory_start_index, size),
    )

    evm.logs = evm.logs + (log_entry,)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


log0: Callable[[Evm], None] = partial(log_n, num_topics=0)
log1: Callable[[Evm], None] = partial(log_n, num_topics=1)
log2: Callable[[Evm], None] = partial(log_n, num_topics=2)
log3: Callable[[Evm], None] = partial(log_n, num_topics=3)
log4: Callable[[Evm], None] = partial(log_n, num_topics=4)

```

---

#### Memoty Opcodes

```python
"""
Ethereum Virtual Machine (EVM) Memory Instructions.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Implementations of the EVM Memory instructions.
"""

from ethereum_types.bytes import Bytes
from ethereum_types.numeric import U256, Uint

from ethereum.utils.numeric import ceil32

from .. import Evm
from ..gas import (
    GasCosts,
    calculate_gas_extend_memory,
    charge_gas,
)
from ..memory import memory_read_bytes, memory_write
from ..stack import pop, push


def mstore(evm: Evm) -> None:
    """
    Stores a word to memory.
    This also expands the memory, if the memory is
    insufficient to store the word.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    start_position = pop(evm.stack)
    value = pop(evm.stack).to_be_bytes32()

    # GAS
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(start_position, U256(len(value)))]
    )

    charge_gas(evm, GasCosts.OPCODE_MSTORE_BASE + extend_memory.cost)

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    memory_write(evm.memory, start_position, value)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def mstore8(evm: Evm) -> None:
    """
    Stores a byte to memory.
    This also expands the memory, if the memory is
    insufficient to store the word.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    start_position = pop(evm.stack)
    value = pop(evm.stack)

    # GAS
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(start_position, U256(1))]
    )

    charge_gas(evm, GasCosts.OPCODE_MSTORE8_BASE + extend_memory.cost)

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    normalized_bytes_value = Bytes([value & U256(0xFF)])
    memory_write(evm.memory, start_position, normalized_bytes_value)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def mload(evm: Evm) -> None:
    """
    Loads a word from memory.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    start_position = pop(evm.stack)

    # GAS
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(start_position, U256(32))]
    )
    charge_gas(evm, GasCosts.OPCODE_MLOAD_BASE + extend_memory.cost)

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    value = U256.from_be_bytes(
        memory_read_bytes(evm.memory, start_position, U256(32))
    )
    push(evm.stack, value)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def msize(evm: Evm) -> None:
    """
    Pushes the size of active memory in bytes onto the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_MSIZE)

    # OPERATION
    push(evm.stack, U256(len(evm.memory)))

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def mcopy(evm: Evm) -> None:
    """
    Copies the bytes in memory from one location to another.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    destination = pop(evm.stack)
    source = pop(evm.stack)
    length = pop(evm.stack)

    # GAS
    words = ceil32(Uint(length)) // Uint(32)
    copy_gas_cost = GasCosts.OPCODE_COPY_PER_WORD * words

    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(source, length), (destination, length)]
    )
    charge_gas(
        evm,
        GasCosts.OPCODE_MCOPY_BASE + copy_gas_cost + extend_memory.cost,
    )

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    value = memory_read_bytes(evm.memory, source, length)
    memory_write(evm.memory, destination, value)

    # PROGRAM COUNTER
    evm.pc += Uint(1)

```

Memory expansion in `mload`:
The EVM does not allocate memory up front. If MLOAD attempts to read 32 bytes stating/ending at an index that goes beyond the currently allocated memory bounds, the EVM must "expand" the memory.

---

#### Stack Opcodes

```python
"""
Ethereum Virtual Machine (EVM) Stack Instructions.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Implementations of the EVM stack related instructions.
"""

from functools import partial
from typing import Callable

from ethereum_types.numeric import U8, U256, Uint

from .. import Evm, stack
from ..exceptions import StackUnderflowError
from ..gas import (
    GasCosts,
    charge_gas,
)
from ..memory import buffer_read
from ..stack import decode_pair, decode_single


def pop(evm: Evm) -> None:
    """
    Removes an item from the stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    stack.pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.OPCODE_POP)

    # OPERATION
    pass

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def push_n(evm: Evm, num_bytes: int) -> None:
    """
    Pushes an N-byte immediate onto the stack. Push zero if num_bytes is zero.

    Parameters
    ----------
    evm :
        The current EVM frame.

    num_bytes :
        The number of immediate bytes to be read from the code and pushed to
        the stack. Push zero if num_bytes is zero.

    """
    # STACK
    pass

    # GAS
    if num_bytes == 0:
        charge_gas(evm, GasCosts.OPCODE_PUSH0)
    else:
        charge_gas(evm, GasCosts.OPCODE_PUSH)

    # OPERATION
    data_to_push = U256.from_be_bytes(
        buffer_read(evm.code, U256(evm.pc + Uint(1)), U256(num_bytes))
    )
    stack.push(evm.stack, data_to_push)

    # PROGRAM COUNTER
    evm.pc += Uint(1) + Uint(num_bytes)


def dup_n(evm: Evm, item_number: int) -> None:
    """
    Duplicates the Nth stack item (from top of the stack) to the top of stack.

    Parameters
    ----------
    evm :
        The current EVM frame.

    item_number :
        The stack item number (0-indexed from top of stack) to be duplicated
        to the top of stack.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_DUP)
    if item_number >= len(evm.stack):
        raise StackUnderflowError
    data_to_duplicate = evm.stack[len(evm.stack) - 1 - item_number]
    stack.push(evm.stack, data_to_duplicate)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def swap_n(evm: Evm, item_number: int) -> None:
    """
    Swaps the top and the `item_number` element of the stack, where
    the top of the stack is position zero.

    If `item_number` is zero, this function does nothing (which should not be
    possible, since there is no `SWAP0` instruction).

    Parameters
    ----------
    evm :
        The current EVM frame.

    item_number :
        The stack item number (0-indexed from top of stack) to be swapped
        with the top of stack element.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_SWAP)
    if item_number >= len(evm.stack):
        raise StackUnderflowError
    evm.stack[-1], evm.stack[-1 - item_number] = (
        evm.stack[-1 - item_number],
        evm.stack[-1],
    )

    # PROGRAM COUNTER
    evm.pc += Uint(1)


push0: Callable[[Evm], None] = partial(push_n, num_bytes=0)
push1: Callable[[Evm], None] = partial(push_n, num_bytes=1)
push2: Callable[[Evm], None] = partial(push_n, num_bytes=2)
push3: Callable[[Evm], None] = partial(push_n, num_bytes=3)
push4: Callable[[Evm], None] = partial(push_n, num_bytes=4)
push5: Callable[[Evm], None] = partial(push_n, num_bytes=5)
push6: Callable[[Evm], None] = partial(push_n, num_bytes=6)
push7: Callable[[Evm], None] = partial(push_n, num_bytes=7)
push8: Callable[[Evm], None] = partial(push_n, num_bytes=8)
push9: Callable[[Evm], None] = partial(push_n, num_bytes=9)
push10: Callable[[Evm], None] = partial(push_n, num_bytes=10)
push11: Callable[[Evm], None] = partial(push_n, num_bytes=11)
push12: Callable[[Evm], None] = partial(push_n, num_bytes=12)
push13: Callable[[Evm], None] = partial(push_n, num_bytes=13)
push14: Callable[[Evm], None] = partial(push_n, num_bytes=14)
push15: Callable[[Evm], None] = partial(push_n, num_bytes=15)
push16: Callable[[Evm], None] = partial(push_n, num_bytes=16)
push17: Callable[[Evm], None] = partial(push_n, num_bytes=17)
push18: Callable[[Evm], None] = partial(push_n, num_bytes=18)
push19: Callable[[Evm], None] = partial(push_n, num_bytes=19)
push20: Callable[[Evm], None] = partial(push_n, num_bytes=20)
push21: Callable[[Evm], None] = partial(push_n, num_bytes=21)
push22: Callable[[Evm], None] = partial(push_n, num_bytes=22)
push23: Callable[[Evm], None] = partial(push_n, num_bytes=23)
push24: Callable[[Evm], None] = partial(push_n, num_bytes=24)
push25: Callable[[Evm], None] = partial(push_n, num_bytes=25)
push26: Callable[[Evm], None] = partial(push_n, num_bytes=26)
push27: Callable[[Evm], None] = partial(push_n, num_bytes=27)
push28: Callable[[Evm], None] = partial(push_n, num_bytes=28)
push29: Callable[[Evm], None] = partial(push_n, num_bytes=29)
push30: Callable[[Evm], None] = partial(push_n, num_bytes=30)
push31: Callable[[Evm], None] = partial(push_n, num_bytes=31)
push32: Callable[[Evm], None] = partial(push_n, num_bytes=32)

dup1: Callable[[Evm], None] = partial(dup_n, item_number=0)
dup2: Callable[[Evm], None] = partial(dup_n, item_number=1)
dup3: Callable[[Evm], None] = partial(dup_n, item_number=2)
dup4: Callable[[Evm], None] = partial(dup_n, item_number=3)
dup5: Callable[[Evm], None] = partial(dup_n, item_number=4)
dup6: Callable[[Evm], None] = partial(dup_n, item_number=5)
dup7: Callable[[Evm], None] = partial(dup_n, item_number=6)
dup8: Callable[[Evm], None] = partial(dup_n, item_number=7)
dup9: Callable[[Evm], None] = partial(dup_n, item_number=8)
dup10: Callable[[Evm], None] = partial(dup_n, item_number=9)
dup11: Callable[[Evm], None] = partial(dup_n, item_number=10)
dup12: Callable[[Evm], None] = partial(dup_n, item_number=11)
dup13: Callable[[Evm], None] = partial(dup_n, item_number=12)
dup14: Callable[[Evm], None] = partial(dup_n, item_number=13)
dup15: Callable[[Evm], None] = partial(dup_n, item_number=14)
dup16: Callable[[Evm], None] = partial(dup_n, item_number=15)

swap1: Callable[[Evm], None] = partial(swap_n, item_number=1)
swap2: Callable[[Evm], None] = partial(swap_n, item_number=2)
swap3: Callable[[Evm], None] = partial(swap_n, item_number=3)
swap4: Callable[[Evm], None] = partial(swap_n, item_number=4)
swap5: Callable[[Evm], None] = partial(swap_n, item_number=5)
swap6: Callable[[Evm], None] = partial(swap_n, item_number=6)
swap7: Callable[[Evm], None] = partial(swap_n, item_number=7)
swap8: Callable[[Evm], None] = partial(swap_n, item_number=8)
swap9: Callable[[Evm], None] = partial(swap_n, item_number=9)
swap10: Callable[[Evm], None] = partial(swap_n, item_number=10)
swap11: Callable[[Evm], None] = partial(swap_n, item_number=11)
swap12: Callable[[Evm], None] = partial(swap_n, item_number=12)
swap13: Callable[[Evm], None] = partial(swap_n, item_number=13)
swap14: Callable[[Evm], None] = partial(swap_n, item_number=14)
swap15: Callable[[Evm], None] = partial(swap_n, item_number=15)
swap16: Callable[[Evm], None] = partial(swap_n, item_number=16)


def dupn(evm: Evm) -> None:
    """
    Duplicate the Nth stack item (from top of the stack) to the top of stack.
    The item number is read from the immediate byte following the opcode and
    decoded using the EIP-8024 index shifting rules.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_DUPN)

    # OPERATION
    immediate_data = U8(
        buffer_read(evm.code, U256(evm.pc + Uint(1)), U256(1))[0]
    )
    item_number = decode_single(immediate_data)
    if int(item_number) > len(evm.stack):
        raise StackUnderflowError
    data_to_duplicate = evm.stack[-item_number]
    stack.push(evm.stack, data_to_duplicate)

    # PROGRAM COUNTER
    evm.pc += Uint(2)


def swapn(evm: Evm) -> None:
    """
    Swap the top stack item with the Nth stack item.
    The value N is read from the immediate byte following the opcode and
    decoded using the EIP-8024 index shifting rules.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_SWAPN)

    # OPERATION
    immediate_data = U8(
        buffer_read(evm.code, U256(evm.pc + Uint(1)), U256(1))[0]
    )
    item_number = decode_single(immediate_data)
    # SWAPN with decoded value n swaps top (position 1) with position (n+1)
    if int(item_number) + 1 > len(evm.stack):
        raise StackUnderflowError
    # stack[-1] is top (position 1), stack[-(item_number+1)] is position (n+1)
    evm.stack[-1], evm.stack[-(item_number + U8(1))] = (
        evm.stack[-(item_number + U8(1))],
        evm.stack[-1],
    )

    # PROGRAM COUNTER
    evm.pc += Uint(2)


def exchange(evm: Evm) -> None:
    """
    Exchange the Nth stack item with the Mth stack item.
    The values N and M are decoded from the immediate byte using the
    EIP-8024 index shifting rules.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    pass

    # GAS
    charge_gas(evm, GasCosts.OPCODE_EXCHANGE)

    # OPERATION
    immediate_data = U8(
        buffer_read(evm.code, U256(evm.pc + Uint(1)), U256(1))[0]
    )
    n, m = decode_pair(immediate_data)
    # EXCHANGE swaps position (n+1) with position (m+1)
    depth = max(n, m) + U8(1)
    if int(depth) > len(evm.stack):
        raise StackUnderflowError
    evm.stack[-(n + U8(1))], evm.stack[-(m + U8(1))] = (
        evm.stack[-(m + U8(1))],
        evm.stack[-(n + U8(1))],
    )

    # PROGRAM COUNTER
    evm.pc += Uint(2)

```

---

#### Storage Opcodes

```python
"""
Ethereum Virtual Machine (EVM) Storage Instructions.

.. contents:: Table of Contents
    :backlinks: none
    :local:

Introduction
------------

Implementations of the EVM storage related instructions.
"""

from ethereum_types.numeric import Uint

from ...state_tracker import (
    get_storage,
    get_storage_original,
    get_transient_storage,
    set_storage,
    set_transient_storage,
)
from .. import Evm
from ..exceptions import WriteInStaticContext
from ..gas import (
    GasCosts,
    charge_gas,
    check_gas,
)
from ..stack import pop, push


def sload(evm: Evm) -> None:
    """
    Loads to the stack, the value corresponding to a certain key from the
    storage of the current account.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    key = pop(evm.stack).to_be_bytes32()

    # GAS
    if (evm.message.current_target, key) in evm.accessed_storage_keys:
        charge_gas(evm, GasCosts.WARM_ACCESS)
    else:
        evm.accessed_storage_keys.add((evm.message.current_target, key))
        charge_gas(evm, GasCosts.COLD_STORAGE_ACCESS)

    # OPERATION
    tx_state = evm.message.tx_env.state
    value = get_storage(tx_state, evm.message.current_target, key)

    push(evm.stack, value)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def sstore(evm: Evm) -> None:
    """
    Stores a value at a certain key in the current context's storage.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    if evm.message.is_static:
        raise WriteInStaticContext

    # STACK
    key = pop(evm.stack).to_be_bytes32()
    new_value = pop(evm.stack)

    # check we have at least the stipend gas
    check_gas(evm, GasCosts.CALL_STIPEND + Uint(1))

    tx_state = evm.message.tx_env.state
    original_value = get_storage_original(
        tx_state, evm.message.current_target, key
    )
    current_value = get_storage(tx_state, evm.message.current_target, key)

    gas_cost = Uint(0)

    if (evm.message.current_target, key) not in evm.accessed_storage_keys:
        evm.accessed_storage_keys.add((evm.message.current_target, key))
        gas_cost += GasCosts.COLD_STORAGE_ACCESS

    if original_value == current_value and current_value != new_value:
        if original_value == 0:
            gas_cost += GasCosts.STORAGE_SET
        else:
            gas_cost += (
                GasCosts.COLD_STORAGE_WRITE - GasCosts.COLD_STORAGE_ACCESS
            )
    else:
        gas_cost += GasCosts.WARM_ACCESS

    # Refund Counter Calculation
    if current_value != new_value:
        if original_value != 0 and current_value != 0 and new_value == 0:
            # Storage is cleared for the first time in the transaction
            evm.refund_counter += GasCosts.REFUND_STORAGE_CLEAR

        if original_value != 0 and current_value == 0:
            # Gas refund issued earlier to be reversed
            evm.refund_counter -= GasCosts.REFUND_STORAGE_CLEAR

        if original_value == new_value:
            # Storage slot being restored to its original value
            if original_value == 0:
                # Slot was originally empty and was SET earlier
                evm.refund_counter += int(
                    GasCosts.STORAGE_SET - GasCosts.WARM_ACCESS
                )
            else:
                # Slot was originally non-empty and was UPDATED earlier
                evm.refund_counter += int(
                    GasCosts.COLD_STORAGE_WRITE
                    - GasCosts.COLD_STORAGE_ACCESS
                    - GasCosts.WARM_ACCESS
                )

    charge_gas(evm, gas_cost)
    set_storage(tx_state, evm.message.current_target, key, new_value)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def tload(evm: Evm) -> None:
    """
    Loads to the stack, the value corresponding to a certain key from the
    transient storage of the current account.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    key = pop(evm.stack).to_be_bytes32()

    # GAS
    charge_gas(evm, GasCosts.WARM_ACCESS)

    # OPERATION
    value = get_transient_storage(
        evm.message.tx_env.state, evm.message.current_target, key
    )
    push(evm.stack, value)

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def tstore(evm: Evm) -> None:
    """
    Stores a value at a certain key in the current context's transient storage.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    if evm.message.is_static:
        raise WriteInStaticContext

    # STACK
    key = pop(evm.stack).to_be_bytes32()
    new_value = pop(evm.stack)

    # GAS
    charge_gas(evm, GasCosts.WARM_ACCESS)
    set_transient_storage(
        evm.message.tx_env.state,
        evm.message.current_target,
        key,
        new_value,
    )

    # PROGRAM COUNTER
    evm.pc += Uint(1)

```

---

#### System Opcodes

**(CREATE, CREATE2)**

```python
def create(evm: Evm) -> None:
    """
    Creates a new account with associated code.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    endowment = pop(evm.stack)
    memory_start_position = pop(evm.stack)
    memory_size = pop(evm.stack)

    # GAS
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(memory_start_position, memory_size)]
    )
    init_code_gas = init_code_cost(Uint(memory_size))

    charge_gas(
        evm, GasCosts.OPCODE_CREATE_BASE + extend_memory.cost + init_code_gas
    )

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    contract_address = compute_contract_address(
        evm.message.current_target,
        get_account(
            evm.message.tx_env.state, evm.message.current_target
        ).nonce,
    )

    generic_create(
        evm,
        endowment,
        contract_address,
        memory_start_position,
        memory_size,
    )

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def create2(evm: Evm) -> None:
    """
    Creates a new account with associated code.

    It's similar to the CREATE opcode except that the address of the new
    account depends on the init_code instead of the nonce of sender.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    endowment = pop(evm.stack)
    memory_start_position = pop(evm.stack)
    memory_size = pop(evm.stack)
    salt = pop(evm.stack).to_be_bytes32()

    # GAS
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(memory_start_position, memory_size)]
    )
    call_data_words = ceil32(Uint(memory_size)) // Uint(32)
    init_code_gas = init_code_cost(Uint(memory_size))
    charge_gas(
        evm,
        GasCosts.OPCODE_CREATE_BASE
        + GasCosts.OPCODE_KECCAK256_PER_WORD * call_data_words
        + extend_memory.cost
        + init_code_gas,
    )

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    contract_address = compute_create2_contract_address(
        evm.message.current_target,
        salt,
        memory_read_bytes(evm.memory, memory_start_position, memory_size),
    )

    generic_create(
        evm,
        endowment,
        contract_address,
        memory_start_position,
        memory_size,
    )

    # PROGRAM COUNTER
    evm.pc += Uint(1)

```

```python
def generic_create(
    evm: Evm,
    endowment: U256,
    contract_address: Address,
    memory_start_position: U256,
    memory_size: U256,
) -> None:
    """
    Core logic used by the `CREATE*` family of opcodes.
    """
    # This import causes a circular import error
    # if it's not moved inside this method
    from ...vm.interpreter import (
        MAX_INIT_CODE_SIZE,
        STACK_DEPTH_LIMIT,
        process_create_message,
    )

    # Check static context first
    if evm.message.is_static:
        raise WriteInStaticContext

    # Check max init code size early before memory read
    if memory_size > U256(MAX_INIT_CODE_SIZE):
        raise OutOfGasError

    tx_state = evm.message.tx_env.state

    call_data = memory_read_bytes(
        evm.memory, memory_start_position, memory_size
    )

    create_message_gas = max_message_call_gas(Uint(evm.gas_left))
    evm.gas_left -= create_message_gas
    evm.return_data = b""

    sender_address = evm.message.current_target
    sender = get_account(tx_state, sender_address)

    if (
        sender.balance < endowment
        or sender.nonce == Uint(2**64 - 1)
        or evm.message.depth + Uint(1) > STACK_DEPTH_LIMIT
    ):
        evm.gas_left += create_message_gas
        push(evm.stack, U256(0))
        return

    evm.accessed_addresses.add(contract_address)

    if account_has_code_or_nonce(
        tx_state, contract_address
    ) or account_has_storage(tx_state, contract_address):
        increment_nonce(tx_state, evm.message.current_target)
        push(evm.stack, U256(0))
        return

    increment_nonce(tx_state, evm.message.current_target)

    child_message = Message(
        block_env=evm.message.block_env,
        tx_env=evm.message.tx_env,
        caller=evm.message.current_target,
        target=Bytes0(),
        gas=create_message_gas,
        value=endowment,
        data=b"",
        code=call_data,
        current_target=contract_address,
        depth=evm.message.depth + Uint(1),
        code_address=None,
        should_transfer_value=True,
        is_static=False,
        accessed_addresses=evm.accessed_addresses.copy(),
        accessed_storage_keys=evm.accessed_storage_keys.copy(),
        disable_precompiles=False,
        parent_evm=evm,
    )
    child_evm = process_create_message(child_message)

    if child_evm.error:
        incorporate_child_on_error(evm, child_evm)
        evm.return_data = child_evm.output
        push(evm.stack, U256(0))
    else:
        incorporate_child_on_success(evm, child_evm)
        evm.return_data = b""
        push(evm.stack, U256.from_be_bytes(child_evm.message.current_target))

```

Difference between creating the contract through sending code to zero and using `CREATE*` opcodes is that we put `initcode` in the factory's memory and not take from the calldata of the transaction.

**(SELFDESTRUCT, REVERT, RETURN)**

```python
def return_(evm: Evm) -> None:
    """
    Halts execution returning output data.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    memory_start_position = pop(evm.stack)
    memory_size = pop(evm.stack)

    # GAS
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(memory_start_position, memory_size)]
    )

    charge_gas(evm, GasCosts.ZERO + extend_memory.cost)

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    evm.output = memory_read_bytes(
        evm.memory, memory_start_position, memory_size
    )

    evm.running = False

    # PROGRAM COUNTER
    pass

def selfdestruct(evm: Evm) -> None:
    """
    Halt execution and register account for later deletion.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    if evm.message.is_static:
        raise WriteInStaticContext

    # STACK
    beneficiary = to_address_masked(pop(evm.stack))

    # GAS
    gas_cost = GasCosts.OPCODE_SELFDESTRUCT_BASE

    is_cold_access = beneficiary not in evm.accessed_addresses
    if is_cold_access:
        gas_cost += GasCosts.COLD_ACCOUNT_ACCESS

    # check access gas cost before state access
    check_gas(evm, gas_cost)

    # STATE ACCESS
    tx_state = evm.message.tx_env.state
    if is_cold_access:
        evm.accessed_addresses.add(beneficiary)

    if (
        not is_account_alive(tx_state, beneficiary)
        and get_account(tx_state, evm.message.current_target).balance != 0
    ):
        gas_cost += GasCosts.OPCODE_SELFDESTRUCT_NEW_ACCOUNT

    charge_gas(evm, gas_cost)

    originator = evm.message.current_target
    originator_balance = get_account(tx_state, originator).balance

    # Transfer balance
    move_ether(tx_state, originator, beneficiary, originator_balance)

    # Emit transfer or burn log
    if originator in tx_state.created_accounts and beneficiary == originator:
        emit_burn_log(evm, originator, originator_balance)
    elif beneficiary != originator:
        emit_transfer_log(evm, originator, beneficiary, originator_balance)

    # Register account for deletion iff created in same transaction
    if originator in tx_state.created_accounts:
        # If beneficiary and originator are the same then the ether is burnt.
        set_account_balance(tx_state, originator, U256(0))
        evm.accounts_to_delete.add(originator)

    # HALT the execution
    evm.running = False

    # PROGRAM COUNTER
    pass


def revert(evm: Evm) -> None:
    """
    Stop execution and revert state changes, without consuming all provided gas
    and also has the ability to return a reason.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    memory_start_index = pop(evm.stack)
    size = pop(evm.stack)

    # GAS
    extend_memory = calculate_gas_extend_memory(
        evm.memory, [(memory_start_index, size)]
    )

    charge_gas(evm, extend_memory.cost)

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    output = memory_read_bytes(evm.memory, memory_start_index, size)
    evm.output = Bytes(output)
    raise Revert

    # PROGRAM COUNTER
    # no-op
```

`SELFDESTRUCT`:
Prior to [EIP-6780](https://eips.ethereum.org/EIPS/eip-6780), the SELFDESTRUCT opcode would completely erase a smart contract's code, storage, and nonce from the Ethereum state, regardless of when it was created. Now, it only deletes the account if it was created in the exact same transaction. If the account existed before the transaction started, SELFDESTRUCT will only transfer the contract's remaining ETH to the target address, but the account's state remains intact.

Under the Verkle tree design (future one), completely deleting an account from the state creates immense cryptographic complexity. When an account is deleted, the tree structure shifts, which makes generating and updating cryptographic proofs for that state difficult. By preventing SELFDESTRUCT from deleting historical accounts, developers effectively removed a massive roadblock to implementing Verkle trees.

If Ethereum completely disabled the ability for these helper contracts to self-destruct within the same transaction, thousands of legacy DeFi routers, hardcoded with this logic, would either permanently break or start leaving "dead" junk contracts permanently littered on the blockchain. 

**(CALL, DELEGATECALL, STATICCALL, CALLCODE)**

```python
def call(evm: Evm) -> None:
    """
    Message-call into an account.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    gas = Uint(pop(evm.stack))
    to = to_address_masked(pop(evm.stack))
    value = pop(evm.stack)
    memory_input_start_position = pop(evm.stack)
    memory_input_size = pop(evm.stack)
    memory_output_start_position = pop(evm.stack)
    memory_output_size = pop(evm.stack)

    if evm.message.is_static and value != U256(0):
        raise WriteInStaticContext

    # GAS
    extend_memory = calculate_gas_extend_memory(
        evm.memory,
        [
            (memory_input_start_position, memory_input_size),
            (memory_output_start_position, memory_output_size),
        ],
    )

    is_cold_access = to not in evm.accessed_addresses
    if is_cold_access:
        access_gas_cost = GasCosts.COLD_ACCOUNT_ACCESS
    else:
        access_gas_cost = GasCosts.WARM_ACCESS

    transfer_gas_cost = Uint(0) if value == 0 else GasCosts.CALL_VALUE

    # check static gas before state access
    check_gas(
        evm,
        access_gas_cost + transfer_gas_cost + extend_memory.cost,
    )

    # STATE ACCESS
    tx_state = evm.message.tx_env.state
    if is_cold_access:
        evm.accessed_addresses.add(to)

    create_gas_cost = GasCosts.NEW_ACCOUNT
    if value == 0 or is_account_alive(tx_state, to):
        create_gas_cost = Uint(0)

    extra_gas = access_gas_cost + transfer_gas_cost + create_gas_cost
    (
        is_delegated,
        code_address,
        delegation_access_cost,
    ) = calculate_delegation_cost(evm, to)

    if is_delegated:
        # check enough gas for delegation access
        extra_gas += delegation_access_cost
        check_gas(evm, extra_gas + extend_memory.cost)
        if code_address not in evm.accessed_addresses:
            evm.accessed_addresses.add(code_address)

    message_call_gas = calculate_message_call_gas(
        value,
        gas,
        Uint(evm.gas_left),
        extend_memory.cost,
        extra_gas,
    )
    charge_gas(evm, message_call_gas.cost + extend_memory.cost)

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    sender_balance = get_account(tx_state, evm.message.current_target).balance
    if sender_balance < value:
        push(evm.stack, U256(0))
        evm.return_data = b""
        evm.gas_left += message_call_gas.sub_call
    else:
        generic_call(
            evm,
            message_call_gas.sub_call,
            value,
            evm.message.current_target,
            to,
            code_address,
            True,
            False,
            memory_input_start_position,
            memory_input_size,
            memory_output_start_position,
            memory_output_size,
            is_delegated,
        )

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def delegatecall(evm: Evm) -> None:
    """
    Message-call into an account.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    gas = Uint(pop(evm.stack))
    code_address = to_address_masked(pop(evm.stack))
    memory_input_start_position = pop(evm.stack)
    memory_input_size = pop(evm.stack)
    memory_output_start_position = pop(evm.stack)
    memory_output_size = pop(evm.stack)

    # GAS
    extend_memory = calculate_gas_extend_memory(
        evm.memory,
        [
            (memory_input_start_position, memory_input_size),
            (memory_output_start_position, memory_output_size),
        ],
    )

    is_cold_access = code_address not in evm.accessed_addresses
    if is_cold_access:
        access_gas_cost = GasCosts.COLD_ACCOUNT_ACCESS
    else:
        access_gas_cost = GasCosts.WARM_ACCESS

    # check static gas before state access
    check_gas(evm, access_gas_cost + extend_memory.cost)

    # STATE ACCESS
    if is_cold_access:
        evm.accessed_addresses.add(code_address)

    extra_gas = access_gas_cost
    (
        is_delegated,
        code_address,
        delegation_access_cost,
    ) = calculate_delegation_cost(evm, code_address)

    if is_delegated:
        # check enough gas for delegation access
        extra_gas += delegation_access_cost
        check_gas(evm, extra_gas + extend_memory.cost)
        if code_address not in evm.accessed_addresses:
            evm.accessed_addresses.add(code_address)

    message_call_gas = calculate_message_call_gas(
        U256(0),
        gas,
        Uint(evm.gas_left),
        extend_memory.cost,
        extra_gas,
    )
    charge_gas(evm, message_call_gas.cost + extend_memory.cost)

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    generic_call(
        evm,
        message_call_gas.sub_call,
        evm.message.value,
        evm.message.caller,
        evm.message.current_target,
        code_address,
        False,
        False,
        memory_input_start_position,
        memory_input_size,
        memory_output_start_position,
        memory_output_size,
        is_delegated,
    )

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def staticcall(evm: Evm) -> None:
    """
    Message-call into an account.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    gas = Uint(pop(evm.stack))
    to = to_address_masked(pop(evm.stack))
    memory_input_start_position = pop(evm.stack)
    memory_input_size = pop(evm.stack)
    memory_output_start_position = pop(evm.stack)
    memory_output_size = pop(evm.stack)

    # GAS
    extend_memory = calculate_gas_extend_memory(
        evm.memory,
        [
            (memory_input_start_position, memory_input_size),
            (memory_output_start_position, memory_output_size),
        ],
    )

    is_cold_access = to not in evm.accessed_addresses
    if is_cold_access:
        access_gas_cost = GasCosts.COLD_ACCOUNT_ACCESS
    else:
        access_gas_cost = GasCosts.WARM_ACCESS

    # check static gas before state access
    check_gas(evm, access_gas_cost + extend_memory.cost)

    # STATE ACCESS
    if is_cold_access:
        evm.accessed_addresses.add(to)

    extra_gas = access_gas_cost
    (
        is_delegated,
        code_address,
        delegation_access_cost,
    ) = calculate_delegation_cost(evm, to)

    if is_delegated:
        # check enough gas for delegation access
        extra_gas += delegation_access_cost
        check_gas(evm, extra_gas + extend_memory.cost)
        if code_address not in evm.accessed_addresses:
            evm.accessed_addresses.add(code_address)

    message_call_gas = calculate_message_call_gas(
        U256(0),
        gas,
        Uint(evm.gas_left),
        extend_memory.cost,
        extra_gas,
    )
    charge_gas(evm, message_call_gas.cost + extend_memory.cost)

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    generic_call(
        evm,
        message_call_gas.sub_call,
        U256(0),
        evm.message.current_target,
        to,
        code_address,
        True,
        True,
        memory_input_start_position,
        memory_input_size,
        memory_output_start_position,
        memory_output_size,
        is_delegated,
    )

    # PROGRAM COUNTER
    evm.pc += Uint(1)

def callcode(evm: Evm) -> None:
    """
    Message-call into this account with alternative account's code.

    Parameters
    ----------
    evm :
        The current EVM frame.

    """
    # STACK
    gas = Uint(pop(evm.stack))
    code_address = to_address_masked(pop(evm.stack))
    value = pop(evm.stack)
    memory_input_start_position = pop(evm.stack)
    memory_input_size = pop(evm.stack)
    memory_output_start_position = pop(evm.stack)
    memory_output_size = pop(evm.stack)

    # GAS
    to = evm.message.current_target

    extend_memory = calculate_gas_extend_memory(
        evm.memory,
        [
            (memory_input_start_position, memory_input_size),
            (memory_output_start_position, memory_output_size),
        ],
    )

    is_cold_access = code_address not in evm.accessed_addresses
    if is_cold_access:
        access_gas_cost = GasCosts.COLD_ACCOUNT_ACCESS
    else:
        access_gas_cost = GasCosts.WARM_ACCESS

    transfer_gas_cost = Uint(0) if value == 0 else GasCosts.CALL_VALUE

    # check static gas before state access
    check_gas(
        evm,
        access_gas_cost + extend_memory.cost + transfer_gas_cost,
    )

    # STATE ACCESS
    tx_state = evm.message.tx_env.state
    if is_cold_access:
        evm.accessed_addresses.add(code_address)

    extra_gas = access_gas_cost + transfer_gas_cost
    (
        is_delegated,
        code_address,
        delegation_access_cost,
    ) = calculate_delegation_cost(evm, code_address)

    if is_delegated:
        # check enough gas for delegation access
        extra_gas += delegation_access_cost
        check_gas(evm, extra_gas + extend_memory.cost)
        if code_address not in evm.accessed_addresses:
            evm.accessed_addresses.add(code_address)

    message_call_gas = calculate_message_call_gas(
        value,
        gas,
        Uint(evm.gas_left),
        extend_memory.cost,
        extra_gas,
    )
    charge_gas(evm, message_call_gas.cost + extend_memory.cost)

    # OPERATION
    evm.memory += b"\x00" * extend_memory.expand_by
    sender_balance = get_account(tx_state, evm.message.current_target).balance

    if sender_balance < value:
        push(evm.stack, U256(0))
        evm.return_data = b""
        evm.gas_left += message_call_gas.sub_call
    else:
        generic_call(
            evm,
            message_call_gas.sub_call,
            value,
            evm.message.current_target,
            to,
            code_address,
            True,
            False,
            memory_input_start_position,
            memory_input_size,
            memory_output_start_position,
            memory_output_size,
            is_delegated,
        )

    # PROGRAM COUNTER
    evm.pc += Uint(1)


def generic_call(
    evm: Evm,
    gas: Uint,
    value: U256,
    caller: Address,
    to: Address,
    code_address: Address,
    should_transfer_value: bool,
    is_staticcall: bool,
    memory_input_start_position: U256,
    memory_input_size: U256,
    memory_output_start_position: U256,
    memory_output_size: U256,
    disable_precompiles: bool,
) -> None:
    """
    Perform the core logic of the `CALL*` family of opcodes.
    """
    from ...vm.interpreter import STACK_DEPTH_LIMIT, process_message

    evm.return_data = b""

    if evm.message.depth + Uint(1) > STACK_DEPTH_LIMIT:
        evm.gas_left += gas
        push(evm.stack, U256(0))
        return

    tx_state = evm.message.tx_env.state
    code_hash = get_account(tx_state, code_address).code_hash
    code = get_code(tx_state, code_hash)

    call_data = memory_read_bytes(
        evm.memory, memory_input_start_position, memory_input_size
    )

    child_message = Message(
        block_env=evm.message.block_env,
        tx_env=evm.message.tx_env,
        caller=caller,
        target=to,
        gas=gas,
        value=value,
        data=call_data,
        code=code,
        current_target=to,
        depth=evm.message.depth + Uint(1),
        code_address=code_address,
        should_transfer_value=should_transfer_value,
        is_static=True if is_staticcall else evm.message.is_static,
        accessed_addresses=evm.accessed_addresses.copy(),
        accessed_storage_keys=evm.accessed_storage_keys.copy(),
        disable_precompiles=disable_precompiles,
        parent_evm=evm,
    )

    child_evm = process_message(child_message)

    if child_evm.error:
        incorporate_child_on_error(evm, child_evm)
        evm.return_data = child_evm.output
        push(evm.stack, U256(0))
    else:
        incorporate_child_on_success(evm, child_evm)
        evm.return_data = child_evm.output
        push(evm.stack, CALL_SUCCESS)

    actual_output_size = min(memory_output_size, U256(len(child_evm.output)))
    memory_write(
        evm.memory,
        memory_output_start_position,
        child_evm.output[:actual_output_size],
    )
```

`CALLCODE` is completely deprecated. It doesn't preserve the original msg.sender and msg.value (from the transaction or `CALL` from another contract) which leads to security loopholes.

`STATICCALL` allows smart contracts to call other contracts safely, without allowing any modifications to the state.


## Specifications. The Building Blocks of the Block Validation Flow

**Entrypoint function**
```python
def state_transition(chain: BlockChain, block: Block) -> None:
    """
    Attempts to apply a block to an existing block chain.

    All parts of the block's contents need to be verified before being added
    to the chain. Blocks are verified by ensuring that the contents of the
    block make logical sense with the contents of the parent block. The
    information in the block's header must also match the corresponding
    information in the block.

    To implement Ethereum, in theory clients are only required to store the
    most recent 255 blocks of the chain since as far as execution is
    concerned, only those blocks are accessed. Practically, however, clients
    should store more blocks to handle reorgs.

    Parameters
    ----------
    chain :
        History and current state.
    block :
        Block to apply to `chain`.

    """
    chain_context = ChainContext(
        chain_id=chain.chain_id,
        block_hashes=get_last_256_block_hashes(chain),
        parent_header=chain.blocks[-1].header,
    )

    block_diff = execute_block(block, chain.state, chain_context)

    apply_changes_to_state(chain.state, block_diff)
    chain.blocks.append(block)
    if len(chain.blocks) > 255:
        # Real clients have to store more blocks to deal with reorgs, but the
        # protocol only requires the last 255
        chain.blocks = chain.blocks[-255:]
```

255 blocks because of the `BLOCKHASH` opcode, which retrieves a block hash by index.

### Initial Validation

#### Initial Validations of Headers and Transactions

```python
def validate_header(
    parent_header: Header | PreviousHeader, header: Header
) -> None:
    """
    Verify a block header against its parent.

    In order to consider a block's header valid, the logic for the
    quantities in the header should match the logic for the block itself.
    For example the header timestamp should be greater than the block's parent
    timestamp because the block was created *after* the parent block.
    Additionally, the block's number should be directly following the parent
    block's number since it is the next block in the sequence.

    Parameters
    ----------
    parent_header :
        Header of the parent block.
    header :
        Header to check for correctness.

    """
    if header.number < Uint(1):
        raise InvalidBlock

    excess_blob_gas = calculate_excess_blob_gas(parent_header)
    if header.excess_blob_gas != excess_blob_gas:
        raise InvalidBlock

    if header.gas_used > header.gas_limit:
        raise InvalidBlock

    expected_base_fee_per_gas = calculate_base_fee_per_gas(
        header.gas_limit,
        parent_header.gas_limit,
        parent_header.gas_used,
        parent_header.base_fee_per_gas,
    )
    if expected_base_fee_per_gas != header.base_fee_per_gas:
        raise InvalidBlock
    if header.timestamp <= parent_header.timestamp:
        raise InvalidBlock
    if header.number != parent_header.number + Uint(1):
        raise InvalidBlock
    if len(header.extra_data) > 32:
        raise InvalidBlock
    if header.difficulty != 0:
        raise InvalidBlock
    if header.nonce != b"\x00\x00\x00\x00\x00\x00\x00\x00":
        raise InvalidBlock
    if header.ommers_hash != EMPTY_OMMER_HASH:
        raise InvalidBlock

    block_parent_hash = keccak256(rlp.encode(parent_header))
    if header.parent_hash != block_parent_hash:
        raise InvalidBlock
```

```python
def count_tokens_in_data(data: bytes) -> Uint:
    """
    Count the data tokens in arbitrary input bytes.

    Zero bytes count as 1 token; non-zero bytes count as 4 tokens.
    """
    num_zeros = Uint(data.count(0))
    num_non_zeros = ulen(data) - num_zeros

    return num_zeros + num_non_zeros * Uint(4)

def calculate_intrinsic_cost(tx: Transaction) -> Tuple[Uint, Uint]:
    """
    Calculates the gas that is charged before execution is started.

    The intrinsic cost of the transaction is charged before execution has
    begun. Functions/operations in the EVM cost money to execute so this
    intrinsic cost is for the operations that need to be paid for as part of
    the transaction. Data transfer, for example, is part of this intrinsic
    cost. It costs ether to send data over the wire and that ether is
    accounted for in the intrinsic cost calculated in this function. This
    intrinsic cost must be calculated and paid for before execution in order
    for all operations to be implemented.

    The intrinsic cost includes:
    1. Base cost (`TX_BASE`)
    2. Cost for data (zero and non-zero bytes)
    3. Cost for contract creation (if applicable)
    4. Cost for access list entries (if applicable)
    5. Cost for authorizations (if applicable)


    This function takes a transaction as a parameter and returns the intrinsic
    gas cost of the transaction and the minimum gas cost used by the
    transaction based on the calldata size.
    """
    from .vm.gas import GasCosts, init_code_cost

    tokens_in_calldata = count_tokens_in_data(tx.data)

    data_cost = tokens_in_calldata * GasCosts.TX_DATA_TOKEN_STANDARD

    if tx.to == Bytes0(b""):
        create_cost = GasCosts.TX_CREATE + init_code_cost(ulen(tx.data))
    else:
        create_cost = Uint(0)

    access_list_cost = Uint(0)
    tokens_in_access_list = Uint(0)
    if has_access_list(tx):
        for access in tx.access_list:
            access_list_cost += GasCosts.TX_ACCESS_LIST_ADDRESS
            access_list_cost += (
                ulen(access.slots) * GasCosts.TX_ACCESS_LIST_STORAGE_KEY
            )
            tokens_in_access_list += ACCESS_LIST_ADDRESS_FLOOR_TOKENS
            tokens_in_access_list += (
                ulen(access.slots) * ACCESS_LIST_STORAGE_KEY_FLOOR_TOKENS
            )

    # Data token floor cost for access list bytes.
    access_list_cost += tokens_in_access_list * GasCosts.TX_DATA_TOKEN_FLOOR

    auth_cost = Uint(0)
    if isinstance(tx, SetCodeTransaction):
        auth_cost += Uint(
            GasCosts.AUTH_PER_EMPTY_ACCOUNT * len(tx.authorizations)
        )

    # EIP-7976 floor tokens: all calldata bytes count uniformly.
    floor_tokens_in_calldata = ulen(tx.data) * GasCosts.TX_DATA_TOKEN_STANDARD

    # Total floor tokens.
    total_floor_tokens = floor_tokens_in_calldata + tokens_in_access_list

    # Floor gas cost (EIP-7623: minimum gas for data-heavy transactions).
    data_floor_gas_cost = (
        total_floor_tokens * GasCosts.TX_DATA_TOKEN_FLOOR + GasCosts.TX_BASE
    )

    return (
        Uint(
            GasCosts.TX_BASE
            + data_cost
            + create_cost
            + access_list_cost
            + auth_cost
        ),
        data_floor_gas_cost,
    )


def validate_transaction(tx: Transaction) -> Tuple[Uint, Uint]:
    """
    Verifies a transaction.

    The gas in a transaction gets used to pay for the intrinsic cost of
    operations, therefore if there is insufficient gas then it would not
    be possible to execute a transaction and it will be declared invalid.

    Additionally, the nonce of a transaction must not equal or exceed the
    limit defined in [EIP-2681].
    In practice, defining the limit as ``2**64-1`` has no impact because
    sending ``2**64-1`` transactions is improbable. It's not strictly
    impossible though, ``2**64-1`` transactions is the entire capacity of the
    Ethereum blockchain at 2022 gas limits for a little over 22 years.

    Also, the code size of a contract creation transaction must be within
    limits of the protocol.

    This function takes a transaction as a parameter and returns the intrinsic
    gas cost and the minimum calldata gas cost for the transaction after
    validation. It throws an `InsufficientTransactionGasError` exception if
    the transaction does not provide enough gas to cover the intrinsic cost,
    and a `NonceOverflowError` exception if the nonce is greater than
    `2**64 - 2`. It also raises an `InitCodeTooLargeError` if the code size of
    a contract creation transaction exceeds the maximum allowed size.

    [EIP-2681]: https://eips.ethereum.org/EIPS/eip-2681
    [EIP-7623]: https://eips.ethereum.org/EIPS/eip-7623
    """
    from .vm.interpreter import MAX_INIT_CODE_SIZE

    intrinsic_gas, data_floor_gas_cost = calculate_intrinsic_cost(tx)
    if max(intrinsic_gas, data_floor_gas_cost) > tx.gas:
        raise InsufficientTransactionGasError("Insufficient gas")
    if U256(tx.nonce) >= U256(U64.MAX_VALUE):
        raise NonceOverflowError("Nonce too high")
    if tx.to == Bytes0(b"") and len(tx.data) > MAX_INIT_CODE_SIZE:
        raise InitCodeTooLargeError("Code size too large")
    if tx.gas > TX_MAX_GAS_LIMIT:
        raise TransactionGasLimitExceededError("Gas limit too high")

    return intrinsic_gas, data_floor_gas_cost

def check_transaction(
    block_env: vm.BlockEnvironment,
    block_output: vm.BlockOutput,
    tx: Transaction,
    tx_state: TransactionState,
) -> Tuple[Address, Uint, Tuple[VersionedHash, ...], U64]:
    """
    Check if the transaction is includable in the block.

    Parameters
    ----------
    block_env :
        The block scoped environment.
    block_output :
        The block output for the current block.
    tx :
        The transaction.
    tx_state :
        The transaction state tracker.

    Returns
    -------
    sender_address :
        The sender of the transaction.
    effective_gas_price :
        The price to charge for gas when the transaction is executed.
    blob_versioned_hashes :
        The blob versioned hashes of the transaction.
    tx_blob_gas_used:
        The blob gas used by the transaction.

    Raises
    ------
    InvalidBlock :
        If the transaction is not includable.
    GasUsedExceedsLimitError :
        If the gas used by the transaction exceeds the block's gas limit.
    NonceMismatchError :
        If the nonce of the transaction is not equal to the sender's nonce.
    InsufficientBalanceError :
        If the sender's balance is not enough to pay for the transaction.
    InvalidSenderError :
        If the transaction is from an address that does not exist anymore.
    PriorityFeeGreaterThanMaxFeeError :
        If the priority fee is greater than the maximum fee per gas.
    InsufficientMaxFeePerGasError :
        If the maximum fee per gas is insufficient for the transaction.
    InsufficientMaxFeePerBlobGasError :
        If the maximum fee per blob gas is insufficient for the transaction.
    BlobGasLimitExceededError :
        If the blob gas used by the transaction exceeds the block's blob gas
        limit.
    InvalidBlobVersionedHashError :
        If the transaction contains a blob versioned hash with an invalid
        version.
    NoBlobDataError :
        If the transaction is a type 3 but has no blobs.
    BlobCountExceededError :
        If the transaction is a type 3 and has more blobs than the limit.
    TransactionTypeContractCreationError:
        If the transaction type is not allowed to create contracts.
    EmptyAuthorizationListError :
        If the transaction is a SetCodeTransaction and the authorization list
        is empty.

    """
    gas_available = block_env.block_gas_limit - block_output.block_gas_used
    blob_gas_available = MAX_BLOB_GAS_PER_BLOCK - block_output.blob_gas_used

    if tx.gas > gas_available:
        raise GasUsedExceedsLimitError("gas used exceeds limit")

    tx_blob_gas_used = calculate_total_blob_gas(tx)
    if tx_blob_gas_used > blob_gas_available:
        raise BlobGasLimitExceededError("blob gas limit exceeded")

    sender_address = recover_sender(block_env.chain_id, tx)
    sender_account = get_account(tx_state, sender_address)

    if isinstance(
        tx, (FeeMarketTransaction, BlobTransaction, SetCodeTransaction)
    ):
        if tx.max_fee_per_gas < tx.max_priority_fee_per_gas:
            raise PriorityFeeGreaterThanMaxFeeError(
                "priority fee greater than max fee"
            )
        if tx.max_fee_per_gas < block_env.base_fee_per_gas:
            raise InsufficientMaxFeePerGasError(
                tx.max_fee_per_gas, block_env.base_fee_per_gas
            )

        priority_fee_per_gas = min(
            tx.max_priority_fee_per_gas,
            tx.max_fee_per_gas - block_env.base_fee_per_gas,
        )
        effective_gas_price = priority_fee_per_gas + block_env.base_fee_per_gas
        max_gas_fee = tx.gas * tx.max_fee_per_gas
    else:
        if tx.gas_price < block_env.base_fee_per_gas:
            raise InvalidBlock
        effective_gas_price = tx.gas_price
        max_gas_fee = tx.gas * tx.gas_price

    if isinstance(tx, BlobTransaction):
        blob_count = len(tx.blob_versioned_hashes)
        if blob_count == 0:
            raise NoBlobDataError("no blob data in transaction")
        if blob_count > BLOB_COUNT_LIMIT:
            raise BlobCountExceededError(
                f"Tx has {blob_count} blobs. Max allowed: {BLOB_COUNT_LIMIT}"
            )
        for blob_versioned_hash in tx.blob_versioned_hashes:
            if blob_versioned_hash[0:1] != VERSIONED_HASH_VERSION_KZG:
                raise InvalidBlobVersionedHashError(
                    "invalid blob versioned hash"
                )

        blob_gas_price = calculate_blob_gas_price(block_env.excess_blob_gas)
        if Uint(tx.max_fee_per_blob_gas) < blob_gas_price:
            raise InsufficientMaxFeePerBlobGasError(
                "insufficient max fee per blob gas"
            )

        max_gas_fee += Uint(calculate_total_blob_gas(tx)) * Uint(
            tx.max_fee_per_blob_gas
        )
        blob_versioned_hashes = tx.blob_versioned_hashes
    else:
        blob_versioned_hashes = ()

    if isinstance(tx, (BlobTransaction, SetCodeTransaction)):
        if not isinstance(tx.to, Address):
            raise TransactionTypeContractCreationError(tx)

    if isinstance(tx, SetCodeTransaction):
        if not any(tx.authorizations):
            raise EmptyAuthorizationListError("empty authorization list")

    if sender_account.nonce > Uint(tx.nonce):
        raise NonceMismatchError("nonce too low")
    elif sender_account.nonce < Uint(tx.nonce):
        raise NonceMismatchError("nonce too high")

    if Uint(sender_account.balance) < max_gas_fee + Uint(tx.value):
        raise InsufficientBalanceError("insufficient sender balance")
    sender_code = get_code(tx_state, sender_account.code_hash)
    if sender_account.code_hash != EMPTY_CODE_HASH and not is_valid_delegation(
        sender_code
    ):
        raise InvalidSenderError("not EOA")

    return (
        sender_address,
        effective_gas_price,
        blob_versioned_hashes,
        tx_blob_gas_used,
    )

```

token-counting in `calculate_intrinsic_cost`:
[EIP-7623](https://eips.ethereum.org/EIPS/eip-7623), [EIP-7976](https://eips.ethereum.org/EIPS/eip-7976) and [EIP-7981](https://eips.ethereum.org/EIPS/eip-7981). The idea is to deter users to store big chunck of data on the blockchain.

So, `access_list_cost` is
1. `pre-warming those storage slots` = standard, for each account `account * 2400 + slots * 1900`
2. `permanently storing that data`: `tokens` = for each account `account * 80 + slots * 128`; `tokens * 16`

Gas for a transaction is either
1. `calldata` = `count_tokens_in_data` * 4; 21000 + `calldata` + `possible creation of a contract` + `access_list_cost` + `possible creation of an account` + `EVM calculations`
2. `calldata` = `len(tx.data)` * 4 * 16; 21000 + `calldata`

If the transaction doesn't have enough EVM calculations (only was used to store the data) or is too data-heavy, you pay much more. Normal blockchain interfactions (Tokens, DeFi) are not affected due to their callback being small and EVM intructution-list long enough.

### Execution

#### Execution of Blocks

```python
def execute_block(
    block: Block,
    pre_state: State,
    chain_context: ChainContext,
) -> BlockDiff:
    """
    Execute a block and validate the resulting roots against the header.

    This method is idempotent.

    Parameters
    ----------
    block :
        Block to validate and execute.
    pre_state :
        Pre-execution state provider.
    chain_context :
        Chain context that the block may need during execution.

    Returns
    -------
    block_diff : `BlockDiff`
        Account, storage, and code changes produced by block execution.

    """
    if len(rlp.encode(block)) > MAX_RLP_BLOCK_SIZE:
        raise InvalidBlock("Block rlp size exceeds MAX_RLP_BLOCK_SIZE")

    parent_header = chain_context.parent_header
    validate_header(parent_header, block.header)

    if block.ommers != ():
        raise InvalidBlock

    block_state = BlockState(pre_state=pre_state)

    block_env = vm.BlockEnvironment(
        chain_id=chain_context.chain_id,
        state=block_state,
        block_gas_limit=block.header.gas_limit,
        block_hashes=chain_context.block_hashes,
        coinbase=block.header.coinbase,
        number=block.header.number,
        base_fee_per_gas=block.header.base_fee_per_gas,
        time=block.header.timestamp,
        prev_randao=block.header.prev_randao,
        excess_blob_gas=block.header.excess_blob_gas,
        parent_beacon_block_root=block.header.parent_beacon_block_root,
        block_access_list_builder=BlockAccessListBuilder(),
        slot_number=block.header.slot_number,
    )

    block_output = apply_body(
        block_env=block_env,
        transactions=block.transactions,
        withdrawals=block.withdrawals,
    )
    block_diff = extract_block_diff(block_state)
    block_state_root, _ = pre_state.compute_state_root_and_trie_changes(
        block_diff.account_changes, block_diff.storage_changes
    )
    transactions_root = root(block_output.transactions_trie)
    receipt_root = root(block_output.receipts_trie)
    block_logs_bloom = logs_bloom(block_output.block_logs)
    withdrawals_root = root(block_output.withdrawals_trie)
    requests_hash = compute_requests_hash(block_output.requests)
    computed_block_access_list_hash = hash_block_access_list(
        block_output.block_access_list
    )

    if block_output.block_gas_used != block.header.gas_used:
        raise InvalidBlock(
            f"{block_output.block_gas_used} != {block.header.gas_used}"
        )
    if transactions_root != block.header.transactions_root:
        raise InvalidBlock
    if block_state_root != block.header.state_root:
        raise InvalidBlock
    if receipt_root != block.header.receipt_root:
        raise InvalidBlock
    if block_logs_bloom != block.header.bloom:
        raise InvalidBlock
    if withdrawals_root != block.header.withdrawals_root:
        raise InvalidBlock
    if block_output.blob_gas_used != block.header.blob_gas_used:
        raise InvalidBlock
    if requests_hash != block.header.requests_hash:
        raise InvalidBlock
    if computed_block_access_list_hash != block.header.block_access_list_hash:
        raise InvalidBlock("Invalid block access list hash")

    return block_diff


def apply_body(
    block_env: vm.BlockEnvironment,
    transactions: Tuple[LegacyTransaction | Bytes, ...],
    withdrawals: Tuple[Withdrawal, ...],
) -> vm.BlockOutput:
    """
    Executes a block.

    Many of the contents of a block are stored in data structures called
    tries. There is a transactions trie which is similar to a ledger of the
    transactions stored in the current block. There is also a receipts trie
    which stores the results of executing a transaction, like the post state
    and gas used. This function creates and executes the block that is to be
    added to the chain.

    Parameters
    ----------
    block_env :
        The block scoped environment.
    transactions :
        Transactions included in the block.
    withdrawals :
        Withdrawals to be processed in the current block.

    Returns
    -------
    block_output :
        The block output for the current block.

    """
    block_output = vm.BlockOutput()

    process_unchecked_system_transaction(
        block_env=block_env,
        target_address=BEACON_ROOTS_ADDRESS,
        data=block_env.parent_beacon_block_root,
    )

    process_unchecked_system_transaction(
        block_env=block_env,
        target_address=HISTORY_STORAGE_ADDRESS,
        data=block_env.block_hashes[-1],  # The parent hash
    )

    for i, tx in enumerate(map(decode_transaction, transactions)):
        process_transaction(block_env, block_output, tx, Uint(i))

    # EIP-7928: Post-execution operations use index N+1
    block_env.block_access_list_builder.block_access_index = BlockAccessIndex(
        ulen(transactions) + Uint(1)
    )

    process_withdrawals(block_env, block_output, withdrawals)

    process_general_purpose_requests(
        block_env=block_env,
        block_output=block_output,
    )

    block_output.block_access_list = build_block_access_list(
        block_env.block_access_list_builder, block_env.state
    )

    # Validate block access list gas limit constraint (EIP-7928)
    validate_block_access_list_gas_limit(
        block_access_list=block_output.block_access_list,
        block_gas_limit=block_env.block_gas_limit,
    )

    return block_output

```

`validate_block_access_list_gas_limit`: You can see the code [above](#block-level-access-lists). 
`extract_block_diff`: You can see the code [above](#state-tracker-in-eels). 

---

#### Execution of General Transactions

```python
def process_transaction(
    block_env: vm.BlockEnvironment,
    block_output: vm.BlockOutput,
    tx: Transaction,
    index: Uint,
) -> None:
    """
    Execute a transaction against the provided environment.

    This function processes the actions needed to execute a transaction.
    It decrements the sender's account balance after calculating the gas fee
    and refunds them the proper amount after execution. Calling contracts,
    deploying code, and incrementing nonces are all examples of actions that
    happen within this function or from a call made within this function.

    Accounts that are marked for deletion are processed and destroyed after
    execution.

    Parameters
    ----------
    block_env :
        Environment for the Ethereum Virtual Machine.
    block_output :
        The block output for the current block.
    tx :
        Transaction to execute.
    index:
        Index of the transaction in the block.

    """
    block_env.block_access_list_builder.block_access_index = BlockAccessIndex(
        index + Uint(1)
    )
    tx_state = TransactionState(parent=block_env.state)

    trie_set(
        block_output.transactions_trie,
        rlp.encode(index),
        encode_transaction(tx),
    )

    intrinsic_gas, calldata_floor_gas_cost = validate_transaction(tx)

    (
        sender,
        effective_gas_price,
        blob_versioned_hashes,
        tx_blob_gas_used,
    ) = check_transaction(
        block_env=block_env,
        block_output=block_output,
        tx=tx,
        tx_state=tx_state,
    )

    sender_account = get_account(tx_state, sender)

    if isinstance(tx, BlobTransaction):
        blob_gas_fee = calculate_data_fee(block_env.excess_blob_gas, tx)
    else:
        blob_gas_fee = Uint(0)

    effective_gas_fee = tx.gas * effective_gas_price

    gas = tx.gas - intrinsic_gas

    increment_nonce(tx_state, sender)

    sender_balance_after_gas_fee = (
        Uint(sender_account.balance) - effective_gas_fee - blob_gas_fee
    )
    set_account_balance(tx_state, sender, U256(sender_balance_after_gas_fee))

    access_list_addresses = set()
    access_list_storage_keys = set()
    access_list_addresses.add(block_env.coinbase)
    if has_access_list(tx):
        for access in tx.access_list:
            access_list_addresses.add(access.account)
            for slot in access.slots:
                access_list_storage_keys.add((access.account, slot))

    authorizations: Tuple[Authorization, ...] = ()
    if isinstance(tx, SetCodeTransaction):
        authorizations = tx.authorizations

    tx_env = vm.TransactionEnvironment(
        origin=sender,
        gas_price=effective_gas_price,
        gas=gas,
        access_list_addresses=access_list_addresses,
        access_list_storage_keys=access_list_storage_keys,
        state=tx_state,
        blob_versioned_hashes=blob_versioned_hashes,
        authorizations=authorizations,
        index_in_block=index,
        tx_hash=get_transaction_hash(encode_transaction(tx)),
    )

    message = prepare_message(
        block_env,
        tx_env,
        tx,
    )

    tx_output = process_message_call(message)

    # For EIP-7623 we first calculate the execution_gas_used, which includes
    # the execution gas refund.
    tx_gas_used_before_refund = tx.gas - tx_output.gas_left
    tx_gas_refund = min(
        tx_gas_used_before_refund // Uint(5), Uint(tx_output.refund_counter)
    )
    tx_gas_used_after_refund = tx_gas_used_before_refund - tx_gas_refund

    # Transactions with less execution_gas_used than the floor pay at the
    # floor cost.
    tx_gas_used = max(tx_gas_used_after_refund, calldata_floor_gas_cost)
    block_gas_used_in_tx = max(
        tx_gas_used_before_refund, calldata_floor_gas_cost
    )

    tx_gas_left = tx.gas - tx_gas_used
    gas_refund_amount = tx_gas_left * effective_gas_price

    # For non-1559 transactions effective_gas_price == tx.gas_price
    priority_fee_per_gas = effective_gas_price - block_env.base_fee_per_gas
    transaction_fee = tx_gas_used * priority_fee_per_gas

    # refund gas
    create_ether(tx_state, sender, U256(gas_refund_amount))

    # transfer miner fees
    create_ether(tx_state, block_env.coinbase, U256(transaction_fee))

    # EIP-7708: Emit burn logs for balances held by accounts marked for
    # deletion AFTER miner fee transfer.
    finalization_logs: List[Log] = []
    for address in sorted(tx_output.accounts_to_delete):
        balance = get_account(tx_state, address).balance
        if balance > U256(0):
            padded_address = left_pad_zero_bytes(address, 32)
            finalization_logs.append(
                Log(
                    address=vm.SYSTEM_ADDRESS,
                    topics=(
                        vm.BURN_TOPIC,
                        Hash32(padded_address),
                    ),
                    data=balance.to_be_bytes32(),
                )
            )

    all_logs = tx_output.logs + tuple(finalization_logs)

    block_output.cumulative_gas_used += tx_gas_used
    block_output.block_gas_used += block_gas_used_in_tx
    block_output.blob_gas_used += tx_blob_gas_used

    receipt = make_receipt(
        tx,
        tx_output.error,
        block_output.cumulative_gas_used,
        all_logs,
    )

    receipt_key = rlp.encode(Uint(index))
    block_output.receipt_keys += (receipt_key,)

    trie_set(
        block_output.receipts_trie,
        receipt_key,
        receipt,
    )

    block_output.block_logs += all_logs

    for address in tx_output.accounts_to_delete:
        destroy_account(tx_state, address)

    incorporate_tx_into_block(tx_state, block_env.block_access_list_builder)

```

`tx_gas_used_before_refund // Uint(5)`:
[EIP-3529](https://eips.ethereum.org/EIPS/eip-3529). Also see [`sstore`](#storage-opcodes) function.
Originally, Ethereum rewarded developers with gas refunds for "good state hygiene"—specifically, clearing unused storage (SSTORE from non-zero to zero) or deleting contracts (SELFDESTRUCT).

However, developers abused this system to create GasTokens. They would mint tokens that hoarded dummy data during periods when network gas fees were low, and then delete that data to claim massive gas refunds when the network was congested. This allowed them to subsidize their own transactions but forced the network to process inefficient operations and exacerbated state bloat.

To fix this, EIP-3529 essentially killed the viability of GasTokens via three parameter changes:

1. Removed the SELFDESTRUCT refund: The 24,000 gas refund for destroying a contract was reduced to 0.
2. Reduced the SSTORE clearing refund: The refund for setting a non-zero storage slot to zero (`SSTORE_CLEARS_SCHEDULE`, now `REFUND_STORAGE_GAS`) was slashed from 15,000 gas to 4,800 gas.
3. Lowered the Max Refund Cap: Previously, refunds could pay for up to 50% (gas_used / 2) of a transaction's total gas cost. EIP-3529 lowered this cap to a maximum of 20% (gas_used / 5).

Exception: EIP-3529 preserved a specific 19,900 gas refund for operations that go 0 -> 1 -> 0 within the same transaction. This was intentionally left intact so that anti-reentrancy locks (a crucial smart contract security feature) remained cheap (costing ~100 gas). It is obsolete now. Cancun introduced Transient Storage (TLOAD and TSTORE), providing developers with a native, temporary storage mechanism that automatically clears at the end of a transaction for the same 100 gas.

`tx_gas_used = max(tx_gas_used_after_refund, calldata_floor_gas_cost)`:
See explanation of [`validate_transaction`](#validate-transaction) function above.

`block_gas_used_in_tx = max(tx_gas_used_before_refund, calldata_floor_gas_cost)`:
[EIP-7778](https://eips.ethereum.org/EIPS/eip-7778). Previously `block_gas_used_in_tx` excluded refunds from the used gas amount. This makes gas limit increses affect and block building a bit more predictable, because you don't have to account for computational resources that will be refunded, 60M is the limit, 60M can be used.

`transaction_fee = tx_gas_used * priority_fee_per_gas`:
Miner fees are not deducted from the base transaction fees: `priority_fee_per_gas` is a part of `effective_gas_price` and we deducted from the sender `tx.gas * effective_gas_price` at the start.

---

#### Execution of System Transactions

A system transaction is an implicit, protocol-generated transaction. It is not created by a user, but rather injected directly into the execution payload by the block builder at the explicit instruction of the protocol itself.

```python
def process_unchecked_system_transaction(
    block_env: vm.BlockEnvironment,
    target_address: Address,
    data: Bytes,
) -> MessageCallOutput:
    """
    Process a system transaction without checking if the contract contains
    code or if the transaction fails.

    Parameters
    ----------
    block_env :
        The block scoped environment.
    target_address :
        Address of the contract to call.
    data :
        Data to pass to the contract.

    Returns
    -------
    system_tx_output : `MessageCallOutput`
        Output of processing the system transaction.

    """
    system_tx_state = TransactionState(parent=block_env.state)
    system_contract_code = get_code(
        system_tx_state,
        get_account(system_tx_state, target_address).code_hash,
    )

    tx_env = vm.TransactionEnvironment(
        origin=SYSTEM_ADDRESS,
        gas_price=block_env.base_fee_per_gas,
        gas=SYSTEM_TRANSACTION_GAS,
        access_list_addresses=set(),
        access_list_storage_keys=set(),
        state=system_tx_state,
        blob_versioned_hashes=(),
        authorizations=(),
        index_in_block=None,
        tx_hash=None,
    )

    system_tx_message = Message(
        block_env=block_env,
        tx_env=tx_env,
        caller=SYSTEM_ADDRESS,
        target=target_address,
        gas=SYSTEM_TRANSACTION_GAS,
        value=U256(0),
        data=data,
        code=system_contract_code,
        depth=Uint(0),
        current_target=target_address,
        code_address=target_address,
        should_transfer_value=False,
        is_static=False,
        accessed_addresses=set(),
        accessed_storage_keys=set(),
        disable_precompiles=False,
        parent_evm=None,
    )

    system_tx_output = process_message_call(system_tx_message)

    incorporate_tx_into_block(
        system_tx_state, block_env.block_access_list_builder
    )

    return system_tx_output


    process_unchecked_system_transaction(
        block_env=block_env,
        target_address=BEACON_ROOTS_ADDRESS,
        data=block_env.parent_beacon_block_root,
    )

    process_unchecked_system_transaction(
        block_env=block_env,
        target_address=HISTORY_STORAGE_ADDRESS,
        data=block_env.block_hashes[-1],  # The parent hash
    )
```

Essecially we just push these two values to their respected contracts at the start of processing the block so that the other contracts could retrieve this information.

---

#### Execution of System Operations

[EIP-7685](https://eips.ethereum.org/EIPS/eip-7685). Essencialy we are ask specific contracts if there are any requests to perform something on the Consensus Layer, add them together and compute sha256 hash on them to add to it header (if we creating a block) or validate the header. 

```python
def process_checked_system_transaction(
    block_env: vm.BlockEnvironment,
    target_address: Address,
    data: Bytes,
) -> MessageCallOutput:
    """
    Process a system transaction and raise an error if the contract does not
    contain code or if the transaction fails.

    Parameters
    ----------
    block_env :
        The block scoped environment.
    target_address :
        Address of the contract to call.
    data :
        Data to pass to the contract.

    Returns
    -------
    system_tx_output : `MessageCallOutput`
        Output of processing the system transaction.

    """
    # Pre-check that the system contract has code. We use a throwaway
    # TransactionState here that is *never* propagated back to BlockState
    # (no incorporate_tx_into_block call); the same get_account / get_code
    # lookups are performed and properly tracked by
    # process_unchecked_system_transaction below, which this function
    # always calls. Reading via a TransactionState (rather than directly
    # against pre_state) lets us see system contracts deployed earlier in
    # the same block — see EIP-7002 and EIP-7251 for this edge case.
    untracked_state = TransactionState(parent=block_env.state)
    system_contract_code = get_code(
        untracked_state,
        get_account(untracked_state, target_address).code_hash,
    )

    if len(system_contract_code) == 0:
        raise InvalidBlock(
            f"System contract address {target_address.hex()} does not "
            "contain code"
        )

    system_tx_output = process_unchecked_system_transaction(
        block_env,
        target_address,
        data,
    )

    if system_tx_output.error:
        raise InvalidBlock(
            f"System contract ({target_address.hex()}) call failed: "
            f"{system_tx_output.error}"
        )

    return system_tx_output


def process_general_purpose_requests(
    block_env: vm.BlockEnvironment,
    block_output: vm.BlockOutput,
) -> None:
    """
    Process all the requests in the block.

    Parameters
    ----------
    block_env :
        The execution environment for the Block.
    block_output :
        The block output for the current block.

    """
    # Requests are to be in ascending order of request type
    deposit_requests = parse_deposit_requests(block_output)
    requests_from_execution = block_output.requests
    if len(deposit_requests) > 0:
        requests_from_execution.append(DEPOSIT_REQUEST_TYPE + deposit_requests)

    system_withdrawal_tx_output = process_checked_system_transaction(
        block_env=block_env,
        target_address=WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS,
        data=b"",
    )

    if len(system_withdrawal_tx_output.return_data) > 0:
        requests_from_execution.append(
            WITHDRAWAL_REQUEST_TYPE + system_withdrawal_tx_output.return_data
        )

    system_consolidation_tx_output = process_checked_system_transaction(
        block_env=block_env,
        target_address=CONSOLIDATION_REQUEST_PREDEPLOY_ADDRESS,
        data=b"",
    )

    if len(system_consolidation_tx_output.return_data) > 0:
        requests_from_execution.append(
            CONSOLIDATION_REQUEST_TYPE
            + system_consolidation_tx_output.return_data
        )


def parse_deposit_requests(block_output: BlockOutput) -> Bytes:
    """
    Walk the receipts produced during block execution, concatenating the
    raw payload of every valid deposit event into a single byte string.

    A log is considered a deposit when it originates from
    [`DEPOSIT_CONTRACT_ADDRESS`][addr] and its first topic matches
    [`DEPOSIT_EVENT_SIGNATURE_HASH`][sig]. The returned bytes are the
    direct concatenation of the unframed deposit fields, ready to be
    prefixed with [`DEPOSIT_REQUEST_TYPE`][dt] before being appended to
    the block's request list.

    [addr]: ref:ethereum.forks.amsterdam.requests.DEPOSIT_CONTRACT_ADDRESS
    [sig]: ref:ethereum.forks.amsterdam.requests.DEPOSIT_EVENT_SIGNATURE_HASH
    [dt]: ref:ethereum.forks.amsterdam.requests.DEPOSIT_REQUEST_TYPE
    """
    deposit_requests: Bytes = b""
    for key in block_output.receipt_keys:
        receipt = trie_get(block_output.receipts_trie, key)
        assert receipt is not None
        decoded_receipt = decode_receipt(receipt)
        for log in decoded_receipt.logs:
            if log.address == DEPOSIT_CONTRACT_ADDRESS:
                if (
                    len(log.topics) > 0
                    and log.topics[0] == DEPOSIT_EVENT_SIGNATURE_HASH
                ):
                    request = extract_deposit_data(log.data)
                    deposit_requests += request

    return deposit_requests

```

There are also withdrawals which come from the Consensus Layer to be executed on EL. They come with the block that passed to be validated.

```python
def process_withdrawals(
    block_env: vm.BlockEnvironment,
    block_output: vm.BlockOutput,
    withdrawals: Tuple[Withdrawal, ...],
) -> None:
    """
    Increase the balance of the withdrawing account.
    """
    wd_state = TransactionState(parent=block_env.state)

    for i, wd in enumerate(withdrawals):
        trie_set(
            block_output.withdrawals_trie,
            rlp.encode(Uint(i)),
            rlp.encode(wd),
        )

        create_ether(wd_state, wd.address, wd.amount * GWEI_TO_WEI)

    incorporate_tx_into_block(wd_state, block_env.block_access_list_builder)

```


That's it. All the building blocks of the Execution Layer. Go through the [code](https://github.com/ethereum/execution-specs) and see the whole block validation flow for yourself. 