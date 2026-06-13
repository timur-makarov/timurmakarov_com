+++
date = '2026-06-08T08:00:00+04:00'
draft = true
title = 'Ethereum Execution Layer Specifications (Amsterdam)'
description = "Compilation of knowledge on active EIPs and current conventions in Ethereum"
+++

### Address and the Checksum

**Ethereum Addresses**
Ethereum addresses are unique identifiers that are derived from public keys

```
keccak256(<public key>) = 2a5bc342ed616b5ba5732269001d3f1ef827552ae1114027bd3ecf1f086ba0f9
Address: 001d3f1ef827552ae1114027bd3ecf1f086ba0f9 (last 20 bytes)
 ```
Most often you will see the address with the prefix 0x that indicates it's hexadecimal-encoded.

Addresses for contracts derived with CREATE (older, much less used and less flexible opcode) or CREATE2 (allows users to send funds to a contract address even before it has been initialized on-chain, or to deploy identical contracts across different EVM-compatible blockchains at the exact same address, or to compute the address right in the code, which removes the need to be provided during the call of a function)

```
CREATE: keccak256(rlp([sender, nonce]))
CREATE2: keccak256(0xff ++ address ++ salt ++ keccak256(init_code))
```

"init_code" is the code for initialization of a contract (setting up constants, the owner, etc) that returns runtime code (all the functions that you call) at the end.
"0xff" is a special byte that prevents collision with addresses created by CREATE opcode. RLP will be discussed further and you will understand.
More information - https://eips.ethereum.org/EIPS/eip-1014

**Hex Encoding with Checksum in Capitalization (EIP-55)**
By modifying the capitalization of the alphabetic characters in the address, we can convey a checksum that can be used to protect the integrity of the address against typing or reading mistakes. Wallets that do not support EIP-55 checksums simply ignore the fact that the address contains mixed capitalization, but those that do support it can validate it and detect errors with a 99.986% accuracy.

EIP-55 is quite simple to implement. We take the Keccak-256 hash of the lowercase hexadecimal address. This hash acts as a digital fingerprint of the address, giving us a convenient checksum. Any small change in the input (the address) should cause a big change in the resulting hash (the checksum), allowing us to detect errors effectively. The hash of our address is then encoded in the capitalization of the address itself. Let’s break it down, step by step:

(I) Hash the lowercase address, without the 0x prefix; (II) Capitalize each alphabetic address character if the corresponding hex digit of the hash is greater than or equal to 0x8.

```
keccak256("001d3f1ef827552ae1114027bd3ecf1f086ba0f9")

Address: 001d3f1ef827552ae1114027bd3ecf1f086ba0f9
Hash:    23a69c1653e4ebbb619b0b2cb8a9bad49892a8b9695d9a19d8f673ca991deae1
```

Our address contains an alphabetic character d in the fourth position. The fourth character of the hash is 6, which is less than 8. So, we leave the d lowercase. The next alphabetic character in our address is f, in the sixth position. The sixth character of the hexadecimal hash is c, which is greater than 8. Therefore, we capitalize the F in the address, and so on.

```
Address with checksum: 001d3F1ef827552Ae1114027BD3ECF1f086bA0F9
```

And when we want to send a transaction, for a wallet, to verify the entered address it just needs to be converted into lowercase, hashed and compared.
