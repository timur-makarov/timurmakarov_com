+++
date = '2024-08-21T08:00:00+04:00'
draft = true
title = 'Ethereum Consensus Layer (Amsterdam)'
description = "Compilation of Knowledge on official ECLS. <br> Explanation of all the building blocks (SLZ, LMD Ghost, Gasper FFG, etc.) and code (line-by-line)"
+++

# SOME WRITINGS FROM A PREVIOUS, OLD ARTICLE

**Consensus via Proof of Work**
The creator of the original blockchain, Bitcoin, invented a consensus algorithm called proof of work (PoW). Arguably, PoW is the most important invention underpinning Bitcoin. The colloquial term for PoW is “mining,” which creates a misunderstanding about the primary purpose of consensus. Often people assume that the purpose of mining is the creation of new currency, since the purpose of real-world mining is the extraction of precious metals or other resources. Rather, the real purpose of mining (and all other consensus models) is to secure the blockchain, while keeping control over the system decentralized and diffused across as many participants as possible. The reward of newly minted currency is an incentive to those who contribute to the security of the system: a means to an end. In that sense, the reward is the means and decentralized security is the end. In PoW consensus there is also a corresponding “punishment,” which is the cost of energy required to participate in mining. If participants do not follow the rules and earn the reward, they risk the funds they have already spent on electricity to mine. Thus, PoW consensus is a careful balance of risk and reward that drives participants to behave honestly out of self-interest.

Ethereum started as a PoW blockchain, following Bitcoin’s example, in that it used a PoW algorithm with the same basic incentive system for the same basic goal: securing the blockchain while decentralizing control. Ethereum’s PoW algorithm was slightly different from Bitcoin’s and is called Ethash.

**Consensus via Proof of Stake**
Historically, proof of work was not the first consensus algorithm proposed. Preceding the introduction of proof of work, many researchers had proposed variations of consensus algorithms based on financial stake, now called proof of stake (PoS). In some respects, proof of work was invented as an alternative to proof of stake. Following the success of Bitcoin, many blockchains have emulated proof of work. Yet the explosion of research into consensus algorithms has also resurrected proof of stake, significantly advancing the state of the technology. From the beginning, Ethereum’s founders were hoping to eventually migrate its consensus algorithm to proof of stake. In fact, there was a deliberate handicap on Ethereum’s proof of work called the difficulty bomb, intended to gradually make proof-of-work mining of Ethereum more and more difficult, thereby forcing the transition to proof of stake.

In general, a PoS algorithm works as follows. The blockchain keeps track of a set of validators, and anyone who holds the blockchain’s base cryptocurrency (in Ethereum’s case, ether) can become a validator by sending a special type of transaction that locks up their ether into a deposit. The validators take turns proposing and voting on the next valid block, and the weight of each validator’s vote depends on the size of its deposit (i.e., stake). Importantly, a validator risks losing their deposit, i.e., “being slashed”, if the block they staked it on is rejected by the majority of validators. Conversely, validators earn a small reward, proportional to their deposited stake, for every block that is accepted by the majority. Thus, PoS forces validators to act honestly and follow the consensus rules, by a system of reward and punishment. The major difference between PoS and PoW is that the punishment in PoS is intrinsic to the blockchain (e.g., loss of staked ether), whereas in PoW the punishment is extrinsic (e.g., loss of funds spent on electricity).

Since Ethereum was born in 2015, there was the intention to transition to a PoS consensus protocol. The first concrete step into that direction came the 1st of December 2020 with the launch of the Beacon Chain. Initially the Beacon Chain was an empty blockchain that let everyone become a validator by depositing 32 ETH into a specific deposit contract and only handled its internal consensus of validators and their respective balances. At that time, the Ethereum blockchain was still using Ethash as its consensus protocol.

On September 15, 2022, the Merge hard fork occurred, and the Beacon Chain, with its own set of validators, extended its PoS based consensus protocol to the Ethereum main blockchain, effectively ending the use of Ethash. However, some limitations remained, including the inability for validators to withdraw their capital and leave the validator set.

These issues were fully resolved on April 12, 2023, with the Shapella update, which conclusively transitioned Ethereum from a Proof of Work (PoW) to a Proof of Stake (PoS) consensus protocol.

The Proof of Stake consensus protocol used by Ethereum is called Gasper. In the following sections, we will explore how it works, starting with basic terminology and progressing to the fork choice rule (LMD-Ghost) and finality gadget (Casper FFG).

**Nodes and Validators**
Nodes compose the Ethereum network’s backbone. They communicate with each other and are responsible for validating consensus adherence. Validators are attached to nodes, and despite what their name suggests they are not in charge of any validation. Validators carry out consensus by proposing and voting on new blocks, while validators’ output is validated by nodes to ensure that blocks and transactions adhere to the network’s rules. We will see in the following chapters the validators’ duties in detail.

One peculiar property of PoS to keep in mind is that the set of active validators is known: this will be key to achieve finality, as we can identify when we have achieved a majority vote of participants.

**Blocks and Attestations**
Strict time management is an important property of Ethereum’s Proof of Stake. The two key intervals in PoS are the slot which is exactly 12 seconds, and the epoch which spans 32 slots.

At every slot, exactly one validator is selected to propose a block. At every epoch, every validator gets to share its view of the world exactly once, in the form of an attestation. An attestation contains votes for the head of the chain that will be used by the LMD GHOST protocol, and votes for checkpoints that will be used by the Casper FFG protocol, where FFG stands for “Friendly Finality Gadget,”.

Attestation sharing is bandwidth intensive, so it’s taken on every epoch instead of every block to spread the necessary workload and keep it manageable.

The protocol incentivizes block and attestation production and accuracy via a system of rewards and penalties for validators, but it tolerates empty slots and attestations which can happen for both organic (e.g. node went offline) and profit-driven reasons - we will expand on this in the later section about timing games.

**LMD Ghost**
GHOST is a fork-choice algorithm for selecting the latest block of the chain. It doesn’t follow the heaviest chain as the Bitcoin fork-choice algorithm does, but the heaviest subtree.

The ratio is that, in a PoS system we have way more consensus data than in PoW because every validator votes once per epoch. So we want to use all this information to select the latest block - i.e. the head block - of the chain.

Basically every vote for a block is not only a vote for that block, but also for every ancestor of that block. And the fork choice rule is not only driven by block proposers, but by every validator’s attestations, as the Message Driven (MD) of LMD can suggest. Latest (the L in LMD) means that we only consider the last vote of every validator, discarding old ones.

The whole idea of LMD-Ghost can be described with the following points:

1. Every validator casts a vote once per epoch about what he thinks it’s the head of the chain at the moment he publishes the attestation.
2. Every block has a score (or weight) obtained by the sum of every validator that votes for that block as the head block of their local chain.
3. This score is recursively applied to all branches that root that block.
4. Every validator always assumes that the subtree with the heaviest weight is the “right” one.

![consensus_929758_04.png](/images/consensus_929758_04_594d4bd49c.png)

Now let’s see how LMD-Ghost works in practice.

We have a subtree of blocks, starting from a root block and the weights for every block. We know the weights of every block through attestation messages received via gossip from other validators or directly included in the blocks. In fact, by having other validators’ attestations we can calculate the score of every block by summing the votes that each block has received from all the validators.

The algorithm proceeds recursively, starting from the root block and selecting the branch with the highest weight, until it stops on a leaf node that doesn’t have any descendents. Of course if a block has only one descendent, there’s no choice to be made by the algorithm, while if there is a scenario where two or more branches have an equal weight, LMD-Ghost arbitrarily chooses the branch rooted at the child block with the highest block hash value.

Remember that the universal view of the network, such as being able to see everything that’s going on on the whole network, doesn’t exist. Every validator has its own local view and it runs LMD-Ghost on top of it. The idea is that honest validators build their blocks on the best head they see and cast their votes according to it. And by having a majority (more than 51%) of validators behaving correctly, we can reach a unique consensus about the history of the blockchain.

Let’s see an example. We are now a validator that has to propose the next block or simply has to publish an attestation. We need to run LMD-Ghost on our own local view to get the last head block so that we can then produce the next block on top of it or vote for that head block if we’re just publishing an attestation

First of all, from the latest attestations in our storage, we need to calculate the weight of votes for each block in the tree.

![consensus_929758_05.png](/images/consensus_929758_05_c95bdb35cb.png)

Then, from the weight of the blocks we can derive the weight of each branch.

![consensus_929758_06.png](/images/consensus_929758_06_b6bf72c973.png)

Last, we start from the root block (block A in this example) and each time we select the branch with the highest score, until we get to a leaf node, that is our head block returned by the fork-choice algorithm.

![consensus_929758_07.png](/images/consensus_929758_07_d3b1a6825f.png)

Note how we first selected the branch that goes to block C even if block C has less votes than block B, because we only care about total votes for the branch, and that includes all the votes for block C’s children. The idea is that the majority of validators the node knows about think that that subtree is the correct chain of blocks to follow.

**Incentives**
Block proposers are implicitly incentivised to produce a block on top of the correct head block, otherwise they risk their block to be orphaned and will not receive any reward. In fact all transactions’ fees of a block, plus a dynamic amount of inflated reward, are directed to the proposer of that block.

Attesters are explicitly incentivised to vote correctly by being rewarded if their vote is added into next blocks. Actually the maximum amount of reward an attester can receive is when his attestation is added into the immediately next slot from when he publishes it. Block proposers are also explicitly incentivised to add as more attestations as possible by receiving a very small reward per each vote they add into a block.

**Slashing**
An important concern that Proof of Stake systems have to solve is how they can punish bad behaviors. In PoW systems dishonest participants are implicitly punished because they have to waste time, energy and real money in order to do those bad behaviors.

Think about a Bitcoin miner that wants to create an heaviest chain that contains a double spend. He has to create blocks faster than all other miners together. If he tries to create those blocks and doesn’t succeed, he’s already implicitly punished by the protocol by having wasted his time, his energy and real money to even try and mine those blocks. If he doesn’t end up to be on the chain all other nodes consider to be valid, he actually spent time and money for nothing.

In PoS systems it is almost free for a validator to equivocate by publishing multiple contradictory messages. This is also called the “nothing at stake” problem.

The solution is quite simple but very powerful. Every participant must have a minimum amount of ETH in order to become a validator. Right now this value is fixed at 32 ETH which is more than $60.000 at the time of writing this. The system is able to detect when a validator has equivocated and punishes it by removing a portion of the amount he previously used to become a validator, and ejecting him from the protocol. Since validators digitally sign every message, it’s very easy to detect a proof of misbehavior.

**Casper FFG: The Finality Gadget**
Casper FFG is a kind of meta-consensus protocol. It is an overlay that can be run on top of an underlying consensus protocol in order to add finality to it.

In Ethereum’s proof of stake consensus, the underlying protocol is LMD GHOST which does not provide finality. Finality ensures that blocks once confirmed in the chain cannot be reversed, they will be part of the chain forever. So in essence Casper FFG functions as a “finality gadget”, and we use it to add finality to LMD GHOST.

Casper FFG takes advantage of the fact that, as a proof of stake protocol, we know who our participants are: the validators that manage the staked Ether. This means that we can use vote counting to judge when we have seen a majority of the votes of honest validators. More precisely, votes from validators that manage the majority of the stake - in everything that follows, every validator’s vote is weighted by the value of the stake that it manages, but for simplicity we won’t spell it out every time.

Casper FFG, like all classic Byzantine fault tolerant (BFT) protocols, can ensure finality as long as less than a third of validators are faulty or adversarial. Once a majority of honest validators have declared a block final, all honest validators agree, making that block irreversible. By requiring that honest validators constitute over two-thirds of the total, the system ensures that the consensus accurately represents the honest majority’s view.

Notably, Casper FFG distinguishes itself from traditional BFT protocols by offering economic finality even if more than a third of validators are compromised.

Casper FFG ensures consensus by requiring votes from over two-thirds of validators within an epoch, dividing voting across 32 slots to manage the large validator set efficiently. Validators vote once per epoch on a checkpoint, the first slot, to maintain a unified voting focus. This process, incorporating both Casper FFG and LMD GHOST votes for efficiency, aims at finalizing checkpoints, not entire epochs, clarifying that finality extends to the checkpoint and its preceding content.

![consensus_929758_08.png](/images/consensus_929758_08_bb13e9f21b.png)

**Justification and Finalization**
Casper FFG, like traditional Byzantine Fault Tolerance protocols, secures network agreement in two stages. Initially, validators broadcast and gather views on a proposed checkpoint. If a significant majority agrees, the checkpoint is justified, signaling a tentative agreement. In the subsequent round, if validators confirm widespread support for the justified checkpoint, it achieves finalization, meaning it’s unanimously agreed upon and irreversible. This process underlines the collaborative effort to ensure network consistency and security, aiming for checkpoints to be justified and then finalized within specific timeframes, improving the reliability of the consensus mechanism.

**Sources and Targets, Links and Conflicts**
In Casper FFG, votes comprise source and target checkpoints, representing validators’ commitments to the blockchain’s state at different points. These votes are cast as a linked pair, indicating a validator’s current and proposed points of consensus. The source vote reflects a validator’s acknowledgment of widespread support for a checkpoint, while the target vote represents a conditional commitment to a new checkpoint, dependent on similar support from others. This dual-vote system facilitates a structured progression towards finalizing blocks, ensuring network integrity and continuity.

**Supermajority Links**
In Casper FFG, a supermajority link between source and target checkpoints, s→t, is established when more than two-thirds of validators, by stake weight, endorse the same link, with their votes timely included in the blockchain. This mechanism ensures consensus and security by validating the sequence of checkpoints through widespread validator agreement.

**Justification**
In Casper FFG, when a node observes a majority of validators agreeing on a transition from one checkpoint to another, it justifies the old checkpoint. This signifies that the node has seen evidence of consensus from a significant portion of the validator set, making a commitment not to revert to a previous state unless overwhelming consensus is shown for an alternative path.

**Finalization**
When a node observes a consensus (a supermajority link) from one justified checkpoint to its direct child, it finalizes the parent checkpoint. This indicates a network-wide commitment not to revert from this point, backed by a strong majority of validator support. Finalization ensures network stability and security by making the blockchain history immutable past that checkpoint, preventing reversals without significant consequences for validators.

![consensus_929758_10.png](/images/consensus_929758_10_ff7a70ace8.png)

**Fork Choice Rule**
Casper FFG modifies the traditional fork choice rule, mandating that nodes prioritize the chain with the highest justified checkpoint. This adaptation, which is an evolution from the LMD GHOST protocol’s approach, ensures the network achieves finality by committing to checkpoints that have been agreed upon by a supermajority of validators. It effectively guarantees that once a checkpoint is justified, the network cannot revert beyond it, reinforcing the security and stability of the blockchain. This rule is also designed to maintain network liveness, aligning with Casper’s foundational goals.

**Plausible Liveness**
Casper FFG ensures the network remains active and can always reach consensus without any honest validators being penalized, embodying the concept of “plausible liveness.” This means that, provided a supermajority of validators are honest, the protocol can continue justifying and finalizing new checkpoints, avoiding any deadlock scenarios where progress is halted due to fear of slashing. This principle ensures the network’s resilience and continuous operation, underlining Casper’s adaptability to maintain consensus even in challenging conditions.

**Conflicting Justification**
Justifying a checkpoint means that I, as a validator, have received confirmation from ⅔ of the validators that they approve the checkpoint. This approval, however, represents only my local perspective. It’s possible other validators have different information; I can’t be sure. Despite this uncertainty, as an honest validator, I commit to never reversing any checkpoint that I’ve justified based on my local data.

Finalizing a checkpoint, on the other hand, takes this a step further. It occurs when I’ve received assurances from ⅔ of the validators that they, too, have heard from ⅔ of their peers confirming the checkpoint’s validity. This means that a supermajority of the network—not just my local view—acknowledges and commits to this checkpoint. It’s this broad consensus that protects the checkpoint from being reversed globally. Therefore, a finalized checkpoint is not just locally recognized; it’s globally secured.

Let’s explore an extreme scenario to understand the consensus process better. Suppose we have four validators: A, B, C, and D. All of them are honest, but the network they operate in can experience indefinite delays. For the sake of this example, imagine that there’s a checkpoint at every block height.

![consensus_929758_18.png](/images/consensus_929758_18_c3a2cf5b48.png)

Every validator in the scenario has the checkpoint N+1 and can therefore justify the checkpoint N; so N, the source is justified locally for all 4 validators and N+1 is the target.

Now let’s imagine that A is severely delayed in the network connection and it’s also chosen to propose a block.

A proposes a block in the epoch N+2, this block contains all the 4 votes to finalize the checkpoint N, but since its network connection is severely delayed, the other validators never see it.

A has a supermajority link between the source N and the target N+1, so it will finalize checkpoint N and justify checkpoint N+1, meanwhile B, C and D saw no votes in the current epoch, so they still have only justified checkpoint N.

They will also vote for an empty checkpoint in this epoch, which is checkpoint M.

![consensus_929758_19.png](/images/consensus_929758_19_bc73332f9e.png)

In epoch N+3 one validator between B, C and D is chosen to propose a block.

This block contains 3 votes with the source as the checkpoint N and the target as the checkpoint M, therefore there is a supermajority link between N and M that allows the validators B, C and D to have checkpoint N as finalized and checkpoint M as justified.

A, on the other hand, considers this block to be invalid, because in its local view, N+1 is justified and cannot be reverted.

The only solution for the chain on validator A to continue is to delete its memory and resync with the rest of the network.

**Supermajority Bug**
Let’s also explore a scenario where the majority client, an execution client that is used by at least ⅔ of the network, has a bug.

We will have 2 different clients for this scenario: AliceETH, the good one, BobETH the buggy one.

Due to a bug, the validators running BobETH at Epoch N+2 propose an invalid block. At this point, there are three possible outcomes:

• The validators that run the BobETH client have less than ⅓ of the total ethereum staked.

![consensus_929758_21.png](/images/consensus_929758_21_1790e8741c.png)

In this case the validators that run BobETH will eventually switch to the correct chain.

• The validators that run the BobETH client have less than ⅔ of the total ethereum staked, but more than ⅓.

In this case neither chains have enough votes to finalize any checkpoint, so 2 chains will be built at the same time, with neither of the two chains being finalized. Assuming that the bug fix arrives before the inactivity leak drains enough funds from the BobETH validator’s chain so that they now have less than ⅓ of the Ethereum staked, at that point the validators from BobETH can just switch to the correct canonical chain because that chain can be finalized.

This will require a bug fix by the BobETH developers, once the bug fix is developed, published and installed by all the validators that run BobETH, the chain with the invalid block will be discarded, and the other chain will be continued and finalized.

The penalty for the validators with the buggy client would be relatively light, only an “inactivity leak” for not having participated in the correct chain.

The “inactivity leak” is a penalty to inactive validators that grows quadratically with time.

![consensus_929758_22.png](/images/consensus_929758_22_538b119f33.png)

• The validators that run the BobETH client have more than ⅔ of the total ethereum staked.

In this scenario the validators will still be A, B, C and D, A runs the client AliceETH and B, C and D run the client BobETH.

Just as before every validator will justify checkpoint N in the epoch N+1; they will also finalize said block in the epoch N+2.

All the validators that are running AliceETH will discard the invalid block and checkpoint, but those validators have not enough stake to actually finalize the correct chain that they are building.

All the validators that are running BobETH will continue with the invalid chain that is being built and they will be able to finalize the invalid canonical chain.

In this example a bug fix would not help, because the validators B, C and D cannot switch to the correct chain being built by the validator A, unless that chain is finalized.

To fix this issue the validators B, C and D will lose stake due to the “inactivity leak” for a long time, until their staked ethereum will no longer be more than ⅓ of the total ethereum staked.

At this point the chain built by the validator A can be finalized, because A has more than ⅔ of the total ethereum staked, and B, C and D will be able to switch to it.

**Timing Games**
In Ethereum’s protocol, time is structured into 12-second units called slots. Each slot assigns a validator the role of proposing a block right at the start (t=0). A committee of attesters is then tasked with validating this block, aiming to do so by four seconds into the slot (t=4), which is considered the attestation deadline.

![consensus_929758_35.png](/images/consensus_929758_35_0681b88421.png)

Timing games in Ethereum create a competitive landscape where gains from Maximum Extractable Value (MEV) for one validator may lead to disadvantages for others. This competition can disrupt consensus by increasing the number of missed slots and potential block reorganizations. Additionally, it motivates attesters to postpone their validations, adding layers of complexity to the process.

The “Principles of Consensus” section points out the importance of liveness for Ethereum’s consensus process. However, timing games pose a threat to this critical feature by compromising the network’s reliability.

What’s a timing game? It’s like waiting for the perfect moment to make a move, aiming to get the most out of it. This is what some of the people keeping the network up and running are trying to do. They’re waiting for the right time to act to get the most rewards. But, this waiting game can be risky. If their internet is slow or they’re not too experienced, they might miss their chance to do their part. And missing too many chances could make the network less dependable.

Right now, this isn’t a big problem. Most of the entries working as validators aren’t really getting into these timing games or aren’t playing them at all.

However, we’re seeing more and more validators starting to play these games. It’s something we need to keep an eye on so it doesn’t turn into a bigger issue.

![consensus_929758_36.png](/images/consensus_929758_36_6e33f9eba0.png)


**Centralization of Supermajority**
The concept of supermajority client risk in Ethereum is all about balancing the network’s health and security. Ethereum decided to use multiple clients to prevent any single point of failure. This is because all software, including these clients, can have bugs. The real trouble starts when there’s a consensus bug, which could lead to something serious like creating infinite Ether out of thin air. If just one client ran the whole show and it got hit by such a bug, fixing it would be a nightmare. The network could keep running with the bug active long enough for an attacker to cause irreversible damage.

Let’s analyze a fast example of what could happen if a majority client had a bug, please note that every block below is a checkpoint and not a block in the blockchain:

![consensus_929758_37.png](/images/consensus_929758_37_a3ef93b244.png)

Functional clients disregard the epoch containing the invalid block (indicated in red). The initial red arrow serves to justify the invalid epoch, while the subsequent one finalizes it.

Assuming the bug is resolved and the validators who finalized the invalid epoch wish to switch back to the correct chain B, a preliminary action required is the justification of epoch X:

![consensus_929758_38.png](/images/consensus_929758_38_a6ce072770.png)

To engage in the justification of epoch X, requiring a supermajority link as shown by the dashed green arrow, validators must bypass the second red arrow, which represents the finalization of the invalid epoch. Casting votes for both links could lead to penalties for these validators.

The multi-client approach offers a safety net. If a bug pops up in a client that less than half the network uses, the rest of the network, running other clients, simply ignores the buggy block. This keeps the network on track, minimizing disruption. But, if a majority client — especially one used by more than two-thirds of validators — introduces a bug, it could wrongly finalize the chain, leading to a potential split.

Ethereum encourages diversifying clients because if everyone used the same client and it failed, the whole network would be at risk. The penalties for running a client that goes against the grain are there to discourage putting all our eggs in one basket. This way, if a client does have a bug, the damage is contained, affecting fewer users.

If a minority client causes trouble, it’s less of an issue because the majority can correct the path.

The more we spread out our choices across different clients, the safer Ethereum becomes. It’s not just about avoiding technical failures; it’s about safeguarding Ethereum’s future against any single point of failure. This diversity is our best defense against network-wide crises, ensuring Ethereum remains robust and resilient no matter what comes its way.
